// src/routes/api/campaign-uplift/+server.ts
// Phase 16 D-11 / C-08 / T-16-04.
// Reads pre-computed nightly aggregates from campaign_uplift_v (per-window
// headline rows), campaign_uplift_weekly_v (per-ISO-week bars), and
// forecast_with_actual_v (CF track — actual vs SARIMAX yhat dual-line).
// Phase 20: replaced campaign_uplift_daily_v with forecast_with_actual_v
// CF track query, enabling the day-granularity dual-line counterfactual chart.
//
// Threat T-16-04 (sample-path leak): the endpoint reads ONLY aggregate
// columns from the wrapper views — never raw `yhat_samples` or path arrays.
// The Vitest suite asserts no `paths`/`samples`/`yhat_samples` keys nor any
// 200-element numeric array appears in the response body.
//
// Auth: locals.safeGetSession(). RLS: views apply auth.jwt()->>'restaurant_id'.
// Cache-Control: private, no-store.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { fetchAll } from '$lib/supabasePagination';
import { format, parseISO, subDays } from 'date-fns';

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

// Phase 20: replaces DailyRow (campaign_uplift_daily_v cumulative trajectory).
// forecast_with_actual_v CF track gives actual revenue vs SARIMAX yhat per day.
type CfDailyLineRow = {
  target_date: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
  actual_value: number | null;
};

// Phase 18 UPL-08: per-ISO-week aggregate row (campaign_uplift_weekly_v).
// Sister type to DailyRow — same view shape; different window_kind in the
// underlying campaign_uplift backing table (`'iso_week'`, written by
// scripts/forecast/cumulative_uplift.compute_iso_week_uplift_rows).
// `as_of_date` is the Sunday of the ISO week; iso_week_start = Sun − 6d.
type WeeklyRow = {
  campaign_id: string;
  model_name: string;
  cumulative_uplift_eur: number;
  ci_lower_eur: number;
  ci_upper_eur: number;
  n_days: number;
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
    // today computed before Promise.all so the kpi query can filter server-side.
    const today = format(new Date(), 'yyyy-MM-dd');

    // Four queries:
    // campaign_uplift_v          = headline rows (per-window aggregates).
    // campaign_uplift_weekly_v   = per-ISO-week trajectory (Phase 18 UPL-08).
    // forecast_with_actual_v     = CF track: SARIMAX yhat/CI per day (Phase 20).
    // kpi_daily_with_comparable_v = total revenue_eur per day — used as the
    //   actual line in the chart. revenue_comparable_eur (from the CF view) only
    //   covers baseline menu items; total revenue_eur matches what the owner sees
    //   in the KPI tiles and heatmap.
    const [rows, weeklyRows, cfDailyLineRows, kpiDailyRows] = await Promise.all([
      fetchAll<UpliftRow>(() =>
        locals.supabase
          .from('campaign_uplift_v')
          .select(
            'campaign_id,campaign_start,campaign_end,campaign_name,campaign_channel,model_name,window_kind,cumulative_uplift_eur,ci_lower_eur,ci_upper_eur,naive_dow_uplift_eur,n_days,as_of_date'
          )
          .order('campaign_start', { ascending: false })
          .order('model_name', { ascending: true })
      ),
      fetchAll<WeeklyRow>(() =>
        locals.supabase
          .from('campaign_uplift_weekly_v')
          .select(
            'campaign_id,model_name,cumulative_uplift_eur,ci_lower_eur,ci_upper_eur,n_days,as_of_date'
          )
          .eq('model_name', 'sarimax')
          .order('as_of_date', { ascending: true })
      ),
      fetchAll<CfDailyLineRow>(() =>
        locals.supabase
          .from('forecast_with_actual_v')
          .select('target_date,yhat,yhat_lower,yhat_upper,actual_value')
          .eq('forecast_track', 'cf')
          .eq('model_name', 'sarimax')
          .eq('kpi_name', 'revenue_comparable_eur')
          .eq('granularity', 'day')
          .order('target_date', { ascending: true })
      ),
      fetchAll<{ business_date: string; revenue_eur: number }>(() =>
        locals.supabase
          .from('kpi_daily_with_comparable_v')
          .select('business_date,revenue_eur')
          .lte('business_date', today)
          .order('business_date', { ascending: true })
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

    // Phase 20: per-day actual vs CF yhat for the headline campaign (dual-line chart).
    // actual_eur = total revenue_eur from kpi_daily_with_comparable_v (matches KPI tiles).
    // cf_yhat_eur = SARIMAX CF baseline (trained on revenue_comparable_eur — comparable items only).
    // Using total revenue for the actual line so numbers align with the heatmap / KPI tiles.
    const headlineCampaignId = campaigns[0]?.campaign_id;
    const kpiByDate = new Map(kpiDailyRows.map((r) => [r.business_date, r.revenue_eur]));
    const daily_lines =
      headlineCampaignId && campaigns[0]?.start_date
        ? cfDailyLineRows
            .filter((r) => r.target_date >= campaigns[0]!.start_date && r.target_date <= today)
            .map((r) => ({
              date: r.target_date,
              actual_eur: kpiByDate.get(r.target_date) ?? null,
              cf_yhat_eur: r.yhat,
              cf_lower_eur: r.yhat_lower,
              cf_upper_eur: r.yhat_upper
            }))
        : [];

    // Phase 18 UPL-08: per-ISO-week trajectory powering CampaignUpliftCard's
    // bar-chart history (Plans 04 + 05). `as_of_date` IS the Sunday end of the
    // ISO week (per the pipeline's write contract, Plan 18-02). The Monday is
    // `Sun − 6d` deterministically — no zoneinfo needed.
    // Empty when no headline campaign or zero iso_week rows for it (e.g.,
    // campaign launched < 1 ISO week ago).
    const weekly_history = headlineCampaignId
      ? weeklyRows
          .filter((w) => w.campaign_id === headlineCampaignId)
          .map((w) => {
            const sun = parseISO(w.as_of_date);
            const mon = subDays(sun, 6);
            return {
              iso_week_start: format(mon, 'yyyy-MM-dd'),
              iso_week_end: w.as_of_date,
              model_name: w.model_name,
              point_eur: w.cumulative_uplift_eur,
              ci_lower_eur: w.ci_lower_eur,
              ci_upper_eur: w.ci_upper_eur,
              n_days: w.n_days
            };
          })
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
        daily_lines,
        // Phase 18 extension (sister to `daily_lines`):
        weekly_history,
        campaigns
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[/api/campaign-uplift]', err);
    return json({ error: 'query failed' }, { status: 500, headers: NO_STORE });
  }
};
