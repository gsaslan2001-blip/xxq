# Claude İçin Görev Devir Planı: DUSBANKASI Semantik Modernizasyon

Bu döküman, DUSBANKASI projesinin mimari modernizasyon sürecinde gelinen noktayı ve Claude'un devralması gereken teknik detayları içerir.

## 🎯 Proje Hedefi
Soru üretim ve denetim hattını (Pipeline) senkron ve hantal yapıdan; asenkron, vektörel zeka destekli ve performanslı bir ajan mimarisine taşımak.

## ✅ Tamamlananlar (Modernizasyon Faz 1-5)
1.  **Asenkron Mimari:** `urllib` tabanlı bloklayan çağrılar yerine `aiohttp` ve `asyncio.Semaphore(10)` ile paralel DB katmanı (`scripts/lib/db_layer.py`) kuruldu.
2.  **LSH Deduplication:** $O(N^2)$ olan Jaccard benzerlik kontrolü, MinHash LSH (`scripts/lib/lsh_matcher.py`) ile $O(\log N)$ seviyesine çekildi.
3.  **Semantik Zeka:** `google-genai` SDK entegre edildi. `gemini-embedding-001` (3072 boyut) modeli ile anlamsal vektörleme altyapısı kuruldu.
4.  **Supabase pgvector:** Veritabanına `vector(3072)` kolonu eklendi ve `match_questions_semantic_by_id` RPC fonksiyonu tanımlandı.
5.  **Curation Dashboard:** React tarafında `@tanstack/react-virtual` ile on binlerce soruyu 60fps akıcılıkta listeleyen, "Yan Yana" ikiz soru karşılaştırma ekranı (`src/components/CurationDashboard.tsx`) eklendi.

## ❌ Çözülemeyen / Devredilen Sorun: Backfill Fail
Veritabanındaki mevcut ~9.000 sorunun anlamsal zekaya kavuşması için yazılan `scripts/tools/backfill_embeddings.py` scripti başarısız oluyor.

### Teknik Engel:
- **Hata:** Supabase PATCH istekleri `400/404` hataları veriyor.
- **Tahmin:** PostgREST üzerinden `pgvector` kolonunu güncellerken gönderilen `json` array formatı veya Python listesinin string cast işlemi (örn: `"[0.1, 0.2]"` vs `[0.1, 0.2]`) uyuşmazlığa yol açıyor.
- **Gemini Tarafı:** `gemini-embedding-001` modeli başarılı bir şekilde 3072 boyutlu vektör dönüyor (Doğrulandı).

## 🛠 Claude'un İncelemesi Gereken Kritik Dosyalar
1.  **`scripts/tools/backfill_embeddings.py`:** Bu dosyadaki `patch_embedding` fonksiyonunun Supabase ile el sıkışması düzeltilmeli.
2.  **`supabase-schema.sql`:** Faz 4 ve Faz 5 bölümlerindeki SQL komutlarının (özellikle RPC fonksiyonları) doğru çalıştığından emin olunmalı.
3.  **`scripts/shared.py`:** Soru üretim sırasında embedding çıkaran `_write_to_supabase` mantığı burada yer alıyor.
4.  **`src/components/CurationDashboard.tsx`:** UI tarafındaki side-by-side karşılaştırma logic'i.

## 🚀 Beklenen Sonuç
Eski soruların vektörleri başarıyla doldurulduğunda, Dashboard üzerinde her sorunun "İkizi" (Twin) anlık olarak anlamsal benzerlik yüzdesiyle beraber yan yana listelenebilecek.
