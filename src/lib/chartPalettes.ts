// Palette helpers for Phase 10 charts. All arrays computed at module-load.
// Verified d3-scale-chromatic exports: interpolateBlues, schemeTableau10, schemePaired.
import { interpolateBlues, schemeTableau10, schemePaired } from 'd3-scale-chromatic';

/**
 * 8 sequential blue shades for visit_seq buckets 1st..8x+ (D-06).
 * Index 0 = lightest (1st-timer), index 7 = darkest (8x+).
 * Range 0.15..0.90 to avoid near-white / near-black extremes on mobile.
 */
export const VISIT_SEQ_COLORS: readonly string[] = Array.from({ length: 8 }, (_, i) =>
  interpolateBlues(0.15 + (i / 7) * 0.75)
);

/** Neutral gray for cash segment (D-07). Tailwind zinc-400. */
export const CASH_COLOR = '#a1a1aa';

/**
 * 20 categorical colors for item_name buckets (Pass 4 Item #1 — top 20).
 * schemeTableau10 (10 colors) + schemePaired first 10. All 20 verified unique
 * and none overlap with CASH_COLOR / OTHER_COLOR (zinc-400 #a1a1aa).
 */
export const ITEM_COLORS: readonly string[] = [
  ...schemeTableau10,
  ...schemePaired.slice(0, 10)
];

/** Gray for "Other" rollup — same value as CASH_COLOR so "everything else" is visually consistent. */
export const OTHER_COLOR: string = CASH_COLOR;

/**
 * Pass 2 (quick-260418-28j): 12 categorical colors for cohort retention lines (D-11).
 * Hand-picked for mobile contrast — not from d3-scale-chromatic because schemeTableau10
 * only has 10 and Paired/Set3 include near-white tones that vanish on white cards.
 */
export const COHORT_LINE_PALETTE: readonly string[] = [
  '#2563eb', '#0891b2', '#7c3aed', '#db2777',
  '#ea580c', '#ca8a04', '#16a34a', '#0d9488',
  '#7e22ce', '#be123c', '#4d7c0f', '#b45309'
];

/**
 * Phase 15 D-10: per-model line color for RevenueForecastCard.
 *
 * Categorical palette (no ranking implied — Phase 17 backtest gate is what
 * promotes models). Slice [0..3] of schemeTableau10 for the four BAU "smart"
 * models. naive_dow is the de-emphasized baseline drawn dashed in gray (same
 * value as CASH_COLOR keeps "neutral / not-the-headline-series" visually
 * consistent across the dashboard). Chronos + NeuralProphet pick up [5..6]
 * for when Phase 14 D-09 feature flags flip on.
 *
 *   sarimax   = [0] blue
 *   prophet       = [1] orange
 *   ets           = [2] red
 *   theta         = [3] teal — overlaps school-holiday background; OK because
 *                   user opts theta IN; default state never renders both at once
 *   naive_dow     = CASH_COLOR (#a1a1aa) — dashed stroke applied at <Spline> site
 *   chronos       = [5]
 *   neuralprophet = [6]
 */
export const FORECAST_MODEL_COLORS: Readonly<Record<string, string>> = {
  sarimax:   schemeTableau10[0],
  prophet:       schemeTableau10[1],
  ets:           schemeTableau10[2],
  theta:         schemeTableau10[3],
  naive_dow:     CASH_COLOR,
  chronos:       schemeTableau10[5],
  neuralprophet: schemeTableau10[6]
};
