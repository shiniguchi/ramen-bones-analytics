// Root dashboard loader. Reads chip/grain from URL, exposes freshness, and
// ships a logout action.
//
// Wave 3 (04-03): 8 parallel kpi_daily_v queries for KPI tiles.
// Wave 4 (04-04): cohort + LTV queries extend below the kpi block.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { chipToRange, type Range, type Grain } from '$lib/dateRange';
import { sumKpi, type KpiRow } from '$lib/kpiAgg';

export const load: PageServerLoad = async ({ locals, url }) => {
  const range = (url.searchParams.get('range') ?? '7d') as Range;
  const grain = (url.searchParams.get('grain') ?? 'week') as Grain;

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

  // 8 parallel queries: 3 fixed current, 3 fixed prior, 1 chip current, 1 chip prior.
  const [
    kToday, kTodayPrior,
    k7, k7Prior,
    k30, k30Prior,
    kChip, kChipPrior
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
      : Promise.resolve([])
  ]);

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

  return {
    range,
    grain,
    freshness,
    window: chipToRange(range),
    kpi
  };
};

export const actions: Actions = {
  logout: async ({ locals }) => {
    await locals.supabase.auth.signOut();
    throw redirect(303, '/login');
  }
};
