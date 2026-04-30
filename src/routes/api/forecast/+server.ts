// src/routes/api/forecast/+server.ts
// Phase 15 D-06 / D-09 / D-11 / FUI-07.
// Deferred endpoint for RevenueForecastCard. Long-format rows + sibling
// events array + last_run timestamp. Server-side resampling per granularity
// per Phase 14 C-05 / D-04 (client never receives raw 200-path arrays).
//
// Auth: locals.safeGetSession() (canonical helper). RLS is enforced by
//   forecast_with_actual_v's WHERE clause (auth.jwt()->>'restaurant_id').
//   pipeline_runs_status_v applies its own caller-JWT row filter (Phase 13
//   migration 0049). Holidays / school_holidays / recurring_events /
//   transit_alerts are global tables (no tenant scoping needed; they're
//   public knowledge).
// Cache-Control: private, no-store — prevents CDN cross-tenant leakage.
// CF Pages 50-subrequest budget (Phase 11 D-06): this handler issues 6
//   parallel Supabase queries (~6 subrequests) — well under the cap.
//
// Validation: ?horizon= must be in {7,35,120,365}; ?granularity= must
//   pair legally per D-11. Illegal combos → 400 (no DB call).
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import {
  parseHorizon,
  parseGranularity,
  isValidCombo,
  DEFAULT_GRANULARITY,
  type Granularity
} from '$lib/forecastValidation';
import { resampleByGranularity, type ForecastRowDaily } from '$lib/forecastResampling';
import { clampEvents, type ForecastEvent } from '$lib/forecastEventClamp';
import { addDays, format } from 'date-fns';

type ForecastViewRow = {
  target_date: string;
  model_name: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
  horizon_days: number;
  actual_value: number | null;
  forecast_track: string;
  kpi_name: string;
};

type HolidayRow         = { date: string; name: string; country_code: string; subdiv_code: string | null };
type SchoolHolidayRow   = { state_code: string; block_name: string; start_date: string; end_date: string };
type RecurringEventRow  = { event_id: string; name: string; start_date: string; end_date: string; impact_estimate: string };
type TransitAlertRow    = { alert_id: string; title: string; pub_date: string; matched_keyword: string };
type PipelineRunRow     = { step_name: string; status: string; finished_at: string | null };

const NO_STORE: Record<string, string> = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals, url }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const horizon = parseHorizon(url.searchParams.get('horizon'));
  if (horizon === null) {
    return json({ error: 'invalid horizon (must be 7, 35, 120, or 365)' }, { status: 400, headers: NO_STORE });
  }
  const rawGran = url.searchParams.get('granularity');
  const granularity: Granularity =
    rawGran === null
      ? DEFAULT_GRANULARITY[horizon]
      : (parseGranularity(rawGran) ?? ('__INVALID__' as Granularity));
  if (!isValidCombo(horizon, granularity)) {
    return json(
      { error: `invalid (horizon=${horizon}, granularity=${rawGran}) combo per D-11 clamp` },
      { status: 400, headers: NO_STORE }
    );
  }

  // Window: today → today + horizon days. Use UTC for boundary stability.
  const today = format(new Date(), 'yyyy-MM-dd');
  const horizonEnd = format(addDays(new Date(), horizon), 'yyyy-MM-dd');

  try {
    const [forecastRows, holidayRows, schoolRows, recurRows, transitRows, pipelineRows] = await Promise.all([
      fetchAll<ForecastViewRow>(() =>
        locals.supabase
          .from('forecast_with_actual_v')
          .select('target_date,model_name,yhat,yhat_lower,yhat_upper,horizon_days,actual_value,forecast_track,kpi_name')
          .eq('kpi_name', 'revenue_eur')
          .eq('forecast_track', 'bau')
          .gte('target_date', today)
          .lte('target_date', horizonEnd)
          .order('target_date', { ascending: true })
      ),
      fetchAll<HolidayRow>(() =>
        locals.supabase
          .from('holidays')
          .select('date,name,country_code,subdiv_code')
          .gte('date', today)
          .lte('date', horizonEnd)
          .or('subdiv_code.is.null,subdiv_code.eq.BE')
      ),
      fetchAll<SchoolHolidayRow>(() =>
        locals.supabase
          .from('school_holidays')
          .select('state_code,block_name,start_date,end_date')
          .eq('state_code', 'BE')
          .gte('start_date', today)
          .lte('start_date', horizonEnd)
      ),
      fetchAll<RecurringEventRow>(() =>
        locals.supabase
          .from('recurring_events')
          .select('event_id,name,start_date,end_date,impact_estimate')
          .gte('start_date', today)
          .lte('start_date', horizonEnd)
      ),
      fetchAll<TransitAlertRow>(() =>
        locals.supabase
          .from('transit_alerts')
          .select('alert_id,title,pub_date,matched_keyword')
          .gte('pub_date', today)
          .lte('pub_date', horizonEnd)
      ),
      fetchAll<PipelineRunRow>(() =>
        locals.supabase
          .from('pipeline_runs_status_v')
          .select('step_name,status,finished_at')
          .eq('status', 'success')
          .order('finished_at', { ascending: false })
      )
    ]);

    // Map view rows -> daily-rate output shape (yhat -> yhat_mean).
    const dailyRows: ForecastRowDaily[] = forecastRows.map((r) => ({
      target_date: r.target_date,
      model_name: r.model_name,
      yhat_mean: r.yhat,
      yhat_lower: r.yhat_lower,
      yhat_upper: r.yhat_upper,
      horizon_days: r.horizon_days
    }));
    const rows = resampleByGranularity(dailyRows, granularity);

    // Merge actual_value back as a separate map keyed by target_date so the
    // client can render historical vs forecast on the same axis. The view's
    // actual_value is non-null only for past dates; future dates remain null.
    const actualByDate = new Map<string, number>();
    for (const r of forecastRows) {
      if (r.actual_value !== null && !actualByDate.has(r.target_date)) {
        actualByDate.set(r.target_date, r.actual_value);
      }
    }

    // Build events sibling array.
    const events: ForecastEvent[] = [
      ...holidayRows.map((h) => ({ type: 'holiday' as const,        date: h.date,       label: h.name })),
      ...schoolRows .map((s) => ({ type: 'school_holiday' as const, date: s.start_date, label: s.block_name, end_date: s.end_date })),
      ...recurRows  .map((r) => ({ type: 'recurring_event' as const, date: r.start_date, label: r.name })),
      ...transitRows.map((t) => ({ type: 'transit_strike' as const, date: t.pub_date.slice(0, 10), label: t.title }))
    ];

    // Latest forecast pipeline run feeds last_run. We pick max(finished_at)
    // defensively rather than trusting .order() — the wrapper view can return
    // ties and null finished_at rows for in-flight runs.
    let last_run: string | null = null;
    for (const p of pipelineRows) {
      if (!p.finished_at) continue;
      if (!(p.step_name === 'forecast_sarimax' || p.step_name.startsWith('forecast_'))) continue;
      if (last_run === null || p.finished_at > last_run) last_run = p.finished_at;
    }

    return json(
      {
        rows,
        actuals: Array.from(actualByDate, ([date, value]) => ({ date, value })),
        events: clampEvents(events, 50),
        last_run
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[/api/forecast]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
