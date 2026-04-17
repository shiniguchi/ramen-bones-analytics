// Shared empty-state copy lookup, keyed by card id. D-20.
// Cards render EmptyState.svelte with a `card` prop that selects an entry here.
export const emptyStates = {
  revenueFixed: { heading: 'No transactions', body: 'No sales recorded in this window.' },
  revenueChip: { heading: 'No transactions', body: 'Try a wider date range.' },
  cohort: { heading: 'No cohort data yet', body: 'Needs at least one non-cash transaction.' },
  error: { heading: "Couldn't load", body: 'Try refreshing the page.' },

  // Phase 10 additions (D-18)
  'calendar-revenue':  { heading: 'No revenue yet', body: 'No transactions in this window.' },
  'calendar-counts':   { heading: 'No transactions yet', body: 'No transactions in this window.' },
  'calendar-items':    { heading: 'No order items', body: 'No menu items tracked yet.' },
  'cohort-revenue':    { heading: 'Not enough history', body: 'Cohort charts need at least 5 customers in a cohort.' },
  'cohort-avg-ltv':    { heading: 'Not enough history', body: 'Cohort charts need at least 5 customers in a cohort.' },
  'ltv-histogram':     { heading: 'No LTV data', body: 'Needs at least one non-cash customer with ≥1 transaction.' }
} as const;

export type EmptyCard = keyof typeof emptyStates;
