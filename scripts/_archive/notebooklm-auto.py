"""
DUS BANKASI — Ana Üretim Botu (Dual-Prompt Ingestion) v2
=========================================================
Çift Dikiş (Tur 1 + Tur 2) ile ünite ünite soru üretimi.
Shared modüller kullanır: config, shared, fingerprint.

Hata sınıflandırması + exponential backoff + local checkpoint.
"""

import os
import sys
import asyncio
import re
from pathlib import Path
import uuid

# ─── Modül yolu ───
sys.path.insert(0, os.path.dirname(__file__))

from config import LIB_PATH, NOTEBOOK_ID, RETRY_BACKOFF, MAX_RETRIES
from shared import (
    extract_json, deploy_to_supabase, get_existing_units,
    classify_error, RetryableError, AuthError, FatalError
)

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

PROMPT_1 = r"""BU BİR ULTRA-DERİN ARAŞTIRMA TURUDUR (Tur 3).
Sistem ayarlarındaki Master Prompt kuralları aynen geçerlidir.

HEDEF: Daha önceki turlarda üretilen genel bilgilerden (tipik klinik bulgular, en sık görülen yerler vb.) KAÇIN.
Sadece kaynağın en derinlerindeki; spesifik hücre çapları, görülme yüzdeleri (%), nadir sendrom birliktelikleri, en güncel ayırıcı tanı kriterleri ve istisnalara odaklan.
Bu yeni ve dokunulmamış bölgelerden 30 adet yepyeni zorluk hedefli soru üret.
"""

PROMPT_2 = r"""Bu bir 'KAPSAM GENİŞLETMESİ ve DERİNLEMESİ' turudur (Round 2).
Sistem ayarlarındaki Master Prompt kuralları (JSON formatı, zorluk dağılımı, distraktör yazım kuralları vb.) aynen geçerlidir.

BU TURDAKİ ÖNCELİKLERİN (SIRASIYLA):
1. **High-Yield Kurtarma:** İlk turda (Round 1) işlenmiş olan ancak sınav değeri çok yüksek (temel/hayati) kavramları tespit et. Bu "kurucu" bilgileri mutlaka soru havuzuna dahil et.
2. **Kıyaslama ve Tablolar:** Kaynaktaki benzer tabloları, hastalıklar arasındaki ayırıcı farkları ve "X değil Y" dedirten klinik nüansları senaryolaştır.
3. **Mikro-Derinleşme:** High-Yield kapsamı tamamlandıktan sonra, dipnotlarda kalan istatistiksel verilere ve nadir varyantlara odaklan.

ANALİZ PROTOKOLÜ:
<analiz> etiketinde şu iki noktayı özellikle belirt:
- "İlk turda atlanmış olan ve bu turda kurtardığım kritik High-Yield kavramlar: [...]"
- "Henüz dokunulmamış bölge olarak seçtiğim derin detaylar: [...]"

Ardından 30 adet yüksek kaliteli JSON dizisini üret.
"""

# AUDIT: G2 — Hardcode Windows path kaldırıldı, env var'dan oku
# Kullanım: QUEUE_<DERS>_DIR ortam değişkeni tanımla (büyük harf, boşluk _ ile)
# Örnek: QUEUE_PATOLOJI_DIR="C:\...\patoloji\pato ünite pdf\Parcalanmis_Recovery"
def _load_queues_from_env():
    """Tüm QUEUE_<DERS>_DIR env var'larını okur ve QUEUES listesi oluşturur."""
    queues = []
    for key, value in os.environ.items():
        if key.startswith("QUEUE_") and key.endswith("_DIR"):
            lesson = key[len("QUEUE_"):-len("_DIR")].replace("_", " ").title()
            queues.append({"lesson": lesson, "dir": value})
    # Env var tanımlı değilse fallback: sabit liste (geliştirici ortamı için)
    if not queues:
        print("   ⚠️ UYARI: QUEUE_<DERS>_DIR env var bulunamadı. Varsayılan kuyruk kullanılıyor.")
        queues = [
            {
                "lesson": "Patoloji",
                "dir": os.environ.get(
                    "QUEUE_PATOLOJI_DIR",
                    r"C:\Users\FURKAN\Desktop\DUS\patoloji\pato ünite pdf\Parcalanmis_Recovery"
                )
            }
        ]
    return queues

QUEUES = _load_queues_from_env()


async def cleanup_notebook(client, notebook_id):
    """Bulunan tüm dökümanları temizler."""
    sources = await client.sources.list(notebook_id)
    if sources:
        print(f"   Var olan {len(sources)} adet kaynak siliniyor...")
        for src in sources:
            try:
                await client.sources.delete(notebook_id, src.id)
            except Exception as e:
                print(f"   Kaynak silinemedi: {e}")


async def process_unit(client, lesson, unit_name, file_path, include_tur2=True):
    """Tek bir üniteyi işler (Tur 1 + Tur 2). Hata sınıflandırmalı retry."""
    print(f"\n>>> ÜNİTE: {unit_name} İşleniyor...")

    for attempt in range(1, MAX_RETRIES + 1):
        fresh_conv_id = str(uuid.uuid4())
        source = None
        try:
            # 1. Temizlik — AUDIT: K2, hata alırsa WARN bas ama retry'ı iptal etme
            try:
                await cleanup_notebook(client, NOTEBOOK_ID)
            except Exception as cleanup_err:
                print(f"   ⚠️ Cleanup uyarısı (retry devam ediyor): {cleanup_err}")

            # 2. Kaynak yükleme
            print(f"   Kaynak yükleniyor ve indeksleniyor...")
            source = await asyncio.wait_for(
                client.sources.add_file(NOTEBOOK_ID, file_path, wait=True, wait_timeout=1500),
                timeout=1600
            )

            # 3. TUR 1: TEMEL SET
            print("   🧠 Tur 1: Master Prompt iletiliyor...")
            res1 = await asyncio.wait_for(
                client.chat.ask(NOTEBOOK_ID, PROMPT_1, conversation_id=fresh_conv_id),
                timeout=600
            )
            questions1 = extract_json(res1.answer) or []
            print(f"   - Tur 1 tamamlandı: {len(questions1)} soru.")

            # Tur 1 checkpoint
            if questions1:
                print(f"   💾 Tur 1: {len(questions1)} soru kaydediliyor...")
                deploy_to_supabase(questions1, lesson, unit_name)

            if include_tur2:
                # 4. TUR 2: DEEP DIVE
                print("   ⏳ API bağlamı işliyor, 5 saniye bekleniyor...")
                await asyncio.sleep(5)
                print("   🧠 Tur 2: Deep-Dive Prompt iletiliyor...")
                try:
                    res2 = await asyncio.wait_for(
                        client.chat.ask(NOTEBOOK_ID, PROMPT_2, conversation_id=fresh_conv_id),
                        timeout=600
                    )
                    questions2 = extract_json(res2.answer) or []
                    print(f"   - Tur 2 tamamlandı: {len(questions2)} soru.")

                    if questions2:
                        print(f"   💾 Tur 2: {len(questions2)} ek soru kaydediliyor...")
                        deploy_to_supabase(questions2, lesson, unit_name)
                except Exception as e2:
                    print(f"   ⚠️ Tur 2 başarısız (Tur 1 zaten kaydedildi): {e2}")

            # Başarılı → döngüyü kır
            return True

        except Exception as e:
            classified = classify_error(e)

            if isinstance(classified, AuthError):
                print(f"   🔐 Auth hatası: {e}")
                try:
                    await client.refresh_auth()
                    print(f"   🔄 Auth yenilendi, tekrar deneniyor...")
                    continue
                except Exception:
                    print(f"   🚫 Auth yenileme başarısız. Pipeline durduruluyor.")
                    raise FatalError(str(e))

            elif isinstance(classified, RetryableError):
                backoff = RETRY_BACKOFF[min(attempt - 1, len(RETRY_BACKOFF) - 1)]
                print(f"   🔄 Retryable hata (deneme {attempt}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES:
                    print(f"   ⏳ {backoff}s bekleniyor...")
                    await asyncio.sleep(backoff)
                    try:
                        await client.refresh_auth()
                    except:
                        pass
                else:
                    print(f"   🚫 Maksimum deneme aşıldı. Ünite atlanıyor.")
            else:
                print(f"   ❌ Hata: {e}")
                if attempt >= MAX_RETRIES:
                    print(f"   🚫 Ünite atlanıyor.")

        finally:
            # AUDIT: K2 — sadece bu attempt'te oluşturulan source'u sil, source.id None kontrolü ekle
            if source and getattr(source, 'id', None):
                try:
                    await client.sources.delete(NOTEBOOK_ID, source.id)
                except Exception as del_err:
                    print(f"   ⚠️ Source silme uyarısı: {del_err}")

    return False


async def main():
    print("\n" + "=" * 50)
    print("🚀 DUS OTOMASYON MAKİNESİ v2 (ÇOKLU-DERS SAF MOD)")
    print("=" * 50 + "\n")

    async with await NotebookLMClient.from_storage() as client:
        await client.refresh_auth()

        for queue in QUEUES:
            lesson = queue["lesson"]
            target_dir = Path(queue["dir"])

            print(f"\n{'='*50}")
            print(f"📂 KUYRUK: {lesson}")
            print(f"▶ Dizin: {target_dir}")
            print(f"{'='*50}\n")

            if not target_dir.exists():
                print(f"❌ Hedef klasör bulunamadı: {target_dir}")
                continue

            existing_units = get_existing_units(lesson)
            if existing_units:
                print(f"📥 Veritabanında {len(existing_units)} ünite mevcut, atlanacak.")

            files = sorted(
                [f for f in target_dir.iterdir() if f.suffix.lower() in [".pdf", ".md"]],
                key=lambda f: int(re.search(r'\d+', f.name).group()) if re.search(r'\d+', f.name) else 999
            )

            print(f"Sırada {len(files)} ünite var.\n")
            for i, file_path in enumerate(files, 1):
                unit_name = file_path.stem
                # Supabase hedef ünite ismi (Part ekini temizle)
                target_unit = re.sub(r'\s*\(Part \d+\)', '', unit_name)

                # NOT: Yeni Patoloji paketi için toplu üretimde skip mantığı kapatıldı.
                # tur_count = existing_units.get(target_unit, 0)
                # if tur_count > 0:
                #     ...

                print(f"[{i}/{len(files)}]", end=" ")

                try:
                    is_md = file_path.suffix.lower() == ".md"
                    await process_unit(client, lesson, target_unit, file_path, include_tur2=not is_md)
                except FatalError as fe:
                    print(f"\n🚫 FATAL: {fe}. Pipeline durduruluyor.")
                    return

                # Soğuma molası + auth refresh
                print("   🔄 Soğuma molası (20s)...\n")
                await asyncio.sleep(20)
                try:
                    await client.refresh_auth()
                except:
                    pass

    print("\n🎉 TÜM KUYRUKLAR TAMAMLANDI!")


if __name__ == "__main__":
    asyncio.run(main())
