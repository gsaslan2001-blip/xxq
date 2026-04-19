import re
from pypdf import PdfReader
import difflib

PDF_PATH = r"C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\Protetik Diş Tedavisi.pdf"
reader = PdfReader(PDF_PATH)

units = [
    'Diş Anatomisi', 'Oklüzyonun Temelleri', 'Yüz Arkı Kullanımı', 'Tek Diş Restorasyonlarda Tedavi Planlaması', 'Eksik Diş Varlığında Tedavi Planlaması', 'Diş Preparasyon Prensipleri', 'Yaygın Hasarlı Dişlerin Preparasyonu', 'Periodontal Olarak Zayıf Dişlerin Preparasyonu', 'Geçici Restorasyonlar', 'Sıvı ve Yumuşak Doku Kontrolü', 'Ölçü', 'Çalışma Modelleri ve Day Yapımı', 'Mum Modelasyon ve Döküm', 'Bitirme İşlemi ve Simanlar', 'Estetik Düzenlemeler', 'Dental Porselenler', 'Laminate Veneerler', 'Adeziv Restorasyonlar', 'Gövdeler ve Dişsiz Kretler', 'Hareketli Bölümlü Protezler', 'Kısmi Dişsiz Ağızların Sınıflandırılması', 'Hareketli Bölümlü Protezlerde Biyomekanik', 'Hbp Parçaları', 'Hareketli Bölümlü Protezlerde Ölçü', 'Hareketli Bölümlü Protezlerde Laboratuar Aşamaları', 'Hareketli Bölümlü Protezlerde Oklüzyon', 'Hareketli Bölümlü Protezlerde Astarlama ve Kaide Yenileme', 'Hareketli Bölümlü Protezlerde Uyumlama ve Hasta Eğitimi', 'Tam Protezler', 'Destek Dokuların Makroskobik Anatomisi', 'Yüz Kasları', 'Tam Protezlerde Ölçü', 'Çene İlişkilerinin Kaydı', 'Tam Protezlerde Diş Seçimi ve Diş Dizimi', 'Dişli Prova', 'Total Protezlerde Bitim', 'Tam Protezlerde Oklüzyon', 'Yumuşak Astar Materyalleri', 'Overdenture Protezler', 'Tek Tam Protezler', 'Protez Stomatit', 'Tam Protezlerde Konuşma ve Ses Oluşumu', 'Temporomandibular Eklem Anatomisi', 'Diş Hekimliğinde Maddeler Bilgisi', 'Diş Hekimliğinde Zirkonya', 'İmplant Protezler', 'Çene Yüz Protezleri'
]

def normalize_text(text):
    return text.lower().replace('i̇', 'i').replace('ı', 'i').strip()

# PDF sayfalarını belleğe al (TOC olan ilk 4 sayfayı atlıyoruz "Diş Anatomisi Sayfa 5" dendiğine göre TOC ilk sayfalarda bitiyor)
pages_text = {}
for i in range(4, len(reader.pages)):
    try:
        pages_text[i] = normalize_text(reader.pages[i].extract_text() or "")
    except:
        pages_text[i] = ""

result = []
for u in units:
    u_norm = normalize_text(u)
    found_page = -1
    
    # Kelimeleri böl. Örn: "Oklüzyonun Temelleri"
    words = u_norm.split()
    
    for p_num in range(4, len(reader.pages)):
        content = pages_text[p_num]
        
        # Tam eşleşme ara
        if u_norm in content:
            found_page = p_num
            break
            
        # Eğer kelimeler çok yakın geçiyorsa (genelde büyük başlıklar satır atlar)
        if len(words) > 1:
            # Sadece o sayfada tüm kelimeler birbirinden makul uzaklıkta geçiyorsa
            pattern = r'.*?'.join([re.escape(w) for w in words])
            if re.search(pattern, content, re.DOTALL):
                found_page = p_num
                break

    # Sonuçları gerçek PDF 1-indexed çevir p_num her zaman index'tir bu algoritmada.
    # PyPDF2 pages[i] 0-indexed'dir. Kullanıcıya sayacın gördüğünü (i+1) vereceğiz.
    if found_page != -1:
        # found_page zaten index'ti, insan okuması için +1 yapıyoruz.
        actual_page = found_page + 1 
    else:
        actual_page = "BULUNAMADI"
        
    result.append((u, actual_page))

# Çıktıyı dosyaya yaz (Türkçe karakter sorunu olmasın diye)
with open(r'C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\kesin_sayfalar.txt', 'w', encoding='utf-8') as f:
    for u, p in result:
        f.write(f"{p} - {u}\n")

print("Tamamlandı. kesin_sayfalar.txt kontrol edin.")
