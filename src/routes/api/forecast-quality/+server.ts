// src/routes/api/forecast-quality/+server.ts
// Phase 15 D-07 / FUI-04 / FUI-07.
// Long-format accuracy metrics per (model_name, kpi_name, horizon_days)
// for any consumer that needs nightly forecast accuracy. Filtered to
// evaluation_window='last_7_days' so Phase 17 rolling-origin CV rows
// (evaluation_window='rolling_origin_cv') don't leak through.
//
// Empty array on first 24h after Phase 14 ships (no rows yet) — the
// hover popup renders the 'forecast-quality-empty' empty-state copy
// "Accuracy data builds after first nightly run" in that case.
//
// Auth: locals.safeGetSession(). RLS: forecast_quality has its own
// per-tenant policy (migration 0051); no wrapper view needed because
// the table itself is tenant-scoped at the row level.
// Cache-Control: private, no-store.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';

type ForecastQualityRow = {
  model_name: string;
  kpi_name: string;
  horizon_days: number;
  rmse: number;
  mape: number;
  mean_bias: number;
  direction_hit_rate: number | null;
  evaluated_at: string;
};

const NO_STORE: Record<string, string> = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    const rows = await fetchAll<ForecastQualityRow>(() =>
      locals.supabase
        .from('forecast_quality')
        .select('model_name,kpi_name,horizon_days,rmse,mape,mean_bias,direction_hit_rate,evaluated_at')
        .eq('evaluation_window', 'last_7_days')
        .order('evaluated_at', { ascending: false })
    );
    return json(rows, { headers: NO_STORE });
  } catch (err) {
    console.error('[/api/forecast-quality]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
