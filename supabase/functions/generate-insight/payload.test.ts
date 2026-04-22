import { assertEquals, assert } from "std/assert";
import type { InsightPayload } from "./payload.ts";

Deno.test.ignore("buildPayload shape contains kpi + cohort + ltv + frequency + new_vs_returning keys", () => {
  // Integration test — requires live Supabase. Deferred to 05-03 integration suite.
});

Deno.test("InsightPayload type includes all D-05 required fields (Mon–Sun week framing)", () => {
  // Type-only assertion: compile-time check that the type exists and has keys.
  const sample: InsightPayload = {
    kpi: {
      today_revenue: 0,
      last_week_revenue: 0,
      last_four_weeks_revenue: 0,
      thirty_d_revenue: 0,
      ninety_d_revenue: 0,
      today_delta_pct: 0,
      last_week_delta_pct: 0,
      last_four_weeks_delta_pct: 0,
      tx_count: 0,
      avg_ticket: 0,
    },
    week_ending: "2026-04-19",
    cohorts: [],
    ltv: [],
    frequency: [],
    new_vs_returning: { new_revenue: 0, returning_revenue: 0, cash_revenue: 0 },
    display: {
      currency: "EUR",
      today_revenue_eur: 0,
      last_week_revenue_eur: 0,
      last_four_weeks_revenue_eur: 0,
      thirty_d_revenue_eur: 0,
      ninety_d_revenue_eur: 0,
      avg_ticket_eur: 0,
      new_revenue_eur: 0,
      returning_revenue_eur: 0,
      cash_revenue_eur: 0,
      returning_pct: 0,
    },
  };
  assert(sample !== null);
  assertEquals(typeof sample.kpi.last_week_revenue, "number");
  assertEquals(typeof sample.week_ending, "string");
});
