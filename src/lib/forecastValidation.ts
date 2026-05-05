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

import { startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns';

/**
 * Mirror of `scripts/forecast/grain_helpers.window_start_for_grain` for use
 * in the SvelteKit endpoint and chart components. Returns the leftmost
 * date that should be visible in a past-forecast line for `lastActual` at
 * `granularity`.
 *
 * Day  : Monday of the latest complete Mon-Sun week relative to lastActual.
 * Week : that day-anchor minus 28 days (last 5 complete weeks).
 * Month: first-of-month of the latest complete month minus 3 months
 *        (last 4 complete months).
 *
 * 2026-05-05 friend feedback: the chart visually trims to this window, but
 * `forecast_daily` retains every row across all `run_date` versions, so
 * historical forecasts are queryable for backtest analysis.
 */
export function windowStartForGrain(lastActual: Date, granularity: Granularity): Date {
  if (granularity === 'day') {
    const day = lastActual.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    if (day === 0) {
      // Sunday: week ending today is complete -> Mon = Sun - 6 days
      return startOfWeek(lastActual, { weekStartsOn: 1 });
    }
    // Mon-Sat: current week incomplete -> previous week's Mon
    const currentMonday = startOfWeek(lastActual, { weekStartsOn: 1 });
    return subDays(currentMonday, 7);
  }
  if (granularity === 'week') {
    const dayAnchor = windowStartForGrain(lastActual, 'day');
    return subDays(dayAnchor, 28);
  }
  // month
  const day = lastActual.getDate();
  const lastDayOfMonth = new Date(lastActual.getFullYear(), lastActual.getMonth() + 1, 0).getDate();
  const isEndOfMonth = day === lastDayOfMonth;
  const latestCompleteFirst = isEndOfMonth
    ? startOfMonth(lastActual)
    : subMonths(startOfMonth(lastActual), 1);
  return subMonths(latestCompleteFirst, 3);
}
