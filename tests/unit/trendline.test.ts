import { describe, it, expect } from 'vitest';
import { linearFit, bucketTrend } from '$lib/trendline';

describe('linearFit', () => {
  it('returns null for < 2 points', () => {
    expect(linearFit([])).toBeNull();
    expect(linearFit([42])).toBeNull();
  });

  it('flat data → slope 0, intercept = value', () => {
    const fit = linearFit([5, 5, 5, 5]);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(0);
    expect(fit!.intercept).toBeCloseTo(5);
  });

  it('monotonically increasing → positive slope', () => {
    const fit = linearFit([0, 10, 20, 30]);
    expect(fit!.slope).toBeCloseTo(10);
    expect(fit!.intercept).toBeCloseTo(0);
  });

  it('monotonically decreasing → negative slope', () => {
    const fit = linearFit([30, 20, 10, 0]);
    expect(fit!.slope).toBeCloseTo(-10);
    expect(fit!.intercept).toBeCloseTo(30);
  });
});

describe('bucketTrend', () => {
  it('returns [] for fewer than 2 rows', () => {
    expect(bucketTrend([], 'bucket', ['a'])).toEqual([]);
    expect(bucketTrend([{ bucket: 'Jan', a: 5 }], 'bucket', ['a'])).toEqual([]);
  });

  it('sums series keys as y and fits line', () => {
    const rows = [
      { bucket: 'Jan', a: 1, b: 2 },  // total 3
      { bucket: 'Feb', a: 3, b: 4 },  // total 7
      { bucket: 'Mar', a: 5, b: 6 }   // total 11
    ];
    const trend = bucketTrend(rows, 'bucket', ['a', 'b']);
    expect(trend).toHaveLength(3);
    expect(trend[0].bucket).toBe('Jan');
    expect(trend[0].trend).toBeCloseTo(3);
    expect(trend[1].trend).toBeCloseTo(7);
    expect(trend[2].trend).toBeCloseTo(11);
  });

  it('ignores non-numeric cells in series keys', () => {
    const rows = [
      { bucket: 'Jan', a: 10, b: 'oops' as unknown as number },
      { bucket: 'Feb', a: 20, b: 'nope' as unknown as number }
    ];
    const trend = bucketTrend(rows, 'bucket', ['a', 'b']);
    expect(trend[0].trend).toBeCloseTo(10);
    expect(trend[1].trend).toBeCloseTo(20);
  });
});
