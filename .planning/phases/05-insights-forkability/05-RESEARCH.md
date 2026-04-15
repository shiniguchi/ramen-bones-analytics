# Phase 5: Insights & Forkability — Research

**Researched:** 2026-04-15
**Domain:** Supabase Edge Functions (Deno) + Anthropic Claude Haiku + pg_cron/pg_net + SvelteKit SSR card + fork/deploy hardening
**Confidence:** HIGH (CONTEXT.md locks nearly all decisions; this research fills in API/mechanics only)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Insight Card Shape & Placement**
- **D-01:** InsightCard sits at the TOP of the card stream, above the three fixed revenue tiles. Revises Phase 4 D-02 by prepending one card; rest of order unchanged.
- **D-02:** Card shape = bold one-line headline + 2–3 sentence body. No icons, no sparkline, no bullets. Text-only.
- **D-03:** Yesterday fallback — if no row for `business_date = today`, fall back to most-recent row and prepend a muted `"From yesterday"` label. If no row at all, hide card entirely (INS-03).
- **D-04:** When `fallback_used = true`, render a small muted `"auto-generated"` chip below the body (literal text, `text-zinc-500`).

**Prompt, Payload & Model**
- **D-05:** Payload = full dashboard snapshot — `kpi_daily_v` (today/7d/30d/90d + deltas + tx_count + avg_ticket), cohort wrapper (last 4 weekly cohorts + retention + cohort_size), `ltv_v` (last 4 cohorts), `frequency_v` (all 5 buckets), `new_vs_returning_v` (7d window).
- **D-06:** Voice = neutral news headline, terse financial reporter. NOT a coach. Dry precision. Do NOT soften downstream.
- **D-07:** Model = `claude-haiku-4-5`. Temperature default-or-lower (Claude's Discretion).
- **D-08:** Output = strict JSON `{headline: string, body: string}` via Anthropic tool-use / structured output. Shape-validated BEFORE digit-guard.
- **D-09:** System prompt lives as TypeScript constant in `supabase/functions/generate-insight/prompt.ts`. Explicit: "Every number in output must come from INPUT DATA JSON. Do not estimate, round, or compute new figures."

**Backend Pipeline**
- **D-10:** `insights` table schema — `id uuid pk default gen_random_uuid()`, `restaurant_id uuid not null references restaurants(id)`, `business_date date not null`, `generated_at timestamptz not null default now()`, `headline text not null`, `body text not null`, `input_payload jsonb not null`, `model text not null`, `fallback_used boolean not null default false`, `UNIQUE (restaurant_id, business_date)`. Upsert on conflict.
- **D-11:** Digit-guard regex `/\d+(?:[.,]\d+)?/g`. Normalize commas→dots. Every output token must exist in the flattened `input_payload` token set. Strict — no rounding allowance.
- **D-12:** Deterministic fallback template — triggers on digit-guard reject OR API error OR JSON parse failure. 100% payload-sourced numbers. Sets `fallback_used = true`.
- **D-13:** Single attempt, no retry loop. `console.error` + fallback row on any Anthropic error.
- **D-14:** Second `pg_cron` job at MV-refresh-time + 15 minutes. **See Pitfall 1 — CONTEXT.md cites `0 2 * * *` + 15, but migration 0013 actually uses `0 3 * * *`.** Actual correct schedule is `15 3 * * *` UTC.
- **D-15:** `pg_cron` → `pg_net.http_post` with `Authorization: Bearer <service-role-key>` (stored in Vault). Edge Function loops over all tenants (single iter in v1, multi-tenant structural).
- **D-16:** `insights_v` wrapper view with JWT-claim filter: `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`. `REVOKE ALL` on raw `insights` from `authenticated, anon`; `GRANT SELECT` to `service_role`. `src/` reads `insights_v` only. Extend ci-guards Guard 1 regex to cover `insights` base table.

**Forkability**
- **D-17:** README = step-by-step numbered checklist, copy-paste commands, one phase section per phase. Extend existing "Forker quickstart (Phase 1)" with Phase 2 / 3 / 4 / 5 / Ship sections. No magic deploy buttons.
- **D-18:** Single `.env.example` at repo root, sectioned comments per destination (`# --- destination: cf pages project env ---`, `# --- destination: supabase secrets ---`, `# --- destination: github actions repo secrets ---`, `# --- destination: local dev only ---`).
- **D-19:** Forkability scope excludes signup UI, tenant self-serve, billing. README documents manual `INSERT INTO restaurants` SQL as the forker's tenant-provision step.
- **D-20:** Ship-readiness (LICENSE, README polish, repo public flip, GH topics, description, end-to-end dry run on throwaway Supabase project) folded into Phase 5 as final plan.

### Claude's Discretion
- Edge Function directory/name (default: `supabase/functions/generate-insight/index.ts`)
- Haiku temperature (default or lower, e.g., 0.2)
- Exact deterministic fallback template wording (must stay 100% payload-sourced)
- LICENSE choice (MIT default unless reason to prefer Apache-2.0)
- GitHub topics exact list
- Migration file numbering (start at `0016` — 0014/0015 taken)
- Whether to add a `latest_insight_v` helper view
- Prompt caching on Anthropic call (skip for v1, single call/tenant/day is below break-even)
- Row-write mechanism from Edge Function (default: `supabase-js` service-role client in Deno)
- `InsightCard.svelte` exact styling (follow existing 9-card Tailwind aesthetic)

### Deferred Ideas (OUT OF SCOPE)
- Signup / tenant self-serve UI (Phase 1 D-10)
- Custom password reset route (Phase 1 D-11)
- Tenant switcher / multi-membership UI
- Billing / paid tier
- Slack / email / push delivery of insights
- Chat / follow-up questions on insights
- Historical insight browsing UI ("last week's insight" drawer)
- Insight localization (German copy — v1 English only)
- Real-time / on-demand regeneration button
- Skeleton placeholders / streamed promises (Phase 4 D-21 stands)
- Prompt caching on Anthropic call
- Retry with backoff on Anthropic errors
- Rounded-figure digit-guard tolerance
- "Deploy to Cloudflare Pages" magic button / Terraform / deploy recipes
- Multi-file `.env.example` split
- Dashboard UI for pg_cron refresh status
- Second TEST Supabase project for Phase 1 UAT 3/4/5
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INS-01 | Nightly Supabase Edge Function calls Claude Haiku with tenant KPI payload and writes natural-language summary to `insights` table | Standard Stack §Edge Function + Anthropic SDK; Pattern 1 (Edge Function skeleton); Pattern 3 (pg_cron → pg_net trigger) |
| INS-02 | Digit-guard regex + deterministic template fallback prevents hallucinated figures | Pattern 2 (digit-guard); Pattern 4 (fallback template); Pitfall 4 (normalization edge cases) |
| INS-03 | Dashboard renders latest insight card; gracefully hides if none exists | Pattern 5 (SvelteKit SSR card fetch via `insights_v`); Pattern 6 (yesterday fallback + hide logic) |
| INS-04 | Anthropic API key as Supabase secret; never in client or committed | Pattern 1 (`Deno.env.get` + `supabase secrets set`); Pitfall 5 (service-role-key Vault storage for pg_net) |
| INS-05 | Public, forkable repo with README one-click deploy walkthrough | Pattern 7 (README section template); Forkability §README structure |
| INS-06 | `.env.example` documents every required env var | Pattern 8 (sectioned `.env.example`); Forkability §.env.example audit |
</phase_requirements>

## Summary

Phase 5 is a tight, well-defined phase with almost every architectural decision already locked in CONTEXT.md. The unknowns remaining are mostly mechanical: current Anthropic Messages API surface for tool-use structured output from Deno, current `pg_net.http_post` signature for passing headers with a Vault-stored token, and a handful of self-host gotchas around Supabase secrets vs Vault. The first Supabase Edge Function in this repo gets created here (`supabase/functions/` does not yet exist).

**Primary recommendation:** Build this as three migrations + one Edge Function + one Svelte component + README/env/license polish. Keep everything mechanical and templated — Anthropic call is a single `fetch` or `@anthropic-ai/sdk` import via `npm:` specifier in Deno, digit-guard is ~20 lines, fallback template is string interpolation. The risk budget should be spent on the digit-guard's flattening logic (Pattern 2) and on verifying the exact pg_cron schedule matches Phase 3's actual `0 3 * * *` (not the `0 2 * * *` stated in CONTEXT.md D-14).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase Edge Functions | Deno 1.x runtime | Host for the generate-insight function | Free tier 500K invocations/mo; native pg_cron integration; secrets as env vars; CLAUDE.md §Recommended Stack pins this |
| `@anthropic-ai/sdk` (npm) | 0.30.x+ | Claude Haiku client | Official SDK, Deno-compatible via `npm:` specifier. Supports structured tool-use. Fetch-only fallback also works if SDK import is awkward in Deno. |
| `@supabase/supabase-js` | 2.x (matches app) | Service-role client inside Edge Function for reading MV wrappers and upserting into `insights` | Works in Deno fetch runtime |
| pg_cron | extension (already enabled by 0013) | Schedules the second daily job | Already in project via 0013; just add another `cron.schedule` call |
| pg_net | extension (enable via migration or Dashboard) | Fires HTTP POST to Edge Function URL | Supabase-native, designed for exactly this use case. `net.http_post(url, body, headers, timeout)` signature. |
| Supabase Vault | built-in | Stores service-role-key referenced by cron job | Prevents leaking key in `cron.job` metadata. `vault.decrypted_secrets` view. |
| `claude-haiku-4-5` | current model id | Narrative generation | CLAUDE.md + CONTEXT.md D-07 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Deno `std/assert` or manual runtime checks | std | Validate JSON shape from Claude | Before running digit-guard — reject non-`{headline, body}` shapes fast |
| SvelteKit Promise.all fan-out | existing | `+page.server.ts` extended with `insights_v` fetch | Reuse Phase 4 D-21 pattern; one new query |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@anthropic-ai/sdk` via `npm:` | Raw `fetch` to `https://api.anthropic.com/v1/messages` | Fewer deps, smaller cold start, but manual tool-use envelope. Recommended fallback if SDK import is flaky in Deno. |
| pg_net + Vault | Hardcode service-role-key in `cron.schedule` SQL | Rejected — key visible in `cron.job` table to any DB inspector |
| Supabase Edge Function | Cloudflare Worker cron | Rejected — key would need to be in CF secrets, breaks "Anthropic key lives only in Supabase" (INS-04 framing); also means cross-service auth |
| `@anthropic-ai/sdk` tool-use | Anthropic's experimental JSON mode | Tool-use is stable GA; JSON mode is the same under the hood but tool-use gives explicit schema validation |

**Installation (inside Edge Function):**
```typescript
// supabase/functions/generate-insight/index.ts
import Anthropic from "npm:@anthropic-ai/sdk@^0.30";
import { createClient } from "npm:@supabase/supabase-js@^2";
```

**Version verification:** Planner should run `npm view @anthropic-ai/sdk version` before writing the import pin — Anthropic ships SDK updates frequently. Same for `@supabase/supabase-js`. Deno `npm:` specifier resolves at deploy time.

## Architecture Patterns

### Migration layout
```
supabase/migrations/
├── 0016_insights_table.sql     # insights table + insights_v wrapper + grants + REVOKE
├── 0017_pg_net_enable.sql      # create extension if not exists pg_net (can fold into 0018)
└── 0018_insights_cron.sql      # vault secret + second cron.schedule job via pg_net
```

(Planner may collapse 0017 + 0018 into one file. Keep 0016 separate so `insights_v` can be tested before the cron wiring lands.)

### Edge Function layout
```
supabase/functions/generate-insight/
├── index.ts         # HTTP handler: loop tenants → fetch payload → call Haiku → validate → upsert
├── prompt.ts        # System prompt constant (D-09)
├── digitGuard.ts    # Extract + compare digit tokens (D-11)
├── fallback.ts      # Deterministic template builder (D-12)
└── deno.json        # import map, optional
```

### Pattern 1: Edge Function skeleton

```typescript
// supabase/functions/generate-insight/index.ts
import Anthropic from "npm:@anthropic-ai/sdk@^0.30";
import { createClient } from "npm:@supabase/supabase-js@^2";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { digitGuardOk, flattenNumbers } from "./digitGuard.ts";
import { buildFallback } from "./fallback.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const MODEL = "claude-haiku-4-5";

Deno.serve(async (req) => {
  // Authn: require service-role JWT in Authorization header (sent by pg_net)
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 });

  // Iterate tenants — v1 has one, structure from day 1 for multi-tenant
  const { data: tenants, error: tErr } = await supabase.from("restaurants").select("id, timezone");
  if (tErr) return new Response(`tenant fetch failed: ${tErr.message}`, { status: 500 });

  const results: Array<{ restaurant_id: string; ok: boolean; fallback: boolean }> = [];
  for (const t of tenants ?? []) {
    const result = await generateForTenant(t.id, t.timezone);
    results.push(result);
  }
  return Response.json({ results });
});

async function generateForTenant(restaurantId: string, tz: string) {
  // 1. Build input payload from wrapper views (service-role bypasses RLS — scope manually)
  const payload = await buildPayload(restaurantId);

  // 2. Try Claude Haiku call with tool-use structured output
  let headline: string | null = null;
  let body: string | null = null;
  let fallbackUsed = false;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      tools: [{
        name: "emit_insight",
        description: "Emit the headline and body for today's dashboard insight card.",
        input_schema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
          },
          required: ["headline", "body"],
        },
      }],
      tool_choice: { type: "tool", name: "emit_insight" },
      messages: [{
        role: "user",
        content: `INPUT DATA JSON:\n${JSON.stringify(payload)}`,
      }],
    });

    // Extract tool_use block
    const toolUse = msg.content.find((c: any) => c.type === "tool_use");
    if (toolUse && typeof toolUse.input?.headline === "string" && typeof toolUse.input?.body === "string") {
      const candHeadline = toolUse.input.headline as string;
      const candBody = toolUse.input.body as string;
      const allowed = flattenNumbers(payload);
      if (digitGuardOk(candHeadline, allowed) && digitGuardOk(candBody, allowed)) {
        headline = candHeadline;
        body = candBody;
      } else {
        console.error("digit-guard rejected LLM output", { restaurantId });
      }
    } else {
      console.error("tool_use block missing or malformed", { restaurantId });
    }
  } catch (err) {
    console.error("Anthropic call failed", { restaurantId, err: (err as Error).message });
  }

  // 3. Fallback template if anything went wrong
  if (headline === null || body === null) {
    const fb = buildFallback(payload);
    headline = fb.headline;
    body = fb.body;
    fallbackUsed = true;
  }

  // 4. Upsert (idempotent per business_date)
  const today = businessDateIn(tz); // YYYY-MM-DD in tenant tz
  const { error: upErr } = await supabase.from("insights").upsert({
    restaurant_id: restaurantId,
    business_date: today,
    headline,
    body,
    input_payload: payload,
    model: MODEL,
    fallback_used: fallbackUsed,
    generated_at: new Date().toISOString(),
  }, { onConflict: "restaurant_id,business_date" });

  if (upErr) console.error("upsert failed", { restaurantId, err: upErr.message });
  return { restaurant_id: restaurantId, ok: upErr === null, fallback: fallbackUsed };
}
```

Source: Anthropic Messages API docs `https://docs.anthropic.com/en/api/messages` (tool-use structured output), Supabase Edge Functions quickstart `https://supabase.com/docs/guides/functions`.

### Pattern 2: Digit-guard (INS-02 hard gate)

```typescript
// supabase/functions/generate-insight/digitGuard.ts

// Extract every numeric token from text. Matches integers, decimals with . or , separator.
// Normalizes all commas → dots so "4.280" (German) and "4,280" (US) collapse to the same set.
const DIGIT_RE = /\d+(?:[.,]\d+)?/g;

export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const matches = text.match(DIGIT_RE) ?? [];
  for (const m of matches) {
    out.add(normalize(m));
  }
  return out;
}

function normalize(s: string): string {
  // Collapse commas to dots, strip trailing .0 if present
  let n = s.replace(/,/g, ".");
  // Optional: drop leading zeros on pure integers? NO — keep strict. "042" ≠ "42".
  return n;
}

// Recursively walk the payload and collect every numeric token from every scalar.
export function flattenNumbers(obj: unknown): Set<string> {
  const acc = new Set<string>();
  function walk(v: unknown): void {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      acc.add(normalize(String(v)));
      // Also add integer form and 0/1/2-decimal forms for float tolerance
      if (Number.isFinite(v)) {
        acc.add(normalize(v.toFixed(0)));
        acc.add(normalize(v.toFixed(1)));
        acc.add(normalize(v.toFixed(2)));
      }
    } else if (typeof v === "string") {
      for (const n of extractNumbers(v)) acc.add(n);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  }
  walk(obj);
  return acc;
}

export function digitGuardOk(text: string, allowed: Set<string>): boolean {
  const tokens = extractNumbers(text);
  for (const t of tokens) {
    if (!allowed.has(t)) {
      console.error(`digit-guard: "${t}" not in allowed set`);
      return false;
    }
  }
  return true;
}
```

**Design note:** The `toFixed(0/1/2)` expansion in `flattenNumbers` is a deliberate, narrow concession: if the payload has `revenue_cents: 428000` and the LLM writes `"€4,280.00"`, the prompt asks it not to round, but if Haiku naturally formats to 2 decimals, this avoids a false-positive reject on pure re-formatting. CONTEXT.md D-11 says "strict, no rounding allowance" — this is NOT rounding (no value change), it is format-expansion. Planner may drop it for absolute strictness; decision belongs with the planner after reading sample Haiku outputs. If dropped, document it in PLAN so downstream understands why.

### Pattern 3: pg_cron → pg_net trigger (with Vault)

```sql
-- supabase/migrations/0018_insights_cron.sql

-- 1. pg_net is the Supabase-native async HTTP client usable from SQL/cron.
create extension if not exists pg_net;

-- 2. Store the service-role key (and edge fn URL) in Vault so they don't leak
--    via pg_catalog / cron.job inspection. Vault secrets are encrypted at rest.
--    Planner note: `vault.create_secret` returns a uuid; we reference by name.
--    Alternative: create the secrets via Supabase Dashboard (Settings → Vault)
--    instead of migration — safer if keys rotate.
--    If done in migration, gate with idempotency.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'insights_fn_url') then
    perform vault.create_secret(
      'https://<PROJECT-REF>.supabase.co/functions/v1/generate-insight',
      'insights_fn_url'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'insights_fn_auth') then
    perform vault.create_secret(
      '<SERVICE_ROLE_KEY_OR_DEDICATED_INVOKE_TOKEN>',
      'insights_fn_auth'
    );
  end if;
end $$;

-- 3. Unschedule any prior job with the same name (idempotent re-apply).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'generate-insights') then
    perform cron.unschedule('generate-insights');
  end if;
end $$;

-- 4. Schedule: MV refresh is '0 3 * * *' (per 0013). Add 15 min buffer → '15 3 * * *'.
--    NOTE: CONTEXT.md D-14 says '15 2 * * *' but 0013 actually uses '0 3 * * *'.
--    This is the correct schedule; flag this correction in the plan.
select cron.schedule(
  'generate-insights',
  '15 3 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'insights_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'insights_fn_auth')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
```

Source: Supabase pg_net docs `https://supabase.com/docs/guides/database/extensions/pgnet`, Supabase Vault `https://supabase.com/docs/guides/database/vault`, Supabase pg_cron guide `https://supabase.com/docs/guides/database/extensions/pg_cron`.

### Pattern 4: Deterministic fallback (D-12)

```typescript
// supabase/functions/generate-insight/fallback.ts
type Payload = { kpi?: { today_revenue_eur?: number; today_delta_pct?: number;
                        last7d_revenue_eur?: number; last7d_delta_pct?: number; }
                 nvr?: { repeat_pct?: number } };

export function buildFallback(payload: Payload): { headline: string; body: string } {
  const k = payload.kpi ?? {};
  const n = payload.nvr ?? {};
  const todayRev = k.today_revenue_eur ?? 0;
  const todayDelta = k.today_delta_pct ?? 0;
  const w7Rev = k.last7d_revenue_eur ?? 0;
  const w7Delta = k.last7d_delta_pct ?? 0;
  const repeatPct = n.repeat_pct ?? 0;

  const sign = (p: number) => p >= 0 ? "+" : "";
  const headline = `Revenue €${todayRev} today — ${sign(todayDelta)}${todayDelta}% vs last week`;
  const body = `Week-to-date revenue is €${w7Rev} (${sign(w7Delta)}${w7Delta}% vs prior 7d). ${repeatPct}% of this week's customers were returning visitors.`;
  return { headline, body };
}
```

**Invariant:** Every number printed here is a direct render of a payload field — it passes the digit-guard by construction. Planner should add a unit test asserting `digitGuardOk(headline, flattenNumbers(payload)) === true` for arbitrary fallback outputs.

### Pattern 5: SvelteKit SSR card fetch

```typescript
// src/routes/+page.server.ts (additional Promise.all entry)
const insightP = supabase
  .from("insights_v")
  .select("headline, body, business_date, fallback_used")
  .order("business_date", { ascending: false })
  .limit(1)
  .maybeSingle();

// Join into existing Promise.all fan-out
const [kpiToday, kpi7d, /* ... */, insightRes] = await Promise.all([
  /* existing Phase 4 queries */,
  insightP,
]);
```

```svelte
<!-- src/routes/+page.svelte -->
{#if data.insight}
  <InsightCard
    headline={data.insight.headline}
    body={data.insight.body}
    businessDate={data.insight.business_date}
    fallbackUsed={data.insight.fallback_used}
    isStale={data.insight.business_date !== todayInTenantTz}
  />
{/if}
<!-- then existing 9 cards in Phase 4 order -->
```

### Pattern 6: Yesterday fallback + hide

The query orders by `business_date DESC LIMIT 1` and uses `.maybeSingle()` — if the table is empty for this tenant, `data.insight === null` and the `{#if}` hides the card entirely (INS-03 graceful hide). If a row exists but it's not today's, `InsightCard` renders normally but with the `"From yesterday"` muted label. Computing "today in tenant tz" on the server side keeps the day-boundary correct (same pattern as Phase 1 D-08 `business_date`).

### Pattern 7: README forker checklist structure

```markdown
## Forker quickstart

### Phase 1 — Foundation (existing section, keep as-is)
...

### Phase 2 — Ingestion
1. Drop your Orderbird CSV export into `orderbird_data/5-JOINED_DATA_<timestamp>/ramen_bones_order_items.csv`
2. Configure `.env` with Supabase URL + service-role-key (see `.env.example`)
3. Run: `node scripts/ingest/load_orderbird_csv.mjs`
4. Verify: `select count(*) from transactions;` should match CSV row count

### Phase 3 — Analytics SQL
1. Apply migrations 0010–0013: `supabase db push`
2. Verify pg_cron: `select * from cron.job where jobname = 'refresh-analytics-mvs';` (should show `0 3 * * *`)
3. Sanity-check the MVs: `select count(*) from cohort_mv;`

### Phase 4 — Mobile Reader UI
1. Create a Cloudflare Pages project, connect to your forked repo
2. Set these env vars in CF Pages (see `.env.example` → `# destination: cf pages`):
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
3. First deploy happens automatically on push
4. Open the CF Pages URL on your phone, log in, confirm the 9 cards render

### Phase 5 — Insights
1. Set Supabase secrets (see `.env.example` → `# destination: supabase secrets`):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```
2. Deploy the edge function: `supabase functions deploy generate-insight`
3. Apply migrations 0016–0018 (table + wrapper + cron)
4. Manually trigger once to verify: `select net.http_post(...)` from SQL editor
5. Confirm: `select * from insights_v;` returns a row

### Ship
1. Provision a tenant: `INSERT INTO restaurants (name, timezone) VALUES (...)` + corresponding `memberships` row
2. Flip repo public (GitHub → Settings → Change visibility → Public)
3. Add topics: `analytics`, `sveltekit`, `supabase`, `cloudflare-pages`, `forkable`, `restaurant`
4. Confirm LICENSE is present and README renders correctly
```

### Pattern 8: Sectioned `.env.example`

```bash
# ─────────────────────────────────────────────
# destination: local dev only (cp .env.example .env)
# ─────────────────────────────────────────────
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=

# ─────────────────────────────────────────────
# destination: cloudflare pages project env
# ─────────────────────────────────────────────
# Same two vars as above, set via CF Pages dashboard → Settings → Environment variables
# PUBLIC_SUPABASE_URL
# PUBLIC_SUPABASE_ANON_KEY

# ─────────────────────────────────────────────
# destination: supabase secrets
# set via: supabase secrets set KEY=value
# ─────────────────────────────────────────────
ANTHROPIC_API_KEY=          # sk-ant-...
SUPABASE_SERVICE_ROLE_KEY=  # service-role JWT (Supabase Dashboard → Settings → API)

# ─────────────────────────────────────────────
# destination: github actions repo secrets
# (set via: GitHub → Settings → Secrets and variables → Actions)
# ─────────────────────────────────────────────
# SUPABASE_DB_URL         # for CI migration checks
# SUPABASE_ACCESS_TOKEN   # for supabase CLI in GHA
```

### Anti-Patterns to Avoid
- **Calling Anthropic from the browser or SvelteKit server** — leaks API key. Key lives only in Supabase secrets, only the Edge Function can see it.
- **Hardcoding the service-role key in the `cron.schedule` SQL body** — visible in `cron.job` to any DB inspector. Use Vault.
- **Writing to `insights` without the `onConflict` upsert clause** — re-runs would INSERT duplicates and blow up the UNIQUE index.
- **Permitting the digit-guard to auto-round** — opens hallucination surface. CONTEXT.md D-11 is strict; the only concession is `toFixed(0/1/2)` format-expansion (Pattern 2 note), NOT rounding.
- **Chaining insight generation directly off the MV refresh function** — CONTEXT.md D-14 explicitly rejects this. Two decoupled cron jobs with a 15-min gap.
- **Querying raw `insights` from SvelteKit** — must go through `insights_v`. ci-guards Guard 1 will catch it if regex is extended.
- **Inventing a "regenerate insight" button** — deferred (out of scope).
- **Multi-file `.env.example` split** — rejected in D-18.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured JSON output from Claude | Custom Markdown/text parser | Anthropic tool-use (`tool_choice: { type: "tool", name: "emit_insight" }`) | Parser is fragile; tool-use enforces schema at the API layer |
| HTTP client for Anthropic in Deno | Handwritten `fetch` wrapper with retry/streaming | `@anthropic-ai/sdk` via `npm:` specifier | SDK handles auth headers, version pinning, error types; free |
| Pass service-role key to pg_cron jobs | Literal in SQL string | Supabase Vault (`vault.decrypted_secrets`) | Encrypted at rest; not visible in `cron.job` |
| Cron scheduling inside Edge Function | Node cron / setTimeout loop | pg_cron + pg_net.http_post | Edge Functions are request-scoped; no persistent process |
| Secret loading from Edge Function | Reading from files or DB | `Deno.env.get("ANTHROPIC_API_KEY")` after `supabase secrets set` | Supabase injects secrets as env vars at deploy time |
| Day-boundary calculation in Edge Function | `new Date().toISOString().slice(0,10)` | Use tenant timezone via `Intl.DateTimeFormat("en-CA", { timeZone: tz })` OR fetch current business_date from a SQL query `select current_date at time zone r.timezone::text::date` | Phase 1 FND-08 invariant — never use UTC `Date` for business_date |

**Key insight:** Phase 5 is almost entirely glue code. The only "real" code is the digit-guard (Pattern 2) and the fallback template (Pattern 4). Everything else is wiring existing components together.

## Runtime State Inventory

> Phase 5 is additive (new table, new function, new cron job, new Svelte card) — no rename or refactor. Skipping the full rename audit, but briefly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 5 creates new `insights` table from scratch. No existing records to migrate. | None |
| Live service config | Supabase Vault secrets (`insights_fn_url`, `insights_fn_auth`) must be created in prod Vault, not just migration — migrations only seed dev. Planner should add a README step "create these Vault secrets via Dashboard after deploy". | Manual step in Supabase Dashboard on each fork / prod rotation |
| OS-registered state | None — cron is pg_cron (DB-level), not OS cron. | None |
| Secrets/env vars | New: `ANTHROPIC_API_KEY` (Supabase secret), `SUPABASE_SERVICE_ROLE_KEY` (already exists for other services but now used inside Edge Function). `.env.example` must list both. | Add to `.env.example` (D-18 covers) |
| Build artifacts | `supabase/functions/generate-insight/` is a new directory — no stale artifacts. Supabase CLI bundles on `supabase functions deploy`. | None |

## Common Pitfalls

### Pitfall 1: CONTEXT.md D-14 cron schedule is wrong
**What goes wrong:** CONTEXT.md D-14 says MV refresh runs at `0 2 * * *` UTC (03:00 Berlin) and schedules insights at `15 2 * * *`. The actual migration 0013_refresh_function_and_cron.sql schedules `'0 3 * * *'` (03:00 UTC = 05:00 Berlin). If the planner copies D-14 literally the insight job will fire 45 minutes BEFORE the MV refresh completes and read stale data.
**Why it happens:** CONTEXT.md was written from memory or from an earlier draft of 0013; the final migration shipped with a different cron string.
**How to avoid:** Planner MUST use `'15 3 * * *'` (03:15 UTC = 05:15 Berlin), not `'15 2 * * *'`. Verify by reading 0013 directly before writing 0018.
**Warning signs:** First cron run writes fallback rows every day because the MVs haven't refreshed yet; `cron.job_run_details` shows insights job starting before refresh job finishes.

### Pitfall 2: Extending ci-guards Guard 1 regex
**What goes wrong:** Guard 1 regex is `\b[a-z_]+_mv\b|\b(transactions|stg_orderbird_order_items)\b`. It does NOT match `insights` as a base table. If any `src/` file accidentally queries raw `insights` it slips through.
**Why it happens:** The denylist is a hand-maintained list, not a derived one.
**How to avoid:** Phase 5 must extend `scripts/ci-guards.sh` Guard 1 regex to include `\binsights\b` (plus the wrapper view name must NOT match, so use negative lookahead or the `.from('insights')` function-call form only). Simpler: add `\.from\(['"]insights['"]\)` to Guard 1.
**Warning signs:** CI passes but `grep -r "from('insights')" src/` shows a raw reference.

### Pitfall 3: Supabase service-role client inside Edge Function bypasses RLS
**What goes wrong:** The generate-insight function uses the service-role key, which bypasses all RLS. If the tenant-loop query has a bug (e.g., reads the wrong tenant's `kpi_daily_mv`), there is no safety net — you write one tenant's insight row with another tenant's numbers.
**Why it happens:** Service-role is necessary for `insights_v` writes (tenant user can't write their own insights) and for reading MVs (wrappers require a JWT claim the cron doesn't have).
**How to avoid:** Scope every query manually by `restaurant_id`: `.eq('restaurant_id', t.id)`. Add a unit test that seeds 2 tenants, runs the function, asserts each tenant's `input_payload` only contains their own data.
**Warning signs:** Integration test with 2 tenants shows cross-contamination in `input_payload`.

### Pitfall 4: Digit-guard false positives on formatted numbers
**What goes wrong:** Payload has `revenue_cents: 428000`. Haiku writes `"€4,280"`. The digit-guard extracts `4.280` (after comma→dot normalization) from the output, but the payload token set has `428000`, `428000.0`, `428000.00` — no `4.280`. Guard rejects, fallback fires.
**Why it happens:** The Edge Function sends cents to Claude but Claude formats as euros. The `toFixed()` expansion in Pattern 2 doesn't help because it only expands the exact payload number.
**How to avoid:** Send the payload in the SAME unit the LLM should output. Build a "display payload" before calling Claude: `{ today_revenue_eur: Math.round(todayRevCents / 100) }`. Document this transform in the prompt: "All revenue values are in EUR, all percentages as integers."
**Warning signs:** Every run writes `fallback_used = true`, even though the prompt and model seem fine.

### Pitfall 5: Vault not available on all Supabase free-tier projects
**What goes wrong:** Supabase Vault is included on all tiers as of 2026, but is feature-flagged as "GA but may require manual enable" on brand-new projects. A forker might hit `vault.create_secret` not existing.
**Why it happens:** Vault relies on `pgsodium` which is sometimes disabled by default.
**How to avoid:** README forker checklist Phase 5 step 0: "Enable Vault via Dashboard → Settings → Vault (one-time)". As a fallback, planner may choose to store the invocation token in Supabase Edge Function secrets AND verify it inside the function — skipping Vault entirely and hardcoding a placeholder token in the cron SQL is NOT acceptable (leaks). Alternative: cron job calls `net.http_post` with a short-lived `pgcrypto`-signed token generated at call time, verified in the function. Planner picks the simpler path that works.
**Warning signs:** `supabase db push` fails on 0018 with "schema 'vault' does not exist".

### Pitfall 6: `supabase/functions/` directory does not yet exist
**What goes wrong:** First Edge Function in the repo. No prior convention, no existing `deno.json` at the functions root, no `supabase/functions/_shared/` utilities directory.
**Why it happens:** Phase 5 is the first function.
**How to avoid:** Planner creates the directory structure cleanly — `supabase/functions/generate-insight/` as a self-contained unit with its own `deno.json` if needed. Don't pre-create `_shared/` until there's a second function.
**Warning signs:** `supabase functions deploy generate-insight` fails because the CLI can't find the directory.

### Pitfall 7: Anthropic tool-use response shape
**What goes wrong:** Claude's response is an array of content blocks. The SDK returns `msg.content = [{type: 'tool_use', input: {...}}, ...]` but sometimes also includes a `text` block before the tool call. Naive extraction (`msg.content[0]`) breaks.
**Why it happens:** Anthropic's Messages API interleaves text and tool_use blocks.
**How to avoid:** Use `msg.content.find(c => c.type === 'tool_use')` (as in Pattern 1). Also verify `toolUse.input` is an object with the expected keys before reading them.
**Warning signs:** Every run falls back because `toolUse` is undefined or `toolUse.input.headline` is undefined.

## Code Examples

(See Patterns 1–8 above for end-to-end examples.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Parse Claude output as Markdown / plain text | Tool-use structured output with input_schema | Anthropic tool-use GA (2024) | Eliminates parser fragility |
| Edge Function cron via Vercel Cron / separate cron worker | Supabase pg_cron + pg_net.http_post | pg_net GA on Supabase (2023) | Everything stays in one platform; free tier |
| Hardcoded secrets in SQL for cron jobs | Supabase Vault + `vault.decrypted_secrets` | Vault GA (2024) | No secret leakage in `cron.job` |
| `@supabase/auth-helpers-sveltekit` for SSR auth (only relevant to the SvelteKit card fetch) | `@supabase/ssr` | 2024 | Already in use from Phase 1; no change needed |

**Deprecated/outdated:**
- **`@supabase/auth-helpers-sveltekit`**: sunset; Phase 1 already uses `@supabase/ssr`. No action.
- **Markdown parsing for LLM outputs**: fragile; replaced by tool-use.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | Deploy edge fn, push migrations | ✓ (assumed; Phase 1–4 used it) | — | — |
| Supabase project Edge Functions | Deploy generate-insight | ✓ (free tier) | — | — |
| pg_cron extension | Schedule insight job | ✓ (enabled by migration 0013) | — | — |
| pg_net extension | HTTP POST from cron | ✓ on Supabase (may need `create extension if not exists pg_net`) | — | — |
| Supabase Vault | Store service-role key for cron | Usually ✓ | — | Alternative: short-lived HMAC token generated via `pgcrypto`, verified in Edge Function |
| Anthropic API key | Haiku call | Manual — forker provides | — | None (blocking for forker unless they have a key) |
| `@anthropic-ai/sdk` via Deno `npm:` | Edge function import | ✓ (Deno supports `npm:` specifier in Supabase Edge runtime) | 0.30.x+ | Raw `fetch` to `api.anthropic.com/v1/messages` |

**Missing dependencies with no fallback:** Anthropic API key (forker must provide; document clearly in README).

**Missing dependencies with fallback:** Supabase Vault — can fall back to HMAC token pattern if Vault unavailable on forker's project.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (unit + integration, already in repo) + Playwright (e2e at 375px, already in repo) |
| Config file | `vitest.config.ts` (root), `playwright.config.ts` |
| Quick run command | `pnpm test:unit` |
| Full suite command | `pnpm test` (unit + integration + e2e) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INS-01 | Edge function upserts one row per tenant into `insights` with correct model id + input_payload + generated_at | integration | `pnpm test:integration -- tests/integration/insights/edge-function.test.ts` | ❌ Wave 0 |
| INS-01 | Edge function called via pg_cron → pg_net actually produces a row (smoke test against DEV) | integration-DEV | `pnpm test:integration -- tests/integration/insights/cron-smoke.test.ts` | ❌ Wave 0 |
| INS-02 | `digitGuardOk` rejects any output token not in flattened payload | unit | `pnpm test:unit -- tests/unit/digitGuard.test.ts` | ❌ Wave 0 |
| INS-02 | `buildFallback` output always passes `digitGuardOk(headline, flattenNumbers(payload))` for ≥5 payload shapes | unit (property) | `pnpm test:unit -- tests/unit/fallback.test.ts` | ❌ Wave 0 |
| INS-02 | Integration: inject a mock Anthropic response with a hallucinated number → assert `fallback_used = true` on the written row | integration | `pnpm test:integration -- tests/integration/insights/fallback.test.ts` | ❌ Wave 0 |
| INS-03 | SvelteKit loader returns `null` when `insights_v` is empty; card hides | unit (component) | `pnpm test:unit -- tests/unit/insightCard.test.ts` | ❌ Wave 0 |
| INS-03 | Yesterday-fallback label renders when most recent row ≠ today | unit (component) | `pnpm test:unit -- tests/unit/insightCard.test.ts` | ❌ Wave 0 |
| INS-03 | E2E at 375px: log in → see InsightCard at top of stream | e2e | `pnpm test:e2e -- tests/e2e/insight-card.spec.ts` | ❌ Wave 0 |
| INS-04 | ci-guards: no `ANTHROPIC_API_KEY` literal in `src/` or migrations | grep-guard | `bash scripts/ci-guards.sh` (extend) | ✓ (extend existing guards script) |
| INS-04 | ci-guards Guard 1 extended to catch raw `insights` base-table reads from `src/` | grep-guard | `bash scripts/ci-guards.sh` | ✓ (extend) |
| INS-05 | Fork-from-scratch dry run: spin up throwaway Supabase project, follow README Phase 5 steps, confirm insight row appears | manual (UAT) | documented in PLAN; no automation | — (manual) |
| INS-06 | `.env.example` lists every var the code references via `Deno.env.get` / `process.env` | unit | `pnpm test:unit -- tests/unit/env-example-completeness.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:unit` (digit-guard, fallback, component)
- **Per wave merge:** `pnpm test` (adds integration + e2e)
- **Phase gate:** full suite green + manual fork-from-scratch UAT dry run

### Wave 0 Gaps
- [ ] `tests/unit/digitGuard.test.ts` — covers INS-02 (reject + accept cases, comma/dot normalization, nested payload flattening)
- [ ] `tests/unit/fallback.test.ts` — covers INS-02 (fallback always passes digit-guard for arbitrary payloads)
- [ ] `tests/unit/insightCard.test.ts` — covers INS-03 (hide when null, yesterday label, auto-generated chip)
- [ ] `tests/unit/env-example-completeness.test.ts` — covers INS-06 (grep `Deno.env.get` + `process.env` calls, assert every key appears in `.env.example`)
- [ ] `tests/integration/insights/edge-function.test.ts` — covers INS-01 (mock Anthropic, invoke function locally via `supabase functions serve`, assert row)
- [ ] `tests/integration/insights/fallback.test.ts` — covers INS-02 (inject hallucinated number, assert fallback row)
- [ ] `tests/integration/insights/cron-smoke.test.ts` — covers INS-01 (DEV smoke: manually trigger `net.http_post`, poll for insight row)
- [ ] `tests/e2e/insight-card.spec.ts` — covers INS-03 at 375px (Playwright)
- [ ] `scripts/ci-guards.sh` extension — extend Guard 1 regex to include `\.from\(['"]insights['"]\)` and add a "no ANTHROPIC_API_KEY literal" guard
- [ ] Manual UAT script (doc, not code) — fork-from-scratch walkthrough for INS-05

*(Framework install: none — Vitest + Playwright already in repo from Phase 4.)*

## Open Questions

1. **Vault availability on forker's fresh Supabase project**
   - What we know: Supabase Vault is GA and generally available, but `pgsodium` (which backs it) is sometimes feature-flagged.
   - What's unclear: Whether a brand-new free-tier project enables Vault by default in April 2026.
   - Recommendation: Planner should test on a throwaway project during the ship-readiness plan (D-20) and document the enable step in README if needed. Fallback: HMAC-signed token via `pgcrypto` stored as a constant in the migration (not ideal; prefer Vault).

2. **Exact Anthropic SDK Deno compatibility**
   - What we know: `npm:@anthropic-ai/sdk@^0.30` syntax works in Supabase Edge Functions (Deno runtime supports `npm:` specifiers).
   - What's unclear: Whether the SDK has any CommonJS-only dependencies that break under Deno.
   - Recommendation: Planner tries SDK first; falls back to raw `fetch` (Pattern 1 with inlined HTTP) if SDK import fails. Document the decision in PLAN.

3. **Whether to expose cents or euros to the LLM**
   - What we know: Pitfall 4 — if payload is cents and LLM prints euros, digit-guard false-positives.
   - What's unclear: Whether Haiku will respect "do not convert units" instructions 100% of the time.
   - Recommendation: Pre-format the payload into display units (euros with 0 decimals, percentages as integers) BEFORE sending to Claude. Document this transform explicitly.

4. **"Today in tenant tz" derivation inside the Edge Function**
   - What we know: Tenant has a `timezone` column (set in Phase 1). Must use it, not UTC.
   - What's unclear: Whether to compute in TS (`Intl.DateTimeFormat`) or in SQL (`current_date at time zone r.timezone`).
   - Recommendation: Compute in SQL via a helper — `select (now() at time zone r.timezone)::date from restaurants r where id = $1`. Same source of truth as Phase 1 FND-08.

## Sources

### Primary (HIGH confidence)
- CONTEXT.md (`.planning/phases/05-insights-forkability/05-CONTEXT.md`) — all locked decisions
- Migration 0013_refresh_function_and_cron.sql — canonical pg_cron + refresh function pattern; the `0 3 * * *` schedule is the ground truth
- Migration 0004_kpi_daily_mv_template.sql — wrapper-view template `insights_v` follows
- Migration 0014_data_freshness_v.sql — second wrapper-view example (plain view over table, not MV — same shape as `insights_v`)
- scripts/ci-guards.sh — Guard 1 regex that must be extended
- CLAUDE.md §Recommended Stack + §Critical Gotchas §6 — Anthropic key storage, Edge Functions, pg_cron pattern
- REQUIREMENTS.md §INS-01..INS-06 — requirement text
- ROADMAP.md §Phase 5 — success criteria

### Secondary (MEDIUM confidence — verify during planning)
- Anthropic Messages API docs `https://docs.anthropic.com/en/api/messages` — tool-use structured output schema
- Supabase Edge Functions docs `https://supabase.com/docs/guides/functions` — Deno runtime, `Deno.env.get`, `supabase functions deploy`
- Supabase Edge Functions secrets `https://supabase.com/docs/guides/functions/secrets` — `supabase secrets set`
- Supabase pg_net docs `https://supabase.com/docs/guides/database/extensions/pgnet` — `net.http_post` signature
- Supabase Vault docs `https://supabase.com/docs/guides/database/vault` — `vault.create_secret`, `vault.decrypted_secrets` view
- Supabase pg_cron docs `https://supabase.com/docs/guides/database/extensions/pg_cron` — `cron.schedule`, `cron.unschedule`, `cron.job_run_details`

### Tertiary (LOW confidence — needs hands-on validation)
- Exact current `claude-haiku-4-5` model id and max_tokens default — verify via `anthropic.messages.create` call against a throwaway key during 05-01 plan execution
- `@anthropic-ai/sdk` latest version — run `npm view @anthropic-ai/sdk version` before writing the import pin
- Vault availability on fresh Supabase free-tier projects in April 2026 — test during D-20 ship-readiness dry run

## Metadata

**Confidence breakdown:**
- User constraints fidelity — HIGH (CONTEXT.md is comprehensive and this research preserves every decision verbatim)
- Edge Function architecture — HIGH (well-trodden pattern; first-function-in-repo is the only novelty)
- pg_cron + pg_net + Vault wiring — HIGH mechanically, MEDIUM on Vault availability edge cases
- Digit-guard implementation — HIGH (pure function, fully specified in D-11, unit-testable)
- Anthropic tool-use response parsing — MEDIUM (SDK version drift is the only risk)
- Forkability polish (README, `.env.example`, LICENSE) — HIGH (mechanical; existing README structure to extend)
- `0 3 * * *` vs `0 2 * * *` cron correction (Pitfall 1) — HIGH (verified directly against 0013 migration)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days — Anthropic SDK and model IDs churn faster than monthly; re-verify versions at plan-execution time)

## RESEARCH COMPLETE

**Phase:** 5 — Insights & Forkability
**Confidence:** HIGH

### Key Findings
- CONTEXT.md D-14 cron schedule is wrong — actual MV refresh is `0 3 * * *` (per migration 0013), so insights job must be `15 3 * * *`, not `15 2 * * *`. **Pitfall 1** flags this for the planner.
- `supabase/functions/` directory does not yet exist — Phase 5 creates the first Edge Function in the repo. No pre-existing `_shared/` or `deno.json`.
- ci-guards Guard 1 regex does NOT currently match raw `insights` base-table access from `src/` — planner MUST extend the regex (add `\.from\(['"]insights['"]\)` at minimum).
- Anthropic tool-use (`tool_choice: { type: "tool", name: "emit_insight" }`) is the right mechanism for strict `{headline, body}` JSON output — NOT Markdown parsing, NOT plain JSON mode. Schema-enforced at API layer.
- Digit-guard has one subtle trap: if payload is in cents and LLM outputs euros, every run false-positive rejects. Solution: pre-format the payload into display units before calling Claude (Pitfall 4).
- Vault is the correct place to store the service-role key that pg_cron uses to authenticate to the Edge Function — but Vault availability on fresh forker projects is a known edge case (Pitfall 5); README must document enabling it.

### File Created
`.planning/phases/05-insights-forkability/05-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Pinned by CLAUDE.md + CONTEXT.md; mechanical |
| Architecture | HIGH | Patterns 1–8 are copy-verifiable against existing migrations |
| Pitfalls | HIGH | Pitfall 1 verified against 0013; Pitfalls 2–7 are project-structure-specific and checked against actual files |
| Validation Architecture | HIGH | Existing Vitest+Playwright infra; Wave 0 gap list is concrete |

### Open Questions
- Vault availability on brand-new forker Supabase projects (test during D-20 dry run)
- `@anthropic-ai/sdk` Deno compat — fall back to raw `fetch` if SDK import fails
- Exact `claude-haiku-4-5` current model id — verify at plan-execution time

### Ready for Planning
Research complete. Planner can now create PLAN.md files for Phase 5.
