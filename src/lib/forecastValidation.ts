// src/lib/forecastValidation.ts
// Phase 15 v2 D-14 — slimmed for native-grain endpoint.
//
// Phase 15 v1 carried a horizon × granularity clamp matrix because the
// endpoint resampled a single daily forecast into 7d/35d/120d/365d windows
// at run time. Plan 15-10 rewrote the model layer to fit one model per
// granularity, and plan 15-11 dropped resampling from /api/forecast — so
// the clamp matrix, DEFAULT_GRANULARITY map, and Horizon type all became
// dead code. They are removed here.
//
// What remains: parseHorizon + HORIZON_DAYS are still imported by
// HorizonToggle.svelte (rewritten in 15-14); parseGranularity +
// GRANULARITIES drive the new ?granularity= param.

export const HORIZON_DAYS = [7, 35, 120, 365] as const;

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = typeof GRANULARITIES[number];

export function parseHorizon(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return (HORIZON_DAYS as readonly number[]).includes(n) ? n : null;
}

export function parseGranularity(raw: string | null): Granularity | null {
  if (raw === null) return null;
  return (GRANULARITIES as readonly string[]).includes(raw) ? (raw as Granularity) : null;
}
