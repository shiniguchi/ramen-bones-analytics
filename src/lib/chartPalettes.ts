// Palette helpers for Phase 10 charts. All arrays computed at module-load.
// Verified d3-scale-chromatic exports: interpolateBlues (sequential), schemeTableau10 (categorical).
import { interpolateBlues, schemeTableau10 } from 'd3-scale-chromatic';

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

/** 8 categorical colors for item_name buckets (D-15). schemeTableau10 sliced. */
export const ITEM_COLORS: readonly string[] = schemeTableau10.slice(0, 8);

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
 * Pass 3 (quick-260418-3ec): repeater segment palette for VA-07/09/10.
 * zinc-400 neutral (new / one-timer) + blue-600 strong (repeat) — high contrast on white cards.
 */
export const REPEATER_COLORS = { new: '#94a3b8', repeat: '#2563eb' } as const;
