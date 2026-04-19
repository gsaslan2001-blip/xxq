"""
db_layer.py — Supabase Veri Erişim Katmanı (Async)
Tüm ağ I/O buradan geçer. İş mantığı içermez.
"""
import json
import asyncio
import aiohttp
import urllib.parse
from datetime import datetime
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY

# Eşzamanlı Supabase isteği limiti (rate limit koruması)
_SEMAPHORE_LIMIT = 10


def _headers(extra: dict = None) -> dict:
    base = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    if extra:
        base.update(extra)
    return base


async def fetch_all_questions(lesson: str, session: aiohttp.ClientSession) -> list:
    """Dersin tüm sorularını pagine ederek async olarak çeker."""
    all_rows = []
    limit, offset = 1000, 0
    print(f"[db] '{lesson}' soruları çekiliyor...")

    while True:
        params = (
            f"select=id,unit,question,explanation,correct_answer,quality_flag,embedding"
            f"&limit={limit}&offset={offset}"
            f"&lesson=eq.{urllib.parse.quote(lesson)}"
        )
        url = f"{SUPABASE_URL}/rest/v1/questions?{params}"
        async with session.get(url, headers=_headers()) as resp:
            resp.raise_for_status()
            batch = await resp.json()
            all_rows.extend(batch)
            print(f"  Çekildi: {len(all_rows):,}...", end="\r")
            if len(batch) < limit:
                break
            offset += limit

    before = len(all_rows)
    all_rows = [q for q in all_rows if q.get("quality_flag") != "reviewed_keep"]
    skipped = before - len(all_rows)
    print(f"\n  {len(all_rows):,} soru hazır (reviewed_keep atlandı: {skipped}).")
    return all_rows


async def patch_quality_flag(
    qid: str,
    flag_value: str,
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Tek sorunun quality_flag alanını async PATCH ile günceller."""
    url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
    payload = {"quality_flag": flag_value}
    async with semaphore:
        async with session.patch(
            url,
            headers=_headers({"Content-Type": "application/json", "Prefer": "return=minimal"}),
            json=payload,
        ) as resp:
            resp.raise_for_status()
            return True


async def delete_question(
    qid: str,
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
) -> bool:
    """Tek soruyu async DELETE ile kaldırır."""
    url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
    async with semaphore:
        async with session.delete(url, headers=_headers()) as resp:
            resp.raise_for_status()
            return True


async def batch_flag(lesson: str, items: list, log_path: str) -> tuple[int, int]:
    """
    Listedeki tüm soruları paralel olarak 'kavramsal_kopya' işaretler.
    Döndürür: (başarılı, hatalı)
    """
    sem = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    ts = datetime.now().isoformat()
    ok = 0
    errors = 0

    async with aiohttp.ClientSession() as session:

        async def _flag_one(item: dict):
            nonlocal ok, errors
            qid = item["id"]
            try:
                await patch_quality_flag(qid, "kavramsal_kopya", session, sem)
                ok += 1
            except Exception as e:
                errors += 1
                _log_event(log_path, {
                    "event": "flag_error", "ts": ts, "id": qid, "error": str(e)
                })

        tasks = [_flag_one(item) for item in items]
        await asyncio.gather(*tasks)

    with open(log_path, "a", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps({
                "flagged_at": ts,
                "lesson": lesson,
                "id": item["id"],
                "question": item.get("text", ""),
                "explanation": item.get("explanation", ""),
                "reason": item.get("reason", ""),
                "winner_id": item.get("winner_id", ""),
            }, ensure_ascii=False) + "\n")

    return ok, errors


async def batch_delete(lesson: str, items: list, log_path: str) -> tuple[int, int]:
    """
    Listedeki tüm soruları paralel olarak siler.
    Döndürür: (başarılı, hatalı)
    """
    sem = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    ts = datetime.now().isoformat()
    ok = 0
    errors = 0

    async with aiohttp.ClientSession() as session:

        async def _delete_one(item: dict):
            nonlocal ok, errors
            qid = item["id"]
            try:
                await delete_question(qid, session, sem)
                ok += 1
            except Exception as e:
                errors += 1
                _log_event(log_path, {
                    "event": "delete_error", "ts": ts, "id": qid, "error": str(e)
                })

        tasks = [_delete_one(item) for item in items]
        await asyncio.gather(*tasks)

    with open(log_path, "a", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps({
                "deleted_at": ts,
                "lesson": lesson,
                "id": item["id"],
                "question": item.get("text", ""),
                "explanation": item.get("explanation", ""),
                "reason": item.get("reason", ""),
                "winner_id": item.get("winner_id", ""),
            }, ensure_ascii=False) + "\n")

    return ok, errors


def _log_event(path: str, event: dict):
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        pass
