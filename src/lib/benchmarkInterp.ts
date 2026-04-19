// benchmarkInterp.ts — pure utility to interpolate the north-star retention curve
// between database anchors (from benchmark_curve_v).
//
// Input: anchor rows at period_weeks ∈ {1, 4, 12, 26, 52} (subset; W1 may be absent).
// Output: dense series with one point per integer period on the chart's x-axis.
//
// Implicit W0 / M0 = 100% retention is prepended (the cohort's defining visit).
// Output values are in 0–1 scale to match retention_rate from retention_curve_v.
//
// quick-260418-bm3

import type { Grain } from '$lib/dateRange';

export interface BenchmarkAnchor {
  period_weeks: number;
  lower_p20: number;     // 0–100 (percent, as stored in DB)
  mid_p50: number;
  upper_p80: number;
  source_count: number;
}

export interface BenchmarkPoint {
  period: number;        // chart x-axis unit (weeks OR months depending on grain)
  lower: number;         // 0–1 (fraction, chart y-axis unit)
  mid: number;
  upper: number;
  isAnchor: boolean;
  source_count: number;  // only meaningful where isAnchor=true
}

export type InterpMode = 'linear' | 'log-linear';

// Canonical week→month anchor mapping. W1 has no clean monthly equivalent
// (would be M0.23) so it is excluded from monthly-grain interpolation.
const WEEKS_TO_MONTHS: Record<number, number> = {
  0: 0,
  4: 1,
  12: 3,
  26: 6,
  52: 12
};

// Chart x-axis domain caps (match MAX_PERIOD_* in sparseFilter.ts).
export const MAX_PERIOD_WEEKS = 52;
export const MAX_PERIOD_MONTHS = 12;

// Floor for log-linear math — y=0 explodes under log(0).
const LOG_FLOOR = 0.0001;

/**
 * Interpolate a DB anchor array into a dense per-period series.
 *
 * @param anchors  Rows from benchmark_curve_v (order-independent, W1..W52 subset).
 * @param mode     'linear' or 'log-linear' interpolation between anchors.
 * @param grain    'week' → x-axis is weeks (0..52); 'month' → x-axis is months (0..12).
 * @returns        Dense series with length (maxPeriod+1). Empty if anchors is empty.
 */
export function interpolateBenchmark(
  anchors: BenchmarkAnchor[],
  mode: InterpMode,
  grain: Grain
): BenchmarkPoint[] {
  if (anchors.length === 0) return [];
  if (grain === 'day') return [];  // benchmark overlay not applicable at day grain

  const maxPeriod = grain === 'month' ? MAX_PERIOD_MONTHS : MAX_PERIOD_WEEKS;

  // Build anchor list in the target unit (weeks OR months), percent → fraction.
  const unitAnchors: BenchmarkPoint[] = [
    // Implicit period-0 anchor: the cohort's own first visit is 100% by definition.
    { period: 0, lower: 1.0, mid: 1.0, upper: 1.0, isAnchor: true, source_count: 0 }
  ];
  for (const a of anchors) {
    if (grain === 'month') {
      const m = WEEKS_TO_MONTHS[a.period_weeks];
      if (m === undefined) continue;       // skip W1 on monthly grain
      if (m === 0) continue;                // keep our synthetic W0=100, skip DB row if any
      unitAnchors.push({
        period: m,
        lower: a.lower_p20 / 100,
        mid: a.mid_p50 / 100,
        upper: a.upper_p80 / 100,
        isAnchor: true,
        source_count: a.source_count
      });
    } else {
      // weekly grain: pass through, skip W0 override
      if (a.period_weeks === 0) continue;
      unitAnchors.push({
        period: a.period_weeks,
        lower: a.lower_p20 / 100,
        mid: a.mid_p50 / 100,
        upper: a.upper_p80 / 100,
        isAnchor: true,
        source_count: a.source_count
      });
    }
  }

  // Sort by period; dedupe keeping first occurrence.
  unitAnchors.sort((a, b) => a.period - b.period);
  const deduped: BenchmarkPoint[] = [];
  const seen = new Set<number>();
  for (const p of unitAnchors) {
    if (seen.has(p.period)) continue;
    seen.add(p.period);
    deduped.push(p);
  }

  // Only interpolate up to last anchor within [0, maxPeriod]. Past that, hold
  // the last anchor value flat so the band doesn't invent data beyond evidence.
  const anchorInRange = deduped.filter(p => p.period <= maxPeriod);
  if (anchorInRange.length === 0) return [];

  // Dense output: one point per integer period.
  const out: BenchmarkPoint[] = [];
  for (let x = 0; x <= maxPeriod; x++) {
    // Find bracketing anchors.
    let lo: BenchmarkPoint | null = null;
    let hi: BenchmarkPoint | null = null;
    for (const p of anchorInRange) {
      if (p.period <= x) lo = p;
      if (p.period >= x && hi === null) hi = p;
    }
    if (lo && hi && lo.period === hi.period) {
      // Exact match — this IS an anchor.
      out.push({ ...lo, period: x, isAnchor: true });
    } else if (lo && hi) {
      const t = (x - lo.period) / (hi.period - lo.period);
      out.push({
        period: x,
        lower: interp(lo.lower, hi.lower, t, mode),
        mid:   interp(lo.mid,   hi.mid,   t, mode),
        upper: interp(lo.upper, hi.upper, t, mode),
        isAnchor: false,
        source_count: 0
      });
    } else if (lo && !hi) {
      // Past the last anchor: hold flat.
      out.push({ ...lo, period: x, isAnchor: false, source_count: 0 });
    }
    // If !lo (before first anchor — shouldn't happen since we prepend W0=1.0), skip.
  }
  return out;
}

function interp(y1: number, y2: number, t: number, mode: InterpMode): number {
  if (mode === 'linear') {
    return y1 + (y2 - y1) * t;
  }
  // log-linear: y = y1 * (y2/y1)^t  — equivalent to exponential decay/growth.
  // Floor operands so log() stays finite.
  const a = Math.max(y1, LOG_FLOOR);
  const b = Math.max(y2, LOG_FLOOR);
  return a * Math.pow(b / a, t);
}
