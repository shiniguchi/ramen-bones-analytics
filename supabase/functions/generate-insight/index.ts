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
  description:
    "Emit the headline, body, and action-point bullets for today's dashboard insight card.",
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
      action_points: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "string",
          description: "Bullet, max 60 chars, no trailing period.",
        },
        description: "2-3 observational bullets on the most notable movements.",
      },
    },
    required: ["headline", "body", "action_points"],
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

  const results: Array<{ restaurant_id: string; ok: boolean; fallback: boolean; reason?: string }> = [];
  for (const t of tenants ?? []) {
    const r = await generateForTenant(t.id as string, (t.timezone as string) ?? "Europe/Berlin");
    results.push(r);
  }
  return Response.json({ results });
});

async function generateForTenant(restaurantId: string, tz: string) {
  const payload = await buildPayload(supabase, restaurantId);
  // business_date = the Sunday that closes the most recent complete Mon–Sun
  // week in the data (computed by buildPayload). The card's "Week ending"
  // label reads from this field, so aligning it with the aggregate window
  // keeps the UI honest. Fall back to the tenant-local today date only if
  // the data is empty / unparseable (edge case — fresh tenants).
  const businessDate = payload.week_ending || deriveBusinessDate(tz);
  // Allowed-digit set derived from the exact JSON the LLM will see — no drift.
  const allowed = flattenNumbers(payload);
  // Whitelist window-size constants that appear in prompt examples + fallback
  // template labels ("Past 7 days", "Last 4 weeks", "Four-week" etc.). These
  // are structural tokens, not data values — if the payload happens to contain
  // these digits they'd already be in `allowed`; if not, these additions make
  // the window labels emittable without forcing awkward workarounds.
  for (const lit of ["7", "4", "28"]) allowed.add(lit);

  let headline: string | null = null;
  let body: string | null = null;
  let actionPoints: string[] = [];
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      // 600 (up from 400) to fit headline + body + 2-3 bullets within one tool call.
      max_tokens: 600,
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
    const input = (toolBlock as {
      input: { headline?: unknown; body?: unknown; action_points?: unknown };
    }).input;
    if (
      typeof input.headline !== "string" ||
      typeof input.body !== "string" ||
      input.headline.length === 0 ||
      input.body.length === 0
    ) {
      throw new Error("invalid shape");
    }
    // action_points: must be an array of 2-3 non-empty strings. minItems/maxItems
    // in the tool schema is advisory; Anthropic does not strictly enforce it, so
    // we re-check here and route any shape drift to the deterministic fallback.
    const ap = input.action_points;
    if (
      !Array.isArray(ap) ||
      ap.length < 2 ||
      ap.length > 3 ||
      ap.some((b) => typeof b !== "string" || (b as string).length === 0)
    ) {
      throw new Error("invalid action_points shape");
    }
    const bullets = ap as string[];

    // Digit-guard: every numeric token in LLM output must trace back to the payload.
    // Same `allowed` set covers all three fields — no new payload traversal.
    if (
      !digitGuardOk(input.headline, allowed) ||
      !digitGuardOk(input.body, allowed) ||
      bullets.some((b) => !digitGuardOk(b, allowed))
    ) {
      throw new Error("digit-guard rejected");
    }

    headline = input.headline;
    body = input.body;
    actionPoints = bullets;
  } catch (err) {
    // Any failure in the LLM path — network, shape, digit-guard — routes to fallback.
    // Logging the reason keeps "why did we fall back" observable in function logs.
    fallbackReason = (err as Error).message;
    console.error(
      `[generate-insight] tenant=${restaurantId} fallback reason=${fallbackReason}`,
    );
    const fb = buildFallback(deriveFallbackInput(payload));
    headline = fb.headline;
    body = fb.body;
    actionPoints = fb.action_points;
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
        action_points: actionPoints,
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
    return { restaurant_id: restaurantId, ok: false, fallback: fallbackUsed, reason: fallbackReason };
  }
  return { restaurant_id: restaurantId, ok: true, fallback: fallbackUsed, reason: fallbackReason };
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

// Collapse payload into the scalars the fallback template needs.
// today_* fields are retained for back-compat but no longer rendered by the
// weekly-voice template — weekly refresh cadence means single-day values
// would mislead readers on days between refreshes.
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
    last_week_revenue_int: Math.round(p.kpi.last_week_revenue),
    last_week_delta_pct: Math.abs(Math.round(p.kpi.last_week_delta_pct)),
    last_week_delta_sign: sign(p.kpi.last_week_delta_pct),
    last_four_weeks_revenue_int: Math.round(p.kpi.last_four_weeks_revenue),
    last_four_weeks_delta_pct: Math.abs(Math.round(p.kpi.last_four_weeks_delta_pct)),
    last_four_weeks_delta_sign: sign(p.kpi.last_four_weeks_delta_pct),
    returning_pct: returningPct,
  };
}
