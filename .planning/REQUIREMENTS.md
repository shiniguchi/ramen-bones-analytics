# Requirements: Ramen Bones Analytics

**Defined:** 2026-04-13
**Core Value:** A restaurant owner opens the site on their phone and makes a real business decision from the numbers they see.

## v1 Requirements

Requirements for initial release. Each maps to exactly one roadmap phase.

### Foundation (Tenancy, Auth, Security)

- [ ] **FND-01**: Supabase Postgres project initialized with `restaurants` and `memberships` tables (multi-tenant schema from day 1, even though v1 has one tenant)
- [ ] **FND-02**: Custom access token hook injects `restaurant_id` claim into Supabase Auth JWT from `memberships` table
- [x] **FND-03**: RLS policies enforced on every tenant-scoped table using `auth.jwt()->>'restaurant_id'`
- [x] **FND-04**: Security-definer wrapper-view pattern documented and applied to the first materialized view (RLS does not natively propagate to MVs)
- [x] **FND-05**: Two-tenant isolation integration test (seed tenant A and tenant B, assert tenant A session can never read tenant B rows) runs in CI on every PR
- [x] **FND-06**: User can log in with email + password via Supabase Auth and the session persists across browser refreshes
- [x] **FND-07**: Card-hash customer identifier is never stored alongside PAN, PII, or raw card data
- [x] **FND-08**: All timestamps stored as `timestamptz`; every analytical query derives `business_date` from a tenant-configured timezone to eliminate day-boundary drift

### Ingestion (Pre-joined CSV → Transactions)

- [x] **ING-01**: Loader script reads `orderbird_data/5-JOINED_DATA_*/ramen_bones_order_items.csv` (pre-joined per-order-item data) and upserts rows into a Supabase `stg_orderbird_order_items` staging table
- [x] **ING-02**: Ingest is idempotent via natural key `(restaurant_id, source_tx_id)` where `source_tx_id = order_id` — re-running produces zero diffs
- [x] **ING-03**: Normalization promotes staged rows to `transactions` with documented handling of voids, refunds, tips (Trinkgeld), brutto vs netto (VAT), and service charge; `business_date` derived at query time via tenant timezone
- [x] **ING-04**: `card_hash = sha256(wl_card_number || restaurant_id)` computed in the loader before any DB write; cash customers (no Worldline card number) are NULL and excluded from cohort analytics
- [x] **ING-05**: Founder has manually reviewed ≥20 real rows from the CSV to confirm field semantics before any MV is written

### Analytics SQL Models

- [x] **ANL-01**: `cohort_mv` materialized view — the load-bearing trunk — computes first-visit cohort assignment per customer (card hash) with configurable cohort grain (daily / weekly / monthly)
- [x] **ANL-02**: `retention_curve_v` (wrapper over cohort MV) exposes retention rate by cohort × periods-since-first-visit, with survivorship-bias guard (horizon-clip cohorts that haven't had enough elapsed time)
- [x] **ANL-03**: `ltv_mv` / `ltv_v` computes LTV-to-date per cohort with a visible data-depth caveat (3–12 months of history only, no 12-month projection)
- [x] **ANL-04**: `kpi_daily_mv` / `kpi_daily_v` aggregates revenue, transaction count, and avg ticket per business_date
- [x] **ANL-05**: `frequency_v` exposes repeat visit rate and visit-frequency distribution
- [x] **ANL-06**: `new_vs_returning_v` splits revenue and tx count between first-time and repeat customers
- [x] **ANL-07**: All MVs refresh nightly via `pg_cron` using `REFRESH MATERIALIZED VIEW CONCURRENTLY` (unique index mandatory on every MV)
- [x] **ANL-08**: SvelteKit frontend reads ONLY from `*_v` wrapper views — raw tables and MVs have `REVOKE ALL` on `authenticated` role
- [x] **ANL-09**: CI check greps for any frontend query referencing `*_mv` or raw tables directly and fails the build

### Mobile Reader UI (SvelteKit on Cloudflare Pages)

- [x] **UI-01**: SvelteKit 2 + Svelte 5 + `adapter-cloudflare` project deploys to Cloudflare Pages with `@supabase/ssr` for auth
- [x] **UI-02**: Mobile-first layout at 375px baseline — single-column card stream, no desktop-only sidebar
- [x] **UI-03**: Login screen using Supabase Auth (email + password), redirects to dashboard on success
- [ ] **UI-04**: Revenue KPI cards (today / this week / this month, avg ticket, tx count) shown at the top of the dashboard
- [ ] **UI-05**: First-visit acquisition cohort chart (daily/weekly/monthly toggle) rendered with LayerChart
- [ ] **UI-06**: Retention curve chart per cohort, mobile-legible (limited series, touch-friendly tooltips)
- [ ] **UI-07**: Customer LTV view with visible data-depth caveat
- [ ] **UI-08**: Repeat visit rate + visit-frequency distribution view
- [ ] **UI-09**: Preset date-range chips (Today / 7d / 30d / 90d / All) — no custom date-range builder on mobile
- [ ] **UI-10**: Empty / sparse-data states handled gracefully (cohorts with too little history show a message, not a broken chart)
- [x] **UI-11**: Every PR verified at 375px viewport before merge

### Insights & Forkability

- [ ] **INS-01**: Nightly Supabase Edge Function calls Claude Haiku via Anthropic API with tenant KPI payload and writes a natural-language summary to an `insights` table
- [ ] **INS-02**: Prompt and post-generation validation forbid the LLM from emitting numbers not in the input payload (digit-guard regex + deterministic template fallback on validation failure)
- [ ] **INS-03**: Dashboard renders the latest insight card for the logged-in tenant; gracefully hides if no insight exists
- [ ] **INS-04**: Anthropic API key stored as a Supabase secret; never exposed to client or committed
- [ ] **INS-05**: Repository is public and forkable with a README describing one-click deploy (Cloudflare Pages + Supabase project + GHA secrets)
- [ ] **INS-06**: `.env.example` documents every required environment variable for self-hosters

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-Tenant Onboarding
- **ONB-01**: Self-service signup flow for new restaurant owners
- **ONB-02**: Admin UI to provision a new tenant (restaurant + membership + scraper credentials)
- **ONB-03**: Orderbird credential onboarding wizard

### Scale & Integrations
- **INT-01**: Orderbird ISV Partner API integration (replaces Playwright scraper)
- **INT-02**: Additional POS integrations (Square, Toast, Lightspeed)
- **INT-03**: Hourly refresh via webhook (when ISV API supports it)

### Advanced Analytics
- **ADV-01**: Time-of-day / day-of-week heatmap
- **ADV-02**: At-risk customer list (cohort regulars gone quiet)
- **ADV-03**: Segment chips (high-value vs casual vs one-time)
- **ADV-04**: Menu-item level cohort analysis

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time / streaming data | Daily refresh covers 99% of decisions; webhooks add complexity and no ISV API yet |
| Onboarding / signup flow for v1 | Single tenant, manual provisioning is sufficient |
| Paid tier / billing | Free + forkable is the business model |
| Slide / PDF report generation | Phone dashboard is the delivery vehicle |
| Embedded notebooks in user-facing UI | Notebooks are the dev environment, not the product |
| Non-Orderbird POS integrations | Scope creep risk; v2 at earliest |
| Desktop-first layout | Phone is the primary viewing surface |
| Looker / Metabase / external BI embedding | Product requirement is a custom mobile UI |
| CSV export of cohort data | Owner isn't going to re-analyze in Excel |
| Customizable dashboard / widget builder | Non-technical user, confusion risk, anti-feature |
| AI chat / "ask your data" | Hallucination risk, anti-feature per research |
| Email digests / push notifications | v1 is pull-based; add only if validated |
| Forecasting / predictions | Not enough historical data yet; trust-destroyer if wrong |
| Cohort triangle / heatmap viz | Unreadable on phone; deferred to v2 |
| Custom date-range picker on mobile | Preset chips only |
| Fully configurable filter builder | Non-technical user; preset segments only |
| 12-month LTV projection | Not enough history; LTV-to-date only, with caveat |

## Traceability

Each v1 requirement maps to exactly one roadmap phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 — Foundation | Pending |
| FND-02 | Phase 1 — Foundation | Pending |
| FND-03 | Phase 1 — Foundation | Complete |
| FND-04 | Phase 1 — Foundation | Complete |
| FND-05 | Phase 1 — Foundation | Complete |
| FND-06 | Phase 1 — Foundation | Complete |
| FND-07 | Phase 1 — Foundation | Complete |
| FND-08 | Phase 1 — Foundation | Complete |
| ING-01 | Phase 2 — Ingestion | Complete |
| ING-02 | Phase 2 — Ingestion | Complete |
| ING-03 | Phase 2 — Ingestion | Complete |
| ING-04 | Phase 2 — Ingestion | Complete |
| ING-05 | Phase 2 — Ingestion | Complete |
| ANL-01 | Phase 3 — Analytics SQL | Complete |
| ANL-02 | Phase 3 — Analytics SQL | Complete |
| ANL-03 | Phase 3 — Analytics SQL | Complete |
| ANL-04 | Phase 3 — Analytics SQL | Complete |
| ANL-05 | Phase 3 — Analytics SQL | Complete |
| ANL-06 | Phase 3 — Analytics SQL | Complete |
| ANL-07 | Phase 3 — Analytics SQL | Complete |
| ANL-08 | Phase 3 — Analytics SQL | Complete |
| ANL-09 | Phase 3 — Analytics SQL | Complete |
| UI-01 | Phase 4 — Mobile Reader UI | Complete |
| UI-02 | Phase 4 — Mobile Reader UI | Complete |
| UI-03 | Phase 4 — Mobile Reader UI | Complete |
| UI-04 | Phase 4 — Mobile Reader UI | Pending |
| UI-05 | Phase 4 — Mobile Reader UI | Pending |
| UI-06 | Phase 4 — Mobile Reader UI | Pending |
| UI-07 | Phase 4 — Mobile Reader UI | Pending |
| UI-08 | Phase 4 — Mobile Reader UI | Pending |
| UI-09 | Phase 4 — Mobile Reader UI | Pending |
| UI-10 | Phase 4 — Mobile Reader UI | Pending |
| UI-11 | Phase 4 — Mobile Reader UI | Complete |
| INS-01 | Phase 5 — Insights & Forkability | Pending |
| INS-02 | Phase 5 — Insights & Forkability | Pending |
| INS-03 | Phase 5 — Insights & Forkability | Pending |
| INS-04 | Phase 5 — Insights & Forkability | Pending |
| INS-05 | Phase 5 — Insights & Forkability | Pending |
| INS-06 | Phase 5 — Insights & Forkability | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-13 — traceability filled by gsd-roadmapper*
