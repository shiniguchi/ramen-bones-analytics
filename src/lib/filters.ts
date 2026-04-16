// Phase 9 — the one and only URL → FiltersState parser.
// D-17: every field uses .catch() so malformed params coerce to defaults;
//       page load NEVER throws on bad input.
// D-19: single flat schema lives here and nowhere else.
// D-20: this module is the ONLY place default values are known.
// D-01: is_cash 3-state toggle (all / cash / card).
// D-03: sales_type is now a 3-state toggle (all / INHOUSE / TAKEAWAY).
import { z } from 'zod';

export const RANGE_VALUES = ['today', '7d', '30d', '90d', 'all', 'custom'] as const;
export const GRAIN_VALUES = ['day', 'week', 'month'] as const;
export const SALES_TYPE_FILTER_VALUES = ['all', 'INHOUSE', 'TAKEAWAY'] as const;
export const IS_CASH_VALUES = ['all', 'cash', 'card'] as const;

export const FILTER_DEFAULTS = Object.freeze({
  range: '7d' as const,
  grain: 'week' as const,
  sales_type: 'all' as const,
  is_cash: 'all' as const
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(() => undefined);

export const filtersSchema = z.object({
  range: z.enum(RANGE_VALUES).catch(FILTER_DEFAULTS.range),
  grain: z.enum(GRAIN_VALUES).catch(FILTER_DEFAULTS.grain),
  sales_type: z.enum(SALES_TYPE_FILTER_VALUES).catch(FILTER_DEFAULTS.sales_type),
  is_cash: z.enum(IS_CASH_VALUES).catch(FILTER_DEFAULTS.is_cash),
  from: isoDate,
  to: isoDate
});

export type FiltersState = z.infer<typeof filtersSchema>;

export function parseFilters(url: URL): FiltersState {
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (v !== '') raw[k] = v;
  }
  return filtersSchema.parse(raw);
}
