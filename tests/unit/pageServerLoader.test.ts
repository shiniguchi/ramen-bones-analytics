// @vitest-environment node
// Plan 09-02 Task 1 — loader refactor integration test.
//
// Verifies that src/routes/+page.server.ts:
//  - returns dailyRows + priorDailyRows for client-side processing
//  - queries transactions_filterable_v (no server-side filter application)
//  - does NOT contain any queryKpi calls
//  - handles custom date ranges
//  - retains retention + insight queries
//
// Quick 260417-o8a Task 2 extended:
//  - Regression tests A/B/C pin the fetchAll pagination fix
import { describe, it, expect, beforeEach } from 'vitest';
import { load } from '../../src/routes/+page.server';

// -- Mock builder --
type Call = { method: string; args: unknown[] };
interface RecordedQuery {
  table: string;
  calls: Call[];
  result: { data: unknown; error: null };
}

interface MockState {
  queries: RecordedQuery[];
  canned: Map<string, unknown>;
  // Per-table error override for error isolation tests
  errors: Map<string, { message: string }>;
}

function makeSupabase(state: MockState) {
  const builder = (table: string): any => {
    const q: RecordedQuery = {
      table,
      calls: [],
      result: { data: state.canned.get(table) ?? [], error: null }
    };
    state.queries.push(q);

    const record = (method: string) =>
      (...args: unknown[]) => {
        q.calls.push({ method, args });
        return chain;
      };

    // .range() is called by fetchAll — returns a Promise with a data slice.
    // Supports pagination: slices the canned array using from/to bounds.
    // If the table has a forced error, returns { data: null, error } on first call.
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

    const chain: any = {
      select: record('select'),
      gte: record('gte'),
      lte: record('lte'),
      in: record('in'),
      eq: record('eq'),
      not: record('not'),
      order: record('order'),
      limit: record('limit'),
      range,
      maybeSingle: () => {
        q.calls.push({ method: 'maybeSingle', args: [] });
        const data = Array.isArray(q.result.data)
          ? (q.result.data as unknown[])[0] ?? null
          : q.result.data ?? null;
        return Promise.resolve({ data, error: null });
      },
      then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(q.result).then(resolve),
      catch: (_rej: unknown) => Promise.resolve(q.result)
    };
    return chain;
  };

  return {
    from: (table: string) => builder(table),
    auth: { signOut: async () => ({ error: null }) }
  };
}

function callsFor(state: MockState, table: string): RecordedQuery[] {
  return state.queries.filter(q => q.table === table);
}

// -- Fixtures --
function freshState(): MockState {
  const canned = new Map<string, unknown>([
    ['transactions_filterable_v', [
      { business_date: '2026-04-10', gross_cents: 1000, sales_type: 'INHOUSE', is_cash: false },
      { business_date: '2026-04-10', gross_cents: 2000, sales_type: 'TAKEAWAY', is_cash: true }
    ]],
    ['retention_curve_v', []],
    ['insights_v', []],
    ['data_freshness_v', [{ last_ingested_at: '2026-04-14T00:00:00Z' }]]
  ]);
  return { queries: [], canned, errors: new Map() };
}

function mkLocals(state: MockState) {
  return { supabase: makeSupabase(state) } as any;
}

// -- Tests --
describe('+page.server load — Phase 9 simplified loader', () => {
  let state: MockState;
  beforeEach(() => {
    state = freshState();
  });

  it('returns dailyRows and priorDailyRows instead of kpi object', async () => {
    const data: any = await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(data.dailyRows).toBeDefined();
    expect(Array.isArray(data.dailyRows)).toBe(true);
    expect(data.priorDailyRows).toBeDefined();
    expect(Array.isArray(data.priorDailyRows)).toBe(true);
    // Old kpi object should not exist
    expect(data.kpi).toBeUndefined();
    expect(data.distinctSalesTypes).toBeUndefined();
    expect(data.distinctPaymentMethods).toBeUndefined();
  });

  it('does NOT query kpi_daily_v (no fixed-tile KPI queries)', async () => {
    await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const kpiQueries = callsFor(state, 'kpi_daily_v');
    expect(kpiQueries.length).toBe(0);
  });

  it('queries transactions_filterable_v with is_cash in select', async () => {
    await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const filterable = callsFor(state, 'transactions_filterable_v');
    expect(filterable.length).toBeGreaterThanOrEqual(1);
    // Phase 11-01 D-01 added an earliestBusinessDate query against
    // transactions_filterable_v (SELECT business_date .order().limit(1)) BEFORE
    // the dailyRows query. Find the query whose select includes is_cash — that
    // is the one feeding the dashboard render.
    const hasIsCashSelect = filterable.some((q) =>
      q.calls.some(
        (c) => c.method === 'select' && String(c.args[0]).includes('is_cash')
      )
    );
    expect(hasIsCashSelect).toBe(true);
  });

  it('does NOT apply sales_type or is_cash server-side WHERE clauses', async () => {
    await load({
      url: new URL('http://x/?sales_type=INHOUSE&is_cash=cash'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const filterable = callsFor(state, 'transactions_filterable_v');
    const anyIn = filterable.some(q =>
      q.calls.some(c => c.method === 'in')
    );
    expect(anyIn).toBe(false);
  });

  it('custom date range uses literal dates for chip window', async () => {
    await load({
      url: new URL('http://x/?range=custom&from=2026-04-01&to=2026-04-15'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const filterable = callsFor(state, 'transactions_filterable_v');
    const chipQ = filterable.find(q =>
      q.calls.some(c => c.method === 'gte') && q.calls.some(c => c.method === 'lte')
    );
    expect(chipQ).toBeDefined();
    const gte = chipQ!.calls.find(c => c.method === 'gte')!;
    const lte = chipQ!.calls.find(c => c.method === 'lte')!;
    expect(gte.args).toEqual(['business_date', '2026-04-01']);
    expect(lte.args).toEqual(['business_date', '2026-04-15']);
  });

  it('still queries insights_v (retention_curve_v moved to /api/retention in 11-02)', async () => {
    // Phase 11-02 D-03: retention_curve_v + retention_curve_monthly_v are now
    // fetched client-side via /api/retention when CohortRetentionCard scrolls
    // into view. The SSR-side invariant now is just: insights_v still queried.
    await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(callsFor(state, 'retention_curve_v').length).toBe(0);
    expect(callsFor(state, 'retention_curve_monthly_v').length).toBe(0);
    expect(callsFor(state, 'insights_v').length).toBe(1);
  });

  it('does NOT query the 5 deferred views (kpi_daily_v, customer_ltv_v, retention_curve_v/monthly_v, repeater lifetime)', async () => {
    // Phase 11-02 D-03: these 5 queries moved to /api/* endpoints.
    // The repeater-lifetime query was the .not('card_hash', 'is', null) query
    // against transactions_filterable_v; verify by scanning for a .not() call
    // on that table (present only in the lifetime repeater query, not in the
    // range-bounded dailyRows/priorDailyRows queries).
    await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(callsFor(state, 'kpi_daily_v').length).toBe(0);
    expect(callsFor(state, 'customer_ltv_v').length).toBe(0);
    expect(callsFor(state, 'retention_curve_v').length).toBe(0);
    expect(callsFor(state, 'retention_curve_monthly_v').length).toBe(0);

    const filterableCalls = callsFor(state, 'transactions_filterable_v');
    const hasNotCardHash = filterableCalls.some((q) =>
      q.calls.some(
        (c) =>
          c.method === 'not' &&
          String(c.args[0]) === 'card_hash' &&
          String(c.args[1]) === 'is'
      )
    );
    expect(hasNotCardHash).toBe(false);
  });
});

// -- Quick 260417-o8a Regression Tests --
// These fail if any of the four fetchAll-wrapped queries is reverted to an
// uncapped single .select(). See .planning/quick/260417-o8a for context.
describe('+page.server load — PostgREST 1000-row cap regression (260417-o8a)', () => {
  let state: MockState;
  beforeEach(() => {
    state = freshState();
  });

  it('Regression A: returns ALL rows when view yields 2500 (PostgREST cap regression)', async () => {
    // Seed 2500 rows — fetchAll must paginate: [0,999], [1000,1999], [2000,2999]
    const rows2500 = Array.from({ length: 2500 }, (_, i) => ({
      business_date: '2026-04-10',
      gross_cents: i * 100,
      sales_type: 'INHOUSE',
      is_cash: false,
      visit_seq: i + 1,
      card_hash: `h${i}`
    }));
    state.canned.set('transactions_filterable_v', rows2500);

    const data: any = await load({
      url: new URL('http://x/?range=all'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(data.dailyRows.length, [
      'If this fails, PostgREST 1000-row cap silently truncated',
      'transactions_filterable_v again — see .planning/quick/260417-o8a'
    ].join(' ')).toBe(2500);

    // fetchAll calls buildQuery() once per page — each page creates a fresh RecordedQuery.
    // Collect all .range() calls across all queries for this table and verify bounds.
    const filterable = callsFor(state, 'transactions_filterable_v');
    const allRangeCalls = filterable.flatMap(q =>
      q.calls.filter(c => c.method === 'range').map(c => c.args)
    );
    // Current window alone: 3 pages of 1000 (range=all spans the full dataset)
    // There may also be prior-window queries with their own range calls.
    // We only need to verify the three expected bounds appear in the call list.
    expect(allRangeCalls).toContainEqual([0, 999]);
    expect(allRangeCalls).toContainEqual([1000, 1999]);
    expect(allRangeCalls).toContainEqual([2000, 2999]);
  });

  it('Regression B: paginates every large-result SSR query (transactions_filterable_v only)', async () => {
    // Phase 11-02 D-03: customer_ltv_v moved to /api/customer-ltv.
    // Phase 19-02: item_counts_daily_v moved to /api/item-counts (deferred via LazyMount).
    // SSR now owns only transactions_filterable_v (dailyRows + priorDailyRows).
    // 2-row fixtures trigger 1 range call (short page = stop), confirming pagination is wired.
    await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    // transactions_filterable_v: range must appear (both current + prior windows)
    const filterableRangeCalls = callsFor(state, 'transactions_filterable_v').flatMap(q =>
      q.calls.filter(c => c.method === 'range')
    );
    expect(filterableRangeCalls.length, 'transactions_filterable_v must use .range() (pagination wired)').toBeGreaterThanOrEqual(1);

    // item_counts_daily_v moved to /api/item-counts — verify NOT queried from SSR.
    expect(callsFor(state, 'item_counts_daily_v').length).toBe(0);

    // customer_ltv_v moved to /api/customer-ltv — verify NOT queried from SSR.
    expect(callsFor(state, 'customer_ltv_v').length).toBe(0);
  });

  it('Regression C: per-card error isolation — item_counts_daily_v deferred to /api/item-counts (Phase 19-02)', async () => {
    // Phase 11-02 D-03: customer_ltv_v no longer queried from SSR.
    // Phase 19-02: item_counts_daily_v also moved off SSR → /api/item-counts.
    // Verify that even with a DB error for item_counts_daily_v, the SSR load resolves
    // and dailyRows still populate (SSR only owns transactions_filterable_v).
    state.errors.set('item_counts_daily_v', { message: 'boom' });

    // load() must resolve (not throw) — item_counts_daily_v is no longer in Promise.all
    const data: any = await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    // item_counts_daily_v not in SSR return — deferred to /api/item-counts
    expect(data.itemCounts).toBeUndefined();
    // dailyRows survive (transactions_filterable_v has no error)
    expect(Array.isArray(data.dailyRows)).toBe(true);
    expect(data.dailyRows.length).toBeGreaterThan(0);
  });
});
