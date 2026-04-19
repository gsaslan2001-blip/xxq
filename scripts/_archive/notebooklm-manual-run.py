import os
import sys
import asyncio
import uuid
import re
from pathlib import Path

# Insert library path
sys.path.insert(0, os.path.dirname(__file__))
from config import LIB_PATH, NOTEBOOK_ID, RETRY_BACKOFF, MAX_RETRIES

if LIB_PATH not in sys.path:
    sys.path.append(LIB_PATH)

try:
    from notebooklm import NotebookLMClient
except ImportError:
    print("HATA: NotebookLM kütüphanesi bulunamadı!")
    sys.exit(1)

from shared import (
    extract_json, deploy_to_supabase, classify_error, 
    RetryableError, AuthError, FatalError
)

# PROMPTS
PROMPT_1 = r"""Defalarca test ettiğimiz ve bu defterin "Sohbeti Yapılandırın (Özel)" ayarlarına yüklenmiş olan DUS Soru Yazarı (Master Prompt) kuralları devrededir.

Lütfen o ayarlardaki TÜM kalite kurallarına, <analiz> protokolüne ve spesifik JSON çıktısına harfiyen uyarak, sadece sana verdiğim bu kaynaktan ilk 30 soruluk ağırlık merkezleri (Batch 1, 2, 3) setini üret.
"""

PROMPT_2 = r"""Bu bir DEVAM TURU'dur (Deep-Dive).
Sistem ayarlarındaki tüm Master Prompt kuralları (JSON formatı, zorluk dağılımı, distraktör yazım kuralları vb.) aynen geçerlidir.

ANCAK ŞUNLARA DİKKAT ET:
1. İlk sette (Az önceki yanıtta) işlenmiş olan ana kavramları BİRİNCİL TEST NESNESİ OLARAK KULLANMA.
2. Sadece kaynağın hiç dokunulmamış bölgelerine, kuytu köşe bilgilerine, tablolara, dipnotlara, istisnalara odaklan.
3. Bu yeni (dokunulmamış) konseptlerden 30 adet yepyeni zorluk hedefli soru üret.

Önce <analiz> etiketinde hangi kavramları elediğini ve hangi yeni kavramları seçtiğini planla, ardından taze JSON dizisini üret.
"""

async def cleanup_notebook(client, notebook_id):
    sources = await client.sources.list(notebook_id)
    if sources:
        print(f"   Bulunan {len(sources)} adet kaynak temizleniyor...")
        for src in sources:
            try:
                await client.sources.delete(notebook_id, src.id)
            except Exception as e:
                print(f"   Hata: {e}")

async def process_manual_file(file_path, lesson, unit_name):
    print(f"\n🚀 [NotebookLM MCP] Manuel İşlem Başlatıldı")
    print(f"📂 Dosya: {file_path}")
    print(f"📚 Ders/Ünite: {lesson} - {unit_name}\n")

    async with await NotebookLMClient.from_storage() as client:
        await client.refresh_auth()

        for attempt in range(1, MAX_RETRIES + 1):
            fresh_conv_id = str(uuid.uuid4())
            source = None
            try:
                # 1. Cleanup
                await cleanup_notebook(client, NOTEBOOK_ID)

                # 2. Add Source
                print(f"   ⏳ Kaynak NotebookLM'e yükleniyor...")
                source = await asyncio.wait_for(
                    client.sources.add_file(NOTEBOOK_ID, file_path, wait=True, wait_timeout=1500),
                    timeout=1600
                )

                # 3. Tur 1
                print("   🧠 Tur 1: Master Prompt iletiliyor...")
                res1 = await asyncio.wait_for(
                    client.chat.ask(NOTEBOOK_ID, PROMPT_1, conversation_id=fresh_conv_id),
                    timeout=600
                )
                questions1 = extract_json(res1.answer) or []
                print(f"   ✅ Tur 1 tamamlandı: {len(questions1)} soru.")

                if questions1:
                    deploy_to_supabase(questions1, lesson, unit_name)

                # 4. Tur 2
                print("   ⏳ Deep-Dive için bekleniyor (5s)...")
                await asyncio.sleep(5)
                print("   🧠 Tur 2: Deep-Dive Prompt iletiliyor...")
                try:
                    res2 = await asyncio.wait_for(
                        client.chat.ask(NOTEBOOK_ID, PROMPT_2, conversation_id=fresh_conv_id),
                        timeout=600
                    )
                    questions2 = extract_json(res2.answer) or []
                    print(f"   ✅ Tur 2 tamamlandı: {len(questions2)} soru.")

                    if questions2:
                        deploy_to_supabase(questions2, lesson, unit_name)
                except Exception as e2:
                    print(f"   ⚠️ Tur 2 başarısız: {e2}")

                return True

            except Exception as e:
                classified = classify_error(e)
                print(f"   ❌ Deneme {attempt} başarısız: {e}")
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(2)
                else:
                    raise e
            finally:
                if source:
                    try:
                        await client.sources.delete(NOTEBOOK_ID, source.id)
                    except:
                        pass

if __name__ == "__main__":
    file_to_process = r"C:\Users\FURKAN\Desktop\DUS\patoloji\output\oral patoloji\1.md"
    lesson = "Patoloji"
    unit = "9.Ünit Oral Patoloji (1)"
    
    asyncio.run(process_manual_file(file_to_process, lesson, unit))
