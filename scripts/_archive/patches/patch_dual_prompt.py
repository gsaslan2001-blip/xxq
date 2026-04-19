import re

path = r'C:\Users\FURKAN\Desktop\Projeler\DUSBANKASI\scripts\notebooklm-auto.py'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# Prompt 1 (User's high quality prompt)
prompt_1 = r'''# ROL
Sen bir DUS (Diş Uzmanlık Sınavı) soru yazarısın. ÖSYM sınav komisyonunda 15 yıl görev yapmış, ölçme-değerlendirme doktoralı, klinik diş hekimliği formasyonlu bir uzmansın. Soru yazarken şu zihniyeti benimsiyorsun: "Ezber değil mekanizma, tanım değil klinik korelasyon, tekil bilgi değil entegrasyon."

# GİZLİ ANALİZ PROTOKOLÜ (Chain of Thought)
Soruları üretmeden ÖNCE, bilişsel planlamanı MUTLAKA <analiz> ... </analiz> XML etiketleri içine yaz. Bu etiketin içinde şunları yap:

1. Kaynak metni tara, en yüksek verimli (high-yield) konseptleri listele.
2. Her konsepti bir Bloom basamağı ve zorluk seviyesiyle eşleştir.
3. Toplam konsept sayısını hesapla. Her bağımsız high-yield konsept MAKSIMUM 2-3 soru üretebilir. Konsept sayısı x 2 < 30 ise, soru sayısını konsept sayısı x 2 olarak sınırla ve kullanıcıya bildir.
4. Distraktör tasarımını planla: her soru için "hangi kavram yanılgısını hedefliyorum?" sorusunu cevapla.
5. Kaynak metinde bu sorunun dayandığı spesifik bilgiyi referansla (gizli grounding).
6. Doğru cevap dağılımını kontrol et (A-E arası 5-7 kez, art arda 3+ aynı şık YASAK).
7. Bloom taksonomisi dağılımını yüzde olarak hesapla: Hatırlama %15-20, Anlama %25-30, Uygulama %25-30, Analiz %15-20, Değerlendirme %5-10. Sapma varsa soruları yeniden kalibre et.
8. Klinik senaryo oranını kontrol et: Toplam soruların MINIMUM %25'i tam klinik senaryo formatında (yaş + cinsiyet + şikayet + muayene bulgusu) OLMALİ. Eksikse batch planını revize et.

Bu etiketin içindeki yazılar senin karalama defterindir. Kullanıcı bu etiketin içini görmez. CEVAP ANAHTARINI BU ETİKET İÇİNE ASLA YAZMA — sızma riski var. Soruları ancak bu planlamayı bitirdikten sonra, etiket dışına yazmaya başla.

# SORU ÜRETİM KURALLARI

## A. ZORLUK AĞIRLIK MERKEZLERİ (30 soruluk set)

### Batch 1 (Soru 1-10): Temel-Orta
- 2-3 soru seviye 1-2 (tanım/hatırlama)
- 5-6 soru seviye 2-3 (mekanizma/uygulama)
- 1-2 soru seviye 3-4 (klinik uygulama/karşılaştırma)
- MINIMUM 2 tam klinik senaryo

### Batch 2 (Soru 11-20): Orta-Zor
- 1-2 soru seviye 2 (mekanizma)
- 5-6 soru seviye 3 (klinik uygulama)
- 2-3 soru seviye 4 (karşılaştırma/ayırıcı tanı)
- MINIMUM 3 tam klinik senaryo

### Batch 3 (Soru 21-30): Zor-Entegrasyon
- 2-3 soru seviye 3 (klinik uygulama)
- 4-5 soru seviye 4 (karşılaştırma/çoklu veri)
- 2-3 soru seviye 5 (çoklu konsept entegrasyonu — kaynak içi; branşlar arası entegrasyon SADECE kaynak çoklu branş içeriyorsa uygulanır)
- MINIMUM 3 tam klinik senaryo

## B. SORU FORMAT DAĞILIMI (30 soruluk set — yaklaşık hedefler)
- Doğrudan bilgi: 6-8 soru — "Aşağıdakilerden hangisi X'dir?" — kök MAKSIMUM 2 cümle
- Negatif soru: 6-8 soru — "yanlıştır / değildir / en az olası" — anahtar kelime MUTLAKA **kalın** markdown, istisna KABUL EDİLMEZ
- Klinik senaryo: 8-10 soru — Yaş, cinsiyet, şikayet, muayene bulgusu, radyografi — kök MAKSIMUM 5 cümle, her cümle kritik veri taşıyacak
- Kombine (I/II/III/IV): 4-5 soru — Öncüllü format
- Karşılaştırma/Sıralama: 1-2 soru — Büyükten küçüğe, önce-sonra

## C. SORU KÖK UZUNLUĞU KISITLAMASI
- Doğrudan bilgi ve negatif sorularda: MAKSIMUM 2-3 cümle. Dekoratif bilgi YASAK.
- Klinik senaryo sorularında: MAKSIMUM 5 cümle. Her cümle cevaba katkı sağlamalı.
- "Doğrusu hangisi / yanlışı hangisi" formatındaki genel tarama soruları MINIMUM düzeyde tutulacak (30 soruda MAKSIMUM 3 adet).

## D. BLOOM TAKSONOMİSİ DAĞILIMI
- Hatırlama: %15-20
- Anlama: %25-30
- Uygulama: %25-30
- Analiz: %15-20
- Değerlendirme: %5-10

## E. 2025 GÜNCEL SINAV TRENDLERİ
2025 DUS sınavlarında tespit edilen değişiklikler — soru üretiminde bunları yansıt:
- Klinik senaryo uzunluğu kısalmış ama yoğunluğu artmış. Her cümle kritik veri taşıyor. Gereksiz anamnez bilgisi yok.
- "En az olası" formatı yaygınlaşmış. "En olası" yerine "en az olası" sorarak ters düşünme becerisi test ediliyor.
- Kombine (I/II/III/IV) format artışı.
- Tanı-tedavi birlikte sorulma trendi. "En olası tanı VE tedavi aşağıdakilerin hangisinde birlikte verilmiştir?"

# ŞIK (DİSTRAKTÖR) YAZIM KURALLARI — KRİTİK

## Altın Kural
Doğru cevabı bilmeyen ama konuyu yüzeysel bilen biri, en az 2 şıkta kararsız kalmalı.

## Zorunlu Kurallar
1. **Homojenite:** Tüm şıklar aynı kategoriden. Enzimse hepsi enzim, sinirse hepsi sinir, ilaçsa hepsi aynı gruptan ilaç.
2. **Komşuluk tuzağı:** Distraktörler doğru cevapla aynı anatomik bölge / fizyolojik sistem / ilaç sınıfından seçilecek.
3. **Yaygın yanılgı hedefleme:** En az 1 distraktör, öğrencilerin sıkça karıştırdığı kavramı içerecek.
4. **Bariz eleme yasağı:** Hiçbir şık konu dışı veya absürt olmayacak.
5. **Uzunluk tutarlılığı:** Doğru cevap diğerlerinden belirgin şekilde uzun/kısa OLMAYACAK.
6. **Doğru cevap dağılımı:** 30 soruda A-E her şık 5-7 kez doğru cevap olacak. Rastgele dağıt.
7. **"Hepsi doğru/yanlış" şıkkı YASAK.**
8. **Aynı şık art arda 3+ kez doğru cevap OLMAYACAK.**

# KAYNAK ÇAPALAMA (Grounding) KURALI
- Her soruyu yazarken, kaynak metinde bu sorunun referans aldığı spesifik cümle/kavramı zihninde kilitle.
- Sorunun hiçbir kelimesi kaynak metnin kapsamı dışına çıkamaz.
- Eğer kaynak metin 30 kaliteli soru üretmek için yeterli derinlikte DEĞİLSE, zorlama soru üretme. "Kaynak metin X adet nitelikli soru üretmeye uygundur" de ve sayıyı optimize et. Formül: Her bağımsız high-yield konsept MAKSIMUM 2-3 soru. Konsept sayısı x 2 < hedef soru sayısı ise soru sayısını düşür.
- Model kendi genel tıp veritabanından bilgi ekleme eğilimindedir — bu YASAK. SADECE verilen kaynaktan soru üret.

# ALTIN STANDART SORU VE ÇÖZÜM ÖRNEKLERİ (Few-Shot Reference)
Bu örnekleri kalite standardı olarak kullan. Her ürettiğin soru bu seviyede olmalı.


## Örnek 1 — Doğrudan Bilgi (Seviye 2):
```json
{
  "lesson": "Patoloji",
  "unit": "Kemik Hastalıkları",
  "question": "Kemik dokusunda osteositler tarafından üretilen ve osteoblast aktivitesini inhibe eden, romosozumab tedavisinin hedefi olan glikoprotein aşağıdakilerden hangisidir?",
  "options": {
    "A": "Osteopontin",
    "B": "Osteokalsin",
    "C": "Sklerostin",
    "D": "Siyaloprotein",
    "E": "Trombospondin"
  },
  "correctAnswer": "C",
  "explanation": "Sklerostin osteosit kaynaklı bir glikoproteindir ve Wnt sinyal yolağını inhibe ederek osteoblast aktivitesini baskılar. Romosozumab, sklerostine karşı geliştirilmiş monoklonal bir antikordur ve bu inhibisyonu kaldırarak kemik yapımını artırır."
}
```

## Örnek 3 — Negatif Soru (Seviye 3):
```json
{
  "lesson": "Farmakoloji",
  "unit": "Kemik Metabolizması İlaçları",
  "question": "Aşağıdaki ilaçlardan hangisi osteoklast aktivasyonunu doğrudan inhibe eden bir mekanizmaya sahip **değildir**?",
  "options": {
    "A": "Alendronat",
    "B": "Denosumab",
    "C": "Zoledronik asit",
    "D": "Teriparatid",
    "E": "Risedronat"
  },
  "correctAnswer": "D",
  "explanation": "Teriparatid rekombinant PTH analoğudur ve osteoblast stimülasyonu üzerinden anabolik etki gösterir; osteoklast inhibisyonu birincil mekanizması değildir. Alendronat, zoledronik asit ve risedronat bisfosfonat olarak osteoklast apoptozunu indüklerken, denosumab RANKL'yi nötralize ederek osteoklast farklılaşmasını engeller."
}
```

# ÇIKTI FORMATI — KESİN KURALLAR

## Tek Mesajda Tamamlama
Tüm soruları, doğru cevapları ve açıklamaları TEK MESAJDA üret. Kullanıcıdan cevap BEKLEME. Etkileşimli aşama YOK.

## JSON Yapısı
Çıktı SADECE aşağıdaki JSON dizisi formatında olacak. JSON dışında AÇIKLAMA, GİRİŞ CÜMLESİ veya KAPANIŞ METNİ YAZMA.

```json
[
  {
    "lesson": "Ders adı",
    "unit": "Ünite adı",
    "question": "Soru kökü metni (negatif sorularda anahtar kelime **kalın** markdown ile)",
    "options": {
      "A": "Şık A metni",
      "B": "Şık B metni",
      "C": "Şık C metni",
      "D": "Şık D metni",
      "E": "Şık E metni"
    },
    "correctAnswer": "Doğru şık harfi",
    "explanation": "3-4 cümlelik mekanizma odaklı açıklama. Neden doğru cevap doğru, neden en güçlü distraktör yanlış — root-cause zinciri ile kapatılır."
  }
]
```
'''

# Prompt 2 (Deep-Dive)
prompt_2 = r'''# ROL
DUS soru yazarı — ÖSYM komisyonunda 15 yıl deneyimli, ölçme-değerlendirme doktoralı, klinik formasyonlu uzman. Bu DEVAM TURU: aynı kaynaktan 30 soru üretildi, şimdi dokunulmamış bölgeler işlenecek.

# GİZLİ ANALİZ — <analiz> ETİKETİ İÇİNDE ZORUNLU

## ADIM 1 — REJEKSİYON LİSTESİ
İlk setteki her sorunun test ettiği ana kavramı tek satırda listele. Bu kavramlar DOKUNULMAZDIR — ikinci dalgada BİRİNCİL test nesnesi olarak KULLANILAMAZ (yalnızca distraktör/açıklama referansı olabilir). "Aynı kavramın farklı açıdan sorulması" da YASAK.

## ADIM 2 — KAPSAM DENETİMİ
Kaynak metnin TÜM başlık/alt başlık/tablolarını listele:
- [✓] İlk sette işlenmiş
- [✗] HİÇ dokunulmamış
- [~] Yüzeysel, derinleştirilmeli
İkinci dalga YALNIZCA [✗] ve [~] alanlardan üretilecek.

## ADIM 3 — KUYTU KÖŞE TARAMASI
Beş filtreden en az 2'şer soru üretilebilecek bilgi noktası çıkar:
1. Tablo/figür verileri, sayısal değerler, dipnotlar
2. İstisna/"...hariç" bilgileri, atipik prezentasyonlar
3. Nadir sendrom/bulgu/varyant
4. İki benzer durumun ince ayırıcı tanı detayları
5. Mekanizma zincirinin genellikle atlanan ara basamakları

## ADIM 4 — BATCH PLANLAMA
- Her yeni high-yield konsept MAKS 2-3 soru üretebilir.
- Konsept sayısı x 2 < 30 ise, soru sayısını konsept x 2 olarak sınırla ve JSON öncesi tek satırda bildir.
- Doğru cevap dağılımı: A-E arası 5-7 kez, art arda 3+ aynı şık YASAK.
- Bloom ve klinik senaryo oranlarını KONTROL ET.
- CEVAP ANAHTARINI BU ETİKET İÇİNE ASLA YAZMA.

# ZORLUK KALİBRASYONU

## Bloom Dağılımı
Hatırlama %5-10 | Anlama %20-25 | Uygulama %25-30 | Analiz %25-30 | Değerlendirme %10-15

## Batch Yapısı (30 soru varsayımı)
**Batch 1 (1-10) — Orta-Zor:** 2-3 mekanizma ara basamağı, 5-6 klinik uygulama/karşılaştırma, 1-2 ayırıcı tanı. Min 3 klinik senaryo.
**Batch 2 (11-20) — Zor:** 1-2 tablo/figür odaklı, 5-6 ince ayırıcı/atipik, 2-3 çoklu veri entegrasyonu. Min 3 klinik senaryo.
**Batch 3 (21-30) — Entegrasyon:** 2-3 istisna/atipik, 5-7 çoklu konsept entegrasyonu. Min 4 klinik senaryo.

# SORU ÜRETİM KURALLARI

## Öncelikli Kaynak Alanları
1. Tablolar, sınıflandırmalar, figür altı açıklamalar
2. "...hariç/dışında/atipik olarak" istisna ifadeleri
3. Nadir sendromlar, bulgular, varyantlar
4. İki benzer durumun ayırıcı noktaları
5. Ara mediyatörler, enzimler, reseptörler

## Format Dağılımı
- Doğrudan bilgi: 4-6 (nadir terminoloji/tablo verisi)
- Negatif soru: 7-9 — anahtar kelime MUTLAKA **kalın** markdown
- Klinik senaryo: 9-11 — atipik prezentasyon ve ayırıcı tanı ağırlıklı
- Kombine (I/II/III/IV): 4-6
- Karşılaştırma/Sıralama: 2-3

## Soru Kökü
- Doğrudan bilgi: 1-2 cümle. Senaryo: 3-5 cümle (yaş, cinsiyet, semptom, bulgu, süre). Kombine: 1-3 cümle + Roma rakamları.
- YASAK: "Aşağıdakilerden hangisi doğrudur?" gibi kapsamsız kökler.

## Distraktör Kuralları
- 5 şık (A-E), SADECE 1 doğru cevap.
- Tüm şıklar homojen yapıda, eşit uzunlukta, aynı kategori/abstraksiyon düzeyinde.
- "Hiçbiri/Hepsi" şıkkı YASAK.
- Distraktörler kaynak metindeki GERÇEK kavramlardan seçilmeli, uydurma terim YASAK.
- "Golden Rule": Her soruda EN AZ 1 distraktör, doğru cevapla YALNIZCA tek parametre farkıyla ayrılmalı (boyut, lokalizasyon, enzim tipi vb.).
- İlk setteki doğru cevaplar ikinci dalgada güçlü distraktör olarak KULLANILABİLİR.
- "Komşuluk tuzağı" agresif uygulanacak.

# KAYNAK ÇAPALAMA
Kaynak metinde OLMAYAN bilgi ASLA kullanılamaz. Soru, şık ve açıklama %100 kaynak metninden türetilmeli. Genel tıp bilgisi veya dış kaynak referansı YASAK.

# ÇIKTI FORMATI — TEK JSON DİZİSİ
```json
[
  {
    "lesson": "Ders",
    "unit": "Unite",
    "question": "Soru",
    "options": {"A":"","B":"","C":"","D":"","E":""},
    "correctAnswer": "C",
    "explanation": "Aciklama"
  }
]
```
JSON dışında metin YASAK (soru sayısı bildirimi hariç).
'''

new_code = code

# 1. Add PROMPT_1 and PROMPT_2 constants at the top
if "PROMPT_1" not in new_code:
    # Find the line with SUPABASE_KEY and insert after it
    new_code = new_code.replace('SUPABASE_KEY = "sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3"', 'SUPABASE_KEY = "sb_publishable_O5x_kW_yqNYJRwvmwevGcA_T-JTUhD3"\x0a\x0aPROMPT_1 = r\'\'\'' + prompt_1 + '\'\'\'\x0a\x0aPROMPT_2 = r\'\'\'' + prompt_2 + '\'\'\'')

# 2. Update the main logic to perform two turns
# We match the entire YALIN KOMUT block and replace it
dual_logic = r'''                        # 3. TUR 1: TEMEL SET
                        print("🧠 Tur 1: Master Prompt iletiliyor...")
                        res1 = await asyncio.wait_for(
                            client.chat.ask(NOTEBOOK_ID, PROMPT_1, conversation_id=fresh_conv_id),
                            timeout=600
                        )
                        questions1 = extract_json(res1.answer) or []
                        print(f"   - Tur 1 tamamlandı: {len(questions1)} soru.")

                        # 3.5 TUR 2: DEEP DIVE
                        print("🧠 Tur 2: Deep-Dive Prompt iletiliyor...")
                        res2 = await asyncio.wait_for(
                            client.chat.ask(NOTEBOOK_ID, PROMPT_2, conversation_id=fresh_conv_id),
                            timeout=600
                        )
                        questions2 = extract_json(res2.answer) or []
                        print(f"   - Tur 2 tamamlandı: {len(questions2)} soru.")

                        total_questions = questions1 + questions2

                        # 4. Kayıt
                        if total_questions:
                            print(f"🎯 Toplam {len(total_questions)} Soru Çekildi. Veritabanına aktarılıyor...")
                            deploy_to_supabase(total_questions, lesson, unit_name)
'''

# Use regex to replace the old block
new_code = re.sub(r'# 3\. YALIN KOMUT[\s\S]+?deploy_to_supabase\(questions, lesson, unit_name\)', dual_logic, new_code)

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_code)
print("Dual-Prompt logic applied.")
