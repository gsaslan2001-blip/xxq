# DUSBANKASI — DUS Hazırlık Platformu

> Diş Hekimliği Uzmanlık Sınavı (DUS) için AI destekli adaptif soru bankası.  
> Canlı: **https://odusbircanavari.vercel.app**

---

## Nedir?

DUSBANKASI, DUS adaylarının soru çözerken aynı zamanda öğrenmesini sağlayan bir eğitim platformudur. Soru bankası Python pipeline ile otomatik üretilir; öğrenme motoru FSRS-5 algoritmasıyla kişiselleştirilmiş tekrar planı oluşturur.

**Şu an:** ~9600+ soru · 7 ders · Endodonti, Fizyoloji, Histoloji, Patoloji, Periodontoloji, Protez, Radyoloji

---

## Özellikler

**Çalışma Modları**
- **Ünite Modu** — Seçili üniteden soru çöz, FSRS ile akıllı sıralama
- **Deneme Modu** — Birden fazla ünitten karma soru seç
- **Simülasyon** — Gerçek DUS formatında zamanlı sınav (50-200 soru)
- **Zayıf Konu Tekrarı** — Hata oranı yüksek sorular önce gelir
- **Vadesi Gelenler** — FSRS'in tekrar zamanı geldiğini işaretlediği sorular
- **Favoriler** — Yıldızladığın sorulardan özel set

**Adaptif Motor**
- FSRS-5 Spaced Repetition (Aciliyet %50)
- Zayıflık skoru (Hata oranı %35)
- Yeni keşif (Görülmemiş %15)
- Interleaving — ardışık aynı ders gelmez

**Diğer**
- Oturum devam ettirme (yarım kalan quiz kaldığı yerden)
- Hata analizi dashboard'u
- Günlük plan görünümü
- Kaynak kitap yönetimi
- Supabase Auth ile bulut istatistik senkronizasyonu

---

## Tech Stack

| Katman | Teknoloji |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8 + Tailwind CSS 4 |
| Backend | Supabase (PostgreSQL + pgvector 1536-dim) |
| AI/ML | FSRS-5 · OpenAI text-embedding-3-small |
| Soru Üretimi | Python 3.12 · Gemini 2.0 Flash · NotebookLM |
| Deploy | Vercel |

---

## Kurulum

### Ön Koşullar
- Node.js 20+
- Python 3.12+
- Supabase projesi (schema için `supabase-schema.sql`)

### Frontend

```bash
git clone https://github.com/gsaslan2001-blip/xxq
cd xxq
npm install

# .env.local oluştur
cp .env.local.example .env.local
# VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY değerlerini doldur

npm run dev       # http://localhost:5173
npm run build     # Prodüksiyon build
```

### Python Pipeline (Soru Üretimi)

```bash
pip install aiohttp openai google-genai numpy

# scripts/config.py içine API anahtarlarını gir:
# OPENAI_API_KEY, GEMINI_API_KEY, NOTEBOOK_ID

# Soru üret
python scripts/notebooklm-exhaust.py --lesson Fizyoloji --unit "Kalp Fizyolojisi"

# Semantik denetim (üretim sonrası)
python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji
```

---

## Veritabanı Kurulumu

Supabase SQL Editor'de sırayla çalıştır:

```sql
-- 1. Ana şema
-- supabase-schema.sql içeriğini yapıştır

-- 2. Auth + pg_cron migration
-- migration-v2-auth.sql içeriğini yapıştır
```

---

## Soru Üretim Mimarisi

```
PDF Kaynakları
    ↓ split_pdf_auto.py (25 sayfalık üniteler)
NotebookLM / Gemini 2.0 Flash
    ↓ notebooklm-exhaust.py (Exhaustive Coverage)
Quality Gate (yapısal filtreler)
    ↓ recovery/rejected/ (başarısızlar)
OpenAI Embedding (1536-dim)
    ↓
Supabase DB
    ↓ smart_audit_pipeline.py (LSH + Cosine > 0.85)
Kavramsal kopya → quality_flag = 'kavramsal_kopya'
    ↓ pg_cron (Her Pazar)
quality_flag = 'auto_deleted'
```

**Puanlama (Smart Audit Ölüm Maçı):**
- Klinik vaka → +10p (korunur)
- "Nedir/Hangisidir" → +5p
- "Değildir/Yanlıştır" → -15p (elenir)
- 10 kelimeden kısa → -5p

---

## Geliştirici Notları

### Kritik: Supabase Pagination

`fetchQuestions` recursive fetchPage mimarisi kullanır — `count: exact` güvenilmez, Supabase `.or()` içinde `not.in.` broken. Kalite filtresi client-side `Set` ile uygulanır:

```typescript
const EXCLUDED_FLAGS = new Set(['kavramsal_kopya', 'auto_deleted']);
```

Bu mimariyi değiştirme — `.or()` syntax'ına dönersen 5000'de takılır.

### Env Değişkenleri

```
VITE_SUPABASE_URL         — Supabase proje URL
VITE_SUPABASE_ANON_KEY    — Supabase anon key
OPENAI_API_KEY            — scripts/config.py (embedding)
GEMINI_API_KEY            — scripts/config.py (üretim)
NOTEBOOK_ID               — scripts/config.py (NotebookLM)
```

### npm Scriptler

```bash
npm run dev       # Geliştirme (Vite HMR)
npm run build     # tsc + vite build
npm run preview   # Build önizleme
npm run lint      # ESLint
```

---

## Proje Yapısı

```
src/
├── App.tsx                 # Ana state makinesi
├── lib/supabase.ts         # DB client + fetchQuestions (recursive)
├── lib/adaptive.ts         # Soru sıralama motoru
├── lib/fsrs.ts             # FSRS-5 algoritması
├── hooks/useQuestions.ts   # CRUD + optimistic updates
└── components/quiz/        # Quiz UI

scripts/
├── notebooklm-exhaust.py   # Ana üretim motoru
├── shared.py               # Embedding + filtreler
└── tools/                  # Audit, rollback, cleanup araçları
```

Detaylı mimari ve kurallar için → **[CLAUDE.md](./CLAUDE.md)**

---

## Lisans

Özel kullanım. Tüm haklar saklıdır.
