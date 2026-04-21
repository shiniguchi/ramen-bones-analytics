// Phase 9 — the one and only URL → FiltersState parser.
// D-17: every field uses .catch() so malformed params coerce to defaults;
//       page load NEVER throws on bad input.
// D-19: single flat schema lives here and nowhere else.
// D-20: this module is the ONLY place default values are known.
// D-01: is_cash 3-state toggle (all / cash / card).
// D-03: sales_type is now a 3-state toggle (all / INHOUSE / TAKEAWAY).
// quick-260420-wdf: `days` (1=Mon..7=Sun) replaces `interp`; unknown `interp` params
//                   silently stripped by zod — backward compat for old bookmarks.
import { z } from 'zod';

export const RANGE_VALUES = ['today', '7d', '30d', '90d', 'all', 'custom'] as const;
export const GRAIN_VALUES = ['day', 'week', 'month'] as const;
export const SALES_TYPE_FILTER_VALUES = ['all', 'INHOUSE', 'TAKEAWAY'] as const;
export const IS_CASH_VALUES = ['all', 'cash', 'card'] as const;
export const DAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;
export const DAYS_DEFAULT: number[] = [1, 2, 3, 4, 5, 6, 7];

// Phase 11-01 D-02: single source of truth for the 'earliest acceptable date'
// invariant. parseFilters clamps URL params against this floor, and dateRange.ts
// uses it as the signature-default for chipToRange('all') so any future caller
// that forgets to inject the tenant's true earliest business_date still gets a
// bounded window — never the pathological 1970-01-01 that blew the SSR CPU
// budget on Cloudflare Pages Free tier (Error 1102).
export const FROM_FLOOR = '2024-01-01';
export const TO_CEILING_DAYS_AHEAD = 365;

export const FILTER_DEFAULTS = Object.freeze({
  range: '7d' as const,
  grain: 'week' as const,
  sales_type: 'all' as const,
  is_cash: 'all' as const,
  days: [1, 2, 3, 4, 5, 6, 7] as number[]
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(() => undefined);

// CSV string → sorted unique day numbers in 1..7. Malformed → default [1..7].
const daysField = z
  .string()
  .default('1,2,3,4,5,6,7')
  .transform((s) =>
    Array.from(new Set(s.split(',').map(Number).filter((n) => n >= 1 && n <= 7))).sort(
      (a, b) => a - b
    )
  )
  .pipe(z.array(z.number()))
  .catch(() => [...DAYS_DEFAULT]);

export const filtersSchema = z.object({
  range: z.enum(RANGE_VALUES).catch(FILTER_DEFAULTS.range),
  grain: z.enum(GRAIN_VALUES).catch(FILTER_DEFAULTS.grain),
  sales_type: z.enum(SALES_TYPE_FILTER_VALUES).catch(FILTER_DEFAULTS.sales_type),
  is_cash: z.enum(IS_CASH_VALUES).catch(FILTER_DEFAULTS.is_cash),
  days: daysField,
  from: isoDate,
  to: isoDate
});

export type FiltersState = z.infer<typeof filtersSchema>;

export function parseFilters(url: URL): FiltersState {
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (v !== '') raw[k] = v;
  }
  const parsed = filtersSchema.parse(raw);

  // Phase 11-01 D-02: soft-clamp pathological ISO dates. Never reject — bookmarks
  // stay usable, console.warn surfaces anomalies in `wrangler pages deployment tail`.
  // Only triggers on well-formed ISO strings (non-ISO already coerced to undefined
  // by zod .catch above, so `parsed.from`/`parsed.to` here are either valid or null).
  if (parsed.from && parsed.from < FROM_FLOOR) {
    console.warn(`[parseFilters] from=${parsed.from} clamped to ${FROM_FLOOR}`);
    parsed.from = FROM_FLOOR;
  }
  const ceiling = new Date(Date.now() + TO_CEILING_DAYS_AHEAD * 86400000)
    .toISOString()
    .slice(0, 10);
  if (parsed.to && parsed.to > ceiling) {
    console.warn(`[parseFilters] to=${parsed.to} clamped to ${ceiling}`);
    parsed.to = ceiling;
  }
  return parsed;
}
