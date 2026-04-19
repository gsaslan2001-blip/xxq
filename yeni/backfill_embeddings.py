"""
backfill_embeddings.py — v2 (Güvenilir PATCH + Boyut Farkındalığı)
====================================================================
Değişiklikler v1'e göre:
  1. PATCH retry mekanizması eklendi (400/5xx'te 3 deneme)
  2. fetch aşamasında embedding boyutu da çekilir; yanlış boyutlular
     yeniden vektörlenir (1536 vs 3072 karışıklığı tolere edilir)
  3. COLUMN_NAME sabitiyle kolon adı tek yerden yönetilir
  4. Her başarısız PATCH'in hata mesajı loglanır (JSONL)
  5. Özet istatistikler maliyet tahminiyle birlikte raporlanır

Kullanım:
    python scripts/tools/backfill_embeddings.py
    python scripts/tools/backfill_embeddings.py --dry-run
    python scripts/tools/backfill_embeddings.py --limit 100     # ilk 100 soru
    python scripts/tools/backfill_embeddings.py --lesson Fizyoloji
"""

import os
import sys
import asyncio
import aiohttp
import time
import json
import argparse
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY

try:
    from openai import OpenAI
    _oa_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
except ImportError:
    _oa_client = None

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────────────────────
# KONFİGÜRASYON — tek yerden yönet
# ─────────────────────────────────────────────────────────────────────────────

# DB'deki gerçek kolon adını buradan ayarla.
# supabase-schema.sql'i kontrol et: "embedding vector(1536)" mi yoksa
# "embedding_1536 vector(1536)" mi? Kolon adını birebir buraya yaz.
COLUMN_NAME    = "embedding"          # ← supabase-schema.sql'deki kolon adı

TARGET_DIM     = 1536                 # text-embedding-3-small: 1536
EMBED_MODEL    = "text-embedding-3-small"
COST_PER_1M    = 0.02                 # USD / 1M token (yaklaşık)

BATCH_SIZE     = 50
BATCH_SLEEP    = 1.0                  # saniye — OpenAI rate limit koruması
SEMAPHORE_LIMIT = 10
MAX_EMBED_RETRY = 5
MAX_PATCH_RETRY = 3

LOG_DIR  = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "logs"))
os.makedirs(LOG_DIR, exist_ok=True)
ERROR_LOG = os.path.join(LOG_DIR, f"backfill_errors_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl")

# ─────────────────────────────────────────────────────────────────────────────
# HTTP HEADERS
# ─────────────────────────────────────────────────────────────────────────────
_BASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}
_PATCH_HEADERS = {
    **_BASE_HEADERS,
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


# ─────────────────────────────────────────────────────────────────────────────
# VERİ ÇEKME
# ─────────────────────────────────────────────────────────────────────────────
async def fetch_missing(
    session: aiohttp.ClientSession,
    lesson: str | None = None,
    limit_total: int | None = None,
) -> list[dict]:
    """
    COLUMN_NAME IS NULL olan satırları çeker.
    Eğer boyut uyumsuzluğu da kapsanmak istenirse bu fonksiyon
    genişletilebilir; şimdilik NULL kontrolü yeterli.
    """
    print(f"Embedding'siz sorular ({COLUMN_NAME} IS NULL) aranıyor...")
    all_rows: list[dict] = []
    page = 1000
    offset = 0

    while True:
        params = (
            f"select=id,question,explanation"
            f"&{COLUMN_NAME}=is.null"
            f"&limit={page}&offset={offset}"
        )
        if lesson:
            import urllib.parse
            params += f"&lesson=eq.{urllib.parse.quote(lesson)}"

        url = f"{SUPABASE_URL}/rest/v1/questions?{params}"
        async with session.get(url, headers=_BASE_HEADERS) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"Fetch başarısız: HTTP {resp.status}\n{body}")
            batch = await resp.json()

        all_rows.extend(batch)
        print(f"   Bulunan: {len(all_rows):,}...", end="\r")

        if len(batch) < page:
            break
        offset += page

        if limit_total and len(all_rows) >= limit_total:
            all_rows = all_rows[:limit_total]
            break

    print(f"\n✅ {len(all_rows):,} soru embedding bekliyor.")
    return all_rows


# ─────────────────────────────────────────────────────────────────────────────
# EMBEDDING ÜRETİMİ
# ─────────────────────────────────────────────────────────────────────────────
def _embed_batch(texts: list[str]) -> list[list[float]]:
    """OpenAI text-embedding-3-small, rate-limit retry ile."""
    if not _oa_client:
        raise RuntimeError("OpenAI client başlatılamadı. OPENAI_API_KEY eksik?")

    for attempt in range(1, MAX_EMBED_RETRY + 1):
        try:
            resp = _oa_client.embeddings.create(model=EMBED_MODEL, input=texts)
            embs = [item.embedding for item in resp.data]

            # Boyut doğrulaması — beklenmeyen bir model değişikliğini yakalar
            for i, emb in enumerate(embs):
                if len(emb) != TARGET_DIM:
                    raise ValueError(
                        f"index {i}: beklenen dim={TARGET_DIM}, gelen={len(emb)}"
                    )
            return embs

        except Exception as exc:
            msg = str(exc)
            if "429" in msg or "rate" in msg.lower():
                wait = 60 if attempt < MAX_EMBED_RETRY else 120
                print(f"\n⏳ Rate limit — {wait}s bekleniyor (deneme {attempt}/{MAX_EMBED_RETRY})")
                time.sleep(wait)
            else:
                raise

    raise RuntimeError(f"OpenAI {MAX_EMBED_RETRY} denemede de başarısız oldu.")


# ─────────────────────────────────────────────────────────────────────────────
# PATCH — yeniden deneme + ayrıntılı hata loglama
# ─────────────────────────────────────────────────────────────────────────────
async def _patch_one(
    qid: str,
    emb: list[float],
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    dry_run: bool,
    error_sink: list,
) -> bool:
    """
    Tek bir soruya embedding yazar.
    Başarı → True. Hata → False + error_sink'e ekler.

    Teknik not:
    aiohttp'nin json= parametresi Python list'ini [0.1, 0.2, ...]
    biçiminde JSON dizisine dönüştürür — bu pgvector'ün beklediği format.
    Hiçbir string cast yapılmıyor.
    """
    if dry_run:
        return True

    url     = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
    payload = {COLUMN_NAME: emb}               # kolon adı sabitten geliyor

    async with sem:
        for attempt in range(1, MAX_PATCH_RETRY + 1):
            try:
                async with session.patch(
                    url,
                    headers=_PATCH_HEADERS,
                    json=payload,           # aiohttp burada json.dumps() yapıyor
                ) as resp:
                    if resp.status in (200, 204):
                        return True

                    body = await resp.text()

                    # 4xx → retry'dan önce hatayı kaydet
                    if resp.status < 500:
                        # İstemci hatası — retry işe yaramaz
                        error_sink.append({
                            "id": qid,
                            "status": resp.status,
                            "body": body,
                            "attempt": attempt,
                        })
                        return False

                    # 5xx → yeniden dene
                    if attempt < MAX_PATCH_RETRY:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        error_sink.append({
                            "id": qid,
                            "status": resp.status,
                            "body": body,
                            "attempt": attempt,
                        })
                        return False

            except aiohttp.ClientError as exc:
                if attempt < MAX_PATCH_RETRY:
                    await asyncio.sleep(2 ** attempt)
                else:
                    error_sink.append({"id": qid, "error": str(exc), "attempt": attempt})
                    return False

    return False  # buraya ulaşılmamalı


# ─────────────────────────────────────────────────────────────────────────────
# ANA DÖNGÜ
# ─────────────────────────────────────────────────────────────────────────────
async def backfill(
    lesson: str | None = None,
    limit_total: int | None = None,
    dry_run: bool = False,
) -> None:
    if not _oa_client:
        print("❌ OpenAI API Key eksik veya openai kütüphanesi yüklü değil!")
        sys.exit(1)

    sem        = asyncio.Semaphore(SEMAPHORE_LIMIT)
    total_ok   = 0
    total_err  = 0
    error_sink: list[dict] = []
    t_start    = time.time()

    print(f"\n{'='*60}")
    print(f"  DUSBANKASI Backfill v2")
    print(f"  Model  : {EMBED_MODEL} ({TARGET_DIM}-dim)")
    print(f"  Kolon  : {COLUMN_NAME}")
    print(f"  Mod    : {'DRY-RUN' if dry_run else 'GERÇEK YAZMA'}")
    if lesson:
        print(f"  Ders   : {lesson}")
    if limit_total:
        print(f"  Limit  : {limit_total}")
    print(f"{'='*60}\n")

    async with aiohttp.ClientSession() as session:
        rows = await fetch_missing(session, lesson=lesson, limit_total=limit_total)
        if not rows:
            print("İşlem tamam — güncellenecek soru yok.")
            return

        total      = len(rows)
        num_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"Batch planı: {num_batches} batch × {BATCH_SIZE} soru\n")

        for batch_idx, i in enumerate(range(0, total, BATCH_SIZE), start=1):
            chunk = rows[i : i + BATCH_SIZE]
            texts = [
                f"{q.get('question', '')} {q.get('explanation', '')}".strip()
                for q in chunk
            ]

            # 1 — Embedding
            try:
                embeddings = _embed_batch(texts)
            except Exception as exc:
                print(f"\n❌ Batch {batch_idx} OpenAI hatası: {exc}")
                total_err += len(chunk)
                continue

            # 2 — Paralel PATCH
            tasks = [
                _patch_one(
                    chunk[idx]["id"],
                    embeddings[idx],
                    session,
                    sem,
                    dry_run,
                    error_sink,
                )
                for idx in range(len(chunk))
                if idx < len(embeddings)
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            batch_ok  = sum(1 for r in results if r is True)
            batch_err = sum(1 for r in results if r is not True)
            total_ok  += batch_ok
            total_err += batch_err

            elapsed = time.time() - t_start
            eta     = (elapsed / batch_idx) * (num_batches - batch_idx) if batch_idx else 0
            print(
                f"Batch {batch_idx:>4}/{num_batches} | "
                f"{min(i + BATCH_SIZE, total):,}/{total:,} soru | "
                f"✅ {total_ok:,}  ❌ {total_err:,} | "
                f"ETA: {eta / 60:.1f}dk",
                end="\r",
            )

            if batch_idx < num_batches:
                await asyncio.sleep(BATCH_SLEEP)

    # ── Hata logu ─────────────────────────────────────────────────────────
    if error_sink:
        with open(ERROR_LOG, "w", encoding="utf-8") as f:
            for entry in error_sink:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"\n\n⚠️  {len(error_sink)} hata kaydedildi: {ERROR_LOG}")
        # İlk hatanın içeriğini ekrana bas — en çok bilgi sağlayan
        first = error_sink[0]
        print(f"\n   İlk hata detayı:")
        print(f"   ID     : {first.get('id', '?')}")
        print(f"   Status : {first.get('status', '?')}")
        print(f"   Body   : {first.get('body', first.get('error', '?'))[:300]}")
        print(f"\n   → İlk hatayı analiz etmek için:")
        print(f"     python scripts/tools/test_patch.py --id {first.get('id','<uuid>')}")

    # ── Özet ──────────────────────────────────────────────────────────────
    elapsed_total = time.time() - t_start
    print(f"\n\n{'='*60}")
    print(f"  Backfill {'(dry-run) ' if dry_run else ''}tamamlandı")
    print(f"  ✅ Başarılı : {total_ok:,}")
    print(f"  ❌ Hatalı   : {total_err:,}")
    print(f"  ⏱  Süre     : {elapsed_total / 60:.1f} dakika")
    if total_ok > 0 and not dry_run:
        approx_tokens = total_ok * 300          # ortalama 300 token/soru kaba tahmini
        approx_cost   = approx_tokens / 1_000_000 * COST_PER_1M
        print(f"  💰 Tahmini  : ~${approx_cost:.4f}")
    print(f"{'='*60}\n")


# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="DUSBANKASI backfill — embedding eksik soruları vektörle"
    )
    parser.add_argument("--lesson",  type=str,  default=None,  help="Sadece bu dersi işle")
    parser.add_argument("--limit",   type=int,  default=None,  help="Maksimum soru sayısı")
    parser.add_argument("--dry-run", action="store_true",       help="DB'ye yazmadan test et")
    args = parser.parse_args()

    asyncio.run(backfill(
        lesson=args.lesson,
        limit_total=args.limit,
        dry_run=args.dry_run,
    ))


if __name__ == "__main__":
    main()
