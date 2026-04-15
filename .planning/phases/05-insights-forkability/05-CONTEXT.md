# Phase 5: Insights & Forkability - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 delivers two things:

1. **Nightly Claude Haiku insight card** — end-to-end pipeline: Supabase Edge Function → Anthropic Haiku API (key as Supabase secret only) → digit-guard validation → `insights` table → `insights_v` wrapper view → `InsightCard.svelte` rendered at the top of the existing Phase 4 card stream.
2. **Forkability hardening** — README extended with a step-by-step forker onboarding checklist covering every phase, a single sectioned `.env.example` at repo root, a LICENSE file, and the repo public-flip / GitHub topics pass ("ship plan").

**In scope:**
- Supabase Edge Function (first one in this repo) that reads the tenant's full analytics snapshot, calls Claude Haiku, validates, writes to `insights`
- Migration `0016_insights_table.sql` (or next free number) — creates `insights` table + unique index + `insights_v` wrapper + `REVOKE ALL` on raw, following Phase 1 D-06/07/08 pattern
- Migration `0017_insights_cron.sql` — second `pg_cron` job fixed at MV-refresh-time + 15 min, calls Edge Function via `pg_net`
- `InsightCard.svelte` component + wiring into `src/routes/+page.server.ts` Promise.all fan-out (Phase 4 D-21 pattern)
- `SUPABASE_SERVICE_ROLE_KEY` + `ANTHROPIC_API_KEY` as Supabase secrets — documented but never committed
- README extension: Phase 2–5 forker steps (CSV drop, migrations ordering, CF Pages Git connect, Supabase secrets, pg_cron verification)
- `.env.example` at repo root extended with Phase 5 vars + sectioned comments (`# destination: cf pages`, `# destination: supabase secrets`, `# destination: gha`)
- LICENSE file (MIT by default; Claude's discretion)
- GitHub repo public-flip + topics + description — as a final plan in Phase 5

**Explicitly out of scope:**
- Signup / tenant self-serve UI (Phase 1 D-10 deferred; restaurant owners still provision tenants via SQL insert per README instructions)
- Billing / paid tier (PROJECT.md out-of-scope)
- Custom password reset route (Phase 1 D-11 deferred)
- Tenant switcher / multi-membership UI (Phase 1 D-05 deferred)
- Slack / email / push delivery of insights (this is a card in the dashboard, not a notification channel)
- Chat / follow-up-question UI on top of the insight (out of scope; single card, one-way)
- Historical insight browsing / "see previous weeks" drawer (only "latest" and "yesterday fallback" rendered in v1)
- Insight localization / German copy (v1 ships English)
- Real-time / on-demand regeneration button (cron-only in v1)
- Skeleton placeholders / streamed promises (Phase 4 D-21 still applies — SSR-with-data)

</domain>

<decisions>
## Implementation Decisions

### Insight Card Shape & Placement
- **D-01:** **Top of card stream — above the three fixed revenue tiles.** InsightCard is the first card the friend sees on Monday morning. Rationale: banking-analyst framing — narrative first, then the numbers it's about. This revises the Phase 4 D-02 order by prepending one card; the rest of the card order is unchanged.
- **D-02:** **Card shape: bold one-line headline + 2–3 sentence body.** No icons, no embedded sparkline, no bullets. Example: headline `"Weekend traffic slipped 18%"`, body `"Saturday and Sunday transactions were the lowest in 4 weeks, driving €620 below the prior weekend. Weekday revenue held steady at €2,840."` Matches Phase 4 D-08 "no sparkline on KPI cards" policy — InsightCard is text-only.
- **D-03:** **Yesterday fallback when today's insight is missing.** If no row exists in `insights_v` for `business_date = today`, fall back to the most recent available row and prepend a muted `"From yesterday"` label above the headline. Never show a blank card. If no insight exists at all (first deploy, brand-new tenant), hide the card entirely per INS-03. The `insights` table schema (D-14) supports this — one row per `(restaurant_id, business_date)`.
- **D-04:** **Fallback-mode visual tag: small muted `"auto-generated"` chip below the body.** When `fallback_used = true` (digit-guard rejected LLM output OR Anthropic errored, see D-11/D-13), the card still renders normally but shows a small muted chip. Copy is literal `"auto-generated"` — honest without being alarming. Color: Tailwind `text-zinc-500`, same as the freshness label (Phase 4 D-10a).

### Prompt, Payload & Model
- **D-05:** **Payload = full dashboard snapshot.** Edge Function fetches: `kpi_daily_v` (revenue windows: today / 7d / 30d / 90d + deltas + tx_count + avg_ticket), `cohort_mv` via wrapper (last 4 weekly cohorts with retention + cohort_size), `ltv_v` (last 4 cohorts), `frequency_v` (all 5 buckets with customer counts), `new_vs_returning_v` (7d window). Richer context = more analytical insight. Rationale accepted: the digit-guard (D-11) constrains the hallucination surface regardless of payload size — adding more numbers to the whitelist is free safety.
- **D-06:** **Voice: neutral news headline — just the facts.** System prompt positions Haiku as a terse financial reporter, not a coach or cheerleader. Example: `"Weekly revenue: €4,280 (▼ 12% vs prior 7d). Repeat customers drove 62% of the week's spend."` Rationale: minimum-hallucination risk (closer to templating), founder is a banking analyst and prefers dry precision, and failures feel like "flat" rather than "wrong and over-enthusiastic." Coach voice rejected as too soft for the restaurant owner's decision-making use case.
- **D-07:** **Model: `claude-haiku-4-5`.** Default temperature (gsd-planner may set lower — Claude's Discretion). CLAUDE.md recommendation + $0/mo target + one card per tenant per day = Haiku has zero competition here. Sonnet rejected (~10× cost, unnecessary quality for a 2–3 sentence card).
- **D-08:** **Output shape: strict JSON `{headline: string, body: string}`.** Use Anthropic tool-use / structured output mode. Edge Function validates the shape BEFORE running the digit-guard. Plain-text / Markdown parsing rejected as fragile (any formatting drift breaks the splitter).
- **D-09:** **System prompt template lives in code** as a TypeScript string constant in `supabase/functions/generate-insight/prompt.ts`. Explicit instruction to Haiku: "Every number in your output must come from the INPUT DATA JSON below. Do not estimate, round, or compute new figures." This is a soft guard; the digit-guard (D-11) is the hard guard.

### Backend Pipeline: Validate → Schedule → Store
- **D-10:** **`insights` table schema — one row per `(restaurant_id, business_date)` with UNIQUE index.** Columns: `id uuid pk default gen_random_uuid()`, `restaurant_id uuid not null references restaurants(id)`, `business_date date not null`, `generated_at timestamptz not null default now()`, `headline text not null`, `body text not null`, `input_payload jsonb not null`, `model text not null`, `fallback_used boolean not null default false`, `UNIQUE (restaurant_id, business_date)`. Upsert on conflict — reruns are idempotent. Matches Phase 4 D-21 upsert semantics.
- **D-11:** **Digit-guard regex: extract every digit-run from LLM output, every digit-run must appear in the input payload after normalization.** Tokenizer: `/\d+(?:[.,]\d+)?/g`. Normalize commas→dots before set comparison. Walk both `headline` and `body`. Any output token NOT present in the `input_payload` (recursively flattened + same tokenizer) → reject → fallback. "Near-miss rounding" (e.g., `4280 → "4.3k"`) is NOT allowed — the guard is strict. Rationale: simple + provable + passes the INS-02 acceptance literally. The prompt (D-09) is told not to round, so refusals should be rare; when they do happen, the fallback template (D-12) always produces a valid row.
- **D-12:** **Deterministic fallback template.** When the digit-guard rejects the LLM output OR the Anthropic call errors OR the JSON parse fails, the Edge Function writes a deterministic row built from the payload only. Template (subject to gsd-planner tightening): headline = `"Revenue €{today_revenue} today — {today_delta_sign}{today_delta_pct}% vs last week"`, body = `"Week-to-date revenue is €{7d_revenue} ({7d_delta_sign}{7d_delta_pct}% vs prior 7d). {repeat_pct}% of this week's customers were returning visitors."` All numbers are payload-sourced, so the template itself passes the digit-guard by construction. `fallback_used` set to `true`; the card shows the "auto-generated" chip (D-04).
- **D-13:** **Error handling: single attempt, no retry loop.** If Anthropic API errors (network, 5xx, timeout), the Edge Function logs the error to `console.error` (visible in Supabase Edge Function logs) and writes the fallback row. No retry with backoff — fallback template is cheap and always produces a card. Rationale: retry logic adds complexity and cron.job_run_details noise for a daily job that is not time-critical; if today's row is fallback, tomorrow's cron run will try the LLM fresh.
- **D-14:** **Scheduling: second `pg_cron` job fixed at MV-refresh-time + 15 minutes.** Phase 3's refresh job runs at `0 2 * * *` UTC (03:00 Berlin, per 0013). Phase 5 adds `15 2 * * *` UTC (03:15 Berlin) — `cron.schedule('generate-insights', '15 2 * * *', $$SELECT net.http_post(url := '<edge-fn-url>', headers := '{...}'::jsonb)$$)`. 15-min buffer comfortably covers MV refresh variance. Jobs are decoupled — MV refresh failure does NOT block insight generation, and vice versa. Second-job failure visible in `cron.job_run_details`.
- **D-15:** **`pg_cron` → Edge Function invocation uses `pg_net.http_post`** with an `Authorization: Bearer <service-role-key>` header (stored in `vault` per Supabase best practice). Edge Function verifies the JWT and iterates over all tenants in v1 (single tenant → single loop iteration, but loop structure from day 1 for multi-tenant readiness). The function writes one row per tenant per invocation.
- **D-16:** **`insights_v` wrapper view with JWT-claim filter** — `CREATE VIEW insights_v AS SELECT * FROM insights WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`. Raw `insights` table is `REVOKE ALL ... FROM authenticated, anon` + `GRANT SELECT ... TO service_role`. `src/routes/+page.server.ts` reads `insights_v` only, never raw. Phase 1 D-14 CI grep guard (no raw `*_mv`/base-table references from `src/`) extends to `insights` — update the guard allowlist or rename pattern.

### Forkability: README + .env.example + Ship
- **D-17:** **README structure: step-by-step numbered checklist, copy-paste commands, one phase per section.** Existing "Forker quickstart (Phase 1)" section becomes the template. Phase 5 adds five new sections to README: Phase 2 (drop CSV into `orderbird_data/` + run loader), Phase 3 (migrations 0010–0013 + verify pg_cron), Phase 4 (CF Pages project connect + env vars + first deploy), Phase 5 (Supabase secrets for Anthropic key + second pg_cron job + verify `insights_v`), and "Ship" (flip repo public, add topics, check LICENSE). No magic buttons — every step is a command the forker runs themselves.
- **D-18:** **Single `.env.example` at repo root, with sectioned comments per destination.** Extends the existing `.env.example`. Each section header marks where the var goes: `# --- destination: cf pages project env ---`, `# --- destination: supabase secrets (supabase secrets set KEY=...) ---`, `# --- destination: github actions repo secrets ---`, `# --- destination: local dev only ---`. One file = one source of truth = `cp .env.example .env` still works for local dev. `.env.test.example` stays separate (already owned by Phase 1 test infra). Rejected: multi-file split (more ceremony, forker has to juggle 3+ files).
- **D-19:** **Out of scope for forkability: signup UI, tenant self-serve provisioning, billing.** These stay deferred. README documents the manual tenant-provision SQL insert (one `INSERT INTO restaurants (...)` statement) as the Phase 5 forker onboarding step. Matches PROJECT.md out-of-scope list and Phase 1 D-10.
- **D-20:** **Ship-readiness work folded into Phase 5 as a final plan.** The last plan in Phase 5 (e.g., 05-0X-PLAN.md, gsd-planner picks number) covers: LICENSE file (MIT by default — Claude's Discretion), README polish pass, repo public flip, GitHub topics (`analytics`, `sveltekit`, `supabase`, `cloudflare-pages`, `forkable`, `restaurant`), repo description, and a final end-to-end forker-walkthrough dry run on a throwaway second Supabase project. This is the last phase on the roadmap — no better home.

### Claude's Discretion
- **Edge Function name + directory:** `supabase/functions/generate-insight/index.ts` is the default. gsd-planner may rename. First Edge Function in the repo — no prior convention to follow.
- **Temperature for Haiku call:** default or lower (e.g., 0.2). gsd-planner picks; not worth asking the user. Digit-guard is the hard constraint either way.
- **Exact deterministic fallback template wording** (D-12) may be polished during planning — must still be 100% payload-sourced numbers.
- **LICENSE choice:** MIT unless gsd-planner surfaces a reason to prefer Apache-2.0 or similar. Forkability intent is maximally permissive.
- **GitHub topics exact list:** gsd-planner picks from a sensible set.
- **Migration file numbering:** continues from wherever Phase 4 left off (currently `0014_data_freshness_v.sql`, `0015_auth_hook_security_definer.sql` exist — Phase 5 starts at `0016` or next free).
- **`insights_v` vs `latest_insight_v`:** gsd-planner may add a thin `latest_insight_v` helper that returns only the most recent row per tenant, to simplify the `+page.server.ts` fetch. Or the SvelteKit loader sorts and limits. Either works.
- **Prompt caching on the Anthropic call:** optional. One call per tenant per day is well below the prompt-cache break-even point, so gsd-planner may skip it to keep the Edge Function simple. If multi-tenant scales later, add caching then.
- **Exact row-write mechanism from Edge Function:** `supabase-js` service-role client inside the Deno runtime is the default. No fancy SQL.
- **`InsightCard.svelte` styling:** follows the existing 9-card aesthetic (Tailwind card primitives from Phase 4). No custom design system.

### Folded Todos
None — `todo match-phase 5` returned zero matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project
- `CLAUDE.md` — §Recommended Stack (Claude Haiku model choice, Supabase Edge Functions Deno runtime, pg_cron + pg_net pattern, `@supabase/ssr`), §Critical Gotchas §6 "Anthropic API Key from Edge Function" (key lives only as Supabase secret; never in browser; never committed), §"What NOT to Use" list.
- `.planning/PROJECT.md` — vision, mobile-first, $0/mo target, forkability non-negotiable, out-of-scope list (no signup UI, no billing, no real-time).
- `.planning/REQUIREMENTS.md` §INS-01..INS-06 — the six requirements this phase satisfies.
- `.planning/ROADMAP.md` §"Phase 5: Insights & Forkability" — goal + four success criteria.

### Phase 1 Prior Art (wrapper pattern, RLS, CI guards, auth)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-04 (JWT `restaurant_id` claim, used by `insights_v` filter), D-06/07/08 (wrapper-view + `REVOKE ALL` + unique-index pattern → D-10/D-16 of this phase), D-10 (signup deferred → D-19), D-11 (password reset deferred), D-12/14 (CI guards Phase 5 must still pass: no raw `*_mv`/base-table references from `src/`, no raw `getSession`).
- `supabase/migrations/0002_auth_hook.sql` + `0015_auth_hook_security_definer.sql` — JWT `restaurant_id` claim injection; `insights_v` relies on this claim being present.
- `supabase/migrations/0004_kpi_daily_mv_template.sql` — canonical MV/wrapper template; `insights` table + `insights_v` follow the base-table variant of this pattern (no MV; it's a regular table).
- `scripts/ci-guards.sh` — Phase 5 must pass all existing guards AND extend the "raw base table" allowlist if any new rule is needed to keep `insights_v` as the only `src/` access path.

### Phase 3 Prior Art (analytics views Phase 5 reads as input payload)
- `.planning/phases/03-analytics-sql/03-CONTEXT.md` — D-02 (`cohort_mv` wide shape), D-04 (weekly grain default), D-08 (NULL-masking for survivorship), D-12 (frequency buckets), D-14 (new-vs-returning `cash_anonymous`), D-16 (which are MVs vs plain views).
- `supabase/migrations/0010_cohort_mv.sql`, `0011_kpi_daily_mv_real.sql`, `0012_leaf_views.sql`, `0013_refresh_function_and_cron.sql` — the wrapper views Phase 5's Edge Function reads as the Haiku input payload (D-05). Edge Function reads `kpi_daily_v`, cohort wrapper, `ltv_v`, `frequency_v`, `new_vs_returning_v` via service-role.
- `supabase/migrations/0013_refresh_function_and_cron.sql` — defines the MV refresh cron schedule. Phase 5 schedules its insight job at refresh-time + 15 min (D-14). Read this migration to confirm the exact refresh time before writing the new cron entry.

### Phase 4 Prior Art (dashboard card stream Phase 5 extends)
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — D-02 (card order, revised by this phase's D-01 to prepend InsightCard), D-08 (no sparkline on KPI cards, extended to InsightCard), D-10/10a (freshness label styling, reused for the "auto-generated" chip color), D-20 (per-card empty state pattern, but InsightCard uses yesterday-fallback D-03 instead), D-21 (SSR Promise.all fan-out, InsightCard joins the existing fan-out), D-22 (per-card error handling — InsightCard gracefully hides if `insights_v` query errors).
- `supabase/migrations/0014_data_freshness_v.sql` — pattern reference for "plain wrapper view with JWT-claim filter, no MV" — Phase 5's `insights_v` follows the same shape but over a regular table instead of a base view.
- `src/routes/+page.server.ts` — the Promise.all fan-out Phase 5 extends with one more entry (`insights_v` fetch).
- `src/routes/+page.svelte` — the card-stream composition Phase 5 prepends `InsightCard` to.
- `src/lib/components/` — 9 existing card components Phase 5 matches in style: `KpiTile`, `CohortRetentionCard`, `LtvCard`, `FrequencyCard`, `NewVsReturningCard`, `FreshnessLabel`, `DateRangeChips`, `GrainToggle`, `EmptyState`, `DashboardHeader`.
- `.env.example` (root) — existing file Phase 5 extends with sectioned Phase-5 vars (D-18).
- `README.md` — existing Phase 1 forker quickstart Phase 5 extends with Phase 2–5 + Ship sections (D-17).

### External (downstream researcher to fetch fresh)
- Anthropic Messages API docs (tool-use / structured output) — https://docs.anthropic.com/en/api/messages
- `claude-haiku-4-5` model card — https://docs.anthropic.com/en/docs/about-claude/models
- Supabase Edge Functions (Deno) — https://supabase.com/docs/guides/functions
- Supabase Edge Functions secrets — https://supabase.com/docs/guides/functions/secrets
- `pg_cron` — https://supabase.com/docs/guides/database/extensions/pg_cron
- `pg_net.http_post` — https://supabase.com/docs/guides/database/extensions/pgnet
- Cloudflare Pages env vars / secrets — https://developers.cloudflare.com/pages/configuration/build-configuration/
- GitHub repo topics / public flip — https://docs.github.com/en/repositories
- MIT License text — https://opensource.org/license/mit

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 4 card primitives** — `src/lib/components/*.svelte` (9 components) establish the card-shape convention; `InsightCard.svelte` matches them visually (Tailwind card, same padding, same header-left/body-right pattern as applicable).
- **Phase 4 Promise.all fan-out** in `src/routes/+page.server.ts` — Phase 5 extends it with one more `.from('insights_v').select('*').order('business_date', { ascending: false }).limit(1)` call.
- **Phase 1 wrapper-view template** from `0004_kpi_daily_mv_template.sql` — the canonical pattern `insights_v` copies (with the variation: regular table, not MV).
- **Phase 3 `refresh_function_and_cron.sql`** — pattern reference for adding a second `cron.schedule` entry and for the `pg_net.http_post` call shape.
- **Phase 1 CI guards** (`scripts/ci-guards.sh`) — already blocks raw base-table access from `src/`; Phase 5 either extends the rule or names `insights` into the same allowlist/denylist as other base tables.
- **Phase 4 FreshnessLabel styling (`text-zinc-500`)** — reused for the InsightCard "auto-generated" chip color.
- **Existing `README.md` "Forker quickstart (Phase 1)" section** — template Phase 5 extends section-by-section.
- **Existing root `.env.example`** — Phase 5 adds sections in-place, does not rewrite.

### Established Patterns
- **Wrapper view + JWT-claim filter + `REVOKE ALL` on raw** (Phase 1 D-06/07/08) — mandatory pattern for `insights_v`.
- **`@supabase/ssr` SSR data loading** with `safeGetSession` / `getUser` — `insights_v` fetch happens via the same pattern; never raw `getSession` on server.
- **Migration numbering** — Phase 5 starts at `0016_*` (0014 + 0015 already exist for Phase 4).
- **`pg_cron` via Supabase Dashboard-enabled extension** (Phase 3 pattern) — second cron entry follows the same shape.
- **Tenant iteration inside Edge Function** — v1 has one tenant but the loop is in place from day 1 (multi-tenant readiness).

### Integration Points
- **`supabase/functions/`** — first Edge Function in the repo. Creates the directory. Deploy via `supabase functions deploy generate-insight`.
- **Supabase secrets** — `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` + any Edge Function auth secret. Documented in README Phase 5 section.
- **`supabase/migrations/`** — two new migrations: `0016_insights_table.sql` (table + wrapper view + grants) and `0017_insights_cron.sql` (cron schedule + pg_net call).
- **`src/routes/+page.server.ts`** — Phase 4 loader extended with `insights_v` fetch.
- **`src/routes/+page.svelte`** — Phase 4 card composition prepended with `<InsightCard ... />`.
- **`src/lib/components/InsightCard.svelte`** — new component, tenth in the card set.
- **`README.md`** — extended with five new sections (Phase 2 / 3 / 4 / 5 / Ship forker steps).
- **`.env.example`** — extended with sectioned comments for Anthropic key, service-role key for the Edge Function, and any deploy-time vars.
- **`LICENSE`** — new file at repo root (MIT default, Claude's Discretion).
- **GitHub repo settings** — public flip, topics, description (final plan in Phase 5).
- **CI guards (`scripts/ci-guards.sh`)** — may need a small extension to cover the new `insights` base table (or the existing pattern may already cover it via regex — gsd-planner confirms).

</code_context>

<specifics>
## Specific Ideas

- **Top-of-stream InsightCard placement** is a deliberate revision of Phase 4's card order (D-02). The narrative comes BEFORE the numbers because the founder's banking-analyst framing is "read the story, then verify it in the tiles." This ordering is load-bearing — do not move.
- **Neutral news-headline voice** (D-06) was chosen over warmer/coach voices specifically because the founder prefers dry precision and because flat prose is safer under the digit-guard constraint. Downstream agents should NOT soften this in the system prompt.
- **Full payload (revenue + cohort + LTV + frequency + new_vs_returning)** (D-05) is the richer end of the spectrum. Accepted because the strict digit-guard (D-11) limits hallucination regardless of payload size, and because more inputs = more analytical angles for Haiku to pick from. If gsd-planner finds the payload exceeds a sensible token budget, trim frequency or LTV first — keep revenue + new-vs-returning.
- **Strict digit-guard** (D-11) — no rounding allowance. This is deliberately paranoid per INS-02 ("hallucinated figure cannot reach the owner"). The prompt explicitly instructs Haiku not to round (D-09), so refusals should be rare; when they do happen, the fallback template (D-12) preserves the daily card render.
- **Yesterday fallback** (D-03) is why the `insights` table is one-row-per-date with history, not an overwrite-in-place single row. Schema choice D-10 flows directly from this UX choice — they must be designed together.
- **"Auto-generated" chip** (D-04) is the ONLY UI distinction between LLM and fallback modes. Copy is literal `"auto-generated"`, not `"template"` or `"fallback"` — those would confuse the friend.
- **15-min gap between MV refresh cron and insight cron** (D-14) is the coupling mechanism. Direct chaining (calling pg_net from the refresh function) was rejected as too tightly coupled — MV refresh failure would silently block insights, and vice versa.
- **One Edge Function per repo, not per tenant** — the Edge Function loops over all tenants each run. V1 has one tenant; the loop is structural for multi-tenant readiness, not performance optimization.
- **Single `.env.example` with sectioned comments** (D-18) — forker should be able to `cp .env.example .env` for local dev AND read the same file to know what goes into CF Pages / Supabase secrets / GHA. Single source of truth.
- **Ship-readiness folded into Phase 5** (D-20) — this is the last phase on the current roadmap. LICENSE + public flip + topics all ship here, not as a Phase 6.

</specifics>

<deferred>
## Deferred Ideas

- **Signup / tenant self-serve UI** — Phase 1 D-10; remains deferred. README documents the manual `INSERT INTO restaurants ...` step for new forkers.
- **Custom password reset route** — Phase 1 D-11; deferred beyond v1.
- **Tenant switcher / multi-membership UI** — Phase 1 D-05; deferred.
- **Billing / paid tier** — PROJECT.md out-of-scope.
- **Slack / email / push delivery of insights** — v1 is dashboard-card-only. Future phase if friend requests it.
- **Chat / follow-up questions on top of an insight** — out of scope. The card is one-way.
- **Historical insight browsing ("see last week's insight")** — the `insights` table stores history (D-10), but v1 UI only shows today / yesterday. A "previous weeks" drawer is a future phase.
- **Insight localization (German copy)** — v1 ships English. Friend is English/German; future phase.
- **Real-time / on-demand regeneration button** — cron-only in v1. No manual re-run UI.
- **Skeleton placeholders / streamed promises** — Phase 4 D-21 stands; SSR-with-data. Revisit only if CF edge TTFB becomes a problem.
- **Prompt caching on the Anthropic call** — one call per tenant per day is below the break-even; add later if multi-tenant scales.
- **Retry with backoff on Anthropic errors** (D-13) — single-attempt + fallback is the v1 policy. Add retry only if Anthropic error rate becomes a real issue.
- **Rounded-figure digit-guard tolerance** — rejected in D-11. If Haiku's natural prose starts refusing often, revisit this then.
- **Deploy-button magic** (Cloudflare "Deploy to Pages" button, Supabase deploy recipes, Terraform) — rejected in D-17 in favor of explicit step-by-step commands. Forker-friendly over magic-friendly.
- **Multi-file `.env.example` split** — rejected in D-18 in favor of a single sectioned file.
- **Dashboard UI for pg_cron refresh status** — deferred from Phase 4 to Phase 5 originally; deferred again out of Phase 5 scope. Freshness label (Phase 4 D-10) is the only v1 freshness signal.
- **Second TEST Supabase project for unblocking Phase 1 UAT tests 3/4/5** — still deferred; not touched in Phase 5.

### Reviewed Todos (not folded)
None — no pending todos matched Phase 5 via `todo match-phase 5`.

</deferred>

---

*Phase: 05-insights-forkability*
*Context gathered: 2026-04-15*
