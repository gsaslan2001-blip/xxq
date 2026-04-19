import json
import urllib.request
import sys
import os
import argparse

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from config import SUPABASE_URL, SUPABASE_KEY

def run():
    parser = argparse.ArgumentParser(description="Rapordaki ID'leri kalici olarak siler")
    parser.add_argument("report_path", type=str, help="Incelenmis JSON raporunun yolu")
    parser.add_argument("--force", action="store_true", help="Onaysiz dogrudan silme")
    args = parser.parse_args()

    if not os.path.exists(args.report_path):
        print(f"Hata: Rapor bulunamadi ({args.report_path})")
        sys.exit(1)
        
    with open(args.report_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    results = data.get("results", [])
    ids_to_delete = set()
    
    for r in results:
        # Hem kalite auditi hem de duplikasyon raporunu destekler
        if "id" in r and r["id"]:
            ids_to_delete.add(r["id"])
        if "question_1_id" in r and r["question_1_id"]:
            ids_to_delete.add(r["question_1_id"])
        if "question_2_id" in r and r["question_2_id"]:
            ids_to_delete.add(r["question_2_id"])
            
    if not ids_to_delete:
        print("Raporda silinecek gecerli bir ID bulunamadi.")
        return
        
    print(f"Toplam {len(ids_to_delete)} adet soru ID'si bulundu.")
    
    if not args.force:
        print("Dikkat: Gercekten silmek icin komuta --force ekleyin.")
        print("Ornek: python delete_ids_from_report.py raporlar/fizyoloji_expl_dupes.json --force")
        return
        
    print("Silme islemi basliyor...")
    deleted = 0
    errors = 0
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    
    for qid in ids_to_delete:
        url = f"{SUPABASE_URL}/rest/v1/questions?id=eq.{qid}"
        req = urllib.request.Request(url, headers=headers, method="DELETE")
        try:
            urllib.request.urlopen(req)
            deleted += 1
            print(f" [OK] Silindi: {qid}")
        except Exception as e:
            print(f" [HATA] {qid} silinemedi ({e})")
            errors += 1
            
    print(f"\nIslem Tamam! {deleted} basarili, {errors} hata.")

if __name__ == "__main__":
    run()
