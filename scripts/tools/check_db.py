import urllib.request, json
from collections import Counter

# API Limitini aşmak için birden fazla dersi kontrol eden global sorgu
url = 'https://vblndoyjmkgaeuihydyd.supabase.co/rest/v1/questions?select=lesson,unit'
headers = {
    'apikey': 'sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3', 
    'Authorization': 'Bearer sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3'
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        print(f'GLOBAL TOPLAM SORU (İlk 1000): {len(data)}')
        
        counts = Counter(d['lesson'] for d in data)
        for lesson, count in counts.items():
            print(f'- {lesson}: {count} soru')
            
        radyo_units = [d['unit'] for d in data if d['lesson'] == 'Radyoloji']
        if radyo_units:
            print('\n--- RADYOLOJİ İLERLEMESİ ---')
            u_counts = Counter(radyo_units)
            for unit, count in sorted(u_counts.items()):
                print(f'  [{unit}]: {count} soru')
except Exception as e:
    print(f'Hata: {e}')
