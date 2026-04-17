// Cohort aggregation helpers for VA-09 / VA-10. Client-side GROUP BY per D-01 hybrid
// approach — no dedicated MV because ~2000 customer payload is trivial.
import { SPARSE_MIN_COHORT_SIZE } from './sparseFilter';

export type CustomerLtvRow = {
  card_hash: string;
  revenue_cents: number;
  visit_count: number;
  cohort_week: string;   // YYYY-MM-DD (Monday)
  cohort_month: string;  // YYYY-MM-01
};

function pickCohortKey(row: CustomerLtvRow, grain: 'week' | 'month'): string {
  return grain === 'week' ? row.cohort_week : row.cohort_month;
}

/** VA-09: SUM revenue_cents per cohort. Drops cohorts below SPARSE_MIN_COHORT_SIZE. */
export function cohortRevenueSum(
  rows: CustomerLtvRow[],
  grain: 'week' | 'month'
): Array<{ cohort: string; total_revenue_cents: number; customer_count: number }> {
  const agg = new Map<string, { total_revenue_cents: number; customer_count: number }>();
  for (const r of rows) {
    const key = pickCohortKey(r, grain);
    const e = agg.get(key);
    if (e) { e.total_revenue_cents += r.revenue_cents; e.customer_count += 1; }
    else   { agg.set(key, { total_revenue_cents: r.revenue_cents, customer_count: 1 }); }
  }
  return Array.from(agg.entries())
    .filter(([, v]) => v.customer_count >= SPARSE_MIN_COHORT_SIZE)
    .map(([cohort, v]) => ({ cohort, ...v }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}

/** VA-10: AVG revenue_cents per cohort. Drops cohorts below SPARSE_MIN_COHORT_SIZE. */
export function cohortAvgLtv(
  rows: CustomerLtvRow[],
  grain: 'week' | 'month'
): Array<{ cohort: string; avg_revenue_cents: number; customer_count: number }> {
  const sums = cohortRevenueSum(rows, grain);
  return sums.map(s => ({
    cohort: s.cohort,
    avg_revenue_cents: s.total_revenue_cents / s.customer_count,
    customer_count: s.customer_count
  }));
}
