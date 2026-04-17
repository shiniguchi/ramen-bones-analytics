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
// Safety: caps at MAX_PAGES (1000 pages = 1M rows) to prevent runaway loops.

// Minimal structural type for the builder parameter — we only need .range()
// to return a thenable resolving to { data, error }. Avoids importing
// @supabase/postgrest-js directly while preserving generic T flow-through.
interface RangeBuilder<T> {
  range(from: number, to: number): Promise<{ data: T[] | null; error: { message: string } | null }>;
}

const MAX_PAGES = 1000; // safety cap: 1M rows at default pageSize

export async function fetchAll<T>(
  buildQuery: () => RangeBuilder<T>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let pageCount = 0;

  while (pageCount < MAX_PAGES) {
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

  if (pageCount >= MAX_PAGES) {
    throw new Error(
      `fetchAll: exceeded ${MAX_PAGES} pages (${MAX_PAGES * pageSize} rows) — ` +
      'possible infinite loop from a builder that always returns full pages. ' +
      'Check the query or raise MAX_PAGES if the result set is legitimately large.'
    );
  }

  return all;
}
