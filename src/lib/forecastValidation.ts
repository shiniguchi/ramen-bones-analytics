// src/lib/forecastValidation.ts
// Phase 15 D-11 — horizon × granularity clamp matrix.
// Mirrors the Phase 10 D-17 cohort grain clamp pattern. The endpoint
// rejects illegal combos with HTTP 400 so an attacker can't ask for
// 365 daily bars (1px each at 375px and 365 subrequests cost on CF).

export const HORIZON_DAYS = [7, 35, 120, 365] as const;
export type Horizon = typeof HORIZON_DAYS[number];

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = typeof GRANULARITIES[number];

export function parseHorizon(raw: string | null): Horizon | null {
  if (raw === null) return null;
  const n = Number(raw);
  return (HORIZON_DAYS as readonly number[]).includes(n) ? (n as Horizon) : null;
}

export function parseGranularity(raw: string | null): Granularity | null {
  if (raw === null) return null;
  return (GRANULARITIES as readonly string[]).includes(raw) ? (raw as Granularity) : null;
}

// D-11 clamp matrix: which (horizon, granularity) combos the endpoint accepts.
//   7d  → day only        (35 daily bars max — readable on 375px)
//   5w  → day | week
//   4mo → week | month    (no day — 120 daily bars overflow 375px)
//   1yr → month only      (no day, no week — 365 day or 52 week bars unreadable)
const VALID: Record<Horizon, ReadonlySet<Granularity>> = {
  7:   new Set(['day']),
  35:  new Set(['day', 'week']),
  120: new Set(['week', 'month']),
  365: new Set(['month'])
};

export function isValidCombo(horizon: Horizon, granularity: Granularity): boolean {
  return VALID[horizon].has(granularity);
}

// Default granularity for each horizon — used when the client omits ?granularity=.
// Picks the smallest valid bucket (day where possible, week for 4mo, month for 1yr).
export const DEFAULT_GRANULARITY: Record<Horizon, Granularity> = {
  7:   'day',
  35:  'day',
  120: 'week',
  365: 'month'
};
