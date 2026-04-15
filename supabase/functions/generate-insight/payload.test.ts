import { assertEquals, assert } from "std/assert";
import type { InsightPayload } from "./payload.ts";

Deno.test.ignore("buildPayload shape contains kpi + cohort + ltv + frequency + new_vs_returning keys", () => {
  // Integration test — requires live Supabase. Deferred to 05-03 integration suite.
});

Deno.test("InsightPayload type includes all D-05 required fields", () => {
  // Type-only assertion: compile-time check that the type exists and has keys.
  const sample: InsightPayload = {
    kpi: {
      today_revenue: 0,
      seven_d_revenue: 0,
      thirty_d_revenue: 0,
      ninety_d_revenue: 0,
      today_delta_pct: 0,
      seven_d_delta_pct: 0,
      tx_count: 0,
      avg_ticket: 0,
    },
    cohorts: [],
    ltv: [],
    frequency: [],
    new_vs_returning: { new_revenue: 0, returning_revenue: 0, cash_revenue: 0 },
  };
  assert(sample !== null);
  assertEquals(typeof sample.kpi.today_revenue, "number");
});
