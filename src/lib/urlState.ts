// Phase 9 Plan 05 — URL composition helper for client-side filter clicks.
// Fix UAT Test 9: `page.url` from $app/state does NOT update after replaceState,
// so `new URL(page.url)` on sequential clicks reads a stale snapshot and
// silently drops params set by prior clicks. This helper reads the live
// browser URL (window.location.href) so composition works.
//
// Usage:
//   const url = mergeSearchParams({ sales_type: 'INHOUSE' });  // set
//   const url = mergeSearchParams({ range: '30d', from: null, to: null }); // set + delete
//   replaceState(url, {});

/** Merge partial updates into the live browser URL's search params.
 *  - string value → searchParams.set(key, value)
 *  - null value   → searchParams.delete(key)
 *  Browser-only. Throws in SSR — all callers are filter click handlers. */
export function mergeSearchParams(
  updates: Record<string, string | null>
): URL {
  if (typeof window === 'undefined') {
    throw new Error('mergeSearchParams requires a browser environment');
  }
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  return url;
}
