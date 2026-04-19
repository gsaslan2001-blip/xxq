"""
DUS Bankası — Kavram Parmak İzi Üretimi (Fingerprinting)
Yapılandırılmış format: topic_tag → mechanism (tiered compression)
"""
import re


def generate_fingerprint(q):
    """
    Her sorudan yapılandırılmış kavram parmak izi üretir.
    Formül: [soru_kökünden_topic] doğru_cevap → mekanizma_özeti
    """
    # 1. Soru kökünden topic tag çıkar
    question_text = q.get("question") or ""
    # Son cümleyi al (genellikle asıl sorunun sorulduğu yer)
    sentences = [s.strip() for s in question_text.replace("?", "?\n").split("\n") if s.strip()]
    topic_hint = sentences[-1][:60] if sentences else ""

    # 2. Doğru cevap terimi
    correct_letter = (q.get("correct_answer") or "").strip().upper()
    option_key = f"option_{correct_letter.lower()}" if correct_letter else None
    correct_text = q.get(option_key, "") if option_key else ""

    # 3. Mekanizma özeti (açıklamanın ilk cümlesi)
    explanation = q.get("explanation") or ""
    first_sentence = explanation.split(".")[0].strip() if explanation else ""

    # 4. Birleştir (Yapılandırılmış format: (Topic) Answer → Mechanism)
    topic_clean = topic_hint.replace("\n", " ").strip()
    if correct_text and first_sentence:
        fp = f"({topic_clean}) {correct_text} → {first_sentence}"
    elif correct_text:
        fp = f"({topic_clean}) {correct_text}"
    else:
        fp = f"({topic_clean}) {first_sentence}"

    return fp[:90]


def build_fingerprint_list(questions, char_budget=7000):
    """
    Dynamic Tiered Compression:
    Önce 90 char/soru dener, bütçeyi aşıyorsa 60'a, sonra 40'a düşer.
    Böylece prompt boyutu her zaman 10K limitinin altında kalır.
    """
    count = len(questions)

    for max_chars in [90, 60, 40]:
        fingerprints = [f"{i}. {generate_fingerprint(q)[:max_chars]}"
                        for i, q in enumerate(questions, 1)]
        result = "\n".join(fingerprints)
        if len(result) <= char_budget:
            print(f"   📊 Parmak izi: {count} soru → {len(result)} karakter (limit: {max_chars}/soru)")
            return result

    # Son çare: 40 char ile bile aşıyorsa, yine de döndür
    print(f"   ⚠️ Parmak izi bütçeyi aşıyor: {count} soru → {len(result)} karakter")
    return result
