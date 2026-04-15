// Supabase Edge Function: generate-insight
// Nightly pipeline invoked by pg_cron → pg_net after MV refresh.
// For every restaurant: build payload → call Haiku tool-use → validate shape +
// digit-guard → upsert into public.insights. Any failure falls back to the
// deterministic template (never fails open, never writes nothing).

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { digitGuardOk, flattenNumbers } from "./digitGuard.ts";
import { buildFallback } from "./fallback.ts";
import { buildPayload, type InsightPayload } from "./payload.ts";

// Haiku 4.5 — D-08. Cheap, fast, more than enough for 80-char headlines.
const MODEL = "claude-haiku-4-5";

// Secrets come from Deno.env ONLY — never hardcoded (INS-04, D-15).
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

// Tool-use schema — forces Haiku to emit structured JSON instead of freeform text.
const TOOL = {
  name: "emit_insight",
  description: "Emit the headline and body for today's dashboard insight card.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "One sentence, max 80 chars, no trailing period.",
      },
      body: {
        type: "string",
        description: "2-3 sentences, max 280 chars total.",
      },
    },
    required: ["headline", "body"],
  },
} as const;

// HTTP entrypoint — pg_cron hits this with service-role bearer token.
Deno.serve(async (req) => {
  // Bearer gate: pg_cron is the only expected caller; anon must be rejected.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response("unauthorized", { status: 401 });
  }

  // Fetch all tenants; loop even though v1 is single-tenant (multi-tenant-ready per PROJECT.md).
  const { data: tenants, error: tErr } = await supabase
    .from("restaurants")
    .select("id, timezone");
  if (tErr) {
    return new Response(`tenant fetch failed: ${tErr.message}`, { status: 500 });
  }

  const results: Array<{ restaurant_id: string; ok: boolean; fallback: boolean }> = [];
  for (const t of tenants ?? []) {
    const r = await generateForTenant(t.id as string, (t.timezone as string) ?? "Europe/Berlin");
    results.push(r);
  }
  return Response.json({ results });
});

async function generateForTenant(restaurantId: string, tz: string) {
  const businessDate = deriveBusinessDate(tz);
  const payload = await buildPayload(supabase, restaurantId);
  // Allowed-digit set derived from the exact JSON the LLM will see — no drift.
  const allowed = flattenNumbers(payload);

  let headline: string | null = null;
  let body: string | null = null;
  let fallbackUsed = false;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "emit_insight" },
      messages: [
        { role: "user", content: `INPUT DATA JSON:\n${JSON.stringify(payload)}` },
      ],
    });

    // Tool-use responses arrive as a content block with type "tool_use".
    // deno-lint-ignore no-explicit-any
    const toolBlock = msg.content.find((c: any) => c.type === "tool_use");
    if (!toolBlock || typeof (toolBlock as { input: unknown }).input !== "object") {
      throw new Error("tool_use block missing");
    }
    const input = (toolBlock as { input: { headline?: unknown; body?: unknown } }).input;
    if (
      typeof input.headline !== "string" ||
      typeof input.body !== "string" ||
      input.headline.length === 0 ||
      input.body.length === 0
    ) {
      throw new Error("invalid shape");
    }

    // Digit-guard: every numeric token in LLM output must trace back to the payload.
    if (!digitGuardOk(input.headline, allowed) || !digitGuardOk(input.body, allowed)) {
      throw new Error("digit-guard rejected");
    }

    headline = input.headline;
    body = input.body;
  } catch (err) {
    // Any failure in the LLM path — network, shape, digit-guard — routes to fallback.
    // Logging the reason keeps "why did we fall back" observable in function logs.
    console.error(
      `[generate-insight] tenant=${restaurantId} fallback reason=${(err as Error).message}`,
    );
    const fb = buildFallback(deriveFallbackInput(payload));
    headline = fb.headline;
    body = fb.body;
    fallbackUsed = true;
  }

  // Upsert so re-runs on the same business_date overwrite (idempotent).
  const { error: upsertErr } = await supabase
    .from("insights")
    .upsert(
      {
        restaurant_id: restaurantId,
        business_date: businessDate,
        headline,
        body,
        input_payload: payload,
        model: MODEL,
        fallback_used: fallbackUsed,
      },
      { onConflict: "restaurant_id,business_date" },
    );

  if (upsertErr) {
    console.error(
      `[generate-insight] upsert failed tenant=${restaurantId}: ${upsertErr.message}`,
    );
    return { restaurant_id: restaurantId, ok: false, fallback: fallbackUsed };
  }
  return { restaurant_id: restaurantId, ok: true, fallback: fallbackUsed };
}

// YYYY-MM-DD in the restaurant's local timezone — avoids Phase 1 off-by-one bug.
function deriveBusinessDate(tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// Collapse payload into the 7 scalars the fallback template needs.
function deriveFallbackInput(p: InsightPayload) {
  const sign = (d: number): "up" | "down" | "flat" =>
    d > 1 ? "up" : d < -1 ? "down" : "flat";
  const nvr = p.new_vs_returning;
  const total = nvr.new_revenue + nvr.returning_revenue + nvr.cash_revenue;
  const returningPct = total > 0 ? Math.round((nvr.returning_revenue / total) * 100) : 0;
  return {
    today_revenue_int: Math.round(p.kpi.today_revenue),
    today_delta_pct: Math.abs(Math.round(p.kpi.today_delta_pct)),
    today_delta_sign: sign(p.kpi.today_delta_pct),
    seven_d_revenue_int: Math.round(p.kpi.seven_d_revenue),
    seven_d_delta_pct: Math.abs(Math.round(p.kpi.seven_d_delta_pct)),
    seven_d_delta_sign: sign(p.kpi.seven_d_delta_pct),
    returning_pct: returningPct,
  };
}
