// @vitest-environment node
// Plan 09-02 Task 1 — loader refactor integration test.
//
// Verifies that src/routes/+page.server.ts:
//  - returns dailyRows + priorDailyRows for client-side processing
//  - queries transactions_filterable_v (no server-side filter application)
//  - does NOT contain any queryKpi calls
//  - handles custom date ranges
//  - retains retention + insight queries
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

    const chain: any = {
      select: record('select'),
      gte: record('gte'),
      lte: record('lte'),
      in: record('in'),
      eq: record('eq'),
      not: record('not'),
      order: record('order'),
      limit: record('limit'),
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
  return { queries: [], canned };
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
    // Check select includes is_cash
    const selectCall = filterable[0].calls.find(c => c.method === 'select');
    expect(selectCall).toBeDefined();
    expect(String(selectCall!.args[0])).toContain('is_cash');
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

  it('still queries retention_curve_v and insights_v', async () => {
    await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(callsFor(state, 'retention_curve_v').length).toBe(1);
    expect(callsFor(state, 'insights_v').length).toBe(1);
  });
});
