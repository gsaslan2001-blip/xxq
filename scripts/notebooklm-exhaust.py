"""
DUS BANKASI — Exhaustive Coverage Pipeline v3 (Çapa=Soru)
==========================================================
Mimari:
  FAZ 0: Kavram Çapalama → Kaynaktaki tüm test edilebilir kavramları listeler
  FAZ 1: Python kavramları 25'lik dilimlere böler
  FAZ 2: Her dilim YENİ conversation'la gönderilir. Prompt kısa:
         sadece kavram listesi. Master Prompt zaten kalite kurallarını halleder.
  FAZ 3: Post-batch analiz → hangi çapalar sorgulandı?
  FAZ 4: Kalan çapalar bir sonraki dilime eklenir. Tüm çapalar bitene kadar.

Kullanım:
  python scripts/notebooklm-exhaust.py --file "konu.pdf" --lesson Fizyoloji --dry-run
  python scripts/notebooklm-exhaust.py --file "konu.pdf" --lesson Fizyoloji --unit DENEME
"""

import os
import sys
import asyncio
import re
import argparse
import uuid
from pathlib import Path
from datetime import datetime

# ─── Modül yolu ───
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "tools"))

from config import (
    LIB_PATH, NOTEBOOK_ID, RETRY_BACKOFF, MAX_RETRIES,
    COOLDOWN_BETWEEN_UNITS, PROMPT_CHAR_LIMIT,
    MAX_BATCHES_PER_UNIT, SATURATION_THRESHOLD,
    MIN_ACCEPTED_PER_BATCH, INTER_BATCH_COOLDOWN,
)
from shared import (
    extract_json, deploy_to_supabase, get_existing_units,
    get_questions_for_unit,
    classify_error, RetryableError, AuthError, FatalError,
)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "tools"))
from smart_audit_pipeline import run_audit

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

LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# Her dilimde modele gönderilecek kavram sayısı
CHUNK_SIZE = 25


# ═══════════════════════════════════════════════
#  PROMPTLAR — KISA ve ÖNCÜL
# ═══════════════════════════════════════════════

PROMPT_ANCHOR = r"""SEN BİR TARAMA MOTORUSUN. Görevin soru üretmek DEĞİL, taramak ve listelemektir.

Bu kaynağı satır satır tara. İçerdiği her bağımsız test edilebilir kavramı
(terim, enzim, patoloji, hücre, kural, mekanizma, istisna, sayısal değer, tablo satırı, sendrom, ilaç, reseptör)
numaralı liste halinde alt alta yaz.

KURALLAR:
- Benzer görünen iki kavram (ör: Karyoliz / Karyoreksis) → her biri AYRI satır.
- Her satır MAX 12 kelime. Açıklama yapma, sadece kavram adını/kısa tanımını yaz.
- Sentez, yorum veya klinik bağlantı YAPMA.
- Sadece bu kaynakta bulunan kavramları listele, dış bilgi YASAK.
- Tablolardaki her satırı ayrı kavram olarak say.

Listeleme tamamlandıktan sonra şunu yaz:
TOPLAM_KAVRAM = <sayı>
"""

# İlk batch: Master Prompt'un kendi ağırlık merkezleri
PROMPT_BATCH_1 = r"""Sistem ayarlarındaki Master Prompt kuralları aynen geçerlidir.

Lütfen o ayarlardaki TÜM kalite kurallarına, <analiz> protokolüne ve spesifik JSON çıktısına harfiyen uyarak, sadece sana verdiğim bu kaynaktan ilk 30 soruluk ağırlık merkezleri (Batch 1, 2, 3) setini üret.
"""

# Sonraki batch'ler: SADECE kavram listesi + minimal yönerge
# Master Prompt zaten tüm format/kalite kurallarını hallediyor
PROMPT_CHUNK_TEMPLATE = r"""ÇAPA MODU — Batch {BATCH_NUM}

Aşağıdaki kavramları birincil test nesnesi olarak sorgula. Her kavram en az bir sorunun BİRİNCİL konusu olmalı. Listedeki tüm kavramları kapsamaya çalış:

{KAVRAM_LISTESI}

Master Prompt kuralları (JSON formatı, zorluk dağılımı, analiz protokolü) aynen geçerlidir.
"""


# ═══════════════════════════════════════════════
#  ÇAPA PARSE & ANALİZ
# ═══════════════════════════════════════════════

def parse_anchor_response(text):
    """Çapa yanıtından kavram listesi ve toplam sayı çıkarır."""
    if not text or not text.strip():
        return [], 0

    lines = []
    for line in text.split('\n'):
        line = line.strip()
        if re.match(r'^\d+[\.)\-]\s+', line):
            concept = re.sub(r'^\d+[\.)\-]\s+', '', line).strip()
            if concept and len(concept) > 2:
                lines.append(concept)

    total_match = re.search(r'TOPLAM_KAVRAM\s*=\s*(\d+)', text)
    reported_total = int(total_match.group(1)) if total_match else len(lines)

    return lines, reported_total


def classify_anchors(anchors, questions):
    """
    Her çapayı soruların KÖKLERİ üzerinden kontrol eder.
    Şıklar (option_a..e) SAYILMAZ — sadece soru kökü + açıklama.

    Bir çapa "sorgulanmış" sayılır eğer çapadaki anlamlı kelimelerin
    (3+ karakter) %60+'ı herhangi bir sorunun kökünde geçiyorsa.

    Returns: (covered: list[str], uncovered: list[str])
    """
    if not anchors:
        return [], []
    if not questions:
        return [], list(anchors)

    # Sadece soru kökleri + açıklamalar (şıklar HARİÇ!)
    stem_corpus = ""
    for q in questions:
        stem = (q.get("question", "") or "").lower()
        explanation = (q.get("explanation", "") or "").lower()
        stem_corpus += " " + stem + " " + explanation

    covered = []
    uncovered = []

    for anchor in anchors:
        words = [w.lower() for w in anchor.split() if len(w) >= 3]
        if not words:
            uncovered.append(anchor)
            continue

        match_count = sum(1 for w in words if w in stem_corpus)
        match_ratio = match_count / len(words)

        if match_ratio >= 0.60:
            covered.append(anchor)
        else:
            uncovered.append(anchor)

    return covered, uncovered


def chunk_list(lst, size):
    """Listeyi belirli boyutta dilimlere ayırır."""
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def check_saturation(response_text):
    """Model 'DOYGUNLUK' bildirdi mi kontrol eder."""
    if not response_text:
        return False
    return "DOYGUNLUK" in response_text.upper()


# ═══════════════════════════════════════════════
#  NOTEBOOK TEMİZLİK
# ═══════════════════════════════════════════════

async def cleanup_notebook(client, notebook_id):
    """Bulunan tüm kaynakları temizler."""
    sources = await client.sources.list(notebook_id)
    if sources:
        print(f"   🧹 {len(sources)} adet kaynak siliniyor...")
        for src in sources:
            try:
                await client.sources.delete(notebook_id, src.id)
            except Exception as e:
                print(f"   Kaynak silinemedi: {e}")


# ═══════════════════════════════════════════════
#  ANA İŞLEM: TEK ÜNİTE EXHAUSTIVE v3
# ═══════════════════════════════════════════════

async def process_unit_exhaustive(client, lesson, unit_name, file_path, dry_run=False):
    """Tek bir üniteyi Çapa=Soru modunda işler."""
    print(f"\n{'='*60}")
    print(f"🔬 EXHAUSTIVE v3: {unit_name}")
    print(f"📂 Kaynak: {file_path}")
    print(f"{'='*60}")

    source = None
    total_produced = 0
    batch_results = []

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # ─── 0. Temizlik & Kaynak Yükleme ───
            try:
                await cleanup_notebook(client, NOTEBOOK_ID)
            except Exception as cleanup_err:
                print(f"   ⚠️ Cleanup uyarısı: {cleanup_err}")

            print(f"   📤 Kaynak yükleniyor ve indeksleniyor...")
            source = await asyncio.wait_for(
                client.sources.add_file(NOTEBOOK_ID, file_path, wait=True, wait_timeout=1500),
                timeout=1600
            )
            print(f"   ✅ Kaynak hazır: {source.id}")

            # ─── FAZ 0: Kavram Çapalama ───
            print(f"\n   📌 FAZ 0: Kavram Çapalama")
            anchor_conv_id = str(uuid.uuid4())
            anchor_res = await asyncio.wait_for(
                client.chat.ask(NOTEBOOK_ID, PROMPT_ANCHOR, conversation_id=anchor_conv_id),
                timeout=600
            )
            anchors, total_concepts = parse_anchor_response(anchor_res.answer)
            print(f"   📌 Çapalama tamamlandı: {total_concepts} kavram (parse: {len(anchors)})")

            if not anchors:
                print(f"   ⚠️ Çapalama başarısız — ünite atlanıyor.")
                return False

            # Çapa logunu kaydet
            try:
                with open(os.path.join(LOG_DIR, f"anchor_{unit_name}.txt"), 'w', encoding='utf-8') as f:
                    f.write(f"Toplam: {total_concepts}\nParse: {len(anchors)}\n\n")
                    for i, a in enumerate(anchors, 1):
                        f.write(f"{i}. {a}\n")
            except:
                pass

            # ─── FAZ 1: Mevcut DB ile çapa kontrolü ───
            session_qs = get_questions_for_unit(lesson, unit_name)
            initial_db_count = len(session_qs)
            print(f"   📥 Supabase'de mevcut: {initial_db_count} soru")

            # Zaten sorgulanmış çapaları hesapla
            already_covered, remaining_anchors = classify_anchors(anchors, session_qs)
            print(f"   📊 Başlangıç durumu: {len(already_covered)} sorgulanmış / {len(remaining_anchors)} kalan")

            # ─── FAZ 2: Batch 1 — Master Prompt'un doğal ağırlık merkezleri ───
            batch_num = 0
            consecutive_dry = 0

            if initial_db_count == 0:
                batch_num = 1
                print(f"\n   ┌─ BATCH 1/{MAX_BATCHES_PER_UNIT} (Ağırlık Merkezleri) ────")
                print(f"   │  Master Prompt ile ilk 30 soru üretiliyor...")

                conv_id = str(uuid.uuid4())
                res = await asyncio.wait_for(
                    client.chat.ask(NOTEBOOK_ID, PROMPT_BATCH_1, conversation_id=conv_id),
                    timeout=600
                )

                new_questions = extract_json(res.answer) or []
                print(f"   │  📦 Üretilen: {len(new_questions)} soru")

                # Log
                try:
                    with open(os.path.join(LOG_DIR, f"exhaust_{unit_name}_batch1.txt"), 'w', encoding='utf-8') as f:
                        f.write(f"Batch: 1 (Master)\nQuestions: {len(new_questions)}\n\n--- ANSWER ---\n")
                        f.write(res.answer or '(empty)')
                except:
                    pass

                if new_questions:
                    session_qs.extend(new_questions)
                    total_produced += len(new_questions)

                    if dry_run:
                        print(f"   │  🧪 DRY-RUN: {len(new_questions)} soru yazılmadı.")
                    else:
                        deploy_to_supabase(new_questions, lesson, unit_name)

                    # Post-batch çapa durumu
                    covered_now, remaining_anchors = classify_anchors(anchors, session_qs)
                    print(f"   │  📊 {len(covered_now)}/{len(anchors)} çapa sorgulandı, kalan: {len(remaining_anchors)}")
                    batch_results.append((1, len(new_questions), "OK"))
                else:
                    consecutive_dry += 1
                    batch_results.append((1, 0, "BOŞ"))

                print(f"   └──────────────────────────────────────")

            # ─── FAZ 3: Dilim bazlı üretim (kalan çapaları hedefle) ───
            if remaining_anchors and consecutive_dry < SATURATION_THRESHOLD:
                # Kalan çapaları CHUNK_SIZE'lık dilimlere böl
                chunks = list(chunk_list(remaining_anchors, CHUNK_SIZE))
                print(f"\n   🎯 FAZ 3: {len(remaining_anchors)} kalan çapa → {len(chunks)} dilim ({CHUNK_SIZE}'lik)")

                for chunk_idx, chunk in enumerate(chunks):
                    if consecutive_dry >= SATURATION_THRESHOLD:
                        print(f"   ⚠️ Doygunluk eşiği ({SATURATION_THRESHOLD} ardışık boş). Durduruluyor.")
                        break

                    if batch_num >= MAX_BATCHES_PER_UNIT:
                        print(f"   ⚠️ Maks batch limiti ({MAX_BATCHES_PER_UNIT}). Durduruluyor.")
                        break

                    batch_num += 1
                    print(f"\n   ┌─ BATCH {batch_num}/{MAX_BATCHES_PER_UNIT} (Dilim {chunk_idx+1}/{len(chunks)}) ────")
                    print(f"   │  Hedef kavramlar: {len(chunk)} adet")

                    # Kavram listesini oluştur
                    kavram_str = "\n".join(f"- {c}" for c in chunk)
                    prompt = PROMPT_CHUNK_TEMPLATE.replace("{BATCH_NUM}", str(batch_num))
                    prompt = prompt.replace("{KAVRAM_LISTESI}", kavram_str)

                    print(f"   │  Prompt: {len(prompt)} char")

                    # Yeni conversation ile gönder
                    conv_id = str(uuid.uuid4())
                    print(f"   │  🧠 NotebookLM'e gönderiliyor...")

                    res = await asyncio.wait_for(
                        client.chat.ask(NOTEBOOK_ID, prompt, conversation_id=conv_id),
                        timeout=600
                    )

                    # Doygunluk kontrolü
                    if check_saturation(res.answer):
                        print(f"   │  🏁 Model DOYGUNLUK bildirdi.")
                        batch_results.append((batch_num, 0, "DOYGUNLUK"))
                        break

                    new_questions = extract_json(res.answer) or []
                    print(f"   │  📦 Üretilen: {len(new_questions)} soru")

                    # Log
                    try:
                        log_path = os.path.join(LOG_DIR, f"exhaust_{unit_name}_batch{batch_num}.txt")
                        with open(log_path, 'w', encoding='utf-8') as f:
                            f.write(f"Batch: {batch_num}\nChunk: {chunk_idx+1}/{len(chunks)}\n")
                            f.write(f"Targets: {len(chunk)}\nQuestions: {len(new_questions)}\n\n")
                            f.write("--- TARGETS ---\n")
                            for c in chunk:
                                f.write(f"- {c}\n")
                            f.write("\n--- ANSWER ---\n")
                            f.write(res.answer or '(empty)')
                    except:
                        pass

                    if not new_questions:
                        consecutive_dry += 1
                        ans_len = len(res.answer) if res.answer else 0
                        print(f"   │  ⚠️ 0 soru (answer={ans_len} char, boş: {consecutive_dry}/{SATURATION_THRESHOLD})")
                        batch_results.append((batch_num, 0, "BOŞ"))
                        print(f"   └──────────────────────────────────────")
                        await asyncio.sleep(INTER_BATCH_COOLDOWN)
                        continue

                    # Başarılı batch
                    consecutive_dry = 0
                    session_qs.extend(new_questions)
                    total_produced += len(new_questions)

                    if dry_run:
                        print(f"   │  🧪 DRY-RUN: {len(new_questions)} soru yazılmadı.")
                        for i, q in enumerate(new_questions[:2], 1):
                            print(f"   │     {i}. {(q.get('question',''))[:80]}...")
                    else:
                        deploy_to_supabase(new_questions, lesson, unit_name)

                    # Bu dilimdeki kavramların kaçı sorgulandı?
                    chunk_covered, chunk_uncovered = classify_anchors(chunk, new_questions)
                    print(f"   │  🎯 Dilim kapsam: {len(chunk_covered)}/{len(chunk)} kavram sorgulandı")

                    # Genel durum
                    total_covered, total_remaining = classify_anchors(anchors, session_qs)
                    print(f"   │  📊 Genel: {len(total_covered)}/{len(anchors)} çapa ✅, kalan: {len(total_remaining)}")

                    batch_results.append((batch_num, len(new_questions), "OK"))
                    print(f"   └──────────────────────────────────────")

                    # Kalan çapa var mı?
                    if len(total_remaining) == 0:
                        print(f"\n   🎯 TÜM {len(anchors)} ÇAPA SORGULANMIŞ!")
                        break

                    # Cooldown
                    await asyncio.sleep(INTER_BATCH_COOLDOWN)

            # ─── FAZ 4: Rapor ───
            final_covered, final_uncovered = classify_anchors(anchors, session_qs)
            print(f"\n   {'='*50}")
            print(f"   📊 ÜNİTE RAPORU: {unit_name}")
            print(f"   {'='*50}")
            print(f"   Çapalanan kavram       : {len(anchors)}")
            print(f"   Sorgulanmış kavram     : {len(final_covered)} ✅")
            print(f"   Sorgulanmamış kavram   : {len(final_uncovered)} ⏳")
            if anchors:
                print(f"   Kapsam oranı           : {len(final_covered)/len(anchors)*100:.1f}%")
            print(f"   Üretim turları         : {batch_num}")
            print(f"   Toplam üretilen        : {total_produced} soru")
            for bn, produced, status in batch_results:
                print(f"     Batch {bn}: {produced} üretildi → {status}")

            if final_uncovered:
                print(f"\n   ⏳ SORGULANMAMIŞ ({len(final_uncovered)}):")
                for i, a in enumerate(final_uncovered[:25], 1):
                    print(f"      {i}. {a}")
                if len(final_uncovered) > 25:
                    print(f"      ...ve {len(final_uncovered)-25} kavram daha")

            # Sorgulanmamış kavramları dosyaya kaydet
            try:
                with open(os.path.join(LOG_DIR, f"uncovered_{unit_name}.txt"), 'w', encoding='utf-8') as f:
                    f.write(f"Ünite: {unit_name}\nÇapalanan: {len(anchors)}\n")
                    f.write(f"Sorgulanmış: {len(final_covered)}\nKalan: {len(final_uncovered)}\n\n")
                    for i, a in enumerate(final_uncovered, 1):
                        f.write(f"{i}. {a}\n")
            except:
                pass

            print(f"   {'='*50}")
            return True

        except Exception as e:
            classified = classify_error(e)

            if isinstance(classified, AuthError):
                print(f"   🔐 Auth hatası: {e}")
                try:
                    await client.refresh_auth()
                    continue
                except Exception:
                    raise FatalError(str(e))

            elif isinstance(classified, RetryableError):
                backoff = RETRY_BACKOFF[min(attempt - 1, len(RETRY_BACKOFF) - 1)]
                print(f"   🔄 Hata (deneme {attempt}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES:
                    print(f"   ⏳ {backoff}s bekleniyor...")
                    await asyncio.sleep(backoff)
                    try: await client.refresh_auth()
                    except: pass
                else:
                    print(f"   🚫 Maks deneme aşıldı. Ünite atlanıyor.")
            else:
                print(f"   ❌ Hata: {e}")
                if attempt >= MAX_RETRIES:
                    print(f"   🚫 Ünite atlanıyor.")

        finally:
            if source and getattr(source, 'id', None):
                try: await client.sources.delete(NOTEBOOK_ID, source.id)
                except Exception as del_err:
                    print(f"   ⚠️ Source silme: {del_err}")

    return False


# ═══════════════════════════════════════════════
#  KUYRUK YÖNETİMİ
# ═══════════════════════════════════════════════

def _load_queues_from_env():
    queues = []
    for key, value in os.environ.items():
        if key.startswith("QUEUE_") and key.endswith("_DIR"):
            lesson = key[len("QUEUE_"):-len("_DIR")].replace("_", " ").title()
            queues.append({"lesson": lesson, "dir": value})
    return queues


async def main():
    parser = argparse.ArgumentParser(description="DUS Bankası — Exhaustive v3")
    parser.add_argument("--file", default=None, help="Tek dosya işle")
    parser.add_argument("--lesson", default=None, help="Ders adı")
    parser.add_argument("--unit", default=None, help="Ünite adı")
    parser.add_argument("--dry-run", action="store_true", help="Supabase'e yazmadan test")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("🚀 DUS OTOMASYON — EXHAUSTIVE v3 (Çapa=Soru)")
    print(f"   Mod: {'🧪 DRY-RUN' if args.dry_run else '🔴 CANLI'}")
    print(f"   Dilim boyutu: {CHUNK_SIZE} kavram/batch")
    print("=" * 60)

    async with await NotebookLMClient.from_storage() as client:
        await client.refresh_auth()

        if args.file:
            file_path = Path(args.file)
            if not file_path.exists():
                print(f"❌ Dosya bulunamadı: {file_path}")
                return
            lesson = args.lesson or "Bilinmeyen"
            unit_name = args.unit if args.unit else file_path.stem
            try:
                await process_unit_exhaustive(client, lesson, unit_name, file_path, args.dry_run)
                # Üretim bittiğinde otomatik Audit (Toplu Temizlik) başlatılır
                if not args.dry_run:
                    print(f"\n   🚀 Ünite bitti: {unit_name} için otomatik kalite denetimi (Audit) başlatılıyor...")
                    await run_audit(lesson, mode="flag", dry_run=False, interactive=False)
            except FatalError as fe:
                print(f"\n🚫 FATAL: {fe}")
            return

        queues = _load_queues_from_env()
        if not queues:
            print("❌ QUEUE_<DERS>_DIR env var bulunamadı ve --file belirtilmedi.")
            return

        for queue in queues:
            lesson = queue["lesson"]
            target_dir = Path(queue["dir"])
            if not target_dir.exists():
                print(f"❌ Klasör bulunamadı: {target_dir}")
                continue

            files = sorted(
                [f for f in target_dir.iterdir() if f.suffix.lower() in [".pdf", ".md"]],
                key=lambda f: int(re.search(r'\d+', f.name).group()) if re.search(r'\d+', f.name) else 999
            )

            print(f"\n📂 {lesson}: {len(files)} dosya")

            for i, file_path in enumerate(files, 1):
                unit_name = file_path.stem
                print(f"\n[{i}/{len(files)}]", end=" ")
                try:
                    await process_unit_exhaustive(client, lesson, unit_name, file_path, args.dry_run)
                    # Kuyruk modunda her üniteden sonra toplu temizlik (tüm ders taraması)
                    if not args.dry_run:
                        print(f"\n   🚀 Ünite bitti: {unit_name} için otomatik kalite denetimi (Audit) başlatılıyor...")
                        await run_audit(lesson, mode="flag", dry_run=False, interactive=False)
                except FatalError as fe:
                    print(f"\n🚫 FATAL: {fe}")
                    return

                if i < len(files):
                    await asyncio.sleep(COOLDOWN_BETWEEN_UNITS)
                    try: await client.refresh_auth()
                    except: pass

    print("\n🎉 TAMAMLANDI!")


if __name__ == "__main__":
    asyncio.run(main())
