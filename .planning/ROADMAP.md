# Roadmap: Ramen Bones Analytics

**Created:** 2026-04-13
**Granularity:** standard
**Parallelization:** enabled
**Coverage:** 39/39 v1 requirements mapped (Phase 2 retargeted from scraper → CSV ingestion; EXT-01..07 replaced by ING-01..05)

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Phases

- [ ] **Phase 1: Foundation** — Multi-tenant schema, auth, RLS, wrapper-view template, CI guards
- [ ] **Phase 2: Ingestion** — Pre-joined CSV loader → staging → normalized transactions (no scraper; CSV produced out-of-band)
- [ ] **Phase 3: Analytics SQL** — Cohort/LTV/KPI/frequency MVs with wrapper views and survivorship guardrails
- [x] **Phase 4: Mobile Reader UI** — SvelteKit dashboard on Cloudflare Pages at 375px baseline (completed 2026-04-14)
- [x] **Phase 5: Insights & Forkability** — Claude Haiku narrative card; v1 shipped to friend 2026-04-15

## Phase Details

### Phase 1: Foundation
**Goal**: Multi-tenant data plane is provably isolated and day-boundary-correct before any analytical SQL is written
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08
**Success Criteria** (what must be TRUE):
  1. A logged-in user can only read rows for their own `restaurant_id`, verified by a two-tenant CI integration test that seeds tenants A and B and asserts zero cross-reads in every wrapper view
  2. A user can sign in with email/password via Supabase Auth and the session survives a browser refresh
  3. The first materialized view (`kpi_daily_mv`) has a unique index, a `_v` wrapper view, and `REVOKE ALL` on the underlying MV from `authenticated`/`anon` — establishing the template every later MV copies
  4. Every analytical query derives `business_date` via `AT TIME ZONE r.timezone`, with a test fixture at 23:45 Berlin landing in the correct business day
  5. CI grep guards fail the build on raw `_mv` references from `src/`, `getSession` on server, `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`, and `card_hash` joined to PII columns
**Plans**: 6 plans
  - [x] 01-01-PLAN.md — Bootstrap repo (Node + Supabase CLI + Vitest) + tenancy/transactions migrations
  - [x] 01-02-PLAN.md — Custom Access Token Hook migration + Dashboard registration doc
  - [x] 01-03-PLAN.md — kpi_daily_mv wrapper-view template + v1 seed migration
  - [x] 01-04-PLAN.md — SvelteKit hooks/login reference files under docs/reference
  - [x] 01-05-PLAN.md — CI grep guards script + 3 GHA workflows (guards/tests/migrations)
  - [x] 01-06-PLAN.md — Vitest integration suite (7 tests) + README forker quickstart
**UI hint**: yes

### Phase 2: Ingestion
**Goal**: The pre-joined Orderbird CSV loads idempotently into `stg_orderbird_order_items` and normalizes into `transactions` with documented semantics confirmed against real rows
**Depends on**: Phase 1
**Requirements**: ING-01, ING-02, ING-03, ING-04, ING-05
**Success Criteria** (what must be TRUE):
  1. A loader script reads `orderbird_data/5-JOINED_DATA_*/ramen_bones_order_items.csv` (pre-joined per-order-item export produced out-of-band via Claude coworking; the Orderbird scraper is NOT in scope) and upserts rows into `stg_orderbird_order_items`
  2. Re-running the loader produces zero diffs in `transactions` — natural-key upsert on `(restaurant_id, source_tx_id)` where `source_tx_id = order_id` is provably idempotent
  3. A SQL normalization step promotes staged rows to `transactions` with documented, unit-tested handling of voids, refunds, tips (Trinkgeld), and brutto vs netto — founder has reviewed ≥20 real CSV rows first
  4. `card_hash = sha256(wl_card_number || restaurant_id)` is computed in the loader before any DB write, so raw card data never reaches Supabase; cash customers have NULL `card_hash` and are excluded from cohort analytics (expected behavior)
  5. The loader is re-runnable: dropping a newer CSV into the folder and re-running brings `transactions` current without data loss or duplicates
**Plans**: TBD
**Out of scope**: Playwright scraper, GHA cron for ingestion, `storageState` session management, captcha/login-break alerting — the CSV is produced out-of-band by the founder via Claude coworking and committed/dropped into the repo manually for now

### Phase 3: Analytics SQL
**Goal**: The cohort trunk and its leaves (retention, LTV, KPIs, frequency, new/returning) are queryable through wrapper views with survivorship guards baked into SQL, not UI
**Depends on**: Phase 1, Phase 2
**Requirements**: ANL-01, ANL-02, ANL-03, ANL-04, ANL-05, ANL-06, ANL-07, ANL-08, ANL-09
**Success Criteria** (what must be TRUE):
  1. `cohort_mv` assigns each `card_hash` to a first-visit cohort (daily/weekly/monthly grain) via `MIN(occurred_at) GROUP BY card_hash`, verified by a fixture of 3 customers with known retention buckets
  2. `retention_curve_v`, `ltv_v`, `kpi_daily_v`, `frequency_v`, and `new_vs_returning_v` return tenant-scoped rows through wrapper views only, with raw `_mv` locked behind `REVOKE ALL`
  3. LTV and retention outputs clip to the shortest cohort's observable horizon and expose `cohort_age_weeks`, so recent cohorts cannot display survivorship-biased numbers
  4. `pg_cron` refreshes every MV nightly with `REFRESH MATERIALIZED VIEW CONCURRENTLY` against a mandatory unique index, and a CI grep fails the build on any frontend query referencing `*_mv` or raw `transactions`
**Plans**: 5 plans
  - [x] 03-01-PLAN.md — Wave 0: RED test scaffold (phase3-analytics.test.ts + 3-customer fixture + ci-guards unit test)
  - [x] 03-02-PLAN.md — 0010_cohort_mv.sql (trunk MV: day/week/month grain, cash + April excluded)
  - [x] 03-03-PLAN.md — 0011_kpi_daily_mv_real.sql (replace placeholder body, drop-cascade-recreate)
  - [x] 03-04-PLAN.md — 0012_leaf_views.sql (retention, ltv, frequency, new_vs_returning with 4 buckets)
  - [x] 03-05-PLAN.md — 0013 refresh function + pg_cron + ci-guards extension + tenant-isolation test extension

### Phase 4: Mobile Reader UI
**Goal**: The friend opens the dashboard on their phone and reads revenue, cohorts, LTV, frequency, and new-vs-returning at a 375px viewport with preset date chips
**Depends on**: Phase 1, Phase 3
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11
**Success Criteria** (what must be TRUE):
  1. The SvelteKit 2 + Svelte 5 + `adapter-cloudflare` app deploys to Cloudflare Pages, authenticates via `@supabase/ssr`, and renders a mobile-first single-column layout at 375px with no horizontal scroll
  2. After login, the friend sees revenue KPI cards (today / 7d / 30d, avg ticket, tx count) at the top of the dashboard with a trustworthy "Last updated Xh ago" derived from `MAX(ingested_at)`
  3. Cohort retention curve, LTV-to-date (with data-depth caveat copy), repeat visit rate, and visit-frequency distribution each render as a single-purpose card with ≤4 series, touch tooltips, and graceful empty states
  4. Preset date-range chips (Today / 7d / 30d / 90d / All) are the only global filter and every PR is verified at the 375px viewport before merge
**Plans**: 5 plans
**Wave structure**: 04-01 (wave 1) → 04-02 (wave 2) → 04-03 (wave 3) → 04-04 (wave 4) → 04-05 (wave 5). Fully sequential — every plan after 04-01 mutates `src/routes/+page.server.ts` + `src/routes/+page.svelte` + `tests/unit/cards.test.ts`, so parallelism would cause merge conflicts.
  - [x] 04-01-PLAN.md — [wave 1] Bootstrap SvelteKit+Tailwind v4+shadcn-svelte@next, copy reference auth files, 0014_data_freshness_v.sql, Vitest+Playwright RED scaffold (15 seed-todos)
  - [x] 04-02-PLAN.md — [wave 2] Root loader + app shell + sticky DateRangeChips + FreshnessLabel + EmptyState (375px layout) — flips 1 todo → 14 remain
  - [x] 04-03-PLAN.md — [wave 3] KPI tiles (3 fixed + 2 chip-scoped) via parallel kpi_daily_v queries with server-side deltas — flips 4 todos → 10 remain
  - [x] 04-04-PLAN.md — [wave 4] CohortRetentionCard (LayerChart Spline) + LtvCard (LayerChart Bars) + GrainToggle (chip-independent) — flips 5 todos + adds 1 new sparse-fallback test → 5 remain
  - [x] 04-05-PLAN.md — [wave 5] FrequencyCard (plain divs) + NewVsReturningCard (D-19a chip-scoped) + PR 375px template + friend iPhone checkpoint — flips final 5 todos → 0 remain
**UI hint**: yes

### Phase 5: Insights & Forkability
**Goal**: A nightly plain-English insight card lands on the dashboard, and any restaurant owner can fork the repo and self-host with a README
**Depends on**: Phase 3, Phase 4
**Requirements**: INS-01, INS-02, INS-03, INS-04, INS-05, INS-06
**Success Criteria** (what must be TRUE):
  1. A nightly Supabase Edge Function calls Claude Haiku with the tenant's KPI payload and writes a headline+body row to the `insights` table, with the Anthropic API key living only as a Supabase secret
  2. A digit-guard regex rejects any LLM output containing numbers not in the input payload, falling back to a deterministic template so a hallucinated figure cannot reach the owner
  3. The dashboard renders the latest insight card for the logged-in tenant and hides the card gracefully if no insight exists for the day
  4. The public repository is forkable with a README describing one-click deploy (Cloudflare Pages + Supabase project + GHA secrets) and a `.env.example` documenting every required environment variable
**Plans**: 9 plans
**Wave structure**: 05-01 + 05-02 (wave 1, parallel) → 05-03 + 05-04 (wave 2, parallel) → 05-05 (wave 3) → 05-06 Task 1 (wave 4, partial) → **05-07 + 05-08 + 05-09 (wave 5, parallel gap closure — unblock 05-06 Task 3)** → 05-06 Tasks 2-3 (wave 6, ship checkpoint resumes)
  - [x] 05-01-PLAN.md — [wave 1] Migrations 0016_insights_table.sql + 0017_insights_cron.sql (table + insights_v wrapper + pg_net + cron schedule 15 3 * * * UTC)
  - [x] 05-02-PLAN.md — [wave 1] Wave 0 RED test scaffold (deno.json + digit-guard.test + payload.test + fallback.test + InsightCard.test + fork-dryrun.sh stub)
  - [x] 05-03-PLAN.md — [wave 2] Edge Function implementation (digitGuard/fallback/payload/prompt/index.ts) + deploy + flip Deno tests GREEN
  - [x] 05-04-PLAN.md — [wave 2] InsightCard.svelte + +page.server.ts loader + +page.svelte card stream + ci-guards extension + flip Vitest tests GREEN
  - [x] 05-05-PLAN.md — [wave 3] Forkability: README Phase 2-5+Ship sections + sectioned .env.example + MIT LICENSE + working fork-dryrun.sh
  - [x] 05-06-PLAN.md — [wave 4/6] Ship: gh repo metadata + public flip + friend iPhone sign-off ("could see the chart too"); T2 fork walkthrough deferred out of v1 scope (2026-04-15)
  - [x] 05-07-PLAN.md — [wave 5, gap closure] Cloudflare Pages deploy: wrangler.toml + one-time project create + wrangler pages deploy → capture pages.dev URL (closes Gap 1)
  - [ ] 05-08-PLAN.md — [wave 5, gap closure] Provision friend's Supabase Auth user + memberships row + verify JWT restaurant_id claim + secure credential handoff (closes Gap 2)
  - [x] 05-09-PLAN.md — [wave 5, gap closure] Seed ≥50 recent synthetic transactions + refresh MVs + re-invoke generate-insight → fallback_used=false with real numbers (closes Gap 3)

## Milestone v1.1 — Dashboard Redesign (started 2026-04-15)

**Goal:** Replace the v1.0 KPI-tile dashboard with a chart-first, richly-filterable analytics surface built on a pragmatic star schema.

**Architecture summary:** One atomic fact (`fct_transactions`) + one customer dimension (`dim_customer`) + four thin day-grain rollup MVs. Filter dims denormalized on the fact for zero-join query speed. All refresh stays inside the existing nightly `refresh_analytics_mvs()` cron.

### Phases

- [x] **Phase 6: Filter Foundation** — Custom date-range picker, day/week/month toggle, 4 dropdown filters wired through zod-validated SSR params against existing wrapper views (completed 2026-04-15)
- [ ] **Phase 7: Column Promotion** — Lift `wl_issuing_country` + `card_type` from staging into `transactions` via migration + loader + backfill
- [ ] **Phase 8: Star Schema** — Build `dim_customer` and `fct_transactions` MVs with window fns, indexes, RLS wrappers, and DAG-ordered refresh
- [ ] **Phase 9: Chart Rollups** — Four thin day-grain aggregation MVs on top of `fct_transactions` (`mv_new_customers_daily`, `mv_repeater_daily`, `mv_retention_monthly`, `mv_inter_visit_histogram`)
- [ ] **Phase 10: Chart Components** — Four new Svelte chart components, all honoring the 6-filter contract, at 375px
- [ ] **Phase 11: Bug Fixes** — Close the two Phase 4 UAT gaps (empty NVR card, LTV sparse bars)
- [ ] **Phase 12: Brainstorm Extras (optional / parkable)** — Weekday×hour heatmap, item-Pareto, ticket histogram, seasonality curve — only built if there's runway

### Phase 6: Filter Foundation
**Goal**: A shared filter bar (date range, granularity, sales type, payment method, country, repeater bucket) drives every existing v1.0 card through a single zod-validated SSR pipeline, so the UX win ships before any data-model change
**Depends on**: Phase 5 (v1.0 complete)
**Requirements**: FLT-01, FLT-02, FLT-03, FLT-04, FLT-07
**Scope amendment (2026-04-15):** FLT-05 (country) moved to Phase 7 and FLT-06 (repeater bucket) moved to Phase 8 because both filters depend on columns/views that don't yet exist on v1.0 — see .planning/phases/06-filter-foundation/06-CONTEXT.md D-01.
**Success Criteria**:
  1. A user can pick an arbitrary date range (or a preset), a day/week/month granularity, and the 2 available dropdown filters (sales type, payment method), and every v1.0 card re-renders with correctly scoped numbers at 375px
  2. The SSR `+page.server.ts` load function composes WHERE clauses from zod-validated query params only — no string interpolation, no dynamic SQL, ci-guards grep for `${` inside `.from(…)` fails the build
  3. The payment-method and country dropdowns are populated from `SELECT DISTINCT` against the relevant wrapper view at load time — no hardcoded whitelist, adding a new country requires zero code change
  4. All 4 dropdowns surface an "All" sentinel that cleanly degrades to no-op WHERE clause
**Plans**: 5 plans
  - [x] 06-01-PLAN.md — [wave 1] Wave 0 RED scaffold: zod filters schema + customToRange + Guard 6 + filter-bar e2e fixmes
  - [x] 06-02-PLAN.md — [wave 1] Hand-rolled UI primitives (popover, sheet, checkbox, command) + #popover-root
  - [x] 06-03-PLAN.md — [wave 2] Migration 0018 transactions_filterable_v + loader refactor to parseFilters + distinct option arrays
  - [x] 06-04-PLAN.md — [wave 3] FilterBar + DatePickerPopover + FilterSheet + MultiSelectDropdown; delete DateRangeChips; flip e2e stubs
  - [x] 06-05-PLAN.md — [wave 4] ROADMAP/REQUIREMENTS patch for FLT-05/06 (D-01 scope amendment) + 375px human-verify checkpoint

### Phase 7: Column Promotion
**Goal**: `transactions.wl_issuing_country` and `transactions.card_type` are populated for every row — new ingests and historical — so Phase 8 window functions can denormalize them onto the fact
**Depends on**: Phase 6 (parallel-safe; Phase 7 is a pure backend change)
**Requirements**: DM-01, DM-02, DM-03, FLT-05
**Success Criteria**:
  1. Migration `0018_transactions_country_cardtype.sql` adds both columns as nullable; existing rows stay intact during the migration
  2. A one-shot backfill SQL (`DISTINCT ON (restaurant_id, invoice_number)` against `stg_orderbird_order_items`) populates both columns for all historical transactions; ≥20 invoices spot-checked against the raw CSV
  3. The CSV loader is updated to write both columns on future ingests, verified by an integration test that re-runs the loader and asserts zero diffs (idempotency preserved)
  4. A distinct-country check on `transactions` returns plausible values (at minimum `DE` plus ≥1 non-DE country, confirming tourist rows exist)
  5. The country dropdown filter (FLT-05) is wired through the existing Phase 6 filter schema (`src/lib/filters.ts`) and the loader now queries a refreshed `transactions_filterable_v` that exposes `wl_issuing_country`; supports "DE only" / "non-DE only" / individual-country multi-select.
**Plans**: TBD

### Phase 8: Star Schema
**Goal**: `dim_customer` and `fct_transactions` exist as tenant-scoped materialized views with every attribution column computed once, the correct indexes in place, and refresh DAG-ordered inside the existing nightly cron
**Depends on**: Phase 7
**Requirements**: DM-04, DM-05, DM-06, DM-07, DM-08, FLT-06
**Success Criteria**:
  1. `dim_customer` has one row per `(restaurant_id, card_hash)` with a unique index for `REFRESH CONCURRENTLY`, `lifetime_bucket` correctly assigned by the agreed CASE ladder, and a `dim_customer_v` RLS wrapper — a two-tenant isolation test proves cross-tenant reads are zero
  2. `fct_transactions` has one row per invoice with all 30+ columns materialized (time dims, measures, denormalized filter dims, visit-sequence window fns, customer-lifetime joins); a Nyquist test harness fixture of ≥3 customers with known visit sequences proves `visit_seq`, `is_first_visit`, `days_since_prev_visit`, and both bucket columns are computed correctly
  3. All 6 declared indexes exist on `fct_transactions` (1 unique + 5 secondary/partial) and `EXPLAIN ANALYZE` on a representative filter query uses the composite filter index instead of a sequential scan
  4. `refresh_analytics_mvs()` is modified in place to refresh `dim_customer` → `fct_transactions` → rollup MVs in DAG order, all `CONCURRENTLY`; the existing nightly 03:00 UTC pg_cron job still runs unchanged
  5. `ci-guards` Guard 1 regex is extended; a contract test proves a synthetic `.from('fct_transactions')` usage in `src/` fails the build
  6. The repeater-bucket dropdown filter (FLT-06) is wired through the Phase 6 filter schema against `dim_customer.lifetime_bucket` / `fct_transactions.lifetime_bucket`; supports all / first_timer / 2x / 3x / 4-5x / 6+.
**Plans**: TBD

### Phase 9: Chart Rollups
**Goal**: Four chart-specific day-grain rollup MVs exist on top of `fct_transactions`, each with unique indexes, RLS wrappers, and slots in the refresh DAG
**Depends on**: Phase 8
**Requirements**: CHT-01, CHT-02, CHT-03, CHT-04
**Success Criteria**:
  1. `mv_new_customers_daily` returns `COUNT(*) WHERE is_first_visit` grouped by `(restaurant_id, first_visit_date)`, with a unique index and a `mv_new_customers_daily_v` wrapper; fixture test proves the count matches the underlying `fct_transactions` row count at first_visit
  2. `mv_repeater_daily` rolls up additive measures at `(day × lifetime_bucket × visit_seq_bucket × sales_type × payment_method × wl_issuing_country)` grain; avg ticket is **not** materialized (computed on read as `revenue_cents / NULLIF(visits, 0)`)
  3. `mv_retention_monthly` mirrors the existing weekly retention SQL with `month` substituted for `week`, with horizon-clip caveat preserved
  4. `mv_inter_visit_histogram` bins `days_since_prev_visit` into the 6 CASE buckets, with a single CASE expression as the source of truth for bucket boundaries
  5. All 4 rollups are added to `refresh_analytics_mvs()` DAG step 3 (parallel-safe, all read from `fct_transactions`); nightly cron verified green for ≥1 run
**Plans**: TBD

### Phase 10: Chart Components
**Goal**: Four new Svelte chart components land on the dashboard, each reading its wrapper view, honoring all 6 filters, and verified at 375px — plus two existing charts (cohort retention, LTV) are updated to honor the new filters
**Depends on**: Phase 6 (filter contract), Phase 9 (data)
**Requirements**: CHT-05, CHT-06, CHT-07, CHT-08, CHT-09, CHT-10
**Success Criteria**:
  1. `NewCustomersChart` renders a time series (line or bars per granularity) from `mv_new_customers_daily_v`; sparse/empty states render a friendly "No new customers in this window" instead of a broken chart
  2. `RepeaterAttributionChart` renders stacked bars (first_timer / 2x / 3x / 4-5x / 6+) with a measure toggle (customer count / revenue / avg ticket), all served by a single `mv_repeater_daily_v` query
  3. `CohortRetentionChart` renders both weekly and monthly retention variants with a toggle, reading from `retention_curve_v` (existing) and `mv_retention_monthly_v` (new)
  4. `InterVisitHistogramChart` renders the return-day histogram from `mv_inter_visit_histogram_v`
  5. Every chart honors all 6 filters from Phase 6 via the shared SSR pipeline; a SvelteKit integration test sets every filter, fetches the page, and asserts every chart's rendered rows respect the filter
  6. Every chart verified at 375px viewport before merge (same PR template as v1.0)
**Plans**: TBD

### Phase 11: Bug Fixes
**Goal**: The two outstanding Phase 4 UAT gaps are closed
**Depends on**: Phase 10
**Requirements**: BUG-01, BUG-02
**Success Criteria**:
  1. `NewVsReturningCard` on `range=all` renders non-empty with the correct totals derived from 6,842 transactions; the "No sales recorded" empty state only fires when the filtered result set is actually empty
  2. LTV chart on `range=all` shows the full 10 months of history (not just 3 weeks of bars); the root cause in either `ltv_mv` sparseness or the chart window-truncation is fixed at its source
**Plans**: TBD

### Phase 12: Brainstorm Extras (optional / parkable)
**Goal**: Capture the brainstorm ideas from `.planning/backlog/dashboard-redesign.md` as concrete requirements **only if** there is runway after Phase 11 ships; otherwise defer to v1.2
**Depends on**: Phase 11
**Requirements**: None yet — requirements are captured only when this phase is formally activated
**Success Criteria**: Phase is activated via an explicit `/gsd:add-phase` call; otherwise it stays dormant and does not block milestone close

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete | 2026-04-14 |
| 2. Ingestion | 4/4 | Complete | 2026-04-14 |
| 3. Analytics SQL | 5/5 | Complete | 2026-04-14 |
| 4. Mobile Reader UI | 5/5 | Complete | 2026-04-14 |
| 5. Insights & Forkability | 9/9 | Complete (v1 shipped; 05-06 T2 fork walkthrough deferred out of v1 scope) | 2026-04-15 |
| 6. Filter Foundation | 0/- | Pending | - |
| 7. Column Promotion | 0/- | Pending | - |
| 8. Star Schema | 0/- | Pending | - |
| 9. Chart Rollups | 0/- | Pending | - |
| 10. Chart Components | 0/- | Pending | - |
| 11. Bug Fixes | 0/- | Pending | - |
| 12. Brainstorm Extras | 0/- | Optional / parkable | - |

## Coverage Summary

- **v1 requirements:** 39 (shipped)
- **v1.1 requirements:** 26
- **Mapped:** 65 (100%)
- **Orphaned:** 0
- **Duplicated:** 0

| Category | Count | Phase |
|----------|-------|-------|
| FND-01..08 | 8 | Phase 1 |
| ING-01..05 | 5 | Phase 2 |
| ANL-01..09 | 9 | Phase 3 |
| UI-01..11 | 11 | Phase 4 |
| INS-01..06 | 6 | Phase 5 |
| FLT-01..04, FLT-07 | 5 | Phase 6 |
| DM-01..03, FLT-05 | 4 | Phase 7 |
| DM-04..08, FLT-06 | 6 | Phase 8 |
| CHT-01..04 | 4 | Phase 9 |
| CHT-05..10 | 6 | Phase 10 |
| BUG-01..02 | 2 | Phase 11 |

---
*Roadmap created: 2026-04-13*
*v1.1 Dashboard Redesign milestone added: 2026-04-15*
