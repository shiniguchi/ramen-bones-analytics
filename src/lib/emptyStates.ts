// Shared empty-state copy lookup, keyed by card id. D-20.
// Cards render EmptyState.svelte with a `card` prop that selects an entry here.
export const emptyStates = {
  revenueFixed: { heading: 'No transactions', body: 'No sales recorded in this window.' },
  revenueChip: { heading: 'No transactions', body: 'Try a wider date range.' },
  cohort: { heading: 'No cohort data yet', body: 'Needs at least one non-cash transaction.' },
  ltv: { heading: 'LTV not available', body: 'LTV needs at least one cohort with \u22652 visits.' },
  frequency: { heading: 'No repeat visits yet', body: 'Come back after more customer visits are recorded.' },
  newVsReturning: { heading: 'No transactions', body: 'No sales recorded in this window.' },
  error: { heading: "Couldn't load", body: 'Try refreshing the page.' }
} as const;

export type EmptyCard = keyof typeof emptyStates;
