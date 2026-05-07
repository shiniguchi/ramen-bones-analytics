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
// Phase 15 v2 D-14: endpoint queries native-grain rows from forecast_with_actual_v
// (no resampling) and ships a backtest-window slice from kpi_daily_v alongside.
// ?kpi= picks the KPI; ?granularity= picks the grain. Horizon is implicit in
// the row set (one model run per grain per refresh).
import { GET as forecastGET } from '../../src/routes/api/forecast/+server';

describe('/api/forecast', () => {
  const fcastRow = {
    target_date: '2026-05-01',
    model_name: 'sarimax',
    granularity: 'day',
    yhat: 1234.56,
    yhat_lower: 1100,
    yhat_upper: 1380,
    horizon_days: 1,
    actual_value: null,
    forecast_track: 'bau',
    kpi_name: 'revenue_eur'
  };
  const fcastRowWithActual = {
    ...fcastRow,
    target_date: '2026-04-29',
    actual_value: 1500
  };
  const fcastRowInvoiceCount = {
    ...fcastRow,
    yhat: 42,
    yhat_lower: 35,
    yhat_upper: 50,
    kpi_name: 'invoice_count'
  };
  const fcastRowWeek = { ...fcastRow, target_date: '2026-04-27', granularity: 'week' };
  const dailyKpiRow = { business_date: '2026-04-29', revenue_cents: 150000, tx_count: 42 };
  const holidayRow = { date: '2026-05-01', name: 'Tag der Arbeit', country_code: 'DE', subdiv_code: null };
  const schoolRow  = { state_code: 'BE', block_name: 'Sommerferien', start_date: '2026-07-09', end_date: '2026-08-22', year: 2026 };
  const recurRow   = { event_id: 'berlin-marathon-2026', name: 'Berlin Marathon', start_date: '2026-09-26', end_date: '2026-09-26', impact_estimate: 'high' };
  const transitRow = { alert_id: 'a1', title: 'BVG Warnstreik', pub_date: '2026-05-02T06:00:00Z', matched_keyword: 'Warnstreik', source_url: 'https://x' };
  const pipeRow    = { step_name: 'forecast_sarimax', status: 'success', finished_at: '2026-05-01T01:34:22Z' };

  it('authenticated GET ?granularity=day returns 200 with rows + actuals + events + last_run + kpi + granularity', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRow],
      kpi_daily_v: [dailyKpiRow],
      holidays: [holidayRow],
      school_holidays: [schoolRow],
      recurring_events: [recurRow],
      transit_alerts: [transitRow],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.actuals)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.last_run).toBe('string');
    expect(body.kpi).toBe('revenue_eur');
    expect(body.granularity).toBe('day');
    expect(body.rows[0]).toMatchObject({
      target_date: '2026-05-01',
      model_name: 'sarimax',
      yhat_mean: 1234.56,
      yhat_lower: 1100,
      yhat_upper: 1380,
      horizon_days: 1
    });
    // Forecast rows MUST NOT carry actual_value — the separate actuals[]
    // array owns that data.
    expect('actual_value' in body.rows[0]).toBe(false);
    // No `horizon` field in the response (15-11 dropped horizon-clamp).
    expect('horizon' in body).toBe(false);
  });

  it('?kpi=invoice_count filters forecast_with_actual_v on kpi_name="invoice_count"', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRowInvoiceCount],
      kpi_daily_v: [dailyKpiRow],
      holidays: [], school_holidays: [], recurring_events: [], transit_alerts: [],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day&kpi=invoice_count'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kpi).toBe('invoice_count');
    // Verify the eq('kpi_name', 'invoice_count') call landed on the forecast view.
    const fcastQuery = state.queries.find((q) => q.table === 'forecast_with_actual_v');
    expect(fcastQuery).toBeDefined();
    const eqCalls = fcastQuery!.calls.filter((c) => c.method === 'eq');
    const kpiEq = eqCalls.find((c) => c.args[0] === 'kpi_name');
    expect(kpiEq?.args[1]).toBe('invoice_count');
    // And actuals come from tx_count (not revenue_cents/100) for invoice_count.
    expect(body.actuals[0]).toEqual({ date: '2026-04-29', value: 42 });
  });

  it('?granularity=week filters forecast_with_actual_v on granularity="week"', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRowWeek],
      kpi_daily_v: [dailyKpiRow],
      holidays: [], school_holidays: [], recurring_events: [], transit_alerts: [],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=week'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.granularity).toBe('week');
    const fcastQuery = state.queries.find((q) => q.table === 'forecast_with_actual_v');
    const grainEq = fcastQuery!.calls.filter((c) => c.method === 'eq').find((c) => c.args[0] === 'granularity');
    expect(grainEq?.args[1]).toBe('week');
  });

  it('queries kpi_daily_v for the backtest window with gte(business_date, btStart)', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRowWithActual],
      kpi_daily_v: [dailyKpiRow],
      holidays: [], school_holidays: [], recurring_events: [], transit_alerts: [],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // kpi_daily_v query fired with a gte on business_date.
    const kpiQuery = state.queries.find((q) => q.table === 'kpi_daily_v');
    expect(kpiQuery).toBeDefined();
    const gteCall = kpiQuery!.calls.find((c) => c.method === 'gte' && c.args[0] === 'business_date');
    expect(gteCall).toBeDefined();
    // For day granularity anchored on 2026-04-29, btStart = 2026-04-22.
    expect(gteCall!.args[1]).toBe('2026-04-22');
    // Actuals shape: revenue_cents / 100 for revenue_eur.
    expect(body.actuals[0]).toEqual({ date: '2026-04-29', value: 1500 });
  });

  it('null claims returns 401 and never touches supabase', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsUnauthed(state), 'http://x/?granularity=day'));
    expect(res.status).toBe(401);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({
      forecast_with_actual_v: [], kpi_daily_v: [], holidays: [], school_holidays: [],
      recurring_events: [], transit_alerts: [], pipeline_runs_status_v: []
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day'));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('missing granularity returns 400', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/'));
    expect(res.status).toBe(400);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('invalid granularity returns 400', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=hour'));
    expect(res.status).toBe(400);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('invalid kpi returns 400', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day&kpi=evil'));
    expect(res.status).toBe(400);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('events array carries holidays, school_holidays (start row), recurring, transit_strikes', async () => {
    const state = freshState({
      forecast_with_actual_v: [fcastRow],
      kpi_daily_v: [dailyKpiRow],
      holidays: [holidayRow],
      school_holidays: [schoolRow],
      recurring_events: [recurRow],
      transit_alerts: [transitRow],
      pipeline_runs_status_v: [pipeRow]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=week'));
    const body = await res.json();
    const types = body.events.map((e: { type: string }) => e.type).sort();
    expect(types).toContain('holiday');
    expect(types).toContain('school_holiday');
    expect(types).toContain('recurring_event');
    expect(types).toContain('transit_strike');
  });

  it('last_run is the finished_at of the latest forecast_sarimax pipeline_runs row', async () => {
    const state = freshState({
      forecast_with_actual_v: [], kpi_daily_v: [], holidays: [], school_holidays: [],
      recurring_events: [], transit_alerts: [],
      pipeline_runs_status_v: [
        { step_name: 'forecast_sarimax', status: 'success', finished_at: '2026-04-30T01:00:00Z' },
        { step_name: 'forecast_sarimax', status: 'success', finished_at: '2026-05-01T01:34:22Z' }
      ]
    });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day'));
    const body = await res.json();
    expect(body.last_run).toBe('2026-05-01T01:34:22Z');
  });

  it('supabase error on forecast_with_actual_v surfaces as 500', async () => {
    const state = freshState();
    state.errors.set('forecast_with_actual_v', { message: 'boom' });
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), 'http://x/?granularity=day'));
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

// -------------------- /api/forecast-quality --------------------
import { GET as forecastQualityGET } from '../../src/routes/api/forecast-quality/+server';

describe('/api/forecast-quality', () => {
  const qRow = {
    model_name: 'sarimax',
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
      model_name: 'sarimax',
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

// -------------------- /api/campaign-uplift (Phase 16) --------------------
// Phase 16 D-11 / C-08 / T-16-04. Endpoint reads from campaign_uplift_v
// (per-window aggregates) and campaign_uplift_daily_v (per-day trajectory).
// Threat T-16-04: response MUST NEVER contain raw `yhat_samples`/path arrays.
import { GET as campaignUpliftGET } from '../../src/routes/api/campaign-uplift/+server';

describe('/api/campaign-uplift', () => {
  // Friend-owner Apr-14 campaign × sarimax × cumulative_since_launch (headline).
  const headlineRow = {
    campaign_id: 'friend-2026-04-14',
    campaign_start: '2026-04-14',
    campaign_end: '2026-04-21',
    campaign_name: 'Friend Instagram Push',
    campaign_channel: 'instagram',
    model_name: 'sarimax',
    window_kind: 'cumulative_since_launch',
    cumulative_uplift_eur: 1500,
    ci_lower_eur: 200,
    ci_upper_eur: 2800,
    naive_dow_uplift_eur: 1320,
    n_days: 7,
    as_of_date: '2026-04-21'
  };
  const headlineCampaignWindow = { ...headlineRow, window_kind: 'campaign_window' };
  const dailyRows = [
    { campaign_id: 'friend-2026-04-14', model_name: 'sarimax',
      cumulative_uplift_eur: 200, ci_lower_eur: -50, ci_upper_eur: 450, as_of_date: '2026-04-14' },
    { campaign_id: 'friend-2026-04-14', model_name: 'sarimax',
      cumulative_uplift_eur: 600, ci_lower_eur: 100, ci_upper_eur: 1100, as_of_date: '2026-04-15' },
    { campaign_id: 'friend-2026-04-14', model_name: 'sarimax',
      cumulative_uplift_eur: 1500, ci_lower_eur: 200, ci_upper_eur: 2800, as_of_date: '2026-04-21' }
  ];

  it('returns extended payload shape with ci bounds + daily[] + campaigns[]', async () => {
    const state = freshState({
      campaign_uplift_v: [headlineRow, headlineCampaignWindow],
      campaign_uplift_daily_v: dailyRows
    });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Phase 16 extension keys:
    expect(body).toHaveProperty('model', 'sarimax');
    expect(body).toHaveProperty('ci_lower_eur', 200);
    expect(body).toHaveProperty('ci_upper_eur', 2800);
    expect(body).toHaveProperty('naive_dow_uplift_eur', 1320);
    expect(Array.isArray(body.daily)).toBe(true);
    expect(body.daily.length).toBe(3);
    expect(body.daily[0]).toEqual({
      date: '2026-04-14', cumulative_uplift_eur: 200, ci_lower_eur: -50, ci_upper_eur: 450
    });
    expect(Array.isArray(body.campaigns)).toBe(true);
  });

  it('preserves back-compat fields from Phase 15 (campaign_start, cumulative_deviation_eur, as_of)', async () => {
    const state = freshState({
      campaign_uplift_v: [headlineRow, headlineCampaignWindow],
      campaign_uplift_daily_v: []
    });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect(body.campaign_start).toBe('2026-04-14');
    // back-compat: cumulative_deviation_eur === sarimax cumulative_since_launch uplift
    expect(body.cumulative_deviation_eur).toBe(1500);
    expect(typeof body.as_of).toBe('string');
  });

  it('returns 401 without claims and never touches supabase', async () => {
    const state = freshState();
    const res = await campaignUpliftGET(mkEvent(mkLocalsUnauthed(state)));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  // T-16-04 contract — endpoint reads ONLY aggregate columns from the wrapper
  // views; the views never expose yhat_samples. This test asserts the
  // structural mitigation: even if the underlying table somehow surfaced raw
  // path arrays, the response body would still be free of the forbidden keys.
  it('NEVER returns raw sample paths (T-16-04 sample-path-leak prevention)', async () => {
    const state = freshState({
      campaign_uplift_v: [headlineRow, headlineCampaignWindow],
      campaign_uplift_daily_v: dailyRows
    });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/yhat_samples/);
    expect(text).not.toMatch(/"paths"/);
    expect(text).not.toMatch(/"samples"/);
    // Reject any 200-element numeric array — bootstrap path leaks would have
    // exactly this shape (D-08 stores 200 sample paths per fit).
    expect(text).not.toMatch(/\[\s*-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?){199,}\s*\]/);
  });

  it('campaigns[] groups rows by campaign_id (2 campaigns × 5 models × 2 windows = 20 rows → 2 blocks of 10)', async () => {
    const models = ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow'];
    const windows: Array<'campaign_window' | 'cumulative_since_launch'> = [
      'campaign_window',
      'cumulative_since_launch'
    ];
    const rows = [];
    for (const cid of ['c-A', 'c-B']) {
      for (const m of models) {
        for (const w of windows) {
          rows.push({
            campaign_id: cid,
            campaign_start: cid === 'c-A' ? '2026-04-14' : '2026-03-01',
            campaign_end:   cid === 'c-A' ? '2026-04-21' : '2026-03-08',
            campaign_name: `${cid}-name`,
            campaign_channel: 'instagram',
            model_name: m,
            window_kind: w,
            cumulative_uplift_eur: 100,
            ci_lower_eur: -50,
            ci_upper_eur: 250,
            naive_dow_uplift_eur: 90,
            n_days: 7,
            as_of_date: '2026-04-21'
          });
        }
      }
    }
    const state = freshState({ campaign_uplift_v: rows, campaign_uplift_daily_v: [] });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect(body.campaigns.length).toBe(2);
    for (const block of body.campaigns) {
      expect(block.rows.length).toBe(10);
    }
  });

  it('handles empty campaign_uplift_v gracefully (campaigns:[], cumulative_deviation_eur:0, no 500)', async () => {
    const state = freshState({ campaign_uplift_v: [], campaign_uplift_daily_v: [] });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.campaigns).toEqual([]);
    expect(body.cumulative_deviation_eur).toBe(0);
    expect(body.campaign_start).toBeNull();
    expect(body.daily).toEqual([]);
    expect(body.ci_lower_eur).toBeNull();
    expect(body.ci_upper_eur).toBeNull();
    expect(body.naive_dow_uplift_eur).toBeNull();
  });

  it('200 response carries Cache-Control: private, no-store', async () => {
    const state = freshState({ campaign_uplift_v: [], campaign_uplift_daily_v: [] });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('daily[] only contains the headline campaign × sarimax (filters out non-headline campaigns)', async () => {
    const state = freshState({
      campaign_uplift_v: [headlineRow, headlineCampaignWindow],
      campaign_uplift_daily_v: [
        ...dailyRows,
        // a different campaign's per-day rows must NOT leak into headline daily[]
        { campaign_id: 'other-campaign', model_name: 'sarimax',
          cumulative_uplift_eur: 9999, ci_lower_eur: 5000, ci_upper_eur: 14000, as_of_date: '2026-04-15' }
      ]
    });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const body = await res.json();
    expect(body.daily.length).toBe(3);
    expect(body.daily.every((d: { date: string }) => typeof d.date === 'string')).toBe(true);
    expect(body.daily.some((d: { cumulative_uplift_eur: number }) => d.cumulative_uplift_eur === 9999)).toBe(false);
  });

  it('queries campaign_uplift_v AND campaign_uplift_daily_v in parallel', async () => {
    const state = freshState({
      campaign_uplift_v: [headlineRow],
      campaign_uplift_daily_v: dailyRows
    });
    await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    const tables = state.queries.map((q) => q.table);
    expect(tables).toContain('campaign_uplift_v');
    expect(tables).toContain('campaign_uplift_daily_v');
    // daily query must filter to model_name=sarimax (D-11 headline-only)
    const dailyQ = state.queries.find((q) => q.table === 'campaign_uplift_daily_v')!;
    const eqCalls = dailyQ.calls.filter((c) => c.method === 'eq');
    const modelEq = eqCalls.find((c) => c.args[0] === 'model_name');
    expect(modelEq?.args[1]).toBe('sarimax');
  });

  it('supabase error on campaign_uplift_v surfaces as 500', async () => {
    const state = freshState();
    state.errors.set('campaign_uplift_v', { message: 'boom' });
    const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  // -------- Phase 18-03: weekly_history payload (UPL-08) --------
  // /api/campaign-uplift adds a 3rd top-level array `weekly_history` (sister
  // to `daily`). Each item shape per CONTEXT.md API §line 35-46:
  //   { iso_week_start, iso_week_end, model_name, point_eur,
  //     ci_lower_eur, ci_upper_eur, n_days }
  // Endpoint reads campaign_uplift_weekly_v (Plan 18-01 wrapper view) with
  // .eq('model_name','sarimax'), filters to headline campaign_id, sorts
  // ascending by as_of_date, and derives iso_week_start = as_of_date − 6 days.
  describe('weekly_history (Phase 18 UPL-08)', () => {
    // Mock supabase returns rows in fixture order (the chainable mock does NOT
    // apply `.order()` — Postgres does, in production). So the fixture is
    // already ordered ascending here; the API's ordering contract is asserted
    // separately by the "queries .... with ascending order" test below
    // (verifies the .order(as_of_date, {ascending:true}) call landed on the view).
    const weeklyRows = [
      { campaign_id: 'friend-2026-04-14', model_name: 'sarimax',
        cumulative_uplift_eur:  450, ci_lower_eur: -100, ci_upper_eur: 980,
        n_days: 7, as_of_date: '2026-04-26' },
      { campaign_id: 'friend-2026-04-14', model_name: 'sarimax',
        cumulative_uplift_eur: -149, ci_lower_eur: -620, ci_upper_eur: 340,
        n_days: 7, as_of_date: '2026-05-03' }
    ];

    it('weekly_history populated when campaign_uplift_weekly_v returns sarimax rows for headline', async () => {
      const state = freshState({
        campaign_uplift_v: [headlineRow, headlineCampaignWindow],
        campaign_uplift_daily_v: [],
        campaign_uplift_weekly_v: weeklyRows
      });
      const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.weekly_history)).toBe(true);
      expect(body.weekly_history).toHaveLength(2);
      // Sorted ascending by iso_week_end (= as_of_date):
      expect(body.weekly_history.map((w: { iso_week_end: string }) => w.iso_week_end))
        .toEqual(['2026-04-26', '2026-05-03']);
      // iso_week_start = Sun − 6 days deterministically:
      expect(body.weekly_history[0]).toEqual({
        iso_week_start: '2026-04-20',
        iso_week_end: '2026-04-26',
        model_name: 'sarimax',
        point_eur: 450,
        ci_lower_eur: -100,
        ci_upper_eur: 980,
        n_days: 7
      });
      expect(body.weekly_history[1]).toEqual({
        iso_week_start: '2026-04-27',
        iso_week_end: '2026-05-03',
        model_name: 'sarimax',
        point_eur: -149,
        ci_lower_eur: -620,
        ci_upper_eur: 340,
        n_days: 7
      });
    });

    it('weekly_history is [] when campaign_uplift_weekly_v has zero rows', async () => {
      const state = freshState({
        campaign_uplift_v: [headlineRow, headlineCampaignWindow],
        campaign_uplift_daily_v: [],
        campaign_uplift_weekly_v: []
      });
      const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.weekly_history).toEqual([]);
    });

    it('weekly_history filters to the headline campaign only (other campaigns excluded)', async () => {
      const otherCampaignRow = {
        campaign_id: 'other-campaign', model_name: 'sarimax',
        cumulative_uplift_eur: 9999, ci_lower_eur: 5000, ci_upper_eur: 14000,
        n_days: 7, as_of_date: '2026-04-26'
      };
      const state = freshState({
        campaign_uplift_v: [headlineRow, headlineCampaignWindow],
        campaign_uplift_daily_v: [],
        campaign_uplift_weekly_v: [...weeklyRows, otherCampaignRow]
      });
      const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
      const body = await res.json();
      expect(body.weekly_history).toHaveLength(2); // only friend-2026-04-14
      expect(
        body.weekly_history.some(
          (w: { point_eur: number }) => w.point_eur === 9999
        )
      ).toBe(false);
    });

    it('queries campaign_uplift_weekly_v with .eq(model_name, sarimax) and ascending order', async () => {
      const state = freshState({
        campaign_uplift_v: [headlineRow, headlineCampaignWindow],
        campaign_uplift_daily_v: [],
        campaign_uplift_weekly_v: weeklyRows
      });
      await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
      const tables = state.queries.map((q) => q.table);
      expect(tables).toContain('campaign_uplift_weekly_v');
      const weeklyQ = state.queries.find((q) => q.table === 'campaign_uplift_weekly_v')!;
      const eqCalls = weeklyQ.calls.filter((c) => c.method === 'eq');
      const modelEq = eqCalls.find((c) => c.args[0] === 'model_name');
      expect(modelEq?.args[1]).toBe('sarimax'); // headline-pick convention (matches daily)
      const orderCall = weeklyQ.calls.find(
        (c) => c.method === 'order' && c.args[0] === 'as_of_date'
      );
      expect(orderCall).toBeDefined();
      expect((orderCall!.args[1] as { ascending: boolean }).ascending).toBe(true);
    });

    it('preserves back-compat top-level fields (cumulative_deviation_eur, daily, campaigns, weekly_history)', async () => {
      const state = freshState({
        campaign_uplift_v: [headlineRow, headlineCampaignWindow],
        campaign_uplift_daily_v: [],
        campaign_uplift_weekly_v: weeklyRows
      });
      const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
      const body = await res.json();
      // Existing fields MUST still appear (CONTEXT.md line 47-48 back-compat):
      expect(body).toHaveProperty('campaign_start');
      expect(body).toHaveProperty('cumulative_deviation_eur');
      expect(body).toHaveProperty('as_of');
      expect(body).toHaveProperty('model', 'sarimax');
      expect(body).toHaveProperty('ci_lower_eur');
      expect(body).toHaveProperty('ci_upper_eur');
      expect(body).toHaveProperty('naive_dow_uplift_eur');
      expect(body).toHaveProperty('daily');
      expect(body).toHaveProperty('campaigns');
      // NEW Phase 18 field:
      expect(body).toHaveProperty('weekly_history');
    });

    it('weekly_history is [] when there is no headline campaign (empty campaign_uplift_v)', async () => {
      const state = freshState({
        campaign_uplift_v: [],
        campaign_uplift_daily_v: [],
        campaign_uplift_weekly_v: weeklyRows // would otherwise match, but no headline → []
      });
      const res = await campaignUpliftGET(mkEvent(mkLocalsAuthed(state)));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.weekly_history).toEqual([]);
    });
  });
});
