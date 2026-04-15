// Phase 6 — the one and only URL → FiltersState parser.
// D-17: every field uses .catch() so malformed params coerce to defaults;
//       page load NEVER throws on bad input.
// D-19: single flat schema lives here and nowhere else.
// D-20: this module is the ONLY place default values are known.
import { z } from 'zod';

export const RANGE_VALUES = ['today', '7d', '30d', '90d', 'all', 'custom'] as const;
export const GRAIN_VALUES = ['day', 'week', 'month'] as const;
export const SALES_TYPE_VALUES = ['INHOUSE', 'TAKEAWAY'] as const;

export const FILTER_DEFAULTS = Object.freeze({
  range: '7d' as const,
  grain: 'week' as const
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(() => undefined);

// CSV multi-select parser. `allowed` whitelists enum values; a single invalid
// value collapses the whole array to undefined (acceptable for v1, see D-17).
const csvArray = (allowed?: readonly string[]) =>
  z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(
      z.array(
        allowed ? z.enum(allowed as unknown as [string, ...string[]]) : z.string().min(1)
      )
    )
    .optional()
    .catch(() => undefined);

export const filtersSchema = z.object({
  range: z.enum(RANGE_VALUES).catch(FILTER_DEFAULTS.range),
  grain: z.enum(GRAIN_VALUES).catch(FILTER_DEFAULTS.grain),
  sales_type: csvArray(SALES_TYPE_VALUES),
  payment_method: csvArray(),
  country: csvArray(),
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
