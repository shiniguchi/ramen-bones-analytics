import { assertEquals, assertStringIncludes } from "std/assert";
import { buildFallback } from "./fallback.ts";

// Shared input shape matching the Mon–Sun calendar-week FallbackInput (today_*
// fields retained for back-compat but no longer rendered by the template).
const baseInput = {
  today_revenue_int: 412,
  today_delta_pct: 8,
  today_delta_sign: "down" as const,
  last_week_revenue_int: 2814,
  last_week_delta_pct: 12,
  last_week_delta_sign: "down" as const,
  last_four_weeks_revenue_int: 11260,
  last_four_weeks_delta_pct: 4,
  last_four_weeks_delta_sign: "up" as const,
  returning_pct: 62,
};

Deno.test("buildFallback headline uses Mon–Sun weekly framing (Last week) with delta", () => {
  const out = buildFallback(baseInput);
  assertStringIncludes(out.headline, "Last week");
  assertStringIncludes(out.headline, "€2814");
  assertStringIncludes(out.headline, "12%");
});

Deno.test("buildFallback body references last-week revenue, 4-week trend, and returning_pct", () => {
  const out = buildFallback(baseInput);
  assertStringIncludes(out.body, "€2814");
  assertStringIncludes(out.body, "€11260");
  assertStringIncludes(out.body, "4%");
  assertStringIncludes(out.body, "62%");
});

Deno.test("buildFallback NEVER emits day-scope or rolling-window words (weekly cadence contract)", () => {
  const out = buildFallback(baseInput);
  const all = (out.headline + " " + out.body + " " + out.action_points.join(" ")).toLowerCase();
  for (const banned of ["today", "yesterday", "tomorrow", "this week", "past 7 days", "rolling", "last 7 days"]) {
    assertEquals(all.includes(banned), false, `output must not contain "${banned}"`);
  }
});

Deno.test("buildFallback handles zero last-week revenue edge case", () => {
  const out = buildFallback({ ...baseInput, last_week_revenue_int: 0, last_week_delta_pct: 0, last_week_delta_sign: "flat" });
  assertStringIncludes(out.headline, "No transactions logged last week");
});

Deno.test("buildFallback handles zero returning_pct edge case", () => {
  const out = buildFallback({ ...baseInput, returning_pct: 0 });
  assertStringIncludes(out.body, "No repeat customers last week");
});

Deno.test("buildFallback emits 3 action-point bullets covering weekly, monthly, and mix dimensions", () => {
  const out = buildFallback(baseInput);
  assertEquals(out.action_points.length, 3);
  assertStringIncludes(out.action_points[0], "Last week €2814");
  assertStringIncludes(out.action_points[1], "Last 4 weeks €11260");
  assertStringIncludes(out.action_points[2], "Returning share 62%");
});

Deno.test("buildFallback output passes digit-guard against its own payload + window literals (tautology check)", () => {
  // Composition check: every digit in the fallback output must appear in
  // either the input payload OR the window-size literal whitelist — mirrors
  // how index.ts seeds the digit-guard's `allowed` set.
  const out = buildFallback(baseInput);
  const allowedDigits = new Set<string>(
    Object.values(baseInput)
      .filter((v): v is number => typeof v === "number")
      .map(String),
  );
  // Match index.ts window-literal whitelist — "4" for "Last 4 weeks" /
  // "prior 4 weeks"; "7" / "28" kept for legacy compat with older prompt examples.
  for (const lit of ["7", "4", "28"]) allowedDigits.add(lit);
  const outputDigits = (out.headline + " " + out.body + " " + out.action_points.join(" "))
    .match(/\d+/g) ?? [];
  for (const d of outputDigits) {
    assertEquals(allowedDigits.has(d), true, `digit ${d} from output not in payload or window literals`);
  }
});
