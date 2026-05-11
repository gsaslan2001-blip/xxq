/**
 * DUS Bankası — Soru İstatistik Yönetimi (localStorage + Cloud Sync)
 * Per-soru: kaç kez çözüldü, kaç kez doğru, son görülme zamanı
 * + SM-2 Aralıklı Tekrar Algoritması
 * + Daily Study Streak
 */

import { pushStatsToCloud, pullAllDeviceStats, clearDeviceStats, type PushStatsResult } from './supabase';
import { initCard, reviewCard, migrateSM2Card, nextReviewDate, difficultyLabel, type FSRSCard, type FSRSGrade } from './fsrs';
import { todayStr, addDays } from './dateUtils';

const STATS_KEY = 'dus_question_stats';
const STATS_SM2_BACKUP_KEY = 'dus_question_stats_sm2_backup'; // Rapor §5.2 güvenliği
const MIGRATION_FLAG_KEY = 'dus_stats_migrated_v2';            // Bir kez çalışsın
const DEVICE_ID_KEY = 'dus_device_id';
const STREAK_KEY = 'dus_study_streak';
const ACTIVITY_KEY = 'dus_activity_log';
const PENDING_SYNC_KEY = 'dus_pending_sync';

export type WrongChoice = { selected: string; timestamp: string };

export type QuestionStat = {
  attempts: number;
  corrects: number;
  lastSeen: string; // ISO date
  // Legacy SM-2 fields — FSRS migrasyonu sonrası backup amaçlı korunuyor, yeni scheduling FSRS'te
  interval: number;
  easeFactor: number;
  repetitions: number;
  nextReview: string; // ISO date (YYYY-MM-DD) — FSRS de bu alanı güncelliyor (due date)
  // Faz 1: Hata Pattern Analizi için seçilen yanlış şıkların geçmişi
  wrongChoices?: WrongChoice[];
  // Faz 2: FSRS-5 alanları (migrasyon sonrası tüm kartlarda mevcut)
  stability?: number;      // gün cinsinden hafıza gücü
  difficulty?: number;     // 1-10, yüksek = zor
  lastReview?: string;     // ISO date
  scheduledDays?: number;  // sonraki review'e kadar gün
  fsrsReps?: number;       // FSRS review sayacı (attempts'ten bağımsız)
};

export type StatsMap = Record<string, QuestionStat>;

export type StreakData = {
  currentStreak: number;
  lastStudyDate: string; // YYYY-MM-DD
  longestStreak: number;
};

/** Cihaza özgü kalıcı ID üretir/döner */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Tüm istatistikleri localStorage'dan yükler */
export function loadAllStats(): StatsMap {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Legacy SM-2 — FSRS migrasyonu sonrası artık scheduling için kullanılmıyor.
 * Sadece backup amacıyla history korunuyor (rollback senaryosunda).
 */
function applySM2Legacy(stat: QuestionStat, grade: number): { interval: number; easeFactor: number; repetitions: number } {
  let { interval, easeFactor, repetitions } = stat;
  const newEF = Math.max(1.3, easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  let newInterval: number;
  let newRepetitions: number;
  if (grade < 3) {
    newRepetitions = 0;
    newInterval = 1;
  } else {
    if (repetitions === 0) newInterval = 1;
    else if (repetitions === 1) newInterval = 6;
    else newInterval = Math.round(interval * newEF);
    newRepetitions = repetitions + 1;
  }
  return {
    easeFactor: Math.round(newEF * 100) / 100,
    interval: newInterval,
    repetitions: newRepetitions,
  };
}

/**
 * Binary correct/incorrect UX → FSRS grade mapping.
 *   Yanlış → 1 (Again)
 *   Doğru  → 3 (Good)
 * İleride "Kolay/Zor" butonları eklenirse 2/4 de kullanılabilir.
 */
function toFSRSGrade(isCorrect: boolean): FSRSGrade {
  return isCorrect ? 3 : 1;
}

/**
 * Mevcut QuestionStat'ta FSRS alanları varsa onu kullanır, yoksa SM-2'den migrate eder,
 * o da yoksa yeni FSRSCard başlatır.
 */
function ensureFSRSCard(stat: QuestionStat): FSRSCard {
  if (stat.stability !== undefined && stat.difficulty !== undefined && stat.lastReview) {
    return {
      stability: stat.stability,
      difficulty: stat.difficulty,
      lastReview: stat.lastReview,
      scheduledDays: stat.scheduledDays ?? stat.interval ?? 1,
      reps: stat.fsrsReps ?? stat.repetitions ?? 1,
    };
  }
  // SM-2 history varsa migrate et
  if (stat.attempts > 0 && stat.easeFactor) {
    return migrateSM2Card({
      easeFactor: stat.easeFactor,
      interval: stat.interval,
      repetitions: stat.repetitions,
      nextReview: stat.nextReview,
      lastSeen: stat.lastSeen,
    });
  }
  // Yeni kart
  return initCard(3);
}

// ─── SM-2 → FSRS Toplu Migrasyon (one-time) ────────────────────────────────

/**
 * Uygulama açılışında çağrılır. Zaten migrate edilmişse no-op.
 * Mevcut SM-2 state'in TAM KOPYASI backup key'e alınır (rollback için).
 * Her kart için FSRS alanları hesaplanır ve state'e yazılır.
 */
export function migrateAllStatsToFSRSIfNeeded(): { migrated: boolean; count: number } {
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === '1') {
    return { migrated: false, count: 0 };
  }
  const stats = loadAllStats();
  const entries = Object.entries(stats);
  if (entries.length === 0) {
    localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    return { migrated: false, count: 0 };
  }

  // Backup: mevcut SM-2 state'in tam kopyası
  try {
    localStorage.setItem(STATS_SM2_BACKUP_KEY, JSON.stringify(stats));
  } catch {
    // Quota hatası — migrasyonu ertele, bir sonraki açılışta tekrar dene
    return { migrated: false, count: 0 };
  }

  let migrated = 0;
  for (const [id, stat] of entries) {
    // Zaten FSRS alanları varsa atla
    if (stat.stability !== undefined && stat.difficulty !== undefined) continue;
    const fsrs = migrateSM2Card({
      easeFactor: stat.easeFactor,
      interval: stat.interval,
      repetitions: stat.repetitions,
      nextReview: stat.nextReview,
      lastSeen: stat.lastSeen,
    });
    stats[id] = {
      ...stat,
      stability: fsrs.stability,
      difficulty: fsrs.difficulty,
      lastReview: fsrs.lastReview,
      scheduledDays: fsrs.scheduledDays,
      fsrsReps: fsrs.reps,
      // nextReview alanını FSRS'in hesabıyla güncelle (eski SM-2 değerini overwrite et)
      nextReview: nextReviewDate(fsrs),
    };
    migrated++;
  }

  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  localStorage.setItem(MIGRATION_FLAG_KEY, '1');
  return { migrated: true, count: migrated };
}

/** Rollback: Backup'tan SM-2 state'i geri yükler. 1 hafta FSRS doğrulama sonrası backup temizlenebilir. */
export function rollbackToSM2Backup(): boolean {
  const backup = localStorage.getItem(STATS_SM2_BACKUP_KEY);
  if (!backup) return false;
  localStorage.setItem(STATS_KEY, backup);
  localStorage.removeItem(MIGRATION_FLAG_KEY);
  return true;
}

/** Backup'ı kalıcı olarak siler (FSRS doğrulandıktan sonra çağrılır). */
export function clearSM2Backup(): void {
  localStorage.removeItem(STATS_SM2_BACKUP_KEY);
}

/**
 * Tek sorunun istatistiğini günceller (SM-2 dahil)
 * @param selectedOption — Seçilen şık ('A'-'E'). Yanlış cevaplarda wrongChoices'a kaydedilir.
 *                         Doğru cevaplar, skip (null) ve undefined durumunda yok sayılır.
 */
export function saveQuestionStat(
  questionId: string,
  isCorrect: boolean,
  selectedOption?: string | null
): void {
  const stats = loadAllStats();
  const prev: QuestionStat = stats[questionId] || {
    attempts: 0,
    corrects: 0,
    lastSeen: '',
    interval: 1,
    easeFactor: 2.5,
    repetitions: 0,
    nextReview: todayStr(),
    wrongChoices: [] as WrongChoice[],
  };

  // Faz 2: FSRS-5 scheduling (SM-2 kaldırıldı — sadece backup için eski alanlar güncelleniyor)
  const card = ensureFSRSCard(prev);
  const fsrsGrade = toFSRSGrade(isCorrect);
  const updatedCard = reviewCard(card, fsrsGrade);

  // Legacy SM-2 alanlarını backup amacıyla güncellemeye devam et (rollback senaryosu)
  const sm2Legacy = applySM2Legacy(prev, isCorrect ? 5 : 1);

  // Hata Pattern Analizi: Sadece yanlış cevaplarda ve seçim varsa kaydet
  const prevWrong = prev.wrongChoices ?? [];
  const nextWrong = (!isCorrect && selectedOption)
    ? [...prevWrong, { selected: selectedOption, timestamp: new Date().toISOString() }]
    : prevWrong;

  stats[questionId] = {
    attempts: prev.attempts + 1,
    corrects: prev.corrects + (isCorrect ? 1 : 0),
    lastSeen: new Date().toISOString(),
    // SM-2 alanları (backup)
    easeFactor: sm2Legacy.easeFactor,
    interval: sm2Legacy.interval,
    repetitions: sm2Legacy.repetitions,
    // nextReview: FSRS hesaplıyor (due date source of truth)
    nextReview: nextReviewDate(updatedCard),
    // FSRS alanları
    stability: updatedCard.stability,
    difficulty: updatedCard.difficulty,
    lastReview: updatedCard.lastReview,
    scheduledDays: updatedCard.scheduledDays,
    fsrsReps: updatedCard.reps,
    wrongChoices: nextWrong,
  };
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));

  // Streak güncelle
  updateStreak();
  // Aktivite logu güncelle
  logActivity();
  // FIX: Anında cloud sync — hata durumunda pending flag yaz
  syncStatsUp().catch(err => {
    console.warn('[saveQuestionStat] Anlık sync hatası:', err);
    localStorage.setItem(PENDING_SYNC_KEY, '1');
  });
}

/** Bir sorunun istatistiğini döner */
export function getStatFor(questionId: string): QuestionStat | null {
  const stats = loadAllStats();
  return stats[questionId] || null;
}

/**
 * Zorluk seviyesi döner (FSRS difficulty bazlı — migrasyon sonrası)
 * difficulty < 4  → Easy
 * difficulty < 7  → Medium
 * difficulty >= 7 → Hard
 * FSRS alanı yoksa SM-2 easeFactor fallback.
 */
export function getDifficultyLabel(questionId: string): 'easy' | 'medium' | 'hard' | null {
  const stat = getStatFor(questionId);
  if (!stat || stat.attempts === 0) return null;
  if (stat.difficulty !== undefined) return difficultyLabel(stat.difficulty);
  // Fallback: SM-2 EF bazlı
  if (stat.easeFactor >= 2.2) return 'easy';
  if (stat.easeFactor >= 1.6) return 'medium';
  return 'hard';
}

/** Zayıf soruları filtreler: en az 2 deneme, doğru oranı < %50 */
export function getWeakQuestionIds(minAttempts = 2, maxCorrectRate = 0.5): string[] {
  const stats = loadAllStats();
  return Object.entries(stats)
    .filter(([, stat]) => {
      if (stat.attempts < minAttempts) return false;
      return (stat.corrects / stat.attempts) < maxCorrectRate;
    })
    .sort((a, b) => (a[1].corrects / a[1].attempts) - (b[1].corrects / b[1].attempts))
    .map(([id]) => id);
}

/** SM-2'ye göre bugün veya geçmişte tekrar edilmesi gereken soruları döner */
export function getDueForReviewIds(): string[] {
  const stats = loadAllStats();
  const today = todayStr();
  return Object.entries(stats)
    .filter(([, stat]) => stat.attempts > 0 && stat.nextReview <= today)
    .sort((a, b) => a[1].nextReview.localeCompare(b[1].nextReview))
    .map(([id]) => id);
}

/** Bir ünitenin istatistik özetini döner */
export function getUnitProgress(questionIds: string[]): { solved: number; correct: number; total: number; totalAttempts: number; totalCorrects: number } {
  const stats = loadAllStats();
  let solved = 0;
  let correct = 0;
  let totalAttempts = 0;
  let totalCorrects = 0;
  for (const id of questionIds) {
    const s = stats[id];
    if (s && s.attempts > 0) {
      solved++;
      totalAttempts += s.attempts;
      totalCorrects += s.corrects;
      // Doğruluk oranı: son durum bazlı (corrects/attempts >= 0.5 ise doğru sayılır)
      if (s.corrects / s.attempts >= 0.5) correct++;
    }
  }
  return { solved, correct, total: questionIds.length, totalAttempts, totalCorrects };
}

// ─── STREAK ────────────────────────────────────────────────────────────────

export function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : { currentStreak: 0, lastStudyDate: '', longestStreak: 0 };
  } catch {
    return { currentStreak: 0, lastStudyDate: '', longestStreak: 0 };
  }
}

function updateStreak(): void {
  const streak = loadStreak();
  const today = todayStr();
  if (streak.lastStudyDate === today) return; // Zaten bugün çalışıldı

  const yesterday = addDays(today, -1);
  let newCurrent: number;
  if (streak.lastStudyDate === yesterday) {
    newCurrent = streak.currentStreak + 1;
  } else {
    newCurrent = 1; // Zincir koptu
  }

  const updated: StreakData = {
    currentStreak: newCurrent,
    lastStudyDate: today,
    longestStreak: Math.max(streak.longestStreak, newCurrent),
  };
  localStorage.setItem(STREAK_KEY, JSON.stringify(updated));
}

// ─── AKTİVİTE LOGU ─────────────────────────────────────────────────────────
// Son 30 günün günlük soru sayısını tutar

export type ActivityLog = Record<string, number>; // { 'YYYY-MM-DD': count }

export function loadActivityLog(): ActivityLog {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function logActivity(): void {
  const log = loadActivityLog();
  const today = todayStr();
  log[today] = (log[today] || 0) + 1;

  // 30 günden eski kayıtları temizle
  const cutoff = addDays(today, -30);
  for (const date of Object.keys(log)) {
    if (date < cutoff) delete log[date];
  }
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(log));
}

/** Son N günün aktivite verisini döner */
export function getRecentActivity(days = 14): { date: string; count: number }[] {
  const log = loadActivityLog();
  const today = todayStr();
  const result: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    result.push({ date, count: log[date] || 0 });
  }
  return result;
}

// ─── CLOUD SYNC ─────────────────────────────────────────────────────────────

/**
 * Modül seviyesinde güncel userId — App.tsx'ten auth değişiminde set edilir.
 * syncStatsUp/Down fonksiyonlarının hook bağımlılığı olmadan userId'a erişmesini sağlar.
 */
let currentSyncUserId: string | null = null;

/** Auth state değiştiğinde App.tsx tarafından çağrılır */
export function setSyncUserId(userId: string | null): void {
  currentSyncUserId = userId;
}

/** Local stats'ı cloud'a push eder (wrongChoices + FSRS alanları dahil).
 *  @returns Her soru için anında push sonucu (başarılı/başarısız batch detayı). */
export async function syncStatsUp(): Promise<PushStatsResult> {
  const deviceId = getDeviceId();
  const stats = loadAllStats();
  const payload: Record<string, {
    attempts: number; corrects: number; lastSeen: string; wrongChoices?: WrongChoice[];
    stability?: number; difficulty?: number; lastReview?: string; scheduledDays?: number; fsrsReps?: number;
  }> = {};
  for (const [id, s] of Object.entries(stats)) {
    payload[id] = {
      attempts: s.attempts,
      corrects: s.corrects,
      lastSeen: s.lastSeen,
      wrongChoices: s.wrongChoices ?? [],
      stability: s.stability,
      difficulty: s.difficulty,
      lastReview: s.lastReview,
      scheduledDays: s.scheduledDays,
      fsrsReps: s.fsrsReps,
    };
  }
  return pushStatsToCloud(deviceId, payload, currentSyncUserId ?? undefined);
}

/** Cloud'dan TÜM stats'ı çekip localState ile birleştirir.
 *  MAX-MERGE: Her alan için cloud ve local'den en güncel/yüksek olan alınır.
 *  FSRS state için lastReview en yeni olan kazanır; tie-break: attempts.
 *  Local'de olup cloud'da olmayan sorular korunur.
 */
export async function syncStatsDown(): Promise<void> {
  // FIX: currentSyncUserId null ise cloud pull yapma (tek kullanıcılı sistem)
  if (!currentSyncUserId) return;

  // FIX: Bekleyen push varsa önce onu dene
  if (localStorage.getItem(PENDING_SYNC_KEY) === '1') {
    try {
      await syncStatsUp();
      localStorage.removeItem(PENDING_SYNC_KEY);
    } catch {
      // Hala başarısız — local veriyle devam et
    }
  }

  const allCloudStats = await pullAllDeviceStats(currentSyncUserId);
  const localStats = loadAllStats();

  // Cloud boşsa local'i koru (ilk sync, offline vb.)
  if (Object.keys(allCloudStats).length === 0) return;

  const merged: StatsMap = { ...localStats };
  for (const [id, cloud] of Object.entries(allCloudStats)) {
    const local = localStats[id];
    const cloudLR = cloud.lastReview ?? '';
    const localLR = local?.lastReview ?? '';

    // lastReview bazlı kazanan seç (FSRS state bütünlüğü için)
    const cloudWins = !local || cloudLR > localLR ||
      (cloudLR === localLR && cloud.attempts > (local?.attempts ?? 0));

    const cloudWrong = cloud.wrongChoices ?? [];
    const localWrong = local?.wrongChoices ?? [];
    const mergedWrong = mergeWrongChoices(localWrong, cloudWrong);

    const computedNextReview = (cloudWins ? cloud.lastReview : local?.lastReview)
      ? addDays(
          (cloudWins ? cloud.lastReview : local?.lastReview) ?? todayStr(),
          (cloudWins ? cloud.scheduledDays : local?.scheduledDays) ?? 1
        )
      : todayStr();

    merged[id] = {
      attempts: Math.max(cloud.attempts, local?.attempts ?? 0),
      corrects: Math.max(cloud.corrects, local?.corrects ?? 0),
      lastSeen: [cloud.lastSeen, local?.lastSeen ?? ''].sort().reverse()[0],
      easeFactor: local?.easeFactor ?? 2.5,
      interval: local?.interval ?? 1,
      repetitions: local?.repetitions ?? 0,
      nextReview: computedNextReview,
      stability: cloudWins ? cloud.stability : local?.stability,
      difficulty: cloudWins ? cloud.difficulty : local?.difficulty,
      lastReview: cloudWins ? cloud.lastReview : local?.lastReview,
      scheduledDays: cloudWins ? cloud.scheduledDays : local?.scheduledDays,
      fsrsReps: cloudWins ? cloud.fsrsReps : local?.fsrsReps,
      wrongChoices: mergedWrong,
    };
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(merged));
}

export function mergeWrongChoices(a: WrongChoice[], b: WrongChoice[]): WrongChoice[] {
  const seen = new Set<string>();
  const out: WrongChoice[] = [];
  for (const w of [...a, ...b]) {
    const key = `${w.timestamp}|${w.selected}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  }
  return out.sort((x, y) => x.timestamp.localeCompare(y.timestamp));
}

// ─── OTOMATIK SYNC YÖNETİCİSİ ──────────────────────────────────────────────
// FIX: Debounce kaldırıldı — her saveQuestionStat anında push yapar.
// SyncManager sadece manuel force-sync için tutuluyor.

class SyncManagerImpl {
  /** Bekleyen local değişiklikleri hemen cloud'a yollar. */
  async flush(): Promise<void> {
    try {
      await syncStatsUp();
    } catch (err) {
      console.warn('[SyncManager] Push başarısız:', err);
    }
  }
}

export const SyncManager = new SyncManagerImpl();

/** Tüm istatistikleri tamamen sıfırlar: localStorage + cloud + FSRS migration flag. */
export async function resetAllStats(): Promise<void> {
  localStorage.removeItem(STATS_KEY);
  localStorage.removeItem(STATS_SM2_BACKUP_KEY);
  localStorage.removeItem(MIGRATION_FLAG_KEY);
  localStorage.removeItem(STREAK_KEY);
  localStorage.removeItem(ACTIVITY_KEY);
  await clearDeviceStats(getDeviceId(), currentSyncUserId ?? undefined);
}
