import { describe, it, expect } from 'vitest';
import {
  interpolateBenchmark,
  MAX_PERIOD_WEEKS,
  MAX_PERIOD_MONTHS,
  type BenchmarkAnchor
} from '$lib/benchmarkInterp';

// Matches the seed in migration 0031 (after test_benchmark_curve for ramen-bones):
// W1: 18/18/18 (1 source) · W4: 17.5/38/47 (5) · W12: 18/25/40 (8) · W26: 22/22/25 (3) · W52: 20/21/21 (3)
const SEED_ANCHORS: BenchmarkAnchor[] = [
  { period_weeks: 1,  lower_p20: 18.0, mid_p50: 18.0, upper_p80: 18.0, source_count: 1 },
  { period_weeks: 4,  lower_p20: 17.5, mid_p50: 38.0, upper_p80: 47.0, source_count: 5 },
  { period_weeks: 12, lower_p20: 18.0, mid_p50: 25.0, upper_p80: 40.0, source_count: 8 },
  { period_weeks: 26, lower_p20: 22.0, mid_p50: 22.0, upper_p80: 25.0, source_count: 3 },
  { period_weeks: 52, lower_p20: 20.0, mid_p50: 21.0, upper_p80: 21.0, source_count: 3 }
];

describe('interpolateBenchmark — empty / edge cases', () => {
  it('returns empty array when no anchors given', () => {
    expect(interpolateBenchmark([], 'linear',     'week')).toEqual([]);
    expect(interpolateBenchmark([], 'log-linear', 'month')).toEqual([]);
  });

  it('returns empty array for day grain (benchmark not applicable)', () => {
    expect(interpolateBenchmark(SEED_ANCHORS, 'linear', 'day')).toEqual([]);
  });
});

describe('interpolateBenchmark — weekly grain', () => {
  it('produces 53 points (W0..W52) covering the full weekly domain', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    expect(out).toHaveLength(MAX_PERIOD_WEEKS + 1);
    expect(out[0].period).toBe(0);
    expect(out[out.length - 1].period).toBe(MAX_PERIOD_WEEKS);
  });

  it('starts at 100% at W0 (implicit anchor — the cohort first-visit)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    expect(out[0].lower).toBe(1.0);
    expect(out[0].mid).toBe(1.0);
    expect(out[0].upper).toBe(1.0);
    expect(out[0].isAnchor).toBe(true);
  });

  it('produces exact anchor values at anchor periods (linear)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    const at = (p: number) => out.find(o => o.period === p)!;
    // Values stored 0-100 in DB; interpolator returns 0-1 fractions.
    expect(at(1).mid).toBeCloseTo(0.18, 6);
    expect(at(1).isAnchor).toBe(true);
    expect(at(4).mid).toBeCloseTo(0.38, 6);
    expect(at(12).mid).toBeCloseTo(0.25, 6);
    expect(at(26).mid).toBeCloseTo(0.22, 6);
    expect(at(52).mid).toBeCloseTo(0.21, 6);
  });

  it('produces exact anchor values at anchor periods (log-linear)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'log-linear', 'week');
    const at = (p: number) => out.find(o => o.period === p)!;
    expect(at(1).mid).toBeCloseTo(0.18, 6);
    expect(at(4).mid).toBeCloseTo(0.38, 6);
    expect(at(12).mid).toBeCloseTo(0.25, 6);
    expect(at(26).mid).toBeCloseTo(0.22, 6);
    expect(at(52).mid).toBeCloseTo(0.21, 6);
  });

  it('linear interpolation midpoint equals arithmetic mean of bracketing anchors', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    // W1..W4: linear midpoint (W2.5 doesn't exist; check W2 at t=1/3, W3 at t=2/3)
    // Instead verify a known midpoint: between W4=0.38 and W12=0.25 at W8 (t=0.5)
    const w8 = out.find(o => o.period === 8)!;
    expect(w8.mid).toBeCloseTo((0.38 + 0.25) / 2, 6);
  });

  it('log-linear interpolation midpoint equals geometric mean of bracketing anchors', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'log-linear', 'week');
    const w8 = out.find(o => o.period === 8)!;
    expect(w8.mid).toBeCloseTo(Math.sqrt(0.38 * 0.25), 6);
  });

  it('lower ≤ mid ≤ upper invariant at every period', () => {
    for (const mode of ['linear', 'log-linear'] as const) {
      const out = interpolateBenchmark(SEED_ANCHORS, mode, 'week');
      for (const p of out) {
        expect(p.lower).toBeLessThanOrEqual(p.mid);
        expect(p.mid).toBeLessThanOrEqual(p.upper);
      }
    }
  });

  it('interpolated points have isAnchor=false (only anchors are isAnchor=true)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    const anchorSet = new Set([0, 1, 4, 12, 26, 52]);
    for (const p of out) {
      expect(p.isAnchor).toBe(anchorSet.has(p.period));
    }
  });

  it('propagates source_count on anchors, zero on interpolated points', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    expect(out.find(o => o.period === 4)!.source_count).toBe(5);
    expect(out.find(o => o.period === 12)!.source_count).toBe(8);
    expect(out.find(o => o.period === 5)!.source_count).toBe(0);  // interpolated
  });
});

describe('interpolateBenchmark — monthly grain', () => {
  it('produces 13 points (M0..M12) covering the full monthly domain', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'month');
    expect(out).toHaveLength(MAX_PERIOD_MONTHS + 1);
    expect(out[0].period).toBe(0);
    expect(out[out.length - 1].period).toBe(MAX_PERIOD_MONTHS);
  });

  it('maps W4→M1, W12→M3, W26→M6, W52→M12 (canonical anchors)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'month');
    const at = (p: number) => out.find(o => o.period === p)!;
    expect(at(0).mid).toBe(1.0);
    expect(at(1).mid).toBeCloseTo(0.38, 6);   // from W4
    expect(at(3).mid).toBeCloseTo(0.25, 6);   // from W12
    expect(at(6).mid).toBeCloseTo(0.22, 6);   // from W26
    expect(at(12).mid).toBeCloseTo(0.21, 6);  // from W52

    expect(at(1).isAnchor).toBe(true);
    expect(at(3).isAnchor).toBe(true);
    expect(at(6).isAnchor).toBe(true);
    expect(at(12).isAnchor).toBe(true);
  });

  it('drops W1 anchor on monthly grain (no integer-month equivalent)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'month');
    // M0 is implicit 100%; M1 should come from W4=0.38, NOT W1=0.18.
    const m1 = out.find(o => o.period === 1)!;
    expect(m1.mid).toBeCloseTo(0.38, 6);
  });

  it('interpolates between monthly anchors (linear)', () => {
    const out = interpolateBenchmark(SEED_ANCHORS, 'linear', 'month');
    // M2 sits between M1=0.38 and M3=0.25 at t=0.5
    const m2 = out.find(o => o.period === 2)!;
    expect(m2.mid).toBeCloseTo((0.38 + 0.25) / 2, 6);
    expect(m2.isAnchor).toBe(false);
  });

  it('lower ≤ mid ≤ upper invariant at every monthly period', () => {
    for (const mode of ['linear', 'log-linear'] as const) {
      const out = interpolateBenchmark(SEED_ANCHORS, mode, 'month');
      for (const p of out) {
        expect(p.lower).toBeLessThanOrEqual(p.mid);
        expect(p.mid).toBeLessThanOrEqual(p.upper);
      }
    }
  });
});

describe('interpolateBenchmark — robustness', () => {
  it('handles a single non-W0 anchor (flat line after the anchor)', () => {
    const oneAnchor: BenchmarkAnchor[] = [
      { period_weeks: 12, lower_p20: 20, mid_p50: 25, upper_p80: 30, source_count: 1 }
    ];
    const out = interpolateBenchmark(oneAnchor, 'linear', 'week');
    expect(out[0].mid).toBe(1.0);           // implicit W0
    expect(out[12].mid).toBeCloseTo(0.25, 6); // anchor
    expect(out[40].mid).toBeCloseTo(0.25, 6); // flat past last anchor
  });

  it('is order-independent (shuffled anchors produce same output)', () => {
    const shuffled = [...SEED_ANCHORS].reverse();
    const a = interpolateBenchmark(SEED_ANCHORS, 'linear', 'week');
    const b = interpolateBenchmark(shuffled,     'linear', 'week');
    expect(a).toEqual(b);
  });

  it('log-linear handles near-zero values without NaN', () => {
    const withZero: BenchmarkAnchor[] = [
      { period_weeks: 1,  lower_p20: 0,    mid_p50: 0.01, upper_p80: 5, source_count: 1 },
      { period_weeks: 52, lower_p20: 20,   mid_p50: 21,   upper_p80: 22, source_count: 3 }
    ];
    const out = interpolateBenchmark(withZero, 'log-linear', 'week');
    for (const p of out) {
      expect(Number.isFinite(p.lower)).toBe(true);
      expect(Number.isFinite(p.mid)).toBe(true);
      expect(Number.isFinite(p.upper)).toBe(true);
    }
  });
});
