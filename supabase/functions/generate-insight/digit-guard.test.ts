import { assertEquals, assertStrictEquals } from "std/assert";
import { digitGuardOk, flattenNumbers } from "./digitGuard.ts";

Deno.test("flattenNumbers extracts all digit runs from nested JSON", () => {
  const payload = { revenue: 4280, delta: "▼ 18%", nested: { count: 62 } };
  const out = flattenNumbers(payload);
  assertEquals(out.has("4280"), true);
  assertEquals(out.has("18"), true);
  assertEquals(out.has("62"), true);
});

Deno.test("flattenNumbers normalizes commas to dots for decimals", () => {
  const payload = { avg_ticket: "12,50" };
  const out = flattenNumbers(payload);
  assertEquals(out.has("12.50"), true);
});

Deno.test("digitGuardOk accepts output whose digits are all in allowed set", () => {
  const allowed = new Set(["4280", "18", "620", "2840"]);
  const ok = digitGuardOk("Weekend slipped 18%, €620 below prior. Weekday held at €2840.", allowed);
  assertStrictEquals(ok, true);
});

Deno.test("digitGuardOk REJECTS output containing a hallucinated digit", () => {
  const allowed = new Set(["4280", "18"]);
  const ok = digitGuardOk("Revenue was €4280, up 18% — from €3600 prior.", allowed);
  assertStrictEquals(ok, false);
});

Deno.test("digitGuardOk REJECTS rounding (4.3k not in allowed set for 4280)", () => {
  const allowed = new Set(["4280"]);
  const ok = digitGuardOk("Revenue held at €4.3k this week.", allowed);
  assertStrictEquals(ok, false);
});

Deno.test("digitGuardOk normalizes output commas to dots before comparison", () => {
  const allowed = new Set(["12.50"]);
  const ok = digitGuardOk("Avg ticket was €12,50.", allowed);
  assertStrictEquals(ok, true);
});

Deno.test("digitGuardOk passes on a string with zero digits", () => {
  const allowed = new Set<string>();
  assertStrictEquals(digitGuardOk("Steady week. No standout moves.", allowed), true);
});

Deno.test("flattenNumbers walks arrays", () => {
  const out = flattenNumbers({ cohorts: [{ size: 12 }, { size: 34 }] });
  assertEquals(out.has("12"), true);
  assertEquals(out.has("34"), true);
});
