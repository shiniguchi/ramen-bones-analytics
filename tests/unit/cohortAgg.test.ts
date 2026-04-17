// Phase 10 Plan 01 — Nyquist RED scaffold for cohort aggregations (VA-09, VA-10).
// Tests MUST fail until plan 10-04 creates src/lib/cohortAgg.ts exporting
// cohortRevenueSum + cohortAvgLtv + CustomerLtvRow type.
// Both aggregators respect SPARSE_MIN_COHORT_SIZE=5 from $lib/sparseFilter.
import { describe, it, expect } from 'vitest';
import { cohortRevenueSum, cohortAvgLtv, type CustomerLtvRow } from '../../src/lib/cohortAgg';

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
    const m = result.find(r => r.cohort === '2026-03-01');
    expect(m?.customer_count).toBe(9);
  });
});
