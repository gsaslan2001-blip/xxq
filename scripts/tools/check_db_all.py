import urllib.request
import json
from collections import Counter

url = 'https://vblndoyjmkgaeuihydyd.supabase.co/rest/v1/questions?select=lesson,unit'
headers = {'apikey': 'sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3', 'Authorization': 'Bearer sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3'}

data = []
fr = 0
limit = 1000

while True:
    req = urllib.request.Request(f"{url}", headers=headers)
    req.add_header('Range', f"{fr}-{fr+limit-1}")
    res = json.loads(urllib.request.urlopen(req).read())
    data.extend(res)
    if len(res) < limit: break
    fr += limit

print(f"Genel Toplam Soru Sayısı: {len(data)}\n")

c_lessons = Counter([d.get('lesson') for d in data])
for lesson, count in c_lessons.items():
    print(f"📚 {lesson}: {count} Soru")

print("\n(Script bitimi)")
