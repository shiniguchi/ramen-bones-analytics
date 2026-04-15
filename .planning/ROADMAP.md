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
- [ ] **Phase 5: Insights & Forkability** — Claude Haiku narrative card, one-click fork/deploy hardening

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
  - [ ] 05-06-PLAN.md — [wave 4/6] Ship: gh repo metadata (T1 done) + fork walkthrough (T2 deferred to public-flip) + friend iPhone sign-off (T3 blocked by 05-07/08/09)
  - [ ] 05-07-PLAN.md — [wave 5, gap closure] Cloudflare Pages deploy: wrangler.toml + one-time project create + wrangler pages deploy → capture pages.dev URL (closes Gap 1)
  - [ ] 05-08-PLAN.md — [wave 5, gap closure] Provision friend's Supabase Auth user + memberships row + verify JWT restaurant_id claim + secure credential handoff (closes Gap 2)
  - [ ] 05-09-PLAN.md — [wave 5, gap closure] Seed ≥50 recent synthetic transactions + refresh MVs + re-invoke generate-insight → fallback_used=false with real numbers (closes Gap 3)

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete | 2026-04-14 |
| 2. Ingestion | 4/4 | Complete | 2026-04-14 |
| 3. Analytics SQL | 1/5 | Executing | - |
| 4. Mobile Reader UI | 5/5 | Complete   | 2026-04-14 |
| 5. Insights & Forkability | 5/9 | Executing (gap closure) | - |

## Coverage Summary

- **v1 requirements:** 41
- **Mapped:** 41 (100%)
- **Orphaned:** 0
- **Duplicated:** 0

| Category | Count | Phase |
|----------|-------|-------|
| FND-01..08 | 8 | Phase 1 |
| EXT-01..07 | 7 | Phase 2 |
| ANL-01..09 | 9 | Phase 3 |
| UI-01..11 | 11 | Phase 4 |
| INS-01..06 | 6 | Phase 5 |

---
*Roadmap created: 2026-04-13*
