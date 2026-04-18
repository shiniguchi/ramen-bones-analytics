// cohortAgg — Pass 4 rewrite (quick-260418-4oh): VA-09 CohortRevenueCard was
// deleted; cohortRevenueSum / cohortAvgLtv / cohortRevenueSumByRepeater removed.
// Remaining VA-10 path still uses cohortAvgLtvByRepeater until Task 5 replaces it
// with cohortAvgLtvByVisitBucket.
import { describe, it, expect } from 'vitest';
import {
  classifyRepeater,
  cohortAvgLtvByRepeater,
  REPEATER_MIN_VISITS,
  type CustomerLtvRow,
  type RepeaterClass
} from '../../src/lib/cohortAgg';

// ============================================================================
// Pass 3 (quick-260418-3ec): repeater-segmentation helpers — VA-10 only post-Pass 4.
// ============================================================================

describe('classifyRepeater (Pass 3)', () => {
  it('REPEATER_MIN_VISITS is 2', () => {
    expect(REPEATER_MIN_VISITS).toBe(2);
  });

  it('0 visits → new', () => {
    const cls: RepeaterClass = classifyRepeater(0);
    expect(cls).toBe('new');
  });

  it('1 visit → new', () => {
    expect(classifyRepeater(1)).toBe('new');
  });

  it('2 visits → repeat (threshold)', () => {
    expect(classifyRepeater(2)).toBe('repeat');
  });

  it('10 visits → repeat', () => {
    expect(classifyRepeater(10)).toBe('repeat');
  });
});

describe('cohortAvgLtvByRepeater (Pass 3 — VA-10)', () => {
  // Same 10-customer mixed fixture.
  const mixedRows: CustomerLtvRow[] = [
    ...Array.from({ length: 5 }, (_, i) => ({
      card_hash: `new${i}`,
      revenue_cents: 1000,
      visit_count: 1,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      card_hash: `rep${i}`,
      revenue_cents: 3000,
      visit_count: 3,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }))
  ];

  it('averages revenue per class separately', () => {
    const result = cohortAvgLtvByRepeater(mixedRows, 'week');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      cohort: '2026-01-05',
      new_avg_cents: 1000,
      repeat_avg_cents: 3000,
      new_count: 5,
      repeat_count: 5
    });
  });

  it('all one-timers → repeat_avg_cents=0 (not NaN)', () => {
    const allNew: CustomerLtvRow[] = Array.from({ length: 10 }, (_, i) => ({
      card_hash: `n${i}`,
      revenue_cents: 2000,
      visit_count: 1,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }));
    const result = cohortAvgLtvByRepeater(allNew, 'week');
    expect(result).toHaveLength(1);
    expect(result[0].new_avg_cents).toBe(2000);
    expect(result[0].repeat_avg_cents).toBe(0);
    expect(Number.isNaN(result[0].repeat_avg_cents)).toBe(false);
    expect(result[0].new_count).toBe(10);
    expect(result[0].repeat_count).toBe(0);
  });

  it('all repeaters → new_avg_cents=0 (not NaN)', () => {
    const allRep: CustomerLtvRow[] = Array.from({ length: 10 }, (_, i) => ({
      card_hash: `r${i}`,
      revenue_cents: 2000,
      visit_count: 5,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }));
    const result = cohortAvgLtvByRepeater(allRep, 'week');
    expect(result).toHaveLength(1);
    expect(result[0].new_avg_cents).toBe(0);
    expect(Number.isNaN(result[0].new_avg_cents)).toBe(false);
    expect(result[0].repeat_avg_cents).toBe(2000);
    expect(result[0].new_count).toBe(0);
    expect(result[0].repeat_count).toBe(10);
  });

  it('sparse-filters cohorts below SPARSE_MIN_COHORT_SIZE (matches cohortRevenueSum behavior)', () => {
    const fixture: CustomerLtvRow[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        card_hash: `big${i}`,
        revenue_cents: 1000,
        visit_count: 1,
        cohort_week: '2026-01-05',
        cohort_month: '2026-01-01'
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        card_hash: `small${i}`,
        revenue_cents: 1000,
        visit_count: 1,
        cohort_week: '2026-01-12',
        cohort_month: '2026-01-01'
      }))
    ];
    const result = cohortAvgLtvByRepeater(fixture, 'week');
    expect(result).toHaveLength(1);
    expect(result[0].cohort).toBe('2026-01-05');
  });

  it('month grain rolls two weekly buckets into one monthly cohort', () => {
    const monthRows: CustomerLtvRow[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        card_hash: `j1${i}`,
        revenue_cents: 1000,
        visit_count: 1,
        cohort_week: '2026-01-12',
        cohort_month: '2026-01-15'
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        card_hash: `j2${i}`,
        revenue_cents: 2000,
        visit_count: 3,
        cohort_week: '2026-01-19',
        cohort_month: '2026-01-22'
      }))
    ];
    const result = cohortAvgLtvByRepeater(monthRows, 'month');
    expect(result).toHaveLength(1);
    expect(result[0].cohort).toBe('2026-01');
    expect(result[0].new_avg_cents).toBe(1000);
    expect(result[0].repeat_avg_cents).toBe(2000);
    expect(result[0].new_count).toBe(5);
    expect(result[0].repeat_count).toBe(5);
  });
});
