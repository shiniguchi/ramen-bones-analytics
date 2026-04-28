// Quick task 260428-wmd: post-ingest hook.
// Refreshes analytics MVs after upsert, then triggers the generate-insight
// Edge Function only when a new complete Mon-Sun week is available compared
// to the latest insight's business_date. Replaces the daily pg_cron schedule.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toZonedTime } from 'date-fns-tz';
import { format, getDay, subDays } from 'date-fns';

// Berlin-local week boundaries match the rest of the pipeline (see normalize.ts toBerlinUtc).
const TZ = 'Europe/Berlin';

export interface RefreshResult {
  mv_refreshed: boolean;
  latest_data_date: string | null;
  latest_complete_week_ending: string | null;
  latest_insight_business_date: string | null;
  insight_triggered: boolean;
  insight_skip_reason?: string;
}

// Floor a Berlin-local Date to the most recent Sunday on-or-before.
// Sunday→0 days back, Monday→1, …, Saturday→6.
function floorToSundayBerlin(date: Date): Date {
  const dow = getDay(date);
  const back = dow === 0 ? 0 : dow;
  return subDays(date, back);
}

export async function refreshAndMaybeTriggerInsight(
  client: SupabaseClient,
  supabaseUrl: string,
  serviceRoleKey: string,
  restaurantId: string,
): Promise<RefreshResult> {
  // Vitest sets VITEST=true automatically. Skip the hook entirely under tests:
  // the integration suite exercises runIngest end-to-end against TEST Supabase,
  // which doesn't host the generate-insight Edge Function (DEV-only deploy).
  // Calling fetch from tests is also a side effect we don't want.
  if (process.env.VITEST === 'true') {
    return {
      mv_refreshed: false,
      latest_data_date: null,
      latest_complete_week_ending: null,
      latest_insight_business_date: null,
      insight_triggered: false,
      insight_skip_reason: 'vitest mode',
    };
  }

  // 1. Refresh both materialized views (cohort_mv + kpi_daily_mv) in one call.
  const { error: rpcErr } = await client.rpc('refresh_analytics_mvs');
  if (rpcErr) throw new Error(`MV refresh failed: ${rpcErr.message}`);

  // 2. Latest data date in Berlin local time.
  const { data: txData, error: txErr } = await client
    .from('transactions')
    .select('occurred_at')
    .eq('restaurant_id', restaurantId)
    .order('occurred_at', { ascending: false })
    .limit(1);
  if (txErr) throw new Error(`tx max query failed: ${txErr.message}`);
  if (!txData || txData.length === 0) {
    return {
      mv_refreshed: true,
      latest_data_date: null,
      latest_complete_week_ending: null,
      latest_insight_business_date: null,
      insight_triggered: false,
      insight_skip_reason: 'no transactions for tenant',
    };
  }
  const latestUtc = txData[0].occurred_at as string;
  const latestBerlin = toZonedTime(latestUtc, TZ);
  const latestDataDate = format(latestBerlin, 'yyyy-MM-dd');

  const sundayOnOrBefore = floorToSundayBerlin(latestBerlin);
  const latestCompleteWeekEnding = format(sundayOnOrBefore, 'yyyy-MM-dd');

  // 3. Latest insight business_date for this tenant.
  const { data: insData, error: insErr } = await client
    .from('insights')
    .select('business_date')
    .eq('restaurant_id', restaurantId)
    .order('business_date', { ascending: false })
    .limit(1);
  if (insErr) throw new Error(`insight max query failed: ${insErr.message}`);
  const latestInsightBusinessDate =
    (insData?.[0]?.business_date as string | undefined) ?? null;

  // 4. Trigger only when a strictly newer complete week is available.
  const shouldTrigger =
    !latestInsightBusinessDate ||
    latestCompleteWeekEnding > latestInsightBusinessDate;

  if (!shouldTrigger) {
    return {
      mv_refreshed: true,
      latest_data_date: latestDataDate,
      latest_complete_week_ending: latestCompleteWeekEnding,
      latest_insight_business_date: latestInsightBusinessDate,
      insight_triggered: false,
      insight_skip_reason: 'no new complete week',
    };
  }

  // 5. Fire the Edge Function. Same auth + body shape the cron used (empty JSON;
  //    the function reads tenant state from the DB itself).
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/generate-insight`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`generate-insight call failed: ${res.status} ${body}`);
  }

  return {
    mv_refreshed: true,
    latest_data_date: latestDataDate,
    latest_complete_week_ending: latestCompleteWeekEnding,
    latest_insight_business_date: latestInsightBusinessDate,
    insight_triggered: true,
  };
}
