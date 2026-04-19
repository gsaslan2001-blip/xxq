import os
import sys
import asyncio
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path
import uuid

# Kütüphane Yolu
LIB_PATH = r"C:\Users\FURKAN\Desktop\notebooklm-py-main\src"
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

# --- AYARLAR VE KUYRUK ---
NOTEBOOK_ID = "a6570b2e-36e5-4a84-8438-8460ad0329f8"
SUPABASE_URL = "https://vblndoyjmkgaeuihydyd.supabase.co"
SUPABASE_KEY = "sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3"

QUEUES = [
    {
        "lesson": "Radyoloji",
        "dir": r"C:\Users\FURKAN\Desktop\DUS\Radyoloji\Yeni klasör\Parcalanmis"
    }
]

# 7. ünitede kaldık — 1-6 arası Supabase'de zaten var, skip edilecek.

def get_existing_units(lesson_name):
    """Hangi ünitelerin zaten Supabase'de olduğunu öğrenir."""
    url = f"{SUPABASE_URL}/rest/v1/questions?select=unit&lesson=eq.{urllib.parse.quote(lesson_name)}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())
            return set([d.get('unit') for d in data if d.get('unit')])
    except Exception as e:
        print(f"Mevcut üniteler alınırken hata: {e}")
        return set()

def extract_json(text):
    """Regex ile JSON bloğunu çeker."""
    def clean_and_parse(json_str):
        # trailing comma fix
        json_str = re.sub(r',\s*([\]}])', r'\1', json_str)
        return json.loads(json_str)

    try:
        match = re.search(r'```json\n([\s\S]*?)\n```', text)
        if match: return clean_and_parse(match.group(1).strip())
        match = re.search(r'\[\s*\{[\s\S]*\}\s*\]', text)
        if match: return clean_and_parse(match.group(0).strip())
    except Exception as e:
        print(f"JSON Parse Hatası: {e}")
    return None

def deploy_to_supabase(questions, lesson_name, unit_name):
    url = f"{SUPABASE_URL}/rest/v1/questions"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    
    rows = []
    for q in questions:
        rows.append({
            "lesson": lesson_name,
            "unit": unit_name,
            "question": q.get("question"),
            "option_a": q.get("options", {}).get("A"),
            "option_b": q.get("options", {}).get("B"),
            "option_c": q.get("options", {}).get("C"),
            "option_d": q.get("options", {}).get("D"),
            "option_e": q.get("options", {}).get("E"),
            "correct_answer": q.get("correctAnswer"),
            "explanation": q.get("explanation")
        })

    data = json.dumps(rows).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req) as response:
            print(f"✅ Supabase Kayıt Başarılı! (Status: {response.getcode()})")
    except Exception as e:
        print(f"❌ Supabase Hatası: {e}")

async def cleanup_notebook(client, notebook_id):
    """Bulunan tüm dökümanları temizler."""
    sources = await client.sources.list(notebook_id)
    if sources:
        print(f"Var olan {len(sources)} adet kaynak siliniyor... (Önceki kalıntılar)")
        for src in sources:
            try: await client.sources.delete(notebook_id, src.id)
            except Exception as e: print(f"Kaynak silinemedi: {e}")

async def main():
    print("\n" + "="*50)
    print("🚀 DUS OTOMASYON MAKİNESİ (ÇOKLU-DERS SAF MOD)")
    print("="*50 + "\n")

    async with await NotebookLMClient.from_storage() as client:
        await client.refresh_auth()

        for queue in QUEUES:
            lesson = queue["lesson"]
            target_dir = Path(queue["dir"])
            
            print(f"\n==============================================")
            print(f"📂 KUYRUK BAŞLIYOR: DERS -> {lesson}")
            print(f"▶ Dizin: {target_dir}")
            print(f"==============================================\n")
            
            if not target_dir.exists():
                print(f"❌ HATA: Hedef klasör bulunamadı: {target_dir}\nSıradaki derse geçiliyor.")
                continue

            existing_units = get_existing_units(lesson)
            if existing_units:
                print(f"📥 Veritabanında {lesson} için hali hazırda tespit edilen {len(existing_units)} ünite atlanacak.")
            else:
                print(f"📥 Veritabanında {lesson} için hiç ünite bulunamadı. Tam listeye başlanıyor.")

            files = sorted([f for f in target_dir.iterdir() if f.suffix.lower() == ".pdf"])
            files.sort(key=lambda f: int(re.search(r'\d+', f.name).group()) if re.search(r'\d+', f.name) else 999)

            print(f"\nSırada Toplam {len(files)} Ünite Var. Üretim Başlatılıyor...\n")

            for i, file_path in enumerate(files, 1):
                unit_name = file_path.stem
                
                if unit_name in existing_units:
                    print(f"⏭️ {unit_name} ÜNİTESİ ZATEN MEVCUT (SKIPPED).")
                    continue
                
                print(f">>> ÜNİTE [{i}/{len(files)}]: {unit_name} İşleniyor...")
                
                # Ağ hatalarına karşı kilitlenme kalkanı (Retry) Loop
                max_retries = 3
                for attempt in range(1, max_retries + 1):
                    fresh_conv_id = str(uuid.uuid4())
                    source = None
                    try:
                        # 1. Saf Temizlik
                        await cleanup_notebook(client, NOTEBOOK_ID)
                        
                        # 2. Yükleme ve Analiz Beklemesi
                        print(f"Kaynak yükleniyor ve indeksleniyor...")
                        source = await asyncio.wait_for(
                            client.sources.add_file(NOTEBOOK_ID, file_path, wait=True, wait_timeout=1500),
                            timeout=1600
                        )
                        
                        # 3. YALIN KOMUT
                        print("🧠 Master Prompt iletiliyor: 'doğrudan soruları gönder'...")
                        res = await asyncio.wait_for(
                            client.chat.ask(NOTEBOOK_ID, "doğrudan soruları gönder", conversation_id=fresh_conv_id),
                            timeout=600
                        )
                        answer = res.answer

                        # 4. JSON Ayıklama ve Kayıt
                        questions = extract_json(answer)
                        if questions:
                            print(f"🎯 {len(questions)} Soru Çekildi. Veritabanına aktarılıyor...")
                            deploy_to_supabase(questions, lesson, unit_name)
                        else:
                            print(f"⚠️ DİKKAT: JSON yakalanamadı. Yanıt metin olarak kaydediliyor.")
                            error_file = f"scripts/error_safmod_{lesson}_{unit_name}.txt"
                            with open(error_file, "w", encoding="utf-8") as f:
                                f.write(answer)

                        # Başarılı olursa döngüyü kır
                        break

                    except Exception as e:
                        print(f"❌ DENEME {attempt} BAŞARISIZ. Hata: {e}")
                        if attempt < max_retries:
                            print("📡 İnternet kopması tespit edildi. Ağın toparlanması için 60 saniye bekleniyor...")
                            await asyncio.sleep(60)
                            try: await client.refresh_auth()
                            except: pass
                        else:
                            print("🚫 MAKSİMUM DENEME SINIRI AŞILDI. Bu ünite KESİN olarak atlanıyor.")
                    
                    finally:
                        if source:
                            try: await client.sources.delete(NOTEBOOK_ID, source.id)
                            except: pass

                print("🔄 Soğuma molası (20 saniye)...\n")
                await asyncio.sleep(20)
                try:
                    await client.refresh_auth()
                except Exception as e:
                    pass

    print("\n🎉 TÜM KUYRUKLAR BAŞARIYLA TAMAMLANDI VE VERİTABANINA AKTARILDI!")

if __name__ == "__main__":
    asyncio.run(main())
