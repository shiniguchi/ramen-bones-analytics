// src/routes/api/retention/+server.ts
// Phase 11 D-03: deferred endpoint for CohortRetentionCard.
// Was +page.server.ts:176-187 retentionP + retentionMonthlyP — moved off the SSR
// critical path. Returns { weekly, monthly } in a single Promise.all round-trip.
//
// Auth: locals.safeGetSession() (canonical helper in src/hooks.server.ts:27-35).
// RLS: tenant scoping is enforced by retention_curve_v + retention_curve_monthly_v
// security_invoker wrappers.
// Cache-Control: private, no-store prevents CDN cross-tenant leakage.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';

type RetentionRow = {
  cohort_week: string;
  period_weeks: number;
  retention_rate: number;
  cohort_size_week: number;
  cohort_age_weeks: number;
};

type RetentionMonthlyRow = {
  cohort_month: string;
  period_months: number;
  retention_rate: number;
  cohort_size_month: number;
  cohort_age_months: number;
};

const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, no-store'
};

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    // Single round-trip: weekly + monthly queries fire in parallel.
    const [weekly, monthly] = await Promise.all([
      fetchAll<RetentionRow>(() =>
        locals.supabase
          .from('retention_curve_v')
          .select('cohort_week,period_weeks,retention_rate,cohort_size_week,cohort_age_weeks')
      ),
      fetchAll<RetentionMonthlyRow>(() =>
        locals.supabase
          .from('retention_curve_monthly_v')
          .select('cohort_month,period_months,retention_rate,cohort_size_month,cohort_age_months')
      )
    ]);
    return json({ weekly, monthly }, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/retention]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
