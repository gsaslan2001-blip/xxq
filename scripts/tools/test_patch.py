"""
test_patch.py — Backfill PATCH teşhis aracı
=============================================
Tek bir soru üzerinde tam embedding → PATCH döngüsünü çalıştırır.
Hata varsa tam HTTP yanıtını yazdırır, başarılıysa round-trip süresini gösterir.

Kullanım:
    python scripts/tools/test_patch.py
    python scripts/tools/test_patch.py --id <uuid>
    python scripts/tools/test_patch.py --dry-run   # DB'ye yazmadan sadece serialize et
"""
import os
import sys
import asyncio
import aiohttp
import json
import time
import argparse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY, OPENAI_API_KEY

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ── Renkli terminal çıktısı ──────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def ok(msg):    print(f"{GREEN}  ✓ {msg}{RESET}")
def err(msg):   print(f"{RED}  ✗ {msg}{RESET}")
def warn(msg):  print(f"{YELLOW}  ⚠ {msg}{RESET}")
def info(msg):  print(f"{CYAN}  → {msg}{RESET}")
def hdr(msg):   print(f"\n{BOLD}{msg}{RESET}")

# ── Sabitler ─────────────────────────────────────────────────────────────────
FETCH_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
}
PATCH_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


# ─────────────────────────────────────────────────────────────────────────────
# ADIM 1 — Supabase bağlantısı + şema keşfi
# ─────────────────────────────────────────────────────────────────────────────
async def step1_schema_check(session: aiohttp.ClientSession, target_id: str | None) -> dict | None:
    hdr("ADIM 1 — Supabase bağlantısı ve şema kontrolü")

    # Tek bir satır çek, tüm sütunları al
    if target_id:
        url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{target_id}&select=*&limit=1"
        info(f"Hedef ID: {target_id}")
    else:
        url = f"{SUPABASE_URL}/rest/v1/questions?select=*&limit=1&order=created_at.desc"
        info("Hedef ID belirtilmedi — en son soru kullanılacak")

    async with session.get(url, headers=FETCH_HEADERS) as resp:
        if resp.status != 200:
            err(f"GET başarısız: HTTP {resp.status}")
            err(await resp.text())
            return None
        rows = await resp.json()

    if not rows:
        err("Soru bulunamadı.")
        return None

    row = rows[0]
    qid = row["id"]
    ok(f"Soru bulundu: {qid[:8]}… — {str(row.get('question',''))[:60]}")

    # Hangi embedding sütunları var?
    emb_cols = {k: v for k, v in row.items() if "embed" in k.lower()}
    if not emb_cols:
        warn("Satırda embedding sütunu bulunamadı!")
    else:
        for col, val in emb_cols.items():
            if val is None:
                info(f"Kolon '{col}': NULL (dolu değil)")
            elif isinstance(val, list):
                ok(f"Kolon '{col}': {len(val)}-dim vektör mevcut")
            elif isinstance(val, str):
                try:
                    parsed = json.loads(val)
                    warn(f"Kolon '{col}': JSON STRING olarak saklanmış ({len(parsed)}-dim) — bu sorunlu!")
                except Exception:
                    warn(f"Kolon '{col}': parse edilemeyen string")
            else:
                info(f"Kolon '{col}': tip={type(val).__name__}, değer={str(val)[:40]}")

    return row


# ─────────────────────────────────────────────────────────────────────────────
# ADIM 2 — OpenAI embedding üretimi
# ─────────────────────────────────────────────────────────────────────────────
def step2_embed(text: str) -> list | None:
    hdr("ADIM 2 — OpenAI embedding üretimi")

    if not OPENAI_API_KEY:
        err("OPENAI_API_KEY bulunamadı — config.py'yi kontrol et")
        return None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=OPENAI_API_KEY)
    except ImportError:
        err("openai kütüphanesi yüklü değil: pip install openai")
        return None

    info(f"Model: text-embedding-3-small (1536-dim)")
    info(f"Girdi (ilk 80 karakter): {text[:80]}")
    t0 = time.time()
    resp = client.embeddings.create(model="text-embedding-3-small", input=[text])
    emb = resp.data[0].embedding
    elapsed = time.time() - t0

    ok(f"Embedding üretildi: {len(emb)}-dim | {elapsed*1000:.0f}ms")

    # Temel doğruluk kontrolleri
    assert isinstance(emb, list),       "embedding list değil!"
    assert len(emb) == 1536,            f"boyut 1536 değil: {len(emb)}"
    assert isinstance(emb[0], float),   f"eleman float değil: {type(emb[0])}"
    ok("Doğrulama geçti: list[float], boyut=1536")
    return emb


# ─────────────────────────────────────────────────────────────────────────────
# ADIM 3 — JSON serileştirme testi
# ─────────────────────────────────────────────────────────────────────────────
def step3_serialize(emb: list) -> bytes:
    hdr("ADIM 3 — JSON serileştirme kontrolü")

    # aiohttp'nin json= parametresi tam olarak bu dönüşümü yapıyor
    payload = {"embedding": emb}
    serialized = json.dumps(payload).encode("utf-8")

    info(f"Payload boyutu: {len(serialized):,} byte")
    info(f"İlk 80 karakter: {serialized[:80]}")

    # Geri parse ederek kontrol et
    reparsed = json.loads(serialized)
    assert isinstance(reparsed["embedding"], list),  "yeniden parse sonrası list değil!"
    assert len(reparsed["embedding"]) == 1536,       "yeniden parse sonrası boyut hatalı!"
    assert isinstance(reparsed["embedding"][0], float), "yeniden parse sonrası float değil!"
    ok("Serileştirme / deserileştirme round-trip geçti")
    return serialized


# ─────────────────────────────────────────────────────────────────────────────
# ADIM 4 — Gerçek PATCH isteği
# ─────────────────────────────────────────────────────────────────────────────
async def step4_patch(
    session: aiohttp.ClientSession,
    qid: str,
    emb: list,
    dry_run: bool,
) -> bool:
    hdr("ADIM 4 — Supabase PATCH")

    url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
    payload = {"embedding": emb}

    info(f"URL   : {url}")
    info(f"Payload keys: {list(payload.keys())}")
    info(f"Vector dim  : {len(emb)}")
    info(f"First 3 vals: {emb[:3]}")

    if dry_run:
        warn("--dry-run aktif, DB'ye yazılmıyor.")
        return True

    t0 = time.time()
    async with session.patch(url, headers=PATCH_HEADERS, json=payload) as resp:
        elapsed = time.time() - t0
        body = await resp.text()

        info(f"HTTP {resp.status} | {elapsed*1000:.0f}ms")

        if resp.status in (200, 204):
            ok(f"PATCH başarılı! ({resp.status})")
            return True
        else:
            err(f"PATCH BAŞARISIZ — HTTP {resp.status}")
            err(f"Yanıt gövdesi: {body}")

            # Hata sınıflandırması
            if "42804" in body or "type mismatch" in body.lower():
                print(f"\n{RED}  Teşhis: TİP UYUMSUZLUĞU{RESET}")
                print(f"  DB kolonu farklı bir vektör boyutu (veya tip) bekliyor.")
                print(f"  supabase-schema.sql'deki 'embedding' kolonunun boyutunu kontrol et.")
            elif "42703" in body or "column" in body.lower() and "not exist" in body.lower():
                print(f"\n{RED}  Teşhis: KOLON BULUNAMADI{RESET}")
                print(f"  'embedding' kolonu tabloda yok. Şemayı kontrol et.")
            elif "23502" in body or "null" in body.lower():
                print(f"\n{RED}  Teşhis: NULL KISITLAMASI{RESET}")
                print(f"  Kolon NOT NULL kısıtlamalı olabilir ve farklı bir sorun var.")
            elif "400" in str(resp.status):
                print(f"\n{RED}  Teşhis: BAD REQUEST — olası sebepler:{RESET}")
                print(f"  1. Vektör boyutu DB şemasıyla eşleşmiyor (örn: 1536 vs 3072)")
                print(f"  2. Kolon adı farklı ('embedding' değil 'embedding_1536' gibi)")
                print(f"  3. PostgREST'in vector tipini kabul etme biçimi")
                print(f"\n  Çözüm: supabase-schema.sql dosyasındaki ALTER TABLE satırını")
                print(f"  kontrol et ve kolon adını / boyutunu teyit et.")

            return False


# ─────────────────────────────────────────────────────────────────────────────
# ADIM 5 — Geri okuma doğrulaması (sadece başarılı PATCH sonrası)
# ─────────────────────────────────────────────────────────────────────────────
async def step5_verify(session: aiohttp.ClientSession, qid: str, original_emb: list) -> None:
    hdr("ADIM 5 — Geri okuma doğrulaması")

    url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}&select=id,embedding"
    async with session.get(url, headers=FETCH_HEADERS) as resp:
        rows = await resp.json()

    if not rows:
        err("Soru geri okunamadı.")
        return

    stored = rows[0].get("embedding")
    if stored is None:
        err("embedding kolonu hâlâ NULL — PATCH yazılmadı!")
        return

    # Tip kontrolü
    if isinstance(stored, str):
        warn("Supabase vektörü STRING olarak döndürüyor — json.loads gerekiyor")
        try:
            stored = json.loads(stored)
        except Exception:
            err("json.loads başarısız")
            return

    if isinstance(stored, list):
        ok(f"Kolon tipi: list (boyut={len(stored)})")
        # İlk 3 değeri karşılaştır
        match = all(abs(stored[i] - original_emb[i]) < 1e-6 for i in range(3))
        if match:
            ok("İlk 3 değer eşleşiyor — veri bütünlüğü doğrulandı")
        else:
            warn(f"Değer uyuşmazlığı: stored={stored[:3]} vs original={original_emb[:3]}")
    else:
        warn(f"Beklenmeyen tip: {type(stored).__name__}")


# ─────────────────────────────────────────────────────────────────────────────
# Ana akış
# ─────────────────────────────────────────────────────────────────────────────
async def run(target_id: str | None, dry_run: bool) -> None:
    print(f"\n{'='*60}")
    print(f"  DUSBANKASI — Backfill PATCH Teşhis Aracı")
    print(f"  Mod: {'DRY-RUN (DB yazılmıyor)' if dry_run else 'GERÇEK PATCH'}")
    print(f"{'='*60}")

    async with aiohttp.ClientSession() as session:
        # 1 — Şema + satır kontrolü
        row = await step1_schema_check(session, target_id)
        if row is None:
            err("Devam edilemiyor — şema adımı başarısız.")
            return

        qid = row["id"]
        text = f"{row.get('question', '')} {row.get('explanation', '')}"

        # 2 — Embedding üret
        emb = step2_embed(text)
        if emb is None:
            err("Devam edilemiyor — embedding adımı başarısız.")
            return

        # 3 — Serileştirme
        step3_serialize(emb)

        # 4 — PATCH
        success = await step4_patch(session, qid, emb, dry_run)

        # 5 — Doğrulama (sadece gerçek PATCH başarılıysa)
        if success and not dry_run:
            await step5_verify(session, qid, emb)

    print(f"\n{'='*60}")
    status = "BAŞARILI" if success else "BAŞARISIZ"
    color  = GREEN if success else RED
    print(f"{color}{BOLD}  Sonuç: {status}{RESET}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Backfill PATCH teşhis aracı — tek soru üzerinde tam döngüyü test eder"
    )
    parser.add_argument("--id",      type=str, default=None,  help="Test edilecek soru UUID'si")
    parser.add_argument("--dry-run", action="store_true",     help="DB'ye yazmadan test et")
    args = parser.parse_args()
    asyncio.run(run(args.id, args.dry_run))


if __name__ == "__main__":
    main()
