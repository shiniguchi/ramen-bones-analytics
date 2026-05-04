// Static UI string dictionary. Per-locale, flat keys for forkability.
//
// - Add a new key: append to every locale's object (TypeScript enforces this
//   via MessageKey = keyof typeof messages.en).
// - Add a new locale: mirror `./locales.ts` and copy the `en` block as a
//   starting translation.
// - Placeholders use `{name}` syntax; pass values via the 2nd arg to `t()`.
//
// LLM-generated insight copy lives in the `insights.i18n` jsonb column
// (migration 0037), NOT here. This file is only for compile-time-known text.
import type { Locale } from './locales';

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

  // --- Forecast model display labels (Phase 16.1 D-16) ---
  forecast_model_sarimax: 'SARIMAX',
  forecast_model_prophet: 'Prophet',
  forecast_model_ets: 'ETS',
  forecast_model_theta: 'Theta',
  forecast_model_naive_dow: 'Naive (DoW avg)'
} as const;

export type MessageKey = keyof typeof en;

// --- DE (Deutsch) ---------------------------------------------------------
const de: Record<MessageKey, string> = {
  brand_name: 'Ramen Bones',
  logout: 'Abmelden',
  language: 'Sprache',

  grain_day: 'Tag',
  grain_week: 'Woche',
  grain_month: 'Monat',
  grain_selector_aria: 'Zeitraster-Auswahl',

  // Forecast legend (Phase 15 D-04 / FUI-02) — placeholder copy mirrors EN
  legend_aria:                  'Forecast model legend',
  legend_model_sarimax:     'SARIMAX',
  legend_model_prophet:         'Prophet',
  legend_model_ets:             'ETS',
  legend_model_theta:           'Theta',
  legend_model_naive_dow:       'Naive (DoW)',
  legend_model_chronos:         'Chronos',
  legend_model_neuralprophet:   'NeuralProphet',

  // Forecast hover popup (Phase 15 FUI-04) — placeholder copy mirrors EN
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
  invoice_forecast_card_title:       'Transaktionsanzahl-Prognose',
  invoice_forecast_card_description: 'Morgen bis nächstes Jahr — tatsächliche Transaktionen vs. Prognose.',

  kpi_revenue: 'Umsatz',
  kpi_transactions: 'Transaktionen',
  range_today: 'Heute',
  range_all: 'Alle',
  range_custom: 'Benutzerdefiniert',
  prior_label: 'Vor-{range}',
  delta_no_prior: 'keine Vorperiode',
  delta_flat: 'unverändert vs {window}',

  freshness_no_data: 'Noch keine Daten',
  freshness_last_updated: 'Zuletzt aktualisiert vor {ago}',
  freshness_outdated_suffix: ' — Daten könnten veraltet sein',

  repeater_cohort_title: 'Wiederkehrende Kunden nach Erstbesuch-Kohorte',
  cohort_retention_title: 'Kundenbindungsrate nach Akquisitions-Kohorte',
  retention_day_filter_caveat:
    'Der Wochentagsfilter gilt nicht für die Kundenbindung — Kohorten nutzen alle Tage.',
  retention_months_of_history_one:
    'Nur {n} Monat Verlauf — Kohortenkurven stabilisieren sich mit mehr Daten.',
  retention_months_of_history_many:
    'Nur {n} Monate Verlauf — Kohortenkurven stabilisieren sich mit mehr Daten.',
  clamp_badge_label: 'Wochenansicht',
  clamp_badge_tooltip:
    'Tägliche Kohorten haben zu wenige Wiederkehrer für eine Auswertung (Min. {n}). Wöchentliche Kohorten werden angezeigt.',

  heatmap_title: 'Tägliche Umsatz-Heatmap',
  heatmap_empty: 'Noch keine Tagesdaten.',
  cal_counts_title: 'Transaktionen pro Zeitraum — nach Besuchsnummer',
  cal_revenue_title: 'Umsatz pro Zeitraum — nach Besuchsnummer',
  cal_items_title: 'Verkaufte Artikel pro Zeitraum — Top 20 Menüpunkte',
  cal_item_revenue_title: 'Umsatz pro Zeitraum — Top 20 Menüpunkte',

  legend_cash: 'Bargeld',
  tooltip_revenue: 'Umsatz',
  tooltip_transactions: 'Transaktionen',
  tooltip_total: 'Gesamt',
  txn_suffix: 'Tr.',
  cust_suffix: 'Kd.',

  filter_sales_type: 'Verkaufsart',
  filter_payment_type: 'Zahlungsart',
  filter_loading_aria: 'Filter lädt',
  sales_type_all: 'Alle',
  sales_type_inhouse: 'Im Haus',
  sales_type_takeaway: 'Mitnahme',
  cash_all: 'Alle',
  cash_cash: 'Bargeld',
  cash_card: 'Karte',

  days_aria: 'Wochentage',
  days_filter_heading: 'Nach Wochentag filtern',
  days_preset_all: 'Alle',
  days_preset_weekdays: 'Wochentage',
  days_preset_weekends: 'Wochenende',
  days_all: 'Alle Tage',
  days_mon_fri: 'Mo–Fr',
  days_sat_sun: 'Sa–So',
  days_only: 'nur {day}',
  days_n: '{n} Tage',
  day_mon: 'Mo',
  day_tue: 'Di',
  day_wed: 'Mi',
  day_thu: 'Do',
  day_fri: 'Fr',
  day_sat: 'Sa',
  day_sun: 'So',

  date_range_select: 'Zeitraum auswählen',
  date_quick_select: 'Schnellauswahl',
  date_custom_range: 'Benutzerdefinierter Zeitraum',
  date_from: 'Von',
  date_to: 'Bis',
  date_apply: 'Zeitraum anwenden',

  empty_revenue_fixed_heading: 'Keine Transaktionen',
  empty_revenue_fixed_body: 'In diesem Zeitraum keine Verkäufe erfasst.',
  empty_revenue_chip_heading: 'Keine Transaktionen',
  empty_revenue_chip_body: 'Wählen Sie einen größeren Zeitraum.',
  empty_cohort_heading: 'Noch keine Gruppierungsdaten',
  empty_cohort_body: 'Benötigt mindestens eine nicht-Bargeld-Transaktion.',
  empty_error_heading: 'Konnte nicht laden',
  empty_error_body: 'Laden Sie die Seite neu.',
  empty_calendar_revenue_heading: 'Noch kein Umsatz',
  empty_calendar_revenue_body: 'Keine Transaktionen in diesem Zeitraum.',
  empty_calendar_counts_heading: 'Noch keine Transaktionen',
  empty_calendar_counts_body: 'Keine Transaktionen in diesem Zeitraum.',
  empty_calendar_items_heading: 'Keine Bestellartikel',
  empty_calendar_items_body: 'Noch keine Menüpunkte erfasst.',
  empty_cohort_revenue_heading: 'Zu wenig Verlauf',
  empty_cohort_revenue_body: 'Gruppierungen benötigen mindestens 5 Kunden pro Gruppe.',
  empty_cohort_avg_ltv_heading: 'Zu wenig Verlauf',
  empty_cohort_avg_ltv_body: 'Gruppierungen benötigen mindestens 5 Kunden pro Gruppe.',

  // Forecast empty states (Phase 15 FUI-08) — placeholder copy mirrors EN
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

  insight_week_ending: 'Woche endend am {date}',
  insight_refreshed_weekly: 'Wöchentlich aktualisiert',
  insight_refreshed_with_last_run: 'Wöchentlich aktualisiert · zuletzt {date}',
  insight_auto_generated: 'automatisch erzeugt',
  insight_edit_aria: 'Insight bearbeiten',
  insight_headline_label: 'Überschrift',
  insight_body_label: 'Text',
  insight_bullets_label: 'Stichpunkte (bis zu 3)',
  insight_bullet_placeholder: 'Stichpunkt {n}',
  insight_save: 'Speichern',
  insight_saving: 'Speichert…',
  insight_cancel: 'Abbrechen',
  insight_update_failed: 'Aktualisierung fehlgeschlagen',

  // MdeCurveCard
  mde_title: 'Minimal nachweisbarer Anstieg',
  mde_description: 'Ihre Kampagne muss den Normalumsatz pro Tag um mindestens diesen Betrag übertreffen, um statistisch signifikant zu sein (Welch-t-Test).',
  mde_caption: 'Basierend auf {n1} Tagen Baseline (μ {mu}/Tag, σ {sigma}/Tag). Annahme: 95 % Konfidenz, 80 % Power.',
  mde_tooltip_day: 'Tag {n2}',
  mde_tooltip_mde: '≥ {mde}/Tag (Ø) erforderlich',
  mde_empty: 'Mindestens 7 Tage Baseline-Daten erforderlich, um die Kurve zu zeichnen.',

  // Per-card descriptions
  heatmap_description: 'Jede Kachel zeigt den Tagesumsatz — je dunkler das Blau, desto stärker der Tag. Zeilen zeigen, welcher Wochentag die Woche trägt; Spalten zeigen ruhige vs schwankende Wochen.',
  cal_counts_description: 'Anzahl Transaktionen pro Tag / Woche / Monat, gestapelt nach der Besuchsnummer jedes Kunden. Hohe Balken = geschäftige Zeiträume; das Barsegment erfasst Laufkundschaft ohne Kartenzuordnung.',
  cal_revenue_description: 'Umsatz pro Tag / Woche / Monat, gestapelt nach Besuchsnummer (1., 2. … 8x+). Balkenhöhe zeigt den Trend; die Farbverteilung zeigt, ob Wachstum von Neu- oder Stammkunden kommt.',
  cal_items_description: 'Meistverkaufte Menüpunkte nach Transaktionszahl. Längere Balken = mehr servierte Portionen — so erkennen Sie, welche Gerichte das Geschäft täglich tragen.',
  cal_item_revenue_description: 'Meistverkaufte Menüpunkte nach Umsatz. Unterscheidet sich von der Transaktionszahl, wenn ein Gericht einen höheren Preis hat — so finden Sie versteckte Umsatzbringer.',
  cohort_retention_description: 'Wie viele Kunden nach ihrem ersten Besuch in den Wochen / Monaten danach zurückkehren. Flache Linie = treu; steiler Abfall = einmalig. Jede Kohorte ist eine eigene Linie, damit Quartale vergleichbar sind.',
  repeater_cohort_description: 'Anzahl wiederkehrender Kunden nach Erstbesuch-Kohorte. Der rechte Stapel zeigt Ihre neueste Kohorte mit den meisten Rückkehrern; dünnere linke Stapel = ältere Kohorten, die abflauen.',

  // --- Campaign uplift card (Phase 16.1) — DE placeholder = EN; v1.4 polish backlog item filed ---
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

  // --- Campaign uplift card supportive labels (Phase 16.1 D-18 — DE placeholder = EN; v1.4 backlog) ---
  uplift_card_subtitle: 'Comparing your actual revenue since launch against what the model predicted without the campaign.',
  uplift_sparkline_y_label: 'Cumulative revenue impact (€)',
  uplift_sparkline_x_caption: 'Days since campaign launch',
  uplift_baseline_label: 'Dashed line = no campaign baseline',

  // --- Forecast model display labels (Phase 16.1 D-16 — DE placeholder = EN; v1.4 backlog) ---
  forecast_model_sarimax: 'SARIMAX',
  forecast_model_prophet: 'Prophet',
  forecast_model_ets: 'ETS',
  forecast_model_theta: 'Theta',
  forecast_model_naive_dow: 'Naive (DoW avg)'
};

// --- JA (日本語) ----------------------------------------------------------
const ja: Record<MessageKey, string> = {
  brand_name: 'Ramen Bones',
  logout: 'ログアウト',
  language: '言語',

  grain_day: '日',
  grain_week: '週',
  grain_month: '月',
  grain_selector_aria: '期間粒度の選択',

  // Forecast legend (Phase 15 D-04 / FUI-02) — placeholder copy mirrors EN
  legend_aria:                  'Forecast model legend',
  legend_model_sarimax:     'SARIMAX',
  legend_model_prophet:         'Prophet',
  legend_model_ets:             'ETS',
  legend_model_theta:           'Theta',
  legend_model_naive_dow:       'Naive (DoW)',
  legend_model_chronos:         'Chronos',
  legend_model_neuralprophet:   'NeuralProphet',

  // Forecast hover popup (Phase 15 FUI-04) — placeholder copy mirrors EN
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
  invoice_forecast_card_title:       '取引件数の予測',
  invoice_forecast_card_description: '明日から1年後まで — 実際の取引件数と予測の比較。',

  kpi_revenue: '売上',
  kpi_transactions: '取引件数',
  range_today: '本日',
  range_all: '全期間',
  range_custom: 'カスタム',
  prior_label: '前{range}',
  delta_no_prior: '前期データなし',
  delta_flat: '{window}と横ばい',

  freshness_no_data: 'データなし',
  freshness_last_updated: '最終更新 {ago}前',
  freshness_outdated_suffix: ' — データが古い可能性があります',

  repeater_cohort_title: '初回来店グループ別のリピーター',
  cohort_retention_title: '獲得グループ別のリテンション率',
  retention_day_filter_caveat: '曜日フィルターはリテンションには適用されません — 全曜日で集計します。',
  retention_months_of_history_one:
    '履歴は{n}か月のみ — データが増えるとコホート曲線が安定します。',
  retention_months_of_history_many:
    '履歴は{n}か月のみ — データが増えるとコホート曲線が安定します。',
  clamp_badge_label: '週次表示',
  clamp_badge_tooltip:
    '日次コホートはリピーター数が少なすぎるため表示できません（最小 {n}）。代わりに週次コホートを表示します。',

  heatmap_title: '日別売上ヒートマップ',
  heatmap_empty: '日次データがまだありません。',
  cal_counts_title: '期間別取引件数 — 来店回数別',
  cal_revenue_title: '期間別売上 — 来店回数別',
  cal_items_title: '期間別販売数 — メニュー上位20品',
  cal_item_revenue_title: '期間別売上 — メニュー上位20品',

  legend_cash: '現金',
  tooltip_revenue: '売上',
  tooltip_transactions: '取引件数',
  tooltip_total: '合計',
  txn_suffix: '件',
  cust_suffix: '名',

  filter_sales_type: '販売タイプ',
  filter_payment_type: '支払方法',
  filter_loading_aria: 'フィルター読み込み中',
  sales_type_all: 'すべて',
  sales_type_inhouse: '店内',
  sales_type_takeaway: 'テイクアウト',
  cash_all: 'すべて',
  cash_cash: '現金',
  cash_card: 'カード',

  days_aria: '曜日',
  days_filter_heading: '曜日で絞り込み',
  days_preset_all: 'すべて',
  days_preset_weekdays: '平日',
  days_preset_weekends: '週末',
  days_all: '全曜日',
  days_mon_fri: '月–金',
  days_sat_sun: '土–日',
  days_only: '{day}のみ',
  days_n: '{n}日間',
  day_mon: '月',
  day_tue: '火',
  day_wed: '水',
  day_thu: '木',
  day_fri: '金',
  day_sat: '土',
  day_sun: '日',

  date_range_select: '期間を選択',
  date_quick_select: 'クイック選択',
  date_custom_range: 'カスタム期間',
  date_from: '開始',
  date_to: '終了',
  date_apply: '期間を適用',

  empty_revenue_fixed_heading: '取引なし',
  empty_revenue_fixed_body: 'この期間に売上はありません。',
  empty_revenue_chip_heading: '取引なし',
  empty_revenue_chip_body: 'より広い期間をお試しください。',
  empty_cohort_heading: 'グループデータがまだありません',
  empty_cohort_body: '現金以外の取引が最低1件必要です。',
  empty_error_heading: '読み込めませんでした',
  empty_error_body: 'ページを再読み込みしてください。',
  empty_calendar_revenue_heading: '売上がまだありません',
  empty_calendar_revenue_body: 'この期間に取引はありません。',
  empty_calendar_counts_heading: '取引がまだありません',
  empty_calendar_counts_body: 'この期間に取引はありません。',
  empty_calendar_items_heading: '注文アイテムなし',
  empty_calendar_items_body: 'メニュー品目がまだ記録されていません。',
  empty_cohort_revenue_heading: '履歴が不足',
  empty_cohort_revenue_body: 'グループ表示には1グループあたり5名以上必要です。',
  empty_cohort_avg_ltv_heading: '履歴が不足',
  empty_cohort_avg_ltv_body: 'グループ表示には1グループあたり5名以上必要です。',

  // Forecast empty states (Phase 15 FUI-08) — placeholder copy mirrors EN
  empty_forecast_loading_heading:        'Forecast generating',
  empty_forecast_loading_body:           'Check back tomorrow — the first nightly run is still pending.',
  empty_forecast_quality_empty_heading:  'Accuracy data builds after first nightly run',
  empty_forecast_quality_empty_body:     'Forecast accuracy metrics need at least one completed nightly evaluation cycle.',
  empty_forecast_stale_heading:          'Data ≥24h stale',
  empty_forecast_stale_body:             'Last refresh: {ago}. The nightly cascade may have skipped a run.',
  empty_forecast_uncalibrated_ci_heading:'Uncalibrated for 1yr horizon',
  empty_forecast_uncalibrated_ci_body:   'Need ≥2 years of history before the 1yr confidence band is reliable.',
  empty_forecast_grain_pending_heading:  'この粒度の予測は準備中です',
  empty_forecast_grain_pending_body:     '「日」に切り替えると日次の予測を確認できます。週次・月次は次回更新で生成されます。',

  insight_week_ending: '{date}終了週',
  insight_refreshed_weekly: '週次更新',
  insight_refreshed_with_last_run: '週次更新 · 最終実行 {date}',
  insight_auto_generated: '自動生成',
  insight_edit_aria: 'インサイトを編集',
  insight_headline_label: '見出し',
  insight_body_label: '本文',
  insight_bullets_label: '要点（最大3つ）',
  insight_bullet_placeholder: '要点 {n}',
  insight_save: '保存',
  insight_saving: '保存中…',
  insight_cancel: 'キャンセル',
  insight_update_failed: '更新に失敗しました',

  // MdeCurveCard
  mde_title: '検出可能な最小売上リフト',
  mde_description: 'キャンペーンが統計的に有意と判定されるには、通常の1日平均売上をこの金額以上上回る必要があります（Welchのt検定）。',
  mde_caption: 'ベースライン{n1}日分のデータに基づく（μ {mu}/日、σ {sigma}/日）。信頼度95％、検出力80％を想定。',
  mde_tooltip_day: '{n2}日目',
  mde_tooltip_mde: '1日平均 {mde} 以上必要',
  mde_empty: '曲線を描画するにはベースラインデータが7日以上必要です。',

  // Per-card descriptions
  heatmap_description: '各マスが1日の売上を示します — 濃い青ほど売上が高い日。行で「どの曜日が一週間を支えているか」、列で「安定している週か波のある週か」を読み取れます。',
  cal_counts_description: '1日 / 週 / 月ごとの取引件数を、各顧客の来店回数別に積み上げて表示します。棒が高いほど忙しい時期。現金セグメントはカード紐付けのない一見客を含みます。',
  cal_revenue_description: '1日 / 週 / 月ごとの売上を、来店回数（1回目・2回目…8回以上）別に積み上げて表示します。棒の高さでトレンドを、色の構成で新規顧客と常連のどちらが伸びているかを確認できます。',
  cal_items_description: '取引件数で見たメニューの売れ筋。棒が長いほど出数が多い — お店を日々支えている一皿を見つけるのに使えます。',
  cal_item_revenue_description: '売上額で見たメニューの売れ筋。客単価の高い一皿は取引件数と順位が変わります — 隠れた稼ぎ頭を見つけるのに使えます。',
  cohort_retention_description: '初回来店後の数週 / 数ヶ月で再来店する顧客の割合です。線が水平 = 定着している、急降下 = 一度きり。コホートごとに線が分かれているので四半期を比較できます。',
  repeater_cohort_description: '初回来店コホート別のリピーター数です。右端のスタックが高いほど、最新のコホートが多くのリピーターを生んでいます。左側が細い = 古いコホートが先細りしている状態。',

  // --- Campaign uplift card (Phase 16.1) ---
  uplift_card_title_with_date: '{date}のキャンペーンは効果ありましたか？',
  uplift_card_computing: '計算中です — 最初の結果は明日の朝に出ます。',
  uplift_hero_too_early: '判断するにはまだ早すぎます',
  uplift_hero_early_not_measurable: 'まだはっきりとした効果は見えていません',
  uplift_hero_early_added: '売上が伸びたように見えますが、もう少しデータが必要です',
  uplift_hero_early_reduced: '売上が下がったように見えますが、もう少しデータが必要です',
  uplift_hero_mature_no_lift: '{weeks}週間経っても、はっきりとした効果は出ていません',
  uplift_hero_mature_added: 'はい、キャンペーンで売上が伸びたようです',
  uplift_hero_mature_reduced: 'はい、キャンペーンで売上が下がったようです',
  uplift_secondary_plain: '目安: 予想と比べて{point}ぐらい。範囲: {lo} 〜 {hi} — これくらいの差は普段の変動の範囲内です。',
  uplift_details_trigger: 'どうやって計算しているの？',
  uplift_details_anticipation_plain: 'キャンペーン開始の7日以上前のデータでモデルが予測した売上と、実際の売上を比べています。開始前の期待感による売上の動きはキャンペーンの効果には含めません。',
  uplift_details_divergence_plain: '2つのチェック方法で結果が違いました — 結論を出す前にもう少しデータを集めたいところです。',

  // --- Campaign uplift card supportive labels (Phase 16.1 D-18) ---
  uplift_card_subtitle: 'キャンペーン開始後の実際の売上と、キャンペーンがなかった場合のモデル予測を比較しています。',
  uplift_sparkline_y_label: '累計売上影響額（€）',
  uplift_sparkline_x_caption: 'キャンペーン開始からの経過日数',
  uplift_baseline_label: '点線 = キャンペーンなしの基準',

  // --- Forecast model display labels (Phase 16.1 D-16) ---
  forecast_model_sarimax: 'SARIMAX',
  forecast_model_prophet: 'Prophet',
  forecast_model_ets: 'ETS',
  forecast_model_theta: 'Theta',
  forecast_model_naive_dow: '単純予測（曜日平均）'
};

// --- ES (Español) ---------------------------------------------------------
const es: Record<MessageKey, string> = {
  brand_name: 'Ramen Bones',
  logout: 'Cerrar sesión',
  language: 'Idioma',

  grain_day: 'Día',
  grain_week: 'Semana',
  grain_month: 'Mes',
  grain_selector_aria: 'Selector de granularidad',

  // Forecast legend (Phase 15 D-04 / FUI-02) — placeholder copy mirrors EN
  legend_aria:                  'Forecast model legend',
  legend_model_sarimax:     'SARIMAX',
  legend_model_prophet:         'Prophet',
  legend_model_ets:             'ETS',
  legend_model_theta:           'Theta',
  legend_model_naive_dow:       'Naive (DoW)',
  legend_model_chronos:         'Chronos',
  legend_model_neuralprophet:   'NeuralProphet',

  // Forecast hover popup (Phase 15 FUI-04) — placeholder copy mirrors EN
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
  invoice_forecast_card_title:       'Pronóstico de transacciones',
  invoice_forecast_card_description: 'De mañana hasta el próximo año — transacciones reales vs. pronóstico.',

  kpi_revenue: 'Ingresos',
  kpi_transactions: 'Transacciones',
  range_today: 'Hoy',
  range_all: 'Todo',
  range_custom: 'Personalizado',
  prior_label: '{range} anterior',
  delta_no_prior: 'sin datos previos',
  delta_flat: 'estable vs {window}',

  freshness_no_data: 'Aún no hay datos',
  freshness_last_updated: 'Última actualización hace {ago}',
  freshness_outdated_suffix: ' — los datos pueden estar desactualizados',

  repeater_cohort_title: 'Repetidores adquiridos por cohorte de primera visita',
  cohort_retention_title: 'Tasa de retención por cohorte de adquisición',
  retention_day_filter_caveat:
    'El filtro de día no aplica a retención de cohortes — las cohortes usan todos los días.',
  retention_months_of_history_one:
    'Solo {n} mes de historial — las curvas de cohorte se estabilizarán con más datos.',
  retention_months_of_history_many:
    'Solo {n} meses de historial — las curvas de cohorte se estabilizarán con más datos.',
  clamp_badge_label: 'Vista semanal',
  clamp_badge_tooltip:
    'Las cohortes diarias tienen muy pocos clientes recurrentes para graficar (mín. {n}). Mostrando cohortes semanales en su lugar.',

  heatmap_title: 'Mapa de calor de ingresos diarios',
  heatmap_empty: 'Aún no hay datos diarios.',
  cal_counts_title: 'Transacciones por período — por número de visita',
  cal_revenue_title: 'Ingresos por período — por número de visita',
  cal_items_title: 'Artículos vendidos por período — top 20 del menú',
  cal_item_revenue_title: 'Ingresos por período — top 20 del menú',

  legend_cash: 'Efectivo',
  tooltip_revenue: 'Ingresos',
  tooltip_transactions: 'Transacciones',
  tooltip_total: 'Total',
  txn_suffix: 'tr.',
  cust_suffix: 'cli.',

  filter_sales_type: 'Tipo de venta',
  filter_payment_type: 'Tipo de pago',
  filter_loading_aria: 'Filtros cargando',
  sales_type_all: 'Todos',
  sales_type_inhouse: 'En local',
  sales_type_takeaway: 'Para llevar',
  cash_all: 'Todos',
  cash_cash: 'Efectivo',
  cash_card: 'Tarjeta',

  days_aria: 'Días de la semana',
  days_filter_heading: 'Filtrar por día de la semana',
  days_preset_all: 'Todos',
  days_preset_weekdays: 'Entre semana',
  days_preset_weekends: 'Fin de semana',
  days_all: 'Todos los días',
  days_mon_fri: 'Lun–Vie',
  days_sat_sun: 'Sáb–Dom',
  days_only: 'solo {day}',
  days_n: '{n} días',
  day_mon: 'Lun',
  day_tue: 'Mar',
  day_wed: 'Mié',
  day_thu: 'Jue',
  day_fri: 'Vie',
  day_sat: 'Sáb',
  day_sun: 'Dom',

  date_range_select: 'Seleccionar rango de fechas',
  date_quick_select: 'Selección rápida',
  date_custom_range: 'Rango personalizado',
  date_from: 'Desde',
  date_to: 'Hasta',
  date_apply: 'Aplicar rango',

  empty_revenue_fixed_heading: 'Sin transacciones',
  empty_revenue_fixed_body: 'No se registraron ventas en este período.',
  empty_revenue_chip_heading: 'Sin transacciones',
  empty_revenue_chip_body: 'Pruebe con un rango más amplio.',
  empty_cohort_heading: 'Aún no hay datos de agrupación',
  empty_cohort_body: 'Se necesita al menos una transacción no en efectivo.',
  empty_error_heading: 'No se pudo cargar',
  empty_error_body: 'Intente recargar la página.',
  empty_calendar_revenue_heading: 'Aún sin ingresos',
  empty_calendar_revenue_body: 'Sin transacciones en este período.',
  empty_calendar_counts_heading: 'Aún sin transacciones',
  empty_calendar_counts_body: 'Sin transacciones en este período.',
  empty_calendar_items_heading: 'Sin artículos',
  empty_calendar_items_body: 'Aún no hay artículos del menú registrados.',
  empty_cohort_revenue_heading: 'Historial insuficiente',
  empty_cohort_revenue_body: 'Los gráficos de cohorte necesitan al menos 5 clientes por grupo.',
  empty_cohort_avg_ltv_heading: 'Historial insuficiente',
  empty_cohort_avg_ltv_body: 'Los gráficos de cohorte necesitan al menos 5 clientes por grupo.',

  // Forecast empty states (Phase 15 FUI-08) — placeholder copy mirrors EN
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

  insight_week_ending: 'Semana que termina el {date}',
  insight_refreshed_weekly: 'Actualizado semanalmente',
  insight_refreshed_with_last_run: 'Actualizado semanalmente · última ejecución {date}',
  insight_auto_generated: 'generado automáticamente',
  insight_edit_aria: 'Editar análisis',
  insight_headline_label: 'Título',
  insight_body_label: 'Cuerpo',
  insight_bullets_label: 'Viñetas (hasta 3)',
  insight_bullet_placeholder: 'Viñeta {n}',
  insight_save: 'Guardar',
  insight_saving: 'Guardando…',
  insight_cancel: 'Cancelar',
  insight_update_failed: 'error al actualizar',

  // MdeCurveCard
  mde_title: 'Aumento mínimo detectable',
  mde_description: 'Tu campaña necesita superar la línea base en al menos esta cantidad por día para ser estadísticamente significativa (prueba t de Welch).',
  mde_caption: 'Basado en {n1} días de línea base (μ {mu}/día, σ {sigma}/día). Asume 95 % de confianza y 80 % de potencia.',
  mde_tooltip_day: 'Día {n2}',
  mde_tooltip_mde: 'Necesita ≥ {mde}/día (prom.)',
  mde_empty: 'Se necesitan al menos 7 días de datos de línea base para dibujar la curva.',

  // Per-card descriptions
  heatmap_description: 'Cada celda es el ingreso bruto de un día — azul más oscuro = día más fuerte. Las filas muestran qué día de la semana sostiene la semana; las columnas, semanas estables vs variables.',
  cal_counts_description: 'Número de transacciones por día / semana / mes, apiladas según cuántas veces ha visitado cada cliente. Barras altas = períodos ocupados; el segmento "efectivo" cubre clientes sin atribución por tarjeta.',
  cal_revenue_description: 'Ingreso bruto por día / semana / mes, apilado por secuencia de visitas del cliente (1ª, 2ª … 8+). Compara la altura para ver la tendencia y los colores para ver si el crecimiento viene de clientes nuevos o recurrentes.',
  cal_items_description: 'Platos más vendidos por número de transacciones. Barras más largas = más platos servidos — úsalo para detectar qué platos sostienen el restaurante día a día.',
  cal_item_revenue_description: 'Platos más vendidos por ingreso bruto. Difiere del recuento cuando un plato tiene un ticket más alto — úsalo para encontrar generadores de beneficio ocultos.',
  cohort_retention_description: 'Cuántos clientes regresan en las semanas / meses posteriores a su primera visita. Línea plana = fidelizados; caída brusca = de una sola vez. Cada cohorte es una línea distinta para comparar trimestres.',
  repeater_cohort_description: 'Recuento de clientes recurrentes por cohorte de primera visita. La pila de la derecha muestra que tu cohorte más reciente atrae la mayor cantidad de retornos; pilas más delgadas a la izquierda = cohortes antiguas que se diluyen.',

  // --- Campaign uplift card (Phase 16.1) — ES placeholder = EN; v1.4 polish backlog item filed ---
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

  // --- Campaign uplift card supportive labels (Phase 16.1 D-18 — ES placeholder = EN; v1.4 backlog) ---
  uplift_card_subtitle: 'Comparing your actual revenue since launch against what the model predicted without the campaign.',
  uplift_sparkline_y_label: 'Cumulative revenue impact (€)',
  uplift_sparkline_x_caption: 'Days since campaign launch',
  uplift_baseline_label: 'Dashed line = no campaign baseline',

  // --- Forecast model display labels (Phase 16.1 D-16 — ES placeholder = EN; v1.4 backlog) ---
  forecast_model_sarimax: 'SARIMAX',
  forecast_model_prophet: 'Prophet',
  forecast_model_ets: 'ETS',
  forecast_model_theta: 'Theta',
  forecast_model_naive_dow: 'Naive (DoW avg)'
};

// --- FR (Français) --------------------------------------------------------
const fr: Record<MessageKey, string> = {
  brand_name: 'Ramen Bones',
  logout: 'Se déconnecter',
  language: 'Langue',

  grain_day: 'Jour',
  grain_week: 'Semaine',
  grain_month: 'Mois',
  grain_selector_aria: 'Sélecteur de granularité',

  // Forecast legend (Phase 15 D-04 / FUI-02) — placeholder copy mirrors EN
  legend_aria:                  'Forecast model legend',
  legend_model_sarimax:     'SARIMAX',
  legend_model_prophet:         'Prophet',
  legend_model_ets:             'ETS',
  legend_model_theta:           'Theta',
  legend_model_naive_dow:       'Naive (DoW)',
  legend_model_chronos:         'Chronos',
  legend_model_neuralprophet:   'NeuralProphet',

  // Forecast hover popup (Phase 15 FUI-04) — placeholder copy mirrors EN
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
  invoice_forecast_card_title:       'Prévision du nombre de transactions',
  invoice_forecast_card_description: "De demain à l'année prochaine — transactions réelles vs. prévision.",

  kpi_revenue: "Chiffre d'affaires",
  kpi_transactions: 'Transactions',
  range_today: "Aujourd'hui",
  range_all: 'Tout',
  range_custom: 'Personnalisé',
  prior_label: '{range} précédent',
  delta_no_prior: 'pas de période précédente',
  delta_flat: 'stable vs {window}',

  freshness_no_data: 'Aucune donnée',
  freshness_last_updated: 'Dernière mise à jour il y a {ago}',
  freshness_outdated_suffix: ' — données potentiellement obsolètes',

  repeater_cohort_title: 'Clients fidèles acquis par cohorte de première visite',
  cohort_retention_title: "Taux de rétention par cohorte d'acquisition",
  retention_day_filter_caveat:
    "Le filtre jour ne s'applique pas à la rétention — les cohortes utilisent tous les jours.",
  retention_months_of_history_one:
    "Seulement {n} mois d'historique — les courbes de cohorte se stabiliseront avec plus de données.",
  retention_months_of_history_many:
    "Seulement {n} mois d'historique — les courbes de cohorte se stabiliseront avec plus de données.",
  clamp_badge_label: 'Vue hebdomadaire',
  clamp_badge_tooltip:
    'Les cohortes quotidiennes ont trop peu de clients fidèles pour être tracées (min. {n}). Affichage des cohortes hebdomadaires à la place.',

  heatmap_title: "Carte thermique du chiffre d'affaires quotidien",
  heatmap_empty: "Pas encore de données quotidiennes.",
  cal_counts_title: 'Transactions par période — par numéro de visite',
  cal_revenue_title: "Chiffre d'affaires par période — par numéro de visite",
  cal_items_title: 'Articles vendus par période — top 20 du menu',
  cal_item_revenue_title: "Chiffre d'affaires par période — top 20 du menu",

  legend_cash: 'Espèces',
  tooltip_revenue: "Chiffre d'affaires",
  tooltip_transactions: 'Transactions',
  tooltip_total: 'Total',
  txn_suffix: 'tr.',
  cust_suffix: 'cl.',

  filter_sales_type: 'Type de vente',
  filter_payment_type: 'Moyen de paiement',
  filter_loading_aria: 'Filtres en chargement',
  sales_type_all: 'Tous',
  sales_type_inhouse: 'Sur place',
  sales_type_takeaway: 'À emporter',
  cash_all: 'Tous',
  cash_cash: 'Espèces',
  cash_card: 'Carte',

  days_aria: 'Jours de la semaine',
  days_filter_heading: 'Filtrer par jour de la semaine',
  days_preset_all: 'Tous',
  days_preset_weekdays: 'Semaine',
  days_preset_weekends: 'Week-end',
  days_all: 'Tous les jours',
  days_mon_fri: 'Lun–Ven',
  days_sat_sun: 'Sam–Dim',
  days_only: '{day} seulement',
  days_n: '{n} jours',
  day_mon: 'Lun',
  day_tue: 'Mar',
  day_wed: 'Mer',
  day_thu: 'Jeu',
  day_fri: 'Ven',
  day_sat: 'Sam',
  day_sun: 'Dim',

  date_range_select: 'Choisir une plage de dates',
  date_quick_select: 'Sélection rapide',
  date_custom_range: 'Plage personnalisée',
  date_from: 'Du',
  date_to: 'Au',
  date_apply: 'Appliquer la plage',

  empty_revenue_fixed_heading: 'Aucune transaction',
  empty_revenue_fixed_body: 'Aucune vente enregistrée dans cette période.',
  empty_revenue_chip_heading: 'Aucune transaction',
  empty_revenue_chip_body: 'Essayez une plage plus large.',
  empty_cohort_heading: 'Pas encore de données de regroupement',
  empty_cohort_body: 'Au moins une transaction non espèces est requise.',
  empty_error_heading: 'Chargement impossible',
  empty_error_body: 'Essayez de recharger la page.',
  empty_calendar_revenue_heading: "Pas encore de chiffre d'affaires",
  empty_calendar_revenue_body: 'Aucune transaction dans cette période.',
  empty_calendar_counts_heading: 'Pas encore de transactions',
  empty_calendar_counts_body: 'Aucune transaction dans cette période.',
  empty_calendar_items_heading: 'Aucun article commandé',
  empty_calendar_items_body: 'Aucun article du menu suivi.',
  empty_cohort_revenue_heading: 'Historique insuffisant',
  empty_cohort_revenue_body: 'Les graphiques de cohorte nécessitent au moins 5 clients par groupe.',
  empty_cohort_avg_ltv_heading: 'Historique insuffisant',
  empty_cohort_avg_ltv_body: 'Les graphiques de cohorte nécessitent au moins 5 clients par groupe.',

  // Forecast empty states (Phase 15 FUI-08) — placeholder copy mirrors EN
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

  insight_week_ending: 'Semaine se terminant le {date}',
  insight_refreshed_weekly: 'Actualisé chaque semaine',
  insight_refreshed_with_last_run: 'Actualisé chaque semaine · dernière exécution {date}',
  insight_auto_generated: 'généré automatiquement',
  insight_edit_aria: "Modifier l'analyse",
  insight_headline_label: 'Titre',
  insight_body_label: 'Corps',
  insight_bullets_label: 'Puces (jusqu\'à 3)',
  insight_bullet_placeholder: 'Puce {n}',
  insight_save: 'Enregistrer',
  insight_saving: 'Enregistrement…',
  insight_cancel: 'Annuler',
  insight_update_failed: "échec de la mise à jour",

  // MdeCurveCard
  mde_title: 'Augmentation minimale détectable',
  mde_description: "Votre campagne doit dépasser la référence d'au moins ce montant par jour pour être statistiquement significative (test t de Welch).",
  mde_caption: "Basé sur {n1} jours de référence (μ {mu}/jour, σ {sigma}/jour). Hypothèse : 95 % de confiance, 80 % de puissance.",
  mde_tooltip_day: 'Jour {n2}',
  mde_tooltip_mde: '≥ {mde}/jour (moy.) requis',
  mde_empty: "Au moins 7 jours de données de référence sont nécessaires pour tracer la courbe.",

  // Per-card descriptions
  heatmap_description: "Chaque cellule représente le chiffre d'affaires d'une journée — plus le bleu est foncé, plus la journée a été forte. Les lignes révèlent le jour qui porte la semaine ; les colonnes, les semaines régulières vs irrégulières.",
  cal_counts_description: "Nombre de transactions par jour / semaine / mois, empilées selon le nombre de visites précédentes de chaque client. Barres hautes = périodes chargées ; le segment « espèces » couvre les passages sans attribution par carte.",
  cal_revenue_description: "Chiffre d'affaires par jour / semaine / mois, empilé selon la séquence de visites du client (1ʳᵉ, 2ᵉ … 8x+). Comparez la hauteur pour la tendance ; la répartition des couleurs indique si la croissance vient de nouveaux clients ou de fidèles.",
  cal_items_description: "Plats les plus vendus par nombre de transactions. Plus la barre est longue, plus le plat est servi — utile pour identifier les plats qui font tourner le restaurant au quotidien.",
  cal_item_revenue_description: "Plats les plus vendus par chiffre d'affaires. Diffère du nombre de transactions quand un plat a un ticket plus élevé — utile pour repérer les moteurs de profit cachés.",
  cohort_retention_description: "Combien de clients reviennent dans les semaines / mois suivant leur première visite. Ligne plate = fidélisés ; chute nette = passage unique. Chaque cohorte est une ligne séparée pour comparer les trimestres.",
  repeater_cohort_description: "Nombre de clients fidèles par cohorte de première visite. La pile de droite montre que votre cohorte la plus récente attire le plus de retours ; des piles plus fines à gauche = cohortes anciennes qui s'estompent.",

  // --- Campaign uplift card (Phase 16.1) — FR placeholder = EN; v1.4 polish backlog item filed ---
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

  // --- Campaign uplift card supportive labels (Phase 16.1 D-18 — FR placeholder = EN; v1.4 backlog) ---
  uplift_card_subtitle: 'Comparing your actual revenue since launch against what the model predicted without the campaign.',
  uplift_sparkline_y_label: 'Cumulative revenue impact (€)',
  uplift_sparkline_x_caption: 'Days since campaign launch',
  uplift_baseline_label: 'Dashed line = no campaign baseline',

  // --- Forecast model display labels (Phase 16.1 D-16 — FR placeholder = EN; v1.4 backlog) ---
  forecast_model_sarimax: 'SARIMAX',
  forecast_model_prophet: 'Prophet',
  forecast_model_ets: 'ETS',
  forecast_model_theta: 'Theta',
  forecast_model_naive_dow: 'Naive (DoW avg)'
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en, de, ja, es, fr };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

/**
 * Look up a UI string by key. Falls back to the EN dictionary (the SoT — see
 * file comment) if the key is missing in the target locale, then to the raw
 * key as a last resort. Note: the fallback is hardwired to `en`, not to
 * DEFAULT_LOCALE — they are different concerns. DEFAULT_LOCALE is the
 * user-facing default rendered when no cookie is set; `en` is the always-
 * authoritative dictionary that every other locale extends from. If the
 * fallback used DEFAULT_LOCALE, then changing the default to e.g. 'ja'
 * would silently route locales-with-missing-keys to Japanese instead of
 * English, and tests with no `page.data.locale` set would render Japanese.
 * Placeholders like `{n}` are interpolated from `vars`.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const raw = messages[locale]?.[key] ?? messages.en[key] ?? key;
  return interpolate(raw, vars);
}
