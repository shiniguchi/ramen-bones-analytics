// Pure math helpers for the Minimum Detectable Effect (MDE) curve card.
// Mirrors the shape of trendline.ts / kpiAgg.ts / cohortAgg.ts: zero Svelte
// imports, zero side effects, exported constants + pure functions only.
//
// Formula (two-sample one-sided power, equal-variance, σ estimated from
// baseline daily revenue):
//   n_eff(n₁, n₂) = 2·n₁·n₂ / (n₁ + n₂)         ← harmonic mean
//   MDE(n₂)       = σ · √( C · (n₁ + n₂) / (2·n₁·n₂) )
//   C             = 2·(z_{α/2} + z_β)²  ≈ 15.68  (α=0.05 two-tailed, 80% power)
//
// Sanity: σ=222 €/day, n₁=20 days, n₂=4 days → MDE ≈ 340 €/day (matches the
// founder's Step-3 teaching PDF).

import type { DailyRow } from '$lib/dashboardStore.svelte';

/** α = 0.05 two-tailed z cutoff. */
export const MDE_Z_ALPHA_HALF = 1.96;
/** β = 0.20 → 80% power z cutoff. */
export const MDE_Z_BETA = 0.84;
/** C = 2·(z_{α/2} + z_β)²  ≈ 15.68. */
export const MDE_C = 2 * (MDE_Z_ALPHA_HALF + MDE_Z_BETA) ** 2;

/** Campaign window upper bound — 14 days covers the "1–2 week promo" decision. */
export const MDE_MAX_CAMPAIGN_DAYS = 14;
/** Below this many baseline days we don't draw the curve (σ estimate too noisy). */
export const MDE_MIN_BASELINE_DAYS = 7;

/**
 * Collapse filtered daily transaction rows into one €/day value per
 * business_date. Multiple rows on the same date (different sales_type /
 * is_cash combinations survive filterRows) are summed and converted
 * cents → euros.
 */
export function dailyRevenuesEUR(rows: readonly DailyRow[]): number[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.business_date, (byDate.get(r.business_date) ?? 0) + r.gross_cents);
  }
  const out: number[] = [];
  for (const cents of byDate.values()) out.push(cents / 100);
  return out;
}

/**
 * Sample standard deviation (Bessel-corrected, ddof=1). Returns 0 when
 * n < 2 so callers can guard on `sigma > 0` for "not enough data".
 */
export function sampleStd(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let sq = 0;
  for (const v of values) {
    const d = v - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / (n - 1));
}

/** Harmonic mean of n₁ and n₂ (n_eff). Returns 0 if either is 0 or sum is 0. */
export function harmonicMean(n1: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const denom = n1 + n2;
  if (denom === 0) return 0;
  return (2 * n1 * n2) / denom;
}

/**
 * MDE at a single n₂ — the minimum per-day lift (in the same units as σ,
 * i.e. €/day) a campaign must produce to be detectable at the configured
 * α/power. Assumes σ is estimated from the baseline window of length n₁.
 */
export function mdeAt(sigma: number, n1: number, n2: number, C: number = MDE_C): number {
  if (sigma <= 0 || n1 <= 0 || n2 <= 0) return 0;
  const nEff = harmonicMean(n1, n2);
  if (nEff <= 0) return 0;
  return sigma * Math.sqrt(C / nEff);
}

/**
 * MDE curve for n₂ ∈ [1..maxDays]. Returns an array of `{n2, mde}` points
 * suitable to drop straight into a LayerChart Spline. The curve is strictly
 * decreasing in n₂ (more campaign days ⇒ tighter detectable lift).
 */
export function mdeCurvePoints(
  sigma: number,
  n1: number,
  maxDays: number = MDE_MAX_CAMPAIGN_DAYS
): Array<{ n2: number; mde: number }> {
  const out: Array<{ n2: number; mde: number }> = [];
  for (let n2 = 1; n2 <= maxDays; n2++) {
    out.push({ n2, mde: mdeAt(sigma, n1, n2) });
  }
  return out;
}
