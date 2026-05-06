// @vitest-environment node
// Phase 16.3-05: /api/forecast accepts optional ?range_start=YYYY-MM-DD (D-01).
//
// Validation gate (BEFORE any DB query):
//   - omitted / empty → defaults to today (existing behavior preserved)
//   - malformed (not YYYY-MM-DD)         → 400 "range_start must be YYYY-MM-DD"
//   - parseable-but-invalid (e.g. 2025-13-99) → 400 "range_start must be YYYY-MM-DD"
//   - future date (range_start > today)  → 400 "range_start must be ≤ today"
//
// When valid + supplied:
//   - lower bound on holidays.date / school_holidays.start_date /
//     recurring_events.start_date / transit_alerts.pub_date is range_start
//     (was todayStr).
//   - campaign_calendar.start_date lower bound = min(range_start, today-90d).
//
// When omitted:
//   - 5 events queries lower-bound contract is byte-identical to pre-edit
//     (todayStr for the 4 event tables; today-90d for campaign_calendar).
//
// Untouched (regression guard):
//   - forecast_with_actual_v query
//   - kpi_daily_v actuals query
//   - clampEvents(events, 50)
//   - Cache-Control: private, no-store
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { format, subDays } from 'date-fns';

// ---- Hand-rolled chainable supabase mock (mirrors apiEndpoints.test.ts) ----
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
      range
    };
    return chain;
  };
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mkEvent(locals: any, urlStr: string): any {
  return { locals, url: new URL(urlStr) };
}

// Helper: extract gte() args for a given table
function gteArgsFor(state: MockState, table: string): unknown[][] {
  const q = state.queries.find((qq) => qq.table === table);
  if (!q) return [];
  return q.calls.filter((c) => c.method === 'gte').map((c) => c.args);
}

// ---- import the route under test ----
import { GET as forecastGET } from '../../src/routes/api/forecast/+server';

const BASE = 'http://x/api/forecast?kpi=revenue_eur&granularity=day';

describe('/api/forecast ?range_start= validation gate (Phase 16.3-05 D-01)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('rejects malformed range_start (not YYYY-MM-DD) with 400 — never queries supabase', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=garbage`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/range_start must be YYYY-MM-DD/);
    expect(state.fromSpy).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects parseable-but-invalid range_start (e.g. 2025-13-99) with 400', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=2025-13-99`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/range_start must be YYYY-MM-DD/);
    expect(state.fromSpy).not.toHaveBeenCalled();
  });

  it('rejects future range_start (> today) with 400 — never queries supabase', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=2099-01-01`));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/range_start must be ≤ today/);
    expect(state.fromSpy).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('treats empty range_start= as omitted (200, default lower bound = today)', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=`));
    expect(res.status).toBe(200);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const holidayGteArgs = gteArgsFor(state, 'holidays');
    expect(holidayGteArgs.some((a) => a[0] === 'date' && a[1] === todayStr)).toBe(true);
  });
});

describe('/api/forecast ?range_start= threads through events queries', () => {
  it('omitted range_start → events queries gte == todayStr (existing behavior)', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), BASE));
    expect(res.status).toBe(200);

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    expect(gteArgsFor(state, 'holidays').some((a) => a[0] === 'date' && a[1] === todayStr)).toBe(true);
    expect(
      gteArgsFor(state, 'school_holidays').some((a) => a[0] === 'start_date' && a[1] === todayStr)
    ).toBe(true);
    expect(
      gteArgsFor(state, 'recurring_events').some((a) => a[0] === 'start_date' && a[1] === todayStr)
    ).toBe(true);
    expect(
      gteArgsFor(state, 'transit_alerts').some((a) => a[0] === 'pub_date' && a[1] === todayStr)
    ).toBe(true);

    // campaign_calendar default = today - 90d
    const campaigns90 = format(subDays(new Date(), 90), 'yyyy-MM-dd');
    expect(
      gteArgsFor(state, 'campaign_calendar').some(
        (a) => a[0] === 'start_date' && a[1] === campaigns90
      )
    ).toBe(true);
  });

  it('valid range_start (≤ today) → 4 events queries swap gte to range_start', async () => {
    const state = freshState();
    // Use a clearly-past date to make assertion deterministic
    const rangeStart = '2025-06-11';
    const res = await forecastGET(
      mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=${rangeStart}`)
    );
    expect(res.status).toBe(200);

    expect(gteArgsFor(state, 'holidays').some((a) => a[0] === 'date' && a[1] === rangeStart)).toBe(
      true
    );
    expect(
      gteArgsFor(state, 'school_holidays').some(
        (a) => a[0] === 'start_date' && a[1] === rangeStart
      )
    ).toBe(true);
    expect(
      gteArgsFor(state, 'recurring_events').some(
        (a) => a[0] === 'start_date' && a[1] === rangeStart
      )
    ).toBe(true);
    expect(
      gteArgsFor(state, 'transit_alerts').some((a) => a[0] === 'pub_date' && a[1] === rangeStart)
    ).toBe(true);
  });

  it('valid range_start older than today-90d → campaign_calendar widens to range_start', async () => {
    const state = freshState();
    const rangeStart = '2024-01-01'; // far older than today - 90d
    const res = await forecastGET(
      mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=${rangeStart}`)
    );
    expect(res.status).toBe(200);
    expect(
      gteArgsFor(state, 'campaign_calendar').some(
        (a) => a[0] === 'start_date' && a[1] === rangeStart
      )
    ).toBe(true);
  });

  it('valid range_start within last 90d → campaign_calendar lower bound stays today-90d', async () => {
    const state = freshState();
    // Within last 90d: today - 30d
    const rangeStart = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const expectedCampaigns = format(subDays(new Date(), 90), 'yyyy-MM-dd');
    const res = await forecastGET(
      mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=${rangeStart}`)
    );
    expect(res.status).toBe(200);
    expect(
      gteArgsFor(state, 'campaign_calendar').some(
        (a) => a[0] === 'start_date' && a[1] === expectedCampaigns
      )
    ).toBe(true);
  });

  it('regression: forecast_with_actual_v query unchanged (no gte by date)', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=2025-06-11`));
    expect(res.status).toBe(200);
    const fcQ = state.queries.find((q) => q.table === 'forecast_with_actual_v');
    expect(fcQ).toBeDefined();
    // forecast_with_actual_v filters by kpi_name / forecast_track / granularity ONLY
    const gteCalls = fcQ!.calls.filter((c) => c.method === 'gte');
    expect(gteCalls).toHaveLength(0);
  });

  it('regression: kpi_daily_v actuals window driven by backtestStart, NOT range_start', async () => {
    const state = freshState();
    const rangeStart = '2024-01-01';
    const res = await forecastGET(
      mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=${rangeStart}`)
    );
    expect(res.status).toBe(200);
    const kpiQ = state.queries.find((q) => q.table === 'kpi_daily_v');
    expect(kpiQ).toBeDefined();
    const gteCalls = kpiQ!.calls.filter((c) => c.method === 'gte');
    // Should have a single gte('business_date', <btStart>) where btStart != rangeStart.
    expect(gteCalls).toHaveLength(1);
    const arg = gteCalls[0].args;
    expect(arg[0]).toBe('business_date');
    expect(arg[1]).not.toBe(rangeStart);
  });

  it('200 response carries Cache-Control: private, no-store (regression)', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), BASE));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('400 (range_start invalid) also carries Cache-Control: private, no-store', async () => {
    const state = freshState();
    const res = await forecastGET(mkEvent(mkLocalsAuthed(state), `${BASE}&range_start=nope`));
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
