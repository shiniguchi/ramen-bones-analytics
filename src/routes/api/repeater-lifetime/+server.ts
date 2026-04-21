// src/routes/api/repeater-lifetime/+server.ts
// Phase 11 D-03: deferred endpoint for RepeaterCohortCountCard's
// "what if we only operated these days?" recompute path.
// Was +page.server.ts:148-152 repeaterTxP — moved off the SSR critical path.
//
// ?days= contract (D-03 literal):
//   - omitted / empty        → full lifetime payload (no DOW filter)
//   - days=1,2,3,4,5,6,7     → full lifetime payload (all days = no filter)
//   - days=2,4 (proper sub)  → server filters rows to ISO-DOW ∈ {2,4}
//   - days=8 or days=junk    → 400 Bad Request
//
// ISO DOW convention: 1=Mon, 2=Tue, ..., 7=Sun (matches src/lib/filters.ts).
// DOW filter is applied in-handler after fetch because the view exposes
// business_date only (no pre-computed business_dow column). PostgREST cannot
// apply EXTRACT() in a WHERE clause, so filtering the already-fetched rows is
// the simplest correct path. Bounded by fetchAll DEFAULT_MAX_PAGES=50 (Plan 11-01).
//
// Auth: locals.safeGetSession() (canonical helper in src/hooks.server.ts:27-35).
// RLS: tenant scoping is enforced by the view's security_invoker wrapper.
// Cache-Control: private, no-store prevents CDN cross-tenant leakage.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import { DAYS_DEFAULT } from '$lib/filters';

type RepeaterTxRow = {
  card_hash: string;
  business_date: string;
  gross_cents: number;
};

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-store'
};

// Parse ?days=1,2,3 into a sorted unique number[] bounded to 1..7.
// Returns null for invalid input (junk / out-of-range / empty after parse).
function parseDays(raw: string | null): number[] | null {
  if (raw === null || raw === '') return [];   // absent → no filter
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length === 0) return null;
  const parsed: number[] = [];
  for (const p of parts) {
    if (!/^[1-7]$/.test(p)) return null;        // reject junk or out-of-range
    const n = Number(p);
    if (!parsed.includes(n)) parsed.push(n);
  }
  if (parsed.length === 0) return null;
  return parsed.sort((a, b) => a - b);
}

// ISO DOW of a YYYY-MM-DD business_date string. 1=Mon..7=Sun.
// JS getUTCDay returns 0=Sun..6=Sat — convert to ISO via ((d+6) % 7) + 1.
function isoDow(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00Z');
  const js = d.getUTCDay();               // 0=Sun..6=Sat
  return ((js + 6) % 7) + 1;               // 1=Mon..7=Sun
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const raw = url.searchParams.get('days');
  const daysParsed = parseDays(raw);
  if (daysParsed === null) {
    return json({ error: 'invalid days parameter' }, { status: 400, headers: NO_STORE });
  }
  // daysParsed is [] when ?days is absent — treat as "all days, no filter".
  // When set equals DAYS_DEFAULT (all 7) → also "no filter" — saves a filter pass.
  const isAllDays =
    daysParsed.length === 0 ||
    (daysParsed.length === DAYS_DEFAULT.length &&
      DAYS_DEFAULT.every((d) => daysParsed.includes(d)));

  try {
    const rows = await fetchAll<RepeaterTxRow>(() =>
      locals.supabase
        .from('transactions_filterable_v')
        .select('card_hash,business_date,gross_cents')
        .not('card_hash', 'is', null)
    );
    // Apply DOW filter in-handler when the parsed set is a proper subset of 1..7.
    // The view exposes business_date only (no business_dow column), so PostgREST
    // can't apply EXTRACT() in WHERE. In-handler filter is correct and bounded.
    const filtered = isAllDays
      ? rows
      : rows.filter((r) => daysParsed.includes(isoDow(r.business_date)));
    return json(filtered, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/repeater-lifetime]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
