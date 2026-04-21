// @vitest-environment node
// Quick 260417-o8a Task 1 — fetchAll pagination helper RED tests.
//
// PostgREST enforces max_rows (1000 on Supabase free tier by default). An
// uncapped .select() silently truncates — the dashboard spent 2026-04-17
// displaying 1,000-row samples instead of the full 6,896. fetchAll loops
// .range(offset, offset + pageSize - 1) until a page returns fewer rows than
// requested (or empty). Errors propagate so the caller's .catch can still
// isolate per-card failures.
import { describe, it, expect } from 'vitest';
import {
  fetchAll,
  DEFAULT_MAX_PAGES,
  HARD_MAX_PAGES
} from '../../src/lib/supabasePagination';

// -- Builder factory mock --
// Each call to buildQuery() must return a fresh chain — the helper re-invokes
// it per page so .range() can be appended without leaking state from the
// previous page. The test's rangeCalls array is shared so we can assert the
// exact bounds used across pages.
interface MockResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

function mockBuilder(pages: MockResponse[]) {
  const rangeCalls: Array<[number, number]> = [];
  let page = 0;

  const buildQuery = () => ({
    range: (from: number, to: number) => {
      rangeCalls.push([from, to]);
      const resp = pages[page] ?? { data: [], error: null };
      page += 1;
      return Promise.resolve(resp);
    }
  });

  return { buildQuery, rangeCalls };
}

describe('fetchAll — paginates until exhausted', () => {
  it('Test 1: exhausts multi-page — 1000 + 1000 + 500 across three .range() calls', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const page2 = Array.from({ length: 1000 }, (_, i) => ({ i: i + 1000 }));
    const page3 = Array.from({ length: 500 }, (_, i) => ({ i: i + 2000 }));
    const { buildQuery, rangeCalls } = mockBuilder([
      { data: page1, error: null },
      { data: page2, error: null },
      { data: page3, error: null }
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll<{ i: number }>(buildQuery as any);

    expect(rows).toHaveLength(2500);
    expect(rows[0]).toEqual({ i: 0 });
    expect(rows[999]).toEqual({ i: 999 });
    expect(rows[1000]).toEqual({ i: 1000 });
    expect(rows[2499]).toEqual({ i: 2499 });
    expect(rangeCalls).toHaveLength(3);
  });

  it('Test 2: single full page + empty second page — stops without looping forever', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const { buildQuery, rangeCalls } = mockBuilder([
      { data: full, error: null },
      { data: [], error: null }
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll<{ i: number }>(buildQuery as any);

    expect(rows).toHaveLength(1000);
    // Helper may stop on the empty second page or infer via short-page. Either
    // way: no more than 2 .range() calls (no infinite loop).
    expect(rangeCalls.length).toBeLessThanOrEqual(2);
    expect(rangeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('Test 3: single partial page — does NOT make a second .range call', async () => {
    const partial = Array.from({ length: 42 }, (_, i) => ({ i }));
    const { buildQuery, rangeCalls } = mockBuilder([
      { data: partial, error: null }
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll<{ i: number }>(buildQuery as any);

    expect(rows).toHaveLength(42);
    expect(rangeCalls).toHaveLength(1);
  });

  it('Test 4: empty first page — returns [] and does not loop', async () => {
    const { buildQuery, rangeCalls } = mockBuilder([
      { data: [], error: null }
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll<{ i: number }>(buildQuery as any);

    expect(rows).toEqual([]);
    expect(rangeCalls).toHaveLength(1);
  });

  it('Test 5: PostgREST error propagates as thrown Error', async () => {
    const { buildQuery } = mockBuilder([
      { data: null, error: { message: 'boom' } }
    ]);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<{ i: number }>(buildQuery as any)
    ).rejects.toThrow(/boom/);
  });

  it('Test 6: respects custom pageSize via options bag — first range uses (0, 99) when pageSize=100', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ i }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ i: i + 100 }));
    const { buildQuery, rangeCalls } = mockBuilder([
      { data: page1, error: null },
      { data: page2, error: null }
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await fetchAll<{ i: number }>(buildQuery as any, { pageSize: 100 });

    expect(rows).toHaveLength(150);
    expect(rangeCalls[0]).toEqual([0, 99]);
    expect(rangeCalls[1]).toEqual([100, 199]);
  });

  it('Test 7: range bounds are (offset, offset + pageSize - 1) inclusive — classic off-by-one pin', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const page2 = Array.from({ length: 1000 }, (_, i) => ({ i: i + 1000 }));
    const page3 = Array.from({ length: 1 }, (_, i) => ({ i: i + 2000 }));
    const { buildQuery, rangeCalls } = mockBuilder([
      { data: page1, error: null },
      { data: page2, error: null },
      { data: page3, error: null }
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchAll<{ i: number }>(buildQuery as any);

    // Default pageSize = 1000 → bounds: [0,999], [1000,1999], [2000,2999]
    expect(rangeCalls[0]).toEqual([0, 999]);
    expect(rangeCalls[1]).toEqual([1000, 1999]);
    expect(rangeCalls[2]).toEqual([2000, 2999]);
  });
});

// Phase 11-01 D-05: Cloudflare Pages Free caps each SSR request at 50 subrequests.
// fetchAll must default to 50 pages max (not 1000) so a single regression cannot
// blow the subrequest budget silently and trigger Error 1102.
describe('fetchAll — D-05 subrequest cap', () => {
  // A mock that always returns a full page — lets us probe the max-pages cap
  // without synthesizing millions of rows.
  function alwaysFullPage(pageSize = 1000) {
    const rangeCalls: Array<[number, number]> = [];
    const buildQuery = () => ({
      range: (from: number, to: number) => {
        rangeCalls.push([from, to]);
        const data = Array.from({ length: pageSize }, (_, i) => ({ i: from + i }));
        return Promise.resolve({ data, error: null });
      }
    });
    return { buildQuery, rangeCalls };
  }

  it('exports DEFAULT_MAX_PAGES=50 and HARD_MAX_PAGES=1000', () => {
    expect(DEFAULT_MAX_PAGES).toBe(50);
    expect(HARD_MAX_PAGES).toBe(1000);
  });

  it('defaults to 50 pages max — throws after the 50th .range() call', async () => {
    const { buildQuery, rangeCalls } = alwaysFullPage();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<{ i: number }>(buildQuery as any)
    ).rejects.toThrow(/50 pages/);
    // Loop exits once pageCount === maxPages (50), then the post-loop guard
    // throws. Exactly 50 .range() calls were made.
    expect(rangeCalls.length).toBe(50);
  });

  it('respects caller-supplied maxPages', async () => {
    const { buildQuery, rangeCalls } = alwaysFullPage();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<{ i: number }>(buildQuery as any, { maxPages: 3 })
    ).rejects.toThrow(/3 pages/);
    expect(rangeCalls.length).toBe(3);
  });

  it('accepts pageSize via options object (back-compat migration target)', async () => {
    const { buildQuery, rangeCalls } = alwaysFullPage(500);
    // With pageSize=500 and maxPages=2 we make exactly 2 range() calls before
    // the cap fires — pinning (0,499)/(500,999) bounds.
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAll<{ i: number }>(buildQuery as any, { pageSize: 500, maxPages: 2 })
    ).rejects.toThrow(/2 pages/);
    expect(rangeCalls.length).toBe(2);
    expect(rangeCalls[0]).toEqual([0, 499]);
    expect(rangeCalls[1]).toEqual([500, 999]);
  });
});
