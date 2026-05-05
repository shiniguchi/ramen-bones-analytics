// src/routes/api/forecast/+server.ts
// Phase 15 v2 D-14 / D-15 / D-18.
// Returns native-grain forecasts joined with back-test-window actuals from
// kpi_daily_v. Drops resampling — Phase 14 v2 (15-10) writes rows at the
// native grain (day/week/month), one model run per grain per refresh, so
// the endpoint just filters forecast_with_actual_v on (kpi, granularity).
//
// Inputs:  ?kpi=revenue_eur|invoice_count (default revenue_eur)
//          ?granularity=day|week|month    (required — no default)
//
// Auth: locals.safeGetSession() (canonical helper). RLS is enforced by
//   forecast_with_actual_v's WHERE clause (auth.jwt()->>'restaurant_id')
//   and kpi_daily_v's wrapper. Holidays / school_holidays / recurring_events /
//   transit_alerts are global (public knowledge — no tenant scoping).
//   pipeline_runs_status_v applies its own caller-JWT row filter (Phase 13
//   migration 0049).
// Cache-Control: private, no-store — prevents CDN cross-tenant leakage.
// CF Pages 50-subrequest budget: 8 parallel Supabase queries — well under cap.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import { parseGranularity, type Granularity } from '$lib/forecastValidation';
import { clampEvents, type ForecastEvent } from '$lib/forecastEventClamp';
import { format, subDays, subMonths, startOfWeek, startOfMonth, parseISO } from 'date-fns';

type CampaignRow = { campaign_id: string; start_date: string; name: string | null };

const KPIS = ['revenue_eur', 'invoice_count'] as const;
type Kpi = typeof KPIS[number];

type ForecastViewRow = {
  target_date: string;
  model_name: string;
  granularity: Granularity;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
  horizon_days: number;
  actual_value: number | null;
  forecast_track: string;
  kpi_name: string;
};

type DailyKpiRow        = { business_date: string; revenue_cents: number; tx_count: number };
type HolidayRow         = { date: string; name: string; country_code: string; subdiv_code: string | null };
type SchoolHolidayRow   = { state_code: string; block_name: string; start_date: string; end_date: string };
type RecurringEventRow  = { event_id: string; name: string; start_date: string; end_date: string; impact_estimate: string };
type TransitAlertRow    = { alert_id: string; title: string; pub_date: string; matched_keyword: string };
type PipelineRunRow     = { step_name: string; status: string; finished_at: string | null };

const NO_STORE: Record<string, string> = { 'Cache-Control': 'private, no-store' };

// Backtest window start: how far back of actuals to ship next to forecasts.
//   day:   last 7 days of actuals (small, dense — eyeballable on a phone)
//   week:  last 5 ISO weeks (Mon-anchored)
//   month: last 4 complete months (start of current month - 4)
function backtestStart(lastActual: Date, grain: Granularity): Date {
  if (grain === 'day') return subDays(lastActual, 7);
  if (grain === 'week') return startOfWeek(subDays(lastActual, 35), { weekStartsOn: 1 });
  return startOfMonth(subMonths(lastActual, 4));
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const granularity = parseGranularity(url.searchParams.get('granularity'));
  if (!granularity) {
    return json({ error: 'invalid granularity (must be day, week, or month)' }, { status: 400, headers: NO_STORE });
  }

  const kpiRaw = url.searchParams.get('kpi') ?? 'revenue_eur';
  if (!(KPIS as readonly string[]).includes(kpiRaw)) {
    return json({ error: 'invalid kpi (must be revenue_eur or invoice_count)' }, { status: 400, headers: NO_STORE });
  }
  const kpi = kpiRaw as Kpi;

  try {
    // Forecast rows + sibling event tables + pipeline runs all in parallel.
    // The MV holds the latest run per (target_date, model, grain) so no
    // run_date filter is needed — read everything at this (kpi, grain).
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');

    // Events horizon spans the longest forecast we ship. We don't know it
    // yet at this point, so we use a generous one-year window — clampEvents
    // trims to 50 anyway.
    const eventsEnd = format(subDays(today, -365), 'yyyy-MM-dd');

    // Phase 16 D-12: campaign_calendar window — 90d back to eventsEnd. Pre-filter
    // before clampEvents to keep payload bounded; clampEvents priority 5 still trims.
    const campaignsStart = format(subDays(today, 90), 'yyyy-MM-dd');

    const [forecastRows, holidayRows, schoolRows, recurRows, transitRows, pipelineRows, campaignRows] = await Promise.all([
      fetchAll<ForecastViewRow>(() =>
        locals.supabase
          .from('forecast_with_actual_v')
          .select('target_date,model_name,granularity,yhat,yhat_lower,yhat_upper,horizon_days,actual_value,forecast_track,kpi_name')
          .eq('kpi_name', kpi)
          .eq('forecast_track', 'bau')
          .eq('granularity', granularity)
          .order('target_date', { ascending: true })
      ),
      fetchAll<HolidayRow>(() =>
        locals.supabase
          .from('holidays')
          .select('date,name,country_code,subdiv_code')
          .gte('date', todayStr)
          .lte('date', eventsEnd)
          .or('subdiv_code.is.null,subdiv_code.eq.BE')
      ),
      fetchAll<SchoolHolidayRow>(() =>
        locals.supabase
          .from('school_holidays')
          .select('state_code,block_name,start_date,end_date')
          .eq('state_code', 'BE')
          .gte('start_date', todayStr)
          .lte('start_date', eventsEnd)
      ),
      fetchAll<RecurringEventRow>(() =>
        locals.supabase
          .from('recurring_events')
          .select('event_id,name,start_date,end_date,impact_estimate')
          .gte('start_date', todayStr)
          .lte('start_date', eventsEnd)
      ),
      fetchAll<TransitAlertRow>(() =>
        locals.supabase
          .from('transit_alerts')
          .select('alert_id,title,pub_date,matched_keyword')
          .gte('pub_date', todayStr)
          .lte('pub_date', eventsEnd)
      ),
      fetchAll<PipelineRunRow>(() =>
        locals.supabase
          .from('pipeline_runs_status_v')
          .select('step_name,status,finished_at')
          .eq('status', 'success')
          .order('finished_at', { ascending: false })
      ),
      fetchAll<CampaignRow>(() =>
        locals.supabase
          .from('campaign_calendar')
          .select('campaign_id,start_date,name')
          .gte('start_date', campaignsStart)
          .lte('start_date', eventsEnd)
      )
    ]);

    // Backtest actuals from kpi_daily_v. Anchor on the latest forecast row
    // that has an actual_value (= last business day fully observed by the
    // model). If forecastRows is empty (cold start), fall back to "yesterday"
    // so we still ship a reasonable window.
    const lastActualDate = forecastRows.reduce(
      (mx, r) => (r.actual_value !== null && r.target_date > mx) ? r.target_date : mx,
      '0000-01-01'
    );
    const lastActual = lastActualDate === '0000-01-01'
      ? subDays(today, 1)
      : new Date(lastActualDate + 'T00:00:00Z');
    const btStart = format(backtestStart(lastActual, granularity), 'yyyy-MM-dd');

    const actualsRows = await fetchAll<DailyKpiRow>(() =>
      locals.supabase
        .from('kpi_daily_v')
        .select('business_date,revenue_cents,tx_count')
        .gte('business_date', btStart)
        .order('business_date', { ascending: true })
    );

    // 16.2 hotfix: aggregate actuals to match `granularity`. kpi_daily_v is
    // always daily; without this aggregation, week/month forecast Splines
    // (one point per week/month at ~weekly/monthly totals) plotted alongside
    // daily actuals (one point per day at ~daily values) appear visually
    // compressed against the y-axis — owner reported on 2026-05-05 that
    // weekly aggregation tooltips read €4680 but the plotted spike sat
    // below the €2000 y-tick because actuals were per-day.
    const bucketKey = (date: string): string => {
      if (granularity === 'day') return date;
      const d = parseISO(date);
      const anchor = granularity === 'week'
        ? startOfWeek(d, { weekStartsOn: 1 })  // ISO Monday — matches dashboardStore.bucketKey
        : startOfMonth(d);
      return format(anchor, 'yyyy-MM-dd');
    };
    const bucketed = new Map<string, { revenue_cents: number; tx_count: number }>();
    for (const r of actualsRows) {
      const key = bucketKey(r.business_date);
      const existing = bucketed.get(key);
      if (existing) {
        existing.revenue_cents += r.revenue_cents;
        existing.tx_count += r.tx_count;
      } else {
        bucketed.set(key, { revenue_cents: r.revenue_cents, tx_count: r.tx_count });
      }
    }
    const actuals = Array.from(bucketed.entries())
      .map(([date, sums]) => ({
        date,
        value: kpi === 'revenue_eur' ? sums.revenue_cents / 100 : sums.tx_count
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Sibling events array — Phase 16 D-12 adds 5th source (campaign_start).
    // EventMarker.svelte already supports campaign_start (red 3px line, C-09).
    // clampEvents priority 5 already covers campaign_start (Phase 15 carry-forward).
    const events: ForecastEvent[] = [
      ...holidayRows .map((h) => ({ type: 'holiday' as const,         date: h.date,       label: h.name })),
      ...schoolRows  .map((s) => ({ type: 'school_holiday' as const,  date: s.start_date, label: s.block_name, end_date: s.end_date })),
      ...recurRows   .map((r) => ({ type: 'recurring_event' as const, date: r.start_date, label: r.name })),
      ...transitRows .map((t) => ({ type: 'transit_strike' as const,  date: t.pub_date.slice(0, 10), label: t.title })),
      ...campaignRows.map((c) => ({ type: 'campaign_start' as const,  date: c.start_date, label: c.name ?? c.campaign_id }))
    ];

    // Latest forecast pipeline run feeds last_run — preserved from v1.
    // We pick max(finished_at) defensively rather than trusting .order() —
    // the wrapper view can return ties and null finished_at rows for in-flight runs.
    let last_run: string | null = null;
    for (const p of pipelineRows) {
      if (!p.finished_at) continue;
      if (!(p.step_name === 'forecast_sarimax' || p.step_name.startsWith('forecast_'))) continue;
      if (last_run === null || p.finished_at > last_run) last_run = p.finished_at;
    }

    return json(
      {
        rows: forecastRows.map((r) => ({
          target_date: r.target_date,
          model_name: r.model_name,
          yhat_mean: r.yhat,
          yhat_lower: r.yhat_lower,
          yhat_upper: r.yhat_upper,
          horizon_days: r.horizon_days
        })),
        actuals,
        events: clampEvents(events, 50),
        last_run,
        kpi,
        granularity
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[/api/forecast]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
