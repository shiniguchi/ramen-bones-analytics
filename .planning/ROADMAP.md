# Roadmap: Ramen Bones Analytics

**Created:** 2026-04-13
**Granularity:** standard
**Parallelization:** enabled
**Coverage:** 41/41 v1 requirements mapped

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Phases

- [ ] **Phase 1: Foundation** — Multi-tenant schema, auth, RLS, wrapper-view template, CI guards
- [ ] **Phase 2: Extraction** — Playwright Orderbird scraper → staging → normalized transactions
- [ ] **Phase 3: Analytics SQL** — Cohort/LTV/KPI/frequency MVs with wrapper views and survivorship guardrails
- [ ] **Phase 4: Mobile Reader UI** — SvelteKit dashboard on Cloudflare Pages at 375px baseline
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
  - [ ] 01-04-PLAN.md — SvelteKit hooks/login reference files under docs/reference
  - [ ] 01-05-PLAN.md — CI grep guards script + 3 GHA workflows (guards/tests/migrations)
  - [ ] 01-06-PLAN.md — Vitest integration suite (7 tests) + README forker quickstart
**UI hint**: yes

### Phase 2: Extraction
**Goal**: Daily Orderbird transactions flow into normalized `transactions` idempotently, with documented semantics confirmed against real rows
**Depends on**: Phase 1
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06, EXT-07
**Success Criteria** (what must be TRUE):
  1. A scheduled GitHub Actions cron runs the Playwright scraper daily, logs into `my.orderbird.com` via persisted `storageState`, and upserts yesterday's rows plus a 2-day overlap window into `stg_orderbird_tx`
  2. Re-running the scraper for the same day produces zero diffs in `transactions` — natural-key upsert on `(restaurant_id, source_tx_id)` is provably idempotent
  3. The `normalize-transactions` pg_cron job promotes staged rows to `transactions` with documented, unit-tested handling of voids, refunds, tips, and brutto/netto — founder has reviewed ≥20 real CSV rows with the friend first
  4. A scraper failure (login break, schema drift, captcha) produces a visible alert within 24h via GitHub Actions failure notification and a row in `ingest_errors`
  5. `card_hash = sha256(pan_token || restaurant_id)` is computed in the scraper before any write, so raw card data never reaches Supabase
**Plans**: TBD

### Phase 3: Analytics SQL
**Goal**: The cohort trunk and its leaves (retention, LTV, KPIs, frequency, new/returning) are queryable through wrapper views with survivorship guards baked into SQL, not UI
**Depends on**: Phase 1, Phase 2
**Requirements**: ANL-01, ANL-02, ANL-03, ANL-04, ANL-05, ANL-06, ANL-07, ANL-08, ANL-09
**Success Criteria** (what must be TRUE):
  1. `cohort_mv` assigns each `card_hash` to a first-visit cohort (daily/weekly/monthly grain) via `MIN(occurred_at) GROUP BY card_hash`, verified by a fixture of 3 customers with known retention buckets
  2. `retention_curve_v`, `ltv_v`, `kpi_daily_v`, `frequency_v`, and `new_vs_returning_v` return tenant-scoped rows through wrapper views only, with raw `_mv` locked behind `REVOKE ALL`
  3. LTV and retention outputs clip to the shortest cohort's observable horizon and expose `cohort_age_weeks`, so recent cohorts cannot display survivorship-biased numbers
  4. `pg_cron` refreshes every MV nightly with `REFRESH MATERIALIZED VIEW CONCURRENTLY` against a mandatory unique index, and a CI grep fails the build on any frontend query referencing `*_mv` or raw `transactions`
**Plans**: TBD

### Phase 4: Mobile Reader UI
**Goal**: The friend opens the dashboard on their phone and reads revenue, cohorts, LTV, frequency, and new-vs-returning at a 375px viewport with preset date chips
**Depends on**: Phase 1, Phase 3
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11
**Success Criteria** (what must be TRUE):
  1. The SvelteKit 2 + Svelte 5 + `adapter-cloudflare` app deploys to Cloudflare Pages, authenticates via `@supabase/ssr`, and renders a mobile-first single-column layout at 375px with no horizontal scroll
  2. After login, the friend sees revenue KPI cards (today / 7d / 30d, avg ticket, tx count) at the top of the dashboard with a trustworthy "Last updated Xh ago" derived from `MAX(ingested_at)`
  3. Cohort retention curve, LTV-to-date (with data-depth caveat copy), repeat visit rate, and visit-frequency distribution each render as a single-purpose card with ≤4 series, touch tooltips, and graceful empty states
  4. Preset date-range chips (Today / 7d / 30d / 90d / All) are the only global filter and every PR is verified at the 375px viewport before merge
**Plans**: TBD
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
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/0 | Not started | - |
| 2. Extraction | 0/0 | Not started | - |
| 3. Analytics SQL | 0/0 | Not started | - |
| 4. Mobile Reader UI | 0/0 | Not started | - |
| 5. Insights & Forkability | 0/0 | Not started | - |

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
