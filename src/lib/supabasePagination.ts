// Generic pagination over a supabase-js query builder.
//
// Why: PostgREST enforces max_rows (typically 1000 on Supabase free tier).
// A single uncapped .select() silently truncates result sets — the dashboard
// spent 2026-04-17 showing 1,000-row samples instead of the full 6,896.
//
// Usage:
//   await fetchAll(() => supabase.from('x').select('*').gte('d', d0))
//
// The builder factory is called once per page — each call must produce a fresh
// chain so .range() can be appended without re-applying to a previous chain.
//
// Stops when: a page returns fewer rows than pageSize OR an empty page.
// Throws: on any PostgREST error (caller handles via .catch for empty-fallback).
// Safety: caps at DEFAULT_MAX_PAGES (50 pages — matches Cloudflare Pages Free
//   per-request subrequest ceiling). Callers can raise via { maxPages: N } up
//   to HARD_MAX_PAGES (1000) for migration/seed scripts.

// Minimal structural type for the builder parameter.
// .range() returns a PromiseLike (Thenable) — the real PostgrestFilterBuilder
// is chainable AND Thenable, so using PromiseLike satisfies both the unit-test
// mock (plain Promise) and the real supabase-js builder.
interface RangeBuilder<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

// Phase 11-01 D-05: Cloudflare Pages Free caps each SSR request at 50
// subrequests. A single fetchAll() call needing more than 50 pages is an
// architectural problem that belongs in SQL (MV aggregation), not a
// pagination loop — so DEFAULT_MAX_PAGES is 50, not 1000.
// HARD_MAX_PAGES is retained as an upper bound for migration/seed scripts
// that legitimately iterate large datasets server-side.
export const DEFAULT_MAX_PAGES = 50;
export const HARD_MAX_PAGES = 1000;

export interface FetchAllOptions {
  pageSize?: number;
  maxPages?: number;
}

export async function fetchAll<T>(
  buildQuery: () => RangeBuilder<T>,
  options: FetchAllOptions = {}
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const all: T[] = [];
  let offset = 0;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);

    if (error) {
      // Propagate so caller's .catch can log + fall back to [] per
      // per-card error isolation pattern (memory: project_silent_error_isolation)
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      // Empty page: result set exhausted
      break;
    }

    all.push(...data);

    if (data.length < pageSize) {
      // Short page: no more rows beyond this point
      break;
    }

    offset += pageSize;
    pageCount += 1;
  }

  if (pageCount >= maxPages) {
    throw new Error(
      `fetchAll: exceeded ${maxPages} pages (${maxPages * pageSize} rows) — ` +
      'possible infinite loop from a builder that always returns full pages. ' +
      'Check the query or raise maxPages if the result set is legitimately large.'
    );
  }

  return all;
}
