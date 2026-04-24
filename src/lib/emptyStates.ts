// Shared empty-state copy lookup, keyed by card id. D-20.
// Cards render EmptyState.svelte with a `card` prop that selects an entry here.
// Copy lives in src/lib/i18n/messages.ts — this table only maps card ids to
// message keys, so translations stay in one place per i18n contract.
import type { MessageKey } from './i18n/messages';

export const emptyStates = {
  revenueFixed:       { headingKey: 'empty_revenue_fixed_heading',     bodyKey: 'empty_revenue_fixed_body' },
  revenueChip:        { headingKey: 'empty_revenue_chip_heading',      bodyKey: 'empty_revenue_chip_body' },
  cohort:             { headingKey: 'empty_cohort_heading',            bodyKey: 'empty_cohort_body' },
  error:              { headingKey: 'empty_error_heading',             bodyKey: 'empty_error_body' },

  // Phase 10 additions (D-18)
  'calendar-revenue': { headingKey: 'empty_calendar_revenue_heading',  bodyKey: 'empty_calendar_revenue_body' },
  'calendar-counts':  { headingKey: 'empty_calendar_counts_heading',   bodyKey: 'empty_calendar_counts_body' },
  'calendar-items':   { headingKey: 'empty_calendar_items_heading',    bodyKey: 'empty_calendar_items_body' },
  'cohort-revenue':   { headingKey: 'empty_cohort_revenue_heading',    bodyKey: 'empty_cohort_revenue_body' },
  'cohort-avg-ltv':   { headingKey: 'empty_cohort_avg_ltv_heading',    bodyKey: 'empty_cohort_avg_ltv_body' },

  // quick-260424-mdc: MDE curve needs ≥ 7 baseline days to draw.
  // Heading reuses the card title; body carries the why.
  'mde-curve':        { headingKey: 'mde_title',                       bodyKey: 'mde_empty' }
} as const satisfies Record<string, { headingKey: MessageKey; bodyKey: MessageKey }>;

export type EmptyCard = keyof typeof emptyStates;
