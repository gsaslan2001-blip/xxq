import os
import sys
import re
import json
import urllib.request
import urllib.parse
from pprint import pprint

# ─── Modül yolu ───
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import SUPABASE_URL, SUPABASE_KEY
from shared import _write_to_supabase, extract_json

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}"
}

# Hangi dersi/üniteyi arayacağımızı anlamak için log isminden:
def db_get_existing_questions(lesson, unit):
    enc_l = urllib.parse.quote(lesson)
    enc_u = urllib.parse.quote(unit)
    url = f"{SUPABASE_URL}/rest/v1/questions?select=question&lesson=eq.{enc_l}&unit=eq.{enc_u}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
            return [row.get("question", "") for row in data]
    except Exception as e:
        print(f"DB okuma hatası {unit}: {e}")
        return []

def main():
    print("\n🚀 DUSBANKASI - SIKIŞMIŞ SORULARI KURTARMA OPERASYONU 🚀\n")
    
    # Tüm exhaust log dosyalarını bul
    files = [f for f in os.listdir(LOG_DIR) if f.startswith("exhaust_") and f.endswith(".txt")]
    
    for fname in sorted(files):
        m = re.match(r"exhaust_(.+)_batch(\d+)\.txt", fname)
        if not m: continue
        
        unit_name = m.group(1).strip()
        path = os.path.join(LOG_DIR, fname)
        
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            
        parsed_questions = extract_json(content)
        
        # Filter purely structurally (simple)
        valid_qs = [q for q in parsed_questions if isinstance(q, dict) and "question" in q and "correctAnswer" in q]
        
        if not valid_qs:
            continue
            
        # Lesson'i tahmin et
        # Histoloji vs Periodontoloji vs ...
        lesson_name = "Periodontoloji" if "Periodont" in fname or any(c.isdigit() and "." in c for c in unit_name) else "Histoloji"
        if "embriyo" in unit_name.lower(): lesson_name = "Histoloji"
        
        # Check DB
        existing_qs = db_get_existing_questions(lesson_name, unit_name)
        existing_normalized = [q.strip().lower()[:100] for q in existing_qs]
        
        to_insert = []
        for q in valid_qs:
            q_norm = q["question"].strip().lower()[:100]
            if q_norm not in existing_normalized:
                to_insert.append(q)
                
        if to_insert:
            print(f"📦 {lesson_name} -> {unit_name} | {len(to_insert)} kayıp soru bulundu! Kurtarılıyor...")
            # Supabase chunked insertion _write_to_supabase manages chunks
            success = _write_to_supabase(to_insert, lesson_name, unit_name)
            if success:
                print(f"  ✅ Başarıyla eklendi.")
            else:
                print(f"  ❌ Yükleme hatası.")
        else:
            pass # print(f"  ⚡ {unit_name}: Kurtarılacak eksik soru yok.")
            
    print("\n🎉 KURTARMA İŞLEMİ TAMAMLANDI!")

if __name__ == "__main__":
    main()
