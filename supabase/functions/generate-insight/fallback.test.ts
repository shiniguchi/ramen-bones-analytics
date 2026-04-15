import { assertEquals, assertStringIncludes } from "std/assert";
import { buildFallback } from "./fallback.ts";

Deno.test("buildFallback produces headline with today revenue and delta", () => {
  const out = buildFallback({
    today_revenue_int: 4280,
    today_delta_pct: 8,
    today_delta_sign: "down",
    seven_d_revenue_int: 28140,
    seven_d_delta_pct: 6,
    seven_d_delta_sign: "down",
    returning_pct: 62,
  });
  assertStringIncludes(out.headline, "€4280");
  assertStringIncludes(out.headline, "8%");
});

Deno.test("buildFallback body references 7d revenue and returning_pct", () => {
  const out = buildFallback({
    today_revenue_int: 4280,
    today_delta_pct: 8,
    today_delta_sign: "down",
    seven_d_revenue_int: 28140,
    seven_d_delta_pct: 6,
    seven_d_delta_sign: "down",
    returning_pct: 62,
  });
  assertStringIncludes(out.body, "€28140");
  assertStringIncludes(out.body, "62%");
});

Deno.test("buildFallback handles zero today revenue edge case", () => {
  const out = buildFallback({
    today_revenue_int: 0,
    today_delta_pct: 0,
    today_delta_sign: "flat",
    seven_d_revenue_int: 28140,
    seven_d_delta_pct: 0,
    seven_d_delta_sign: "flat",
    returning_pct: 62,
  });
  assertStringIncludes(out.headline, "No transactions recorded today");
  assertStringIncludes(out.headline, "€28140");
});

Deno.test("buildFallback handles zero returning_pct edge case", () => {
  const out = buildFallback({
    today_revenue_int: 4280,
    today_delta_pct: 8,
    today_delta_sign: "down",
    seven_d_revenue_int: 28140,
    seven_d_delta_pct: 6,
    seven_d_delta_sign: "down",
    returning_pct: 0,
  });
  assertStringIncludes(out.body, "No repeat customers");
});

Deno.test("buildFallback output passes digit-guard against its own payload (tautology check)", () => {
  // Composition check: every digit in the fallback output must appear in the input payload,
  // otherwise the template itself would fail the digit-guard by construction.
  const input = {
    today_revenue_int: 4280,
    seven_d_revenue_int: 28140,
    returning_pct: 62,
    today_delta_pct: 8,
    seven_d_delta_pct: 6,
  };
  const out = buildFallback({
    ...input,
    today_delta_sign: "down",
    seven_d_delta_sign: "down",
  });
  const allowedDigits = new Set(Object.values(input).map(String));
  const outputDigits = (out.headline + " " + out.body).match(/\d+/g) ?? [];
  for (const d of outputDigits) {
    assertEquals(allowedDigits.has(d), true, `digit ${d} from output not in payload`);
  }
});
