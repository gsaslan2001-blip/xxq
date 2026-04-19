"""
audit_logic.py — Kalite Denetim İş Mantığı
Jaccard/Overlap hesapları, kural hiyerarşisi, kürasyon kararları.
Ağ veya dosya I/O içermez — saf hesaplama.
"""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from shared import _tokenize

# ─── Eşikler ──────────────────────────────────────────────────────────────────
DUPE_RATIO      = 0.50   # Açıklama benzerlik eşiği (Metinsel)
SEMANTIC_RATIO  = 0.90   # OpenAI Cosine Similarity eşiği
DIFF_STEM_RATIO = 0.08   # Bu değerin altında → farklı kavram → ikisi de korunur

import math


# ─── Temel Metrikler ──────────────────────────────────────────────────────────

def asymmetric(a: set, b: set, min_tokens: int = 10) -> float:
    """Overlap Coefficient. Kısa açıklamaları yanlış yüksek benzerlikten korur."""
    if not a or not b:
        return 0.0
    if min(len(a), len(b)) < min_tokens:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def cosine_similarity(v1, v2) -> float:
    """Vektörlerin string veya liste olma ihtimaline karşı dayanıklı kosinüs benzerliği."""
    if not v1 or not v2:
        return 0.0
    
    # String ise parse et
    if isinstance(v1, str): v1 = json.loads(v1)
    if isinstance(v2, str): v2 = json.loads(v2)
    
    try:
        # Float olduklarından emin ol
        v1 = [float(x) for x in v1]
        v2 = [float(x) for x in v2]
        
        dot = sum(x * y for x, y in zip(v1, v2))
        n1 = math.sqrt(sum(x * x for x in v1))
        n2 = math.sqrt(sum(x * x for x in v2))
        return dot / (n1 * n2) if n1 and n2 else 0.0
    except (ValueError, TypeError):
        return 0.0


def uniqueness_density(text: str) -> float:
    """Benzersiz token / toplam kelime. Yüksek → sıkışık, tekrarsız metin."""
    words = text.split()
    if not words:
        return 0.0
    return len(_tokenize(text)) / len(words)


def calc_quality_score(q: dict) -> int:
    """
    Manifesto Puanlama Sistemi (Ölüm Maçı)
    - Klinik Vaka: +10
    - Pozitif Kök: +5
    - Negatif Kök: -15
    - Kısa (<10 kelime): -5
    - Bozuk Karakter (Legacy Error): -50
    """
    score = 0
    text = q.get("question", "").lower()
    expl = q.get("explanation", "").lower()
    words = len(text.split())

    # 1. Klinik Vaka Kontrolü
    klinik_keywords = {"hasta", "yaş", "vaka", "kliniğe", "başvur", "muayene", "bulgu", "lezyon", "radyograf", "semptom", "tedavi", "tanı"}
    if any(k in text for k in klinik_keywords):
        score += 10

    # 2. Soru Kökü Analizi
    if "hangisidir" in text or "nedir" in text:
        score += 5
    
    negative_keywords = {"değildir", "yanlıştır", "yoktur", "bulunmaz", "hariç", "olmaz"}
    if any(k in text for k in negative_keywords):
        score += 15 # DUS tarzı olduğu için artı puan

    # 3. Uzunluk ve Yoğunluk
    if words < 10:
        score -= 5
    elif 15 <= words <= 45:
        score += 2
    
    # 4. Karakter Sağlığı (Legacy Data Temizliği)
    # Eğer "Dişeti" yerine "Dieti" gibi bozuk karakterler varsa ağır ceza
    broken_patterns = [r"", r"dieti", r"periodontal"] # Örnek bozukluklar
    import re
    if any(re.search(p, text) for p in broken_patterns):
        score -= 50

    return score


def decide_winner(q1: dict, q2: dict) -> int:
    """
    İki soru arasındaki düelloyu puanlama sistemine göre yönetir.
    Döndürür: 1 veya 2 (Kazananın indeksi)
    """
    s1 = calc_quality_score(q1)
    s2 = calc_quality_score(q2)

    if s1 > s2:
        return 1
    if s2 > s1:
        return 2
    
    # Eşitlik durumunda uzun olanı koru
    return 1 if len(q1.get("question", "")) >= len(q2.get("question", "")) else 2


# ─── Çapraz Tarama (LSH veya Brute-Force) ─────────────────────────────────────

def find_duplicates_bruteforce(questions: list) -> list:
    """
    Yedek: LSH yoksa O(N²) brute-force ikili karşılaştırma.
    Sadece küçük veri setleri için (<500 soru) kullanılır.
    """
    from itertools import combinations
    tokenized = _tokenize_questions(questions)
    results = []
    total = len(tokenized) * (len(tokenized) - 1) // 2
    checked = 0

    for q1, q2 in combinations(tokenized, 2):
        checked += 1
        if checked % 10000 == 0:
            pct = checked / total * 100
            print(f"  {checked:,}/{total:,} çift (%{pct:.1f})...", end="\r")
        if not q1["tokens"] or not q2["tokens"]:
            continue
        ratio = asymmetric(q1["tokens"], q2["tokens"])
        if ratio >= DUPE_RATIO:
            results.append(_make_pair(q1, q2, ratio))

    results.sort(key=lambda x: x["overlap_ratio"], reverse=True)
    return results


def find_duplicates(questions: list) -> list:
    """
    LSH + OpenAI Semantic Hybrid Radar.
    Hem metinsel benzerlik hem de anlamsal (cosine) benzerlik adaylarını toplar.
    """
    try:
        from lib.lsh_matcher import find_candidate_pairs
    except ImportError:
        from lsh_matcher import find_candidate_pairs

    tokenized = _tokenize_questions(questions)
    results_map = {} # Duplicate results to avoid duplicates in results

    # 1. Metinsel Tarama (LSH)
    print(f"  LSH Leksikal Tarama ({len(tokenized):,} soru)...")
    candidate_pairs = find_candidate_pairs(tokenized)
    
    # 2. Anlamsal Tarama (OpenAI Cosine - O(N^2) - Optimize Edilmiş)
    if any(q.get("embedding") for q in questions):
        print(f"  OpenAI Anlamsal Tarama (Vektörler ön-yükleniyor)...")
        # Embedding'leri float listelere bir kez çevir (hız için)
        parsed_vecs = []
        for q in questions:
            v = q.get("embedding")
            if isinstance(v, str): v = json.loads(v)
            if v and isinstance(v, list):
                parsed_vecs.append([float(x) for x in v])
            else:
                parsed_vecs.append(None)

        for i in range(len(questions)):
            v1 = parsed_vecs[i]
            if not v1: continue
            for j in range(i + 1, len(questions)):
                v2 = parsed_vecs[j]
                if not v2: continue
                
                # Doğrudan sum(x*y) kullanan hızlı dot product
                dot = sum(x * y for x, y in zip(v1, v2))
                n1 = math.sqrt(sum(x * x for x in v1))
                n2 = math.sqrt(sum(x * x for x in v2))
                sim = dot / (n1 * n2) if n1 and n2 else 0.0

                if sim >= SEMANTIC_RATIO:
                    p = tuple(sorted((questions[i]["id"], questions[j]["id"])))
                    if p not in results_map:
                        results_map[p] = _make_pair(tokenized[i], tokenized[j], sim, "Semantic")

    # Jaccard doğrulaması (LSH adayları için)
    for i, j in candidate_pairs:
        q1, q2 = tokenized[i], tokenized[j]
        ratio = asymmetric(q1["tokens"], q2["tokens"])
        if ratio >= DUPE_RATIO:
            p = tuple(sorted((q1["id"], q2["id"])))
            if p not in results_map:
                results_map[p] = _make_pair(q1, q2, ratio, "Lexical")

    results = list(results_map.values())
    results.sort(key=lambda x: x["overlap_ratio"], reverse=True)
    return results


# ─── Kürasyon ─────────────────────────────────────────────────────────────────

def curate_pairs(results: list, interactive: bool = False) -> tuple[list, list]:
    """
    Her şüpheli çift için ölüm maçı yapar.
    Döndürür: (ids_to_action, curation_log)
    """
    ids_to_action = []
    seen_ids = set()
    curation_log = []
    kept_both = 0
    eliminated = 0

    for r in results:
        id1 = r.get("question_1_id", "")
        id2 = r.get("question_2_id", "")
        q1_text = r.get("question_1_text", "")
        q2_text = r.get("question_2_text", "")
        q1_expl = r.get("question_1_expl", "")
        q2_expl = r.get("question_2_expl", "")

        if not id1 or not id2:
            continue

        stem_sim = jaccard(_tokenize(q1_text), _tokenize(q2_text))
        if stem_sim < DIFF_STEM_RATIO:
            kept_both += 1
            curation_log.append({
                "action": "KORU_IKISINI",
                "reason": f"stem_jaccard({stem_sim:.2f})<{DIFF_STEM_RATIO}",
                "q1_id": id1, "q1_text": q1_text[:80],
                "q2_id": id2, "q2_text": q2_text[:80],
            })
            continue

        s1_score = calc_quality_score(r.get("q1_raw", {}))
        s2_score = calc_quality_score(r.get("q2_raw", {}))

        if s1_score > s2_score or (s1_score == s2_score and len(q1_text) >= len(q2_text)):
            loser_id, loser_text, loser_expl = id2, q2_text, q2_expl
            winner_id, winner_text = id1, q1_text
            reason = f"s1_win({s1_score} vs {s2_score})"
        else:
            loser_id, loser_text, loser_expl = id1, q1_text, q1_expl
            winner_id, winner_text = id2, q2_text
            reason = f"s2_win({s2_score} vs {s1_score})"

        if loser_id in seen_ids:
            curation_log.append({"action": "ATLANDI", "loser_id": loser_id})
            continue

        if interactive:
            print(f"\n{'─'*60}")
            print(f"  Overlap: {r['overlap_ratio']:.0%}")
            print(f"  [KORUNAN]  {winner_text[:100]}")
            print(f"  [ELENECEK] {loser_text[:100]}")
            ans = input("  Flag/sil? [E=evet / n=atla]: ").strip().lower()
            if ans == "n":
                curation_log.append({"action": "KULLANICI_ATLADI", "loser_id": loser_id})
                continue

        ids_to_action.append({
            "id": loser_id,
            "text": loser_text,
            "text_short": loser_text[:120],
            "explanation": loser_expl,
            "reason": reason,
            "winner_id": winner_id,
            "winner_text": winner_text,
            "winner_text_short": winner_text[:120],
        })
        seen_ids.add(loser_id)
        curation_log.append({
            "action": "ELENECEK",
            "loser_id": loser_id, "loser_text": loser_text[:80],
            "winner_id": winner_id, "winner_text": winner_text[:80],
            "reason": reason,
        })
        eliminated += 1

    print(f"  İkisi de korunan: {kept_both} | Elenen: {eliminated}")
    return ids_to_action, curation_log


def write_curation_summary(lesson: str, results: list, curation_log: list, report_dir: str):
    """Kürasyon özetini markdown olarak yazar."""
    path = os.path.join(report_dir, "curation_summary.md")
    lines = [f"# Kürasyon Özeti — {lesson}\n\n"]
    total = len(results)
    kept = sum(1 for e in curation_log if e["action"] == "KORU_IKISINI")
    elim = sum(1 for e in curation_log if e["action"] == "ELENECEK")
    lines.append(f"- Toplam Şüpheli Çift: {total}\n")
    lines.append(f"- İkisi de Korunan: {kept}\n")
    lines.append(f"- Elenen: {elim}\n\n---\n\n")

    for entry in curation_log:
        action = entry["action"]
        if action == "KORU_IKISINI":
            lines.append(f"🟢 **KORU** ({entry['reason']})\n")
            lines.append(f"- S1: {entry['q1_text']}\n- S2: {entry['q2_text']}\n\n---\n\n")
        elif action in ("ELENECEK", "KULLANICI_ATLADI"):
            lbl = "ELE" if action == "ELENECEK" else "ATLANDI"
            lines.append(f"🔴 **{lbl}** ({entry.get('reason', '')})\n")
            lines.append(
                f"- [KORUNAN]: {entry.get('winner_text', '')}\n"
                f"- [ÇÖP]: {entry.get('loser_text', '')}\n\n---\n\n"
            )

    with open(path, "w", encoding="utf-8") as f:
        f.write("".join(lines))


# ─── Yardımcılar ──────────────────────────────────────────────────────────────

def _tokenize_questions(questions: list) -> list:
    result = []
    for q in questions:
        expl = q.get("explanation") or ""
        result.append({
            "id": q.get("id"),
            "unit": q.get("unit", ""),
            "question": q.get("question", ""),
            "explanation": expl,
            "tokens": _tokenize(expl),
            "embedding": q.get("embedding")
        })
    return result


def _make_pair(q1: dict, q2: dict, ratio: float, type: str = "Lexical") -> dict:
    # Set objeleri JSON'a yazılamadığı için 'tokens' anahtarını rapordan çıkarıyoruz
    d1 = {k: v for k, v in q1.items() if k != "tokens"}
    d2 = {k: v for k, v in q2.items() if k != "tokens"}
    
    return {
        "overlap_ratio": round(ratio, 2),
        "type": type,
        "question_1_id": q1["id"],
        "question_1_unit": q1["unit"],
        "question_1_text": q1["question"],
        "question_1_expl": q1["explanation"],
        "question_2_id": q2["id"],
        "question_2_unit": q2["unit"],
        "question_2_text": q2["question"],
        "question_2_expl": q2["explanation"],
        "q1_raw": d1,
        "q2_raw": d2
    }
