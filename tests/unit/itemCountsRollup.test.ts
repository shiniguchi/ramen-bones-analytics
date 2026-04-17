// Phase 10 Plan 01 — Nyquist RED scaffold for top-N + Other rollup (VA-08).
// Tests MUST fail until plan 10-04 creates src/lib/itemCountsRollup.ts
// exporting rollupTopNWithOther<T>().
import { describe, it, expect } from 'vitest';
import { rollupTopNWithOther } from '../../src/lib/itemCountsRollup';

describe('rollupTopNWithOther (D-15)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    item_name: `item${i}`,
    item_count: 12 - i // item0=12, item11=1
  }));

  it('keeps top N and rolls remainder into "Other"', () => {
    const result = rollupTopNWithOther(rows, 8);
    expect(result.length).toBe(9); // 8 + Other
    expect(result[8].item_name).toBe('Other');
  });

  it('"Other" sums all non-top counts', () => {
    const result = rollupTopNWithOther(rows, 8);
    // items 8,9,10,11 counts = 4,3,2,1 = 10
    expect(result[8].item_count).toBe(10);
  });

  it('no "Other" when rows.length <= N', () => {
    const result = rollupTopNWithOther(rows.slice(0, 5), 8);
    expect(result.length).toBe(5);
    expect(result.find(r => r.item_name === 'Other')).toBeUndefined();
  });

  it('sorts by item_count descending', () => {
    const result = rollupTopNWithOther(rows, 3);
    expect(result.slice(0, 3).map(r => r.item_count)).toEqual([12, 11, 10]);
  });
});
