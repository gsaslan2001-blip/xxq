import re

def patch_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        code = f.read()

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
            from collections import Counter
            counts = Counter(d.get('unit') for d in data if d.get('unit'))
            return dict(counts)
    except Exception as e:
        print(f"Mevcut üniteler alınırken hata: {e}")
        return {}'''

    new_get_existing = '''def get_existing_units(lesson_name):
    """Hangi ünitelerin zaten Supabase'de olduğunu öğrenir (Sınırsız Pagination)."""
    encoded = urllib.parse.quote(lesson_name)
    all_data = []
    offset = 0
    limit = 1000
    while True:
        url = f"{SUPABASE_URL}/rest/v1/questions?select=unit&lesson=eq.{encoded}&limit={limit}&offset={offset}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read())
                all_data.extend(data)
                if len(data) < limit:
                    break
                offset += limit
        except Exception as e:
            print(f"Mevcut üniteler alınırken hata: {e}")
            break
            
    from collections import Counter
    counts = Counter(d.get('unit') for d in all_data if d.get('unit'))
    return dict(counts)'''

    if old_get_existing in code:
        code = code.replace(old_get_existing, new_get_existing)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(code)
        print(f"Patched {path}")
    else:
        print(f"Old logic not found exactly in {path}")

# Patch Both Files
patch_file(r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py')

# Also fix get_units_for_lesson in expand script
def patch_expand(path):
    with open(path, 'r', encoding='utf-8') as f:
        code = f.read()
    
    old_get = '''def get_units_for_lesson(lesson_name):
    """Bir dersteki tüm üniteleri ve soru sayılarını döner."""
    encoded = urllib.parse.quote(lesson_name)
    data = supabase_get(f"questions?select=unit&lesson=eq.{encoded}")
    from collections import Counter
    counts = Counter(d["unit"] for d in data if d.get("unit"))
    return dict(sorted(counts.items()))'''

    new_get = '''def get_units_for_lesson(lesson_name):
    """Bir dersteki tüm üniteleri ve soru sayılarını döner (Pagination ile)."""
    encoded = urllib.parse.quote(lesson_name)
    all_data = []
    offset = 0
    limit = 1000
    while True:
        data = supabase_get(f"questions?select=unit&lesson=eq.{encoded}&limit={limit}&offset={offset}")
        if not data: break
        all_data.extend(data)
        if len(data) < limit: break
        offset += limit
        
    from collections import Counter
    counts = Counter(d["unit"] for d in all_data if d.get("unit"))
    return dict(sorted(counts.items()))'''
    
    if old_get in code:
        code = code.replace(old_get, new_get)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(code)
        print(f"Patched {path}")
            
patch_expand(r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-expand.py')

