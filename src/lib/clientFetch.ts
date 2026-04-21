// Phase 11 D-03: client-side fetch helper for deferred API routes.
// SWR-style in-memory cache keyed by URL. Same-tab in-memory only;
// no localStorage / no persistence across reloads.
//
// Each card's fetch fires once when the card scrolls into view (via
// LazyMount.onvisible). Subsequent remounts of the same card (filter
// changes that preserve the URL) re-use the cached payload.
//
// Do NOT use this for SSR load functions — those have direct supabase
// access via locals.supabase. This is client-browser only.

const cache = new Map<string, unknown>();

export async function clientFetch<T>(url: string): Promise<T> {
  if (cache.has(url)) return cache.get(url) as T;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[clientFetch] ${url} -> ${res.status} ${res.statusText}`);
  const data = (await res.json()) as T;
  cache.set(url, data);
  return data;
}

export function invalidateClientCache(url?: string): void {
  if (url === undefined) cache.clear();
  else cache.delete(url);
}
