import { describe, it, expect, vi, afterEach } from 'vitest';
import { addDays, todayStr } from '../dateUtils';

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2024-01-01', 5)).toBe('2024-01-06');
  });

  it('crosses month boundary', () => {
    expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
  });

  it('crosses year boundary', () => {
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
  });

  it('handles zero days', () => {
    expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
  });

  it('handles negative days', () => {
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // 2024 is leap year
  });

  it('handles Feb 29 in a leap year', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('skips Feb 29 in a non-leap year', () => {
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
  });

  it('handles large offsets', () => {
    // 2024 is a leap year so Jan 1 + 365 = Dec 31
    expect(addDays('2024-01-01', 365)).toBe('2024-12-31');
  });

  it('returns YYYY-MM-DD format', () => {
    expect(addDays('2024-01-01', 1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('zero-pads month and day', () => {
    expect(addDays('2024-01-08', 1)).toBe('2024-01-09');
  });
});

describe('todayStr', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns YYYY-MM-DD format', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the local date (not UTC)', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(todayStr()).toBe(expected);
  });

  it('zero-pads single-digit months and days', () => {
    // Simulate Jan 5
    const fakeDate = new Date(2024, 0, 5);
    vi.spyOn(globalThis, 'Date').mockImplementation((...args) =>
      args.length === 0 ? fakeDate : new (Date as any)(...args)
    );
    expect(todayStr()).toBe('2024-01-05');
  });
});
