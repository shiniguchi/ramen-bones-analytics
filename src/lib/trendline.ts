// Simple OLS linear fit + bucket-trend helper for chart overlays.
// Used by CalendarRevenueCard, CalendarCountsCard, CalendarItemRevenueCard,
// RepeaterCohortCountCard to render a dashed Spline on top of bar data.

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
