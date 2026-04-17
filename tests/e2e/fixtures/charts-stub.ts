// Playwright-side copy of the chart fixtures. The actual data is injected
// server-side by +page.server.ts when E2E_FIXTURES=1 + ?__e2e=charts (see
// src/lib/e2eChartFixtures.ts). Exported here for spec assertions on
// expected row counts / labels.

export const STUB_RETENTION = [
  { cohort_start: '2026-03-23', period: 0, retention_rate: 1.0,  cohort_size: 12 },
  { cohort_start: '2026-03-23', period: 1, retention_rate: 0.42, cohort_size: 12 },
  { cohort_start: '2026-03-23', period: 2, retention_rate: 0.25, cohort_size: 12 },
  { cohort_start: '2026-03-30', period: 0, retention_rate: 1.0,  cohort_size: 18 },
  { cohort_start: '2026-03-30', period: 1, retention_rate: 0.50, cohort_size: 18 }
];
