"""
smart_audit_pipeline.py — Async Post-Production Quality Pipeline (v2)

Kullanım:
    python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji
    python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji --dry-run
    python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji --interactive
    python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji --delete

Mod:
    varsayılan → FLAG (quality_flag='kavramsal_kopya')
    --delete   → kalıcı silme (geri alınamaz)
    --dry-run  → DB işlemi yok, önizle
    --interactive → her karar için onay

Mimari değişiklikler (v2):
    - Veri erişimi: lib/db_layer.py (async aiohttp + Semaphore)
    - İş mantığı:  lib/audit_logic.py (Jaccard, kürasyon, LSH)
    - Bu dosya:    sadece orkestrasyon + CLI
"""

import sys
import os
import json
import asyncio
import aiohttp
import argparse
from datetime import datetime

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lib")))

from config import SUPABASE_URL, SUPABASE_KEY
from lib.db_layer import batch_flag, batch_delete, fetch_all_questions
from lib.db_layer import batch_flag, batch_delete, fetch_all_questions
from lib.audit_logic import find_duplicates, curate_pairs, write_curation_summary, calc_quality_score

LOG_DIR    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "logs"))
REPORT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "raporlar"))
os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

DELETE_LOG = os.path.join(LOG_DIR, "deleted_questions.jsonl")
FLAG_LOG   = os.path.join(LOG_DIR, "flagged_questions.jsonl")


# ─── Önizleme ────────────────────────────────────────────────────────────────

def preview_actions(ids_to_action: list, mode: str):
    label = "FLAG" if mode == "flag" else "SİL (kalıcı)"
    print(f"\n[Dry-Run] {len(ids_to_action)} soru → {label}:")
    for i, item in enumerate(ids_to_action, 1):
        print(f"  {i:3}. [{item['id'][:8]}] {item['text_short'][:80]}")
        print(f"       Neden: {item['reason']}")
        print(f"       Kazanan: {item['winner_text_short'][:80]}")
    print(f"\n  Toplam: {len(ids_to_action)}. DB'ye hiçbir şey yazılmadı.")


# ─── Rapor Kaydetme ───────────────────────────────────────────────────────────

def save_dupe_report(lesson: str, results: list) -> str:
    report_path = os.path.join(
        REPORT_DIR, f"{lesson.lower().replace(' ', '_')}_expl_dupes.json"
    )
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(
            {"lesson": lesson, "total_pairs_flagged": len(results), "results": results},
            f, ensure_ascii=False, indent=2,
        )
    print(f"  Analiz Raporu: {report_path}")
    return report_path


# ─── Ana Akış (Async) ─────────────────────────────────────────────────────────

async def run_audit(
    lesson: str,
    mode: str = "flag",
    dry_run: bool = False,
    interactive: bool = False,
) -> tuple[int, int]:
    """Programatik giriş noktası. notebooklm-exhaust.py buraya çağırır."""
    print(f"\n{'='*60}")
    print(f"  DUSBANKASI HYBRID PRODUCTION GATE v3")
    print(f"  Ders: {lesson.upper()}")
    print(f"  Mod : {'DRY-RUN' if dry_run else mode.upper()}"
          f"{' + INTERACTIVE' if interactive and not dry_run else ''}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    # Aşama 1 — Veri Çekme (async)
    async with aiohttp.ClientSession() as session:
        questions = await fetch_all_questions(lesson, session)

    if len(questions) < 2:
        print("   ⚠️ Yeterli soru yok. Pipeline sonlandırıldı.")
        return 0, 0

    # Aşama 1 — Hibrit Çapraz Tarama (Lexical + Semantic)
    print(f"\n[Aşama 1] Hibrit Radar Taraması ({len(questions):,} soru)...")
    results = find_duplicates(questions)
    print(f"   🎯 Potansiyel kopya/zayıf çift: {len(results)}")

    if not results:
        print("\n✅ Kopya çift bulunamadı. Veritabanı tertemiz!")
        return len(questions), 0

    save_dupe_report(lesson, results)

    # Aşama 2 — Akıllı Kürasyon (Ölüm Maçı)
    print(f"\n[Aşama 2] Manifesto Temelli Akıllı Kürasyon...")
    ids_to_action, curation_log = curate_pairs(results, interactive=(interactive and not dry_run))
    write_curation_summary(lesson, results, curation_log, REPORT_DIR)

    if not ids_to_action:
        print("\n✅ Kürasyon tamamlandı. Tüm adaylar testten geçti.")
        return 0, 0

    # Aşama 3 — Uygulama
    if dry_run:
        preview_actions(ids_to_action, mode)

    elif mode == "delete":
        print(f"\n   ⚠️ --delete modu aktif. İnfaz ediliyor...", flush=True)
        await asyncio.sleep(2)
        ok, err = await batch_delete(lesson, ids_to_action, DELETE_LOG)
        print(f"\n   ✅ Silinen: {ok} | Hatalı: {err}")
        print(f"   📋 Detay: {DELETE_LOG}")

    else:
        ok, err = await batch_flag(lesson, ids_to_action, FLAG_LOG)
        print(f"\n   ✅ İşaretlenen: {ok} | Hatalı: {err}")
        print(f"   📋 Detay: {FLAG_LOG}")

    return len(questions), len(ids_to_action)


# ─── CLI Sarmalayıcı ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DUSBANKASI Evrensel Hibrit Üretim Kapısı")
    parser.add_argument("--lesson", required=True)
    parser.add_argument("--delete", action="store_true", help="Kopyaları kalıcı olarak siler")
    parser.add_argument("--dry-run", action="store_true", help="İşlem yapmadan sadece raporlar")
    parser.add_argument("--interactive", action="store_true", help="Her karar için onay ister")
    args = parser.parse_args()

    mode = "delete" if args.delete else "flag"
    
    try:
        total_qs, total_affected = asyncio.run(
            run_audit(args.lesson, mode, args.dry_run, args.interactive)
        )

        action_word = (
            "önizlendi" if args.dry_run
            else ("işaretlendi" if mode == "flag" else "silindi")
        )
        print(f"\n{'='*60}")
        print(f"   PR-GATE TAMAMLANDI")
        print(f"   Total : {total_qs:,} soru tarandı")
        print(f"   {action_word.capitalize()}: {total_affected} soru")
        print(f"{'='*60}\n")
    except KeyboardInterrupt:
        print("\n\n🛑 İşlem kullanıcı tarafından durduruldu.")
    except Exception as e:
        print(f"\n❌ Beklenmedik HATA: {e}")


if __name__ == "__main__":
    main()
