import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
  },
});

export type QuestionRow = {
  id: string;
  lesson: string;
  unit: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation: string;
  created_at: string;
  is_favorite?: boolean;
  // AUDIT-03: DB şemasındaki flag alanları TypeScript type'a eklendi
  flagged?: boolean;
  flag_reason?: string;
  quality_flag?: string | null;
};

export type ImportQuestion = {
  lesson: string;
  unit: string;
  question: string;
  options: { A: string; B: string; C: string; D: string; E: string };
  correctAnswer: 'A' | 'B' | 'C' | 'D' | 'E';
  explanation: string;
};

export type QuestionMetadata = {
  id: string;
  lesson: string;
  unit: string;
  quality_flag?: string | null;
};

const SELECT_COLS = 'id,lesson,unit,question,option_a,option_b,option_c,option_d,option_e,correct_answer,explanation,created_at,is_favorite,flagged,flag_reason,quality_flag';
const METADATA_COLS = 'id,lesson,unit,quality_flag';
const PAGE_SIZE = 1000;

/**
 * Üretim ve performans krizi sonrası: Sadece metadata (ders/ünite listesi) yükler.
 * Bu sayede 140MB'lık devasa JSON yerine ~500KB veri çekilir.
 * Not: created_at toplu insertlerde aynı olduğu için pagination 'id' ile stabilize edildi.
 */
export async function fetchQuestionMetadata(): Promise<QuestionMetadata[]> {
  // Rely on recursive fetching instead of potentially wrong headers
  async function fetchAll(from: number): Promise<QuestionMetadata[]> {
    const { data, error } = await supabase
      .from('questions')
      .select(METADATA_COLS)
      .order('id', { ascending: true })
      .range(from, from + 1000 - 1);
    
    if (error) throw error;
    if (!data || data.length === 0) return [];
    
    // Eğer full sayfa (1000 satır) geldiyse sonraki sayfayı da dene
    if (data.length === 1000) {
      const next = await fetchAll(from + 1000);
      return [...data, ...next];
    }
    return data;
  }

  return fetchAll(0);
}

/**
 * Seçili ünitenin tüm detaylarını çeker (Lazy Load)
 * NOT: Supabase default'u 1000 satır — büyük üniteler için pagination zorunlu.
 */
export async function fetchQuestionsByUnit(lesson: string, unit: string): Promise<QuestionRow[]> {
  const all: QuestionRow[] = [];
  let from = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('questions')
      .select(SELECT_COLS)
      .match({ lesson, unit })
      .order('id', { ascending: true })
      .range(from, from + limit - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as QuestionRow[]));
    if (data.length < limit) break;
    from += limit;
  }
  return all;
}

const EXCLUDED_FLAGS = new Set(['kavramsal_kopya', 'auto_deleted']);

export async function fetchQuestions(flaggedOnly = false): Promise<QuestionRow[]> {
  async function fetchPage(from: number): Promise<QuestionRow[]> {
    let q = supabase
      .from('questions')
      .select(SELECT_COLS)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    const { data, error } = flaggedOnly
      ? await q.eq('quality_flag', 'kavramsal_kopya')
      : await q;

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return [];

    const rows = flaggedOnly
      ? (data as QuestionRow[])
      : (data as QuestionRow[]).filter(r => !EXCLUDED_FLAGS.has(r.quality_flag ?? ''));

    if (data.length === PAGE_SIZE) {
      const next = await fetchPage(from + PAGE_SIZE);
      return [...rows, ...next];
    }
    return rows;
  }

  return fetchPage(0);
}

export async function importQuestions(questions: ImportQuestion[]): Promise<number> {
  const rows = questions.map((q) => ({
    lesson: q.lesson,
    unit: q.unit,
    question: q.question,
    option_a: q.options.A,
    option_b: q.options.B,
    option_c: q.options.C,
    option_d: q.options.D,
    option_e: q.options.E,
    correct_answer: q.correctAnswer,
    explanation: q.explanation,
  }));

  const { data, error } = await supabase.from('questions').insert(rows).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

export function rowToQuestion(row: QuestionRow) {
  return {
    id: row.id,
    lesson: row.lesson,
    unit: row.unit,
    question: row.question,
    options: {
      A: row.option_a,
      B: row.option_b,
      C: row.option_c,
      D: row.option_d,
      E: row.option_e,
    },
    correctAnswer: row.correct_answer,
    explanation: row.explanation,
    is_favorite: row.is_favorite || false,
    quality_flag: row.quality_flag ?? null,
  };
}

export async function deleteQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteQuestionsInUnit(lesson: string, unit: string): Promise<void> {
  const { error } = await supabase.from('questions').delete().match({ lesson, unit });
  if (error) throw error;
}

export async function deleteQuestionsInLesson(lesson: string): Promise<void> {
  const { error } = await supabase.from('questions').delete().eq('lesson', lesson);
  if (error) throw error;
}

export async function deleteAllQuestions(): Promise<void> {
  const { error } = await supabase.from('questions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

export async function renameLesson(oldLesson: string, newLesson: string): Promise<void> {
  const { error } = await supabase.from('questions').update({ lesson: newLesson }).eq('lesson', oldLesson);
  if (error) throw error;
}

export async function renameUnit(lesson: string, oldUnit: string, newUnit: string): Promise<void> {
  const { error } = await supabase.from('questions').update({ unit: newUnit }).match({ lesson, unit: oldUnit });
  if (error) throw error;
}

export async function toggleFavoriteInCloud(id: string, newFavoriteStatus: boolean): Promise<void> {
  const { error } = await supabase.from('questions').update({ is_favorite: newFavoriteStatus }).eq('id', id);
  if (error) throw error;
}

export async function updateQuestion(id: string, fields: Partial<Omit<QuestionRow, 'id' | 'created_at'>>): Promise<void> {
  const { error } = await supabase.from('questions').update(fields).eq('id', id);
  if (error) throw error;
}

export async function flagQuestion(id: string, reason: string): Promise<void> {
  const { error } = await supabase.from('questions').update({ flagged: true, flag_reason: reason }).eq('id', id);
  if (error) throw error;
}

// ─── ACTIVE SESSION CLOUD SYNC ─────────────────────────────────────────────

/**
 * Aktif session'ı cloud'a kaydeder.
 * @param userId — Opsiyonel: giriş yapılmışsa user bazlı upsert.
 */
export async function saveSessionToCloud(
  deviceId: string,
  sessionData: object,
  userId?: string
): Promise<void> {
  const payload = {
    device_id: deviceId,
    user_id: userId ?? null,
    session_data: sessionData,
    updated_at: new Date().toISOString(),
  };
  const conflictTarget = userId ? 'user_id' : 'device_id';
  const { error } = await supabase
    .from('active_sessions')
    .upsert(payload, { onConflict: conflictTarget });
  if (error) throw error;
}

/**
 * Aktif session'ı cloud'dan yükler.
 * @param userId — Opsiyonel: giriş yapılmışsa user bazlı; yoksa device bazlı.
 */
export async function loadSessionFromCloud(
  deviceId: string,
  userId?: string
): Promise<object | null> {
  const query = supabase.from('active_sessions').select('session_data');
  const { data, error } = userId
    ? await query.eq('user_id', userId).maybeSingle()
    : await query.eq('device_id', deviceId).maybeSingle();
  if (error) throw error;
  return data?.session_data ?? null;
}

export async function deleteSessionFromCloud(deviceId: string): Promise<void> {
  const { error } = await supabase
    .from('active_sessions')
    .delete()
    .eq('device_id', deviceId);
  if (error) throw error;
}

// ─── STATS CLOUD SYNC ──────────────────────────────────────────────────────

/** Hata Pattern Analizi: Bir yanlış cevap denemesi */
export type WrongChoice = { selected: string; timestamp: string };

export type StatRow = {
  device_id: string;
  user_id?: string | null; // Auth: giriş yapılmışsa kullanıcı UUID'si
  question_id: string;
  attempts: number;
  corrects: number;
  last_seen: string;
  wrong_choices?: WrongChoice[];
  // Faz 2: FSRS-5 scheduling state
  stability?: number | null;
  difficulty?: number | null;
  last_review?: string | null;
  scheduled_days?: number | null;
  fsrs_reps?: number | null;
};

export type CloudStat = {
  attempts: number;
  corrects: number;
  lastSeen: string;
  wrongChoices?: WrongChoice[];
  // Faz 2: FSRS-5 alanları
  stability?: number;
  difficulty?: number;
  lastReview?: string;
  scheduledDays?: number;
  fsrsReps?: number;
};

/**
 * Local stats'ı cloud'a push eder (upsert, 500'lük batch).
 * @param userId — Opsiyonel: giriş yapılmışsa kullanıcı UUID'si.
 *   Varsa conflict `user_id,question_id`; yoksa `device_id,question_id`.
 */
export async function pushStatsToCloud(
  deviceId: string,
  stats: Record<string, CloudStat>,
  userId?: string
): Promise<void> {
  // Olası Foreign Key hatalarını önlemek için sistemdeki geçerli soru id'lerini çek (sadece silinmeyenler)
  const validIds = new Set<string>();
  let from = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.from('questions').select('id').range(from, from + limit - 1);
    if (error) throw error;
    if (data && data.length > 0) {
      data.forEach(r => validIds.add(r.id));
      if (data.length < limit) break;
      from += limit;
    } else break;
  }

  // user_id varsa user bazlı, yoksa device bazlı conflict resolution
  const conflictTarget = userId ? 'user_id,question_id' : 'device_id,question_id';

  const rows: StatRow[] = Object.entries(stats)
    .filter(([qId]) => validIds.has(qId))
    .map(([qId, s]) => ({
    device_id: deviceId,
    user_id: userId ?? null,
    question_id: qId,
    attempts: s.attempts,
    corrects: s.corrects,
    last_seen: s.lastSeen || new Date().toISOString(),
    wrong_choices: s.wrongChoices ?? [],
    stability: s.stability ?? null,
    difficulty: s.difficulty ?? null,
    last_review: s.lastReview ?? null,
    scheduled_days: s.scheduledDays ?? null,
    fsrs_reps: s.fsrsReps ?? null,
  }));
  if (rows.length === 0) return;
  const failedBatches: number[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const batchIndex = Math.floor(i / 500);
    const batch = rows.slice(i, i + 500);
    try {
      const { error } = await supabase
        .from('question_stats')
        .upsert(batch, { onConflict: conflictTarget });
      if (error) {
        console.warn(`[pushStatsToCloud] Batch ${batchIndex} hatası:`, error.message);
        failedBatches.push(batchIndex);
      }
    } catch (err) {
      console.warn(`[pushStatsToCloud] Batch ${batchIndex} exception:`, err);
      failedBatches.push(batchIndex);
    }
  }
  if (failedBatches.length > 0) {
    throw new Error(`${failedBatches.length} batch sync edilemedi (${failedBatches.join(', ')}). Kalan batch'ler yazıldı.`);
  }
}

const STAT_COLUMNS = 'question_id, attempts, corrects, last_seen, wrong_choices, stability, difficulty, last_review, scheduled_days, fsrs_reps';

type PulledStatRow = {
  question_id: string;
  attempts: number;
  corrects: number;
  last_seen: string;
  wrong_choices?: WrongChoice[];
  stability?: number | null;
  difficulty?: number | null;
  last_review?: string | null;
  scheduled_days?: number | null;
  fsrs_reps?: number | null;
};

function rowToCloudStat(row: PulledStatRow): CloudStat {
  return {
    attempts: row.attempts,
    corrects: row.corrects,
    lastSeen: row.last_seen,
    wrongChoices: row.wrong_choices ?? [],
    stability: row.stability ?? undefined,
    difficulty: row.difficulty ?? undefined,
    lastReview: row.last_review ?? undefined,
    scheduledDays: row.scheduled_days ?? undefined,
    fsrsReps: row.fsrs_reps ?? undefined,
  };
}

/**
 * Cloud stats'ını çeker.
 * @param userId — Opsiyonel: giriş yapılmışsa user bazlı; yoksa device bazlı.
 */
export async function pullStatsFromCloud(
  deviceId: string,
  userId?: string
): Promise<Record<string, CloudStat>> {
  const query = supabase.from('question_stats').select(STAT_COLUMNS);
  const { data, error } = userId
    ? await query.eq('user_id', userId)
    : await query.eq('device_id', deviceId);
  if (error) throw error;
  const result: Record<string, CloudStat> = {};
  for (const row of (data || []) as PulledStatRow[]) {
    result[row.question_id] = rowToCloudStat(row);
  }
  return result;
}

/** TÜM cihazların cloud stats'ını çeker ve her soru için en yüksek attempts olanı döner */
export async function pullAllDeviceStats(): Promise<Record<string, CloudStat>> {
  let allData: PulledStatRow[] = [];
  let from = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('question_stats')
      .select(STAT_COLUMNS)
      .order('attempts', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;
    if (data && data.length > 0) {
      allData = [...allData, ...(data as PulledStatRow[])];
      if (data.length < limit) break;
      from += limit;
    } else break;
  }
  const merged: Record<string, CloudStat> = {};
  for (const row of allData) {
    const existing = merged[row.question_id];
    if (!existing || row.attempts > existing.attempts) {
      merged[row.question_id] = rowToCloudStat(row);
    }
  }
  return merged;
}

/** Cihaza ait tüm istatistikleri cloud'dan siler (reset için). */
export async function clearDeviceStats(deviceId: string, userId?: string): Promise<void> {
  if (userId) {
    const { error } = await supabase.from('question_stats').delete().eq('user_id', userId);
    if (error) throw error;
  }
  const { error } = await supabase.from('question_stats').delete().eq('device_id', deviceId);
  if (error) throw error;
}

// ─── REFERENCE SOURCES (AI Kaynak Kitaplar) ────────────────────────────────

export type ReferenceSource = {
  id: string;
  lesson: string;
  unit: string | null;
  file_path: string;
  file_name: string;
  created_at: string;
};

const STORAGE_BUCKET = 'study-resources';

/** Tüm kaynak kitapları listeler */
export async function fetchReferenceSources(): Promise<ReferenceSource[]> {
  const { data, error } = await supabase
    .from('reference_sources')
    .select('*')
    .order('lesson', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Belirli bir ders/ünite için kaynak kitap getirir (hiyerarşik arama) */
export async function findReferenceSource(
  lesson: string,
  unit: string
): Promise<ReferenceSource | null> {
  // 1. Önce üniteye özel kaynak ara
  const { data: unitData } = await supabase
    .from('reference_sources')
    .select('*')
    .eq('lesson', lesson)
    .eq('unit', unit)
    .limit(1)
    .maybeSingle();

  if (unitData) return unitData as ReferenceSource;

  // 2. Yoksa dersin genel kaynağını ara (unit = null)
  const { data: lessonData } = await supabase
    .from('reference_sources')
    .select('*')
    .eq('lesson', lesson)
    .is('unit', null)
    .limit(1)
    .maybeSingle();

  return (lessonData as ReferenceSource) ?? null;
}

/** PDF'i Supabase Storage'a yükler ve metadata'yı reference_sources'a kaydeder */
export async function uploadReferenceSource(
  file: File,
  lesson: string,
  unit: string | null
): Promise<ReferenceSource> {
  // Dosya adını temizle ve benzersiz yap
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeLesson = lesson.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeUnit = unit ? unit.replace(/[^a-zA-Z0-9_-]/g, '_') : '_general';
  
  const storagePath = `${safeLesson}/${safeUnit}/${timestamp}_${safeName}`;

  // 1. Storage'a yükle
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/pdf',
      upsert: false,
    });

  if (uploadError) throw new Error('Dosya yükleme hatası: ' + uploadError.message);

  // 2. Metadata'yı tabloya kaydet
  const { data, error: insertError } = await supabase
    .from('reference_sources')
    .insert({
      lesson,
      unit,
      file_path: storagePath,
      file_name: file.name,
    })
    .select()
    .single();

  if (insertError) throw new Error('Kayıt hatası: ' + insertError.message);
  return data as ReferenceSource;
}

/** Kaynak kitabı siler (Storage + DB) */
export async function deleteReferenceSource(ref: ReferenceSource): Promise<void> {
  // 1. Storage'dan sil
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([ref.file_path]);

  if (storageError) console.warn('Storage silme uyarısı:', storageError.message);

  // 2. DB'den sil
  const { error: dbError } = await supabase
    .from('reference_sources')
    .delete()
    .eq('id', ref.id);

  if (dbError) throw new Error('Silme hatası: ' + dbError.message);
}

/** Storage'daki dosyanın public URL'ini döner */
export function getStoragePublicUrl(filePath: string): string {
  const { data } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);
  return data.publicUrl;
}
