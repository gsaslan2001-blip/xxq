# AGENTS.md — DUSBANKASI Ajan Manifestosu

> Bu dosya ajan bağlamını sabitleyen **tek yetkili kaynaktır.**  
> Her oturumda ilk oku. Kullanıcı isteğini bu dosyaya göre yorumla.  
> Mimari detaylar → [CLAUDE.md](./CLAUDE.md)

---

## ⚙️ Tech Stack

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Frontend | React + TypeScript + Vite | React **19**, Vite **8** |
| Styling | Tailwind CSS | **4** |
| Backend | Supabase (PostgreSQL + pgvector) | pgvector **1536-dim** |
| Embedding | OpenAI text-embedding-3-small | **1536-dim** |
| Soru Üretimi | Python + Gemini 2.0 Flash + NotebookLM | Python 3.12 |
| Soru Kalitesi | smart_audit_pipeline.py (LSH + Cosine sim) | — |
| Tekrar Sistemi | FSRS-5 | `src/lib/fsrs.ts` |
| Deploy | Vercel | `gsaslan2001-blip/xxq` → https://odusbircanavari.vercel.app |

---

## 🚫 Kesin Yasaklar

- `fetchQuestions`'daki client-side filtre + recursive mimariye **dokunma** — Supabase `.or()` içinde `not.in.` broken, değiştirirsen 5000'de takılır
- Supabase `.or('quality_flag.is.null,quality_flag.not.in.(...)')` syntax'ını kullanma
- Explanation alanlarına motivasyonel cümle yazma ("Tebrikler!", "Bu önemli!")
- `lesson` ve `unit` field değerlerini AI modeline ürettirme → her zaman parametre olarak geç
- `batch_rollback.py`'ı `--dry-run` olmadan çalıştırma

---

## 📁 Kritik Dosya Haritası

```
src/
  App.tsx                    # Ana state makinesi (AppState: quiz/exam/sim/analytics/daily-exam-setup...)
  lib/supabase.ts            # ⭐ DB client — fetchQuestions recursive + EXCLUDED_FLAGS
  lib/adaptive.ts            # Soru sıralama: FSRS%50 + Weakness%35 + New%15 + buildDailyExam()
  lib/fsrs.ts                # FSRS-5 algoritması
  lib/stats.ts               # Local + cloud istatistik senkronizasyonu
  hooks/useQuestions.ts      # CRUD + optimistic updates (startup: loadQuestions)
  components/quiz/           # Quiz UI (QuizView, QuestionCard, ExplanationPanel...)

scripts/
  config.py                  # Tüm API key ve sabitler — .gitignore'da
  shared.py                  # DB yazma (chunked 10'arlık), kalite gate, checkpoint
  notebooklm-exhaust.py      # ⭐ Ana üretim motoru (Anchor → Exhaust → Deploy)
  run_production.py          # Tüm dersleri sırayla işleyen orkestratör
  session_keeper.py          # NotebookLM oturum canlı tutma
  tools/
    smart_audit_pipeline.py  # Ölüm Maçı — semantik deduplikasyon
    backfill_embeddings.py   # ✅ Tamamlandı (10,768 satır, 2026-04-19) — yeniden çalıştırma gerekmez
    batch_rollback.py        # Hatalı üretimleri geri al (ÖNCE --dry-run)
    rescue_data.py           # Veri kurtarma
    rescue_uncovered.py      # --uncovered-only modu ile kapsanmamış kavramlar
  logs/                      # exhaust_*.txt batch logları — DEĞERLİ, silme
  recovery/
    pending/                 # Supabase'e yazılmayı bekleyen checkpoint'ler
    rejected/                # Kalite gate'i geçemeyen sorular
```

---

## 🗄️ DB Kuralları

**Aktif dersler (Nisan 2026):** `Endodonti` · `Fizyoloji` · `Histoloji` · `Patoloji` · `Periodontoloji` · `Protez` · `Radyoloji`

- `lesson`: Supabase'deki exact değer — büyük/küçük harf duyarlı
- `unit`: PDF dosya adıyla eşleşmeli — boşluk ve karakter duyarlı
- Supabase'e yazma her zaman **10'arlık chunk** ile yapılır (HTTP 500 önleyici)
- Checkpoint dosyaları timestamp içerir: `Histoloji_3_hücre_iskelet_20260419_133521_pending.json`
- `quality_flag` değerleri: `NULL` (göster) · `kavramsal_kopya` (gizle) · `auto_deleted` (gizle) · `reviewed_keep` (göster)

**⚠️ pg_cron etkisi:** Her Pazar `kavramsal_kopya` → `auto_deleted`'a geçer. Şu an ~166 kavramsal_kopya + ~4000 auto_deleted. Toplam DB satırı: **10,768** (tümünde embedding). Görünür soru ≈ **~6,600**.

---

---

## 🔄 Üretim Hattı Akışı (V3 Exhaustive — Nisan 2026)

1. **[FAZ 0] Çapalama & Hazırlık:** NotebookLM kaynağı okur, tüm konseptleri "çapa" çıkartır. DB'de o ünite için mevcut sorular kontrol edilir.
2. **[FAZ 1] Master Batch & Kavram İşleme:** 25'lik kavram dilimleri halinde Gemini 2.0 Flash üretim yapar.
3. **[FAZ 2] Yerel Koruma (Checkpoint):** Sorular `recovery/pending/` a zaman damgalı JSON olarak kaydedilir.
4. **[FAZ 3] Yapısal Kalite Kontrol (Quality Gate):** Şık sayısı, metin uzunluğu, açıklama bütünlüğü. Geçemeyenler `recovery/rejected/` a düşer.
5. **[FAZ 4] Vektörleme ve Parçalı Yazım:** OpenAI 1536-dim embedding → 10'luk chunk insert.
6. **[FAZ POST] Ölüm Maçı:** `smart_audit_pipeline.py` → Cosine > 0.85 ikizleri tespit → `quality_flag = 'kavramsal_kopya'`.

---

## 📥 Manuel Soru Ekleme Protokolü (/soru-ekle)

Kullanıcıdan gelen ham soruları DUSBANKASI formatına çevirme ve yükleme akışı:

1. **Format Dönüşümü:** Ham metin/dosya -> Standart JSON şeması.
2. **🛑 Kalite Gate (Zorunlu):**
   - Soru metni tam mı?
   - 5 Şık (A-E) tam ve anlamlı mı?
   - Doğru cevap işlenmiş mi?
   - Açıklama (explanation) alanı dolu mu?
   - `lesson` ve `unit` tanımlanmış mı?
3. **Deploy:** `deploy_to_supabase` (OpenAI Embedding + Chunked Write).


---

## 🔧 Supabase Pagination — Kritik Bilgi

`fetchQuestions` optimize edilmiş mimariyle çalışır (`src/lib/supabase.ts`):

```typescript
const PAGE_SIZE = 500;
const EXCLUDED_FLAGS = new Set(['kavramsal_kopya', 'auto_deleted']);

// Sunucu filtresi: is.null + eq. — not.in. broken olduğu için kullanılmıyor
q.or('quality_flag.is.null,quality_flag.eq.reviewed_keep')

// Paralel 2'li fetch + withRetry(3) + client-side EXCLUDED_FLAGS yedek
```

**Neden böyle?**
- `not.in.` içindeki `.or()` supabase-js'te broken → 5000'de takılır
- `count: exact` güvenilmez → terminal koşul = sayfa < PAGE_SIZE
- PAGE_SIZE=500 → her istek daha hafif, timeout riski azalır
- Paralel 2'li fetch → ~2× yükleme hızı
- `withRetry(3)` → timeout senaryolarında otomatik kurtarma

---

## ✅ Tamamlanan İşler

### Nisan 2026
- [x] Supabase pagination sorunu çözüldü (5000 → tam veri)
- [x] Client-side `EXCLUDED_FLAGS` filtresi eklendi
- [x] `fetchQuestions` optimize edildi: PAGE_SIZE→500, sunucu filtresi, paralel 2'li fetch, retry
- [x] Histoloji'ye yanlış kaydedilmiş 5 Periodontoloji ünitesi düzeltildi
- [x] Endodonti Ünite 2 isim çakışması çözüldü
- [x] Periodontoloji Ünite 4 format çakışması çözüldü
- [x] Checkpoint üzerine yazma hatası düzeltildi (`shared.py`)
- [x] Supabase chunked write (10'arlık) uygulandı
- [x] V3 Exhaustive Pipeline + pg_cron migration
- [x] FSRS-5, Adaptif motor, Simülasyon, Hata analizi, AI asistan
- [x] `backfill_embeddings.py` 400/404 bug çözüldü — 10,768 satır, ~$0.065, ~21 dakika
- [x] Tüm sorularda `text-embedding-3-small (1536-dim)` embedding mevcut
- [x] `match_questions_semantic` RPC tam kapasite aktif

### Mayıs 2026
- [x] **Günün Denemesi** özelliği eklendi ve production'a deploy edildi (2026-05-11)
  - `buildDailyExam()` motoru: %80 yeni + %20 hard→medium→easy fallback
  - `DailyExamSetup` komponenti: ünite seçici + soru sayısı slider + canlı önizleme
  - `'daily-exam-setup'` AppState eklendi
  - `.vercelignore` oluşturuldu (upload 468MB → 118B)
  - Detay: `HANDOVER_REPORT_20260511.md`

## ⏳ Açık İşler

- Açık görev bulunmamaktadır. Tüm sistem stabildir.
