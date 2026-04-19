import fitz  # PyMuPDF
import re

PDF_PATH = r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\Protetik Diş Tedavisi.pdf"
doc = fitz.open(PDF_PATH)

units = [
    'Diş Anatomisi', 'Oklüzyonun Temelleri', 'Yüz Arkı Kullanımı', 'Tek Diş Restorasyonlarda Tedavi Planlaması', 'Eksik Diş Varlığında Tedavi Planlaması', 'Diş Preparasyon Prensipleri', 'Yaygın Hasarlı Dişlerin Preparasyonu', 'Periodontal Olarak Zayıf Dişlerin Preparasyonu', 'Geçici Restorasyonlar', 'Sıvı ve Yumuşak Doku Kontrolü', 'Ölçü', 'Çalışma Modelleri ve Day', 'Mum Modelasyon ve Döküm', 'Bitirme İşlemi ve Simanlar', 'Estetik Düzenlemeler', 'Dental Porselenler', 'Laminate Veneerler', 'Adeziv Restorasyonlar', 'Gövdeler ve Dişsiz Kretler', 'Hareketli Bölümlü Protezler', 'Kısmi Dişsiz Ağızların Sınıflandırılması', 'Hareketli Bölümlü Protezlerde Biyomekanik', 'Hbp Parçaları', 'Hareketli Bölümlü Protezlerde Ölçü', 'Hareketli Bölümlü Protezlerde Laboratuar', 'Hareketli Bölümlü Protezlerde Oklüzyon', 'Astarlama ve Kaide Yenileme', 'Uyumlama ve Hasta Eğitimi', 'Tam Protezler', 'Destek Dokuların Makroskobik Anatomisi', 'Yüz Kasları', 'Tam Protezlerde Ölçü', 'Çene İlişkilerinin Kaydı', 'Tam Protezlerde Diş Seçimi ve Diş Dizimi', 'Dişli Prova', 'Total Protezlerde Bitim', 'Tam Protezlerde Oklüzyon', 'Yumuşak Astar Materyalleri', 'Overdenture Protezler', 'Tek Tam Protezler', 'Protez Stomatit', 'Tam Protezlerde Konuşma ve Ses Oluşumu', 'Temporomandibular Eklem Anatomisi', 'Diş Hekimliğinde Maddeler Bilgisi', 'Diş Hekimliğinde Zirkonya', 'İmplant Protezler', 'Çene Yüz Protezleri'
]

def normalize(text):
    return text.lower().replace("i̇", "i").replace("ı", "i").strip()

print("Sayfalar ön belleğe alınıyor...")
cache = []
for p_num in range(4, len(doc)):
    page = doc[p_num]
    cache.append({
        "p_num": p_num,
        "text": normalize(page.get_text()),
        "blocks": page.get_text("dict").get("blocks", [])
    })

mapped = []
print("Arama yapılıyor...")

for u in units:
    u_norm = normalize(u)
    best_page = -1
    highest_font_size = 0
    words = u_norm.split()
    
    for c in cache:
        p_num = c["p_num"]
        text_content = c["text"]
        blocks = c["blocks"]
        
        page_best_size = 0
        found_in_page = False
        
        # Kelimelerin hepsi geçiyor mu
        if all(w in text_content for w in words):
            for b in blocks:
                if b.get('type') == 0:
                    for l in b.get('lines', []):
                        for s in l.get('spans', []):
                            text_span = normalize(s.get('text', ''))
                            if any(w in text_span for w in words):
                                size = s.get('size', 0)
                                if size > page_best_size:
                                    page_best_size = size
            
            found_in_page = True
            
        if found_in_page and page_best_size > highest_font_size:
            highest_font_size = page_best_size
            best_page = p_num + 1 # 1-indexed

    mapped.append((best_page, u, round(highest_font_size, 1)))

with open(r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\pymupdf_mapped.txt", "w", encoding="utf-8") as f:
    for page, title, size in mapped:
        f.write(f"SAYFA: {page} | FONT: {size} -> {title}\n")

print("PyMuPDF analiz bitti.")
