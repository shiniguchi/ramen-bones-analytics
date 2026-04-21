// src/routes/api/customer-ltv/+server.ts
// Phase 11 D-03: deferred endpoint for RepeaterCohortCountCard.
// Was +page.server.ts:139-142 customerLtvP — moved off the SSR critical path.
//
// Auth: locals.safeGetSession() (canonical helper in src/hooks.server.ts:27-35).
// RLS: tenant scoping is enforced by the view's security_invoker wrapper.
// Cache-Control: private, no-store prevents CDN cross-tenant leakage.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';

type CustomerLtvRow = {
  card_hash: string;
  revenue_cents: number;
  visit_count: number;
  cohort_week: string;
  cohort_month: string;
};

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-store'
};

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    const rows = await fetchAll<CustomerLtvRow>(() =>
      locals.supabase
        .from('customer_ltv_v')
        .select('card_hash,revenue_cents,visit_count,cohort_week,cohort_month')
    );
    return json(rows, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/customer-ltv]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
