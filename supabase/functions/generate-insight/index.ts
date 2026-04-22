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

// Locales emitted per insight. Must stay in sync with src/lib/i18n/locales.ts
// LOCALES and supabase/migrations/0038 admin_update_insight v_locales.
// Forkers can narrow via the INSIGHT_LOCALES env var (comma-separated).
const DEFAULT_LOCALES = ["en", "de", "ja", "es", "fr"] as const;
type Locale = (typeof DEFAULT_LOCALES)[number];
const LOCALES: readonly Locale[] = (() => {
  const raw = Deno.env.get("INSIGHT_LOCALES");
  if (!raw) return DEFAULT_LOCALES;
  const parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const known = new Set<string>(DEFAULT_LOCALES);
  const narrowed = parsed.filter((l): l is Locale => known.has(l));
  // Always keep 'en' — it's the safety net for digit-guard failures + InsightCard fallback.
  return narrowed.includes("en") ? narrowed : ["en", ...narrowed] as Locale[];
})();

// Secrets come from Deno.env ONLY — never hardcoded (INS-04, D-15).
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

// Tool-use schema — single locale per call. The earlier single-call,
// multi-locale schema proved unreliable in practice (Haiku 4.5 emitted only
// the first required key). Calling the tool once per locale keeps each
// request small, gives the model one job at a time, and isolates digit-guard
// failures to the one locale that produced them. Cost stays cheap — ~$0.005
// per tenant per weekly run across 5 locales.
const TOOL = {
  name: "emit_insight",
  description:
    "Emit the headline, body, and action-point bullets for today's dashboard insight card in the requested locale.",
  input_schema: {
    type: "object",
    required: ["headline", "body", "action_points"],
    properties: {
      headline: { type: "string", description: "One sentence, max 80 chars, no trailing period." },
      body: { type: "string", description: "2-3 sentences, max 280 chars total." },
      action_points: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: { type: "string", description: "Bullet, max 60 chars, no trailing period." },
        description: "2-3 observational bullets on the most notable movements.",
      },
    },
  },
} as const;

const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "German (Deutsch)",
  ja: "Japanese (日本語)",
  es: "Spanish (Español)",
  fr: "French (Français)",
};

type LocaleEntry = { headline: string; body: string; action_points: string[] };

function validateEntry(e: unknown): e is LocaleEntry {
  if (!e || typeof e !== "object") return false;
  const o = e as { headline?: unknown; body?: unknown; action_points?: unknown };
  if (typeof o.headline !== "string" || o.headline.length === 0) return false;
  if (typeof o.body !== "string" || o.body.length === 0) return false;
  if (!Array.isArray(o.action_points)) return false;
  const ap = o.action_points;
  if (ap.length < 2 || ap.length > 3) return false;
  return ap.every((b) => typeof b === "string" && b.length > 0);
}

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

  // Per-locale insight entries. English is always present and acts as the
  // safety net — if the LLM fails entirely, every locale gets the English
  // deterministic fallback. If only a specific locale fails digit-guard,
  // that one locale is replaced with the English fallback while others
  // keep the LLM output.
  const englishFallback: LocaleEntry = (() => {
    const fb = buildFallback(deriveFallbackInput(payload));
    return { headline: fb.headline, body: fb.body, action_points: fb.action_points };
  })();

  const localeEntries: Record<Locale, LocaleEntry> = Object.fromEntries(
    LOCALES.map((l) => [l, englishFallback]),
  ) as Record<Locale, LocaleEntry>;

  let fallbackUsed = false;
  const localeFailures: string[] = [];

  // One Haiku call per locale. Each request has a simple single-locale tool
  // schema — far more reliable than one call with 5 required nested objects
  // (which in testing produced only the first locale). Per-locale try/catch
  // isolates failures: any one locale that fails shape, digit-guard, or the
  // network keeps the pre-seeded English fallback for just that locale.
  for (const loc of LOCALES) {
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        // 800 tokens per locale — fits headline + body + 3 bullets with
        // generous margin for Japanese (higher tokens-per-char).
        max_tokens: 800,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "emit_insight" },
        messages: [
          {
            role: "user",
            content:
              `INPUT DATA JSON:\n${JSON.stringify(payload)}\n\n` +
              `RESPOND IN ${LOCALE_NAMES[loc]}. Every number, currency symbol (€), ` +
              `percent sign (%), and arrow glyph (▲ ▼ —) must appear verbatim as in ` +
              `the INPUT DATA — only translate prose.`,
          },
        ],
      });
      // deno-lint-ignore no-explicit-any
      const toolBlock = msg.content.find((c: any) => c.type === "tool_use");
      if (!toolBlock || typeof (toolBlock as { input: unknown }).input !== "object") {
        throw new Error("tool_use block missing");
      }
      const entry = (toolBlock as { input: unknown }).input;
      if (!validateEntry(entry)) throw new Error("invalid shape");

      const digitOk =
        digitGuardOk(entry.headline, allowed) &&
        digitGuardOk(entry.body, allowed) &&
        entry.action_points.every((b) => digitGuardOk(b, allowed));
      if (!digitOk) throw new Error("digit-guard rejected");

      localeEntries[loc] = entry;
    } catch (err) {
      const reason = (err as Error).message ?? "unknown";
      localeFailures.push(`${loc}:${reason}`);
      fallbackUsed = true;
      // localeEntries[loc] already seeded with englishFallback above.
    }
  }

  let fallbackReason: string | undefined;
  if (localeFailures.length > 0) {
    fallbackReason = `locale-level failures: ${localeFailures.join(",")}`;
    console.error(
      `[generate-insight] tenant=${restaurantId} ${fallbackReason}`,
    );
  }

  // Upsert so re-runs on the same business_date overwrite (idempotent).
  // Writes i18n jsonb; the 0037 trigger mirrors i18n.en into the scalar
  // headline/body/action_points columns so legacy readers keep working.
  const { error: upsertErr } = await supabase
    .from("insights")
    .upsert(
      {
        restaurant_id: restaurantId,
        business_date: businessDate,
        i18n: localeEntries,
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
  // Read euros from p.display.*_eur — NOT p.kpi.*_revenue (those are cents).
  // The LLM path uses the same euro fields (per prompt.ts CURRENCY SOURCE
  // rules); the fallback must match to keep numbers consistent whether the
  // row came from Haiku or the deterministic path.
  return {
    today_revenue_int: p.display.today_revenue_eur,
    today_delta_pct: Math.abs(Math.round(p.kpi.today_delta_pct)),
    today_delta_sign: sign(p.kpi.today_delta_pct),
    last_week_revenue_int: p.display.last_week_revenue_eur,
    last_week_delta_pct: Math.abs(Math.round(p.kpi.last_week_delta_pct)),
    last_week_delta_sign: sign(p.kpi.last_week_delta_pct),
    last_four_weeks_revenue_int: p.display.last_four_weeks_revenue_eur,
    last_four_weeks_delta_pct: Math.abs(Math.round(p.kpi.last_four_weeks_delta_pct)),
    last_four_weeks_delta_sign: sign(p.kpi.last_four_weeks_delta_pct),
    returning_pct: returningPct,
  };
}
