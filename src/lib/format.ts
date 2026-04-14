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
