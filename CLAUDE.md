# CLAUDE.md — DUSBANKASI Proje Rehberi

> **Claude Code için Başucu Belgesi.** Bu dosyayı oku, sonra çalışmaya başla.
> Projeyi her seferinde sıfırdan tarama. Bu dosya tek doğruluk kaynağındır.

---

## 0. PROJE KİMLİĞİ

| Alan | Değer |
|---|---|
| Proje Adı | DUSBANKASI (package.json'da: `odusbircanavari`) |
| Amaç | DUS (Diş Hekimliği Uzmanlık Sınavı) soru bankası + adaptif öğrenme |
| Stack | React 19 + TypeScript / Vite 8 + Supabase + Python 3.12 |
| Deploy | Vercel (`vercel.json` mevcut) — `gsaslan2001-blip/xxq` repo'sundan otomatik |
| Repo | `gsaslan2001-blip/xxq` (GitHub) |
| Canlı URL | https://odusbircanavari.vercel.app |

---

## 1. FULL KLASÖR HARİTASI

```
DUSBANKASI/
├── src/                          # React/TS frontend
│   ├── App.tsx                   # Ana orkestrasyon + AppState yönetimi
│   ├── index.css                 # CSS tokenları (var(--color-*) semantic sistem)
│   ├── data.ts                   # Question tipi tanımı
│   ├── types/app.ts              # AppState ve diğer tip tanımları
│   ├── hooks/
│   │   ├── useQuestions.ts       # Supabase CRUD + optimistic updates
│   │   ├── useAuth.ts            # Supabase Auth hook
│   │   ├── useResumableSession.ts # Yarım kalan oturum yönetimi
│   │   ├── useRealtimeStats.ts   # Realtime istatistik senkronizasyonu
│   │   ├── useExamTimer.ts       # Sınav sayacı
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useAIAssistant.ts
│   ├── components/
│   │   ├── quiz/
│   │   │   ├── QuizView.tsx      # Soru çözüm ekranı
│   │   │   ├── QuestionCard.tsx
│   │   │   ├── ExplanationPanel.tsx
│   │   │   ├── QuizHeader.tsx
│   │   │   └── QuizNavigation.tsx
│   │   ├── ai/AIAssistantPanel.tsx
│   │   ├── AuthModal.tsx
│   │   ├── DailyPlanView.tsx
│   │   ├── ErrorAnalyticsView.tsx
│   │   ├── SimulationResultView.tsx
│   │   └── SourceBooksView.tsx
│   ├── lib/
│   │   ├── supabase.ts           # ⭐ Supabase client + tüm DB fonksiyonları
│   │   ├── adaptive.ts           # Akıllı soru seçim motoru
│   │   ├── fsrs.ts               # FSRS-5 spaced repetition algoritması
│   │   ├── stats.ts              # İstatistik yönetimi (local + cloud sync)
│   │   ├── auth.ts               # Auth yardımcıları
│   │   ├── ai.ts                 # AI entegrasyonu
│   │   ├── shuffle.ts            # Fisher-Yates shuffle
│   │   ├── markdown.ts
│   │   └── dateUtils.ts
│   ├── config/learning.ts        # Öğrenme parametreleri
│   └── theme/index.ts            # Tema tanımları
│
├── scripts/                      # Python soru üretim + denetim hattı
│   ├── notebooklm-exhaust.py     # ⭐ ANA ÜRETİM MOTORU (Gemini 2.0 Flash)
│   ├── run_production.py         # Orkestrasyon — tüm üniteler için döngü
│   ├── shared.py                 # OpenAI Embedding (1536-dim) + Filtreler
│   ├── config.py                 # API anahtarları
│   ├── session_keeper.py         # NotebookLM oturum canlı tutma
│   ├── lib/
│   │   ├── db_layer.py           # Asenkron DB katmanı (aiohttp + Semaphore(10))
│   │   └── lsh_matcher.py        # MinHash LSH deduplication O(log N)
│   └── tools/
│       ├── smart_audit_pipeline.py   # Otomatik denetim (LSH + Semantic Match)
│       ├── backfill_embeddings.py    # ⚠️ BUGLU — 400/404 hatası (bkz. §6)
│       ├── batch_rollback.py         # Parti geri alma (3 katmanlı güvenlik)
│       ├── bulk_quality_audit.py     # Toplu kalite denetimi
│       ├── check_expl_dupes.py       # Açıklama kopyası tespiti
│       ├── delete_ids_from_report.py # Rapor üzerinden toplu silme
│       ├── requeue_rejected.py       # Reddedilmiş soruları kurtarma
│       ├── rescue_data.py            # Veri kurtarma
│       ├── rescue_uncovered.py       # Kapsanmamış kavramlar kurtarma
│       ├── split_pdf_auto.py         # PDF bölme
│       ├── check_db_all.py           # DB soru sayısı dağılımı
│       ├── advanced_map.py           # PDF karakter/font haritası
│       └── analyze_pdf.py            # PDF içerik yapısı analizi
│
├── raporlar/                     # bulk_quality_audit JSON çıktıları
├── public/                       # Statik dosyalar
│
├── supabase-schema.sql           # ⭐ ANA DB ŞEMASI
├── migration-v2-auth.sql         # v2 Auth + pg_cron + Realtime migration
├── .env.local.example            # Env template
├── package.json
├── vite.config.ts
├── tsconfig.app.json
├── vercel.json
└── _archive/                     # ⛔ KULLANMA — Eski scriptler
```

---

## 2. VERİTABANI ŞEMASI (Supabase PostgreSQL)

### Tablo: `questions` (Ana tablo)

```sql
id            uuid PRIMARY KEY
lesson        text NOT NULL          -- Ders adı ("Fizyoloji", "Patoloji" vb.)
unit          text NOT NULL          -- Ünite adı
question      text NOT NULL
option_a..e   text NOT NULL          -- 5 şık
correct_answer text CHECK IN ('A','B','C','D','E')
explanation   text NOT NULL          -- Root-cause + klinik bağlam (motivasyonel dil YASAK)
flagged       boolean DEFAULT false
flag_reason   text DEFAULT ''
quality_flag  text DEFAULT NULL      -- NULL | 'kavramsal_kopya' | 'auto_deleted' | 'reviewed_keep'
is_favorite   boolean DEFAULT false
embedding     vector(1536)           -- OpenAI text-embedding-3-small
created_at    timestamptz
```

**⚠️ quality_flag Uyarısı:** pg_cron her Pazar 03:00'da `kavramsal_kopya` olanları (7 günden eskiyse) `auto_deleted`'a çevirir. Şu an ~166 kavramsal_kopya + ~4000 auto_deleted var. Frontend client-side Set ile her ikisini de filtreler.

### Tablo: `question_stats`

```sql
device_id     text NOT NULL
user_id       uuid → auth.users(id)
question_id   uuid → questions(id)
attempts / corrects / last_seen / wrong_choices jsonb
-- FSRS-5: stability, difficulty, last_review, scheduled_days, fsrs_reps
```

### Tablo: `active_sessions`

```sql
device_id text PRIMARY KEY
user_id   uuid → auth.users(id)
session_data jsonb NOT NULL
updated_at timestamptz
```

### Kritik RPC Fonksiyonları

```sql
match_questions_semantic(query_embedding, match_threshold, match_count, p_lesson)
match_questions_semantic_by_id(v_id, match_threshold, match_count)
merge_device_stats_to_user(p_device_id, p_user_id)  -- Login sonrası çağır
```

### pg_cron (migration-v2-auth.sql)
- **02:00 her gece** → 7 günden eski anonim session'ları sil
- **03:00 her Pazar** → `kavramsal_kopya` (7 gün+) → `auto_deleted`'a geçir

---

## 3. FRONTEND MİMARİSİ

### Startup Akışı (`App.tsx`)

```
1. useEffect → loadQuestions() çağrılır
2. fetchQuestions() → recursive fetchPage(0,1000,2000,...) ile TÜM sorular çekilir
3. Client-side Set filtresi: kavramsal_kopya + auto_deleted elenir
4. questions state → 9627 soru (Nisan 2026 itibarıyla)
```

### ⭐ Kritik: fetchQuestions Mimarisi (`src/lib/supabase.ts`)

```typescript
const EXCLUDED_FLAGS = new Set(['kavramsal_kopya', 'auto_deleted']);
// Supabase OR filter syntax (not.in. içinde) çalışmıyor — client-side filtre zorunlu
```

**Kesinlikle dokunma:** `.or('quality_flag.is.null,quality_flag.not.in.(...)')` syntax'ı supabase-js'te broken — sadece NULL olanları döndürür, 5000'de takılır. Mevcut client-side filtreleme çözümü doğru ve stabil.

### AppState Akışı

Ana modlar: `select-lesson` → `select-unit` → `quiz` | `select-deneme` → `select-deneme-amount` → `exam` | `simulation` | `analytics` | `error-analysis`

### Adaptif Motor (`src/lib/adaptive.ts`)
- **FSRS Urgency: %50** — Tekrar zamanı gelenler
- **Weakness Score: %35** — Hata oranı yüksek konular
- **New Exploration: %15** — Hiç görülmemiş sorular
- **Interleaving** → Ardışık aynı ders gelmez

### FSRS-5 (`src/lib/fsrs.ts`)
Kullanıcı tepkisine (Zor/Orta/Kolay) göre `stability`, `difficulty`, `scheduled_days` hesaplar.

### Design System
`src/index.css` semantic tokenları. **Ad-hoc renk yasak:**
```css
/* DOĞRU */ var(--color-bg-primary), var(--color-text-secondary)
/* YANLIŞ */ #1a1a2e, rgb(255,255,255)
```

---

## 4. PYTHON SORU ÜRETİM HATTI

### Çevre Değişkenleri

```python
# scripts/config.py
OPENAI_API_KEY = "..."    # text-embedding-3-small (1536-dim)
GEMINI_API_KEY = "..."    # Gemini 2.0 Flash (üretim)
```

```bash
# .env.local
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Üretim Akışı

```
1. PDF hazırla
   python scripts/tools/split_pdf_auto.py

2. Soru üret
   python scripts/notebooklm-exhaust.py --lesson Fizyoloji --unit "Kalp Fizyolojisi"

3. Semantik denetim (BATCH BİTTİKTEN SONRA — 1 kez)
   python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji

4. Temizlik
   DELETE FROM questions WHERE quality_flag = 'kavramsal_kopya';
```

### Smart Audit Puanlama
```
Klinik vaka içeriyor    → +10p
"Hangisidir / Nedir"    → +5p
"Değildir / Yanlıştır"  → -15p
10 kelimeden kısa       → -5p
Cosine similarity > 0.85 → ikiz kabul → düşük puanlı elenecek
```

---

## 5. KOMUT REFERANSI

```bash
# Üretim
python scripts/notebooklm-exhaust.py --lesson Fizyoloji --unit "Kalp"

# Denetim
python scripts/tools/smart_audit_pipeline.py --lesson Fizyoloji
python scripts/tools/bulk_quality_audit.py --lesson Fizyoloji
python scripts/tools/check_expl_dupes.py --lesson Fizyoloji

# Geri alma (ÖNCE dry-run ZORUNLU)
python scripts/tools/batch_rollback.py --dry-run --lesson Fizyoloji --since 2026-04-18
python scripts/tools/batch_rollback.py --lesson Fizyoloji --since 2026-04-18

# DB durum
python scripts/tools/check_db_all.py

# Frontend
npm run dev
npm run build
npm run lint
```

---

## 6. AÇIK BUG: backfill_embeddings.py

**Sorun:** Mevcut ~9600 sorunun `embedding` kolonunu doldurmak için yazılan script, Supabase'e PATCH atarken `400/404` hatası veriyor.

**Kök neden tahmini:** `pgvector` kolonuna Python `list` gönderilirken PostgREST JSON serialization uyuşmazlığı.

**Düzeltme noktası:** `scripts/tools/backfill_embeddings.py` → `patch_embedding()` fonksiyonu.

**Not:** Schema'da `vector(1536)` (OpenAI) var. Backfill öncesi hangi embedding modeli kullanılacağını kullanıcıya sor.

---

## 7. VERİ TUTARSIZLIKLARI (Çözüldü — 2026-04-19)

Aşağıdaki tutarsızlıklar Supabase SQL ile düzeltildi:

```sql
-- 1. Histoloji'ye yanlış kaydedilmiş Periodontoloji üniteleri
UPDATE questions SET lesson = 'Periodontoloji'
WHERE lesson = 'Histoloji'
AND unit IN ('2.C)Etiyoloji','3.a - Gingival Hastalıklar',
             '6.b - Cerrahi Teknikler 1','6.c - Cerrahi Teknikler 2',
             '7.b - İleri Cerrahi İşlemler 2');

-- 2. Endodonti Ünite 2 isim çakışması
UPDATE questions
SET unit = 'Ünite 2 - KÖK KANAL ANATOMİSİ ve GİRİŞ KAVİTESİ PREPARASYONU'
WHERE lesson = 'Endodonti' AND unit = 'Ünite 2 - KÖK KANAL ANATOMİSİ';

-- 3. Periodontoloji Ünite 4 format çakışması
UPDATE questions
SET unit = '4.a - Periodontal Epidemiyoloji'
WHERE lesson = 'Periodontoloji' AND unit = 'Ünite 4 - Periodontal Epidemiyoloji';
```

Benzer pipeline hatası oluşursa aynı pattern'i uygula.

---

## 8. KATİ KURALLAR (İSTİSNASIZ)

### ⛔ YAPMA
1. `scripts/_archive/` altındaki eski scriptleri asla çalıştırma
2. `fetchQuestions`'daki client-side filtreyi kaldırıp Supabase `.or()` syntax'ına dönme — supabase-js `not.in.` broken
3. DB değişikliği yapmadan `supabase-schema.sql`'i okumadan işlem yapma
4. `explanation` kısımlarında motivasyonel dil kullanma
5. `npm run build` öncesi TypeScript hata kontrolü atlatma

### ✅ YAPILACAKLAR
- CSS değişikliklerinde `var(--color-*)` tokenlarını kullan
- `batch_rollback` öncesi her zaman `--dry-run` çalıştır
- Soru üretiminden sonra `smart_audit_pipeline` tetikle
- DB şema değişikliği gerekirse `supabase-schema.sql`'e de yaz
- Pipeline'dan gelen sorular yanlış derse kaydolmuşsa §7'deki SQL pattern'ini uygula

---

## 9. MİMARİ KARARLAR VE GEREKÇELER

| Karar | Gerekçe |
|---|---|
| Client-side quality_flag filtresi | Supabase-js `.or()` içinde `not.in.` broken → 5000'de takılıyor |
| Recursive fetchPage (PAGE_SIZE=1000) | Supabase `count: exact` güvenilmez; terminal koşul = sayfa < 1000 |
| OpenAI text-embedding-3-small (1536-dim) | Standart üretim embedding modeli |
| MinHash LSH O(log N) | Eski O(N²) Jaccard'ın yerine, ölçeklenebilir |
| aiohttp + asyncio.Semaphore(10) | Bloklayan urllib'den kurtulma |
| FSRS-5 (SM-2 yerine) | Bilişsel bilim destekli, daha doğru tekrar planlaması |
| device_id → user_id migration | v2 Auth'da anonimden kullanıcıya soft geçiş |
| pg_cron | Sunucu-side otomasyon (temizlik, flag geçişi) |

---

## 10. NEREDE NE ARANIR

| Ne arıyorsun? | Nereye bak? |
|---|---|
| Supabase pagination + filtre | `src/lib/supabase.ts` → `fetchQuestions` + `EXCLUDED_FLAGS` |
| Startup soru yükleme | `src/App.tsx` → `useEffect(() => loadQuestions())` |
| Soru üretim mantığı | `scripts/notebooklm-exhaust.py` |
| Embedding + filtreler | `scripts/shared.py` |
| DB yazma optimizasyonu | `scripts/lib/db_layer.py` |
| Kopya tespiti | `scripts/lib/lsh_matcher.py` |
| Frontend quiz akışı | `src/components/quiz/QuizView.tsx` |
| Soru sıralama algoritması | `src/lib/adaptive.ts` |
| FSRS hesaplama | `src/lib/fsrs.ts` |
| İstatistik (local+cloud) | `src/lib/stats.ts` |
| DB şeması | `supabase-schema.sql` |
| Auth + cron migration | `migration-v2-auth.sql` |

---

## 11. GÜNCEL DURUM (2026-04-19)

**Soru Sayısı:** ~9627 (kavramsal_kopya + auto_deleted hariç)

**Aktif Dersler:**
- Endodonti (25 ünite), Fizyoloji (10 ünite), Histoloji (17 ünite)
- Patoloji (18 ünite), Periodontoloji (13 ünite), Protez (40+ ünite)
- Radyoloji (48+ ünite)

**Tamamlanan (Bu Oturum):**
- Supabase pagination sorunu çözüldü (5000 → 9627)
- Client-side quality_flag filtresi eklendi
- Histoloji/Periodontoloji ders karışıklığı düzeltildi
- Endodonti Ünite 2 ve Periodontoloji Ünite 4 isim çakışmaları çözüldü

**Açık:**
- `backfill_embeddings.py` 400/404 bug → embedding kolonu eksik (~9600 soruda)
- Backfill tamamlandığında CurationDashboard semantik ikiz gösterimi aktif olacak

---

*Bu dosya projeye `CLAUDE.md` adıyla kök dizine yerleştirilir. Claude Code her oturumda önce okur.*
