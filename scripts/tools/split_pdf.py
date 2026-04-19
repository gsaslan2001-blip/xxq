import os
import sys

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    print("HATA: pypdf kütüphanesi eksik. Lütfen terminalde 'pip install pypdf' çalıştırın.")
    sys.exit(1)

# Girdi ve Çıktı Yolları
INPUT_PDF = r"C:\Users\FURKAN\Desktop\DUS\patoloji\pato ünite pdf\ORAL PATOLOJİ FUL.pdf"
OUTPUT_DIR = r"C:\Users\FURKAN\Desktop\DUS\patoloji\pato ünite pdf\Parcalanmis"

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# Sayfa aralıkları (1-index bazlı, inclusive)
# Format: (sayfa_no, baslik) -> sayfa_no bir sonraki ünitenin başlangıcıdır.
UNIT_PAGES = [
    (1, "Makroglossi ve Giris"),
    (6, "Oral Beyaz Lezyonlar"),
    (15, "Pulpa Hastaliklari"),
    (20, "Neoplastik Lezyonlar"),
    (23, "Malign Lezyonlar"),
    (28, "Gelisimsel Odontojenik Kistler")
]

# Liste sayfa sırasına göre emin olmak için sıralandı
UNIT_PAGES.sort(key=lambda x: x[0])

def clean_filename(name):
    import re
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()

def main():
    print(f"Okunuyor: {INPUT_PDF}")
    if not os.path.exists(INPUT_PDF):
        print(f"HATA: Kitap PDF'i bulunamadı -> {INPUT_PDF}")
        return

    reader = PdfReader(INPUT_PDF)
    total_pages = len(reader.pages)
    print(f"Toplam PDF Sayfası: {total_pages}")

    for i in range(len(UNIT_PAGES)):
        start_page_num, title = UNIT_PAGES[i]
        
        # Sonraki ünite başlangıcını bul veya dosya sonu
        if i + 1 < len(UNIT_PAGES):
            end_page_num = UNIT_PAGES[i+1][0]
        else:
            # Gelişimsel Odontojenik Kistler için son sayfa analizi:
            # Kullanıcı 28-45 dediği için 46. sayfadan kesiyoruz.
            end_page_num = 46 

        # 0-index sisteme çeviriyoruz
        actual_start_idx = start_page_num - 1
        actual_end_idx = end_page_num - 1

        # Sınır kontrolleri
        actual_start_idx = max(0, min(actual_start_idx, total_pages - 1))
        actual_end_idx = max(1, min(actual_end_idx, total_pages))

        if actual_start_idx >= actual_end_idx:
            print(f"UYARI: {title} hatalı sayfa aralığı. Atlanıyor.")
            continue

        writer = PdfWriter()
        for p in range(actual_start_idx, actual_end_idx):
            writer.add_page(reader.pages[p])

        safe_title = clean_filename(title)
        out_filename = f"{i+1:02d}-{safe_title}.pdf"
        out_filepath = os.path.join(OUTPUT_DIR, out_filename)

        with open(out_filepath, "wb") as f_out:
            writer.write(f_out)
        
        print(f"Cikarildi: {out_filename} (Sayfa Araligi: {start_page_num}-{end_page_num-1})")

if __name__ == "__main__":
    main()
    print("\nPARÇALAMA İŞLEMİ TAMAMLANDI!")
