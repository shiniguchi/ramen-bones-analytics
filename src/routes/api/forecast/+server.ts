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
// CF Pages 50-subrequest budget: 7 parallel Supabase queries — well under cap.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import { parseGranularity, type Granularity } from '$lib/forecastValidation';
import { clampEvents, type ForecastEvent } from '$lib/forecastEventClamp';
import { format, subDays, subMonths, startOfWeek, startOfMonth } from 'date-fns';

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

    const [forecastRows, holidayRows, schoolRows, recurRows, transitRows, pipelineRows] = await Promise.all([
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

    const actuals = actualsRows.map((r) => ({
      date: r.business_date,
      value: kpi === 'revenue_eur' ? r.revenue_cents / 100 : r.tx_count
    }));

    // Sibling events array — preserved verbatim from v1.
    const events: ForecastEvent[] = [
      ...holidayRows.map((h) => ({ type: 'holiday' as const,         date: h.date,       label: h.name })),
      ...schoolRows .map((s) => ({ type: 'school_holiday' as const,  date: s.start_date, label: s.block_name, end_date: s.end_date })),
      ...recurRows  .map((r) => ({ type: 'recurring_event' as const, date: r.start_date, label: r.name })),
      ...transitRows.map((t) => ({ type: 'transit_strike' as const,  date: t.pub_date.slice(0, 10), label: t.title }))
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
