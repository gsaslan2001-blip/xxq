"""
lsh_matcher.py — MinHash LSH ile O(N²) → O(log N) Kopya Adayı Tespiti

Algoritma:
  1. Her sorunun tokenları → MinHash imzası (128 permütasyon)
  2. İmzalar LSH sepetlerine (buckets) atanır
  3. Aynı sepete düşen çiftler → gerçek Jaccard doğrulaması için aday

Fayda:
  5.000 soruda 12.5M ikili yerine sadece gerçek benzer adaylar karşılaştırılır.
  Threshold ~0.45 (DUPE_RATIO=0.50 için güvenli kenar payı).
"""
from datasketch import MinHash, MinHashLSH


# LSH threshold: DUPE_RATIO'dan biraz düşük tut ki sınır çiftlerini kaçırma
_LSH_THRESHOLD = 0.40
_NUM_PERM = 128   # Daha fazla = daha hassas ama daha yavaş (128 iyi denge)


def _build_minhash(tokens: set) -> MinHash:
    m = MinHash(num_perm=_NUM_PERM)
    for token in tokens:
        m.update(token.encode("utf-8"))
    return m


def find_candidate_pairs(tokenized: list) -> list[tuple[int, int]]:
    """
    tokenized: [{"id": ..., "tokens": set, ...}, ...]
    Döndürür: [(i, j), ...] — sadece benzer olma ihtimali yüksek indeks çiftleri
    """
    lsh = MinHashLSH(threshold=_LSH_THRESHOLD, num_perm=_NUM_PERM)
    minhashes = []

    # Tüm soruları LSH'e ekle
    for idx, q in enumerate(tokenized):
        tokens = q.get("tokens") or set()
        if not tokens:
            minhashes.append(None)
            continue
        m = _build_minhash(tokens)
        minhashes.append(m)
        key = str(idx)
        try:
            lsh.insert(key, m)
        except ValueError:
            # Aynı key zaten varsa atla (olmamalı ama güvenlik için)
            pass

    # Her soru için LSH komşularını sorgula → aday çifti oluştur
    candidate_pairs = set()
    for idx, q in enumerate(tokenized):
        m = minhashes[idx]
        if m is None:
            continue
        neighbors = lsh.query(m)
        for neighbor_key in neighbors:
            j = int(neighbor_key)
            if j <= idx:
                continue
            candidate_pairs.add((idx, j))

    return list(candidate_pairs)


def estimate_similarity(tokens_a: set, tokens_b: set, num_perm: int = _NUM_PERM) -> float:
    """İki token seti arasında MinHash ile tahmini Jaccard benzerliği döner."""
    if not tokens_a or not tokens_b:
        return 0.0
    m1 = _build_minhash(tokens_a)
    m2 = _build_minhash(tokens_b)
    return m1.jaccard(m2)
