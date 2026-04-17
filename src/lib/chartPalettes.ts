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
