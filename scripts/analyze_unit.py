"""
DUS Bankası — Soru Analiz & Log Import Aracı
==============================================
1. Log dosyalarından üretilmiş soruları çıkarıp Supabase'e yazar
2. Mevcut ünite sorularını kavram kapsamı ve eşsizlik açısından analiz eder
"""

import os
import sys
import re
import json
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
from config import SUPABASE_URL, SUPABASE_KEY
from shared import (
    extract_json, deploy_to_supabase, get_questions_for_unit,
    _tokenize, _jaccard_similarity, validate_question_batch,
)

LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")


def extract_questions_from_log(log_path):
    """Bir exhaust log dosyasından JSON soru dizisini çıkarır."""
    with open(log_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # "--- ANSWER ---" sonrasını al
    marker = "--- ANSWER ---"
    if marker in content:
        content = content[content.index(marker) + len(marker):]

    questions = extract_json(content)
    return questions or []


def import_logs_to_supabase(unit_prefix, target_unit, lesson):
    """Log dosyalarından soruları çıkarıp Supabase'e yazar."""
    log_files = sorted([
        f for f in os.listdir(LOG_DIR)
        if f.startswith(f"exhaust_{unit_prefix}_batch") and f.endswith(".txt")
    ])

    if not log_files:
        print(f"❌ '{unit_prefix}' prefiksiyle log dosyası bulunamadı.")
        return

    all_questions = []
    for lf in log_files:
        path = os.path.join(LOG_DIR, lf)
        qs = extract_questions_from_log(path)
        print(f"   📄 {lf}: {len(qs)} soru")
        all_questions.extend(qs)

    print(f"\n   📦 Toplam: {len(all_questions)} soru")

    if all_questions:
        print(f"   🚀 '{target_unit}' olarak Supabase'e yazılıyor (Kalite Gate aktif)...")
        deploy_to_supabase(all_questions, lesson, target_unit)
    else:
        print("   ⚠️ Soru bulunamadı.")


def analyze_unit(lesson, unit_name):
    """Bir ünitedeki soruları kavram kapsamı ve eşsizlik açısından analiz eder."""
    print(f"\n{'='*60}")
    print(f"📊 ANALİZ: {lesson} / {unit_name}")
    print(f"{'='*60}")

    questions = get_questions_for_unit(lesson, unit_name)
    if not questions:
        print("   ❌ Soru bulunamadı.")
        return

    print(f"   Toplam soru: {len(questions)}")

    # ─── 1. Jaccard Benzerlik Analizi ───
    print(f"\n   ── EŞSİZLİK ANALİZİ (Jaccard) ──")
    stems = []
    for q in questions:
        stem_text = q.get("question", "")
        stems.append(_tokenize(stem_text))

    # Tüm çiftleri karşılaştır
    duplicates = []
    high_similarity = []
    for i in range(len(stems)):
        for j in range(i + 1, len(stems)):
            sim = _jaccard_similarity(stems[i], stems[j])
            if sim >= 0.80:
                duplicates.append((i, j, sim))
            elif sim >= 0.60:
                high_similarity.append((i, j, sim))

    if duplicates:
        print(f"   🔴 KESİN DUPLİKA (≥%80): {len(duplicates)} çift")
        for idx, (i, j, sim) in enumerate(duplicates[:10], 1):
            q1 = questions[i].get("question", "")[:80]
            q2 = questions[j].get("question", "")[:80]
            print(f"      {idx}. [{sim:.0%}] Soru {i+1} vs {j+1}")
            print(f"         A: {q1}...")
            print(f"         B: {q2}...")
    else:
        print(f"   ✅ Kesin duplika yok (≥%80)")

    if high_similarity:
        print(f"\n   🟡 YÜKSEK BENZERLİK (%60-79): {len(high_similarity)} çift")
        for idx, (i, j, sim) in enumerate(high_similarity[:10], 1):
            q1 = questions[i].get("question", "")[:80]
            q2 = questions[j].get("question", "")[:80]
            print(f"      {idx}. [{sim:.0%}] Soru {i+1} vs {j+1}")
            print(f"         A: {q1}...")
            print(f"         B: {q2}...")
        if len(high_similarity) > 10:
            print(f"      ...ve {len(high_similarity)-10} çift daha")
    else:
        print(f"   ✅ Yüksek benzerlik yok (%60-79)")

    # ─── 2. Kavram Yoğunluğu Analizi ───
    print(f"\n   ── KAVRAM YOĞUNLUĞU ANALİZİ ──")

    # Tüm soru köklerinden kelime frekansı
    all_words = []
    for q in questions:
        stem = q.get("question", "").lower()
        words = [w for w in re.findall(r'[a-zçğıöşüâîû]+', stem) if len(w) >= 4]
        all_words.extend(words)

    # Stop words (Türkçe genel)
    stop_words = {
        'aşağıdakilerden', 'hangisi', 'hangisinde', 'aşağıdaki', 'birlikte',
        'ilgili', 'olarak', 'olan', 'için', 'veya', 'oluşan', 'sonucu',
        'neden', 'nasıl', 'sırasında', 'sonrasında', 'arasında', 'tarafından',
        'yapılan', 'yapılır', 'edilir', 'olan', 'bulunan', 'üzerinden',
        'doğrudur', 'yanlıştır', 'değildir', 'değil', 'kadar', 'göre',
        'gibi', 'iken', 'bile', 'daha', 'şekilde', 'durumda', 'hasta',
        'hastada', 'hastanın', 'yaşında', 'erkek', 'kadın', 'muayene',
    }

    filtered = [w for w in all_words if w not in stop_words]
    freq = Counter(filtered)
    top_concepts = freq.most_common(30)

    print(f"   En sık geçen kavramlar (soru köklerinde):")
    for word, count in top_concepts:
        bar = "█" * count
        print(f"      {word:25s} {count:3d} {bar}")

    # ─── 3. Doğru Cevap Dağılımı ───
    print(f"\n   ── DOĞRU CEVAP DAĞILIMI ──")
    answer_dist = Counter(q.get("correct_answer", q.get("correctAnswer", "?")) for q in questions)
    for letter in "ABCDE":
        count = answer_dist.get(letter, 0)
        pct = count / len(questions) * 100 if questions else 0
        bar = "█" * count
        ideal = "✅" if 15 <= pct <= 25 else "⚠️"
        print(f"      {letter}: {count:3d} ({pct:.0f}%) {bar} {ideal}")

    # ─── 4. Özet ───
    print(f"\n   ── ÖZET ──")
    print(f"   Toplam soru        : {len(questions)}")
    print(f"   Kesin duplika      : {len(duplicates)} çift")
    print(f"   Yüksek benzerlik   : {len(high_similarity)} çift")
    uniqueness = 1 - (len(duplicates) / max(len(questions), 1))
    print(f"   Eşsizlik oranı     : {uniqueness:.1%}")
    print(f"{'='*60}")


# ═══════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Soru Analiz & Import")
    parser.add_argument("--import-logs", metavar="PREFIX", help="Log dosyalarından soruları import et (prefix: TEST_V3)")
    parser.add_argument("--target-unit", default=None, help="Import hedef ünite adı")
    parser.add_argument("--lesson", default="Fizyoloji", help="Ders adı")
    parser.add_argument("--analyze", metavar="UNIT", help="Üniteyi analiz et")
    args = parser.parse_args()

    if args.import_logs:
        target = args.target_unit or args.import_logs
        print(f"\n📥 LOG IMPORT: {args.import_logs} → {target}")
        import_logs_to_supabase(args.import_logs, target, args.lesson)

    if args.analyze:
        analyze_unit(args.lesson, args.analyze)

    if not args.import_logs and not args.analyze:
        print("Kullanım:")
        print("  --import-logs TEST_V3 --target-unit DENEME2  → Log'lardan import")
        print("  --analyze DENEME                             → Ünite analizi")
        print("  İkisi birlikte de çalışır.")
