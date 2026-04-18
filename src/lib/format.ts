// Shared numeric formatters. Cents → euros conversion happens here, never in SQL.
const eurInt = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
});
const eurDec = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export const formatEUR = (cents: number, decimals = false): string =>
  (decimals ? eurDec : eurInt).format(cents / 100);

// D-08: integer percent delta vs prior window. Returns null when prior is zero
// (the tile renders "— no prior data" instead of a division-by-zero NaN).
export const formatDeltaPct = (current: number, prior: number): number | null => {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100);
};

// Compact formatters for chart Y-axis ticks.
// Inputs are ALREADY-converted: EUR for formatEURShort, integers for formatIntShort.
// Cents-to-EUR conversion is the caller's responsibility (see CalendarRevenueCard
// chartData map + CohortAvgLtvCard's per-bucket `Math.round(a[k] / 100)`).
//
// Why `en` locale: de-DE's compact notation only engages at millions (emits
// "15000" for 15k, which is unreadable on a phone Y-axis). The `en` short
// notation gives us "K"/"M" at thousands/millions. We post-process the decimal
// separator to "," so the output still reads as German (e.g. "1,5K", "€1,2M").
const _enCompact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1
});

function _toDeDecimal(s: string): string {
  return s.replace('.', ',');
}

export function formatEURShort(eur: number): string {
  // Prefix € (de-DE currency display convention for compact labels).
  return '€' + _toDeDecimal(_enCompact.format(eur));
}

export function formatIntShort(n: number): string {
  return _toDeDecimal(_enCompact.format(n));
}
