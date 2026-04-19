"""
DUS BANKASI — Geriye Dönük Genişletme Modu (Context-Aware Expansion) v2
========================================================================
Kullanım:
  python notebooklm-expand.py --lesson Radyoloji --dry-run
  python notebooklm-expand.py --lesson Patoloji --unit "Kemik Hastalıkları"
  python notebooklm-expand.py --lesson Endodonti --backup-file backup.json

Claude Opus 4.6 Mimari Analizi doğrultusunda refactored:
  - Hata sınıflandırması (Retryable / Auth / Data / Fatal)
  - Exponential backoff (30s → 60s → 120s)
  - Session refresh her ünite arasında
  - Supabase write öncesi local JSON checkpoint
  - Partial JSON repair
  - Tiered fingerprint compression
  - Select projeksiyon (bandwidth optimizasyonu)
"""

import os
import sys
import asyncio
import json
import argparse

# ─── Kütüphane Yolu ───
sys.path.insert(0, os.path.dirname(__file__))

from config import LIB_PATH, NOTEBOOK_ID, COOLDOWN_BETWEEN_UNITS, RETRY_BACKOFF, MAX_RETRIES, PROMPT_CHAR_LIMIT

if LIB_PATH not in sys.path:
    sys.path.append(LIB_PATH)

try:
    from notebooklm import NotebookLMClient
except ImportError:
    print("HATA: NotebookLM kütüphanesi bulunamadı!")
    sys.exit(1)

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

from shared import (
    extract_json, deploy_to_supabase, get_existing_units,
    get_questions_for_unit,
    classify_error, RetryableError, AuthError, DataError, FatalError,
    save_checkpoint, replay_pending_checkpoints
)
from fingerprint import build_fingerprint_list


# ─── PROMPT ───
PROMPT_EXPAND_TEMPLATE = r"""DİKKAT: Sistem ayarlarındaki DUS Soru Yazarı Master Prompt kuralları (zorluk dağılımı, Bloom taksonomisi, distraktör yazım kuralları, JSON formatı) YÜZDE YÜZ GEÇERLİDİR.

Bu bir GENİŞLETME TURU'dur. Aşağıda, bu kaynaktan daha önce üretilmiş soruların KAVRAM LİSTESİ verilmiştir. Her satır bir sorunun test ettiği ana mekanizmayı temsil eder:

---YASAKLI KAVRAM HARİTASI---
{FINGERPRINTS}
---YASAKLI KAVRAM HARİTASI SONU---

MUTLAK KURALLAR:
1. Yukarıdaki listedeki HER kavram DOKUNULMAZDIR. Bu kavramları birincil test nesnesi olarak kullanmak YASAK. "Farklı açıdan sormak" DAHİL YASAK.
2. Kaynağı baştan sona yeniden tara. SADECE listede ADI GEÇMEYEN yapı, mekanizma, istisna, tablo satırı ve nadir bulguları hedefle.
3. Öncelikli hedefler: (a) Tabloların hiç sorulmamış satırları, (b) "...hariç/dışında" istisna bilgileri, (c) Nadir sendrom/varyant/atipik prezentasyonlar, (d) Mekanizma zincirinin atlanan ara basamakları, (e) Çoklu veri entegrasyonları.
4. SAYISAL ZORLAMA YOK. Nitelikli soru çıkarılacak alan kalmadıysa bunu bildir ve 0 soru ver. Potansiyel zenginse 30'a kadar çık.
5. Üretilen her soru %100 kaynak metninden türetilmeli. Genel tıp bilgisi ekleme YASAK.

Önce <analiz> etiketinde kapsam denetimi yap, sonra JSON dizisini üret."""


# ═══════════════════════════════════════════════
#  ANA İŞ AKIŞI
# ═══════════════════════════════════════════════

async def expand_unit(client, lesson, unit_name, existing_questions, dry_run=False):
    """Tek bir ünitenin genişletme turunu çalıştırır (retry + error classification)."""
    print(f"\n{'='*60}")
    print(f"🔬 GENİŞLETME: {unit_name} ({len(existing_questions)} mevcut soru)")
    print(f"{'='*60}")

    # 1. Kavram parmak izlerini üret
    fingerprints = build_fingerprint_list(existing_questions)

    # 2. Prompt boyutunu kontrol et
    prompt = PROMPT_EXPAND_TEMPLATE.replace("{FINGERPRINTS}", fingerprints)
    print(f"   📝 Prompt boyutu: {len(prompt)} karakter")

    if len(prompt) > PROMPT_CHAR_LIMIT:
        print(f"   ⚠️ Prompt {len(prompt)} karakter! Limit aşıldı → ünite atlanıyor.")
        return 0

    # 3. Retry loop (exponential backoff + error classification)
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"   🧠 NotebookLM'e genişletme promptu gönderiliyor... (Deneme {attempt}/{MAX_RETRIES})")
            conv = await client.chat.new_conversation(NOTEBOOK_ID)
            fresh_conv_id = conv.id if conv else None

            res = await asyncio.wait_for(
                client.chat.ask(NOTEBOOK_ID, prompt, conversation_id=fresh_conv_id),
                timeout=600
            )

            new_questions = extract_json(res.answer) or []
            print(f"   📦 Yanıt: {len(new_questions)} yeni soru üretildi.")

            if not new_questions:
                print(f"   ℹ️ Model bu kaynakta ek soru bulamadı. (0 soru)")
                return 0

            # Dry-run kontrolü
            if dry_run:
                print(f"   🧪 DRY-RUN: Supabase'e yazılmadı. İlk 2 soru önizleme:")
                for i, q in enumerate(new_questions[:2], 1):
                    print(f"      {i}. {(q.get('question',''))[:100]}...")
                return len(new_questions)

            # Gerçek yazma (checkpoint dahil)
            deploy_to_supabase(new_questions, lesson, unit_name)
            return len(new_questions)

        except Exception as e:
            classified = classify_error(e)

            if isinstance(classified, AuthError):
                print(f"   🔐 Auth hatası: {e}")
                try:
                    await client.refresh_auth()
                    print(f"   🔄 Auth yenilendi, tekrar deneniyor...")
                    continue  # Tek retry
                except Exception:
                    print(f"   🚫 Auth yenileme başarısız. Pipeline durduruluyor.")
                    raise FatalError(str(e))

            elif isinstance(classified, RetryableError):
                backoff = RETRY_BACKOFF[min(attempt - 1, len(RETRY_BACKOFF) - 1)]
                print(f"   🔄 Retryable hata (deneme {attempt}): {e}")
                if attempt < MAX_RETRIES:
                    print(f"   ⏳ {backoff}s bekleniyor...")
                    await asyncio.sleep(backoff)
                else:
                    print(f"   🚫 Maksimum deneme aşıldı. Ünite atlanıyor.")

            elif isinstance(classified, DataError):
                print(f"   ⚠️ Data hatası: {e}. Ünite atlanıyor.")
                break

            else:  # FatalError
                print(f"   🚫 Fatal hata: {e}. Pipeline durduruluyor.")
                raise

    return 0


async def main():
    parser = argparse.ArgumentParser(description="DUS Bankası — Geriye Dönük Genişletme Modu")
    parser.add_argument("--lesson", required=True, help="Hedef ders adı (örn: Radyoloji, Patoloji)")
    parser.add_argument("--unit", default=None, help="Belirli bir ünite (opsiyonel)")
    parser.add_argument("--dry-run", action="store_true", help="Supabase'e yazmadan test et")
    parser.add_argument("--backup-file", default=None, help="Yerel JSON yedek dosyası (Supabase yerine)")
    parser.add_argument("--min-questions", type=int, default=15, help="Minimum soru eşiği (varsayılan: 15)")
    parser.add_argument("--replay-pending", action="store_true", help="recovery/pending klasöründeki yedekleri Supabase'e geri yükle")
    args = parser.parse_args()

    if args.replay_pending:
        print("🔄 RECOVERY: Bekleyen checkpoint'ler Supabase'e yazılıyor...")
        replay_pending_checkpoints(lesson_filter=args.lesson)
        return

    lesson = args.lesson
    dry_run = args.dry_run

    print("=" * 60)
    print("🚀 DUS BANKASI — GERİYE DÖNÜK GENİŞLETME MODU v2")
    print(f"   Ders: {lesson}")
    print(f"   Ünite filtresi: {args.unit or 'TÜM ÜNİTELER'}")
    print(f"   Kaynak: {'📂 ' + args.backup_file if args.backup_file else '☁️ Supabase'}")
    print(f"   Mod: {'🧪 DRY-RUN (test)' if dry_run else '🔴 CANLI (Supabase yazma aktif)'}")
    print("=" * 60)

    # 1. Mevcut üniteleri ve soruları al
    local_data = []
    if args.backup_file:
        print(f"\n📂 Yerel yedek dosyasından okunuyor: {args.backup_file}")
        try:
            with open(args.backup_file, 'r', encoding='utf-8') as f:
                all_backup = json.load(f)
                local_data = [q for q in all_backup if q.get('lesson') == lesson]
                print(f"   ✓ {lesson} dersine ait {len(local_data)} soru yüklendi.")
        except Exception as e:
            print(f"❌ Yerel dosya okuma hatası: {e}")
            return

    if args.backup_file:
        from collections import Counter
        units = dict(sorted(Counter(q.get('unit') for q in local_data if q.get('unit')).items()))
    else:
        units = get_existing_units(lesson)

    if not units:
        print(f"❌ '{lesson}' dersinde hiç ünite bulunamadı.")
        return

    print(f"\n📋 Bulunan üniteler ({len(units)} adet):")
    for unit, count in units.items():
        marker = "🎯" if count >= args.min_questions else "⏭️"
        print(f"   {marker} [{count:3d} soru] {unit}")

    # Filtreleme
    target_units = {u: c for u, c in units.items()
                    if c >= args.min_questions and (not args.unit or args.unit.lower() in u.lower())}

    if not target_units:
        print(f"\n❌ Kriterlere uyan ünite bulunamadı.")
        return

    print(f"\n🎯 Hedef üniteler: {len(target_units)} adet")

    # 2. NotebookLM bağlantısı
    async with await NotebookLMClient.from_storage() as client:
        total_new = 0
        results = []

        for i, (unit_name, existing_count) in enumerate(target_units.items(), 1):
            print(f"\n[{i}/{len(target_units)}] İşleniyor...")

            # O ünitenin sorularını al
            if args.backup_file:
                existing_qs = [q for q in local_data if q.get('unit') == unit_name]
            else:
                existing_qs = get_questions_for_unit(lesson, unit_name)

            # Genişletme turunu çalıştır
            try:
                new_count = await expand_unit(client, lesson, unit_name, existing_qs, dry_run)
            except FatalError as fe:
                print(f"\n🚫 FATAL: {fe}. Pipeline durduruluyor.")
                break

            total_new += new_count
            results.append((unit_name, existing_count, new_count))

            # Soğuma molası + auth refresh (son ünite hariç)
            if i < len(target_units):
                print(f"   ⏳ Soğuma molası ({COOLDOWN_BETWEEN_UNITS}s)...")
                await asyncio.sleep(COOLDOWN_BETWEEN_UNITS)
                try:
                    await client.refresh_auth()
                except Exception:
                    pass

        # 3. Özet rapor
        print("\n" + "=" * 60)
        print("📊 GENİŞLETME RAPORU")
        print("=" * 60)
        for unit, old, new in results:
            status = f"+{new}" if new > 0 else "değişiklik yok"
            print(f"   [{old:3d} → {old+new:3d}] {unit} ({status})")
        print(f"\n   TOPLAM: +{total_new} yeni soru")
        if dry_run:
            print("   ⚠️ DRY-RUN modu — hiçbir şey Supabase'e yazılmadı.")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
