// @vitest-environment node
// Phase 11-02 Task 2: unit tests for the 4 deferred /api/*/+server.ts endpoints.
//
// Covers the shared contract for every endpoint:
//   1. authenticated GET → 200 + expected row shape
//   2. null claims → 401 + NO supabase query fired
//   3. 200 response carries Cache-Control: private, no-store
//   4. supabase error → 500 (not silent empty)
//
// Plus endpoint-specific tests:
//   /api/retention — shape {weekly, monthly}, parallel round-trip
//   /api/repeater-lifetime — ?days= contract (absent/all/subset/invalid)
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hand-rolled chainable supabase mock (pattern from tests/unit/pageServerLoader.test.ts).
type Call = { method: string; args: unknown[] };
interface RecordedQuery {
  table: string;
  calls: Call[];
  result: { data: unknown; error: { message: string } | null };
}

interface MockState {
  queries: RecordedQuery[];
  canned: Map<string, unknown>;
  errors: Map<string, { message: string }>;
  fromSpy: ReturnType<typeof vi.fn>;
}

function makeSupabase(state: MockState) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (table: string): any => {
    const q: RecordedQuery = {
      table,
      calls: [],
      result: { data: state.canned.get(table) ?? [], error: null }
    };
    state.queries.push(q);

    const record =
      (method: string) =>
      (...args: unknown[]) => {
        q.calls.push({ method, args });
        return chain;
      };

    const range = (from: number, to: number) => {
      q.calls.push({ method: 'range', args: [from, to] });
      const forcedError = state.errors.get(table);
      if (forcedError) {
        return Promise.resolve({ data: null, error: forcedError });
      }
      const arr = Array.isArray(q.result.data) ? (q.result.data as unknown[]) : [];
      const slice = arr.slice(from, to + 1);
      return Promise.resolve({ data: slice, error: null });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: record('select'),
      gte: record('gte'),
      lte: record('lte'),
      in: record('in'),
      eq: record('eq'),
      not: record('not'),
      order: record('order'),
      limit: record('limit'),
      filter: record('filter'),
      or: record('or'),
      range,
      maybeSingle: () => {
        q.calls.push({ method: 'maybeSingle', args: [] });
        const data = Array.isArray(q.result.data)
          ? (q.result.data as unknown[])[0] ?? null
          : q.result.data ?? null;
        return Promise.resolve({ data, error: null });
      }
    };
    return chain;
  };

  // Wrap in a spy so tests can assert supabase.from was (or was NOT) called.
  state.fromSpy = vi.fn(builder);
  return { from: state.fromSpy };
}

function freshState(canned: Record<string, unknown> = {}): MockState {
  return {
    queries: [],
    canned: new Map(Object.entries(canned)),
    errors: new Map(),
    fromSpy: vi.fn()
  };
}

function mkLocalsAuthed(state: MockState) {
  const supabase = makeSupabase(state);
  return {
    supabase,
    safeGetSession: async () => ({
      session: {},
      user: {},
      claims: { restaurant_id: 'r1' }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function mkLocalsUnauthed(state: MockState) {
  const supabase = makeSupabase(state);
  return {
    supabase,
    safeGetSession: async () => ({
      session: null,
      user: null,
      claims: null
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkEvent(locals: any, urlStr = 'http://x/'): any {
  return { locals, url: new URL(urlStr) };
}

// -------------------- /api/kpi-daily --------------------
import { GET as kpiDailyGET } from '../../src/routes/api/kpi-daily/+server';

describe('/api/kpi-daily', () => {
  it('authenticated GET returns 200 + array of DailyKpiRow', async () => {
    const state = freshState({
      kpi_daily_v: [
        { business_date: '2026-04-14', revenue_cents: 6500, tx_count: 2 },
        { business_date: '2026-04-15', revenue_cents: 7300, tx_count: 3 }
      ]
    });
    const res = await kpiDailyGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toEqual({ business_date: '2026-04-14', revenue_cents: 6500, tx_count: 2 });
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const locals = mkLocalsUnauthed(state);
    const res = await kpiDailyGET(mkEvent(locals));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({ kpi_daily_v: [] });
    const res = await kpiDailyGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('supabase error surfaces as 500 (not silent empty)', async () => {
    const state = freshState();
    state.errors.set('kpi_daily_v', { message: 'boom' });
    const res = await kpiDailyGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/error/i);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

// -------------------- /api/customer-ltv --------------------
import { GET as customerLtvGET } from '../../src/routes/api/customer-ltv/+server';

describe('/api/customer-ltv', () => {
  const row = {
    card_hash: 'h1',
    revenue_cents: 1500,
    visit_count: 3,
    cohort_week: '2026-04-06',
    cohort_month: '2026-04-01'
  };

  it('authenticated GET returns 200 + array of CustomerLtvRow', async () => {
    const state = freshState({ customer_ltv_v: [row] });
    const res = await customerLtvGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toEqual(row);
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const locals = mkLocalsUnauthed(state);
    const res = await customerLtvGET(mkEvent(locals));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({ customer_ltv_v: [] });
    const res = await customerLtvGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('supabase error surfaces as 500 (not silent empty)', async () => {
    const state = freshState();
    state.errors.set('customer_ltv_v', { message: 'boom' });
    const res = await customerLtvGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/error/i);
  });
});

// -------------------- /api/retention --------------------
import { GET as retentionGET } from '../../src/routes/api/retention/+server';

describe('/api/retention', () => {
  const weeklyRow = {
    cohort_week: '2026-04-06',
    period_weeks: 1,
    retention_rate: 0.42,
    cohort_size_week: 10,
    cohort_age_weeks: 1
  };
  const monthlyRow = {
    cohort_month: '2026-04-01',
    period_months: 1,
    retention_rate: 0.38,
    cohort_size_month: 40,
    cohort_age_months: 1
  };

  it('authenticated GET returns 200 with {weekly, monthly} arrays', async () => {
    const state = freshState({
      retention_curve_v: [weeklyRow],
      retention_curve_monthly_v: [monthlyRow]
    });
    const res = await retentionGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.weekly)).toBe(true);
    expect(Array.isArray(body.monthly)).toBe(true);
    expect(body.weekly[0]).toEqual(weeklyRow);
    expect(body.monthly[0]).toEqual(monthlyRow);
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const locals = mkLocalsUnauthed(state);
    const res = await retentionGET(mkEvent(locals));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({
      retention_curve_v: [],
      retention_curve_monthly_v: []
    });
    const res = await retentionGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('supabase error surfaces as 500 (not silent empty)', async () => {
    const state = freshState();
    state.errors.set('retention_curve_v', { message: 'boom' });
    const res = await retentionGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/error/i);
  });

  it('weekly + monthly queries fire in parallel via Promise.all', async () => {
    const state = freshState({
      retention_curve_v: [weeklyRow],
      retention_curve_monthly_v: [monthlyRow]
    });
    await retentionGET(mkEvent(mkLocalsAuthed(state)));
    // Both tables should have been queried within the same handler call.
    // The order of state.queries[] reflects .from() call order — both must
    // appear before the handler returns (they do, because we await Promise.all).
    const tables = state.queries.map((q) => q.table);
    expect(tables).toContain('retention_curve_v');
    expect(tables).toContain('retention_curve_monthly_v');
  });

  it('shape test: body has weekly AND monthly keys, both arrays (Blocker #8)', async () => {
    const state = freshState({
      retention_curve_v: [],
      retention_curve_monthly_v: []
    });
    const res = await retentionGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect('weekly' in body).toBe(true);
    expect('monthly' in body).toBe(true);
    expect(Array.isArray(body.weekly)).toBe(true);
    expect(Array.isArray(body.monthly)).toBe(true);
  });
});

// -------------------- /api/repeater-lifetime --------------------
import { GET as repeaterGET } from '../../src/routes/api/repeater-lifetime/+server';

// Fixture rows carefully chosen so DOW is deterministic.
// ISO DOW: 1=Mon..7=Sun. Verified from the calendar:
//   2026-04-13 = Mon (DOW=1)
//   2026-04-14 = Tue (DOW=2)
//   2026-04-15 = Wed (DOW=3)
//   2026-04-16 = Thu (DOW=4)
//   2026-04-17 = Fri (DOW=5)
const REPEATER_ROWS = [
  { card_hash: 'h1', business_date: '2026-04-13', gross_cents: 100 }, // Mon=1
  { card_hash: 'h2', business_date: '2026-04-14', gross_cents: 200 }, // Tue=2
  { card_hash: 'h3', business_date: '2026-04-15', gross_cents: 300 }, // Wed=3
  { card_hash: 'h4', business_date: '2026-04-16', gross_cents: 400 }, // Thu=4
  { card_hash: 'h5', business_date: '2026-04-17', gross_cents: 500 }  // Fri=5
];

describe('/api/repeater-lifetime', () => {
  // ---- shared shape tests ----
  it('authenticated GET returns 200 + RepeaterTxRow[]', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(5);
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const locals = mkLocalsUnauthed(state);
    const res = await repeaterGET(mkEvent(locals));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({ transactions_filterable_v: [] });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('supabase error surfaces as 500 (not silent empty)', async () => {
    const state = freshState();
    state.errors.set('transactions_filterable_v', { message: 'boom' });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/error/i);
  });

  // ---- ?days= contract tests (Blocker #1 / D-03 literal) ----
  it('omitting ?days returns full lifetime payload (no DOW filter)', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state), 'http://x/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(5); // all rows returned
  });

  it('days=1,2,3,4,5,6,7 returns full lifetime payload (all days = no filter)', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(
      mkEvent(mkLocalsAuthed(state), 'http://x/?days=1,2,3,4,5,6,7')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(5);
  });

  it('days=2,4 applies DOW filter server-side — rows all have ISO DOW ∈ {2,4}', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state), 'http://x/?days=2,4'));
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any[] = await res.json();
    expect(body.length).toBe(2); // Tue + Thu only
    const dates = body.map((r) => r.business_date).sort();
    expect(dates).toEqual(['2026-04-14', '2026-04-16']);
  });

  it('days=8 is rejected with 400', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state), 'http://x/?days=8'));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    // supabase must not be called on invalid input
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('days=notacsv is rejected with 400', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state), 'http://x/?days=notacsv'));
    expect(res.status).toBe(400);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('days=0 is rejected with 400 (out-of-range low)', async () => {
    const state = freshState({ transactions_filterable_v: REPEATER_ROWS });
    const res = await repeaterGET(mkEvent(mkLocalsAuthed(state), 'http://x/?days=0'));
    expect(res.status).toBe(400);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });
});

// -------------------- /api/forecast --------------------
import { GET as forecastGET } from '../../src/routes/api/forecast/+server';

describe('/api/forecast', () => {
  const fcastRow = {
    target_date: '2026-05-01',
    model_name: 'sarimax_bau',
    yhat: 1234.56,
    yhat_lower: 1100,
    yhat_upper: 1380,
    horizon_days: 1,
    actual_value: null,
    forecast_track: 'bau',
    kpi_name: 'revenue_eur'
  };
  const holidayRow = { date: '2026-05-01', name: 'Tag der Arbeit', country_code: 'DE', subdiv_code: null };
  const schoolRow  = { state_code: 'BE', block_name: 'Sommerferien', start_date: '2026-07-09', end_date: '2026-08-22', year: 2026 };
  const recurRow   = { event_id: 'berlin-marathon-2026', name: 'Berlin Marathon', start_date: '2026-09-26', end_date: '2026-09-26', impact_estimate: 'high' };
  const transitRow = { alert_id: 'a1', title: 'BVG Warnstreik', pub_date: '2026-05-02T06:00:00Z', matched_keyword: 'Warnstreik', source_url: 'https://x' };
  const pipeRow    = { step_name: 'forecast_sarimax', status: 'success', finished_at: '2026-05-01T01:34:22Z' };

  it('authenticated GET ?horizon=7&granularity=day returns 200 with rows + events + last_run', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRow],
      holidays: [holidayRow],
      school_holidays: [schoolRow],
      recurring_events: [recurRow],
      transit_alerts: [transitRow],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=7&granularity=day'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.last_run).toBe('string');
    expect(body.rows[0]).toMatchObject({
      target_date: '2026-05-01',
      model_name: 'sarimax_bau',
      yhat_mean: 1234.56,
      yhat_lower: 1100,
      yhat_upper: 1380,
      horizon_days: 1
    });
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsUnauthed(state), 'http://x/?horizon=7&granularity=day'));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({
      forecast_with_actual_v: [], holidays: [], school_holidays: [],
      recurring_events: [], transit_alerts: [], pipeline_runs_status_v: []
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=7&granularity=day'));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('illegal combo (horizon=365 granularity=day) returns 400 and never touches supabase', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=365&granularity=day'));
    expect(res.status).toBe(400);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('missing horizon returns 400', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/'));
    expect(res.status).toBe(400);
  });

  it('omitted granularity falls back to DEFAULT_GRANULARITY for the horizon', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRow], holidays: [], school_holidays: [],
      recurring_events: [], transit_alerts: [], pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=7'));
    expect(res.status).toBe(200);
  });

  it('events array carries holidays, school_holidays (start row), recurring, transit_strikes', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRow],
      holidays: [holidayRow],
      school_holidays: [schoolRow],
      recurring_events: [recurRow],
      transit_alerts: [transitRow],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=120&granularity=week'));
    const body = await res.json();
    const types = body.events.map((e: { type: string }) => e.type).sort();
    expect(types).toContain('holiday');
    expect(types).toContain('school_holiday');
    expect(types).toContain('recurring_event');
    expect(types).toContain('transit_strike');
  });

  it('last_run is the finished_at of the latest forecast_sarimax pipeline_runs row', async () => {
    const state = freshState({
      forecast_with_actual_v: [], holidays: [], school_holidays: [],
      recurring_events: [], transit_alerts: [],
      pipeline_runs_status_v: [
        { step_name: 'forecast_sarimax', status: 'success', finished_at: '2026-04-30T01:00:00Z' },
        { step_name: 'forecast_sarimax', status: 'success', finished_at: '2026-05-01T01:34:22Z' }
      ]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=7&granularity=day'));
    const body = await res.json();
    expect(body.last_run).toBe('2026-05-01T01:34:22Z');
  });

  it('supabase error on forecast_with_actual_v surfaces as 500', async () => {
    const state = freshState();
    state.errors.set('forecast_with_actual_v', { message: 'boom' });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?horizon=7&granularity=day'));
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

// -------------------- /api/forecast-quality --------------------
import { GET as forecastQualityGET } from '../../src/routes/api/forecast-quality/+server';

describe('/api/forecast-quality', () => {
  const qRow = {
    model_name: 'sarimax_bau',
    kpi_name: 'revenue_eur',
    horizon_days: 7,
    rmse: 142.31,
    mape: 0.084,
    mean_bias: 12.5,
    direction_hit_rate: 0.71,
    evaluated_at: '2026-04-30T01:35:00Z',
    evaluation_window: 'last_7_days'
  };

  it('authenticated GET returns 200 + array of ForecastQualityRow filtered to last_7_days', async () => {
    const state = freshState({ forecast_quality: [qRow] });
    const res = await forecastQualityGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({
      model_name: 'sarimax_bau',
      kpi_name: 'revenue_eur',
      horizon_days: 7,
      rmse: 142.31,
      mape: 0.084,
      mean_bias: 12.5,
      direction_hit_rate: 0.71
    });
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const res = await forecastQualityGET(mkEvent(mkLocalsUnauthed(state)));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({ forecast_quality: [] });
    const res = await forecastQualityGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('supabase error surfaces as 500', async () => {
    const state = freshState();
    state.errors.set('forecast_quality', { message: 'boom' });
    const res = await forecastQualityGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
  });

  it('handler applies eq("evaluation_window", "last_7_days") so Phase 17 backtest rows are excluded', async () => {
    // The mock records every call to .eq() — we assert the handler asked for the right filter.
    const state = freshState({ forecast_quality: [qRow] });
    await forecastQualityGET(mkEvent(mkLocalsAuthed(state)));
    const call = state.queries[0].calls.find(c => c.method === 'eq' && (c.args[0] === 'evaluation_window'));
    expect(call).toBeDefined();
    expect(call?.args[1]).toBe('last_7_days');
  });

  it('returns empty array when no rows yet (D-07: 24h window after Phase 14 ships)', async () => {
    const state = freshState({ forecast_quality: [] });
    const res = await forecastQualityGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

// -------------------- /api/campaign-uplift --------------------
import { GET as campaignUpliftGET } from '../../src/routes/api/campaign-uplift/+server';

describe('/api/campaign-uplift', () => {
  // forecast_with_actual_v rows since CAMPAIGN_START (2026-04-14).
  // Σ(actual − yhat) = (1500-1400) + (1700-1600) + (1300-1500) = 0
  const upliftRows = [
    { target_date: '2026-04-14', model_name: 'sarimax_bau', kpi_name: 'revenue_eur',
      forecast_track: 'bau', yhat: 1400, yhat_lower: 1300, yhat_upper: 1500, actual_value: 1500 },
    { target_date: '2026-04-15', model_name: 'sarimax_bau', kpi_name: 'revenue_eur',
      forecast_track: 'bau', yhat: 1600, yhat_lower: 1500, yhat_upper: 1700, actual_value: 1700 },
    { target_date: '2026-04-16', model_name: 'sarimax_bau', kpi_name: 'revenue_eur',
      forecast_track: 'bau', yhat: 1500, yhat_lower: 1400, yhat_upper: 1600, actual_value: 1300 }
  ];

  it('authenticated GET returns 200 with {campaign_start, cumulative_deviation_eur, as_of}', async () => {
    const state = freshState({ forecast_with_actual_v: upliftRows });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaign_start).toBe('2026-04-14');
    expect(body.cumulative_deviation_eur).toBeCloseTo(0, 6);
    expect(typeof body.as_of).toBe('string');
  });

  it('cumulative_deviation_eur sums (actual − yhat) across all rows since CAMPAIGN_START', async () => {
    const state = freshState({
      forecast_with_actual_v: [
        { ...upliftRows[0], actual_value: 1500, yhat: 1400 }, // +100
        { ...upliftRows[1], actual_value: 1500, yhat: 1700 }  // -200
      ]
    });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect(body.cumulative_deviation_eur).toBeCloseTo(-100, 6);
  });

  it('rows where actual_value is null (future dates) are excluded from the sum', async () => {
    const state = freshState({
      forecast_with_actual_v: [
        { ...upliftRows[0], actual_value: 1500, yhat: 1400 }, // +100
        { ...upliftRows[1], actual_value: null,  yhat: 1700 } // skipped
      ]
    });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect(body.cumulative_deviation_eur).toBeCloseTo(100, 6);
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const res = await campaignUpliftGET(mkEvent(mkLocalsUnauthed(state)));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({ forecast_with_actual_v: [] });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('handler applies kpi_name=revenue_eur, forecast_track=bau, model_name=sarimax_bau, gte target_date', async () => {
    const state = freshState({ forecast_with_actual_v: upliftRows });
    await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const eqCalls = state.queries[0].calls.filter(c => c.method === 'eq');
    const eqMap = Object.fromEntries(eqCalls.map(c => [c.args[0] as string, c.args[1]]));
    expect(eqMap).toMatchObject({
      kpi_name: 'revenue_eur',
      forecast_track: 'bau',
      model_name: 'sarimax_bau'
    });
    const gteCall = state.queries[0].calls.find(c => c.method === 'gte');
    expect(gteCall?.args).toEqual(['target_date', '2026-04-14']);
  });

  it('zero rows since campaign-start returns 0 deviation, not null', async () => {
    const state = freshState({ forecast_with_actual_v: [] });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect(body.cumulative_deviation_eur).toBe(0);
  });

  it('supabase error surfaces as 500', async () => {
    const state = freshState();
    state.errors.set('forecast_with_actual_v', { message: 'boom' });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
  });
});
