// src/routes/api/campaign-uplift/+server.ts
// Phase 15 D-08 / FUI-04 / FUI-07.
// Deferred endpoint for ForecastHoverPopup's "cumulative deviation since
// campaign launch" field. Single-number response: Σ(actual − yhat) for the
// SARIMAX BAU model on revenue_eur, summed across every row in
// forecast_with_actual_v whose target_date ≥ CAMPAIGN_START.
//
// Phase 15 stub: CAMPAIGN_START is hard-coded in src/lib/forecastConfig.ts.
// Phase 16 swaps the constant for a campaign_calendar lookup AND extends
// the response with Track-B counterfactual fields. The endpoint URL
// /api/campaign-uplift stays stable across Phase 15 → 16; only the payload
// shape extends. Frontend code that consumes Phase 15's payload will still
// work after Phase 16 lands.
//
// Auth: locals.safeGetSession(). RLS: forecast_with_actual_v applies the
// auth.jwt() filter inline (Phase 14 migration 0054).
// Cache-Control: private, no-store.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import { CAMPAIGN_START } from '$lib/forecastConfig';
import { format } from 'date-fns';

type UpliftViewRow = {
  target_date: string;
  yhat: number;
  actual_value: number | null;
};

const NO_STORE: Record<string, string> = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const campaignStartDate = format(CAMPAIGN_START, 'yyyy-MM-dd');

  try {
    const rows = await fetchAll<UpliftViewRow>(() =>
      locals.supabase
        .from('forecast_with_actual_v')
        .select('target_date,yhat,actual_value')
        .eq('kpi_name', 'revenue_eur')
        .eq('forecast_track', 'bau')
        .eq('model_name', 'sarimax_bau')
        .gte('target_date', campaignStartDate)
    );

    let cumulative = 0;
    for (const r of rows) {
      if (r.actual_value !== null) cumulative += r.actual_value - r.yhat;
    }

    return json(
      {
        campaign_start: campaignStartDate,
        cumulative_deviation_eur: cumulative,
        as_of: format(new Date(), 'yyyy-MM-dd')
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[/api/campaign-uplift]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
