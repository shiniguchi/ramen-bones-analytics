// Cohort aggregation helpers for VA-07 / VA-10. Client-side GROUP BY per D-01
// hybrid approach — no dedicated MV because ~2000 customer payload is trivial.
import { SPARSE_MIN_COHORT_SIZE } from './sparseFilter';
import { startOfMonth, startOfWeek, parseISO, format } from 'date-fns';

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

// Repeater-only bucket keys (drops '1st' — first-timers are excluded from the
// repeater cohort chart per feedback #6).
export const REPEATER_BUCKET_KEYS = VISIT_BUCKET_KEYS.slice(1) as readonly VisitBucket[];

/**
 * Feedback #6: per first-visit cohort, count of REPEAT customers
 * (visit_count >= 2), split by 7 visit buckets 2nd..8x+.
 * Answers "when did the restaurant acquire the customers who came back?".
 * Sparse-filters cohorts whose total_repeaters < SPARSE_MIN_COHORT_SIZE so tiny
 * all-first-timer cohorts don't clutter the chart.
 */
// ============================================================================
// quick-260420-wdf: day-of-week-aware repeater recomputation.
// When the user picks a subset of weekdays, we recompute customer lifetime
// stats from scratch — "what if we'd never opened on these days?".
// Visit count, cohort_month and cohort_week all shift accordingly.
// ============================================================================

/** Minimal lifetime-scoped transaction row — card_hash not null, any date.
 *  Fed from a separate +page.server.ts fetch that skips the chip window. */
export type RepeaterTxRow = {
  card_hash: string;
  business_date: string; // YYYY-MM-DD
  gross_cents: number;
};

// Worldline blackout window — matches cohort_mv (0010) + customer_ltv_mv (0024).
// Dates in the client's business_date space (Europe/Berlin) since the MV builds
// cohort via the same tz cast.
const BLACKOUT_START = '2026-04-01';
const BLACKOUT_END = '2026-04-12'; // exclusive

/** Recompute per-customer lifetime stats from raw transactions, honoring the
 *  day-of-week filter. Matches customer_ltv_mv semantics (exclude blackout,
 *  exclude cash — enforced at fetch time via card_hash NOT NULL).
 *  Mirrors `cohort_mv` cohort_week math: date_trunc('week', first_visit).
 */
export function recomputeCustomerLtvFromTx(
  rows: RepeaterTxRow[],
  days: number[],
): CustomerLtvRow[] {
  const daysSet = new Set(days);
  const byCard = new Map<string, RepeaterTxRow[]>();
  for (const r of rows) {
    if (r.business_date >= BLACKOUT_START && r.business_date < BLACKOUT_END) continue;
    const dow = ((parseISO(r.business_date).getDay() + 6) % 7) + 1;
    if (!daysSet.has(dow)) continue;
    const arr = byCard.get(r.card_hash);
    if (arr) arr.push(r);
    else byCard.set(r.card_hash, [r]);
  }
  const out: CustomerLtvRow[] = [];
  for (const [card_hash, txs] of byCard) {
    txs.sort((a, b) => a.business_date.localeCompare(b.business_date));
    const firstDate = parseISO(txs[0].business_date);
    let revenue_cents = 0;
    for (const t of txs) revenue_cents += t.gross_cents;
    out.push({
      card_hash,
      revenue_cents,
      visit_count: txs.length,
      cohort_week: format(startOfWeek(firstDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      cohort_month: format(startOfMonth(firstDate), 'yyyy-MM-dd'),
    });
  }
  return out;
}

export function cohortRepeaterCountByVisitBucket(
  rows: CustomerLtvRow[],
  grain: 'week' | 'month'
): Array<{ cohort: string; total_repeaters: number } & Record<VisitBucket, number>> {
  type Accum = Record<VisitBucket, number> & { total_repeaters: number };
  const empty = (): Accum => {
    const a = { total_repeaters: 0 } as Accum;
    for (const k of VISIT_BUCKET_KEYS) a[k] = 0;
    return a;
  };
  const agg = new Map<string, Accum>();
  for (const r of rows) {
    if (r.visit_count <= 1) continue; // skip first-timers
    const key = pickCohortKey(r, grain);
    const bucket = visitCountBucket(r.visit_count);
    const e = agg.get(key) ?? empty();
    e[bucket] += 1;
    e.total_repeaters += 1;
    agg.set(key, e);
  }
  return Array.from(agg.entries())
    .filter(([, v]) => v.total_repeaters >= SPARSE_MIN_COHORT_SIZE)
    .map(([cohort, v]) => {
      const out = { cohort, total_repeaters: v.total_repeaters } as {
        cohort: string;
        total_repeaters: number;
      } & Record<VisitBucket, number>;
      for (const k of VISIT_BUCKET_KEYS) out[k] = v[k];
      return out;
    })
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}
