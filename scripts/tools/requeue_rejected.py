"""
DUS Bankasi - Reddedilen Sorulari Yeniden Degerlendir
=======================================================
scripts/recovery/rejected/ klasoründeki sorulara guncel kalite
filtrelerini yeniden uygular. Guncel esikler altinda artik gecen
sorulari Supabase'e gondermek icin kullanilir.

Kullanim:
  python scripts/tools/requeue_rejected.py
  python scripts/tools/requeue_rejected.py --lesson Fizyoloji
  python scripts/tools/requeue_rejected.py --push          # Gecenleri Supabase'e yaz
  python scripts/tools/requeue_rejected.py --dry-run       # Sadece rapor, hicbir sey yazma
  python scripts/tools/requeue_rejected.py --file <dosya>  # Tek bir rejected JSON dosyasi
"""

import os
import sys
import json
import argparse
from datetime import datetime
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config import REJECTED_DIR, RECOVERY_DIR
from shared import _validate_single_question, _write_to_supabase, save_checkpoint

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

SEP = "=" * 62


# ───────────────────────────────────────────────────────────────
#  DOSYA OKUMA
# ───────────────────────────────────────────────────────────────

def _load_rejected_files(lesson_filter=None, specific_file=None):
    """
    REJECTED_DIR altindaki JSON dosyalarini yukler.
    Her dosya: {lesson, unit, rejected_at, items: [{question, reason}, ...]}
    """
    if specific_file:
        targets = [specific_file]
    else:
        if not os.path.isdir(REJECTED_DIR):
            print(f"  HATA: rejected/ klasoru bulunamadi: {REJECTED_DIR}")
            return []
        targets = [
            os.path.join(REJECTED_DIR, f)
            for f in sorted(os.listdir(REJECTED_DIR))
            if f.endswith(".json")
        ]

    envelopes = []
    for path in targets:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            les = data.get("lesson", "")
            if lesson_filter and lesson_filter.lower() not in les.lower():
                continue
            data["_filepath"] = path
            data["_filename"] = os.path.basename(path)
            envelopes.append(data)
        except Exception as e:
            print(f"  UYARI: {path} okunamadi: {e}")

    return envelopes


# ───────────────────────────────────────────────────────────────
#  YENIDEN DOGRULAMA
# ───────────────────────────────────────────────────────────────

def _revalidate_envelope(envelope):
    """
    Bir rejected envelope'undaki tum sorulari guncel filtreden gecirir.
    Doner: (recovered, still_failed)
      recovered    : [{q, lesson, unit}, ...]
      still_failed : [{q, old_reason, new_reason, lesson, unit}, ...]
    """
    lesson = envelope.get("lesson", "?")
    unit   = envelope.get("unit", "?")
    items  = envelope.get("items", [])

    recovered    = []
    still_failed = []

    for item in items:
        q          = item.get("question", {})
        old_reason = item.get("reason", "bilinmeyen")

        ok, new_reason = _validate_single_question(q)
        if ok:
            recovered.append({"question": q, "lesson": lesson, "unit": unit})
        else:
            still_failed.append({
                "question": q,
                "old_reason": old_reason,
                "new_reason": new_reason,
                "lesson": lesson,
                "unit": unit,
            })

    return recovered, still_failed


# ───────────────────────────────────────────────────────────────
#  SUPABASE YAZIMI
# ───────────────────────────────────────────────────────────────

def _push_recovered(recovered_list):
    """
    Kurtarilan sorulari lesson/unit gruplarına gore Supabase'e yazar.
    Doner: (written_count, error_count)
    """
    # lesson+unit bazinda grupla
    groups = defaultdict(list)
    for item in recovered_list:
        key = (item["lesson"], item["unit"])
        groups[key].append(item["question"])

    written = 0
    errors  = 0
    for (lesson, unit), questions in groups.items():
        # _write_to_supabase: uretim formatindaki sorulari (options/correctAnswer) alir
        ok = _write_to_supabase(questions, lesson, unit)
        if ok:
            written += len(questions)
        else:
            errors += len(questions)
            print(f"  HATA: {lesson}/{unit} yazma basarisiz ({len(questions)} soru)")
    return written, errors


def _stage_to_pending(recovered_list):
    """
    Push yapmadan once pending klasorune checkpoint olarak kaydeder.
    Kullanicinin manuel incelemesine izin verir.
    """
    groups = defaultdict(list)
    for item in recovered_list:
        key = (item["lesson"], item["unit"])
        groups[key].append(item["question"])

    staged = 0
    for (lesson, unit), questions in groups.items():
        path = save_checkpoint(questions, lesson, unit, tag="requeued")
        if path:
            print(f"  Staged: {lesson}/{unit} — {len(questions)} soru → {path}")
            staged += len(questions)
    return staged


# ───────────────────────────────────────────────────────────────
#  ANA AKIS
# ───────────────────────────────────────────────────────────────

def run_requeue(lesson=None, specific_file=None, do_push=False, dry_run=False):
    print(f"\n{SEP}")
    print("  DUSBANKASI | Rejected Sorulari Yeniden Degerlendir")
    filter_label = lesson or "Tum Dersler"
    if specific_file:
        filter_label = os.path.basename(specific_file)
    print(f"  Filtre  : {filter_label}")
    print(f"  Mod     : {'DRY-RUN (hicbir sey yazilmaz)' if dry_run else ('PUSH' if do_push else 'STAGE (pending)')}")
    print(f"  Tarih   : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(SEP)

    envelopes = _load_rejected_files(lesson_filter=lesson, specific_file=specific_file)
    if not envelopes:
        print("  Islenecek rejected dosyasi bulunamadi.\n")
        return

    print(f"  {len(envelopes)} rejected dosyasi bulundu.\n")

    all_recovered    = []
    all_still_failed = []
    file_stats       = []   # [(filename, total, recovered_n, still_n), ...]

    for env in envelopes:
        fname = env["_filename"]
        recovered, still_failed = _revalidate_envelope(env)
        all_recovered.extend(recovered)
        all_still_failed.extend(still_failed)
        total_items = len(env.get("items", []))
        file_stats.append((fname, total_items, len(recovered), len(still_failed)))

    total_q  = sum(s[1] for s in file_stats)
    total_ok = len(all_recovered)
    total_nok = len(all_still_failed)

    # ── OZET ──
    print("SONUC OZETI")
    print(f"  {'Toplam soru (rejected)':<28}: {total_q:>5,}")
    print(f"  {'Kurtarildi (artik gecti)':<28}: {total_ok:>5,}  ({(total_ok/total_q*100):.1f}%)" if total_q else "  Kurtarildi: 0")
    print(f"  {'Hala basarisiz':<28}: {total_nok:>5,}  ({(total_nok/total_q*100):.1f}%)" if total_q else "  Hala basarisiz: 0")

    if total_ok == 0:
        print("\n  Kurtarilabilecek soru yok. Filtreler hala gecirilemiyor.")
    else:
        # Kurtarilan sorularin neden hala gectigini goster
        print(f"\nKURTARILAN SORULARIN ONCEKI REDDEDİLME NEDENLER:")
        old_reason_counts = defaultdict(int)
        for item in all_recovered:
            # Bu bilgi _revalidate_envelope'dan gelmiyor; file_stats'tan degil
            pass
        # Eski nedenleri yeniden topla
        for env in envelopes:
            lesson_env = env.get("lesson", "?")
            unit_env = env.get("unit", "?")
            for it in env.get("items", []):
                q          = it.get("question", {})
                old_reason = it.get("reason", "bilinmeyen")
                ok, _      = _validate_single_question(q)
                if ok:
                    short = old_reason.split(":")[0]
                    old_reason_counts[short] += 1
        for reason, cnt in sorted(old_reason_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"  {reason:<28}: {cnt:>4,}")

    # ── HALA BASARISIZ ──
    if total_nok > 0:
        new_reason_counts = defaultdict(int)
        for item in all_still_failed:
            short = (item["new_reason"] or "bilinmeyen").split(":")[0]
            new_reason_counts[short] += 1
        print(f"\nHALA BASARISIZ — GUNCEL NEDENLER:")
        for reason, cnt in sorted(new_reason_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"  {reason:<28}: {cnt:>4,}")

    # ── DOSYA BAZINDA KIRILIM ──
    if len(file_stats) > 1:
        print(f"\nDOSYA BAZINDA KIRILIM:")
        for fname, tot, rec, still in sorted(file_stats, key=lambda x: x[2], reverse=True):
            tag = f"  +{rec} kurtarildi" if rec > 0 else "  (kurtarilamadi)"
            print(f"  {fname:<48}: {tot:>4} soru  {tag}")

    # ── EYLEM ──
    if total_ok > 0 and not dry_run:
        print()
        if do_push:
            print(f"PUSH: {total_ok} soru Supabase'e yaziliyor...")
            written, errors = _push_recovered(all_recovered)
            print(f"  Yazildi: {written} | Hata: {errors}")
        else:
            print(f"STAGE: {total_ok} soru pending klasorune kaydediliyor...")
            staged = _stage_to_pending(all_recovered)
            print(f"  {staged} soru staged.")
            print(f"  (Supabase'e gondermek icin --push kullanin)")
    elif dry_run and total_ok > 0:
        print(f"\n  DRY-RUN: {total_ok} soru kurtarilabilir, ancak hicbir sey yazilmadi.")

    print(f"\n{SEP}")
    print("  Tamamlandi.")
    print(f"{SEP}\n")


# ───────────────────────────────────────────────────────────────
#  ENTRY POINT
# ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="DUSBANKASI | Rejected sorulari yeniden degerlendir"
    )
    parser.add_argument("--lesson", metavar="DERS", help="Sadece bu dersin rejected dosyalarini isle")
    parser.add_argument("--file", metavar="DOSYA", help="Tek bir rejected JSON dosyasini isle (tam yol)")
    parser.add_argument(
        "--push", action="store_true",
        help="Gecen sorulari direkt Supabase'e yaz (varsayilan: pending'e kaydet)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Sadece rapor: hicbir sey yazma, hicbir seyi tasima"
    )
    args = parser.parse_args()

    if args.push and args.dry_run:
        parser.error("--push ve --dry-run ayni anda kullanilamaz.")

    run_requeue(
        lesson=args.lesson,
        specific_file=args.file,
        do_push=args.push,
        dry_run=args.dry_run,
    )
