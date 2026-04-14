// D-14: cohorts with fewer than this many members are filtered from the chart
// to prevent retention lines from swinging on tiny samples.
export const SPARSE_MIN_COHORT_SIZE = 5;

// A single row from retention_curve_v — only fields needed for sparse filtering.
export type RetentionRow = {
  cohort_week: string;
  period_weeks: number;
  retention_rate: number;
  cohort_size_week: number;
  cohort_age_weeks: number;
};

/**
 * Pick the visible cohorts for the chart:
 * 1. Group rows by cohort_week.
 * 2. Drop cohorts where cohort_size_week < SPARSE_MIN_COHORT_SIZE.
 * 3. If all cohorts are sparse, fall back to showing all of them.
 * 4. Slice to the last 4 (most-recent) cohorts.
 *
 * Returns unique cohort_week strings (not the full rows) so the caller can
 * group-filter the original row set.
 */
export function pickVisibleCohorts(data: RetentionRow[]): RetentionRow[] {
  if (data.length === 0) return [];

  // Group by cohort_week, track max cohort_size_week per cohort.
  const cohortSizes = new Map<string, number>();
  for (const row of data) {
    const existing = cohortSizes.get(row.cohort_week) ?? 0;
    if (row.cohort_size_week > existing) {
      cohortSizes.set(row.cohort_week, row.cohort_size_week);
    }
  }

  const allCohorts = Array.from(cohortSizes.keys()).sort();

  // Non-sparse cohorts.
  const nonSparse = allCohorts.filter(c => (cohortSizes.get(c) ?? 0) >= SPARSE_MIN_COHORT_SIZE);

  // Fallback: if all are sparse, show them anyway (D-14 fallback).
  const visible = nonSparse.length > 0 ? nonSparse : allCohorts;

  // Last 4 most-recent cohorts (sort ascending, take tail).
  const chosen = new Set(visible.slice(-4));

  return data.filter(row => chosen.has(row.cohort_week));
}
