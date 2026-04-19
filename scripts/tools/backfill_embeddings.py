import os
import sys
import asyncio
import aiohttp
import re
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY

try:
    from openai import OpenAI
    if OPENAI_API_KEY:
        client = OpenAI(api_key=OPENAI_API_KEY)
    else:
        client = None
except ImportError:
    client = None

if sys.platform == "win32":
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass

if not client:
    print("❌ OpenAI API Key eksik veya kütüphane yüklü değil!")
    sys.exit(1)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

# text-embedding-3-small: 1M token başına $0.02
# Batch=50 makul (rate limit çok daha rahat)
BATCH_SIZE = 50
BATCH_SLEEP = 1.0  # saniye — OpenAI çok hızlı, ama rate limit:3500 RPM
SEMAPHORE_LIMIT = 10
MAX_RETRIES = 5


async def fetch_missing_embeddings(session: aiohttp.ClientSession):
    """Embedding değeri boş olan tüm soruları Supabase'den çeker."""
    print("Embedding'siz sorular (NULL) aranıyor...")
    all_rows = []
    limit = 1000
    offset = 0
    while True:
        url = (f"{SUPABASE_URL}/rest/v1/questions"
               f"?select=id,question,explanation&embedding=is.null"
               f"&limit={limit}&offset={offset}")
        async with session.get(url, headers=HEADERS) as resp:
            resp.raise_for_status()
            batch = await resp.json()
            all_rows.extend(batch)
            print(f"   Bulunan: {len(all_rows)}...", end="\r")
            if len(batch) < limit:
                break
            offset += limit
    print(f"\n✅ Toplam {len(all_rows)} adet embedding bekleyen soru bulundu.")
    return all_rows


async def patch_embedding(qid: str, embedding: list,
                          session: aiohttp.ClientSession,
                          semaphore: asyncio.Semaphore):
    url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
    payload = {"embedding": embedding}
    async with semaphore:
        async with session.patch(url, headers=HEADERS, json=payload) as resp:
            if resp.status >= 400:
                body = await resp.text()
                raise Exception(f"Supabase Hata ({resp.status}): {body}")


def _embed_with_retry(texts: list) -> list:
    """OpenAI text-embedding-3-small — 1536 boyut."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=texts
            )
            return [item.embedding for item in resp.data]
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "rate" in err_str.lower():
                delay = 60 if attempt < MAX_RETRIES else 120
                print(f"\n⏳ Rate limit — {delay}s bekleniyor... (deneme {attempt}/{MAX_RETRIES})")
                time.sleep(delay)
            else:
                raise
    raise Exception(f"OpenAI {MAX_RETRIES} denemede de başarısız oldu.")


async def backfill():
    sem = asyncio.Semaphore(SEMAPHORE_LIMIT)
    total_ok = 0
    total_err = 0
    start = time.time()

    async with aiohttp.ClientSession() as session:
        rows = await fetch_missing_embeddings(session)
        if not rows:
            print("İşlem tamam, güncellenecek soru yok.")
            return

        total = len(rows)
        num_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"\nBatch işlemi: {num_batches} batch × {BATCH_SIZE} soru "
              f"(OpenAI text-embedding-3-small, 1536 boyut)\n")

        for batch_idx, i in enumerate(range(0, total, BATCH_SIZE), start=1):
            chunk = rows[i:i + BATCH_SIZE]
            texts = [f"{q.get('question', '')} {q.get('explanation', '')}"
                     for q in chunk]

            # 1 — OpenAI embed (retry dahil)
            try:
                embeddings = _embed_with_retry(texts)
            except Exception as e:
                print(f"\n❌ Batch {batch_idx} OpenAI hatası: {e}")
                total_err += len(chunk)
                continue

            # 2 — Supabase PATCH
            tasks = [
                patch_embedding(chunk[idx]["id"], embeddings[idx], session, sem)
                for idx in range(len(chunk))
                if idx < len(embeddings)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            batch_ok = sum(1 for r in results if not isinstance(r, Exception))
            batch_err = sum(1 for r in results if isinstance(r, Exception))
            total_ok += batch_ok
            total_err += batch_err

            elapsed = time.time() - start
            eta = (elapsed / batch_idx) * (num_batches - batch_idx) if batch_idx > 0 else 0
            print(
                f"Batch {batch_idx:>4}/{num_batches} | "
                f"Toplam: {min(i + BATCH_SIZE, total)}/{total} | "
                f"✅ {total_ok} ❌ {total_err} | "
                f"ETA: {eta/60:.1f}dk",
                end="\r"
            )

            # Rate limit koruması
            if batch_idx < num_batches:
                await asyncio.sleep(BATCH_SLEEP)

    print(f"\n\n🎉 Backfill Tamamlandı!")
    print(f"   Güncellenen : {total_ok}")
    print(f"   Hata        : {total_err}")
    print(f"   Süre        : {(time.time()-start)/60:.1f} dakika")
    print(f"   Maliyet     : ~${(total_ok / 1_000_000 * 0.02):.4f}")


if __name__ == "__main__":
    asyncio.run(backfill())
