<!-- GSD:project-start source:PROJECT.md -->
## Project

**Ramen Bones Analytics**

A free, forkable, mobile-first analytics web app that turns Orderbird POS transactions into banking-grade growth metrics (cohorts, retention, LTV) for non-technical restaurant owners. V1 serves a single ramen restaurant (the founder's friend); the architecture is built multi-tenant-ready so any restaurant owner can eventually fork or self-host.

**Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

### Constraints

- **Tech stack:** SvelteKit + Cloudflare Pages (frontend), Supabase Postgres + Edge Functions + pg_cron (backend), Python + Playwright (extraction), Claude API (insight generation). No paid tiers in v1.
- **Timeline:** 2 weeks to MVP in friend's hands. Aggressive — skip polish, prioritize working KPIs over pixel-perfect UI.
- **Budget:** $0/month target. Free tiers only. Acceptable to reach ~$25/mo at 100+ restaurants later.
- **Data freshness:** Daily refresh (nightly cron) — no realtime/hourly in v1.
- **Mobile-first:** All views must be usable on a phone browser. Desktop is secondary.
- **Multi-tenant readiness:** RLS and tenant-scoped schema from day 1, even though v1 has one tenant. No rewrite later.
- **Forkability:** Repo must be forkable + self-hostable with minimal steps. No proprietary SaaS lock-in.
- **Security:** Card-hash only — never store PAN, PII, or raw card data. Supabase Auth handles credentials.
- **No Orderbird API yet:** v1 ships on Playwright scraper while ISV Partner API application is pending.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Executive Take
## Recommended Stack
### Core Technologies
| Technology | Version (April 2026) | Purpose | Why Recommended |
|------------|----------------------|---------|-----------------|
| **SvelteKit** | 2.x (current) | App framework | First-class Cloudflare adapter, Svelte 5 runes = smallest mobile JS bundle among mainstream frameworks. Next.js on CF has documented adapter friction — SvelteKit avoids that entirely. |
| **Svelte** | 5.x (runes) | UI reactivity | `$state`/`$derived`/`$effect` runes work outside `.svelte` files — cleaner shared stores for filter state across dashboard views. `$app/stores` is deprecated; use `$app/state`. |
| **@sveltejs/adapter-cloudflare** | 7.2.8 | CF Pages build target | Official adapter, actively maintained. Handles `platform.env` bindings for server hooks. |
| **Cloudflare Pages** | — | Static hosting + SSR | Free tier: unlimited requests, unlimited bandwidth, 500 builds/mo. Edge-deployed globally → fast phone loads. |
| **Supabase Postgres** | Postgres 15+ | Primary datastore | Free tier: 500 MB DB, 2 projects, RLS built-in, pg_cron available via extension. Postgres window functions + CTEs + `generate_series` are required for the cohort/retention SQL; D1 cannot do this. |
| **@supabase/supabase-js** | 2.103.x | DB client | Current stable. Works in Cloudflare Workers runtime (fetch-based, no Node APIs). |
| **@supabase/ssr** | latest (0.5.x+) | SvelteKit auth cookies | **Replaces the deprecated `@supabase/auth-helpers-sveltekit`**. Cookie-based SSR session, safe for server hooks. Mandatory: do **not** use the old auth-helpers package — it is sunset. |
| **pg_cron** | extension (enabled via Dashboard) | Nightly materialized view refresh | Built into Supabase. Use `cron.schedule('refresh-mv', '0 3 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY cohort_mv;')`. Jobs/logs live in `cron.job` and `cron.job_run_details`. |
| **Supabase Edge Functions** | Deno runtime | Claude API insight job | Free tier: 500K invocations/month. Triggered by pg_cron (`cron.schedule` → `net.http_post`) after MV refresh. Holds the Anthropic API key as secret. |
| **Python** | 3.12+ | Extraction runtime | Playwright-Python is more mature than Playwright-Node for headed-browser scrapers; pandas/polars ecosystem for CSV shaping. |
| **Playwright (Python)** | 1.48+ | Orderbird CSV scraper | Headless Chromium, handles login + CSV export download. Run in GitHub Actions (free unlimited for public repos). |
| **GitHub Actions** | — | Cron host for scraper | **Free unlimited minutes for public repos**; ~2000 min/mo for private. Cron `schedule` trigger (`'0 2 * * *'`). This is the canonical free Playwright cron host in 2026 — no paid Render/Fly worker needed. |
| **Anthropic Claude API** | `claude-sonnet-4.5` or `claude-haiku-4` | Nightly narrative insights | Haiku is 10× cheaper and plenty for 1-page-of-numbers summaries. Called from Edge Function post-MV-refresh. |
### Supporting Libraries (FLAGGED — user has not specified these)
| Library | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| **LayerChart** | 2.x (Svelte 5 native) | Charts (cohort curves, LTV bars, KPI sparklines) | Composable SVG primitives built on Layer Cake, **native Svelte 5** (not a compat wrapper). `svelte-chartjs` is unmaintained and does not support Svelte 5 — avoid. LayerChart's modular SVG approach = small bundle, good mobile perf. |
| **shadcn-svelte** (`@next`) | Tailwind v4 compatible | UI primitives (Button, Card, Select, Sheet, Tabs) | Copy-paste components, not a dependency — forkers can customize freely. `@next` CLI initializes with Tailwind v4 + Svelte 5 + `data-slot` styling hooks. |
| **Tailwind CSS** | v4.x | Styling | v4 uses Vite plugin (not PostCSS), faster builds, OKLCH color conversion automatic. Mobile-first breakpoints are default. |
| **date-fns** | 4.x | Date math, formatting, cohort bucketing | TypeScript-native, tree-shakes to ~2–5 kB for the functions this app needs (`startOfWeek`, `startOfMonth`, `format`, `differenceInDays`). **Do not wait for Temporal** — still polyfill-required on Cloudflare Workers runtime in April 2026. **Do not use Moment.js** (deprecated). Day.js is fine too but date-fns has better TS inference. |
| **pandas** | 2.2+ | Python CSV shaping in extractor | For Orderbird CSVs (< 100 k rows) pandas is the practical choice — mature, familiar, integrates with `supabase-py` upserts. Polars is overkill at this scale; pick it up only if row counts explode past ~1 M. |
| **supabase-py** | 2.x | Python → Supabase upserts | Official Python client. Used by the extractor to write raw transactions to `stg_orderbird_tx`. |
| **python-dotenv** | latest | Local secret loading | Standard for local dev; GitHub Actions uses `secrets.*` in workflow. |
| **zod** | 3.x | Runtime schema validation on API boundaries | Validate filter query params in SvelteKit `+page.server.ts` load functions. Prevents RLS bypass via bad input. |
| **valibot** (alternative to zod) | 1.x | Smaller-bundle validator | Use if mobile bundle budget gets tight — ~10× smaller than zod, same DX. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **Vite** | 5.x | Bundler (built into SvelteKit 2) | Tailwind v4 plugin replaces PostCSS config |
| **Supabase CLI** | 1.x | Local Supabase, migrations, types | `supabase gen types typescript` → feed SvelteKit for end-to-end type safety |
| **GitHub Actions** | — | CI + scraper cron + deploy | Single platform for everything. Keep workflow file per job. |
| **Wrangler** | 3.x | CF Pages local preview | `wrangler pages dev` to test adapter-cloudflare output locally |
| **Playwright codegen** | — | Record Orderbird login flow | `playwright codegen my.orderbird.com` → auto-generates selectors for scraper |
## Installation
# SvelteKit app
# Python extractor
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| SvelteKit + CF Pages | Next.js + Vercel | You need React ecosystem libraries unavailable in Svelte. **Not for this project** — CF adapter friction was already disqualifying. |
| Supabase Postgres | Cloudflare D1 | Simple key-value / flat-table apps. **Not for this project** — cohort SQL requires Postgres window functions. |
| pg_cron + materialized views | dbt Core | You have 50+ models and a team maintaining them. Current scale (~5–10 models) doesn't justify dbt setup cost. |
| Playwright in GitHub Actions | Render/Fly.io cron worker | You need >6hr runtime or Windows/Mac browser. GHA free tier covers the 2 min daily nightly run for years. |
| LayerChart | Chart.js (direct, no wrapper) | You already have Chart.js muscle memory. Tradeoff: no Svelte 5 wrapper, manual lifecycle management. |
| LayerChart | Apache ECharts via svelte-echarts | Very complex dashboards (candlesticks, 3D, maps). Larger bundle — not mobile-friendly. |
| date-fns | Day.js | You want Moment-style chaining API. Both are fine; date-fns wins on TS. |
| date-fns | Temporal (native) | Node 24+ with flag / you ship only to Chrome 144+. **Not yet for CF Workers runtime.** |
| pandas | Polars | Row counts >1 M or memory-constrained extractor. Not needed at current scale. |
| shadcn-svelte | Skeleton UI / Bits UI | You want a themed design system out of the box vs. copy-paste primitives. shadcn-svelte wins on forkability (no npm lock-in on UI). |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`@supabase/auth-helpers-sveltekit`** | Officially deprecated; Supabase consolidated all framework helpers into `@supabase/ssr`. | `@supabase/ssr` |
| **`svelte-chartjs`** | Unmaintained, no Svelte 5 support. | LayerChart (Svelte 5 native) |
| **Next.js on Cloudflare Pages** | Adapter friction, edge runtime quirks, larger mobile bundle. Already rejected in PROJECT.md. | SvelteKit + `adapter-cloudflare` |
| **Moment.js** | Deprecated by its own maintainers since 2020. 70+ kB. | date-fns or Day.js |
| **Cloudflare D1 for analytics** | No window functions, no `generate_series`, no materialized views. Cohort SQL is impossible. | Supabase Postgres |
| **Streamlit** | Already rejected; mobile layout unusable. | SvelteKit |
| **Direct Orderbird CSV fetch via `requests`** | Orderbird login is JS-driven; session cookies expire. | Playwright with persistent storage state |
| **Running Claude API calls from the browser** | Leaks API key. | Supabase Edge Function, triggered by pg_cron via `pg_net` |
| **Querying raw `orders` table from SvelteKit load functions** | RLS + full-table scans + phone = slow. | Query materialized views (`cohort_mv`, `ltv_mv`, `kpi_daily_mv`) only |
| **Supabase Realtime** | Adds complexity, out of scope per PROJECT.md (daily refresh is enough). | Page reload after nightly cron |
| **`pg_cron` on a schedule tighter than MV refresh time** | Overlapping refreshes fail. | `REFRESH MATERIALIZED VIEW **CONCURRENTLY**` + unique index on MV; schedule with margin |
## Critical Gotchas (Architectural)
### 1. RLS + Materialized Views Don't Mix Naively
- **Security-definer wrapper view:** `CREATE VIEW cohort_v AS SELECT * FROM cohort_mv WHERE tenant_id = auth.jwt()->>'tenant_id'` — then grant RLS on the view.
- **Tenant-scoped MVs via schema-per-tenant:** heavier, only if you hit perf walls.
### 2. `REFRESH MATERIALIZED VIEW CONCURRENTLY` Requires a Unique Index
### 3. `@supabase/ssr` Session Trust
### 4. Cloudflare Workers Runtime ≠ Node
### 5. Playwright in GitHub Actions Needs Persistent Auth State
### 6. Anthropic API Key from Edge Function
## Stack Patterns by Variant
- Full stack as above
- pandas in extractor is fine
- MVs refreshed nightly, full rebuild acceptable
- Swap pandas → Polars in extractor
- Consider incremental MV refresh via triggers instead of full rebuild
- Re-evaluate dbt Core vs hand-written SQL
- Move extractor from GitHub Actions → dedicated worker (Fly.io $0 tier or Railway)
- Replace Playwright scraper with direct API polling (Python `httpx`)
- Keep the rest of the stack identical
- Extractor moves from scraper-with-browser to simple script (can even run in Supabase Edge Function directly, killing the GHA dependency)
## Version Compatibility Matrix
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| SvelteKit 2.x | Svelte 5.x | Required; Svelte 4 is EOL |
| `@sveltejs/adapter-cloudflare` 7.x | SvelteKit 2.x | Uses Workers assets binding |
| `@supabase/ssr` 0.5.x+ | `@supabase/supabase-js` 2.x | Must match major version |
| shadcn-svelte `@next` | Tailwind v4 + Svelte 5 | Old `shadcn-svelte` (stable) still ships Tailwind v3 — use `@next` |
| LayerChart 2.x | Svelte 5 | 1.x is Svelte 4 compat mode — avoid for new projects |
| Tailwind v4 | Vite 5+ | Uses Vite plugin, not PostCSS |
| pg_cron | Supabase project (any tier) | Enable via Dashboard → Database → Extensions |
| Playwright 1.48+ | Python 3.10+ | 3.12 recommended for GHA runner speed |
## Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| SvelteKit + CF + Supabase core | **HIGH** | Validated against Supabase official docs, SvelteKit docs, Cloudflare docs, current npm versions |
| `@supabase/ssr` replacing auth-helpers | **HIGH** | Explicit migration notice in Supabase docs |
| LayerChart recommendation | **MEDIUM** | Svelte 5 native confirmed; "best chart lib" is subjective, but `svelte-chartjs` being dead is verified |
| date-fns over Temporal | **HIGH** | Temporal not yet in Workers runtime — verified stage-4 status and polyfill requirement |
| GitHub Actions as scraper host | **HIGH** | Free-tier terms verified; widely used pattern |
| pg_cron RLS footgun | **HIGH** | Known issue, multiple Supabase discussions confirm |
| pandas vs polars at this scale | **MEDIUM** | Personal call; pandas is safe default |
| shadcn-svelte `@next` | **MEDIUM** | `@next` channel is stable but pre-1.0; watch for breaking changes |
## Sources
- [SvelteKit Cloudflare adapter docs](https://svelte.dev/docs/kit/adapter-cloudflare) — HIGH
- [@sveltejs/adapter-cloudflare on npm](https://www.npmjs.com/package/@sveltejs/adapter-cloudflare) — version 7.2.8 confirmed
- [Supabase SvelteKit SSR auth guide](https://supabase.com/docs/guides/auth/server-side/sveltekit) — HIGH
- [Supabase auth-helpers migration notice](https://supabase.com/docs/guides/auth/auth-helpers/sveltekit) — confirms deprecation
- [@supabase/supabase-js on npm](https://www.npmjs.com/package/@supabase/supabase-js) — 2.103.0 current
- [Supabase pg_cron docs](https://supabase.com/docs/guides/database/extensions/pg_cron) — HIGH
- [Supabase RLS on materialized views discussion #17790](https://github.com/orgs/supabase/discussions/17790) — confirms footgun
- [shadcn-svelte Tailwind v4 migration](https://www.shadcn-svelte.com/docs/migration/tailwind-v4) — HIGH
- [LayerChart GitHub](https://github.com/techniq/layerchart) and [LayerChart 2.0 PR #449](https://github.com/techniq/layerchart/pull/449) — Svelte 5 native confirmed
- [Scheduled Playwright with GitHub Actions](https://www.marcveens.nl/posts/scheduled-web-scraping-made-easy-using-playwright-with-github-actions) — MEDIUM (pattern reference)
- [GitHub Actions free cron tiers](https://dev.to/britzdm/how-to-run-scheduled-cron-jobs-in-github-workflows-for-free-4pgn) — HIGH
- [Temporal API 2026 status (Bryntum)](https://bryntum.com/blog/javascript-temporal-is-it-finally-here/) — confirms not-yet-ready for Workers
- [Polars vs Pandas 2026 (Kanaries)](https://docs.kanaries.net/articles/polars-vs-pandas) — MEDIUM
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- One SQL migration per logical unit (table, MV, or function group)
- Python forecast scripts mirror `scripts/external/` layout: one file per model, shared utilities, orchestrator
- `pipeline_runs` row per model fit for cascade freshness telemetry
- Service-role Supabase client for batch writes; RLS-scoped wrapper views for reads
- `restaurant_id` everywhere (CI Guard 7 enforces; never `tenant_id`)
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:docs/workflow.md -->
## Development Workflow (canonical)

**Every feature follows [`docs/workflow.md`](docs/workflow.md)** — the 19-row command sequence integrating GSD + GStack + Superpowers, with a tier picker (1 / 2 / 2F / 3) and artifact layout. Read it before any feature work.

Quick rules (full list in `docs/workflow.md`):
- **Skip `/gsd-plan-phase`** — Superpowers owns implementation plans (row 9: `superpowers:writing-plans`).
- **Skip `superpowers:brainstorming`** — `/gstack-office-hours` does that job (row 4).
- Use `/gsd-quick` for tier 1 only (doc-only, config, rename).
- Phase work always on a `feature/phase-<NN>-<slug>` branch (Superpowers refuses `main`).
- Frameworks pinned in `.claude/PLUGINS.md`.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
