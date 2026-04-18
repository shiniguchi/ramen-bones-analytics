// Phase 10 Plan 01 — Nyquist RED scaffold for cohort aggregations (VA-09, VA-10).
// Tests MUST fail until plan 10-04 creates src/lib/cohortAgg.ts exporting
// cohortRevenueSum + cohortAvgLtv + CustomerLtvRow type.
// Both aggregators respect SPARSE_MIN_COHORT_SIZE=5 from $lib/sparseFilter.
import { describe, it, expect } from 'vitest';
import {
  cohortRevenueSum,
  cohortAvgLtv,
  classifyRepeater,
  cohortRevenueSumByRepeater,
  cohortAvgLtvByRepeater,
  REPEATER_MIN_VISITS,
  type CustomerLtvRow,
  type RepeaterClass
} from '../../src/lib/cohortAgg';
import { formatBucketLabel } from '../../src/lib/dashboardStore.svelte';

const rows: CustomerLtvRow[] = [
  // cohort 2026-03-23: 6 customers (above SPARSE_MIN_COHORT_SIZE=5)
  ...Array.from({ length: 6 }, (_, i) => ({
    card_hash: `a${i}`,
    revenue_cents: 1000 * (i + 1),
    visit_count: i + 1,
    cohort_week: '2026-03-23',
    cohort_month: '2026-03-01'
  })),
  // cohort 2026-03-30: 3 customers (below threshold — sparse-filtered)
  ...Array.from({ length: 3 }, (_, i) => ({
    card_hash: `b${i}`,
    revenue_cents: 500,
    visit_count: 1,
    cohort_week: '2026-03-30',
    cohort_month: '2026-03-01'
  }))
];

describe('cohortRevenueSum (VA-09)', () => {
  it('SUMs revenue_cents per cohort_week', () => {
    const result = cohortRevenueSum(rows, 'week');
    const w1 = result.find(r => r.cohort === '2026-03-23');
    expect(w1?.total_revenue_cents).toBe(1000 + 2000 + 3000 + 4000 + 5000 + 6000);
    expect(w1?.customer_count).toBe(6);
  });

  it('sparse-filters cohorts below 5 customers', () => {
    const result = cohortRevenueSum(rows, 'week');
    expect(result.find(r => r.cohort === '2026-03-30')).toBeUndefined();
  });
});

describe('cohortAvgLtv (VA-10)', () => {
  it('AVGs revenue_cents per cohort_week', () => {
    const result = cohortAvgLtv(rows, 'week');
    const w1 = result.find(r => r.cohort === '2026-03-23');
    expect(w1?.avg_revenue_cents).toBe((1000 + 2000 + 3000 + 4000 + 5000 + 6000) / 6);
  });

  it('sparse-filters cohorts below 5 customers', () => {
    const result = cohortAvgLtv(rows, 'week');
    expect(result.find(r => r.cohort === '2026-03-30')).toBeUndefined();
  });
});

describe('grain=month rollup', () => {
  it('groups by cohort_month when grain=month', () => {
    const result = cohortRevenueSum(rows, 'month');
    // Both weeks fall into 2026-03-01 → 9 customers total, meets threshold
    const m = result.find(r => r.cohort === '2026-03');
    expect(m?.customer_count).toBe(9);
  });
});

// 260417-mp2: Regression tests pinning the pickCohortKey → formatBucketLabel contract.
// Bug: pickCohortKey returned raw 'YYYY-MM-DD' from DB; formatBucketLabel appended '-01'
// producing 'YYYY-MM-DD-01' → parseISO() → Invalid Date → format() threw RangeError,
// crashing the reactive $derived chain and silently zeroing all KPI tiles.
describe('month-grain contract (260417-mp2 regression)', () => {
  // 5 customers in June 2025 cohort (meets SPARSE_MIN_COHORT_SIZE=5).
  // Fixture uses 'YYYY-MM-DD' shape — mirrors what Postgres DATE actually returns.
  const june2025Rows: CustomerLtvRow[] = Array.from({ length: 5 }, (_, i) => ({
    card_hash: `j${i}`,
    revenue_cents: 2000,
    visit_count: 2,
    cohort_week: '2025-06-02',
    cohort_month: '2025-06-01'
  }));

  it('A — cohortRevenueSum returns YYYY-MM (length 7) for month grain', () => {
    const result = cohortRevenueSum(june2025Rows, 'month');
    expect(result).toHaveLength(1);
    expect(result[0].cohort).toBe('2025-06');
    expect(result[0].cohort).toHaveLength(7);
  });

  it('B — cohortAvgLtv returns YYYY-MM (length 7) for month grain', () => {
    const result = cohortAvgLtv(june2025Rows, 'month');
    expect(result).toHaveLength(1);
    expect(result[0].cohort).toBe('2025-06');
    expect(result[0].cohort).toHaveLength(7);
  });

  it('C — formatBucketLabel accepts each cohort key without throwing', () => {
    // This is the load-bearing integration test: if pickCohortKey returns 'YYYY-MM-DD',
    // formatBucketLabel(bucket + '-01') produces 'YYYY-MM-DD-01' → RangeError.
    const result = cohortRevenueSum(june2025Rows, 'month');
    for (const row of result) {
      expect(() => formatBucketLabel(row.cohort, 'month')).not.toThrow();
      const label = formatBucketLabel(row.cohort, 'month');
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      expect(label).toBe('Jun');
    }
  });
});

// ============================================================================
// Pass 3 (quick-260418-3ec): repeater-segmentation helpers — VA-07/09/10.
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

describe('cohortRevenueSumByRepeater (Pass 3 — VA-09)', () => {
  // 10 customers in one cohort: 5 one-timers + 5 repeaters (meets SPARSE_MIN_COHORT_SIZE=5)
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

  it('splits revenue sum by repeater class', () => {
    const result = cohortRevenueSumByRepeater(mixedRows, 'week');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      cohort: '2026-01-05',
      new_cents: 5000,
      repeat_cents: 15000,
      customer_count: 10
    });
  });

  it('all one-timers → repeat_cents=0 (no NaN)', () => {
    const allNew: CustomerLtvRow[] = Array.from({ length: 10 }, (_, i) => ({
      card_hash: `n${i}`,
      revenue_cents: 2000,
      visit_count: 1,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }));
    const result = cohortRevenueSumByRepeater(allNew, 'week');
    expect(result).toHaveLength(1);
    expect(result[0].new_cents).toBe(20000);
    expect(result[0].repeat_cents).toBe(0);
    expect(result[0].customer_count).toBe(10);
  });

  it('all repeaters → new_cents=0', () => {
    const allRep: CustomerLtvRow[] = Array.from({ length: 10 }, (_, i) => ({
      card_hash: `r${i}`,
      revenue_cents: 2000,
      visit_count: 5,
      cohort_week: '2026-01-05',
      cohort_month: '2026-01-01'
    }));
    const result = cohortRevenueSumByRepeater(allRep, 'week');
    expect(result).toHaveLength(1);
    expect(result[0].new_cents).toBe(0);
    expect(result[0].repeat_cents).toBe(20000);
  });

  it('sparse-filters cohorts with fewer than SPARSE_MIN_COHORT_SIZE customers', () => {
    // Large cohort (6 customers) + small cohort (2 customers)
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
    const result = cohortRevenueSumByRepeater(fixture, 'week');
    expect(result).toHaveLength(1);
    expect(result[0].cohort).toBe('2026-01-05');
    expect(result.find(r => r.cohort === '2026-01-12')).toBeUndefined();
  });

  it('month grain buckets via cohort_month.slice(0,7)', () => {
    // 5 in week-15 + 5 in week-22 → 10 under 2026-01 when grain=month
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
    const result = cohortRevenueSumByRepeater(monthRows, 'month');
    expect(result).toHaveLength(1);
    expect(result[0].cohort).toBe('2026-01');
    expect(result[0].customer_count).toBe(10);
    expect(result[0].new_cents).toBe(5000);
    expect(result[0].repeat_cents).toBe(10000);
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
