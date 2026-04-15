// @vitest-environment node
// Plan 06-03 Task 2 — loader refactor integration test.
//
// Verifies that src/routes/+page.server.ts:
//  - calls parseFilters(url) and honors sales_type/payment_method via .in()
//  - queries transactions_filterable_v for chip-scoped tiles
//  - leaves fixed-reference tiles (7d/30d/today) unscoped by the filters
//  - loads distinctSalesTypes / distinctPaymentMethods unfiltered (D-14)
//  - honors custom date range (?range=custom&from=&to=)
//
// Uses a hand-rolled chainable mock of `locals.supabase` that records every
// method call against every table so we can assert the query shape.
import { describe, it, expect, beforeEach } from 'vitest';
import { load } from '../../src/routes/+page.server';

// ── Mock builder ─────────────────────────────────────────────────────────
type Call = { method: string; args: unknown[] };
interface RecordedQuery {
  table: string;
  calls: Call[];
  result: { data: unknown; error: null };
}

interface MockState {
  queries: RecordedQuery[];
  /** Map of table name → canned data returned for the next query(ies). */
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
        // maybeSingle returns a thenable with { data, error } shape.
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

function hasCall(q: RecordedQuery, method: string, firstArg?: unknown): boolean {
  return q.calls.some(c =>
    c.method === method && (firstArg === undefined || c.args[0] === firstArg)
  );
}

// ── Fixtures ─────────────────────────────────────────────────────────────
function freshState(extra?: Partial<MockState['canned']>): MockState {
  const canned = new Map<string, unknown>([
    ['kpi_daily_v', []],
    ['transactions_filterable_v', [
      { business_date: '2026-04-10', gross_cents: 1000, sales_type: 'INHOUSE', payment_method: 'Bar' },
      { business_date: '2026-04-10', gross_cents: 2000, sales_type: 'TAKEAWAY', payment_method: 'Visa' }
    ]],
    ['retention_curve_v', []],
    ['ltv_v', []],
    ['frequency_v', []],
    ['new_vs_returning_v', []],
    ['insights_v', []],
    ['data_freshness_v', [{ last_ingested_at: '2026-04-14T00:00:00Z' }]]
  ]);
  if (extra) for (const [k, v] of Object.entries(extra)) canned.set(k, v);
  return { queries: [], canned };
}

function mkLocals(state: MockState) {
  return { supabase: makeSupabase(state) } as any;
}

// ── Tests ────────────────────────────────────────────────────────────────
describe('+page.server load — filter-aware refactor (Plan 06-03)', () => {
  let state: MockState;
  beforeEach(() => {
    state = freshState();
  });

  it('A: default URL — filters.range is 7d and no sales_type .in() is recorded', async () => {
    const data: any = await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(data.filters).toBeDefined();
    expect(data.filters.range).toBe('7d');

    const filterable = callsFor(state, 'transactions_filterable_v');
    const anySalesTypeIn = filterable.some(q =>
      q.calls.some(c => c.method === 'in' && c.args[0] === 'sales_type')
    );
    expect(anySalesTypeIn).toBe(false);
  });

  it('B: ?sales_type=INHOUSE records .in("sales_type", ["INHOUSE"]) on transactions_filterable_v', async () => {
    await load({
      url: new URL('http://x/?sales_type=INHOUSE'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const filterable = callsFor(state, 'transactions_filterable_v');
    const saltypeCall = filterable
      .flatMap(q => q.calls)
      .find(c => c.method === 'in' && c.args[0] === 'sales_type');
    expect(saltypeCall).toBeDefined();
    expect(saltypeCall!.args[1]).toEqual(['INHOUSE']);
  });

  it('C: ?payment_method=Visa,Bar records .in("payment_method", ["Visa","Bar"])', async () => {
    await load({
      url: new URL('http://x/?payment_method=Visa,Bar'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const filterable = callsFor(state, 'transactions_filterable_v');
    const pmCall = filterable
      .flatMap(q => q.calls)
      .find(c => c.method === 'in' && c.args[0] === 'payment_method');
    expect(pmCall).toBeDefined();
    expect(pmCall!.args[1]).toEqual(['Visa', 'Bar']);
  });

  it('D: ?range=custom&from=2026-04-01&to=2026-04-15 uses those literal dates for chip window', async () => {
    await load({
      url: new URL('http://x/?range=custom&from=2026-04-01&to=2026-04-15'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const filterable = callsFor(state, 'transactions_filterable_v');
    // Find the chip-scoped query: it has BOTH gte+lte (the two distinct-option
    // queries have neither).
    const chipQ = filterable.find(q =>
      q.calls.some(c => c.method === 'gte') && q.calls.some(c => c.method === 'lte')
    );
    expect(chipQ).toBeDefined();
    const gte = chipQ!.calls.find(c => c.method === 'gte')!;
    const lte = chipQ!.calls.find(c => c.method === 'lte')!;
    expect(gte.args).toEqual(['business_date', '2026-04-01']);
    expect(lte.args).toEqual(['business_date', '2026-04-15']);
  });

  it('E: returns distinctSalesTypes + distinctPaymentMethods arrays', async () => {
    const data: any = await load({
      url: new URL('http://x/'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    expect(Array.isArray(data.distinctSalesTypes)).toBe(true);
    expect(Array.isArray(data.distinctPaymentMethods)).toBe(true);
    // With our fixture we expect deduped + sorted values.
    expect(data.distinctSalesTypes).toEqual(['INHOUSE', 'TAKEAWAY']);
    expect(data.distinctPaymentMethods).toEqual(['Bar', 'Visa']);
  });

  it('F: fixed tiles (kpi_daily_v) are unscoped — no .in("sales_type") on them', async () => {
    await load({
      url: new URL('http://x/?sales_type=INHOUSE'),
      locals: mkLocals(state),
      depends: () => {}
    } as any);

    const kpiQueries = callsFor(state, 'kpi_daily_v');
    expect(kpiQueries.length).toBeGreaterThanOrEqual(6); // today/7d/30d + priors
    for (const q of kpiQueries) {
      const hasSalesTypeIn = q.calls.some(
        c => c.method === 'in' && c.args[0] === 'sales_type'
      );
      expect(hasSalesTypeIn).toBe(false);
    }
  });
});
