// Phase 19-03: extracted from messages.ts — eager (needed for MessageKey inference + fallback)
const en = {
  // --- Header / switcher --------------------------------------------------
  brand_name: 'Ramen Bones',
  logout: 'Sign out',
  language: 'Language',

  // --- Grain toggle -------------------------------------------------------
  grain_day: 'Day',
  grain_week: 'Week',
  grain_month: 'Month',
  grain_selector_aria: 'Grain selector',

  // --- Forecast legend (Phase 15 D-04 / FUI-02) --------------------------
  legend_aria:                  'Forecast model legend',
  legend_model_sarimax:     'SARIMAX',
  legend_model_prophet:         'Prophet',
  legend_model_ets:             'ETS',
  legend_model_theta:           'Theta',
  legend_model_naive_dow:       'Naive (DoW)',
  legend_model_chronos:         'Chronos',
  legend_model_neuralprophet:   'NeuralProphet',

  // --- Forecast hover popup (Phase 15 FUI-04) ----------------------------
  popup_forecast:                'Forecast',
  popup_ci_95:                   '95% CI',
  popup_horizon_days_one:        '{n} day from today',
  popup_horizon_days_many:       '{n} days from today',
  popup_rmse:                    'RMSE (last 7d)',
  popup_mape:                    'MAPE (last 7d)',
  popup_bias:                    'Bias (last 7d)',
  popup_direction_hit:           'Direction hit rate',
  popup_uplift_since_campaign:   'Δ since campaign',
  popup_last_refit:              'Last refit {ago} ago',

  // --- Forecast card title + badges (Phase 15 D-01 / FUI-08) -------------
  forecast_card_title:           'Revenue forecast',
  forecast_card_description:     'Tomorrow through next year — actuals vs. SARIMAX BAU.',
  forecast_uncalibrated_badge:   'Uncalibrated CI',
  forecast_today_label:          'Today',

  // --- Invoice count forecast card (Phase 15-15 / D-18) -------------------
  invoice_forecast_card_title:       'Invoice count forecast',
  invoice_forecast_card_description: 'Tomorrow through next year — actual transactions vs. forecast.',

  // --- KPI tiles (+page.svelte builds "Revenue · {range}") ---------------
  kpi_revenue: 'Revenue',
  kpi_transactions: 'Transactions',
  range_today: 'Today',
  range_all: 'All',
  range_custom: 'Custom',
  prior_label: 'prior {range}',
  delta_no_prior: 'no prior data',
  delta_flat: 'flat vs {window}',

  // --- Freshness label ----------------------------------------------------
  freshness_no_data: 'No data yet',
  freshness_last_updated: 'Last updated {ago} ago',
  freshness_outdated_suffix: ' — data may be outdated',

  // --- Cohort cards (existing) -------------------------------------------
  repeater_cohort_title: 'Repeaters acquired by first-visit grouping',
  cohort_retention_title: 'Retention rate by acquisition grouping',
  retention_day_filter_caveat: 'Day filter does not apply to cohort retention — cohorts use all days.',
  retention_months_of_history_one: 'Only {n} month of history — cohort curves will stabilize with more data.',
  retention_months_of_history_many: 'Only {n} months of history — cohort curves will stabilize with more data.',
  clamp_badge_label: 'Weekly view',
  clamp_badge_tooltip:
    'Daily cohorts have too few repeat customers to chart (min {n}). Showing weekly cohorts instead.',

  // --- Calendar cards -----------------------------------------------------
  heatmap_title: 'Daily revenue heatmap',
  heatmap_empty: 'No daily data yet.',
  cal_counts_title: 'Transactions per period — by visit number',
  cal_revenue_title: 'Revenue per period — by visit number',
  cal_items_title: 'Items sold per period — top 20 menu items',
  cal_item_revenue_title: 'Revenue per period — top 20 menu items',

  // --- Legend / tooltip shared -------------------------------------------
  legend_cash: 'Cash',
  tooltip_revenue: 'Revenue',
  tooltip_transactions: 'Transactions',
  tooltip_total: 'Total',
  txn_suffix: 'txn',
  cust_suffix: 'cust',

  // --- Filter bar ---------------------------------------------------------
  filter_sales_type: 'Sales type',
  filter_payment_type: 'Payment type',
  filter_loading_aria: 'Filters loading',
  sales_type_all: 'All',
  sales_type_inhouse: 'Inhouse',
  sales_type_takeaway: 'Takeaway',
  cash_all: 'All',
  cash_cash: 'Cash',
  cash_card: 'Card',

  // --- Days popover -------------------------------------------------------
  days_aria: 'Days of week',
  days_filter_heading: 'Filter by day of week',
  days_preset_all: 'All',
  days_preset_weekdays: 'Weekdays',
  days_preset_weekends: 'Weekends',
  days_all: 'All days',
  days_mon_fri: 'Mon–Fri',
  days_sat_sun: 'Sat–Sun',
  days_only: '{day} only',
  days_n: '{n} days',
  day_mon: 'Mon',
  day_tue: 'Tue',
  day_wed: 'Wed',
  day_thu: 'Thu',
  day_fri: 'Fri',
  day_sat: 'Sat',
  day_sun: 'Sun',

  // --- Date picker --------------------------------------------------------
  date_range_select: 'Select date range',
  date_quick_select: 'Quick select',
  date_custom_range: 'Custom range',
  date_from: 'From',
  date_to: 'To',
  date_apply: 'Apply range',

  // --- Empty states -------------------------------------------------------
  empty_revenue_fixed_heading: 'No transactions',
  empty_revenue_fixed_body: 'No sales recorded in this window.',
  empty_revenue_chip_heading: 'No transactions',
  empty_revenue_chip_body: 'Try a wider date range.',
  empty_cohort_heading: 'No grouping data yet',
  empty_cohort_body: 'Needs at least one non-cash transaction.',
  empty_error_heading: "Couldn't load",
  empty_error_body: 'Try refreshing the page.',
  empty_calendar_revenue_heading: 'No revenue yet',
  empty_calendar_revenue_body: 'No transactions in this window.',
  empty_calendar_counts_heading: 'No transactions yet',
  empty_calendar_counts_body: 'No transactions in this window.',
  empty_calendar_items_heading: 'No order items',
  empty_calendar_items_body: 'No menu items tracked yet.',
  empty_cohort_revenue_heading: 'Not enough history',
  empty_cohort_revenue_body: 'Grouping charts need at least 5 customers per group.',
  empty_cohort_avg_ltv_heading: 'Not enough history',
  empty_cohort_avg_ltv_body: 'Grouping charts need at least 5 customers per group.',

  // --- Forecast empty states (Phase 15 FUI-08) ----------------------------
  empty_forecast_loading_heading:        'Forecast generating',
  empty_forecast_loading_body:           'Check back tomorrow — the first nightly run is still pending.',
  empty_forecast_quality_empty_heading:  'Accuracy data builds after first nightly run',
  empty_forecast_quality_empty_body:     'Forecast accuracy metrics need at least one completed nightly evaluation cycle.',
  empty_forecast_stale_heading:          'Data ≥24h stale',
  empty_forecast_stale_body:             'Last refresh: {ago}. The nightly cascade may have skipped a run.',
  empty_forecast_uncalibrated_ci_heading:'Uncalibrated for 1yr horizon',
  empty_forecast_uncalibrated_ci_body:   'Need ≥2 years of history before the 1yr confidence band is reliable.',
  empty_forecast_grain_pending_heading:  'Forecast not ready at this grain',
  empty_forecast_grain_pending_body:     'Switch to 日 (day) — daily forecasts are live. Week and month forecasts populate on the next refresh.',

  // --- InsightCard footer + edit form ------------------------------------
  insight_week_ending: 'Week ending {date}',
  insight_refreshed_weekly: 'Refreshed weekly',
  insight_refreshed_with_last_run: 'Refreshed weekly · last run {date}',
  insight_auto_generated: 'auto-generated',
  insight_edit_aria: 'Edit insight',
  insight_headline_label: 'Headline',
  insight_body_label: 'Body',
  insight_bullets_label: 'Bullets (up to 3)',
  insight_bullet_placeholder: 'Bullet {n}',
  insight_save: 'Save',
  insight_saving: 'Saving…',
  insight_cancel: 'Cancel',
  insight_update_failed: 'update failed',

  // --- MdeCurveCard (quick-260424-mdc) -----------------------------------
  mde_title: 'Minimum detectable lift',
  mde_description: "Your campaign needs to beat baseline by at least this much per day to register as statistically significant (Welch's t-test).",
  mde_caption: 'Based on {n1} days of baseline (μ {mu}/day, σ {sigma}/day). Assumes 95% confidence, 80% power.',
  mde_tooltip_day: 'Day {n2}',
  mde_tooltip_mde: 'Needs ≥ {mde}/day avg',
  mde_empty: 'Need ≥ 7 days of baseline data to draw the curve.',

  // --- Per-card descriptions (quick-260424-mdc) -------------------------
  heatmap_description: "Each cell is one day's gross revenue — darker blue means a stronger day. Scan the rows to see which weekday carries the week, and the columns to spot steady vs swinging weeks.",
  cal_counts_description: 'Number of transactions per day / week / month, stacked by how many times each customer has visited before. Tall bars = busy periods; the cash segment covers walk-ins without card attribution.',
  cal_revenue_description: 'Gross revenue per day / week / month, stacked by customer visit sequence (1st, 2nd … 8x+). Compare bar heights for trend, and the color split to see whether growth comes from new or returning customers.',
  cal_items_description: 'Top-selling menu items by transaction count. Longer bars = more plates served — use this to spot which items carry the restaurant day-to-day.',
  cal_item_revenue_description: 'Top-selling menu items by gross revenue. Differs from transaction count when an item has a higher ticket — use this to find hidden profit drivers.',
  cohort_retention_description: 'How many customers come back in the weeks / months after their first visit. A flat line = sticky; a sharp drop = one-and-done. Each cohort is a separate line so you can compare quarters.',
  repeater_cohort_description: 'Repeat-customer count by first-visit cohort. The stack on the right shows your newest cohort attracting the most returners; thinner left stacks = older cohorts fading out.',

  // --- Campaign uplift card (Phase 16.1: D-06 plain-language hero / D-08 secondary line / D-09 disclosure / D-10 detail panel) ---
  uplift_card_title_with_date: 'Did the {date} campaign work?',
  uplift_card_computing: 'We\'re still calculating — first result lands tomorrow morning.',
  uplift_hero_too_early: 'Too early to tell',
  uplift_hero_early_not_measurable: 'Probably not measurable yet',
  uplift_hero_early_added: 'Looks like the campaign added revenue, but more weeks of data would confirm',
  uplift_hero_early_reduced: 'Looks like the campaign reduced revenue, but more weeks of data would confirm',
  uplift_hero_mature_no_lift: 'No measurable lift after {weeks} weeks',
  uplift_hero_mature_added: 'Yes, your campaign appears to have added revenue',
  uplift_hero_mature_reduced: 'Yes, your campaign appears to have reduced revenue',
  uplift_secondary_plain: 'Best estimate: ~{point} compared to expected. Range: {lo} to {hi} — that\'s normal day-to-day noise.',
  uplift_details_trigger: 'How is this calculated?',
  uplift_details_anticipation_plain: 'We compare your actual revenue against what the model predicted from data 7+ days before the campaign launched, so any pre-launch anticipation isn\'t counted as campaign uplift.',
  uplift_details_divergence_plain: 'Two of our checks disagree — we\'d want more weeks of data before drawing conclusions.',

  // --- Campaign uplift card supportive labels (Phase 16.1 D-18) ---
  uplift_card_subtitle: 'Comparing your actual revenue since launch against what the model predicted without the campaign.',
  uplift_sparkline_y_label: 'Cumulative revenue impact (€)',
  uplift_sparkline_x_caption: 'Days since campaign launch',
  uplift_baseline_label: 'Dashed line = no campaign baseline',

  // --- Phase 18 weekly counterfactual window labels (UPL-08, UPL-09) ---
  uplift_week_label: 'Week of {start} – {end}',
  uplift_bar_chart_caption: 'Weekly revenue lift since campaign launch',
  uplift_history_x_axis_label: 'Week',

  // --- Forecast model display labels (Phase 16.1 D-16) ---
  forecast_model_sarimax: 'SARIMAX',
  forecast_model_prophet: 'Prophet',
  forecast_model_ets: 'ETS',
  forecast_model_theta: 'Theta',
  forecast_model_naive_dow: 'Naive (DoW avg)',

  // --- Model availability disclosure (Phase 16.2 polish) ---
  model_avail_disclosure_trigger: 'Why are some models disabled?',
  model_avail_disclosure_intro: 'Each model needs a minimum amount of history before it can run. Disabled chips become available as more data arrives.',
  model_avail_col_model: 'Model',
  model_avail_col_status: 'Status',
  model_avail_col_min: 'Min data',
  model_avail_col_why: 'Why',
  model_avail_col_inputs: 'Inputs',
  model_avail_col_backtest: 'Backtest',
  model_avail_status_available: 'Available',
  model_avail_status_phase17: 'Phase 17 backlog',
  model_avail_status_short_day: 'Need more daily history',
  model_avail_status_short_week: 'Need more weekly history',
  model_avail_status_short_month: 'Need more monthly history',
  model_avail_unit_day: 'days',
  model_avail_unit_week: 'weeks',
  model_avail_unit_month: 'months',
  model_avail_why_sarimax: 'Needs 2+ full yearly cycles to learn the seasonal pattern',
  model_avail_why_prophet: 'Auto-disables yearly seasonality when data is short. Past line is a model-trend projection, not a held-out backtest.',
  model_avail_why_ets: 'Needs 2+ full yearly cycles to learn the seasonal pattern',
  model_avail_why_theta: 'Needs 2+ full yearly cycles to learn the seasonal pattern',
  model_avail_why_naive_dow: 'No fitting — just averages history at the same position (e.g., all Mondays)',
  model_avail_why_chronos: 'Foundation model; promotion gated by Phase 17 backtest harness',
  model_avail_why_neuralprophet: 'Neural model; promotion gated by Phase 17 backtest harness',

  // --- Event badge strip + popup (Phase 16.3 D-03/D-04/SC3-SC6) ----------
  event_type_campaign_start:    'Campaign',
  event_type_transit_strike:    'Transit strike',
  event_type_school_holiday:    'School holiday',
  event_type_holiday:           'Public holiday',
  event_type_recurring_event:   'Recurring event',
  popup_event_count:            '{n} events',
  popup_show_all_events:        'Show all {n}',
  popup_show_fewer:             'Show fewer',
  event_strip_open_popup:       '{count} events on {date}',

  // --- Backtest verdict pills (Phase 17 BCK-01/BCK-02) ---
  // Long-form (used in pill title/tooltip for a11y):
  model_avail_backtest_pass:           'PASS',
  model_avail_backtest_fail:           'FAIL',
  model_avail_backtest_pending:        'PENDING',
  model_avail_backtest_uncalibrated:   'UNCALIBRATED — 2y data needed',
  // Short-form (used in compact pill label):
  model_avail_backtest_short_pass:         '✓',
  model_avail_backtest_short_fail:         '✗',
  model_avail_backtest_short_pending:      '…',
  model_avail_backtest_short_uncalibrated: '~',
  // Context sections (shown below the model table)
  model_avail_ctx_gate_title:          'Gate logic — what PASS / FAIL means',
  model_avail_ctx_gate_body:           'A model must beat the best baseline (Naive DoW) by ≥ 10% RMSE across all 4 folds to be promoted. PASS = deployed to your chart. FAIL = stays inactive; the baseline keeps running.',
  model_avail_ctx_folds_title:         'How the 4 folds work',
  model_avail_ctx_folds_body:          'Rolling-origin CV: each fold covers 7 days, stepping back one week at a time. Fold 0 = the most recent complete week; Fold 3 = 3 weeks earlier. Every model trains only on data before its fold\'s start date — no lookahead.',
  model_avail_ctx_naive_title_revenue: 'Why Naive DoW leads on revenue',
  model_avail_ctx_naive_body_revenue:  'Revenue follows a strong day-of-week rhythm (weekends busy, Mondays quiet). A DoW average captures this precisely at ~1 year of data. Complex models need 2+ years to fit trend + annual seasonal parameters without overfitting.',
  model_avail_ctx_naive_title_count:   'Why Naive DoW leads on transaction count',
  model_avail_ctx_naive_body_count:    'Footfall follows a tighter day-of-week pattern than revenue. A DoW average is hard to beat with limited data. Complex models will gain an edge once 2+ years of holiday/event patterns are in the training window.',
  model_avail_ctx_future_title:        'When challengers will catch up',
  model_avail_ctx_future_body:         'At ~730 days (~2 years), SARIMAX and Prophet — which already see holidays and weather — can learn a full annual cycle reliably. Revenue swings ±€100–400 on public holidays; models that incorporate these signals will compound that advantage as the data catalogue grows.',

  // Backtest methodology footnote (shown below the model table)
  model_avail_backtest_memo_day:        'Backtest: day grain, 4 rolling-origin folds (h = 7 / 35 / 120 / 365 d)',
  model_avail_backtest_memo_week_month: 'Week/month: no CV yet — rolling-origin folds (h = 4/13/26 w; h = 3/6 mo) added at 104 weekly / 24 monthly buckets',
  model_avail_backtest_memo_improves:   'Improves automatically at 730 days of data'
} as const;

export default en;
