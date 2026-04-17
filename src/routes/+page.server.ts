// Root dashboard loader. Single SSR choke point for filter state.
//
// Phase 9 (09-02): SSR returns raw daily rows for client-side rebucketing.
// All KPI computation + grain bucketing happens in dashboardStore (D-05, D-08).
// Server still handles: freshness, retention, insights, monthsOfHistory.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { chipToRange, customToRange, type Range, type Grain } from '$lib/dateRange';
import { parseFilters } from '$lib/filters';
import { differenceInMonths, parseISO } from 'date-fns';
import type { DailyRow } from '$lib/dashboardStore.svelte';

export const load: PageServerLoad = async ({ locals, url }) => {
  // Phase 6 FLT-07: parseFilters is the ONLY place filter params are read.
  const filters = parseFilters(url);
  const range = filters.range as Range | 'custom';
  const grain = filters.grain as Grain;

  // E2E chart-fixture bypass — dead code in prod.
  if (process.env.E2E_FIXTURES === '1' && url.searchParams.get('__e2e') === 'charts') {
    const { E2E_RETENTION_ROWS } = await import('$lib/e2eChartFixtures');
    return {
      range,
      grain,
      filters,
      freshness: new Date().toISOString(),
      window: chipToRange((range === 'custom' ? '7d' : range) as Range),
      dailyRows: [
        { business_date: '2026-04-14', gross_cents: 4500, sales_type: 'INHOUSE', is_cash: false },
        { business_date: '2026-04-14', gross_cents: 2000, sales_type: 'TAKEAWAY', is_cash: true },
        { business_date: '2026-04-15', gross_cents: 5500, sales_type: 'INHOUSE', is_cash: false },
        { business_date: '2026-04-15', gross_cents: 1800, sales_type: 'INHOUSE', is_cash: true },
        { business_date: '2026-04-16', gross_cents: 3200, sales_type: 'TAKEAWAY', is_cash: false },
      ] as DailyRow[],
      priorDailyRows: [
        { business_date: '2026-04-07', gross_cents: 3800, sales_type: 'INHOUSE', is_cash: false },
        { business_date: '2026-04-08', gross_cents: 4200, sales_type: 'INHOUSE', is_cash: false },
      ] as DailyRow[],
      retention: E2E_RETENTION_ROWS,
      monthsOfHistory: 2,
      latestInsight: null
    };
  }

  // Freshness query — per-card error isolation.
  let freshness: string | null = null;
  try {
    const { data } = await locals.supabase
      .from('data_freshness_v')
      .select('last_ingested_at')
      .maybeSingle();
    freshness = (data?.last_ingested_at as string | null) ?? null;
  } catch (err) {
    console.error('[+page.server] data_freshness_v query failed', err);
  }

  // Chip window honors filter.range; custom ranges use literal user dates.
  const chipW =
    range === 'custom' && filters.from && filters.to
      ? customToRange({ from: filters.from, to: filters.to })
      : chipToRange(range as Range);

  // Single query: all daily-grain rows for the chip window.
  // Client-side handles filtering + rebucketing (D-05, D-08).
  const dailyRowsP = locals.supabase
    .from('transactions_filterable_v')
    .select('business_date,gross_cents,sales_type,is_cash')
    .gte('business_date', chipW.from)
    .lte('business_date', chipW.to)
    .then(r => (r.data ?? []) as DailyRow[])
    .catch((e: unknown) => { console.error('[transactions_filterable_v]', e); return [] as DailyRow[]; });

  // Prior window rows for delta computation.
  const priorDailyRowsP = chipW.priorFrom
    ? locals.supabase
        .from('transactions_filterable_v')
        .select('business_date,gross_cents,sales_type,is_cash')
        .gte('business_date', chipW.priorFrom)
        .lte('business_date', chipW.priorTo!)
        .then(r => (r.data ?? []) as DailyRow[])
        .catch((e: unknown) => { console.error('[transactions_filterable_v prior]', e); return [] as DailyRow[]; })
    : Promise.resolve([] as DailyRow[]);

  // Retention — per-card error isolation.
  type RetentionRow = { cohort_week: string; period_weeks: number; retention_rate: number; cohort_size_week: number; cohort_age_weeks: number };
  const retentionP = locals.supabase
    .from('retention_curve_v')
    .select('cohort_week,period_weeks,retention_rate,cohort_size_week,cohort_age_weeks')
    .then(r => (r.data ?? []) as RetentionRow[])
    .catch((e: unknown) => { console.error('[retention_curve_v]', e); return [] as RetentionRow[]; });

  // Insights — latest row only (05-01).
  type InsightRow = {
    id: string;
    business_date: string;
    headline: string;
    body: string;
    fallback_used: boolean;
  };
  const insightP = locals.supabase
    .from('insights_v')
    .select('id, business_date, headline, body, fallback_used')
    .order('business_date', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then((r: { data: InsightRow | null; error: unknown }) => {
      if (r.error) {
        console.error('[insights_v]', r.error);
        return null;
      }
      return r.data;
    });

  // Parallel fan-out: daily rows + prior + retention + insight.
  const [
    dailyRows,
    priorDailyRows,
    retentionData,
    latestInsightRow
  ] = await Promise.all([
    dailyRowsP,
    priorDailyRowsP,
    retentionP,
    insightP
  ]);

  // Berlin timezone for is_yesterday flag.
  const todayBerlin = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const latestInsight = latestInsightRow
    ? {
        headline: latestInsightRow.headline,
        body: latestInsightRow.body,
        business_date: latestInsightRow.business_date,
        fallback_used: latestInsightRow.fallback_used,
        is_yesterday: latestInsightRow.business_date !== todayBerlin
      }
    : null;

  // monthsOfHistory for retention caveat.
  const firstCohortDate = retentionData[0]?.cohort_week ?? null;
  const monthsOfHistory = firstCohortDate
    ? differenceInMonths(new Date(), parseISO(firstCohortDate))
    : 0;

  return {
    range,
    grain,
    filters,
    freshness,
    window: chipW,
    dailyRows,
    priorDailyRows,
    retention: retentionData,
    monthsOfHistory,
    latestInsight
  };
};

export const actions: Actions = {
  logout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    throw redirect(303, '/login');
  }
};
