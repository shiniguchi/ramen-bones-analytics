# Roadmap: Ramen Bones Analytics

**Created:** 2026-04-13
**Granularity:** standard
**Parallelization:** enabled
**Coverage:** 39/39 v1 + 14/14 v1.1 + 13/13 v1.2 requirements mapped

## Core Value

A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see — without needing a data team, a dashboard tool, or a deck.

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) — SHIPPED 2026-04-15</summary>

- [x] **Phase 1: Foundation** — Multi-tenant schema, auth, RLS, wrapper-view template, CI guards
- [x] **Phase 2: Ingestion** — Pre-joined CSV loader → staging → normalized transactions
- [x] **Phase 3: Analytics SQL** — Cohort/LTV/KPI/frequency MVs with wrapper views and survivorship guardrails
- [x] **Phase 4: Mobile Reader UI** — SvelteKit dashboard on Cloudflare Pages at 375px baseline
- [x] **Phase 5: Insights & Forkability** — Claude Haiku narrative card; v1 shipped to friend

</details>

<details>
<summary>v1.1 Dashboard Redesign (Phases 6-7) — Partial (Phases 8-11 superseded by v1.2)</summary>

- [x] **Phase 6: Filter Foundation** — Custom date-range picker, day/week/month toggle, 4 dropdown filters wired through zod-validated SSR params
- [x] **Phase 7: Column Promotion** — Lift `wl_issuing_country` + `card_type` from staging into `transactions` via migration + loader + backfill

</details>

### v1.2 Dashboard Simplification & Visit Attribution

- [ ] **Phase 8: Visit Attribution Data Model** — visit_seq MV, is_cash flag, drop unused views/MVs
- [ ] **Phase 9: Filter Simplification & Performance** — Simplify to cash/card + inhouse/takeaway, client-side granularity toggle, drop 2 revenue cards
- [ ] **Phase 10: Charts** — 7 charts (calendar revenue, calendar counts, retention curve, LTV per customer, order item counts, cohort total revenue, cohort avg LTV)

## Phase Details

<details>
<summary>v1.0 Phase Details (Phases 1-5)</summary>

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
  1. A loader script reads `orderbird_data/5-JOINED_DATA_*/ramen_bones_order_items.csv` and upserts rows into `stg_orderbird_order_items`
  2. Re-running the loader produces zero diffs in `transactions` — natural-key upsert on `(restaurant_id, source_tx_id)` is provably idempotent
  3. A SQL normalization step promotes staged rows to `transactions` with documented, unit-tested handling of voids, refunds, tips, and brutto vs netto
  4. `card_hash = sha256(wl_card_number || restaurant_id)` is computed in the loader before any DB write
  5. The loader is re-runnable: dropping a newer CSV into the folder and re-running brings `transactions` current without data loss or duplicates
**Plans**: 4 plans (complete)

### Phase 3: Analytics SQL
**Goal**: The cohort trunk and its leaves (retention, LTV, KPIs, frequency, new/returning) are queryable through wrapper views with survivorship guards baked into SQL
**Depends on**: Phase 1, Phase 2
**Requirements**: ANL-01, ANL-02, ANL-03, ANL-04, ANL-05, ANL-06, ANL-07, ANL-08, ANL-09
**Success Criteria** (what must be TRUE):
  1. `cohort_mv` assigns each `card_hash` to a first-visit cohort via `MIN(occurred_at) GROUP BY card_hash`
  2. All wrapper views return tenant-scoped rows only, with raw `_mv` locked behind `REVOKE ALL`
  3. LTV and retention outputs clip to the shortest cohort's observable horizon
  4. `pg_cron` refreshes every MV nightly with `REFRESH MATERIALIZED VIEW CONCURRENTLY`
**Plans**: 5 plans (complete)

### Phase 4: Mobile Reader UI
**Goal**: The friend opens the dashboard on their phone and reads revenue, cohorts, LTV, frequency, and new-vs-returning at a 375px viewport
**Depends on**: Phase 1, Phase 3
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11
**Success Criteria** (what must be TRUE):
  1. SvelteKit 2 + Svelte 5 + `adapter-cloudflare` deploys to Cloudflare Pages at 375px with no horizontal scroll
  2. Revenue KPI cards, cohort retention, LTV, repeat visit, and frequency each render as a card with touch tooltips and graceful empty states
  3. Preset date-range chips are the only global filter and every PR is verified at 375px
**Plans**: 5 plans (complete)
**UI hint**: yes

### Phase 5: Insights & Forkability
**Goal**: A nightly plain-English insight card lands on the dashboard, and any restaurant owner can fork the repo and self-host
**Depends on**: Phase 3, Phase 4
**Requirements**: INS-01, INS-02, INS-03, INS-04, INS-05, INS-06
**Success Criteria** (what must be TRUE):
  1. Nightly Edge Function calls Claude Haiku with KPI payload and writes to `insights` table
  2. Digit-guard regex rejects hallucinated numbers, falling back to a deterministic template
  3. Dashboard renders the latest insight card for the logged-in tenant
  4. Public repo is forkable with README + `.env.example`
**Plans**: 9 plans (complete)

</details>

<details>
<summary>v1.1 Phase Details (Phases 6-7)</summary>

### Phase 6: Filter Foundation
**Goal**: A shared filter bar (date range, granularity, sales type, payment method) drives every v1.0 card through a single zod-validated SSR pipeline
**Depends on**: Phase 5
**Requirements**: FLT-01, FLT-02, FLT-03, FLT-04, FLT-07
**Success Criteria**:
  1. A user can pick an arbitrary date range, granularity, and 2 dropdown filters, and every v1.0 card re-renders with correctly scoped numbers at 375px
  2. SSR load function composes WHERE clauses from zod-validated query params only — no dynamic SQL
  3. Payment-method dropdown is populated from `SELECT DISTINCT` — no hardcoded whitelist
  4. All dropdowns surface an "All" sentinel that cleanly degrades to no-op WHERE clause
**Plans**: 5 plans (complete)
**UI hint**: yes

### Phase 7: Column Promotion
**Goal**: `transactions.wl_issuing_country` and `transactions.card_type` are populated for every row so downstream views can use them
**Depends on**: Phase 6
**Requirements**: DM-01, DM-02, DM-03, FLT-05
**Success Criteria**:
  1. Migration adds both columns; existing rows stay intact
  2. Backfill populates both columns for all historical transactions; spot-checked against CSV
  3. Loader writes both columns on future ingests with idempotency preserved
  4. Country dropdown filter wired through existing filter schema
**Plans**: 4 plans (complete)

</details>

### v1.2 Phase Details

### Phase 8: Visit Attribution Data Model
**Goal**: Every transaction carries its card_hash's nth-visit number and a binary cash/card flag; unused views and dead code are removed
**Depends on**: Phase 7
**Requirements**: VA-01, VA-02, VA-03
**Success Criteria** (what must be TRUE):
  1. Each transaction with a non-NULL card_hash has a `visit_seq` integer (1, 2, 3...) computed via `ROW_NUMBER() OVER (PARTITION BY card_hash ORDER BY occurred_at)`, verified by a fixture of 3+ customers with known visit sequences
  2. Each transaction has an `is_cash` boolean derived from `payment_method`, verified by asserting known cash and card transactions map correctly
  3. The visit-attribution MV has a unique index, an RLS wrapper view, and `REVOKE ALL` on the raw MV — following the project's established pattern
  4. `frequency_v`, `new_vs_returning_v`, `ltv_v`, `CountryMultiSelect.svelte`, `_applyCountryFilter`, and the `wl_issuing_country` column on `transactions_filterable_v` are all dropped; CI passes with zero references to the removed artifacts
  5. `refresh_analytics_mvs()` includes the new visit-attribution MV in the correct DAG position; nightly cron verified green for at least 1 run
**Plans:** 2 plans
Plans:
  - [ ] 08-01-PLAN.md — visit_attribution_mv + wrapper view + test helper + refresh function + integration tests
  - [ ] 08-02-PLAN.md — Drop dead SQL views + frontend cleanup (components, queries, country filter)

### Phase 9: Filter Simplification & Performance
**Goal**: The filter bar shows only inhouse/takeaway + cash/card, granularity/range toggles respond in under 200ms (no SSR round-trip), and the dashboard shows 1 revenue card instead of 3
**Depends on**: Phase 8
**Requirements**: VA-11, VA-12, VA-13
**Success Criteria** (what must be TRUE):
  1. The filter bar shows exactly 2 filters: inhouse/takeaway (sales type) and cash/card — the country dropdown, payment-method multi-select, and repeater-bucket dropdown are gone from the UI
  2. Changing granularity (day/week/month) or date range re-renders charts in under 200ms perceived response without a full page navigation or SSR round-trip — the data is fetched once and re-bucketed client-side
  3. The dashboard shows 1 revenue reference card (using active date range and granularity) instead of the previous 3 fixed cards (today/7d/30d); the card respects both filters
  4. All remaining tiles and charts respect both filters — no unscoped reference tiles exist anywhere on the dashboard
**Plans**: TBD
**UI hint**: yes

### Phase 10: Charts
**Goal**: 7 charts render on the dashboard with visit-count attribution breakdowns, all honoring both filters, verified at 375px
**Depends on**: Phase 8, Phase 9
**Requirements**: VA-04, VA-05, VA-06, VA-07, VA-08, VA-09, VA-10
**Success Criteria** (what must be TRUE):
  1. Calendar revenue chart renders stacked bars by visit-count bucket (1st/2nd/3rd/4x/5x/6x/7x/8x+) per day/week/month granularity; the owner can see "how much revenue came from 3rd-timers on Tuesday"
  2. Calendar customer counts chart renders the same visit-count breakdown; the owner can see "how many 2nd-timers came in this week"
  3. Retention curve chart renders weekly and monthly first-time acquisition cohort retention rates with horizon-clip to prevent survivorship bias
  4. LTV per customer chart renders individual or bucketed customer lifetime value distribution
  5. Calendar order item counts chart renders item-name breakdown (from `stg_orderbird_order_items.item_name`) per granularity period — the owner can see which menu items sell most
  6. First-time date cohort total revenue and average LTV charts render per acquisition cohort (weekly/monthly); the owner can compare "did my January cohort spend more than my March cohort?"
  7. All 7 charts render at 375px viewport with touch-friendly tooltips, graceful empty states, and both filters (inhouse/takeaway + cash/card) applied
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 6/6 | Complete | 2026-04-14 |
| 2. Ingestion | v1.0 | 4/4 | Complete | 2026-04-14 |
| 3. Analytics SQL | v1.0 | 5/5 | Complete | 2026-04-14 |
| 4. Mobile Reader UI | v1.0 | 5/5 | Complete | 2026-04-14 |
| 5. Insights & Forkability | v1.0 | 9/9 | Complete | 2026-04-15 |
| 6. Filter Foundation | v1.1 | 5/5 | Complete | 2026-04-15 |
| 7. Column Promotion | v1.1 | 4/4 | Complete | 2026-04-15 |
| 8. Visit Attribution Data Model | v1.2 | 0/2 | Planned | - |
| 9. Filter Simplification & Performance | v1.2 | 0/- | Not started | - |
| 10. Charts | v1.2 | 0/- | Not started | - |

## Coverage Summary

- **v1.0 requirements:** 39 (shipped)
- **v1.1 requirements:** 14 (Phases 6-7 complete; Phases 8-11 superseded by v1.2)
- **v1.2 requirements:** 13
- **Mapped:** 66 (100%)
- **Orphaned:** 0
- **Duplicated:** 0

### v1.2 Coverage Map

| Requirement | Phase |
|-------------|-------|
| VA-01 | Phase 8 — Visit Attribution Data Model |
| VA-02 | Phase 8 — Visit Attribution Data Model |
| VA-03 | Phase 8 — Visit Attribution Data Model |
| VA-04 | Phase 10 — Charts |
| VA-05 | Phase 10 — Charts |
| VA-06 | Phase 10 — Charts |
| VA-07 | Phase 10 — Charts |
| VA-08 | Phase 10 — Charts |
| VA-09 | Phase 10 — Charts |
| VA-10 | Phase 10 — Charts |
| VA-11 | Phase 9 — Filter Simplification & Performance |
| VA-12 | Phase 9 — Filter Simplification & Performance |
| VA-13 | Phase 9 — Filter Simplification & Performance |

### Historical Coverage

| Category | Count | Phase |
|----------|-------|-------|
| FND-01..08 | 8 | Phase 1 |
| ING-01..05 | 5 | Phase 2 |
| ANL-01..09 | 9 | Phase 3 |
| UI-01..11 | 11 | Phase 4 |
| INS-01..06 | 6 | Phase 5 |
| FLT-01..04, FLT-07 | 5 | Phase 6 |
| DM-01..03, FLT-05 | 4 | Phase 7 |

### Superseded (v1.1 Phases 8-11 replaced by v1.2)

The following v1.1 requirements were superseded by v1.2 and are no longer on the roadmap:
- FLT-06, DM-04..08 (Phase 8 Star Schema) — replaced by VA-01 visit_seq approach
- CHT-01..04 (Phase 9 Chart Rollups) — replaced by VA-04..10 chart set
- CHT-05..10 (Phase 10 Chart Components) — replaced by VA-04..10 chart set
- BUG-01..02 (Phase 11 Bug Fixes) — views being dropped make these moot

---
*Roadmap created: 2026-04-13*
*v1.1 Dashboard Redesign milestone added: 2026-04-15*
*v1.2 Dashboard Simplification & Visit Attribution: 2026-04-16 (Phases 8-11 superseded)*
