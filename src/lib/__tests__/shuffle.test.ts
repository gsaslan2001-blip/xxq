import { describe, it, expect } from 'vitest';
import { fisherYates } from '../shuffle';

describe('fisherYates', () => {
  it('returns an array of the same length', () => {
    expect(fisherYates([1, 2, 3, 4, 5])).toHaveLength(5);
  });

  it('contains exactly the same elements as the input', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(fisherYates(arr).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    fisherYates(arr);
    expect(arr).toEqual(copy);
  });

  it('handles an empty array', () => {
    expect(fisherYates([])).toEqual([]);
  });

  it('handles a single-element array', () => {
    expect(fisherYates([42])).toEqual([42]);
  });

  it('works with string arrays', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const result = fisherYates(arr);
    expect(result.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('works with object arrays (reference equality)', () => {
    const objs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = fisherYates(objs);
    expect(result).toHaveLength(3);
    objs.forEach(obj => expect(result).toContain(obj));
  });

  it('produces different orderings over multiple runs (statistical)', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(JSON.stringify(fisherYates(arr)));
    }
    // Probability of all 50 runs being identical: astronomically small
    expect(seen.size).toBeGreaterThan(1);
  });
});
