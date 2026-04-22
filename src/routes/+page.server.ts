// Root dashboard loader. Single SSR choke point for filter state.
//
// Phase 9 (09-02): SSR returns raw daily rows for client-side rebucketing.
// All KPI computation + grain bucketing happens in dashboardStore (D-05, D-08).
// Phase 11-02 (D-03/D-04): 4 lifetime-unbounded queries MOVED off SSR into
// deferred /api/* endpoints (kpi-daily, customer-ltv, repeater-lifetime,
// retention). SSR now owns only range-bounded queries + freshness + insights +
// benchmarks. CF Pages Free caps each request at 50 subrequests / 50ms CPU —
// if this SSR adds a new query, consider deferring it the same way.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { chipToRange, customToRange, type Range, type Grain } from '$lib/dateRange';
import { parseFilters, FROM_FLOOR } from '$lib/filters';
import type { DailyRow } from '$lib/dashboardStore.svelte';
import { fetchAll } from '$lib/supabasePagination';

export const load: PageServerLoad = async ({ locals, url, depends }) => {
  depends('app:dashboard');
  // ---------------------------------------------------------------------
  // CF Pages Free-tier per-request budget:
  //   • 50 subrequests (each fetchAll page = 1 subrequest)
  //   • 50 ms CPU time on the Worker thread
  // If you add a new query here, count the pages it adds (for fetchAll:
  // ceil(row_count / 1000)). If total might exceed ~40 in a hot window,
  // move the new query to /api/* and fetch it client-side via LazyMount
  // (see Plan 11-02 for the established pattern).
  // Phase 11 root cause: `.planning/debug/cf-pages-ssr-cpu-1102.md`
  // ---------------------------------------------------------------------
  // Phase 6 FLT-07: parseFilters is the ONLY place filter params are read.
  const filters = parseFilters(url);
  const range = filters.range as Range | 'custom';
  const grain = filters.grain as Grain;

  // E2E chart-fixture bypass — dead code in prod.
  // Phase 11-02: retention / customerLtv / repeaterTx / dailyKpi / monthsOfHistory
  // fields dropped — those payloads now come from /api/* endpoints that the
  // browser fetches client-side when the card scrolls into view.
  if (process.env.E2E_FIXTURES === '1' && url.searchParams.get('__e2e') === 'charts') {
    const { E2E_ITEM_COUNTS_ROWS } = await import('$lib/e2eChartFixtures');
    return {
      range,
      grain,
      filters,
      freshness: new Date().toISOString(),
      window: chipToRange((range === 'custom' ? '7d' : range) as Range),
      dailyRows: [
        { business_date: '2026-04-14', gross_cents: 4500, sales_type: 'INHOUSE',  is_cash: false, visit_seq: 1,    card_hash: 'h1' },
        { business_date: '2026-04-14', gross_cents: 2000, sales_type: 'TAKEAWAY', is_cash: true,  visit_seq: null, card_hash: null },
        { business_date: '2026-04-15', gross_cents: 5500, sales_type: 'INHOUSE',  is_cash: false, visit_seq: 3,    card_hash: 'h2' },
        { business_date: '2026-04-15', gross_cents: 1800, sales_type: 'INHOUSE',  is_cash: true,  visit_seq: null, card_hash: null },
        { business_date: '2026-04-16', gross_cents: 3200, sales_type: 'TAKEAWAY', is_cash: false, visit_seq: 8,    card_hash: 'h1' },
      ] as DailyRow[],
      priorDailyRows: [
        { business_date: '2026-04-07', gross_cents: 3800, sales_type: 'INHOUSE', is_cash: false, visit_seq: 1, card_hash: 'h3' },
        { business_date: '2026-04-08', gross_cents: 4200, sales_type: 'INHOUSE', is_cash: false, visit_seq: 2, card_hash: 'h3' },
      ] as DailyRow[],
      latestInsight: null,
      isAdmin: false,
      itemCounts: E2E_ITEM_COUNTS_ROWS,
      benchmarkAnchors: [],
      benchmarkSources: []
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

  // Phase 11-01 D-01: Query tenant's earliest business_date once per SSR.
  // Passed into chipToRange as `allStart` so range=all does not default to
  // 1970-01-01. Fallback to FROM_FLOOR ('2025-06-01') on error or empty tenant.
  // Single indexed .order().limit(1).maybeSingle() aggregate via the existing
  // transactions_filterable_v wrapper — RLS-scoped, negligible cost (<10ms).
  let earliestBusinessDate: string | null = null;
  try {
    const { data } = await locals.supabase
      .from('transactions_filterable_v')
      .select('business_date')
      .order('business_date', { ascending: true })
      .limit(1)
      .maybeSingle();
    earliestBusinessDate = (data?.business_date as string | null) ?? null;
  } catch (err) {
    console.error('[+page.server] earliest business_date query failed', err);
  }

  // Chip window honors filter.range; custom ranges use literal user dates.
  // Phase 11-01 D-01: inject earliestBusinessDate so range=all resolves to the
  // tenant's real data floor (never 1970). FROM_FLOOR fallback guards against
  // empty-tenant / query-error cases — see chipToRange signature default too.
  const chipW =
    range === 'custom' && filters.from && filters.to
      ? customToRange({ from: filters.from, to: filters.to })
      : chipToRange(range as Range, new Date(), {
          allStart: earliestBusinessDate ?? FROM_FLOOR
        });

  // Single query: all daily-grain rows for the chip window.
  // Client-side handles filtering + rebucketing (D-05, D-08).
  // Phase 10: visit_seq + card_hash feed VA-04/VA-05 stacked bars (D-05).
  // fetchAll paginates via .range() to bypass PostgREST max_rows=1000 cap (260417-o8a).
  const dailyRowsP = fetchAll<DailyRow>(() => locals.supabase
    .from('transactions_filterable_v')
    .select('business_date,gross_cents,sales_type,is_cash,visit_seq,card_hash')
    .gte('business_date', chipW.from)
    .lte('business_date', chipW.to)
  ).catch((e: unknown) => { console.error('[transactions_filterable_v]', e); return [] as DailyRow[]; });

  // Prior window rows for delta computation.
  const priorDailyRowsP = chipW.priorFrom
    ? fetchAll<DailyRow>(() => locals.supabase
        .from('transactions_filterable_v')
        .select('business_date,gross_cents,sales_type,is_cash,visit_seq,card_hash')
        .gte('business_date', chipW.priorFrom)
        .lte('business_date', chipW.priorTo!)
      ).catch((e: unknown) => { console.error('[transactions_filterable_v prior]', e); return [] as DailyRow[]; })
    : Promise.resolve([] as DailyRow[]);

  // Phase 11-02 D-03: kpi_daily_v, customer_ltv_v and the lifetime card-hash
  // tx query against transactions_filterable_v are DEFERRED to
  // /api/kpi-daily, /api/customer-ltv, /api/repeater-lifetime — fetched
  // client-side via LazyMount when their cards scroll into view.

  // Phase 10: item_counts_daily_v feeds VA-08 (calendar item counts) and
  // the per-item revenue card (quick-260418-irc, migration 0029 added item_revenue_cents).
  // Scoped to active window to keep payload <500kB (D-21).
  type ItemCountRow = {
    business_date: string;
    item_name: string;
    sales_type: string | null;
    is_cash: boolean;
    item_count: number;
    item_revenue_cents: number;
  };
  const itemCountsP = fetchAll<ItemCountRow>(() => locals.supabase
    .from('item_counts_daily_v')
    .select('business_date,item_name,sales_type,is_cash,item_count,item_revenue_cents')
    .gte('business_date', chipW.from)
    .lte('business_date', chipW.to)
  ).catch((e: unknown) => { console.error('[item_counts_daily_v]', e); return [] as ItemCountRow[]; });

  // Phase 11-02 D-03: retention_curve_v + retention_curve_monthly_v DEFERRED
  // to /api/retention. monthsOfHistory (previously computed from the first
  // cohort_week) is now derived client-side in +page.svelte once the deferred
  // fetch resolves.

  // North-star benchmark anchors — weighted-quantile P20/P50/P80 curve for
  // this tenant's curated sources (migrations 0030/0031, quick-260418-bm1/bm2).
  // Empty array on error/no-data so the chart renders cohorts alone.
  type BenchmarkAnchorRow = {
    period_weeks: number;
    lower_p20: number;
    mid_p50: number;
    upper_p80: number;
    source_count: number;
  };
  const benchmarkAnchorsP = fetchAll<BenchmarkAnchorRow>(() => locals.supabase
    .from('benchmark_curve_v')
    .select('period_weeks,lower_p20,mid_p50,upper_p80,source_count')
  ).catch((e: unknown) => { console.error('[benchmark_curve_v]', e); return [] as BenchmarkAnchorRow[]; });

  // Benchmark source attribution — one row per (source, period) for the popover.
  type BenchmarkSourceRow = {
    period_weeks: number;
    id: number;
    label: string;
    country: string;
    segment: string;
    credibility: 'HIGH' | 'MEDIUM' | 'LOW';
    cuisine_match: number;
    metric_type: string;
    conversion_note: string | null;
    sample_size: string | null;
    year: number;
    url: string | null;
    raw_value: number;
    normalized_value: number;
  };
  const benchmarkSourcesP = fetchAll<BenchmarkSourceRow>(() => locals.supabase
    .from('benchmark_sources_v')
    .select('period_weeks,id,label,country,segment,credibility,cuisine_match,metric_type,conversion_note,sample_size,year,url,raw_value,normalized_value')
  ).catch((e: unknown) => { console.error('[benchmark_sources_v]', e); return [] as BenchmarkSourceRow[]; });

  // Insights — latest row only (05-01). action_points added in 260422-fz1.
  type InsightRow = {
    id: string;
    business_date: string;
    headline: string;
    body: string;
    action_points: string[] | null;
    fallback_used: boolean;
  };
  const insightP = locals.supabase
    .from('insights_v')
    .select('id, business_date, headline, body, action_points, fallback_used')
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

  // Parallel fan-out: 6 promises. Phase 11-02 D-03 moved the 4 lifetime
  // unbounded queries (kpi-daily, customer-ltv, repeater-lifetime, retention
  // weekly+monthly = 5 total fetchAlls) off SSR into deferred /api/* endpoints.
  // SSR subrequest count: 6 here + freshness + earliest-business-date = 8
  // total, well under CF Pages Free 50-request ceiling.
  // D-06: dev-only SSR timing log. Tree-shaken out of production builds
  // (import.meta.env.DEV === false). Surfaces in `npm run dev` console
  // and in `wrangler pages dev` preview; never runs on deployed CF Pages.
  const __ssrT0 = import.meta.env.DEV ? Date.now() : 0;
  const [
    dailyRows,
    priorDailyRows,
    latestInsightRow,
    itemCounts,
    benchmarkAnchors,
    benchmarkSources
  ] = await Promise.all([
    dailyRowsP,
    priorDailyRowsP,
    insightP,
    itemCountsP,
    benchmarkAnchorsP,
    benchmarkSourcesP
  ]);
  if (import.meta.env.DEV) {
    // LITERAL_COUNT is hard-coded rather than `promises.length` because
    // the array is already destructured above; re-referencing the source
    // array would require a second Promise.all declaration that can drift.
    // If Plan 11-02 ever changes this shape, update this number in the
    // same diff. Current state: 6 promises post-Plan 11-02.
    const promises = 6;
    // eslint-disable-next-line no-console
    console.info(
      `[ssr-perf] Promise.all: ${promises} queries, ${Date.now() - __ssrT0}ms`
    );
  }

  // Weekly refresh cadence — no "is_yesterday" indicator. The card renders a
  // "Week ending <date>" label derived from business_date client-side.
  const latestInsight = latestInsightRow
    ? {
        id: latestInsightRow.id,
        headline: latestInsightRow.headline,
        body: latestInsightRow.body,
        action_points: latestInsightRow.action_points ?? [],
        business_date: latestInsightRow.business_date,
        fallback_used: latestInsightRow.fallback_used
      }
    : null;

  // Admin gate for inline-edit of the InsightCard. RLS policy `memberships_own`
  // already restricts SELECT to the current user's own row, so a bare select
  // returns exactly the caller's membership record (or null when not logged in
  // / not a member). Cheap (<5ms, PK lookup).
  let isAdmin = false;
  try {
    const { data } = await locals.supabase
      .from('memberships')
      .select('role')
      .maybeSingle();
    isAdmin = (data?.role as string | undefined) === 'owner';
  } catch (err) {
    console.error('[+page.server] memberships role query failed', err);
  }

  return {
    range,
    grain,
    filters,
    freshness,
    window: chipW,
    dailyRows,
    priorDailyRows,
    latestInsight,
    isAdmin,
    itemCounts,
    benchmarkAnchors,
    benchmarkSources,
    // Phase 11-01 D-01: surface the tenant's true earliest business_date so
    // client-side chipToRange('all') can resolve to the real data floor
    // (not FROM_FLOOR). Keeps the chip subtitle + cache window honest.
    earliestBusinessDate
  };
};

export const actions: Actions = {
  logout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    throw redirect(303, '/login');
  },

  // Admin inline-edit save path for the dashboard InsightCard.
  // Authorization enforced server-side by the admin_update_insight RPC
  // (SECURITY DEFINER checks memberships.role='owner'). This action just
  // validates input shape and bubbles errors up as form errors.
  updateInsight: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const headline = String(form.get('headline') ?? '').trim();
    const body = String(form.get('body') ?? '').trim();
    const rawBullets = form.getAll('action_points').map((b) => String(b).trim()).filter(Boolean);

    if (!id) return { ok: false as const, error: 'missing_id' };
    if (!headline) return { ok: false as const, error: 'headline_required' };
    if (!body) return { ok: false as const, error: 'body_required' };

    const { error } = await locals.supabase.rpc('admin_update_insight', {
      p_id: id,
      p_headline: headline,
      p_body: body,
      p_action_points: rawBullets
    });

    if (error) {
      console.error('[updateInsight] rpc failed', error);
      return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  }
};
