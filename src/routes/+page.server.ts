// Root dashboard loader. Single SSR choke point for filter state.
//
// Wave 3 (04-03): 8 parallel kpi_daily_v queries for KPI tiles.
// Wave 4 (04-04): cohort queries extend below the kpi block.
// Phase 6 (06-03): parseFilters(url) is the ONE source of truth (FLT-07).
// Phase 8 (08-02): dead views (frequency_v, new_vs_returning_v, ltv_v) and
//   country filter pipeline removed (VA-03).
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { chipToRange, customToRange, type Range, type Grain } from '$lib/dateRange';
import { sumKpi, type KpiRow } from '$lib/kpiAgg';
import { parseFilters } from '$lib/filters';
import { differenceInMonths, parseISO } from 'date-fns';

export const load: PageServerLoad = async ({ locals, url }) => {
  // Phase 6 FLT-07: parseFilters is the ONLY place filter params are read.
  // Never reach back into url.searchParams for a filter key — everything
  // flows through this single zod-validated object.
  const filters = parseFilters(url);
  const range = filters.range as Range | 'custom';
  const grain = filters.grain as Grain;

  // E2E chart-fixture bypass — only active when preview is launched with
  // E2E_FIXTURES=1 (set by playwright webServer). Returns seeded non-empty
  // retention data so the charts-with-data spec can exercise the non-empty
  // chart path without touching Supabase. Dead code in prod.
  // __e2e is a bypass flag, NOT a filter param, so reading it directly from
  // url.searchParams does not violate FLT-07.
  if (process.env.E2E_FIXTURES === '1' && url.searchParams.get('__e2e') === 'charts') {
    const { E2E_RETENTION_ROWS } = await import('$lib/e2eChartFixtures');
    return {
      range,
      grain,
      filters,
      freshness: new Date().toISOString(),
      window: chipToRange((range === 'custom' ? '7d' : range) as Range),
      distinctSalesTypes: ['INHOUSE', 'TAKEAWAY'] as string[],
      distinctPaymentMethods: ['Bar', 'Visa'] as string[],
      kpi: {
        revenueToday: { value: 12345, prior: 10000, priorLabel: 'prior day' },
        revenue7d:    { value: 67890, prior: 60000, priorLabel: 'prior 7d' },
        revenue30d:   { value: 234567, prior: 200000, priorLabel: 'prior 30d' },
        txCount:      { value: 42, prior: 38, priorLabel: 'prior 7d' },
        avgTicket:    { value: 1600, prior: 1550, priorLabel: 'prior 7d' }
      },
      retention: E2E_RETENTION_ROWS,
      monthsOfHistory: 2
    };
  }

  // `locals.supabase` is already JWT-bound via hooks + layout (Guard 2).
  // Per-card error isolation: a freshness query failure must NOT throw —
  // the FreshnessLabel renders "No data yet" when null.
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

  // -- KPI windows --
  // Fixed reference windows — always show absolute figures regardless of
  // the filter state (UI-SPEC "Fixed-reference KPI tiles behavior under filters").
  const todayW = chipToRange('today');
  const w7 = chipToRange('7d');
  const w30 = chipToRange('30d');

  // Chip window (the "variable" one) honors the filter.range — and custom
  // ranges route through customToRange for literal user-picked dates.
  const chipW =
    range === 'custom' && filters.from && filters.to
      ? customToRange({ from: filters.from, to: filters.to })
      : chipToRange(range as Range);

  // Prior windows for the three fixed revenue tiles (D-08 requires delta).
  const priorTodayW = { from: todayW.priorFrom!, to: todayW.priorTo! };
  const priorW7 = { from: w7.priorFrom!, to: w7.priorTo! };
  const priorW30 = { from: w30.priorFrom!, to: w30.priorTo! };

  // Fixed-tile KPI query — per-card error isolation.
  const queryKpi = async (from: string, to: string): Promise<KpiRow[] | null> => {
    const { data, error } = await locals.supabase
      .from('kpi_daily_v')
      .select('revenue_cents,tx_count,avg_ticket_cents')
      .gte('business_date', from)
      .lte('business_date', to);
    if (error) {
      console.error('[kpi_daily_v]', error);
      return null;
    }
    return data as KpiRow[];
  };

  // Chip-scoped tile query — hits transactions_filterable_v so we can honor
  // sales_type + payment_method via .in() (FLT-03 / FLT-04). No raw
  // transactions read from the frontend; wrapper view enforces JWT tenancy.
  type TxFilterableRow = {
    business_date: string;
    gross_cents: number;
    sales_type: string | null;
    payment_method: string | null;
  };
  const queryFiltered = async (
    from: string,
    to: string
  ): Promise<TxFilterableRow[] | null> => {
    let q = locals.supabase
      .from('transactions_filterable_v')
      .select('business_date,gross_cents,sales_type,payment_method')
      .gte('business_date', from)
      .lte('business_date', to);
    if (filters.sales_type) q = q.in('sales_type', filters.sales_type);
    if (filters.payment_method) q = q.in('payment_method', filters.payment_method);
    const { data, error } = await q;
    if (error) {
      console.error('[transactions_filterable_v]', error);
      return null;
    }
    return data as TxFilterableRow[];
  };

  // Local aggregator mirroring sumKpi semantics so the chip-scoped path
  // returns the same KpiAgg shape the UI already consumes.
  const aggregate = (rows: TxFilterableRow[] | null) => {
    if (!rows) return null;
    const revenue_cents = rows.reduce((s, r) => s + Number(r.gross_cents), 0);
    const tx_count = rows.length;
    const avg_ticket_cents = tx_count === 0 ? 0 : revenue_cents / tx_count;
    return { revenue_cents, tx_count, avg_ticket_cents };
  };

  // Query helpers for retention — per-card error isolation, do not throw.
  type RetentionRow = { cohort_week: string; period_weeks: number; retention_rate: number; cohort_size_week: number; cohort_age_weeks: number };

  // insights_v: latest row only — JWT-filtered wrapper view (05-01).
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

  const retentionP = locals.supabase
    .from('retention_curve_v')
    .select('cohort_week,period_weeks,retention_rate,cohort_size_week,cohort_age_weeks')
    .then(r => (r.data ?? []) as RetentionRow[])
    .catch((e: unknown) => { console.error('[retention_curve_v]', e); return [] as RetentionRow[]; });

  // D-14: distinct option arrays loaded UNFILTERED so dropdown contents
  // never depend on the current filter state. Supabase JS has no DISTINCT,
  // so we select the column and dedupe in JS (FLT-07: no dynamic SQL).
  const distinctSalesTypesP = locals.supabase
    .from('transactions_filterable_v')
    .select('sales_type')
    .not('sales_type', 'is', null)
    .then(r => {
      const rows = (r.data ?? []) as Array<{ sales_type: string | null }>;
      return [...new Set(rows.map(x => x.sales_type).filter((v): v is string => !!v))].sort();
    })
    .catch((e: unknown) => { console.error('[distinctSalesTypes]', e); return [] as string[]; });

  const distinctPaymentMethodsP = locals.supabase
    .from('transactions_filterable_v')
    .select('payment_method')
    .not('payment_method', 'is', null)
    .then(r => {
      const rows = (r.data ?? []) as Array<{ payment_method: string | null }>;
      return [...new Set(rows.map(x => x.payment_method).filter((v): v is string => !!v))].sort();
    })
    .catch((e: unknown) => { console.error('[distinctPaymentMethods]', e); return [] as string[]; });

  // Parallel fan-out: 6 fixed-tile queries + 2 chip-scoped (current + prior)
  // + retention + insight + 2 distinct dropdown loads.
  const [
    kToday, kTodayPrior,
    k7, k7Prior,
    k30, k30Prior,
    kChipRows, kChipPriorRows,
    retentionData,
    latestInsightRow,
    distinctSalesTypes,
    distinctPaymentMethods
  ] = await Promise.all([
    queryKpi(todayW.from, todayW.to),
    queryKpi(priorTodayW.from, priorTodayW.to),
    queryKpi(w7.from, w7.to),
    queryKpi(priorW7.from, priorW7.to),
    queryKpi(w30.from, w30.to),
    queryKpi(priorW30.from, priorW30.to),
    queryFiltered(chipW.from, chipW.to),
    // chipPrior is null when range is 'all' (no prior window)
    chipW.priorFrom
      ? queryFiltered(chipW.priorFrom, chipW.priorTo!)
      : Promise.resolve([] as TxFilterableRow[]),
    retentionP,
    insightP,
    distinctSalesTypesP,
    distinctPaymentMethodsP
  ]);

  // Compute today in tenant timezone (Berlin — single-tenant v1) for is_yesterday flag.
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

  // monthsOfHistory for retention caveat: whole months from first cohort to today.
  const firstCohortDate = retentionData[0]?.cohort_week ?? null;
  const monthsOfHistory = firstCohortDate
    ? differenceInMonths(new Date(), parseISO(firstCohortDate))
    : 0;

  // Aggregate chip-scoped rows into the shape the UI expects.
  const chipAgg = aggregate(kChipRows);
  const chipPriorAgg = aggregate(kChipPriorRows);

  const priorChipLabel = range === 'all' ? null : `prior ${range}`;

  const kpi = {
    revenueToday: {
      value: kToday  ? sumKpi(kToday).revenue_cents  : null,
      prior: kTodayPrior ? sumKpi(kTodayPrior).revenue_cents : null,
      priorLabel: 'prior day'
    },
    revenue7d: {
      value: k7  ? sumKpi(k7).revenue_cents  : null,
      prior: k7Prior ? sumKpi(k7Prior).revenue_cents : null,
      priorLabel: 'prior 7d'
    },
    revenue30d: {
      value: k30  ? sumKpi(k30).revenue_cents  : null,
      prior: k30Prior ? sumKpi(k30Prior).revenue_cents : null,
      priorLabel: 'prior 30d'
    },
    txCount: {
      value: chipAgg ? chipAgg.tx_count : null,
      prior: chipPriorAgg ? chipPriorAgg.tx_count : null,
      priorLabel: priorChipLabel
    },
    avgTicket: {
      value: chipAgg ? chipAgg.avg_ticket_cents : null,
      prior: chipPriorAgg ? chipPriorAgg.avg_ticket_cents : null,
      priorLabel: priorChipLabel
    }
  };

  return {
    range,
    grain,
    filters,
    freshness,
    window: chipW,
    distinctSalesTypes,
    distinctPaymentMethods,
    kpi,
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
