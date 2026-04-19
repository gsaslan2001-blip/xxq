import os
import sys

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    print("HATA: pypdf kütüphanesi eksik.")
    sys.exit(1)

INPUT_PDF = r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\Protetik Diş Tedavisi.pdf"
OUTPUT_DIR = r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\Parcalanmis"
MAP_FILE = r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\pymupdf_mapped.txt"

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

def clean_filename(name):
    import re
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()

def main():
    if not os.path.exists(INPUT_PDF):
        print("HATA: Kitap PDF'i bulunamadı.")
        return

    # Haritayı oku
    units = []
    with open(MAP_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if "->" in line:
                parts = line.split("->")
                title = parts[1].strip()
                page_part = parts[0].split("|")[0].strip()
                page_num = int(page_part.replace("SAYFA:", "").strip())
                units.append({"title": title, "page": page_num})

    # Algoritmik Hata Düzeltme (Geriye Dönük Sayfa Sayılarını İleri İttir - Monotonicity)
    for i in range(1, len(units)):
        if units[i]["page"] <= units[i-1]["page"]:
            units[i]["page"] = units[i-1]["page"] + 1

    reader = PdfReader(INPUT_PDF)
    total_pages = len(reader.pages)

    for i in range(len(units)):
        title = units[i]["title"]
        start_page = units[i]["page"] - 1  # 0-indexed yap
        
        if i + 1 < len(units):
            end_page = units[i+1]["page"] - 1
        else:
            end_page = total_pages

        # Sınır güvenlikleri
        start_page = max(0, min(start_page, total_pages - 1))
        end_page = max(0, min(end_page, total_pages))

        if start_page >= end_page:
            continue

        writer = PdfWriter()
        for p in range(start_page, end_page):
            writer.add_page(reader.pages[p])

        safe_title = clean_filename(title)
        out_filename = f"{i+1:02d}-{safe_title}.pdf"
        out_filepath = os.path.join(OUTPUT_DIR, out_filename)

        with open(out_filepath, "wb") as f_out:
            writer.write(f_out)
        
        print(f"✅ Çıkarıldı: {out_filename} (Sayfa: {start_page+1} - {end_page})")

if __name__ == "__main__":
    main()
