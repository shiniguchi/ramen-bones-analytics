// E2E chart fixtures — consumed only when preview is launched with
// E2E_FIXTURES=1 and the page is visited with ?__e2e=charts. Dead code
// in production. Shapes must match retention_curve_v row type.

export const E2E_RETENTION_ROWS = [
  { cohort_week: '2026-03-23', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 12, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 1, retention_rate: 0.42, cohort_size_week: 12, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 2, retention_rate: 0.25, cohort_size_week: 12, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-30', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 18, cohort_age_weeks: 2 },
  { cohort_week: '2026-03-30', period_weeks: 1, retention_rate: 0.50, cohort_size_week: 18, cohort_age_weeks: 2 },
  { cohort_week: '2026-04-06', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 9,  cohort_age_weeks: 1 },
  { cohort_week: '2026-04-13', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 7,  cohort_age_weeks: 0 }
];
