-- ═══════════════════════════════════════════════════════════════════
-- DUS BANKASI v2 — Auth + pg_cron + Realtime Migration
-- Supabase Dashboard > SQL Editor'e yapıştır ve çalıştır
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. question_stats'a user_id kolonu ──────────────────────────────
ALTER TABLE question_stats
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- ─── 2. Partial unique index: user_id bazlı ──────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS question_stats_user_question_unique
  ON question_stats(user_id, question_id)
  WHERE user_id IS NOT NULL;

-- ─── 3. active_sessions'a user_id ────────────────────────────────────
ALTER TABLE active_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- ─── 4. Partial unique index: session per user ───────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS active_sessions_user_unique
  ON active_sessions(user_id)
  WHERE user_id IS NOT NULL;

-- ─── 5. Sorgu performansı index ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS question_stats_user_id_idx
  ON question_stats(user_id)
  WHERE user_id IS NOT NULL;

-- ─── 6. Cihaz istatistiklerini kullanıcıya merge eden PL/pgSQL fonk. ─
-- Giriş sonrası bir kez çağrılır: cihazın anonim verilerini kullanıcıya taşır.
-- Çakışmada: attempts, corrects, wrong_choices için en yüksek değer kazanır.
CREATE OR REPLACE FUNCTION merge_device_stats_to_user(p_device_id TEXT, p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  merged_count INTEGER := 0;
BEGIN
  INSERT INTO question_stats
    (device_id, user_id, question_id, attempts, corrects, last_seen, wrong_choices,
     stability, difficulty, last_review, scheduled_days, fsrs_reps)
  SELECT
    p_device_id, p_user_id, question_id, attempts, corrects, last_seen, wrong_choices,
    stability, difficulty, last_review, scheduled_days, fsrs_reps
  FROM question_stats
  WHERE device_id = p_device_id AND user_id IS NULL
  ON CONFLICT (user_id, question_id) WHERE user_id IS NOT NULL
  DO UPDATE SET
    attempts      = GREATEST(EXCLUDED.attempts,      question_stats.attempts),
    corrects      = GREATEST(EXCLUDED.corrects,      question_stats.corrects),
    last_seen     = GREATEST(EXCLUDED.last_seen,     question_stats.last_seen),
    wrong_choices = CASE
      WHEN jsonb_array_length(COALESCE(EXCLUDED.wrong_choices,      '[]'::jsonb)) >
           jsonb_array_length(COALESCE(question_stats.wrong_choices,'[]'::jsonb))
      THEN EXCLUDED.wrong_choices
      ELSE question_stats.wrong_choices
    END,
    stability     = COALESCE(EXCLUDED.stability,     question_stats.stability),
    difficulty    = COALESCE(EXCLUDED.difficulty,    question_stats.difficulty),
    last_review   = GREATEST(EXCLUDED.last_review,   question_stats.last_review),
    scheduled_days= COALESCE(EXCLUDED.scheduled_days,question_stats.scheduled_days),
    fsrs_reps     = GREATEST(
                      COALESCE(EXCLUDED.fsrs_reps,      0),
                      COALESCE(question_stats.fsrs_reps, 0)
                    );

  GET DIAGNOSTICS merged_count = ROW_COUNT;
  RETURN merged_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 7. RLS: Auth user kendi istatistiklerini okuyabilir/yazabilir ───
-- Mevcut "public" politikaları kaldır
DROP POLICY IF EXISTS "Public read stats"   ON question_stats;
DROP POLICY IF EXISTS "Public insert stats" ON question_stats;
DROP POLICY IF EXISTS "Public update stats" ON question_stats;
DROP POLICY IF EXISTS "Public delete stats" ON question_stats;

-- Yeni politikalar: giriş yapılmışsa user_id eşleştir, anonim ise device satırına izin ver
CREATE POLICY "Read own stats" ON question_stats
  FOR SELECT USING (
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    (auth.uid() IS NULL     AND user_id IS NULL)
  );

CREATE POLICY "Insert own stats" ON question_stats
  FOR INSERT WITH CHECK (
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    (auth.uid() IS NULL     AND user_id IS NULL)
  );

CREATE POLICY "Update own stats" ON question_stats
  FOR UPDATE USING (
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    (auth.uid() IS NULL     AND user_id IS NULL)
  );

CREATE POLICY "Delete own stats" ON question_stats
  FOR DELETE USING (
    (auth.uid() IS NOT NULL AND auth.uid() = user_id) OR
    (auth.uid() IS NULL     AND user_id IS NULL)
  );

-- ─── 8. pg_cron Görevleri ─────────────────────────────────────────────
-- ÖNKOŞUl: Supabase Dashboard > Database > Extensions > pg_cron aktif olmalı

-- 8a. Her gece 02:00 — 7 günden eski anonim session'ları temizle
SELECT cron.schedule(
  'cleanup-old-sessions',
  '0 2 * * *',
  $$DELETE FROM active_sessions
    WHERE updated_at < now() - interval '7 days'
      AND user_id IS NULL$$
);

-- 8b. Her Pazar 03:00 — kavramsal_kopya flaglı soruları auto_deleted'a geçir
SELECT cron.schedule(
  'auto-delete-flagged-questions',
  '0 3 * * 0',
  $$UPDATE questions
    SET quality_flag = 'auto_deleted'
    WHERE quality_flag = 'kavramsal_kopya'
      AND created_at < now() - interval '7 days'$$
);

-- ─── 9. Realtime için tabloları publish et ───────────────────────────
-- question_stats ve active_sessions'ı Realtime yayınına ekle
ALTER PUBLICATION supabase_realtime ADD TABLE question_stats;
ALTER PUBLICATION supabase_realtime ADD TABLE active_sessions;
