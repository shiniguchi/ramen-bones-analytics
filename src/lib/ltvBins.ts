// LTV histogram bin definitions (D-12). Dynamic €5 buckets — scale to data, overflow at €250.
// UI constants, not SQL (D-13). Pass 3 rewrite (quick-260418-3ec): was 6 hardcoded bins; now step-based.
export type LtvBin = { label: string; minCents: number; maxCents: number };

export const LTV_BIN_STEP_CENTS = 500;      // €5 step
export const LTV_BIN_MAX_CENTS_CAP = 25000; // €250 — beyond this, everything goes into overflow

/**
 * Build bins sized to actual data. Guarantees at least one bin ('€0–5') even when data empty.
 * Overflow bin '€250+' is appended only if any customer exceeds the cap.
 *
 * Labels use U+2013 (en-dash), matching existing convention from the old LTV_BINS constant.
 */
export function buildLtvBins(maxRevenueCents: number): LtvBin[] {
  const bins: LtvBin[] = [];
  if (maxRevenueCents <= 0) {
    return [{ label: '€0\u20135', minCents: 0, maxCents: LTV_BIN_STEP_CENTS }];
  }
  // Round the top edge up to the next €5, then clamp to cap. Everything above cap → overflow bin.
  const topEdge = Math.min(
    Math.ceil(maxRevenueCents / LTV_BIN_STEP_CENTS) * LTV_BIN_STEP_CENTS,
    LTV_BIN_MAX_CENTS_CAP
  );
  for (let lo = 0; lo < topEdge; lo += LTV_BIN_STEP_CENTS) {
    const hi = lo + LTV_BIN_STEP_CENTS;
    const loEur = lo / 100;
    const hiEur = hi / 100;
    bins.push({ label: `€${loEur}\u2013${hiEur}`, minCents: lo, maxCents: hi });
  }
  if (maxRevenueCents > LTV_BIN_MAX_CENTS_CAP) {
    bins.push({ label: '€250+', minCents: LTV_BIN_MAX_CENTS_CAP, maxCents: Number.MAX_SAFE_INTEGER });
  }
  return bins;
}

/**
 * Right-exclusive bin assignment: customer goes into the bin where
 * revenue_cents ∈ [minCents, maxCents). Last bin acts as overflow guard.
 */
export function binCustomerRevenue(revenue_cents: number, bins: LtvBin[]): string {
  for (const b of bins) {
    if (revenue_cents >= b.minCents && revenue_cents < b.maxCents) return b.label;
  }
  return bins[bins.length - 1].label;
}
