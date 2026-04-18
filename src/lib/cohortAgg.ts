// Cohort aggregation helpers for VA-09 / VA-10. Client-side GROUP BY per D-01 hybrid
// approach — no dedicated MV because ~2000 customer payload is trivial.
import { SPARSE_MIN_COHORT_SIZE } from './sparseFilter';

export type CustomerLtvRow = {
  card_hash: string;
  revenue_cents: number;
  visit_count: number;
  cohort_week: string;   // YYYY-MM-DD (Monday)
  cohort_month: string;  // YYYY-MM-DD (Postgres DATE via customer_ltv_v) — sliced to YYYY-MM by pickCohortKey
};

function pickCohortKey(row: CustomerLtvRow, grain: 'week' | 'month'): string {
  return grain === 'week' ? row.cohort_week : row.cohort_month.slice(0, 7);
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

// ============================================================================
// Pass 3 (quick-260418-3ec): repeater segmentation — VA-07/09/10.
// ============================================================================

/** Threshold: customers with visit_count >= REPEATER_MIN_VISITS are "repeat", else "new". */
export const REPEATER_MIN_VISITS = 2;

export type RepeaterClass = 'new' | 'repeat';

/** Deterministic classifier; shared by LTV histogram + cohort *ByRepeater aggregators. */
export function classifyRepeater(visit_count: number): RepeaterClass {
  return visit_count >= REPEATER_MIN_VISITS ? 'repeat' : 'new';
}

/**
 * VA-09: SUM revenue_cents per cohort, split by repeater class.
 * Same sparse filter + same key bucketing (pickCohortKey) as cohortRevenueSum.
 */
export function cohortRevenueSumByRepeater(
  rows: CustomerLtvRow[],
  grain: 'week' | 'month'
): Array<{ cohort: string; new_cents: number; repeat_cents: number; customer_count: number }> {
  const agg = new Map<string, { new_cents: number; repeat_cents: number; customer_count: number }>();
  for (const r of rows) {
    const key = pickCohortKey(r, grain);
    const cls = classifyRepeater(r.visit_count);
    const e = agg.get(key);
    if (e) {
      if (cls === 'new') e.new_cents += r.revenue_cents;
      else e.repeat_cents += r.revenue_cents;
      e.customer_count += 1;
    } else {
      agg.set(key, {
        new_cents: cls === 'new' ? r.revenue_cents : 0,
        repeat_cents: cls === 'repeat' ? r.revenue_cents : 0,
        customer_count: 1
      });
    }
  }
  return Array.from(agg.entries())
    .filter(([, v]) => v.customer_count >= SPARSE_MIN_COHORT_SIZE)
    .map(([cohort, v]) => ({ cohort, ...v }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}

/**
 * VA-10: AVG revenue_cents per cohort, split by repeater class.
 * Averages computed independently per class — do NOT stack (averages don't sum).
 * Empty class returns 0 (never NaN) so BarChart renders a zero-height bar, not undefined.
 */
export function cohortAvgLtvByRepeater(
  rows: CustomerLtvRow[],
  grain: 'week' | 'month'
): Array<{ cohort: string; new_avg_cents: number; repeat_avg_cents: number; new_count: number; repeat_count: number }> {
  const agg = new Map<string, { new_cents: number; repeat_cents: number; new_count: number; repeat_count: number }>();
  for (const r of rows) {
    const key = pickCohortKey(r, grain);
    const cls = classifyRepeater(r.visit_count);
    const e = agg.get(key) ?? { new_cents: 0, repeat_cents: 0, new_count: 0, repeat_count: 0 };
    if (cls === 'new')    { e.new_cents    += r.revenue_cents; e.new_count    += 1; }
    else                  { e.repeat_cents += r.revenue_cents; e.repeat_count += 1; }
    agg.set(key, e);
  }
  return Array.from(agg.entries())
    .filter(([, v]) => (v.new_count + v.repeat_count) >= SPARSE_MIN_COHORT_SIZE)
    .map(([cohort, v]) => ({
      cohort,
      new_avg_cents:    v.new_count    > 0 ? v.new_cents    / v.new_count    : 0,
      repeat_avg_cents: v.repeat_count > 0 ? v.repeat_cents / v.repeat_count : 0,
      new_count: v.new_count,
      repeat_count: v.repeat_count
    }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}
