"""
DUS Bankasi - Batch Rollback
==============================
Belirli bir zaman araligi veya lesson/unit filtresindeki sorulari
Supabase'den geri alir (siler).

GUVENLIK PROTOKOLU:
  1. Her zaman once --dry-run ile calistirin.
  2. Silme oncesi otomatik yedek alinir (scripts/recovery/rollback_backups/).
  3. Silmek icin "DELETE {N} SORULAR" yazmaniz istenir (veya --yes).
  4. En az bir filtre zorunludur: hicbir filtre verilmezse script durur.

Kullanim:
  python scripts/tools/batch_rollback.py --dry-run --lesson Fizyoloji --since 2026-04-18
  python scripts/tools/batch_rollback.py --lesson Fizyoloji --unit Kardiyovaskuler --dry-run
  python scripts/tools/batch_rollback.py --since 2026-04-18T14:00 --until 2026-04-18T23:59 --dry-run
  python scripts/tools/batch_rollback.py --lesson Fizyoloji --since 2026-04-18 --yes
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config import SUPABASE_URL, SUPABASE_KEY, RECOVERY_DIR

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

SEP     = "=" * 62
WARN    = "!" * 62
BACKUP_DIR = os.path.join(os.path.dirname(RECOVERY_DIR), "rollback_backups")


# ───────────────────────────────────────────────────────────────
#  FILTRE OLUSTURMA
# ───────────────────────────────────────────────────────────────

def _build_filter_params(lesson, unit, since, until, ids):
    """
    Supabase REST sorgu parametrelerini dict olarak olusturur.
    Hicbir filtre yoksa None doner (guvenlik kilidi).
    """
    params = {}
    if lesson:
        params["lesson"] = f"eq.{lesson}"
    if unit:
        params["unit"] = f"eq.{unit}"
    if since:
        params["created_at"] = f"gte.{since}"
    if until:
        # created_at iki kosullu olamaz tek parametrede — PostgREST AND mantigi
        # 'until' icin ayri param anahtari kullanilamaz, GT ile birlesik yazmak gerek
        # Cozum: select ile once cekip ID bazinda sil
        pass  # until islemi _fetch_for_rollback icinde manuel filtrelenir
    if ids:
        params["id"] = f"in.({','.join(ids)})"
    return params if params else None


def _params_to_querystring(params):
    """{'lesson': 'eq.Fiz', ...} → 'lesson=eq.Fiz&...'"""
    return "&".join(f"{k}={urllib.parse.quote(str(v), safe='=.,()-')}" for k, v in params.items())


# ───────────────────────────────────────────────────────────────
#  SORU CEKME
# ───────────────────────────────────────────────────────────────

def _fetch_for_rollback(lesson, unit, since, until, ids):
    """
    Silinecek aday sorulari ceker.
    'until' PostgREST'te tek parametreyle ifade edilemediginden
    Python tarafinda filtre uygulanir.
    Doner: list[dict] (id, lesson, unit, created_at, question_preview)
    """
    all_rows = []
    offset   = 0
    limit    = 1000
    cols     = "id,lesson,unit,created_at,question"

    base_params = {}
    if lesson:
        base_params["lesson"] = f"eq.{lesson}"
    if unit:
        base_params["unit"] = f"eq.{unit}"
    if since:
        base_params["created_at"] = f"gte.{since}"
    if ids:
        base_params["id"] = f"in.({','.join(ids)})"

    while True:
        qs = _params_to_querystring(base_params)
        url = f"{SUPABASE_URL}/rest/v1/questions?select={cols}&{qs}&limit={limit}&offset={offset}&order=created_at.desc"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                batch = json.loads(resp.read())
                all_rows.extend(batch)
                if len(batch) < limit:
                    break
                offset += limit
        except Exception as e:
            print(f"  HATA: Supabase GET basarisiz: {e}")
            break

    # Python tarafinda 'until' filtresi
    if until:
        all_rows = [r for r in all_rows if r.get("created_at", "") <= until]

    return all_rows


# ───────────────────────────────────────────────────────────────
#  YEDEK ALMA
# ───────────────────────────────────────────────────────────────

def _take_backup(rows, lesson, unit, since, until):
    """Silme oncesi etkilenen sorularin tam yedeğini JSON'a yazar."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts      = datetime.now().strftime("%Y%m%d_%H%M%S")
    label   = "_".join(filter(None, [lesson, unit])) or "all"
    fname   = f"rollback_{label}_{ts}.json"
    fpath   = os.path.join(BACKUP_DIR, fname)

    # Tam veri icin silinecek soruların tüm sutunlarini cek
    full_rows = []
    col_all = "id,lesson,unit,question,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,created_at,flagged,flag_reason"
    chunk_size = 200
    ids = [r["id"] for r in rows]
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i + chunk_size]
        id_filter = f"id=in.({','.join(chunk)})"
        url = f"{SUPABASE_URL}/rest/v1/questions?select={col_all}&{id_filter}&limit={chunk_size}"
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                full_rows.extend(json.loads(resp.read()))
        except Exception as e:
            print(f"  UYARI: Yedek verisi cekilemedi (chunk {i}): {e}")

    envelope = {
        "backup_at":    datetime.now().isoformat(),
        "filter_info":  {"lesson": lesson, "unit": unit, "since": since, "until": until},
        "question_count": len(full_rows),
        "questions": full_rows,
    }
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(envelope, f, ensure_ascii=False, indent=2)
    return fpath


# ───────────────────────────────────────────────────────────────
#  SUPABASE DELETE
# ───────────────────────────────────────────────────────────────

def _delete_by_ids(ids):
    """
    Sorulari ID listesiyle 200'luk parcalar halinde Supabase'den siler.
    Doner: (deleted_count, error_count)
    """
    deleted = 0
    errors  = 0
    chunk_size = 200

    for i in range(0, len(ids), chunk_size):
        chunk = ids[i:i + chunk_size]
        id_filter = f"id=in.({','.join(chunk)})"
        url = f"{SUPABASE_URL}/rest/v1/questions?{id_filter}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=minimal",
        }
        req = urllib.request.Request(url, headers=headers, method="DELETE")
        try:
            urllib.request.urlopen(req)
            deleted += len(chunk)
        except Exception as e:
            print(f"  HATA: Delete chunk {i}-{i+len(chunk)} basarisiz: {e}")
            errors += len(chunk)

        pct = min(100, int((i + len(chunk)) / len(ids) * 100))
        print(f"  Silindi: {deleted:,}/{len(ids):,}  ({pct}%)...", end="\r")

    print(f"  Silme tamamlandi: {deleted:,} silindi, {errors:,} hata.   ")
    return deleted, errors


# ───────────────────────────────────────────────────────────────
#  GORUNTU YARDIMCILARI
# ───────────────────────────────────────────────────────────────

def _show_sample(rows, n=8):
    """Ilk n soruyu ozet olarak yazdirir."""
    sample = rows[:n]
    for row in sample:
        les  = row.get("lesson", "?")
        unt  = row.get("unit", "?")
        ts   = row.get("created_at", "?")[:19]
        stem = (row.get("question") or "")[:70].replace("\n", " ")
        print(f"    [{ts}] {les}/{unt}")
        print(f"     \"{stem}...\"")
    if len(rows) > n:
        print(f"    ... ve {len(rows) - n} soru daha")


# ───────────────────────────────────────────────────────────────
#  ANA AKIS
# ───────────────────────────────────────────────────────────────

def run_rollback(lesson, unit, since, until, ids, dry_run, auto_yes):
    print(f"\n{SEP}")
    print("  DUSBANKASI | Batch Rollback")
    print(f"  Tarih  : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Gosterge
    filters = []
    if lesson: filters.append(f"lesson={lesson}")
    if unit:   filters.append(f"unit={unit}")
    if since:  filters.append(f"since={since}")
    if until:  filters.append(f"until={until}")
    if ids:    filters.append(f"ids({len(ids)})")
    print(f"  Filtre : {' | '.join(filters) if filters else '(yok)'}")
    print(f"  Mod    : {'DRY-RUN' if dry_run else 'GERCEK SILME'}")
    print(SEP)

    # ── Guvenlik kilidi: filtresiz silme yok ──
    if not any([lesson, unit, since, until, ids]):
        print(f"\n  HATA: En az bir filtre zorunludur (--lesson, --unit, --since, --until, --ids).")
        print(f"  Tum sorulari silmek tehlikelidir ve bu aracin amaci degil.")
        print(f"  Supabase Dashboard'u kullanin.\n")
        sys.exit(1)

    # ── Aday sorulari cek ──
    print("  Etkilenen sorular cekiliyor...")
    rows = _fetch_for_rollback(lesson, unit, since, until, ids)
    n    = len(rows)

    if n == 0:
        print("  Bu filtrelerle eslesen soru bulunamadi.\n")
        return

    # ── Ozet goster ──
    print(f"\n  ETKILENECEK SORULAR: {n:,}")
    _show_sample(rows)

    # Ders/Unite dagilimi
    dist = {}
    for row in rows:
        key = f"{row.get('lesson','?')} / {row.get('unit','?')}"
        dist[key] = dist.get(key, 0) + 1
    print(f"\n  DERS/UNITE DAGILIMI:")
    for key, cnt in sorted(dist.items(), key=lambda x: x[1], reverse=True):
        print(f"    {key:<48}: {cnt:>5,}")

    if dry_run:
        print(f"\n  DRY-RUN: {n:,} soru silinecekti. Gercek silme icin --dry-run'u kaldirin.\n")
        print(f"{SEP}\n")
        return

    # ── Onay ──
    print(f"\n{WARN}")
    print(f"  UYARI: Bu islem {n:,} soruyu KALICI OLARAK siler!")
    print(f"  Silme oncesi otomatik yedek alinacaktir.")
    print(WARN)

    if not auto_yes:
        beklenen = f"DELETE {n} SORULAR"
        girdi = input(f"\n  Onayla - su ifadeyi aynen yaz: {beklenen}\n  > ").strip()
        if girdi != beklenen:
            print(f"\n  Iptal edildi. Yanlis onay ifadesi.")
            sys.exit(0)

    # ── Yedek al ──
    print(f"\n  Yedek alinıyor ({n:,} soru)...")
    try:
        backup_path = _take_backup(rows, lesson, unit, since, until)
        print(f"  Yedek kaydedildi: {backup_path}")
    except Exception as e:
        print(f"  HATA: Yedek alinamadi: {e}")
        print(f"  Guvenlik icin silme iptal edildi.")
        sys.exit(1)

    # ── Sil ──
    print(f"\n  Silme islemi basliyor...")
    target_ids = [r["id"] for r in rows]
    deleted, errors = _delete_by_ids(target_ids)

    print(f"\n{SEP}")
    if errors == 0:
        print(f"  Rollback tamamlandi: {deleted:,} soru silindi.")
    else:
        print(f"  Rollback tamamlandi: {deleted:,} silindi, {errors:,} hata.")
        print(f"  Hatalı sorular yedekte mevcut: {backup_path}")
    print(f"  Yedek: {backup_path}")
    print(f"{SEP}\n")


# ───────────────────────────────────────────────────────────────
#  ENTRY POINT
# ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="DUSBANKASI | Batch Rollback — Belirli sorulari Supabase'den sil"
    )
    parser.add_argument("--lesson", metavar="DERS", help="Ders filtresi (orn: Fizyoloji)")
    parser.add_argument("--unit",   metavar="UNITE", help="Unite filtresi (orn: Kardiyovaskuler)")
    parser.add_argument(
        "--since", metavar="TARIH",
        help="Bu tarihten itibaren olusturulan sorular (ISO-8601, orn: 2026-04-18 veya 2026-04-18T14:00)"
    )
    parser.add_argument(
        "--until", metavar="TARIH",
        help="Bu tarihe kadar olusturulan sorular (ISO-8601)"
    )
    parser.add_argument(
        "--ids", metavar="UUID_LISTESI",
        help="Virgul ile ayrilmis spesifik soru UUID'leri"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Hicbir sey silme, sadece etkilenecek sorulari goster"
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="Onay istemeden direkt sil (otomasyon icin — dikkatli kullanin)"
    )
    args = parser.parse_args()

    ids_list = [i.strip() for i in args.ids.split(",")] if args.ids else []

    run_rollback(
        lesson   = args.lesson,
        unit     = args.unit,
        since    = args.since,
        until    = args.until,
        ids      = ids_list,
        dry_run  = args.dry_run,
        auto_yes = args.yes,
    )
