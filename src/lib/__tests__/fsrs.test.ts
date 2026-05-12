import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dateUtils', () => ({
  todayStr: () => '2024-06-15',
  addDays: (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
}));

import {
  retrievability,
  nextInterval,
  initCard,
  reviewCard,
  nextReviewDate,
  difficultyLabel,
  migrateSM2Card,
  DEFAULT_REQUEST_RETENTION,
  type FSRSCard,
  type FSRSGrade,
} from '../fsrs';
import { FSRS_MAX_INTERVAL_DAYS, FSRS_MAX_STABILITY_DAYS } from '../../config/learning';

const TODAY = '2024-06-15';

// ─── retrievability ───────────────────────────────────────────────────────────

describe('retrievability', () => {
  it('returns 1.0 when elapsed is 0', () => {
    expect(retrievability(0, 10)).toBeCloseTo(1.0, 5);
  });

  it('decreases monotonically as elapsed days increase', () => {
    const s = 10;
    const r1 = retrievability(5, s);
    const r2 = retrievability(10, s);
    const r3 = retrievability(20, s);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
  });

  it('is always in [0, 1]', () => {
    for (const elapsed of [0, 1, 5, 10, 30, 100, 365]) {
      const r = retrievability(elapsed, 10);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('is higher with greater stability at same elapsed days', () => {
    expect(retrievability(7, 14)).toBeGreaterThan(retrievability(7, 7));
  });
});

// ─── nextInterval ─────────────────────────────────────────────────────────────

describe('nextInterval', () => {
  it('returns at least 1 day', () => {
    expect(nextInterval(0.01)).toBeGreaterThanOrEqual(1);
  });

  it('clamps to FSRS_MAX_INTERVAL_DAYS', () => {
    expect(nextInterval(99999)).toBe(FSRS_MAX_INTERVAL_DAYS);
  });

  it('increases as stability increases', () => {
    expect(nextInterval(5)).toBeLessThan(nextInterval(10));
    expect(nextInterval(10)).toBeLessThan(nextInterval(30));
  });

  it('decreases as retention target increases', () => {
    // Higher retention target → more frequent reviews → shorter interval
    expect(nextInterval(10, 0.95)).toBeLessThan(nextInterval(10, 0.80));
  });

  it('returns an integer', () => {
    expect(Number.isInteger(nextInterval(10))).toBe(true);
  });

  it('uses DEFAULT_REQUEST_RETENTION when no retention arg', () => {
    const withDefault = nextInterval(10);
    const withExplicit = nextInterval(10, DEFAULT_REQUEST_RETENTION);
    expect(withDefault).toBe(withExplicit);
  });
});

// ─── initCard ─────────────────────────────────────────────────────────────────

describe('initCard', () => {
  it('sets lastReview to today', () => {
    expect(initCard(3).lastReview).toBe(TODAY);
  });

  it('sets reps to 1', () => {
    expect(initCard(3).reps).toBe(1);
  });

  it('difficulty is within [1, 10] for all grades', () => {
    ([1, 2, 3, 4] as FSRSGrade[]).forEach(grade => {
      const { difficulty } = initCard(grade);
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    });
  });

  it('grade 1 (Again) has lower stability than grade 3 (Good)', () => {
    expect(initCard(1).stability).toBeLessThan(initCard(3).stability);
  });

  it('grade 1 (Again) has higher difficulty than grade 4 (Easy)', () => {
    expect(initCard(1).difficulty).toBeGreaterThan(initCard(4).difficulty);
  });

  it('stability is positive', () => {
    ([1, 2, 3, 4] as FSRSGrade[]).forEach(grade => {
      expect(initCard(grade).stability).toBeGreaterThan(0);
    });
  });

  it('scheduledDays is at least 1', () => {
    ([1, 2, 3, 4] as FSRSGrade[]).forEach(grade => {
      expect(initCard(grade).scheduledDays).toBeGreaterThanOrEqual(1);
    });
  });
});

// ─── reviewCard ───────────────────────────────────────────────────────────────

describe('reviewCard', () => {
  const baseCard: FSRSCard = {
    stability: 10,
    difficulty: 5,
    lastReview: '2024-06-10', // 5 days before TODAY
    scheduledDays: 7,
    reps: 3,
  };

  it('increments reps by 1', () => {
    expect(reviewCard(baseCard, 3).reps).toBe(4);
  });

  it('sets lastReview to today', () => {
    expect(reviewCard(baseCard, 3).lastReview).toBe(TODAY);
  });

  it('does not mutate the input card (pure function)', () => {
    const snapshot = { ...baseCard };
    reviewCard(baseCard, 3);
    expect(baseCard).toEqual(snapshot);
  });

  it('grade 1 (lapse) produces lower stability than grade 3 (recall)', () => {
    const lapse = reviewCard(baseCard, 1);
    const good = reviewCard(baseCard, 3);
    expect(lapse.stability).toBeLessThan(good.stability);
  });

  it('grade 3 increases stability over the base value', () => {
    expect(reviewCard(baseCard, 3).stability).toBeGreaterThan(baseCard.stability);
  });

  it('clamps stability to at least 0.1', () => {
    const fragile: FSRSCard = { stability: 0.1, difficulty: 9.9, lastReview: TODAY, scheduledDays: 1, reps: 1 };
    expect(reviewCard(fragile, 1).stability).toBeGreaterThanOrEqual(0.1);
  });

  it('clamps stability to FSRS_MAX_STABILITY_DAYS', () => {
    const strong: FSRSCard = {
      stability: FSRS_MAX_STABILITY_DAYS - 1,
      difficulty: 1,
      lastReview: '2023-01-01',
      scheduledDays: 364,
      reps: 100,
    };
    expect(reviewCard(strong, 4).stability).toBeLessThanOrEqual(FSRS_MAX_STABILITY_DAYS);
  });

  it('scheduledDays is at least 1 after lapse', () => {
    expect(reviewCard(baseCard, 1).scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('difficulty stays within [1, 10]', () => {
    ([1, 2, 3, 4] as FSRSGrade[]).forEach(grade => {
      const { difficulty } = reviewCard(baseCard, grade);
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    });
  });
});

// ─── nextReviewDate ───────────────────────────────────────────────────────────

describe('nextReviewDate', () => {
  it('adds scheduledDays to lastReview', () => {
    const card: FSRSCard = {
      stability: 10, difficulty: 5,
      lastReview: '2024-06-01', scheduledDays: 14, reps: 1,
    };
    expect(nextReviewDate(card)).toBe('2024-06-15');
  });

  it('handles month boundaries', () => {
    const card: FSRSCard = {
      stability: 10, difficulty: 5,
      lastReview: '2024-01-25', scheduledDays: 10, reps: 1,
    };
    expect(nextReviewDate(card)).toBe('2024-02-04');
  });
});

// ─── difficultyLabel ──────────────────────────────────────────────────────────

describe('difficultyLabel', () => {
  it('returns easy for D < 4', () => {
    expect(difficultyLabel(1)).toBe('easy');
    expect(difficultyLabel(3.99)).toBe('easy');
  });

  it('returns medium for 4 <= D < 7', () => {
    expect(difficultyLabel(4)).toBe('medium');
    expect(difficultyLabel(6.99)).toBe('medium');
  });

  it('returns hard for D >= 7', () => {
    expect(difficultyLabel(7)).toBe('hard');
    expect(difficultyLabel(10)).toBe('hard');
  });

  it('boundary at exactly 4 is medium', () => {
    expect(difficultyLabel(4)).toBe('medium');
  });

  it('boundary at exactly 7 is hard', () => {
    expect(difficultyLabel(7)).toBe('hard');
  });
});

// ─── migrateSM2Card ───────────────────────────────────────────────────────────

describe('migrateSM2Card', () => {
  it('maps EF=2.5 (easy) to difficulty near 1', () => {
    const card = migrateSM2Card({ easeFactor: 2.5, interval: 10, repetitions: 5 });
    expect(card.difficulty).toBeCloseTo(1, 0);
  });

  it('maps EF=1.3 (hard) to difficulty near 10', () => {
    const card = migrateSM2Card({ easeFactor: 1.3, interval: 1, repetitions: 1 });
    expect(card.difficulty).toBeCloseTo(10, 0);
  });

  it('maps midpoint EF=1.9 to mid-range difficulty', () => {
    const card = migrateSM2Card({ easeFactor: 1.9, interval: 7, repetitions: 3 });
    expect(card.difficulty).toBeGreaterThan(4);
    expect(card.difficulty).toBeLessThan(7);
  });

  it('uses interval as stability', () => {
    const card = migrateSM2Card({ easeFactor: 2.0, interval: 21, repetitions: 4 });
    expect(card.stability).toBe(21);
  });

  it('minimum stability is 0.5 when interval is 0', () => {
    const card = migrateSM2Card({ easeFactor: 2.0, interval: 0, repetitions: 0 });
    expect(card.stability).toBeGreaterThanOrEqual(0.5);
  });

  it('strips time from lastSeen ISO string', () => {
    const card = migrateSM2Card({
      easeFactor: 2.0, interval: 7, repetitions: 3,
      lastSeen: '2024-05-01T12:00:00.000Z',
    });
    expect(card.lastReview).toBe('2024-05-01');
  });

  it('falls back to today when no lastSeen', () => {
    const card = migrateSM2Card({ easeFactor: 2.0, interval: 7, repetitions: 3 });
    expect(card.lastReview).toBe(TODAY);
  });

  it('reps is at least 1', () => {
    const card = migrateSM2Card({ easeFactor: 2.0, interval: 1, repetitions: 0 });
    expect(card.reps).toBeGreaterThanOrEqual(1);
  });

  it('difficulty is in [1, 10] for all valid EF values', () => {
    [1.3, 1.5, 1.8, 2.0, 2.2, 2.5].forEach(ef => {
      const { difficulty } = migrateSM2Card({ easeFactor: ef, interval: 7, repetitions: 3 });
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    });
  });
});
