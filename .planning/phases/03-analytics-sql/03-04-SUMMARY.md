---
phase: 03-analytics-sql
plan: 04
subsystem: analytics-sql
tags: [leaf-views, retention, ltv, frequency, new-vs-returning, jwt-filter]
requires:
  - 0010_cohort_mv.sql (cohort trunk + cohort_size_week)
  - 0011_kpi_daily_mv_real.sql (kpi_daily_v for tie-out test)
provides:
  - public.retention_curve_v
  - public.ltv_v
  - public.frequency_v
  - public.new_vs_returning_v
  - public.test_retention_curve / test_ltv / test_frequency / test_new_vs_returning (service-role test helpers)
affects:
  - tests/integration/phase3-analytics.test.ts
tech-stack:
  added: []
  patterns:
    - generate_series + LEFT JOIN matrix
    - per-cohort horizon NULL-mask
    - JWT defense-in-depth on plain leaves
    - SECURITY DEFINER + set_config(request.jwt.claims) test helper
key-files:
  created:
    - supabase/migrations/0012_leaf_views.sql
  modified:
    - tests/integration/phase3-analytics.test.ts
decisions:
  - "All 4 leaves are plain views over cohort_mv + transactions (D-16); no new MVs"
  - "Per-cohort horizon NULL-mask via generate_series(0,260) — 5yr headroom (Pitfall 5)"
  - "new_vs_returning_v ships 4 buckets: new / returning / cash_anonymous / blackout_unknown — preserves revenue tie-out with kpi_daily_v"
  - "blackout_unknown branch routes April 2026 carded rows AND any carded row with no cohort_mv match (cohort_mv excludes April → left join NULL → blackout_unknown)"
  - "Test helper RPCs use set_config('request.jwt.claims', ..., true) so admin client can verify JWT-filtered leaves without minting real tokens"
  - "Rule 1 fix: plan asserted retention p1=0.5 and LTV p0/p2/p8=1450/3150/4200 — both wrong against fixture. B's 08-11 visit is 6 days after first_visit (08-05) → period 0 not 1. Correct: retention p0=1, p1=0, p2=1; LTV p0=2300, p2=4000, p8=5050."
  - "Stale ANL-05 todo text said 'A and C in 1-2 / B in 3-5' — A=3 visits, B=3, C=2 → 3-5 bucket has {A,B}, 2 bucket has {C}"
metrics:
  duration: ~25min
  completed: 2026-04-14
  tasks: 1
  files: 2
requirements: [ANL-02, ANL-03, ANL-05, ANL-06]
---

# Phase 3 Plan 04: Leaf Wrapper Views Summary

One-liner: Shipped the four leaf wrapper views (retention_curve_v, ltv_v, frequency_v, new_vs_returning_v) over cohort_mv with per-cohort horizon NULL-mask, fixed visit-count buckets, and a 4-bucket new_vs_returning split that preserves revenue tie-out across cash and the April 2026 Worldline blackout.

## What Shipped

- `supabase/migrations/0012_leaf_views.sql` — the four leaf views plus four service-role test helper RPCs:
  - `retention_curve_v` (Pattern 3): `(cohort_week × period_weeks)` matrix via `generate_series(0,260)` LEFT JOIN observed retention; `retention_rate` = `retained / cohort_size_week`, NULL when `period_weeks > floor((now() - cohort_week)/7d)`. Exposes `cohort_age_weeks` for Phase 4 boundary line (D-10).
  - `ltv_v` (Pattern 4): cumulative `SUM(gross_cents) / cohort_size` per `(cohort_week, period_weeks)`, same NULL-mask. Avg LTV per acquired customer (D-11).
  - `frequency_v` (Pattern 5): fixed buckets `1`, `2`, `3-5`, `6-10`, `11+` with `customer_count` + `revenue_cents` and a `bucket_order` sort key (D-12).
  - `new_vs_returning_v` (Pattern 6): 4 buckets `new` / `returning` / `cash_anonymous` / `blackout_unknown`. Carded rows in the April 2026 window route to `blackout_unknown`; carded rows with no cohort_mv match also route there (cohort_mv excludes April so the left join is NULL by design); cash rows always route to `cash_anonymous`. Sum across all 4 buckets ties out to `kpi_daily_v.revenue_cents` (D-14).
- All four leaves enforce `restaurant_id::text = (auth.jwt()->>'restaurant_id')` (D-18 defense-in-depth) and `GRANT SELECT TO authenticated` (D-19).
- Test helpers (`test_retention_curve`, `test_ltv`, `test_frequency`, `test_new_vs_returning`) are SECURITY DEFINER, granted only to service_role. They use `set_config('request.jwt.claims', json_build_object('restaurant_id', $1)::text, true)` then `select * from <leaf>`, so admin-client integration tests can verify the JWT-filtered leaves without minting real tokens.

## Verification

- `npx vitest run tests/integration/phase3-analytics.test.ts --reporter=basic`
  → **12 passed | 3 todo (15)**. The 3 remaining todos belong to Plans 03-05 (ANL-07 refresh concurrent, ANL-08 wrapper tenancy ×2).
- ANL-02 retention curve (2 tests):
  1. cohort 2025-08-04: p0 = 1.0, p1 = 0.0, p2 = 1.0
  2. period 250 (5y horizon) → NULL for every cohort; period 0 within-horizon non-NULL
- ANL-03 LTV (2 tests):
  1. cohort 2025-08-04: p0 = 2300, p2 = 4000, p8 = 5050; observable rows monotonic non-decreasing
  2. period 250 → NULL
- ANL-05 frequency (1 test): bucket `3-5` has 2 customers / revenue 10100 (A 5400 + B 4700); bucket `2` has 1 customer / revenue 2500 (C)
- ANL-06 new vs returning (2 tests):
  1. 2025-08-04: sum across 4 buckets == kpi_daily_v.revenue_cents == 1500 (single hash-a tx, bucketed `new`)
  2. Inserts a one-off April 2026 carded fixture row → re-runs `refresh_cohort_mv` → asserts a `blackout_unknown` bucket row exists for 2026-04-05 with the inserted gross — proves both routing branches (April window + missing cohort_mv match)
- Acceptance grep checks all green: 4 `create view`, 4 `grant select`, 7 `auth.jwt()` references, `blackout_unknown` + `cash_anonymous` + `generate_series(0, 260)` + 4 `cohort_age_weeks` matches.
- Migration applied to DEV via `supabase db push` (after `migration repair --status reverted 0012` for two mid-flight edits — operational repair only, no code defect).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan asserted wrong retention numbers**
- Found during: Task 1 test write
- Issue: Plan said "cohort 2025-08-04 period 1 retention_rate = 0.5 (B returned)". Fixture math disagrees: B's only sub-week visit is 08-11, which is 6 days after B's first_visit_at (08-05) → `floor(6/7) = 0`, period 0 not 1. Period 1 has zero visits across both A and B.
- Fix: Test asserts p0=1, p1=0, p2=1 instead.
- Files: tests/integration/phase3-analytics.test.ts
- Commit: 4b96c55

**2. [Rule 1 - Bug] Plan asserted wrong LTV numbers**
- Found during: Task 1 test run
- Issue: Plan suggested LTV cumulative 1450/3150/4200 at p0/p2/p8 — based on the same period-1 misclassification. With B's 08-11 correctly at period 0, the cumulative values are 2300/4000/5050.
- Fix: Test asserts the corrected math.
- Files: tests/integration/phase3-analytics.test.ts
- Commit: 4b96c55

**3. [Rule 1 - Bug] Stale ANL-05 todo text from Plan 03-01 scaffold**
- Found during: Task 1 test write
- Issue: The Wave 0 RED scaffold's todo said "A and C bucketed as 1-2 / B bucketed as 3-5". Fixture has A=3, B=3, C=2 visits — so bucket `3-5` has {A,B} (count=2) and bucket `2` has {C} (count=1).
- Fix: Replaced todo with a real assertion using the correct fixture math.
- Commit: 4b96c55

**4. [Rule 3 - Blocker] Plain leaf views unreadable from admin client**
- Found during: Task 1 test write
- Issue: Leaves filter on `auth.jwt()->>'restaurant_id'`, which returns NULL for service-role admin connections — so the comparison `restaurant_id::text = NULL` filters out every row. Tests querying the leaves directly via `admin.from('retention_curve_v')` would see zero rows and could not verify view contents.
- Fix: Added 4 SECURITY DEFINER test helper RPCs in the same migration (`test_retention_curve`, `test_ltv`, `test_frequency`, `test_new_vs_returning`). Each uses `set_config('request.jwt.claims', json_build_object('restaurant_id', $1)::text, true)` to inject the claim transaction-locally, then re-queries the leaf. Granted only to `service_role`. Same SECURITY DEFINER + revoke pattern as `0006_test_helpers.sql`.
- Files: supabase/migrations/0012_leaf_views.sql
- Commit: 4b96c55

**5. [Rule 3 - Blocker] Plan asserted blackout_unknown rows in DEV but fixture has no April data**
- Found during: Task 1 test write
- Issue: Plan said "Assert `bucket = 'blackout_unknown'` rows exist for any April 2026 carded transactions in DEV." The seed fixture has only 2025 dates; relying on real DEV April data would race with parallel waves and couple the test to ingestion state.
- Fix: Test inserts a one-off `fixture-april-blackout` row (`2026-04-05`, hash-april-blackout, 999 cents), re-refreshes cohort_mv, asserts the blackout_unknown bucket exists with the right revenue, then deletes the row in `finally`. Self-contained, no DEV-state dependency.
- Files: tests/integration/phase3-analytics.test.ts
- Commit: 4b96c55

**6. [Rule 1 - Bug] RPC return type bigint vs int**
- Found during: First test run — `42804: Returned type bigint does not match expected type integer in column 3`
- Issue: `cohort_size_week` comes from a `count(*) over (...)` window function in cohort_mv → bigint. The test helper RPCs declared `cohort_size_week int`, so the RETURN QUERY failed type-checking.
- Fix: Changed RPC return signatures to `cohort_size_week bigint`. Also added `drop function if exists` before each `create or replace` so signature changes can re-apply cleanly.
- Files: supabase/migrations/0012_leaf_views.sql
- Commit: 4b96c55

### Skipped Plan Steps

None.

## Authentication Gates

None.

## Known Stubs

None — all four leaves are production view bodies. The `test_*` helpers are deliberately scoped to `service_role` and not part of any read path.

## Self-Check: PASSED

- supabase/migrations/0012_leaf_views.sql — FOUND
- tests/integration/phase3-analytics.test.ts — FOUND (modified)
- Commit 4b96c55 — FOUND in `git log`
- Phase 3 test file: 12 passed / 3 todo (3 todos owned by Plan 03-05)
- Acceptance grep checks all match
