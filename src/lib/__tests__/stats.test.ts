import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock('../supabase', () => ({
  pushStatsToCloud: vi.fn().mockResolvedValue(undefined),
  pullAllDeviceStats: vi.fn().mockResolvedValue({}),
  clearDeviceStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../dateUtils', () => ({
  todayStr: vi.fn(() => '2024-06-15'),
  addDays: (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
}));

import {
  loadAllStats,
  loadStreak,
  loadActivityLog,
  getStatFor,
  getWeakQuestionIds,
  getDueForReviewIds,
  getUnitProgress,
  getRecentActivity,
  getDifficultyLabel,
  migrateAllStatsToFSRSIfNeeded,
  rollbackToSM2Backup,
  clearSM2Backup,
  saveQuestionStat,
  syncStatsDown,
  type StatsMap,
} from '../stats';
import { todayStr } from '../dateUtils';
import { pullAllDeviceStats } from '../supabase';

const TODAY = '2024-06-15';
const YESTERDAY = '2024-06-14';
const TWO_DAYS_AGO = '2024-06-13';

// localStorage key constants (mirrored from stats.ts)
const STATS_KEY = 'dus_question_stats';
const SM2_BACKUP_KEY = 'dus_question_stats_sm2_backup';
const MIGRATION_FLAG_KEY = 'dus_stats_migrated_v2';
const STREAK_KEY = 'dus_study_streak';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.mocked(todayStr).mockReturnValue(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(todayStr).mockReturnValue(TODAY);
});

// ─── loadAllStats ─────────────────────────────────────────────────────────────

describe('loadAllStats', () => {
  it('returns empty object when localStorage is empty', () => {
    expect(loadAllStats()).toEqual({});
  });

  it('returns parsed stats map', () => {
    const data: StatsMap = {
      q1: { attempts: 3, corrects: 2, lastSeen: TODAY, interval: 1, easeFactor: 2.5, repetitions: 1, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    expect(loadAllStats()).toEqual(data);
  });

  it('returns empty object on malformed JSON', () => {
    localStorage.setItem(STATS_KEY, 'not-json');
    expect(loadAllStats()).toEqual({});
  });
});

// ─── getStatFor ───────────────────────────────────────────────────────────────

describe('getStatFor', () => {
  it('returns null when question has no stat', () => {
    expect(getStatFor('unknown')).toBeNull();
  });

  it('returns the stat when it exists', () => {
    const data: StatsMap = {
      q1: { attempts: 5, corrects: 3, lastSeen: TODAY, interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    expect(getStatFor('q1')).toEqual(data.q1);
  });
});

// ─── saveQuestionStat ─────────────────────────────────────────────────────────

describe('saveQuestionStat', () => {
  it('creates a new stat entry on first call', () => {
    saveQuestionStat('q1', true);
    const stat = getStatFor('q1');
    expect(stat).not.toBeNull();
    expect(stat!.attempts).toBe(1);
    expect(stat!.corrects).toBe(1);
  });

  it('increments attempts and corrects on correct answer', () => {
    saveQuestionStat('q1', true);
    saveQuestionStat('q1', true);
    const stat = getStatFor('q1');
    expect(stat!.attempts).toBe(2);
    expect(stat!.corrects).toBe(2);
  });

  it('increments attempts but not corrects on incorrect answer', () => {
    saveQuestionStat('q1', false, 'B');
    const stat = getStatFor('q1');
    expect(stat!.attempts).toBe(1);
    expect(stat!.corrects).toBe(0);
  });

  it('records wrong choice on incorrect answer', () => {
    saveQuestionStat('q1', false, 'C');
    const stat = getStatFor('q1');
    expect(stat!.wrongChoices).toHaveLength(1);
    expect(stat!.wrongChoices![0].selected).toBe('C');
  });

  it('does not record wrong choice on correct answer', () => {
    saveQuestionStat('q1', true, 'A');
    expect(getStatFor('q1')!.wrongChoices).toHaveLength(0);
  });

  it('sets FSRS fields on the stat', () => {
    saveQuestionStat('q1', true);
    const stat = getStatFor('q1');
    expect(stat!.stability).toBeGreaterThan(0);
    expect(stat!.difficulty).toBeGreaterThan(0);
    expect(stat!.nextReview).toBeDefined();
  });

  it('nextReview is a date after today for a correct answer', () => {
    saveQuestionStat('q1', true);
    expect(getStatFor('q1')!.nextReview).toBeGreaterThan(TODAY);
  });
});

// ─── Streak ───────────────────────────────────────────────────────────────────

describe('streak via saveQuestionStat', () => {
  it('starts streak at 1 on first study day', () => {
    saveQuestionStat('q1', true);
    expect(loadStreak().currentStreak).toBe(1);
  });

  it('does not increment streak when already studied today', () => {
    saveQuestionStat('q1', true);
    saveQuestionStat('q2', true);
    expect(loadStreak().currentStreak).toBe(1);
  });

  it('increments streak on consecutive day', () => {
    localStorage.setItem(STREAK_KEY, JSON.stringify({
      currentStreak: 1, lastStudyDate: YESTERDAY, longestStreak: 1,
    }));
    saveQuestionStat('q1', true);
    expect(loadStreak().currentStreak).toBe(2);
  });

  it('resets streak to 1 after a gap', () => {
    localStorage.setItem(STREAK_KEY, JSON.stringify({
      currentStreak: 5, lastStudyDate: TWO_DAYS_AGO, longestStreak: 5,
    }));
    saveQuestionStat('q1', true);
    expect(loadStreak().currentStreak).toBe(1);
  });

  it('updates longestStreak when current exceeds it', () => {
    localStorage.setItem(STREAK_KEY, JSON.stringify({
      currentStreak: 3, lastStudyDate: YESTERDAY, longestStreak: 3,
    }));
    saveQuestionStat('q1', true);
    const streak = loadStreak();
    expect(streak.longestStreak).toBe(4);
  });
});

// ─── getWeakQuestionIds ───────────────────────────────────────────────────────

describe('getWeakQuestionIds', () => {
  beforeEach(() => {
    const data: StatsMap = {
      q1: { attempts: 5, corrects: 1, lastSeen: TODAY, interval: 1, easeFactor: 2.0, repetitions: 2, nextReview: TODAY }, // 20% — weak
      q2: { attempts: 5, corrects: 4, lastSeen: TODAY, interval: 7, easeFactor: 2.5, repetitions: 3, nextReview: TODAY }, // 80% — not weak
      q3: { attempts: 1, corrects: 0, lastSeen: TODAY, interval: 1, easeFactor: 1.8, repetitions: 0, nextReview: TODAY }, // only 1 attempt — below minAttempts=2
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
  });

  it('returns IDs of questions below the correct-rate threshold', () => {
    const ids = getWeakQuestionIds(2, 0.5);
    expect(ids).toContain('q1');
    expect(ids).not.toContain('q2');
  });

  it('excludes questions below minAttempts', () => {
    expect(getWeakQuestionIds(2, 0.5)).not.toContain('q3');
  });

  it('returns IDs sorted by correct rate ascending (worst first)', () => {
    const data: StatsMap = {
      q1: { attempts: 5, corrects: 2, lastSeen: TODAY, interval: 1, easeFactor: 2.0, repetitions: 2, nextReview: TODAY }, // 40%
      q2: { attempts: 5, corrects: 1, lastSeen: TODAY, interval: 1, easeFactor: 1.8, repetitions: 2, nextReview: TODAY }, // 20%
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    const ids = getWeakQuestionIds(2, 0.5);
    expect(ids[0]).toBe('q2'); // 20% comes first
  });
});

// ─── getDueForReviewIds ───────────────────────────────────────────────────────

describe('getDueForReviewIds', () => {
  it('returns IDs where nextReview <= today', () => {
    const data: StatsMap = {
      q1: { attempts: 2, corrects: 1, lastSeen: YESTERDAY, interval: 1, easeFactor: 2.5, repetitions: 1, nextReview: TODAY },
      q2: { attempts: 2, corrects: 2, lastSeen: YESTERDAY, interval: 7, easeFactor: 2.5, repetitions: 2, nextReview: '2024-06-20' },
      q3: { attempts: 2, corrects: 1, lastSeen: TWO_DAYS_AGO, interval: 1, easeFactor: 2.0, repetitions: 1, nextReview: YESTERDAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    const ids = getDueForReviewIds();
    expect(ids).toContain('q1');
    expect(ids).toContain('q3');
    expect(ids).not.toContain('q2');
  });

  it('excludes questions with 0 attempts', () => {
    const data: StatsMap = {
      q1: { attempts: 0, corrects: 0, lastSeen: '', interval: 1, easeFactor: 2.5, repetitions: 0, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    expect(getDueForReviewIds()).not.toContain('q1');
  });

  it('returns sorted by nextReview date ascending', () => {
    const data: StatsMap = {
      q1: { attempts: 1, corrects: 1, lastSeen: TODAY, interval: 1, easeFactor: 2.5, repetitions: 1, nextReview: TODAY },
      q2: { attempts: 1, corrects: 0, lastSeen: TODAY, interval: 1, easeFactor: 2.0, repetitions: 0, nextReview: TWO_DAYS_AGO },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    const ids = getDueForReviewIds();
    expect(ids[0]).toBe('q2'); // earlier date first
  });
});

// ─── getUnitProgress ──────────────────────────────────────────────────────────

describe('getUnitProgress', () => {
  it('returns zero counts when no stats', () => {
    const result = getUnitProgress(['q1', 'q2', 'q3']);
    expect(result).toEqual({ solved: 0, correct: 0, total: 3, totalAttempts: 0, totalCorrects: 0 });
  });

  it('counts solved and correct questions', () => {
    const data: StatsMap = {
      q1: { attempts: 3, corrects: 3, lastSeen: TODAY, interval: 7, easeFactor: 2.5, repetitions: 3, nextReview: TODAY }, // correct rate 100%
      q2: { attempts: 4, corrects: 1, lastSeen: TODAY, interval: 1, easeFactor: 1.8, repetitions: 1, nextReview: TODAY }, // correct rate 25%
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    const result = getUnitProgress(['q1', 'q2', 'q3']);
    expect(result.total).toBe(3);
    expect(result.solved).toBe(2);
    expect(result.correct).toBe(1); // only q1 has >= 50% rate
    expect(result.totalAttempts).toBe(7);
    expect(result.totalCorrects).toBe(4);
  });
});

// ─── migrateAllStatsToFSRSIfNeeded ───────────────────────────────────────────

describe('migrateAllStatsToFSRSIfNeeded', () => {
  it('is a no-op when migration flag is already set', () => {
    localStorage.setItem(MIGRATION_FLAG_KEY, '1');
    const result = migrateAllStatsToFSRSIfNeeded();
    expect(result.migrated).toBe(false);
  });

  it('is a no-op (but sets flag) when stats are empty', () => {
    const result = migrateAllStatsToFSRSIfNeeded();
    expect(result.migrated).toBe(false);
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe('1');
  });

  it('migrates SM-2 stats to FSRS and sets the flag', () => {
    const sm2Stats: StatsMap = {
      q1: { attempts: 5, corrects: 4, lastSeen: YESTERDAY, interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(sm2Stats));

    const result = migrateAllStatsToFSRSIfNeeded();
    expect(result.migrated).toBe(true);
    expect(result.count).toBe(1);

    const updated = loadAllStats();
    expect(updated.q1.stability).toBeGreaterThan(0);
    expect(updated.q1.difficulty).toBeGreaterThan(0);
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBe('1');
  });

  it('creates an SM-2 backup before migrating', () => {
    const sm2Stats: StatsMap = {
      q1: { attempts: 3, corrects: 2, lastSeen: YESTERDAY, interval: 3, easeFactor: 2.1, repetitions: 2, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(sm2Stats));
    migrateAllStatsToFSRSIfNeeded();
    const backup = localStorage.getItem(SM2_BACKUP_KEY);
    expect(backup).not.toBeNull();
    expect(JSON.parse(backup!)).toEqual(sm2Stats);
  });

  it('skips cards that already have FSRS fields', () => {
    const stats: StatsMap = {
      q1: {
        attempts: 5, corrects: 4, lastSeen: YESTERDAY,
        interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY,
        stability: 10, difficulty: 4, // already migrated
      },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    const result = migrateAllStatsToFSRSIfNeeded();
    expect(result.count).toBe(0); // nothing to migrate
  });
});

// ─── rollbackToSM2Backup / clearSM2Backup ─────────────────────────────────────

describe('rollbackToSM2Backup', () => {
  it('returns false when no backup exists', () => {
    expect(rollbackToSM2Backup()).toBe(false);
  });

  it('restores the backup to STATS_KEY and removes the migration flag', () => {
    const original: StatsMap = {
      q1: { attempts: 2, corrects: 1, lastSeen: YESTERDAY, interval: 3, easeFactor: 2.0, repetitions: 2, nextReview: TODAY },
    };
    localStorage.setItem(SM2_BACKUP_KEY, JSON.stringify(original));
    localStorage.setItem(MIGRATION_FLAG_KEY, '1');

    const result = rollbackToSM2Backup();
    expect(result).toBe(true);
    expect(loadAllStats()).toEqual(original);
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull();
  });
});

describe('clearSM2Backup', () => {
  it('removes the backup key', () => {
    localStorage.setItem(SM2_BACKUP_KEY, '{"q1":{}}');
    clearSM2Backup();
    expect(localStorage.getItem(SM2_BACKUP_KEY)).toBeNull();
  });
});

// ─── getDifficultyLabel ───────────────────────────────────────────────────────

describe('getDifficultyLabel', () => {
  it('returns null when no stat exists', () => {
    expect(getDifficultyLabel('unknown')).toBeNull();
  });

  it('returns null when attempts is 0', () => {
    const data: StatsMap = {
      q1: { attempts: 0, corrects: 0, lastSeen: '', interval: 1, easeFactor: 2.5, repetitions: 0, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    expect(getDifficultyLabel('q1')).toBeNull();
  });

  it('uses FSRS difficulty field when available', () => {
    const data: StatsMap = {
      q1: { attempts: 3, corrects: 2, lastSeen: TODAY, interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY, difficulty: 8 },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    expect(getDifficultyLabel('q1')).toBe('hard');
  });

  it('falls back to SM-2 easeFactor when FSRS difficulty absent', () => {
    const data: StatsMap = {
      q1: { attempts: 3, corrects: 2, lastSeen: TODAY, interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(data));
    // easeFactor 2.3 >= 2.2 → 'easy'
    expect(getDifficultyLabel('q1')).toBe('easy');
  });
});

// ─── getRecentActivity ────────────────────────────────────────────────────────

describe('getRecentActivity', () => {
  it('returns `days` entries', () => {
    expect(getRecentActivity(14)).toHaveLength(14);
  });

  it('returns 0 count for days with no activity', () => {
    const result = getRecentActivity(7);
    result.forEach(entry => expect(entry.count).toBe(0));
  });

  it('counts activity correctly', () => {
    saveQuestionStat('q1', true);
    saveQuestionStat('q2', false, 'B');
    const result = getRecentActivity(7);
    const todayEntry = result.find(e => e.date === TODAY);
    expect(todayEntry?.count).toBe(2);
  });
});

// ─── syncStatsDown merge logic ────────────────────────────────────────────────

describe('syncStatsDown', () => {
  it('merges cloud stats when cloud lastReview is newer', async () => {
    const localStats: StatsMap = {
      q1: { attempts: 3, corrects: 2, lastSeen: YESTERDAY, interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY, lastReview: YESTERDAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(localStats));

    vi.mocked(pullAllDeviceStats).mockResolvedValueOnce({
      q1: { attempts: 5, corrects: 4, lastSeen: TODAY, lastReview: TODAY, scheduledDays: 10 } as any,
    });

    await syncStatsDown();

    const merged = loadAllStats();
    expect(merged.q1.attempts).toBe(5); // cloud wins
  });

  it('keeps local stats when local lastReview is newer', async () => {
    const localStats: StatsMap = {
      q1: { attempts: 5, corrects: 4, lastSeen: TODAY, interval: 7, easeFactor: 2.3, repetitions: 3, nextReview: TODAY, lastReview: TODAY },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(localStats));

    vi.mocked(pullAllDeviceStats).mockResolvedValueOnce({
      q1: { attempts: 2, corrects: 1, lastSeen: YESTERDAY, lastReview: YESTERDAY, scheduledDays: 5 } as any,
    });

    await syncStatsDown();

    expect(loadAllStats().q1.attempts).toBe(5); // local wins
  });

  it('merges wrongChoices from both local and cloud without duplicates', async () => {
    const ts = '2024-06-14T10:00:00.000Z';
    const localStats: StatsMap = {
      q1: {
        attempts: 3, corrects: 1, lastSeen: YESTERDAY, interval: 1, easeFactor: 2.0, repetitions: 2, nextReview: TODAY,
        lastReview: YESTERDAY,
        wrongChoices: [{ selected: 'B', timestamp: ts }],
      },
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(localStats));

    vi.mocked(pullAllDeviceStats).mockResolvedValueOnce({
      q1: {
        attempts: 4, corrects: 1, lastSeen: TODAY, lastReview: TODAY, scheduledDays: 7,
        wrongChoices: [
          { selected: 'B', timestamp: ts },          // duplicate
          { selected: 'C', timestamp: '2024-06-15T08:00:00.000Z' }, // new
        ],
      } as any,
    });

    await syncStatsDown();
    const merged = loadAllStats();
    expect(merged.q1.wrongChoices).toHaveLength(2); // B + C, no duplicate
  });
});
