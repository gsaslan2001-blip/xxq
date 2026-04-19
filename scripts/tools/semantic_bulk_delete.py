"""
Semantik benzerlik >= 0.80 olan kopya sorulardan yenisini sil.
Önce log kaydı alır, sonra toplu siler.
"""
import os, sys, asyncio, aiohttp, json
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

THRESHOLD  = 0.80
BATCH      = 1000
SEM_LIMIT  = 20
LOG_DIR    = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "logs"))
LOG_FILE   = os.path.join(LOG_DIR, f"semantic_deleted_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl")
os.makedirs(LOG_DIR, exist_ok=True)


async def run_rpc(session: aiohttp.ClientSession, sql: str) -> list:
    url = f"{SUPABASE_URL}/rest/v1/rpc/execute_sql"
    # Dogrudan REST ile SQL calistiramadigimiz icin fetch endpoint kullanacagiz
    # Bunun yerine questions tablosunu sayfalayarak cekeriz
    pass


async def fetch_to_delete(session: aiohttp.ClientSession) -> list[dict]:
    """Supabase SQL RPC ile silinecek ID listesi al."""
    sql = f"""
    WITH pairs AS (
      SELECT
        CASE WHEN a.created_at <= b.created_at THEN b.id ELSE a.id END AS del_id,
        CASE WHEN a.created_at <= b.created_at THEN b.question ELSE a.question END AS del_question,
        CASE WHEN a.created_at <= b.created_at THEN b.lesson ELSE a.lesson END AS del_lesson,
        CASE WHEN a.created_at <= b.created_at THEN b.unit ELSE a.unit END AS del_unit,
        CASE WHEN a.created_at <= b.created_at THEN a.question ELSE b.question END AS kept_question,
        ROUND((1 - (a.embedding <=> b.embedding))::numeric, 3) AS similarity
      FROM questions a
      JOIN questions b ON a.id < b.id
        AND a.lesson = b.lesson
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
        AND 1 - (a.embedding <=> b.embedding) >= {THRESHOLD}
        AND (a.quality_flag IS NULL OR a.quality_flag NOT IN ('kavramsal_kopya','auto_deleted'))
        AND (b.quality_flag IS NULL OR b.quality_flag NOT IN ('kavramsal_kopya','auto_deleted'))
    )
    SELECT DISTINCT del_id, del_question, del_lesson, del_unit, kept_question, similarity
    FROM pairs
    ORDER BY del_lesson, similarity DESC
    """
    url = f"{SUPABASE_URL}/rest/v1/rpc/execute_raw_sql"
    # Supabase'de custom RPC yok, pg dogrudan calismaz.
    # Bunun yerine: silinecek ID'leri onceden hesaplayan SQL'i
    # bir Supabase RPC fonksiyonu olmadan calistiramayiz.
    # Alternatif: Python'da fetch + karsilastir
    return []


async def fetch_questions_page(session, offset):
    url = (f"{SUPABASE_URL}/rest/v1/questions"
           f"?select=id,lesson,unit,question,created_at,embedding"
           f"&embedding=not.is.null"
           f"&or=(quality_flag.is.null,quality_flag.not.in.(kavramsal_kopya,auto_deleted))"
           f"&limit={BATCH}&offset={offset}")
    async with session.get(url, headers={k: v for k,v in HEADERS.items() if k != 'Content-Type' and k != 'Prefer'}) as r:
        if r.status != 200:
            text = await r.text()
            raise Exception(f"Fetch hata {r.status}: {text[:200]}")
        return await r.json()


async def delete_batch(ids: list[str], session: aiohttp.ClientSession, sem: asyncio.Semaphore) -> int:
    """Tek bir ID'yi sil."""
    ok = 0
    async def _del(qid):
        nonlocal ok
        url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
        async with sem:
            async with session.delete(url, headers=HEADERS) as r:
                if r.status in (200, 204):
                    ok += 1
    await asyncio.gather(*[_del(i) for i in ids])
    return ok


async def main():
    print("Sorular cekiliyor (sayfalama ile)...")
    async with aiohttp.ClientSession() as session:
        # 1. Tum soruları cek
        all_rows = []
        offset = 0
        while True:
            try:
                chunk = await fetch_questions_page(session, offset)
            except Exception as e:
                print(f"\nHata offset={offset}: {e}")
                break
            all_rows.extend(chunk)
            print(f"  {len(all_rows):,} soru yuklendi...", end="\r")
            if len(chunk) < BATCH:
                break
            offset += BATCH

        print(f"\n{len(all_rows):,} soru yuklendi. Benzerlik hesaplaniyor...")

        # 2. Embedding parse
        import math
        valid = []
        for r in all_rows:
            emb = r.get("embedding")
            if isinstance(emb, str):
                try: emb = json.loads(emb)
                except: continue
            if emb and len(emb) in (1536, 3072):
                valid.append({
                    "id": r["id"],
                    "lesson": r["lesson"],
                    "unit": r["unit"],
                    "question": r["question"],
                    "created_at": r["created_at"],
                    "emb": emb,
                })

        print(f"{len(valid):,} gecerli vektor bulundu.")

        def cosine(a, b):
            dot = sum(x*y for x,y in zip(a,b))
            na = math.sqrt(sum(x*x for x in a))
            nb = math.sqrt(sum(x*x for x in b))
            return dot/(na*nb) if na and nb else 0.0

        # 3. O(N^2) karsilastirma — ders bazli gruplayarak hizlandir
        from collections import defaultdict
        by_lesson = defaultdict(list)
        for q in valid:
            by_lesson[q["lesson"]].append(q)

        to_delete = {}  # id -> row (unique)
        total_pairs = 0

        for lesson, qs in by_lesson.items():
            n = len(qs)
            for i in range(n):
                for j in range(i+1, n):
                    sim = cosine(qs[i]["emb"], qs[j]["emb"])
                    if sim >= THRESHOLD:
                        total_pairs += 1
                        # Yeniyi sil, eskiyi koru
                        if qs[i]["created_at"] >= qs[j]["created_at"]:
                            loser = qs[i]
                            keeper_q = qs[j]["question"]
                        else:
                            loser = qs[j]
                            keeper_q = qs[i]["question"]
                        if loser["id"] not in to_delete:
                            to_delete[loser["id"]] = {
                                "id": loser["id"],
                                "lesson": loser["lesson"],
                                "unit": loser["unit"],
                                "question": loser["question"],
                                "kept_question": keeper_q,
                                "similarity": round(sim, 3),
                            }

            pct = list(by_lesson.keys()).index(lesson) / len(by_lesson) * 100
            print(f"  {lesson:<20} {len(qs):>4} soru | Simdiye dek {len(to_delete):,} silinecek", end="\r")

        print(f"\n\nKopya cift   : {total_pairs:,}")
        print(f"Silinecek    : {len(to_delete):,} benzersiz soru")

        if not to_delete:
            print("Silinecek soru yok.")
            return

        # 4. Log kaydet
        with open(LOG_FILE, "w", encoding="utf-8") as f:
            for row in to_delete.values():
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"Log kaydedildi: {LOG_FILE}")

        # 5. Toplu sil
        ids = list(to_delete.keys())
        print(f"\nSiliniyor: {len(ids):,} soru...")
        sem = asyncio.Semaphore(SEM_LIMIT)
        ok = 0
        for i in range(0, len(ids), 50):
            batch = ids[i:i+50]
            ok += await delete_batch(batch, session, sem)
            print(f"  Silindi: {ok:,}/{len(ids):,}", end="\r")

    print(f"\n\nTamamlandi!")
    print(f"  Silinen soru : {ok:,}")
    print(f"  Log          : {LOG_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
