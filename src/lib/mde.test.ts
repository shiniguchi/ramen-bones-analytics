// Unit tests for src/lib/mde.ts — pure math, no DOM, no Svelte.
// Covers: sampleStd Bessel correction, harmonicMean, Step-3-PDF sanity
// (σ=222, n₁=20, n₂=4 → MDE≈340), curve monotonicity, dailyRevenuesEUR
// same-date rollup + cents→euros conversion, mdeCurvePoints length + shape.

import { describe, it, expect } from 'vitest';
import {
  MDE_C,
  MDE_MAX_CAMPAIGN_DAYS,
  dailyRevenuesEUR,
  harmonicMean,
  mdeAt,
  mdeCurvePoints,
  sampleStd
} from './mde';
import type { DailyRow } from '$lib/dashboardStore.svelte';

const row = (partial: Partial<DailyRow> & { business_date: string; gross_cents: number }): DailyRow => ({
  sales_type: 'INHOUSE',
  is_cash: false,
  visit_seq: 1,
  card_hash: 'abc',
  ...partial
});

describe('sampleStd', () => {
  it('returns ~100 for [100, 200, 300] (Bessel-corrected)', () => {
    expect(sampleStd([100, 200, 300])).toBeCloseTo(100, 2);
  });

  it('returns 0 for a single value', () => {
    expect(sampleStd([50])).toBe(0);
  });

  it('returns 0 for an empty array', () => {
    expect(sampleStd([])).toBe(0);
  });
});

describe('harmonicMean', () => {
  it('returns ~6.667 for (20, 4)', () => {
    expect(harmonicMean(20, 4)).toBeCloseTo(2 * 20 * 4 / 24, 2);
    expect(harmonicMean(20, 4)).toBeCloseTo(6.667, 2);
  });

  it('returns 0 when either input is 0', () => {
    expect(harmonicMean(0, 10)).toBe(0);
    expect(harmonicMean(10, 0)).toBe(0);
  });
});

describe('mdeAt', () => {
  it('matches Step-3 PDF sanity check: σ=222, n₁=20, n₂=4 → MDE ≈ 340 €/day', () => {
    // Closed-form: 222 * sqrt(15.68 * 24 / 160) = 222 * sqrt(2.352) ≈ 340.5
    expect(mdeAt(222, 20, 4)).toBeCloseTo(340, 0);
  });

  it('returns 0 when sigma is 0', () => {
    expect(mdeAt(0, 20, 4)).toBe(0);
  });

  it('curve descends as n₂ grows (more days ⇒ tighter detectable lift)', () => {
    expect(mdeAt(222, 20, 20)).toBeLessThan(mdeAt(222, 20, 4));
    expect(mdeAt(222, 20, 14)).toBeLessThan(mdeAt(222, 20, 7));
    expect(mdeAt(222, 20, 7)).toBeLessThan(mdeAt(222, 20, 1));
  });

  it('MDE_C is approximately 15.68', () => {
    expect(MDE_C).toBeCloseTo(15.68, 2);
  });
});

describe('dailyRevenuesEUR', () => {
  it('rolls two rows on the same business_date into one day and returns euros, not cents', () => {
    const rows: DailyRow[] = [
      row({ business_date: '2026-04-01', gross_cents: 10_000 }),   // €100
      row({ business_date: '2026-04-01', gross_cents: 5_000 }),    // €50  → day sums to €150
      row({ business_date: '2026-04-02', gross_cents: 20_000 })    // €200
    ];
    const out = dailyRevenuesEUR(rows);
    expect(out).toHaveLength(2);
    // Order from Map insertion is stable: [€150, €200]
    expect(out).toContain(150);
    expect(out).toContain(200);
    // Total euros (not cents) — catches cents→euros bugs.
    expect(out.reduce((s, v) => s + v, 0)).toBe(350);
  });

  it('returns an empty array for no rows', () => {
    expect(dailyRevenuesEUR([])).toEqual([]);
  });
});

describe('mdeCurvePoints', () => {
  it('returns 14 points for default maxDays, all finite, strictly decreasing', () => {
    const curve = mdeCurvePoints(222, 20);
    expect(curve).toHaveLength(MDE_MAX_CAMPAIGN_DAYS);
    expect(curve[0].n2).toBe(1);
    expect(curve[curve.length - 1].n2).toBe(MDE_MAX_CAMPAIGN_DAYS);
    for (const p of curve) {
      expect(Number.isFinite(p.mde)).toBe(true);
      expect(p.mde).toBeGreaterThan(0);
    }
    // Strictly decreasing in n₂.
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].mde).toBeLessThan(curve[i - 1].mde);
    }
  });

  it('returns zeros when sigma is 0', () => {
    const curve = mdeCurvePoints(0, 20);
    expect(curve).toHaveLength(MDE_MAX_CAMPAIGN_DAYS);
    for (const p of curve) expect(p.mde).toBe(0);
  });
});
