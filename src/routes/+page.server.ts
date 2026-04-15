// Root dashboard loader. Reads chip/grain from URL, exposes freshness, and
// ships a logout action.
//
// Wave 3 (04-03): 8 parallel kpi_daily_v queries for KPI tiles.
// Wave 4 (04-04): cohort + LTV queries extend below the kpi block.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { chipToRange, type Range, type Grain } from '$lib/dateRange';
import { sumKpi, type KpiRow } from '$lib/kpiAgg';
import { shapeNvr } from '$lib/nvrAgg';
import { differenceInMonths, parseISO } from 'date-fns';

export const load: PageServerLoad = async ({ locals, url }) => {
  const range = (url.searchParams.get('range') ?? '7d') as Range;
  const grain = (url.searchParams.get('grain') ?? 'week') as Grain;

  // E2E chart-fixture bypass — only active when preview is launched with
  // E2E_FIXTURES=1 (set by playwright webServer). Returns seeded non-empty
  // retention + LTV data so the charts-with-data spec can exercise the
  // non-empty chart path without touching Supabase. Dead code in prod.
  if (process.env.E2E_FIXTURES === '1' && url.searchParams.get('__e2e') === 'charts') {
    const { E2E_LTV_ROWS, E2E_RETENTION_ROWS } = await import('$lib/e2eChartFixtures');
    return {
      range,
      grain,
      freshness: new Date().toISOString(),
      window: chipToRange(range),
      kpi: {
        revenueToday: { value: 12345, prior: 10000, priorLabel: 'prior day' },
        revenue7d:    { value: 67890, prior: 60000, priorLabel: 'prior 7d' },
        revenue30d:   { value: 234567, prior: 200000, priorLabel: 'prior 30d' },
        txCount:      { value: 42, prior: 38, priorLabel: 'prior 7d' },
        avgTicket:    { value: 1600, prior: 1550, priorLabel: 'prior 7d' }
      },
      retention: E2E_RETENTION_ROWS,
      ltv: E2E_LTV_ROWS,
      monthsOfHistory: 2,
      frequency: [
        { bucket: '1 visit', customer_count: 20 },
        { bucket: '2-3 visits', customer_count: 10 }
      ],
      newVsReturning: [
        { segment: 'new', revenue_cents: 50000 },
        { segment: 'returning', revenue_cents: 30000 },
        { segment: 'cash_anonymous', revenue_cents: 10000 }
      ]
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

  // ── KPI windows ────────────────────────────────────────────────────────────
  // Only kpi_daily_v is queried here — never *_mv or raw transactions (Guard 1).
  const todayW = chipToRange('today');
  const w7 = chipToRange('7d');
  const w30 = chipToRange('30d');
  const chipW = chipToRange(range);

  // Prior windows for the three fixed revenue tiles (D-08 requires delta).
  const priorTodayW = { from: todayW.priorFrom!, to: todayW.priorTo! };
  const priorW7 = { from: w7.priorFrom!, to: w7.priorTo! };
  const priorW30 = { from: w30.priorFrom!, to: w30.priorTo! };

  // Query helper: per-card error isolation. A failed query returns null and
  // logs server-side; the tile renders EmptyState instead of crashing.
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

  // Query helpers for retention/LTV — per-card error isolation, do not throw.
  type RetentionRow = { cohort_week: string; period_weeks: number; retention_rate: number; cohort_size_week: number; cohort_age_weeks: number };
  type LtvRow = { cohort_week: string; period_weeks: number; ltv_cents: number; cohort_size_week: number; cohort_age_weeks: number };

  // ── Frequency + NVR queries ─────────────────────────────────────────────
  // frequency_v is chip-independent (all-time bucket counts).
  // new_vs_returning_v is filtered by the chip window (D-19a exception).

  type FreqRow = { bucket: string; customer_count: number };
  type NvrRaw = { segment: 'new' | 'returning' | 'cash_anonymous' | 'blackout_unknown'; revenue_cents: number };

  const freqP = locals.supabase
    .from('frequency_v')
    .select('bucket,customer_count')
    .then(r => (r.data ?? []) as FreqRow[])
    .catch((e: unknown) => { console.error('[frequency_v]', e); return [] as FreqRow[]; });

  const nvrP = locals.supabase
    .from('new_vs_returning_v')
    .select('segment,revenue_cents')
    .gte('business_date', chipW.from)
    .lte('business_date', chipW.to)
    .then(r => (r.data ?? []) as NvrRaw[])
    .catch((e: unknown) => { console.error('[new_vs_returning_v]', e); return [] as NvrRaw[]; });

  // insights_v: latest row only — JWT-filtered wrapper view (05-01).
  // Per-card error isolation: failure logs and yields null (UI hides card).
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

  // retention_curve_v + ltv_v are weekly-grain views (no grain column in the SQL).
  // Both views are queried in full — the UI filters down to last 4 cohorts.
  const retentionP = locals.supabase
    .from('retention_curve_v')
    .select('cohort_week,period_weeks,retention_rate,cohort_size_week,cohort_age_weeks')
    .then(r => (r.data ?? []) as RetentionRow[])
    .catch((e: unknown) => { console.error('[retention_curve_v]', e); return [] as RetentionRow[]; });

  const ltvP = locals.supabase
    .from('ltv_v')
    .select('cohort_week,period_weeks,ltv_cents,cohort_size_week,cohort_age_weeks')
    .then(r => (r.data ?? []) as LtvRow[])
    .catch((e: unknown) => { console.error('[ltv_v]', e); return [] as LtvRow[]; });

  // 13 parallel queries: 8 KPI + retention + LTV + frequency + NVR + insight.
  const [
    kToday, kTodayPrior,
    k7, k7Prior,
    k30, k30Prior,
    kChip, kChipPrior,
    retentionData,
    ltvData,
    freqData,
    nvrRaw,
    latestInsightRow
  ] = await Promise.all([
    queryKpi(todayW.from, todayW.to),
    queryKpi(priorTodayW.from, priorTodayW.to),
    queryKpi(w7.from, w7.to),
    queryKpi(priorW7.from, priorW7.to),
    queryKpi(w30.from, w30.to),
    queryKpi(priorW30.from, priorW30.to),
    queryKpi(chipW.from, chipW.to),
    // chipPrior is null when range is 'all' (no prior window)
    chipW.priorFrom
      ? queryKpi(chipW.priorFrom, chipW.priorTo!)
      : Promise.resolve([]),
    retentionP,
    ltvP,
    freqP,
    nvrP,
    insightP
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

  // monthsOfHistory for LTV caveat (D-17): whole months from first cohort to today.
  // ltv data sorted by cohort_week ASC from DB; first row has earliest cohort.
  const firstCohortDate = (ltvData[0]?.cohort_week ?? retentionData[0]?.cohort_week) ?? null;
  const monthsOfHistory = firstCohortDate
    ? differenceInMonths(new Date(), parseISO(firstCohortDate))
    : 0;

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
      value: kChip ? sumKpi(kChip).tx_count : null,
      prior: kChipPrior ? sumKpi(kChipPrior).tx_count : null,
      priorLabel: range === 'all' ? null : `prior ${range}`
    },
    avgTicket: {
      value: kChip ? sumKpi(kChip).avg_ticket_cents : null,
      prior: kChipPrior ? sumKpi(kChipPrior).avg_ticket_cents : null,
      priorLabel: range === 'all' ? null : `prior ${range}`
    }
  };

  // Shape NVR rows: aggregate by segment within chip window.
  const nvrShaped = shapeNvr(nvrRaw);

  return {
    range,
    grain,
    freshness,
    window: chipToRange(range),
    kpi,
    retention: retentionData,
    ltv: ltvData,
    monthsOfHistory,
    frequency: freqData,
    newVsReturning: nvrShaped,
    latestInsight
  };
};

export const actions: Actions = {
  logout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    throw redirect(303, '/login');
  }
};
