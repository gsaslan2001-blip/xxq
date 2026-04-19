import sys
from pypdf import PdfReader

PDF_PATH = r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\Protetik Diş Tedavisi.pdf"

try:
    reader = PdfReader(PDF_PATH)
except Exception as e:
    print(f"Hata: {e}")
    sys.exit(1)

text_dump = []
# Sadece ilk 10 satırı alıyoruz her sayfa için, çünkü başlıklar genelde sayfanın başındadır.
for i in range(len(reader.pages)):
    page = reader.pages[i]
    try:
        text = page.extract_text()
        if text:
            lines = text.strip().split('\n')
            top_lines = " ".join([l.strip() for l in lines[:15]])
            text_dump.append(f"--- SAYFA {i} ---\n{top_lines}\n")
    except:
        pass

with open(r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\pdf_baslik_raporu.txt", "w", encoding="utf-8") as f:
    f.writelines(text_dump)

print("PDF analiz edildi ve başlıklar çıkarıldı.")
