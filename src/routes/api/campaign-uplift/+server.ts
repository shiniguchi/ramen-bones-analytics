// src/routes/api/campaign-uplift/+server.ts
// Phase 16 D-11 / C-08 / T-16-04.
// Reads pre-computed nightly aggregates from campaign_uplift_v (per-window
// headline rows) and campaign_uplift_daily_v (per-day trajectory powering
// the dashboard sparkline). The endpoint URL stays stable across Phase 15
// → 16 — Phase 15's `campaign_start` and `cumulative_deviation_eur` fields
// are preserved at the top level for ForecastHoverPopup back-compat (C-08).
//
// Threat T-16-04 (sample-path leak): the endpoint reads ONLY aggregate
// columns from the wrapper views — never raw `yhat_samples` or path arrays.
// The Vitest suite asserts no `paths`/`samples`/`yhat_samples` keys nor any
// 200-element numeric array appears in the response body.
//
// Auth: locals.safeGetSession(). RLS: campaign_uplift_v + campaign_uplift_daily_v
// apply auth.jwt()->>'restaurant_id' inline (Plan 07 migration 0064).
// Cache-Control: private, no-store.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import { format } from 'date-fns';

type UpliftRow = {
  campaign_id: string;
  campaign_start: string;
  campaign_end: string;
  campaign_name: string | null;
  campaign_channel: string | null;
  model_name: string;
  window_kind: 'campaign_window' | 'cumulative_since_launch';
  cumulative_uplift_eur: number;
  ci_lower_eur: number;
  ci_upper_eur: number;
  naive_dow_uplift_eur: number | null;
  n_days: number;
  as_of_date: string;
};

type DailyRow = {
  campaign_id: string;
  model_name: string;
  cumulative_uplift_eur: number;
  ci_lower_eur: number;
  ci_upper_eur: number;
  as_of_date: string;
};

type CampaignBlockRow = Omit<
  UpliftRow,
  'campaign_id' | 'campaign_start' | 'campaign_end' | 'campaign_name' | 'campaign_channel'
>;

type CampaignBlock = {
  campaign_id: string;
  start_date: string;
  end_date: string;
  name: string | null;
  channel: string | null;
  rows: CampaignBlockRow[];
};

const NO_STORE: Record<string, string> = { 'Cache-Control': 'private, no-store' };

export const GET: RequestHandler = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  try {
    // Two queries against the SAME backing table via two wrapper views.
    // campaign_uplift_v        = headline rows (per-window aggregates).
    // campaign_uplift_daily_v  = per-day trajectory rows for the sparkline (D-11).
    const [rows, dailyRows] = await Promise.all([
      fetchAll<UpliftRow>(() =>
        locals.supabase
          .from('campaign_uplift_v')
          .select(
            'campaign_id,campaign_start,campaign_end,campaign_name,campaign_channel,model_name,window_kind,cumulative_uplift_eur,ci_lower_eur,ci_upper_eur,naive_dow_uplift_eur,n_days,as_of_date'
          )
          .order('campaign_start', { ascending: false })
          .order('model_name', { ascending: true })
      ),
      fetchAll<DailyRow>(() =>
        locals.supabase
          .from('campaign_uplift_daily_v')
          .select('campaign_id,model_name,cumulative_uplift_eur,ci_lower_eur,ci_upper_eur,as_of_date')
          .eq('model_name', 'sarimax') // headline model only — D-11 sparkline shows sarimax trajectory
          .order('as_of_date', { ascending: true })
      )
    ]);

    // Group by campaign_id. campaign_uplift_v's DISTINCT ON dedup (Plan 07)
    // guarantees at most 1 row per (campaign, model, window_kind), so the
    // `find()` for the headline below is deterministic across nightly aggregates.
    const byCampaign = new Map<string, CampaignBlock>();
    for (const r of rows) {
      if (!byCampaign.has(r.campaign_id)) {
        byCampaign.set(r.campaign_id, {
          campaign_id: r.campaign_id,
          start_date: r.campaign_start,
          end_date: r.campaign_end,
          name: r.campaign_name,
          channel: r.campaign_channel,
          rows: []
        });
      }
      byCampaign.get(r.campaign_id)!.rows.push({
        model_name: r.model_name,
        window_kind: r.window_kind,
        cumulative_uplift_eur: r.cumulative_uplift_eur,
        ci_lower_eur: r.ci_lower_eur,
        ci_upper_eur: r.ci_upper_eur,
        naive_dow_uplift_eur: r.naive_dow_uplift_eur,
        n_days: r.n_days,
        as_of_date: r.as_of_date
      });
    }
    const campaigns: CampaignBlock[] = Array.from(byCampaign.values());

    // Headline: sarimax cumulative_since_launch for the most recent campaign.
    const headline = campaigns[0]?.rows.find(
      (r) => r.model_name === 'sarimax' && r.window_kind === 'cumulative_since_launch'
    );

    // Per-day trajectory for the headline campaign × sarimax (D-11 sparkline).
    const headlineCampaignId = campaigns[0]?.campaign_id;
    const daily = headlineCampaignId
      ? dailyRows
          .filter((d) => d.campaign_id === headlineCampaignId)
          .map((d) => ({
            date: d.as_of_date,
            cumulative_uplift_eur: d.cumulative_uplift_eur,
            ci_lower_eur: d.ci_lower_eur,
            ci_upper_eur: d.ci_upper_eur
          }))
      : [];

    return json(
      {
        // Back-compat fields (Phase 15 D-08 / C-08):
        campaign_start: campaigns[0]?.start_date ?? null,
        cumulative_deviation_eur: headline?.cumulative_uplift_eur ?? 0,
        as_of: format(new Date(), 'yyyy-MM-dd'),
        // Phase 16 extensions:
        model: 'sarimax',
        ci_lower_eur: headline?.ci_lower_eur ?? null,
        ci_upper_eur: headline?.ci_upper_eur ?? null,
        naive_dow_uplift_eur: headline?.naive_dow_uplift_eur ?? null,
        daily,
        campaigns
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[/api/campaign-uplift]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
