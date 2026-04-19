// Simple OLS linear fit + bucket-trend helper for chart overlays.
// Used by CalendarRevenueCard, CalendarCountsCard, CalendarItemRevenueCard
// to render a dashed Spline on top of bar data. Also exposes integerTicks
// for forcing whole-number y-axis labels on integer-count charts.

/**
 * Build an array of whole-number tick values 0..yMax, capping tick count to
 * maxCount so a yMax of 0..maxCount yields one tick per integer and a larger
 * yMax falls back to rounded steps. Avoids fractional d3 ticks that would
 * collapse under compact integer formatting (0.2 → "0 items").
 */
export function integerTicks(yMax: number, maxCount = 6): number[] {
  if (!Number.isFinite(yMax) || yMax <= 0) return [0, 1];
  const top = Math.max(1, Math.ceil(yMax));
  if (top <= maxCount) return Array.from({ length: top + 1 }, (_, i) => i);
  const step = Math.ceil(top / maxCount);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  return ticks;
}

/**
 * Center-of-band x pixel position. scaleBand's scale(value) returns the band's
 * left edge; adding bandwidth()/2 centers the label above the bar(s). Defensive
 * against non-band scales (returns the raw scaled x).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bandCenterX(xScale: any, value: unknown): number {
  const base = xScale?.(value) ?? 0;
  const bw = typeof xScale?.bandwidth === 'function' ? xScale.bandwidth() : 0;
  return base + bw / 2;
}

/**
 * Sum the numeric values of `seriesKeys` for each row. Used to power both
 * bucketTrend (for OLS over totals) and bar-chart total labels (quick-260418-num).
 */
export function bucketTotals<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  seriesKeys: readonly string[]
): number[] {
  return rows.map((r) => {
    let s = 0;
    for (const k of seriesKeys) {
      const v = r[k];
      if (typeof v === 'number') s += v;
    }
    return s;
  });
}

export function linearFit(
  ys: readonly number[]
): { slope: number; intercept: number } | null {
  const n = ys.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += ys[i];
    sxx += i * i; sxy += i * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null; // all xs identical — impossible here but defensive
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/**
 * For a chart's wide-format rows, produce a `{bucket, trend}[]` series that
 * fits a line through the per-row sum of `seriesKeys`. Returns [] when fewer
 * than 2 rows (caller should skip rendering the Spline).
 */
export function bucketTrend<TRow extends Record<string, unknown>>(
  rows: readonly TRow[],
  bucketKey: keyof TRow & string,
  seriesKeys: readonly string[]
): Array<{ [k: string]: unknown; trend: number }> {
  if (rows.length < 2) return [];
  const totals = rows.map((r) => {
    let s = 0;
    for (const k of seriesKeys) {
      const v = r[k];
      if (typeof v === 'number') s += v;
    }
    return s;
  });
  const fit = linearFit(totals);
  if (!fit) return [];
  return rows.map((r, i) => ({
    [bucketKey]: r[bucketKey],
    trend: fit.intercept + fit.slope * i
  }));
}
