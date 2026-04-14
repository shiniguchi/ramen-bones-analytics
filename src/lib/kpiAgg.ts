// kpiAgg.ts — Pure aggregation helper for kpi_daily_v rows.
// Extracted from the loader so it can be unit-tested without SvelteKit context.

export interface KpiRow {
  revenue_cents: number;
  tx_count: number;
  avg_ticket_cents: number;
}

export interface KpiAgg {
  revenue_cents: number;
  tx_count: number;
  avg_ticket_cents: number;
}

/**
 * Sum a set of kpi_daily_v rows into a single aggregate.
 * avg_ticket_cents is recomputed as revenue / tx (never averaged-of-averages).
 * Accepts null (failed query slot) and treats it as an empty array.
 */
export function sumKpi(rows: KpiRow[] | null | undefined): KpiAgg {
  const data = rows ?? [];
  const revenue_cents = data.reduce((s, r) => s + Number(r.revenue_cents), 0);
  const tx_count = data.reduce((s, r) => s + Number(r.tx_count), 0);
  const avg_ticket_cents = tx_count === 0 ? 0 : revenue_cents / tx_count;
  return { revenue_cents, tx_count, avg_ticket_cents };
}
