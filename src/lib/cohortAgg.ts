// Cohort aggregation helpers for VA-07 / VA-10. Client-side GROUP BY per D-01
// hybrid approach — no dedicated MV because ~2000 customer payload is trivial.
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

// ============================================================================
// Pass 4 (quick-260418-4oh): 8-bucket visit_count segmentation — VA-07 + VA-10.
// Mirrors dashboardStore.visitSeqBucket but from customer lifetime visit_count
// (not per-transaction visit_seq). NO 'cash' bucket — customer_ltv_v rows
// already exclude anonymous cash customers.
// ============================================================================

export const VISIT_BUCKET_KEYS = [
  '1st', '2nd', '3rd', '4x', '5x', '6x', '7x', '8x+'
] as const;
export type VisitBucket = typeof VISIT_BUCKET_KEYS[number];

/** Classify a customer's lifetime visit_count into one of 8 labelled buckets. */
export function visitCountBucket(visit_count: number): VisitBucket {
  if (visit_count <= 1) return '1st';
  if (visit_count === 2) return '2nd';
  if (visit_count === 3) return '3rd';
  if (visit_count >= 8) return '8x+';
  return `${visit_count}x` as VisitBucket; // 4x, 5x, 6x, 7x
}

/**
 * VA-07 / VA-10: per-cohort avg revenue_cents split into 8 visit-count buckets.
 * Sparse-filters cohorts below SPARSE_MIN_COHORT_SIZE (by total_customers, not per-bucket).
 * Empty bucket → 0 (never NaN), so BarChart renders a zero-height bar, not undefined.
 */
export function cohortAvgLtvByVisitBucket(
  rows: CustomerLtvRow[],
  grain: 'week' | 'month'
): Array<{ cohort: string; total_customers: number } & Record<VisitBucket, number>> {
  type Accum = Record<VisitBucket, { sum: number; count: number }> & { total_customers: number };
  const empty = (): Accum => {
    const a = { total_customers: 0 } as Accum;
    for (const k of VISIT_BUCKET_KEYS) a[k] = { sum: 0, count: 0 };
    return a;
  };
  const agg = new Map<string, Accum>();
  for (const r of rows) {
    const key = pickCohortKey(r, grain);
    const bucket = visitCountBucket(r.visit_count);
    const e = agg.get(key) ?? empty();
    e[bucket].sum += r.revenue_cents;
    e[bucket].count += 1;
    e.total_customers += 1;
    agg.set(key, e);
  }
  return Array.from(agg.entries())
    .filter(([, v]) => v.total_customers >= SPARSE_MIN_COHORT_SIZE)
    .map(([cohort, v]) => {
      const out = { cohort, total_customers: v.total_customers } as {
        cohort: string;
        total_customers: number;
      } & Record<VisitBucket, number>;
      for (const k of VISIT_BUCKET_KEYS) {
        out[k] = v[k].count > 0 ? v[k].sum / v[k].count : 0;
      }
      return out;
    })
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}
