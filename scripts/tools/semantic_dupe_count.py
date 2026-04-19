"""
Mevcut OpenAI 1536-dim vektörleri kullanarak kaç semantik kopya var?
Supabase RPC'ye gerek yok — doğrudan REST ile çeker, Python'da cosine similarity hesaplar.
"""
import os, sys, asyncio, aiohttp, json, math
from collections import defaultdict

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}

THRESHOLD = 0.90   # %90 üzeri = kopya şüphelisi
BATCH     = 1000


def cosine(a, b):
    dot = sum(x*y for x,y in zip(a,b))
    na  = math.sqrt(sum(x*x for x in a))
    nb  = math.sqrt(sum(x*x for x in b))
    return dot / (na * nb) if na and nb else 0.0


async def fetch_all(session):
    rows, offset = [], 0
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/questions"
               f"?select=id,lesson,question,embedding"
               f"&embedding=not.is.null"
               f"&or=(quality_flag.is.null,quality_flag.not.in.(kavramsal_kopya,auto_deleted))"
               f"&limit={BATCH}&offset={offset}")
        async with session.get(url, headers=HEADERS) as r:
            r.raise_for_status()
            chunk = await r.json()
        rows.extend(chunk)
        print(f"  Cekiliyor: {len(rows):,}...", end="\r")
        if len(chunk) < BATCH:
            break
        offset += BATCH
    return rows


async def main():
    print("Sorular ve vektorler cekiliyor...")
    async with aiohttp.ClientSession() as session:
        rows = await fetch_all(session)

    print(f"\n{len(rows):,} soru yuklendi. Benzerlik hesaplaniyor...\n")

    # embedding string → list
    vecs, ids, lessons, texts = [], [], [], []
    for r in rows:
        emb = r["embedding"]
        if isinstance(emb, str):
            emb = json.loads(emb)
        if emb and len(emb) == 1536:
            vecs.append(emb)
            ids.append(r["id"])
            lessons.append(r["lesson"])
            texts.append(r["question"][:60])

    total = len(vecs)
    print(f"Gecerli vektor: {total:,} soru")
    print(f"Esik: {THRESHOLD*100:.0f}% cosine similarity\n")

    # O(N^2) — 9000 soru icin ~40M islem, ~2-3 dakika
    dupes_by_lesson = defaultdict(int)
    dupe_pairs = 0
    flagged_ids = set()

    for i in range(total):
        for j in range(i+1, total):
            sim = cosine(vecs[i], vecs[j])
            if sim >= THRESHOLD:
                dupe_pairs += 1
                flagged_ids.add(ids[i])
                flagged_ids.add(ids[j])
                dupes_by_lesson[lessons[i]] += 1

        if i % 100 == 0:
            pct = i / total * 100
            print(f"  Ilerleme: {i:,}/{total:,} ({pct:.1f}%) | Kopya cift: {dupe_pairs:,}", end="\r")

    print(f"\n\n{'='*50}")
    print(f"SONUC (esik: {THRESHOLD*100:.0f}%)")
    print(f"{'='*50}")
    print(f"Toplam kopya CIFT    : {dupe_pairs:,}")
    print(f"Etkilenen SORU sayisi: {len(flagged_ids):,}")
    print(f"\nDerse gore kopya cifti:")
    for lesson, count in sorted(dupes_by_lesson.items(), key=lambda x: -x[1]):
        print(f"  {lesson:<25} {count:>5} cift")

if __name__ == "__main__":
    asyncio.run(main())
