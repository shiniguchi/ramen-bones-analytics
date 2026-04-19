// E2E chart fixtures — consumed only when preview is launched with
// E2E_FIXTURES=1 and the page is visited with ?__e2e=charts. Dead code
// in production. Shapes must match their underlying view row types.

export const E2E_RETENTION_ROWS = [
  { cohort_week: '2026-03-23', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 12, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 1, retention_rate: 0.42, cohort_size_week: 12, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-23', period_weeks: 2, retention_rate: 0.25, cohort_size_week: 12, cohort_age_weeks: 3 },
  { cohort_week: '2026-03-30', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 18, cohort_age_weeks: 2 },
  { cohort_week: '2026-03-30', period_weeks: 1, retention_rate: 0.50, cohort_size_week: 18, cohort_age_weeks: 2 },
  { cohort_week: '2026-04-06', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 9,  cohort_age_weeks: 1 },
  { cohort_week: '2026-04-13', period_weeks: 0, retention_rate: 1.0,  cohort_size_week: 7,  cohort_age_weeks: 0 }
];

// Phase 10 VA-07/09/10: customer-grain rows for LTV histogram + cohort revenue/avg charts.
// Two cohorts:
//   - 2026-03-23: 6 customers (above SPARSE_MIN_COHORT_SIZE=5 → renders)
//   - 2026-03-30: 5 customers (at threshold → renders)
// Total 11 customers spanning €15..€10 revenue range so all 6 LTV bins get coverage.
export const E2E_CUSTOMER_LTV_ROWS = [
  ...Array.from({ length: 6 }, (_, i) => ({
    card_hash: `ltv_a${i}`,
    revenue_cents: 1500 + i * 800,
    visit_count: 2 + i,
    cohort_day: '2026-03-23',
    cohort_week: '2026-03-23',
    cohort_month: '2026-03-01',
    first_visit_business_date: '2026-03-23',
    first_visit_at: '2026-03-23T10:00:00Z'
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    card_hash: `ltv_b${i}`,
    revenue_cents: 3000 + i * 1000,
    visit_count: 4 + i,
    cohort_day: '2026-03-30',
    cohort_week: '2026-03-30',
    cohort_month: '2026-03-01',
    first_visit_business_date: '2026-03-30',
    first_visit_at: '2026-03-30T10:00:00Z'
  }))
];

// Phase 10 VA-08: daily item-count rows for calendar items chart.
// Mix of INHOUSE/TAKEAWAY + cash/card to exercise filter branches.
// 10 distinct item_name values across 2 days — drives top-8 + Other rollup.
export const E2E_ITEM_COUNTS_ROWS = [
  { business_date: '2026-04-13', item_name: 'Tonkotsu Ramen', sales_type: 'INHOUSE',  is_cash: false, item_count: 18, item_revenue_cents: 2880000 },
  { business_date: '2026-04-13', item_name: 'Miso Ramen',     sales_type: 'INHOUSE',  is_cash: false, item_count: 12, item_revenue_cents: 1740000 },
  { business_date: '2026-04-13', item_name: 'Shoyu Ramen',    sales_type: 'INHOUSE',  is_cash: false, item_count: 9,  item_revenue_cents: 1305000 },
  { business_date: '2026-04-13', item_name: 'Gyoza',          sales_type: 'INHOUSE',  is_cash: false, item_count: 22, item_revenue_cents:  880000 },
  { business_date: '2026-04-13', item_name: 'Edamame',        sales_type: 'INHOUSE',  is_cash: false, item_count: 14, item_revenue_cents:  420000 },
  { business_date: '2026-04-13', item_name: 'Matcha Ice',     sales_type: 'INHOUSE',  is_cash: false, item_count: 7,  item_revenue_cents:  210000 },
  { business_date: '2026-04-13', item_name: 'Beer',           sales_type: 'INHOUSE',  is_cash: true,  item_count: 11, item_revenue_cents:  495000 },
  { business_date: '2026-04-13', item_name: 'Sake',           sales_type: 'INHOUSE',  is_cash: false, item_count: 5,  item_revenue_cents:  350000 },
  { business_date: '2026-04-14', item_name: 'Tonkotsu Ramen', sales_type: 'TAKEAWAY', is_cash: false, item_count: 10, item_revenue_cents: 1600000 },
  { business_date: '2026-04-14', item_name: 'Gyoza',          sales_type: 'TAKEAWAY', is_cash: false, item_count: 8,  item_revenue_cents:  320000 }
];
