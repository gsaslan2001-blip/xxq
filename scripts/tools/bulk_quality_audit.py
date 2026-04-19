"""
DUS Bankasi - Toplu Kalite Denetimi
=====================================
Supabase'deki mevcut sorulara V3 Kalite Gate'ini (structural validation) uygular.
V1'den kalan veya filtreyi gormemis sorulari tespit eder.

Kullanim:
  python scripts/tools/bulk_quality_audit.py
  python scripts/tools/bulk_quality_audit.py --lesson Fizyoloji
  python scripts/tools/bulk_quality_audit.py --lesson Fizyoloji --unit Kardiyovaskuler
  python scripts/tools/bulk_quality_audit.py --flag
  python scripts/tools/bulk_quality_audit.py --output rapor.json
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.parse
from datetime import datetime
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config import SUPABASE_URL, SUPABASE_KEY
from shared import _validate_single_question

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

SEP = "=" * 62


# ───────────────────────────────────────────────────────────────
#  SUPABASE
# ───────────────────────────────────────────────────────────────

def _fetch_questions(lesson=None, unit=None):
    """Tum sorulari Supabase'den sayfalamali olarak ceker."""
    all_rows = []
    offset = 0
    limit = 1000
    cols = "id,lesson,unit,question,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation"

    while True:
        params = f"select={cols}&limit={limit}&offset={offset}&order=lesson.asc,unit.asc"
        if lesson:
            params += f"&lesson=eq.{urllib.parse.quote(lesson)}"
        if unit:
            params += f"&unit=eq.{urllib.parse.quote(unit)}"

        url = f"{SUPABASE_URL}/rest/v1/questions?{params}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                batch = json.loads(resp.read())
                all_rows.extend(batch)
                print(f"  Cekildi: {len(all_rows):,} soru...", end="\r")
                if len(batch) < limit:
                    break
                offset += limit
        except Exception as e:
            print(f"\n  HATA: Supabase GET basarisiz: {e}")
            break

    print(f"  Cekildi: {len(all_rows):,} soru.       ")
    return all_rows


def _flag_questions(ids_and_reasons):
    """
    Basarisiz sorulari DB'de flagged=true, flag_reason=<sebep> olarak isaret eder.
    Her 50 guncellemede bir ilerleme gosterir.
    """
    total = len(ids_and_reasons)
    flagged = 0
    errors = 0
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    for q_id, reason in ids_and_reasons:
        url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{q_id}"
        payload = json.dumps({"flagged": True, "flag_reason": reason}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="PATCH")
        try:
            urllib.request.urlopen(req)
            flagged += 1
        except Exception:
            errors += 1
        if (flagged + errors) % 50 == 0:
            print(f"  Isaretlendi: {flagged:,}/{total:,}...", end="\r")

    status = f"{flagged:,} flagged"
    if errors:
        status += f", {errors} hata"
    print(f"  {status}.              ")
    return flagged


# ───────────────────────────────────────────────────────────────
#  FORMAT DONUSUMU
# ───────────────────────────────────────────────────────────────

def _db_to_validate_fmt(row):
    """
    DB satiri (option_a ... correct_answer) formatini
    _validate_single_question'in beklettigi formata donusturur.
    """
    return {
        "_id": row.get("id", ""),
        "question": row.get("question", ""),
        "options": {
            "A": row.get("option_a", ""),
            "B": row.get("option_b", ""),
            "C": row.get("option_c", ""),
            "D": row.get("option_d", ""),
            "E": row.get("option_e", ""),
        },
        "correctAnswer": row.get("correct_answer", ""),
        "explanation": row.get("explanation", ""),
    }


# ───────────────────────────────────────────────────────────────
#  GORSEL YARDIMCILAR
# ───────────────────────────────────────────────────────────────

def _bar(value, total, width=24):
    """Basit ASCII ilerleme cubugu."""
    filled = int((value / total) * width) if total > 0 else 0
    return "\u2588" * filled + "\u2591" * (width - filled)


def _pct(part, total):
    return f"{(part / total * 100):.1f}%" if total > 0 else "0.0%"


# ───────────────────────────────────────────────────────────────
#  ANA DENETIM
# ───────────────────────────────────────────────────────────────

def run_audit(lesson=None, unit=None, do_flag=False, output_path=None):
    """Denetim akisini yuruttur ve raporu yazdir."""
    print(f"\n{SEP}")
    print("  DUSBANKASI | Toplu Kalite Denetimi")
    filter_label = lesson or "Tum Dersler"
    if unit:
        filter_label += f" / {unit}"
    print(f"  Filtre : {filter_label}")
    print(f"  Tarih  : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(SEP)

    rows = _fetch_questions(lesson=lesson, unit=unit)
    if not rows:
        print("  Soru bulunamadi.")
        return

    total = len(rows)

    # ── Denetim dongusu ──
    reason_counts = defaultdict(int)
    # {lesson: {unit: {total: int, failed: int, reasons: {str: int}}}}
    tree = defaultdict(lambda: defaultdict(lambda: {"total": 0, "failed": 0, "reasons": defaultdict(int)}))
    ids_and_reasons = []   # [(uuid, reason_str), ...]
    failed_details = []    # [(lesson, unit, reason_full, uuid), ...]

    for row in rows:
        q = _db_to_validate_fmt(row)
        ok, reason = _validate_single_question(q)
        les = row.get("lesson", "?")
        unt = row.get("unit", "?")
        tree[les][unt]["total"] += 1
        if not ok:
            reason_short = reason.split(":")[0] if reason else "bilinmeyen"
            tree[les][unt]["failed"] += 1
            tree[les][unt]["reasons"][reason_short] += 1
            reason_counts[reason_short] += 1
            ids_and_reasons.append((row.get("id", ""), reason or "bilinmeyen"))
            
            ca_key = q.get("correctAnswer", "")
            ca_text = q.get("options", {}).get(ca_key, "")
            failed_details.append((les, unt, reason or "bilinmeyen", row.get("id", ""), row.get("question", ""), ca_text))

    fail_count = len(ids_and_reasons)
    pass_count = total - fail_count

    # ── GENEL OZET ──
    print(f"\n{'GENEL OZET':}")
    print(f"  {'Toplam Soru':<24}: {total:>7,}")
    print(f"  {'Gecti (pass)':<24}: {pass_count:>7,}  ({_pct(pass_count, total)})")
    print(f"  {'Kaldi (fail)':<24}: {fail_count:>7,}  ({_pct(fail_count, total)})")

    if not fail_count:
        print(f"\n  Tum sorular kalite gate'ini gecti!\n{SEP}\n")
        return

    # ── BASARISIZLIK NEDENLER ──
    print(f"\nBASARISIZLIK NEDENLER")
    sorted_reasons = sorted(reason_counts.items(), key=lambda x: x[1], reverse=True)
    for reason, cnt in sorted_reasons:
        bar = _bar(cnt, fail_count, 22)
        pct = _pct(cnt, fail_count)
        print(f"  {reason:<28}: {cnt:>5,}  ({pct:>6})  {bar}")

    # ── DERS x UNITE KIRILIMLARI ──
    print(f"\nDERS x UNITE KIRILIMLARI")
    for les in sorted(tree.keys()):
        units = tree[les]
        les_total = sum(u["total"] for u in units.values())
        les_fail  = sum(u["failed"] for u in units.values())
        les_pass  = les_total - les_fail
        print(f"\n  {les}")
        print(f"  {'Toplam':>6}: {les_total:,} | Pass: {les_pass:,} ({_pct(les_pass, les_total)}) | Fail: {les_fail:,}")

        sorted_units = sorted(units.items(), key=lambda x: x[1]["failed"], reverse=True)
        last_idx = len(sorted_units) - 1
        for i, (unt, stats) in enumerate(sorted_units):
            prefix = "\u2514\u2500" if i == last_idx else "\u251c\u2500"
            u_total = stats["total"]
            u_fail  = stats["failed"]
            u_pass  = u_total - u_fail
            bar = _bar(u_pass, u_total, 14)
            top_reasons = ", ".join(
                f"{r}:{c}" for r, c in
                sorted(stats["reasons"].items(), key=lambda x: x[1], reverse=True)[:3]
            )
            fail_str = f"  [{top_reasons}]" if u_fail else ""
            print(f"  \u2502  {prefix} {unt:<32}: {u_total:>4} soru  {bar} {_pct(u_pass, u_total)}{fail_str}")

    print()

    # ── FLAG ──
    if do_flag:
        print(f"\nFLAGGING: {fail_count:,} soru flagged=true yapiliyor...")
        _flag_questions(ids_and_reasons)
    else:
        print(f"  (Isaretlemek icin --flag parametresi kullanin)")

    # ── CIKTI DOSYASI ──
    if output_path:
        report = {
            "generated_at": datetime.now().isoformat(),
            "filter": {"lesson": lesson, "unit": unit},
            "summary": {
                "total": total,
                "passed": pass_count,
                "failed": fail_count,
                "pass_pct": round(pass_count / total * 100, 2) if total else 0,
            },
            "reason_breakdown": {k: v for k, v in sorted_reasons},
            "failed_questions": [
                {"lesson": l, "unit": u, "reason": r, "id": i, "question": q_text, "correct_answer": ca_text}
                for l, u, r, i, q_text, ca_text in failed_details
            ],
        }
        try:
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
            print(f"\n  Rapor kaydedildi: {output_path}")
        except Exception as e:
            print(f"\n  Rapor yazma hatasi: {e}")

    print(f"\n{SEP}")
    print("  Denetim tamamlandi.")
    print(f"{SEP}\n")


# ───────────────────────────────────────────────────────────────
#  ENTRY POINT
# ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="DUSBANKASI | Toplu Kalite Denetimi — DB'deki sorulara V3 filtresi uygula"
    )
    parser.add_argument("--lesson", metavar="DERS", help="Sadece bu dersi denetle (orn: Fizyoloji)")
    parser.add_argument("--unit", metavar="UNITE", help="Sadece bu uniteyi denetle (--lesson zorunlu)")
    parser.add_argument(
        "--flag", action="store_true",
        help="Basarisiz sorulari DB'de flagged=true olarak isaretle"
    )
    parser.add_argument(
        "--output", metavar="DOSYA",
        help="Sonuclari JSON dosyasina kaydet (orn: audit_rapor.json)"
    )
    args = parser.parse_args()

    if args.unit and not args.lesson:
        parser.error("--unit kullanmak icin --lesson da belirtilmelidir.")

    run_audit(lesson=args.lesson, unit=args.unit, do_flag=args.flag, output_path=args.output)
