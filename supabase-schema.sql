-- DUS BANKASI — Supabase Schema
-- Supabase SQL Editor'e bu kodu yapıştır ve çalıştır

create table if not exists questions (
  id uuid default gen_random_uuid() primary key,
  lesson text not null,
  unit text not null,
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  option_e text not null,
  correct_answer text not null check (correct_answer in ('A','B','C','D','E')),
  explanation text not null default '',
  flagged boolean default false,
  flag_reason text default '',
  quality_flag text default null, -- NULL | 'kavramsal_kopya' | 'auto_deleted' | 'reviewed_keep'
  created_at timestamptz default now() not null
);

-- Row Level Security: Public read + insert (tek kullanıcı, auth yok)
alter table questions enable row level security;

create policy "Public read" on questions for select using (true);
create policy "Public insert" on questions for insert with check (true);
create policy "Public delete" on questions for delete using (true);
create policy "Public update" on questions for update using (true) with check (true);

-- is_favorite kolonu
alter table questions add column if not exists is_favorite boolean default false;

-- Kalite Flag Migrasyonu: Post-production deduplication sonuçları
-- Değerler: NULL (işlenmedi) | 'kavramsal_kopya' (pipeline flagged) | 'auto_deleted' (silinecek) | 'reviewed_keep' (manuel onay)
alter table questions add column if not exists quality_flag text default null;

-- ─── İSTATİSTİK SENKRON TABLOSU ────────────────────────────────────────────
create table if not exists question_stats (
  id uuid default gen_random_uuid() primary key,
  device_id text not null,
  question_id uuid references questions(id) on delete cascade,
  attempts integer not null default 0,
  corrects integer not null default 0,
  last_seen timestamptz default now(),
  updated_at timestamptz default now(),
  unique(device_id, question_id)
);

-- Faz 1 Migrasyon: Hata Pattern Analizi için yanlış cevap geçmişi
-- Format: [{"selected": "B", "timestamp": "2026-04-15T14:22:00Z"}, ...]
alter table question_stats add column if not exists wrong_choices jsonb default '[]'::jsonb;

-- Faz 2 Migrasyon: FSRS-5 scheduling state (SM-2 → FSRS geçişi)
-- Her cihazın kendi FSRS state'i — merge sırasında en yüksek attempts kazanır
alter table question_stats add column if not exists stability double precision;
alter table question_stats add column if not exists difficulty double precision;
alter table question_stats add column if not exists last_review date;
alter table question_stats add column if not exists scheduled_days integer;
alter table question_stats add column if not exists fsrs_reps integer;

alter table question_stats enable row level security;

create policy "Public read stats" on question_stats for select using (true);
create policy "Public insert stats" on question_stats for insert with check (true);
create policy "Public update stats" on question_stats for update using (true) with check (true);
create policy "Public delete stats" on question_stats for delete using (true);

-- ─── AKTİF OTURUM TABLOSU ────────────────────────────────────────────────────
create table if not exists active_sessions (
  device_id text primary key,
  session_data jsonb not null,
  updated_at timestamptz default now()
);

alter table active_sessions enable row level security;
create policy "Public read sessions" on active_sessions for select using (true);
create policy "Public insert sessions" on active_sessions for insert with check (true);
create policy "Public update sessions" on active_sessions for update using (true) with check (true);
create policy "Public delete sessions" on active_sessions for delete using (true);

-- ─── MIGRATIONS ──────────────────────────────────────────────────────────────
-- Mevcut tabloya quality_flag eklemek için (bir kez çalıştırın):
-- alter table questions add column if not exists quality_flag text default null;

-- ─── FAZ 4: SEMANTİK KOPYA KONTROLÜ (OpenAI pgvector) ───────────────────────
-- 1. pgvector uzantısını aktifleştir
create extension if not exists vector;

-- 2. questions tablosuna 1536 boyutlu embedding kolonu ekle (OpenAI text-embedding-3-small)
alter table questions add column if not exists embedding vector(1536);

-- 3. Semantik aramalar için indeks (HNSW) ekle
create index if not exists questions_embedding_idx on questions using hnsw (embedding vector_cosine_ops);

-- 4. Vektör Araması (RPC) Fonksiyonu Tanımla
create or replace function match_questions_semantic (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_lesson text
)
returns table (
  id uuid,
  question text,
  unit text,
  similarity float
)
language sql
as $$
  select
    q.id,
    q.question,
    q.unit,
    1 - (q.embedding <=> query_embedding) as similarity
  from questions q
  where q.lesson = p_lesson
    and 1 - (q.embedding <=> query_embedding) > match_threshold
  order by q.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Dashboard İçin Vektör Araması (ID ile)
create or replace function match_questions_semantic_by_id (
  v_id uuid,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  question text,
  unit text,
  lesson text,
  similarity float
)
language plpgsql
as $$
declare
  query_embedding vector(1536);
begin
  select embedding into query_embedding from questions where questions.id = v_id;
  
  if not found then
    return;
  end if;

  return query
    select
      q.id,
      q.question,
      q.unit,
      q.lesson,
      1 - (q.embedding <=> query_embedding) as similarity
    from questions q
    where q.id != v_id
      and 1 - (q.embedding <=> query_embedding) > match_threshold
    order by q.embedding <=> query_embedding
    limit match_count;
end;
$$;
