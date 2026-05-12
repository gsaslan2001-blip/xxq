import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../dateUtils', () => ({
  todayStr: () => '2024-06-15',
  addDays: (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
}));

// Deterministic shuffle for predictable test results
vi.mock('../shuffle', () => ({
  fisherYates: <T>(arr: T[]): T[] => [...arr],
}));

import {
  buildSmartQueue,
  buildUnitQueue,
  buildSimulationPool,
  buildExamPool,
  getWeakestUnits,
  getCurriculumProgress,
  getForecastNextDays,
  setAdaptiveWeights,
  getAdaptiveWeights,
} from '../adaptive';
import type { Question } from '../../data';
import type { StatsMap } from '../stats';
import { DEFAULT_ADAPTIVE_WEIGHTS } from '../../config/learning';

const TODAY = '2024-06-15';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function q(id: string, lesson: string, unit: string): Question {
  return { id, lesson, unit, question: `Q${id}`, options: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' }, correctAnswer: 'A', explanation: '' };
}

function stat(attempts: number, corrects: number, nextReview: string, wrongChoices: { selected: string; timestamp: string }[] = []): StatsMap[string] {
  return { attempts, corrects, lastSeen: TODAY, interval: 1, easeFactor: 2.5, repetitions: 1, nextReview, wrongChoices };
}

// ─── setAdaptiveWeights / getAdaptiveWeights ──────────────────────────────────

describe('setAdaptiveWeights / getAdaptiveWeights', () => {
  afterEach(() => setAdaptiveWeights(DEFAULT_ADAPTIVE_WEIGHTS));

  it('returns default weights initially', () => {
    expect(getAdaptiveWeights()).toEqual(DEFAULT_ADAPTIVE_WEIGHTS);
  });

  it('partially overrides weights', () => {
    setAdaptiveWeights({ fsrsUrgency: 0.70 });
    expect(getAdaptiveWeights().fsrsUrgency).toBe(0.70);
    expect(getAdaptiveWeights().weakness).toBe(DEFAULT_ADAPTIVE_WEIGHTS.weakness);
  });

  it('returns a copy — mutations do not affect internal state', () => {
    const w = getAdaptiveWeights();
    w.fsrsUrgency = 0.99;
    expect(getAdaptiveWeights().fsrsUrgency).toBe(DEFAULT_ADAPTIVE_WEIGHTS.fsrsUrgency);
  });
});

// ─── buildSmartQueue ──────────────────────────────────────────────────────────

describe('buildSmartQueue', () => {
  const questions: Question[] = [
    q('q1', 'Patoloji', 'U1'),
    q('q2', 'Fizyoloji', 'U2'),
    q('q3', 'Patoloji', 'U3'),
    q('q4', 'Histoloji', 'U4'),
    q('q5', 'Radyoloji', 'U5'),
  ];

  beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  it('respects the limit', () => {
    const { questions: result } = buildSmartQueue(questions, {}, { limit: 3 });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('classifies unseen questions as new', () => {
    const { breakdown } = buildSmartQueue(questions, {});
    expect(breakdown.newCount).toBe(5);
    expect(breakdown.totalSelected).toBe(5);
  });

  it('includes overdue cards by default', () => {
    const stats: StatsMap = { q1: stat(3, 1, '2024-06-01') };
    const { breakdown } = buildSmartQueue(questions, stats);
    expect(breakdown.overdueCount).toBeGreaterThan(0);
  });

  it('excludes overdue cards when includeDue=false', () => {
    const stats: StatsMap = { q1: stat(3, 1, '2024-06-01') };
    const { breakdown } = buildSmartQueue(questions, stats, { includeDue: false });
    expect(breakdown.overdueCount).toBe(0);
  });

  it('excludes new questions when includeNew=false', () => {
    const { breakdown } = buildSmartQueue(questions, {}, { includeNew: false });
    expect(breakdown.newCount).toBe(0);
    expect(breakdown.totalSelected).toBe(0);
  });

  it('breakdown totals are consistent', () => {
    const stats: StatsMap = { q1: stat(5, 1, '2024-06-01') };
    const { breakdown } = buildSmartQueue(questions, stats);
    expect(breakdown.totalSelected).toBe(
      breakdown.overdueCount + breakdown.weakCount + breakdown.newCount
    );
  });

  it('overdue card scores higher than a new card', () => {
    // With Math.random=0.5: overdue(14d) urgency ≈ 0.35 >> new exploration ≈ 0.075
    const stats: StatsMap = { q1: stat(3, 1, '2024-06-01') }; // 14 days overdue
    const { questions: result } = buildSmartQueue(questions, stats, { limit: 1 });
    expect(result[0].id).toBe('q1');
  });
});

// ─── getWeakestUnits ──────────────────────────────────────────────────────────

describe('getWeakestUnits', () => {
  const qs: Question[] = [
    q('a1', 'Patoloji', 'UA'), q('a2', 'Patoloji', 'UA'), q('a3', 'Patoloji', 'UA'),
    q('a4', 'Patoloji', 'UA'), q('a5', 'Patoloji', 'UA'),
    q('b1', 'Fizyoloji', 'UB'), q('b2', 'Fizyoloji', 'UB'), q('b3', 'Fizyoloji', 'UB'),
    q('b4', 'Fizyoloji', 'UB'), q('b5', 'Fizyoloji', 'UB'),
  ];

  it('filters units below minAttempts', () => {
    const stats: StatsMap = { a1: stat(2, 0, TODAY) };
    const result = getWeakestUnits(qs, stats, 2, 10);
    expect(result).toHaveLength(0);
  });

  it('sorts by accuracy ascending (worst first)', () => {
    const stats: StatsMap = {};
    ['a1','a2','a3','a4','a5'].forEach(id => { stats[id] = stat(5, 1, TODAY); }); // 20%
    ['b1','b2','b3','b4','b5'].forEach(id => { stats[id] = stat(5, 4, TODAY); }); // 80%
    const result = getWeakestUnits(qs, stats, 2, 5);
    expect(result[0].lesson).toBe('Patoloji');
    expect(result[0].accuracy).toBe(20);
    expect(result[1].accuracy).toBe(80);
  });

  it('respects topN limit', () => {
    const stats: StatsMap = {};
    qs.forEach(({ id }) => { stats[id] = stat(10, 5, TODAY); });
    expect(getWeakestUnits(qs, stats, 1, 1)).toHaveLength(1);
  });

  it('includes wrongChoiceCount in the result', () => {
    const stats: StatsMap = {};
    ['a1','a2','a3','a4','a5'].forEach(id => {
      stats[id] = stat(5, 2, TODAY, [{ selected: 'B', timestamp: '2024-06-01T10:00:00Z' }]);
    });
    const result = getWeakestUnits(qs, stats, 1, 5);
    expect(result[0].wrongChoiceCount).toBeGreaterThan(0);
  });
});

// ─── getCurriculumProgress ────────────────────────────────────────────────────

describe('getCurriculumProgress', () => {
  const qs: Question[] = [
    q('q1', 'Patoloji', 'UA'), q('q2', 'Patoloji', 'UA'),
    q('q3', 'Fizyoloji', 'UB'),
    q('q4', 'Histoloji', 'UC'),
  ];

  it('counts totalUnits correctly', () => {
    expect(getCurriculumProgress(qs, {}).totalUnits).toBe(3);
  });

  it('solvedUnits is 0 with no stats', () => {
    expect(getCurriculumProgress(qs, {}).solvedUnits).toBe(0);
  });

  it('solvedUnits counts units with at least 1 attempt', () => {
    const stats: StatsMap = { q1: stat(1, 1, TODAY) };
    expect(getCurriculumProgress(qs, stats).solvedUnits).toBe(1);
  });

  it('completedUnits counts units where every question is attempted', () => {
    const stats: StatsMap = {
      q1: stat(1, 1, TODAY), q2: stat(1, 0, TODAY), // UA complete
      q3: stat(1, 1, TODAY),                         // UB complete
    };
    expect(getCurriculumProgress(qs, stats).completedUnits).toBe(2);
  });

  it('nextUntouchedUnit is null when all units started', () => {
    const stats: StatsMap = {
      q1: stat(1, 1, TODAY), q3: stat(1, 1, TODAY), q4: stat(1, 1, TODAY),
    };
    expect(getCurriculumProgress(qs, stats).nextUntouchedUnit).toBeNull();
  });

  it('nextUntouchedUnit picks the alphabetically first untouched unit', () => {
    const stats: StatsMap = { q1: stat(1, 1, TODAY) }; // only Patoloji started
    const { nextUntouchedUnit } = getCurriculumProgress(qs, stats);
    // Fizyoloji < Histoloji alphabetically
    expect(nextUntouchedUnit?.lesson).toBe('Fizyoloji');
  });

  it('nextUntouchedUnit includes questionCount', () => {
    const { nextUntouchedUnit } = getCurriculumProgress(qs, {});
    expect(nextUntouchedUnit?.questionCount).toBeGreaterThan(0);
  });
});

// ─── getForecastNextDays ──────────────────────────────────────────────────────

describe('getForecastNextDays', () => {
  it('returns exactly `days` entries', () => {
    expect(getForecastNextDays({}, 7)).toHaveLength(7);
  });

  it('first entry is today with isToday=true', () => {
    const [first] = getForecastNextDays({}, 7);
    expect(first.date).toBe(TODAY);
    expect(first.isToday).toBe(true);
  });

  it('subsequent entries have isToday=false', () => {
    getForecastNextDays({}, 7).slice(1).forEach(f => expect(f.isToday).toBe(false));
  });

  it('counts cards due on each specific day', () => {
    const stats: StatsMap = {
      q1: stat(1, 1, TODAY),
      q2: stat(1, 1, TODAY),
      q3: stat(1, 1, '2024-06-17'),
    };
    const forecast = getForecastNextDays(stats, 7);
    expect(forecast[0].count).toBe(2); // today
    expect(forecast[2].count).toBe(1); // 2024-06-17 = TODAY + 2
  });

  it('ignores cards with 0 attempts', () => {
    const stats: StatsMap = { q1: stat(0, 0, TODAY) };
    expect(getForecastNextDays(stats, 7)[0].count).toBe(0);
  });

  it('ignores cards due outside the forecast window', () => {
    const stats: StatsMap = { q1: stat(1, 1, '2024-12-31') };
    const total = getForecastNextDays(stats, 7).reduce((s, f) => s + f.count, 0);
    expect(total).toBe(0);
  });

  it('label for today is Bugün', () => {
    expect(getForecastNextDays({}, 7)[0].label).toBe('Bugün');
  });

  it('label for tomorrow is Yarın', () => {
    expect(getForecastNextDays({}, 7)[1].label).toBe('Yarın');
  });
});

// ─── buildUnitQueue ───────────────────────────────────────────────────────────

describe('buildUnitQueue', () => {
  const qs: Question[] = [
    q('q1', 'Patoloji', 'UA'),
    q('q2', 'Patoloji', 'UA'),
    q('q3', 'Patoloji', 'UA'),
    q('q4', 'Fizyoloji', 'UB'),
  ];

  it('returns only questions from the specified lesson+unit', () => {
    const result = buildUnitQueue(qs, 'Patoloji', 'UA', {});
    expect(result).toHaveLength(3);
    result.forEach(question => {
      expect(question.lesson).toBe('Patoloji');
      expect(question.unit).toBe('UA');
    });
  });

  it('unseen questions come before seen (with identity shuffle mock)', () => {
    const stats: StatsMap = { q2: stat(3, 2, TODAY) };
    const result = buildUnitQueue(qs, 'Patoloji', 'UA', stats);
    const seenIndex = result.findIndex(question => question.id === 'q2');
    const unseenIndex = result.findIndex(question => question.id === 'q1');
    expect(unseenIndex).toBeLessThan(seenIndex);
  });

  it('returns empty array when no questions match', () => {
    expect(buildUnitQueue(qs, 'Biyokimya', 'UX', {})).toHaveLength(0);
  });
});

// ─── buildSimulationPool ──────────────────────────────────────────────────────

describe('buildSimulationPool', () => {
  const qs: Question[] = [
    q('a1', 'Patoloji', 'U1'), q('a2', 'Patoloji', 'U1'),
    q('b1', 'Fizyoloji', 'U2'), q('b2', 'Fizyoloji', 'U2'),
    q('c1', 'Histoloji', 'U3'), q('c2', 'Histoloji', 'U3'),
  ];

  it('returns at most `amount` questions', () => {
    expect(buildSimulationPool(qs, {}, 4).length).toBeLessThanOrEqual(4);
  });

  it('returns empty array when no questions', () => {
    expect(buildSimulationPool([], {}, 10)).toHaveLength(0);
  });

  it('has no duplicate IDs', () => {
    const result = buildSimulationPool(qs, {}, 6);
    expect(new Set(result.map(r => r.id)).size).toBe(result.length);
  });

  it('draws from all lessons', () => {
    const result = buildSimulationPool(qs, {}, 6);
    const lessons = new Set(result.map(r => r.lesson));
    expect(lessons.has('Patoloji')).toBe(true);
    expect(lessons.has('Fizyoloji')).toBe(true);
    expect(lessons.has('Histoloji')).toBe(true);
  });
});

// ─── buildExamPool ────────────────────────────────────────────────────────────

describe('buildExamPool', () => {
  const qs: Question[] = [
    q('a1', 'Patoloji', 'UA'), q('a2', 'Patoloji', 'UA'), q('a3', 'Patoloji', 'UA'),
    q('b1', 'Fizyoloji', 'UB'), q('b2', 'Fizyoloji', 'UB'), q('b3', 'Fizyoloji', 'UB'),
  ];
  const units = [{ lesson: 'Patoloji', unit: 'UA' }, { lesson: 'Fizyoloji', unit: 'UB' }];

  it('returns at most `amount` questions', () => {
    expect(buildExamPool(qs, units, {}, 4).length).toBeLessThanOrEqual(4);
  });

  it('has no duplicate IDs', () => {
    const result = buildExamPool(qs, units, {}, 6);
    expect(new Set(result.map(r => r.id)).size).toBe(result.length);
  });

  it('applies a filter function', () => {
    const result = buildExamPool(qs, units, {}, 10, r => r.lesson === 'Patoloji');
    result.forEach(r => expect(r.lesson).toBe('Patoloji'));
  });

  it('returns empty array when units list is empty', () => {
    expect(buildExamPool(qs, [], {}, 5)).toHaveLength(0);
  });

  it('returns empty array when filtered pool is empty', () => {
    const result = buildExamPool(qs, units, {}, 5, () => false);
    expect(result).toHaveLength(0);
  });
});
