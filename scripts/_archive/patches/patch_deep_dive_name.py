import re

path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py'
with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. get_existing_units fonksiyonunu güncelle (Sette Unique Item yerine Dictionary Dönecek)
old_get_existing = '''def get_existing_units(lesson_name):
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
        return set()'''

new_get_existing = '''def get_existing_units(lesson_name):
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
            from collections import Counter
            counts = Counter(d.get('unit') for d in data if d.get('unit'))
            return dict(counts)
    except Exception as e:
        print(f"Mevcut üniteler alınırken hata: {e}")
        return {}'''

code = code.replace(old_get_existing, new_get_existing)

# 2. Main loop skip logic güncelle
old_skip_logic = '''                tur1_exists = unit_name in existing_units
                tur2_exists = (unit_name + " - Deep Dive") in existing_units
                
                if tur1_exists or tur2_exists:
                    print(f"⏭️ {unit_name} ÜNİTESİ MEVCUT (Tur 1 veya Tur 2). ATLANMIYOR, SONRAKİNE GEÇİLİYOR.")
                    continue'''

new_skip_logic = '''                tur_count = existing_units.get(unit_name, 0)
                tur1_exists = tur_count > 0
                tur2_exists = tur_count >= 50
                
                if tur1_exists or tur2_exists:
                    print(f"⏭️ {unit_name} ÜNİTESİ MEVCUT ({tur_count} soru). ATLANILIYOR, SONRAKİNE GEÇİLİYOR.")
                    continue'''

code = code.replace(old_skip_logic, new_skip_logic)

# 3. Tur 2 Deploy kısmı
old_deploy_t2 = '''                                # Tur 2 sonuçlarını ayrıca kaydet (duplicate önlemek için unit_name_2)
                                if questions2:
                                    print(f"💾 Tur 2: {len(questions2)} ek soru kaydediliyor...")
                                    deploy_to_supabase(questions2, lesson, unit_name + " - Deep Dive")'''

new_deploy_t2 = '''                                # Tur 2 sonuçlarını ayrıca kaydet (Aynı ünite ismiyle)
                                if questions2:
                                    print(f"💾 Tur 2: {len(questions2)} ek soru kaydediliyor...")
                                    deploy_to_supabase(questions2, lesson, unit_name)'''

code = code.replace(old_deploy_t2, new_deploy_t2)

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Patch applied for same unit name & count-based detection.")
