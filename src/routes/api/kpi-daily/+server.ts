// src/routes/api/kpi-daily/+server.ts
// Phase 11 D-03: deferred endpoint for DailyHeatmapCard.
// Was +page.server.ts:124-128 dailyKpiP — moved off the SSR critical path so
// Cloudflare Pages Free subrequest budget stays comfortable even at scale.
//
// Auth: locals.safeGetSession() (canonical helper in src/hooks.server.ts:27-35).
// RLS: tenant scoping is enforced by the view's security_invoker wrapper.
// Cache-Control: private, no-store so the CDN never caches a tenant-scoped payload.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';

type DailyKpiRow = {
  business_date: string;
  revenue_cents: number | string;
  tx_count: number;
};

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-store'
};

export const GET: RequestHandler = async ({ locals }) => {
  // Canonical auth gate — matches src/hooks.server.ts:27-35.
  // CI Guard 2 scans for getSession without getClaims/getUser; safeGetSession
  // satisfies it because the helper itself calls getClaims internally.
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    const rows = await fetchAll<DailyKpiRow>(() =>
      locals.supabase
        .from('kpi_daily_v')
        .select('business_date,revenue_cents,tx_count')
        .order('business_date', { ascending: true })
    );
    return json(rows, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/kpi-daily]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
