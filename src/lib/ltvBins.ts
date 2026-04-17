// LTV histogram bin definitions (D-12, D-13). UI constants, not SQL — tunable without migration.
export type LtvBin = { label: string; minCents: number; maxCents: number };

export const LTV_BINS: readonly LtvBin[] = [
  { label: '€0–10',    minCents:      0, maxCents:   1000 },
  { label: '€10–25',   minCents:   1000, maxCents:   2500 },
  { label: '€25–50',   minCents:   2500, maxCents:   5000 },
  { label: '€50–100',  minCents:   5000, maxCents:  10000 },
  { label: '€100–250', minCents:  10000, maxCents:  25000 },
  { label: '€250+',    minCents:  25000, maxCents: Number.MAX_SAFE_INTEGER }
];

/** Assign a per-customer revenue value to an LTV bin label. Right-exclusive boundaries. */
export function binCustomerRevenue(revenue_cents: number): string {
  for (const b of LTV_BINS) {
    if (revenue_cents >= b.minCents && revenue_cents < b.maxCents) return b.label;
  }
  return LTV_BINS[LTV_BINS.length - 1].label; // overflow guard
}
