// Builds the InsightPayload read by the LLM tool-use prompt.
// Service-role client — no JWT context — scope every query by restaurant_id explicitly.
// Reads wrapper views created in Phase 3/4; raw MVs allowed for service-role.

import type { SupabaseClient } from "@supabase/supabase-js";

// D-05: the shape Haiku sees. Every numeric field is a candidate for the digit-guard allowed set.
export type InsightPayload = {
  kpi: {
    today_revenue: number;
    seven_d_revenue: number;
    thirty_d_revenue: number;
    ninety_d_revenue: number;
    today_delta_pct: number;
    seven_d_delta_pct: number;
    tx_count: number;
    avg_ticket: number;
  };
  cohorts: Array<{ cohort_week: string; cohort_size: number; retention: number[] }>;
  ltv: Array<{ cohort_week: string; ltv_cents: number }>;
  frequency: Array<{ bucket: string; customer_count: number }>;
  new_vs_returning: { new_revenue: number; returning_revenue: number; cash_revenue: number };
};

// kpi_daily_v is 1 row per business_date. Sum revenue over a rolling window anchored to "latest".
type KpiRow = {
  business_date: string;
  revenue?: number | null;
  revenue_cents?: number | null;
  tx_count?: number | null;
  avg_ticket?: number | null;
};

function sumWindow(rows: KpiRow[], days: number): number {
  return rows.slice(0, days).reduce((acc, r) => {
    const v = (r.revenue ?? r.revenue_cents ?? 0) as number;
    return acc + (Number(v) || 0);
  }, 0);
}

function deltaPct(curr: number, prior: number): number {
  if (prior === 0) return 0;
  return Math.round(((curr - prior) / prior) * 100);
}

export async function buildPayload(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<InsightPayload> {
  // Parallel fan-out — cuts latency to max of the 5 queries.
  const [kpiR, cohortR, ltvR, freqR, nvrR] = await Promise.all([
    supabase
      .from("kpi_daily_v")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("business_date", { ascending: false })
      .limit(180),
    supabase
      .from("cohort_mv")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("cohort_week", { ascending: false })
      .limit(48),
    supabase
      .from("ltv_v")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("cohort_week", { ascending: false })
      .limit(4),
    supabase
      .from("frequency_v")
      .select("*")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("new_vs_returning_v")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle(),
  ]);

  const kpiRows = (kpiR.data ?? []) as KpiRow[];
  // Today = newest row; 7d / 30d / 90d rolling sums; prior windows for delta calc.
  const today_revenue = Math.round(sumWindow(kpiRows, 1));
  const seven_d_revenue = Math.round(sumWindow(kpiRows, 7));
  const thirty_d_revenue = Math.round(sumWindow(kpiRows, 30));
  const ninety_d_revenue = Math.round(sumWindow(kpiRows, 90));
  // Prior comparables for deltas.
  const prior_today =
    kpiRows.length > 7
      ? Number(kpiRows[7]?.revenue ?? kpiRows[7]?.revenue_cents ?? 0) || 0
      : 0;
  const prior_7d = sumWindow(kpiRows.slice(7), 7);
  const today_delta_pct = deltaPct(today_revenue, prior_today);
  const seven_d_delta_pct = deltaPct(seven_d_revenue, prior_7d);

  const tx_count = kpiRows.slice(0, 1).reduce((a, r) => a + (Number(r.tx_count ?? 0) || 0), 0);
  const avg_ticket = Math.round(Number(kpiRows[0]?.avg_ticket ?? 0) || 0);

  // Cohort rows: retention columns are w0..wN; collapse wide→long.
  const cohorts = (cohortR.data ?? []).slice(0, 12).map((row: Record<string, unknown>) => {
    const retention: number[] = [];
    for (let i = 0; i < 12; i++) {
      const v = row[`w${i}`] ?? row[`period_${i}`];
      if (typeof v === "number") retention.push(Math.round(v * 100) / 100);
    }
    return {
      cohort_week: String(row.cohort_week ?? ""),
      cohort_size: Number(row.cohort_size ?? 0),
      retention,
    };
  });

  const ltv = (ltvR.data ?? []).map((row: Record<string, unknown>) => ({
    cohort_week: String(row.cohort_week ?? ""),
    ltv_cents: Math.round(Number(row.ltv_cents ?? row.ltv ?? 0)),
  }));

  const frequency = (freqR.data ?? []).map((row: Record<string, unknown>) => ({
    bucket: String(row.bucket ?? row.visit_bucket ?? ""),
    customer_count: Number(row.customer_count ?? row.count ?? 0),
  }));

  // nvr single row — defensive defaults so downstream fallback math never NaNs.
  const nvrRow = (nvrR.data ?? {}) as Record<string, unknown>;
  const new_vs_returning = {
    new_revenue: Math.round(Number(nvrRow.new_revenue ?? 0)),
    returning_revenue: Math.round(Number(nvrRow.returning_revenue ?? 0)),
    cash_revenue: Math.round(Number(nvrRow.cash_revenue ?? nvrRow.cash_anonymous ?? 0)),
  };

  return {
    kpi: {
      today_revenue,
      seven_d_revenue,
      thirty_d_revenue,
      ninety_d_revenue,
      today_delta_pct,
      seven_d_delta_pct,
      tx_count,
      avg_ticket,
    },
    cohorts,
    ltv,
    frequency,
    new_vs_returning,
  };
}
