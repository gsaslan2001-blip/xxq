import json
import glob
import os
import sys
import argparse

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from shared import _tokenize

def jaccard(a, b):
    t_a = _tokenize(a)
    t_b = _tokenize(b)
    if not t_a or not t_b: return 0.0
    intersection = len(t_a & t_b)
    union = len(t_a | t_b)
    return intersection / union if union > 0 else 0.0

def score_question(q_text):
    score = 0
    text_lower = q_text.lower()
    words = len(text_lower.split())
    if words < 10: score -= 5
    elif 15 <= words <= 45: score += 2
    
    if any(k in text_lower for k in ["hasta", "yaş", "vaka", "kliniğe", "başvur", "tedavi"]):
        score += 10
        
    if "aşağıdakilerden hangisidir" in text_lower or "nedir" in text_lower:
        score += 5
        
    if any(k in text_lower for k in ["değildir", "yanlıştır", "yoktur", "bulunmaz", "hariç", "olmaz"]):
        score -= 15
        
    return score

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="JSON dosyalarini degistirmeden sadece summary cikarir.")
    args = parser.parse_args()

    files = glob.glob("raporlar/*_expl_dupes.json")
    # Dosyalari sirala
    files.sort()
    
    markdown_lines = ["# Otomatik Kürasyon Özeti\n\nBu dosya, otomatik küratörün hangi soruyu neden infaz listesine aldığını gösterir.\n\n"]
    
    total_pairs = 0
    total_kept_both = 0
    total_deleted = 0
    
    for fp in files:
        with open(fp, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        results = data.get("results", [])
        if not results: continue
        
        lesson = data.get("lesson", os.path.basename(fp)).upper()
        markdown_lines.append(f"## Ders: {lesson}\n")
        
        for r in results:
            q1 = r.get("question_1_text", "")
            q2 = r.get("question_2_text", "")
            id1 = r.get("question_1_id", "")
            id2 = r.get("question_2_id", "")
            
            # Already wiped manually?
            if not id1 and not id2: continue
            
            total_pairs += 1
            stem_sim = jaccard(q1, q2)
            
            action_text = ""
            if stem_sim < 0.20:
                # Keep both!
                if not args.dry_run:
                    r["question_1_id"] = ""
                    r["question_2_id"] = ""
                total_kept_both += 1
                action_text = f"🟢 **İkisini de KORU (Jaccard: %{int(stem_sim*100)})**\n- S1: _{q1}_\n- S2: _{q2}_"
            else:
                s1 = score_question(q1)
                s2 = score_question(q2)
                if s1 > s2 or (s1 == s2 and len(q1) >= len(q2)):
                    if not args.dry_run:
                        r["question_1_id"] = ""
                    total_deleted += 1
                    action_text = f"🔴 **S2 SİLİNECEK** | Skoru (S1: {s1} vs S2: {s2})\n- **[KORUNAN] S1:** {q1}\n- **[ÇÖP] S2:** {q2}"
                else:
                    if not args.dry_run:
                        r["question_2_id"] = ""
                    total_deleted += 1
                    action_text = f"🔴 **S1 SİLİNECEK** | Skoru (S1: {s1} vs S2: {s2})\n- **[KORUNAN] S2:** {q2}\n- **[ÇÖP] S1:** {q1}"
                    
            markdown_lines.append(action_text + "\n\n---\n")
            
        if not args.dry_run:
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                
    markdown_lines.insert(1, f"**Özet İstatistik:**\n- Toplam İncelenen: {total_pairs}\n- İkisi de Korunan (Farklı Kavram): {total_kept_both}\n- Eşleşmeden Dolayı Biri Silinen: {total_deleted}\n\n")
    
    with open("raporlar/curation_summary.md", "w", encoding="utf-8") as fm:
        fm.write("\n".join(markdown_lines))

if __name__ == "__main__":
    main()
