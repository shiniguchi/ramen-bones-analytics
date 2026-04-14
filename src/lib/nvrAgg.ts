// nvrAgg.ts — shape raw new_vs_returning_v rows into per-segment totals.
// Used by the +page.server.ts loader to aggregate over the chip window before
// passing shaped data to NewVsReturningCard. This makes the card itself stateless.
//
// D-19a: NewVsReturningCard IS the chip-scoped exception — receives range-filtered data.
// D-19: returning + new + cash_anonymous must sum to total revenue (tie-out invariant).

export type NvrRow = {
  segment: 'new' | 'returning' | 'cash_anonymous' | 'blackout_unknown';
  revenue_cents: number;
};

export type NvrShaped = {
  segment: 'new' | 'returning' | 'cash_anonymous';
  revenue_cents: number;
};

/**
 * Aggregate raw view rows by segment.
 * - Sums revenue_cents per segment key.
 * - Returns exactly 3 entries: returning, new, cash_anonymous (always present, zero if no data).
 * - blackout_unknown rows are absorbed into cash_anonymous to preserve tie-out.
 */
export function shapeNvr(rows: NvrRow[]): NvrShaped[] {
  const sums: Record<'new' | 'returning' | 'cash_anonymous', number> = {
    returning: 0,
    new: 0,
    cash_anonymous: 0
  };

  for (const row of rows) {
    if (row.segment === 'blackout_unknown') {
      // Absorb blackout rows into cash_anonymous to keep tie-out whole
      sums.cash_anonymous += row.revenue_cents;
    } else if (row.segment in sums) {
      sums[row.segment as keyof typeof sums] += row.revenue_cents;
    }
  }

  // Fixed order: returning, new, cash_anonymous (matches stacked bar segment order)
  return [
    { segment: 'returning', revenue_cents: sums.returning },
    { segment: 'new', revenue_cents: sums.new },
    { segment: 'cash_anonymous', revenue_cents: sums.cash_anonymous }
  ];
}
