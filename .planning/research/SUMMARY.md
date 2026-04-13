# Project Research Summary

**Project:** Ramen Bones Analytics
**Domain:** Free, forkable, mobile-first restaurant POS analytics (Orderbird → Supabase → SvelteKit/Cloudflare)
**Researched:** 2026-04-13
**Confidence:** HIGH

## Executive Summary

Ramen Bones Analytics is a nightly-batch analytics pipeline with a static-edge reader UI that brings banking-grade cohort/retention/LTV metrics to non-technical restaurant owners on their phones. The canonical free-tier 2026 stack is already chosen correctly: SvelteKit 2 + Svelte 5 + `adapter-cloudflare` + `@supabase/ssr` + Supabase Postgres (with pg_cron, materialized views, and RLS) + Python/Playwright scraping in GitHub Actions + a Supabase Edge Function calling Claude Haiku for nightly narrative insights. The only stack gaps were unspecified supporting libraries — research recommends LayerChart (Svelte 5 native), shadcn-svelte `@next` with Tailwind v4, date-fns, and zod.

Feature-wise, the differentiator is narrow and clear: Toast/Square/Lightspeed ship revenue KPIs and day/hour heatmaps but none ship first-visit cohort retention curves, LTV per cohort, or visit-frequency distributions to owners. That gap *is* the product. The winning UX is a single-column vertical stream of "one card = one insight" optimized for a 375px viewport, with date-preset chips as the only global filter. Ruthless anti-feature discipline is mandatory — customizable dashboards, CSV exports, real-time streams, forecasting, and AI chat all actively kill the 2-week MVP.

The three project-ending risks are (1) **RLS silently bypassed through materialized views** — Postgres MVs don't honor RLS, so tenancy must be enforced via `security_invoker=off` wrapper views with `REVOKE ALL` on the MV from day 1; (2) **cohort survivorship / short-history LTV shown without caveats**, which will betray the non-technical owner's trust the first time recent cohorts look artificially worse; and (3) **timezone off-by-one on day boundaries** across the 5-timezone chain (Orderbird CSV local → pg_cron UTC → Postgres UTC → CF edge UTC → phone local). All three must be solved structurally in Phase 1, not retrofitted. The fourth existential risk is non-technical: **founder scope creep driven by analyst instincts** — building for self rather than for the friend.

## Key Findings

### Recommended Stack

The user's pre-decided core stack is correct and current for April 2026. See STACK.md for full version matrix and installation commands. Key additions from research: LayerChart for charts (Svelte 5 native; `svelte-chartjs` is dead), shadcn-svelte `@next` for UI primitives (Tailwind v4 compatible), and date-fns over Temporal (Temporal not yet runnable in Cloudflare Workers).

**Core technologies:**
- **SvelteKit 2 + Svelte 5 + adapter-cloudflare 7.x** — mobile app framework — first-class CF adapter, smallest JS bundle among mainstream frameworks
- **Supabase Postgres + pg_cron + `@supabase/ssr`** — primary datastore + nightly orchestration + auth — window functions/CTEs/generate_series are required for cohort SQL (D1 cannot do it); `@supabase/ssr` replaces deprecated auth-helpers
- **Python 3.12 + Playwright + pandas + supabase-py in GitHub Actions** — Orderbird CSV extractor — free-tier cron host, mature Playwright ecosystem, persistent `storageState.json`
- **Supabase Edge Function + Claude Haiku** — nightly narrative insights — API key stays server-side, triggered by pg_cron via `pg_net.http_post`
- **LayerChart + shadcn-svelte@next + Tailwind v4 + date-fns + zod** — frontend libraries — chosen for Svelte 5 compatibility, forkability, and mobile bundle size

### Expected Features

See FEATURES.md for full landscape. The feature set is tightly constrained by the 2-week MVP and the non-technical phone user.

**Must have (table stakes — missing these makes it feel broken):**
- Revenue / tx count / avg ticket with delta vs prior period — every POS dashboard leads with this
- Daily revenue trendline (30/90 day spark/area)
- Date range preset chips (7d / 30d / 90d) — the *only* global filter
- Mobile-optimized single-column layout with "Last updated Xh ago" trust signal
- Login-protected per-tenant access (Supabase Auth + RLS)
- Empty-state messaging when data is insufficient

**Should have (the banking-playbook differentiators — P1):**
- First-visit weekly cohort retention curve (hero differentiator)
- LTV-to-date per cohort with honest data-depth caveat
- Repeat-vs-new revenue split ("aha" chart)
- Visit frequency distribution (1x / 2x / 3–5x / 6–10x / 11+)
- Repeat visit rate
- Owner-briefing home screen (3 numbers + 1 sentence + 1 alert)

**Defer (v1.x after friend uses it weekly):**
- Day-of-week / hour-of-day heatmap
- "What changed this week" Claude narrative card
- Regulars-at-risk list (needs ≥60 days data)
- Segment filter chips (new / returning / regulars)

**Explicit anti-features (NOT building, protects MVP timeline):**
- Real-time / streaming, customizable dashboards, CSV/PDF export, forecasting, AI chat interface, cohort triangles as primary viz, labor cost, peer benchmarks, onboarding UI

### Architecture Approach

Nightly batch pipeline with four components, strict boundary rules, and an idempotency-by-natural-key invariant. See ARCHITECTURE.md for full schema sketch, SQL, and data flow diagram.

**Major components:**
1. **GitHub Actions scraper (Python/Playwright)** — daily Orderbird login, CSV export, normalize, upsert into `stg_orderbird_tx` only
2. **Supabase Postgres data plane** — `stg_orderbird_tx` → `transactions` (fact) → MVs (`cohort_mv`, `ltv_mv`, `kpi_daily_mv`, `freq_mv`) → security-definer wrapper views (`*_v`); pg_cron orchestrates normalize → refresh → insights chain
3. **Edge Function `generate-insights`** — reads `kpi_daily_v` deltas, calls Claude Haiku, writes `insights` row; triggered by pg_cron via `pg_net.http_post`
4. **SvelteKit on Cloudflare Pages** — SSR reader app, `@supabase/ssr` cookie session, queries **only** `*_v` wrapper views and `insights`, renders LayerChart cards in a single mobile-first column

**Three load-bearing rules (violating them = rewrite):**
1. RLS + security-definer wrapper views exist **before** the first materialized view is built
2. Raw ingest is idempotent via `PRIMARY KEY (restaurant_id, source_tx_id)` + upsert; no batch/run-tracking tables
3. Every read path goes through `*_v` wrappers; `REVOKE ALL` on MVs from `authenticated`/`anon`; tenant id comes only from signed JWT claim (`app_metadata.restaurant_id` via custom access token hook), never from client input

### Critical Pitfalls

Top 5 project-enders from PITFALLS.md:

1. **RLS silently bypassed via materialized views** — Postgres MVs don't honor RLS; direct `SELECT * FROM cohort_mv` returns all tenants. **Avoid:** wrapper view pattern from day 1, `REVOKE ALL` on every MV, CI test with two seeded tenants asserting tenant isolation in every `_v` view, grep rule banning `_mv` references outside migrations.
2. **Cohort survivorship / short-history LTV shown without caveat** — 3–12 months of data means recent cohorts look artificially worse. **Avoid:** show cohort age in weeks, hide LTV for cohorts younger than max-observable horizon, label as "LTV-to-date through week N", clip retention curve x-axes to shortest cohort horizon.
3. **Timezone off-by-one day boundary** — 5-timezone chain silently shifts "yesterday's revenue" by 24h. **Avoid:** scraper parses Orderbird timestamps as `Europe/Berlin`, store pre-computed `business_date` column on `transactions`, every `date_trunc('day', ...)` uses `AT TIME ZONE r.timezone`, test fixture with 23:45 Berlin transaction.
4. **Claude hallucinates a number in the narrative card** — destroys trust silently. **Avoid:** prompt "phrase, never calculate", regex guard asserting every digit in output is a substring of input numbers, deterministic template fallback when guard trips or API fails.
5. **Founder scope creep — analyst building for self** — the single biggest threat to the 2-week MVP. **Avoid:** FEATURES.md P1 list is the contract; show the friend a clickable KPI screen before writing any cohort SQL; delete-first refactor rule; weekly check-in against "Add After Validation" list.

Plus the anti-pattern CI checks (grep for `_mv` in `src/`, `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`, `getSession` on server, `card_hash` joined to PII, `claude-sonnet` default, `fetch anthropic` outside `supabase/functions/`, `date_trunc('day'` without `AT TIME ZONE`) should ship in Phase 1 CI.

## Implications for Roadmap

Based on the build-order discipline in ARCHITECTURE.md and the feature dependency graph in FEATURES.md, the only valid phase structure is **foundation-first, analytics-second, UI-third, hardening-fourth, narrative-last**. The card-hash identity + cohort MV is the trunk; nearly every P1 feature is a leaf on that tree.

### Phase 1: Foundation (Tenancy, Schema, Auth, CI Guards)
**Rationale:** Steps 1–5 of ARCHITECTURE.md's build order are non-negotiable. Without RLS + wrapper-view muscle memory + CI guards + `business_date` + two seeded tenants, every later phase leaks tenants, mis-buckets days, or hides survivorship bugs. The wrapper-view pattern must become habit before any analytical SQL is written.
**Delivers:** Supabase project with `restaurants`, `memberships`, custom access token hook injecting `restaurant_id` claim; `stg_orderbird_tx` + `transactions` tables with RLS policies and `business_date` column; first MV (`kpi_daily_mv`) + unique index + `kpi_daily_v` wrapper + `REVOKE ALL` as the template for everything else; two-tenant RLS integration test in CI; all grep guards from PITFALLS.md wired to CI; SvelteKit shell with `@supabase/ssr` and `getUser()` layout guard.
**Addresses:** Multi-tenant-ready data model (Active requirement), Supabase Auth (Active requirement), mobile-first shell.
**Avoids:** Pitfalls #1 (RLS-on-MV leak), #3 (timezone day-boundary), #5 (PII creep), #14 (JWT claim missing), #15 (`getSession` on server), #22 (over-modeling schema).

### Phase 2: Extraction (Orderbird Scraper → Staging)
**Rationale:** Ingestion is load-bearing for every analytical view but is also the highest-variability component (CSV schema, login flow, captcha risk). Ship it against the already-existing staging table so it can be iterated on without blocking downstream SQL. Sit with the friend in week 1 and **read 20 CSV rows together** before writing any MV SQL — this is when voids/refunds/tips/VAT semantics get confirmed.
**Delivers:** Python Playwright scraper in GitHub Actions cron `0 2 * * *`; persistent `storageState` in encrypted GHA secret; 2-day overlap window for replay; `hashlib.sha256` CSV header schema sentinel; Slack/Discord failure webhook; `card_hash = sha256(pan_token || restaurant_id)` computed before Supabase write; upsert on `(restaurant_id, source_tx_id)`.
**Uses:** Python 3.12, Playwright 1.48+, pandas 2.2+, supabase-py 2.x, GitHub Actions cron.
**Implements:** Extraction layer component from ARCHITECTURE.md.
**Avoids:** Pitfalls #7 (storageState expires silent), #8 (CSV schema drift), #9 (voids/refunds/tips math), #24 (captcha / bot detection).

### Phase 3: Analytics SQL (Materialized Views + Wrapper Views)
**Rationale:** The cohort MV is the trunk — retention, LTV, repeat rate, frequency distribution, new/returning split are all leaves on the same SQL tree. Build the template once (from Phase 1), copy for the rest. Bake survivorship guardrails (cohort age column, max-observable-horizon clipping) into the SQL layer, not the UI layer, so every caller gets them.
**Delivers:** `normalize-transactions` pg_cron job; `cohort_mv`, `ltv_mv`, `freq_mv` each with unique index + `_v` wrapper + `REVOKE ALL`; `refresh-analytical-mvs` pg_cron with `CONCURRENTLY`; SQL tests asserting (a) first-visit classification via `MIN(occurred_at) GROUP BY card_hash`, (b) void/refund/tip math matches hand-calculated expected, (c) cohort-age column present, (d) day-of-week `AT TIME ZONE` correctness.
**Uses:** Postgres MVs, pg_cron, `generate_series AT TIME ZONE`.
**Implements:** Data plane analytical layer from ARCHITECTURE.md.
**Avoids:** Pitfalls #2 (survivorship bias), #6 (window function off-by-one), #9 (voids/refunds/tips), #13 (missing CONCURRENTLY), #16 (generate_series TZ trap).

### Phase 4: Mobile Reader UI (SvelteKit Dashboard)
**Rationale:** With the analytical views in place, the UI is cheap — every SvelteKit query is a one-liner against a `_v` view. The main risk shifts from data correctness to UX discipline: mobile-first 375px viewport, no customization, no filter builder, non-technical clarity. Show the friend a clickable screen early and weekly.
**Delivers:** Owner-briefing home screen (revenue/tx/avg ticket + deltas); first-visit weekly cohort retention curve; repeat-vs-new revenue split; visit frequency distribution; LTV-to-date per cohort with caveat copy; date preset chips (7/30/90); "Last updated Xh ago" from `MAX(ingested_at)` not render time; empty states; high-contrast outdoor-readable light theme.
**Uses:** SvelteKit 2 + adapter-cloudflare, `@supabase/ssr`, LayerChart, shadcn-svelte@next, Tailwind v4, date-fns.
**Implements:** Reader layer from ARCHITECTURE.md; P1 features from FEATURES.md.
**Avoids:** Pitfalls #10 (mobile chart illegibility — 4-series cap, touch tooltips, 14px axis labels), #18 (stale "last updated" lie), #23 (dashboard-for-self), #25 (premature multi-tenant UX).

### Phase 5: Narrative Insights + Forkability Hardening
**Rationale:** The Claude narrative card is the only non-blocking component per ARCHITECTURE.md — it ships last because it has zero upstream dependencies and its failure mode (no narrative today) is graceful. Forkability hardening (env-only config, `.env.example`, README fork instructions) also lands here as the final polish before handoff.
**Delivers:** `insights` table; `generate-insights` Edge Function using Claude Haiku; `trigger-insights` pg_cron via `pg_net.http_post`; prompt that passes numbers as ground truth with "phrase, never calculate" instruction; regex digit-guard post-generation; deterministic template fallback; `llm_calls` audit table; monthly spend cap check; env-driven config with `.env.example`; README with three-command fork-and-deploy.
**Uses:** Supabase Edge Functions (Deno), Anthropic Claude Haiku, `pg_net`.
**Implements:** Insight component from ARCHITECTURE.md; "forkable open-source repo" Active requirement.
**Avoids:** Pitfalls #4 (LLM hallucinated numbers), #12 (Claude cost blowup / Sonnet default), #20 (hardcoded config breaks forkability).

### Phase Ordering Rationale

- **Foundation-first is dependency-forced:** ARCHITECTURE.md's build order steps 1–5 must complete before any analytical SQL, or the wrapper-view discipline slips and the RLS-on-MV leak ships. Phase 1 cannot be shortened.
- **Extraction before analytics** because reading real CSV rows with the friend in Phase 2 is the only way to confirm voids/refunds/tips/VAT semantics before the MVs bake them in. Writing cohort SQL against imagined schema is rewrite-bait.
- **Analytics before UI** because every P1 feature (retention curve, LTV, frequency, new/returning split) is a thin render over the same cohort MV — build the trunk, reap the leaves. Starting with UI means mocking data and doing it twice.
- **Narrative last** because it is the only phase that can fail without blocking the product (empty narrative card is a graceful empty state). Shipping it earlier wastes the 2-week budget on prompt tuning while KPIs aren't even rendering.
- **Forkability hardening pairs with Phase 5** because until config is stable, `.env.example` churns. Late is correct.

### Research Flags

Phases likely needing deeper research via `/gsd:research-phase`:
- **Phase 2 (Extraction):** Orderbird-specific CSV schema (voids/refunds/tips/VAT/Trinkgeld field names and semantics), my.orderbird.com login flow, captcha/bot-detection posture, and DATEV email-parse fallback path. PITFALLS.md marks these MEDIUM confidence — confirm with real CSV in week 1.
- **Phase 3 (Analytics SQL):** Survivorship-bias guardrails in SQL (cohort-age column patterns, max-observable-horizon clipping, right-censoring best practices) — banking-analytics convention but unconventional in restaurant tooling; worth 30 min of prior-art scan before writing MV SQL.
- **Phase 5 (Narrative):** Prompt-engineering patterns for "phrase, don't calculate" constrained generation and digit-guard approaches — fast-moving 2026 LLM best practices; cached response test harness setup.

Phases with standard patterns (skip deeper research):
- **Phase 1 (Foundation):** Supabase RLS + `@supabase/ssr` + custom access token hook are fully documented; wrapper-view pattern is captured in ARCHITECTURE.md.
- **Phase 4 (UI):** SvelteKit + LayerChart + shadcn-svelte + Tailwind v4 are well-documented; the risk is UX discipline, not technical pattern discovery.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Validated against Supabase, SvelteKit, Cloudflare, npm current versions; deprecations (auth-helpers, svelte-chartjs, Moment) confirmed |
| Features | MEDIUM-HIGH | SMB POS dashboard conventions well-documented; "banking analytics applied to restaurants" is novel so differentiator list is opinionated but grounded in founder domain expertise |
| Architecture | HIGH | RLS-wrapper pattern, pg_cron orchestration, idempotency-by-natural-key are canonical Supabase patterns; MEDIUM only on Claude prompt-guard details |
| Pitfalls | HIGH | RLS/Postgres/timezone pitfalls well-documented; MEDIUM only on Orderbird-specific CSV behavior (inferred from EU POS conventions, confirm week 1) |

**Overall confidence:** HIGH

### Gaps to Address

- **Orderbird CSV field semantics** (voids, refunds, tips, brutto/netto, Trinkgeld, service charge) — confirm in week 1 by reading 20 real rows with the friend before writing MV SQL. Phase 2 prerequisite.
- **Orderbird login / captcha posture** — unknown until the scraper actually runs against production; have DATEV email-parse fallback ready as Phase 4 spike.
- **Cohort viz choice (curve vs triangle)** — opinionated recommendation is retention curve at 375px; validate with the friend in Phase 4 week 1 screen-share.
- **LTV "max-observable-horizon clipping" rule** — the exact N-weeks threshold for hiding survivorship-biased numbers needs a real data sample to set; Phase 3 decision.
- **Timezone handling for DST transitions** — daily/weekly rollups are safe; hour-of-day heatmap (deferred to v1.x) will need explicit DST handling when it ships.

## Sources

### Primary (HIGH confidence)
- PROJECT.md — authoritative requirements, constraints, out-of-scope
- STACK.md — versions validated against Supabase, SvelteKit, Cloudflare, npm (April 2026)
- ARCHITECTURE.md — data plane pattern matches Supabase canonical docs
- PITFALLS.md — CI-enforceable checks grounded in known Postgres/Supabase footguns
- Supabase docs (`@supabase/ssr`, pg_cron, pg_net, custom access token hook, RLS on MVs discussion #17790)
- SvelteKit Cloudflare adapter docs; PostgreSQL `REFRESH MATERIALIZED VIEW CONCURRENTLY` docs

### Secondary (MEDIUM confidence)
- Toast / Square / Lightspeed public product pages (competitor feature conventions)
- LayerChart + shadcn-svelte@next migration notes (pre-1.0 `@next` channel)
- EU POS CSV conventions (brutto/netto, VAT, Trinkgeld) — confirm week 1 with real data
- Scheduled Playwright with GitHub Actions pattern references

### Tertiary (LOW confidence)
- Orderbird-specific CSV schema behavior (column names, delimiters) — inferred from generic EU POS patterns; must validate when first CSV lands

---
*Research completed: 2026-04-13*
*Ready for roadmap: yes*
