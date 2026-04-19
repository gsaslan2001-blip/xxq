import sys
import os
import json
import urllib.parse
import urllib.request
import argparse
from itertools import combinations

# Sub-directory imports (shared, config)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY
from shared import _tokenize

DUPE_RATIO = 0.50  # Asimetrik Jaccard eşiği

def fetch_questions(lesson):
    all_rows = []
    limit = 1000
    offset = 0
    print(f"Cekiliyor: {lesson} (1000'erli batch)")
    while True:
        params = f"select=id,unit,question,explanation&limit={limit}&offset={offset}"
        if lesson:
            params += f"&lesson=eq.{urllib.parse.quote(lesson)}"

        url = f"{SUPABASE_URL}/rest/v1/questions?{params}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                batch = json.loads(resp.read())
                all_rows.extend(batch)
                print(f"  Cekildi: {len(all_rows):,} soru...", end="\r")
                if len(batch) < limit:
                    break
                offset += limit
        except Exception as e:
            print(f"\n  HATA: Supabase GET basarisiz: {e}")
            break
    print(f"\nCekilen Toplam Soru: {len(all_rows):,}")
    return all_rows

def run():
    parser = argparse.ArgumentParser(description="Cross-unit explanation overlap scanner")
    parser.add_argument("--lesson", type=str, default="Fizyoloji", help="Hangi ders taranacak (Fizyoloji, Radyoloji vs)")
    parser.add_argument("--unit", type=str, default=None, help="Opsiyonel: Sadece belirli bir ünite filtrele")
    args = parser.parse_args()

    rows = fetch_questions(args.lesson)

    if args.unit:
        rows = [r for r in rows if r.get("unit", "") == args.unit]
        print(f"Filtre uygulandı: {args.unit} ünitesi → {len(rows)} soru")

    # Tokenize et (ünite ayrımı YOK — cross-unit)
    tokenized = []
    for q in rows:
        expl = q.get("explanation") or ""
        toks = _tokenize(expl)
        tokenized.append({
            "id": q.get("id"),
            "unit": q.get("unit", "Bilinmeyen"),
            "question": q.get("question", ""),
            "explanation": expl,
            "tokens": toks
        })

    results = []
    print("Kiyaslamalar yapiliyor (cross-unit)...")

    for q1, q2 in combinations(tokenized, 2):
        if not q1["tokens"] or not q2["tokens"]:
            continue
        intersection = q1["tokens"] & q2["tokens"]
        min_len = min(len(q1["tokens"]), len(q2["tokens"]))
        ratio = len(intersection) / min_len if min_len > 0 else 0.0

        if ratio >= DUPE_RATIO:
            results.append({
                "overlap_ratio": round(ratio, 2),
                "overlap_count": len(intersection),
                "overlapping_words": sorted(list(intersection)),
                "question_1_id": q1["id"],
                "question_1_unit": q1["unit"],
                "question_1_text": q1["question"],
                "question_1_expl": q1["explanation"],
                "question_2_id": q2["id"],
                "question_2_unit": q2["unit"],
                "question_2_text": q2["question"],
                "question_2_expl": q2["explanation"]
            })

    results.sort(key=lambda x: x["overlap_ratio"], reverse=True)

    output_meta = {
        "lesson": args.lesson,
        "total_pairs_flagged": len(results),
        "results": results
    }

    report_name = f"raporlar/{args.lesson.lower().replace(' ', '_')}_expl_dupes.json"
    with open(report_name, "w", encoding="utf-8") as f:
        json.dump(output_meta, f, ensure_ascii=False, indent=2)

    print(f"\nBitti! '{args.lesson}' altinda aciklamalari >= %{int(DUPE_RATIO*100)} oranda ortusen {len(results)} cift bulundu.")
    print(f"Rapor kaydedildi: {os.path.abspath(report_name)}")
    print(f"\nNOT: Bu arac sadece MANUEL analizler icindir.")
    print(f"Tam otomatik temizlik icin: python scripts/tools/smart_audit_pipeline.py --lesson {args.lesson}")

if __name__ == "__main__":
    run()

