# Phase 3: Analytics SQL - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the analytical SQL layer that turns `transactions` + `stg_orderbird_order_items` into banking-grade growth metrics, readable only through tenant-scoped wrapper views. Scope:

1. Replace the `kpi_daily_mv` placeholder body with real daily aggregation (revenue, tx count, avg ticket) against `transactions`.
2. Build `cohort_mv` — the load-bearing trunk — with daily / weekly / monthly first-visit cohort assignment per `card_hash`.
3. Build plain (non-materialized) wrapper views over `cohort_mv`: `retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`.
4. `pg_cron` nightly refresh orchestrating `cohort_mv` + `kpi_daily_mv` via a single sequential function.
5. Extend the CI grep guard from Phase 1 (D-14 guard 1) to block frontend references to the new MV names and to any raw table (`transactions`, `stg_orderbird_order_items`).

**Explicitly out of scope:**
- Dashboard UI / charts / filters (Phase 4).
- Claude insight generation / nightly narrative (Phase 5).
- Additional MVs beyond `cohort_mv` + `kpi_daily_mv` (leaves stay as plain views; revisit in Phase 5 only if perf walls appear).
- Alerting / email / webhook on refresh failure (Phase 5 — v1 relies on `cron.job_run_details`).
- Scheduled ingest or webhook-triggered refresh (Phase 5).
- Historical projection / 12-month LTV extrapolation (out of scope per PROJECT.md — we only have 3–12 months of history).
- Backfilling the Worldline blackout gap in April 2026 (accepted as a data-quality exclusion).

</domain>

<decisions>
## Implementation Decisions

### Cohort Trunk (`cohort_mv`)
- **D-01:** `cohort_mv` assigns each `card_hash` to a first-visit cohort via pure `MIN(occurred_at) GROUP BY restaurant_id, card_hash`. Nightly full rebuild via `REFRESH MATERIALIZED VIEW CONCURRENTLY` — if late data arrives, a customer's cohort can shift backward. That's correct behavior, not a bug. No freeze-on-first-observation state table.
- **D-02:** `cohort_mv` stores all three cohort grains (daily, weekly, monthly) in one wide shape — not three separate MVs. Suggested columns (gsd-planner finalizes):
  - `restaurant_id uuid`
  - `card_hash text` (the customer key; never cash — see D-03)
  - `first_visit_at timestamptz` (the exact `MIN(occurred_at)`)
  - `first_visit_business_date date` (derived via `AT TIME ZONE restaurants.timezone` per Phase 1 D-09)
  - `cohort_day date`, `cohort_week date`, `cohort_month date` (truncated to period start in tenant timezone)
  - `cohort_size_day int`, `cohort_size_week int`, `cohort_size_month int` (pre-computed per grain to avoid window-function cost in every leaf view)
  Unique index: `(restaurant_id, card_hash)` — mandatory for `REFRESH CONCURRENTLY`.
- **D-03:** `cohort_mv` excludes rows where `card_hash IS NULL` (cash transactions — Phase 2 D-08). Cash customers are anonymous and cannot be tracked across visits. `kpi_daily_v` still includes their revenue; only identity-dependent leaves drop them.
- **D-04:** The UI default cohort grain is **weekly**. Banking standard for 3–12 months of history, ~40 cohorts over 10 months, good signal/noise. Daily is too noisy for a single restaurant; monthly has only ~10 cohorts. The MV stores all three grains so Phase 4 can expose a grain selector without a query rewrite.
- **D-05:** **No minimum-cohort-size filter in SQL.** `cohort_mv` / wrapper views expose `cohort_size` and return every cohort regardless of size. Filtering noisy single-customer cohorts is a Phase 4 UI concern, not a data-layer concern. Keeps SQL honest.

### April 2026 Worldline Blackout
- **D-06:** April 2026 transactions are excluded from **identity metrics only**: `cohort_mv`, `retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`. They are **NOT excluded from `kpi_daily_v`** — cash + non-Worldline card revenue in April is unaffected by the Worldline blackout and should still appear in the revenue trend. Implementation: `cohort_mv` adds `WHERE business_date < '2026-04-01' OR business_date >= '2026-05-01'` (or equivalent range predicate) at the transactions-source CTE. **gsd-planner** must confirm the exact April blackout boundaries against Phase 2's 02-04 SUMMARY before hardcoding the range, and should parameterize it via a SQL constant or a small `data_quality_exclusions` table so future blackouts don't require a code change.
- **D-07:** The exclusion is implemented ONCE in the `cohort_mv` source CTE and inherited by every leaf view (all leaves read from `cohort_mv`, not from `transactions` directly — see D-13). This guarantees no leaf can accidentally include April customers.

### Survivorship Guard (retention + LTV)
- **D-08:** Survivorship bias is guarded via **NULL-masking past per-cohort horizon**. `retention_curve_v` and `ltv_v` both return a row for every `(cohort, period)` pair in the conceptual matrix, but the metric column is `NULL` when the period is past the cohort's observable horizon. LayerChart draws natural gaps in Phase 4; no view logic needed in the UI to hide rows. Example:
  ```
  cohort_start | period | cohort_age_weeks | retention_rate
  2025-08-04   | 8      | 36               | 0.28    ← observable
  2026-03-30   | 8      | 2                | NULL    ← past horizon
  ```
- **D-09:** Horizon rule: **per-cohort, computed as `now() - cohort_start`**. Each cohort is observable up to its own age — old cohorts keep their long tail, young cohorts are clipped only where data genuinely doesn't exist. Not a global shortest-cohort clip (which would erase detail from mature cohorts).
- **D-10:** Both `retention_curve_v` and `ltv_v` expose `cohort_age_weeks` (or the equivalent for the selected grain) as a column so Phase 4 can render a "max observable period" boundary line if it wants to visually mark the horizon.
- **D-11:** LTV flavor: **`ltv_v.ltv_cents` = average LTV per acquired customer** = `SUM(revenue_cents) / cohort_size` up to period p. Banking standard, comparable across cohorts of different sizes. Cumulative total revenue is NOT exposed — if Phase 4 needs it, add later.

### Metric Definitions
- **D-12:** `frequency_v` returns **fixed visit-count buckets**: `1`, `2`, `3–5`, `6–10`, `11+`. One row per bucket with `customer_count` and `revenue_cents`. Restaurant owners recognize these ranges; no decile decision to tune. Raw per-customer visit counts are NOT exposed as a separate view — deferred until Phase 4 proves a need.
- **D-13:** `new_vs_returning_v` uses the **first-ever-visit split**: for each `business_date`, "new" = customers whose first-ever visit is that date; "returning" = customers who visited before that date. No 60-day active window. Simple, banking default, no tunable.
- **D-14:** `new_vs_returning_v` has a **third bucket `cash_anonymous`** alongside `new` and `returning`. Cash transactions have no `card_hash` and cannot be identity-split. The third bucket preserves revenue tie-out: `new.revenue + returning.revenue + cash_anonymous.revenue = kpi_daily_v.revenue` for the same business_date. Honest about the attribution gap.
- **D-15:** `kpi_daily_mv` columns (replacing the Phase 1 placeholder body):
  - `restaurant_id uuid`
  - `business_date date`
  - `revenue_cents numeric` (sum of `invoice_total_eur * 100`, cast to numeric cents per Phase 2 currency decision)
  - `tx_count int` (count of `transactions` rows, invoice-grain)
  - `avg_ticket_cents numeric` (`revenue_cents / tx_count`, NULL if `tx_count = 0`)
  Unique index: `(restaurant_id, business_date)` (already declared in migration 0004 — re-usable).
  `business_date` is derived via `AT TIME ZONE restaurants.timezone` per Phase 1 D-09 — never hardcoded.

### View Shape & Wrapper Pattern
- **D-16:** Only **two MVs**: `cohort_mv` (new) and `kpi_daily_mv` (replace placeholder body). Every leaf (`retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`) is a **plain view** reading from `cohort_mv` + `transactions`. Rationale: at the current scale (20k invoice rows, ~8 months history, single tenant), plain views over an MV are fast enough. Fewer MVs = fewer refresh jobs, fewer unique indexes, less orchestration. Revisit only if Phase 4 hits perf walls.
- **D-17:** Every MV follows the canonical template from `supabase/migrations/0004_kpi_daily_mv_template.sql` exactly: MV + mandatory unique index + `REVOKE ALL ... FROM anon, authenticated` + wrapper view with `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`. No security-definer functions. No override of the default invoker mode on wrapper views (silent-leak failure mode per 01-RESEARCH.md Pitfall A).
- **D-18:** Every **plain leaf view** also enforces the tenant filter: `WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id')`. Because plain views over `cohort_mv` inherit cohort_mv's row set (and cohort_mv is already locked via REVOKE), the filter in the leaf is defense-in-depth and lets downstream analytics still function if someone regrants SELECT on a raw MV by accident.
- **D-19:** All leaves `GRANT SELECT ... TO authenticated`. Raw `cohort_mv` and `kpi_daily_mv` stay `REVOKE ALL FROM anon, authenticated`.

### pg_cron Orchestration
- **D-20:** **One `pg_cron` job, one SECURITY DEFINER function, sequential refresh.** Job: `cron.schedule('refresh-analytics-mvs', '0 3 * * *', 'SELECT public.refresh_analytics_mvs();')`. Function body refreshes in this order:
  1. `REFRESH MATERIALIZED VIEW CONCURRENTLY public.cohort_mv;`
  2. `REFRESH MATERIALIZED VIEW CONCURRENTLY public.kpi_daily_mv;`
  (Ordering is not strictly required since kpi_daily_mv doesn't read cohort_mv, but sequential keeps the function simple and leaves room for future MVs that might depend on cohort_mv.)
- **D-21:** Schedule: **`'0 3 * * *'` = 03:00 UTC = 05:00 Europe/Berlin**. Rationale: after any reasonable late-night service closes, before morning. Leaves room for the founder's manual pre-joiner + `npm run ingest` run to land before refresh. The schedule is stored in the migration file so forkers get it on `supabase db push`.
- **D-22:** Refresh failures are tracked via **pg_cron's built-in `cron.job_run_details`** — no custom `mv_refresh_log` table in v1. Founder queries `cron.job_run_details` if numbers look stale. Phase 5 can add an alerting layer (email / webhook / dashboard banner).
- **D-23:** The `refresh_analytics_mvs()` function is `SECURITY DEFINER`, owned by `postgres`, and granted only to `postgres` / `service_role`. `REVOKE ALL ... FROM anon, authenticated` on the function. This is consistent with the Phase 1 wrapper-view philosophy: tenant roles never touch raw refresh machinery.

### CI Guard Extension
- **D-24:** The existing Phase 1 D-14 guard 1 (`grep -r '*_mv' src/`) is **extended** to cover:
  - The new MV names: `cohort_mv`, and any future MVs.
  - Raw table references: `transactions`, `stg_orderbird_order_items` from `src/`. Phase 4 frontend must go through wrapper views only.
  Implementation: extend `scripts/ci-guards.sh` to fail on any frontend reference matching `(cohort_mv|kpi_daily_mv|\\btransactions\\b|stg_orderbird_order_items)` inside `src/`. Migrations, tests, and scripts are exempted.
- **D-25:** The guard is asserted by a Phase 3 unit test or a direct `scripts/ci-guards.sh` invocation in the Phase 3 CI run, not deferred — ANL-09 must be provably satisfied before phase complete.

### Testing
- **D-26:** Phase 3 tests (follow Phase 2 Vitest integration pattern against TEST Supabase project):
  1. **Fixture correctness** — seed 3 known customers with known visit patterns (per roadmap Phase 3 success criterion 1), assert `cohort_mv` assigns each to the right cohort at all three grains.
  2. **RLS / wrapper-view tenancy** — sign in as tenant A, assert every `*_v` returns only A's rows and raw `*_mv` returns 0 rows (authenticated) and revoked-error (anon).
  3. **Tie-out** — `kpi_daily_v.revenue_cents` for a given day equals `new_vs_returning_v.(new + returning + cash_anonymous).revenue_cents` for the same day. Guards D-14.
  4. **Survivorship NULL-mask** — for the youngest cohort, assert `retention_rate IS NULL` past its observable horizon. For the oldest cohort, assert all periods up to `now() - cohort_start` are non-NULL.
  5. **April exclusion** — assert cohort_mv has zero `card_hash` rows whose `first_visit_business_date` is in April 2026, AND assert `kpi_daily_v` has non-zero rows for April 2026 business_dates (confirms the exclusion only hit identity metrics).
  6. **Cash exclusion** — assert no cash (`card_hash IS NULL`) rows in cohort_mv, but positive revenue in kpi_daily_v for days with known cash transactions.
  7. **Refresh concurrent** — `SELECT public.refresh_analytics_mvs();` succeeds against a seeded TEST project with concurrent SELECTs on the wrapper views (proves `CONCURRENTLY` + unique index combo works).
  8. **CI guard** — `scripts/ci-guards.sh` fails when a test file writes a fake `src/lib/evil.ts` referencing `cohort_mv` or `transactions`, then passes after removal.
- **D-27:** The Phase 1 `tests/integration/tenant-isolation.test.ts` test is **extended** to cover the new wrapper views (`cohort_mv` wrapper, retention, LTV, frequency, new_vs_returning). Skipped items from Phase 1 UAT (tests 3/4/5 — blocked on second TEST project) remain deferred; Phase 3 does not unblock them.

### Claude's Discretion
- Exact wrapper view names when collisions are possible (e.g., `cohort_v` exists vs inlining cohort access into leaves). gsd-planner picks.
- Whether `cohort_mv` uses a single wide row (with day/week/month columns) or three pivoted views. The wide-row shape is suggested in D-02 as a starting point; gsd-planner may restructure if benchmarks show it's slower.
- Whether the April exclusion is hardcoded, a SQL constant, or a `data_quality_exclusions` table — D-06 suggests parameterizing but leaves the exact mechanism to gsd-planner.
- Migration file naming / splitting: likely `0010_cohort_mv.sql`, `0011_kpi_daily_mv_real.sql` (replaces placeholder), `0012_leaf_views.sql`, `0013_refresh_function_and_cron.sql` — gsd-planner finalizes.
- Exact `cohort_size` denominators (`cohort_size_week` etc.) and how they're pre-computed in cohort_mv vs derived in leaves.
- Leaf view column naming conventions (`period_number` vs `periods_since_first_visit` vs `week_offset`).
- Whether `REFRESH MATERIALIZED VIEW CONCURRENTLY` is called inside a transaction block in `refresh_analytics_mvs()` or as separate statements (docs generally recommend separate).
- Exact test fixture customer profiles for D-26 test 1 — three customers with cleanly-known retention patterns, gsd-planner designs.

### Folded Todos
None — no pending todos matched this phase via `todo match-phase 3`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Prior Art (schema, wrapper pattern, CI guards)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-04 (JWT `restaurant_id` claim), D-06/07/08 (wrapper-view template + REVOKE + unique-index mandatory), D-08a (`kpi_daily_mv` canonical template), D-09 (per-tenant timezone for business_date), D-14 guard 1 (`*_mv` frontend grep guard).
- `.planning/phases/01-foundation/01-RESEARCH.md` — Pattern 3 / Pitfall A (wrapper view invoker mode silent-leak failure).
- `supabase/migrations/0001_tenancy_schema.sql` — `restaurants`, `memberships`, RLS.
- `supabase/migrations/0002_auth_hook.sql` — JWT `restaurant_id` claim injection.
- `supabase/migrations/0003_transactions_skeleton.sql` — transactions table PK + RLS `tx_tenant_read`.
- `supabase/migrations/0004_kpi_daily_mv_template.sql` — **the canonical template every Phase 3 MV copies**. Phase 3 replaces the MV body but must preserve the unique-index + REVOKE + wrapper-view pattern exactly.
- `supabase/migrations/0005_seed_tenant.sql` — v1 tenant row (`Europe/Berlin` timezone).
- `supabase/migrations/0006_test_helpers.sql` — test helper functions used by the Vitest integration suite.
- `scripts/ci-guards.sh` — Phase 3 extends guard 1 (D-24).

### Phase 2 Prior Art (loader output contract)
- `.planning/phases/02-ingestion/02-CONTEXT.md` — D-03 (staging shape), D-04 (`transactions` invoice-grain + columns), D-05 (invoice-level dedup already done — Phase 3 never sums `tip_eur` or `invoice_total_eur` from staging), D-07/08 (card_hash + cash=NULL = excluded from identity metrics), D-12 (NEVER `SUM(tip_eur)` from staging — always `transactions`).
- `.planning/phases/02-ingestion/02-04-SUMMARY.md` — April 2026 Worldline blackout caveat (D-06 of this phase acts on it).
- `supabase/migrations/0007_stg_orderbird_order_items.sql` — staging shape (Phase 3 does NOT read from staging for any metric — only reference).
- `supabase/migrations/0008_transactions_columns.sql` — extended `transactions` columns (invoice_total_eur, tip_eur, payment_method, sales_type). **This is the sole source Phase 3 reads for money / cohort identity.**

### Project Docs
- `CLAUDE.md` — tech stack, "What NOT to Use" list, critical gotchas (RLS + MV, REFRESH CONCURRENTLY, forbidden packages).
- `.planning/PROJECT.md` — vision, constraints, data-depth note (3–12 months → no 12-month LTV projection).
- `.planning/REQUIREMENTS.md` §ANL-01..ANL-09 — the nine requirements this phase satisfies.
- `.planning/ROADMAP.md` §"Phase 3: Analytics SQL" — goal + four success criteria.

### External Docs (researcher to fetch fresh during research step)
- Supabase pg_cron docs — https://supabase.com/docs/guides/database/extensions/pg_cron
- Supabase pg_cron RLS-on-MV footgun discussion #17790 — https://github.com/orgs/supabase/discussions/17790
- Postgres `REFRESH MATERIALIZED VIEW CONCURRENTLY` docs — https://www.postgresql.org/docs/15/sql-refreshmaterializedview.html
- pg_cron GitHub (job_run_details schema) — https://github.com/citusdata/pg_cron
- PostgREST wrapper-view pattern — https://postgrest.org/en/stable/references/api/views.html

No ADRs or internal specs yet — this phase and Phase 1 together establish the canonical analytics-view pattern the rest of the project copies.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`supabase/migrations/0004_kpi_daily_mv_template.sql`** — copy-paste template for every new MV. The unique-index + REVOKE + wrapper-view shape is load-bearing; do not deviate.
- **`tests/integration/tenant-isolation.test.ts`** (Phase 1) — extend with the new wrapper views instead of writing a parallel test file.
- **`tests/helpers/supabase.ts`** — `adminClient()` factory for TEST project. Phase 3 integration tests use this pattern.
- **`tests/setup.ts`** — DEV-safety assert. Phase 3 tests MUST run against TEST, not DEV (mutating MVs in DEV would wipe real ingested data).
- **`scripts/ci-guards.sh`** — existing guard infrastructure; Phase 3 extends guard 1's regex (D-24) rather than adding a new guard.
- **Migration numbering** — continues at `0010_` and onward.
- **`supabase/migrations/0008_transactions_columns.sql`** — the invoice-grain source of truth. All Phase 3 cohort/revenue SQL starts from `transactions`, never from staging.

### Established Patterns
- **Migration per discrete change** — one SQL file per concern. Phase 3 likely: `0010_cohort_mv.sql`, `0011_kpi_daily_mv_real.sql`, `0012_leaf_views.sql`, `0013_refresh_function_and_cron.sql`.
- **Wrapper view over MV + `REVOKE ALL` + unique index + JWT-claim WHERE** — the canonical Phase 1 pattern. Zero deviation allowed (silent-leak failure mode).
- **Per-tenant timezone for business_date** — `AT TIME ZONE restaurants.timezone` server-side only. Phase 1 D-09 is non-negotiable.
- **SECURITY DEFINER functions owned by postgres, granted only to service_role** — Phase 1 precedent for the JWT hook; Phase 3 `refresh_analytics_mvs()` follows it.
- **Vitest integration tests against TEST project with RPC helpers** — Phase 1/2 precedent; Phase 3 follows.
- **Idempotent migrations via `create ... if not exists`** — but MVs use `create materialized view` which is not idempotent — Phase 3 uses new migration files rather than patching 0004.

### Integration Points
- **`transactions` table (Phase 2 D-04)** — the sole input to `cohort_mv` and `kpi_daily_mv` for money/identity. Staging (`stg_orderbird_order_items`) is NOT read by any Phase 3 view.
- **`restaurants.timezone` (Phase 1 D-09)** — joined into every business_date derivation.
- **JWT `restaurant_id` claim (Phase 1 D-04)** — every wrapper view filters on `auth.jwt()->>'restaurant_id'`. Phase 3 adds no new claim.
- **`pii-columns.txt`** — Phase 3 adds NO new entries. This manifest is a Phase 2 concern; Phase 3 touches neither PII columns nor staging.
- **`scripts/ci-guards.sh`** — regex extension only, no new guard.
- **`.github/workflows/tests.yml`** — existing TEST-project integration test run picks up Phase 3 migrations automatically.
- **`package.json`** — no new npm scripts (Phase 3 is SQL-only; `npm run test` already covers integration tests).

</code_context>

<specifics>
## Specific Ideas

- The founder comes from bank growth analytics — "LTV per acquired customer" (D-11), "weekly cohort default" (D-04), and "new vs returning with first-ever-visit split" (D-13) are the banking-standard definitions. Phase 4 UI can add fancier definitions later if the friend asks for them, but v1 ships the ones the founder already validates against mentally.
- The NULL-mask survivorship pattern (D-08) is specifically chosen because LayerChart (Svelte 5 native, per CLAUDE.md) draws natural gaps on NULL values — no Phase 4 filtering logic required. This is a deliberate handoff from SQL to chart primitive.
- The `cash_anonymous` third bucket in `new_vs_returning_v` (D-14) is non-obvious but load-bearing: it guarantees revenue tie-out with `kpi_daily_v`. Without it, the reader would see "new + returning < daily revenue" and not know why. Test D-26 #3 asserts this tie-out.
- Cohort MV stores all three grains in one row (D-02) rather than three separate MVs — one refresh, one unique index, one RLS-scoped wrapper. Future grains (e.g., fiscal-quarter) add a column, not a new MV.
- April 2026 exclusion (D-06) is parameterized rather than hardcoded because the Worldline blackout may shift boundaries as the founder investigates — the exact date range might be 2026-04-03 → 2026-04-27 rather than the full month. gsd-planner confirms against 02-04-SUMMARY.

</specifics>

<deferred>
## Deferred Ideas

- **Materializing LTV / retention / frequency / new-vs-returning leaves** → Phase 5 or Phase 4 if benchmarks show plain views over `cohort_mv` are too slow on phone.
- **Raw per-customer visit count view** (`frequency_customer_v`) → deferred unless Phase 4 wants a histogram instead of fixed buckets.
- **Active-60-day returning definition** → deferred; first-ever-visit split is v1.
- **Cumulative cohort revenue total column in `ltv_v`** → deferred; only avg-per-customer in v1.
- **`mv_refresh_log` custom table with email/webhook alerting** → Phase 5. v1 uses `cron.job_run_details` only.
- **Dashboard UI to surface refresh status** → Phase 4 if the friend asks.
- **Data quality exclusions as a managed table** (`data_quality_exclusions`) → gsd-planner may choose this in Phase 3, or may hardcode for v1 and defer the table to Phase 5.
- **Cohort grain beyond day/week/month** (fiscal quarter, season, 4-week marketing period) → deferred; add column to cohort_mv when requested.
- **Horizon marker "boundary line" in charts** → Phase 4 UI decision; Phase 3 exposes `cohort_age_weeks` so Phase 4 can draw it if it wants.
- **Unblocking Phase 1 UAT tests 3/4/5** (which require a separate TEST Supabase project) → still deferred. Phase 3 does not change this.

### Reviewed Todos (not folded)
None — no pending todos surfaced by `todo match-phase 3`.

</deferred>

---

*Phase: 03-analytics-sql*
*Context gathered: 2026-04-14*
