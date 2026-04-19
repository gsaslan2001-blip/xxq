import difflib
import json
import re

with open(r'C:\Users\FURKAN\Desktop\DUS\protez\Yeni klasör\pdf_baslik_raporu.txt', encoding='utf-8') as f:
    text = f.read()

pages_raw = text.split('--- SAYFA ')
pages = {}
for p in pages_raw:
    if not p.strip(): continue
    parts = p.split('\n', 1)
    if len(parts) == 2:
        num = parts[0].replace(' ---', '').strip()
        pages[int(num)] = parts[1].strip()

units = [
    'Diş Anatomisi', 'Oklüzyonun Temelleri', 'Yüz Arkı Kullanımı', 'Tek Diş Restorasyonlarda Tedavi Planlaması', 'Eksik Diş Varlığında Tedavi Planlaması', 'Diş Preparasyon Prensipleri', 'Yaygın Hasarlı Dişlerin Preparasyonu', 'Periodontal Olarak Zayıf Dişlerin Preparasyonu', 'Geçici Restorasyonlar', 'Sıvı ve Yumuşak Doku Kontrolü', 'Ölçü', 'Çalışma Modelleri ve Day', 'Mum Modelasyon ve Döküm', 'Bitirme İşlemi ve Simanlar', 'Estetik Düzenlemeler', 'Dental Porselenler', 'Laminate Veneerler', 'Adeziv Restorasyonlar', 'Gövdeler ve Dişsiz Kretler', 'Hareketli Bölümlü Protezler', 'Kısmi Dişsiz Ağızların Sınıflandırılması', 'Hareketli Bölümlü Protezlerde Biyomekanik', 'Hbp Parçaları', 'Hareketli Bölümlü Protezlerde', 'Hareketli Bölümlü Protezlerde Oklüzyon', 'Astarlama ve Kaide Yenileme', 'Uyumlama ve Hasta Eğitimi', 'Tam Protezler', 'Destek Dokuların Makroskobik Anatomisi', 'Yüz Kasları', 'Tam Protezlerde Ölçü', 'Çene İlişkilerinin Kaydı', 'Tam Protezlerde Diş Seçimi ve Diş Dizimi', 'Dişli Prova', 'Total Protezlerde Bitim', 'Tam Protezlerde Oklüzyon', 'Yumuşak Astar Materyalleri', 'Overdenture Protezler', 'Tek Tam Protezler', 'Protez Stomatit', 'Tam Protezlerde Konuşma ve Ses Oluşumu', 'Temporomandibular Eklem Anatomisi', 'Diş Hekimliğinde Maddeler Bilgisi', 'Diş Hekimliğinde Zirkonya', 'İmplant Protezler', 'Çene Yüz Protezleri'
]

mapped = []
for u in units:
    best_page = -1
    u_normalized = u.lower().replace('i̇', 'i').replace('ı', 'i').strip()
    
    for p_num, content in pages.items():
        if p_num == 0: continue
        content_norm = content.lower().replace('\n', ' ')
        if u_normalized in content_norm:
            best_page = p_num
            break
        
        words = u_normalized.split()
        if len(words) > 1:
            pattern = '.*'.join(words)
            if re.search(pattern, content_norm):
                best_page = p_num
                break
                
    mapped.append(f"    ({best_page}, '{u}'),")

output = "[\n" + "\n".join(mapped) + "\n]"
print(output)
