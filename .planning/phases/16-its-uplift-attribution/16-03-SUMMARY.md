---
phase: 16
plan: 03
title: kpi_daily_with_comparable_v migration (revenue_comparable_eur)
subsystem: data-layer
tags: [migration, view, rls, kpi, comparable-revenue, its-uplift]

requires:
  - 0058_campaign_calendar.sql (Plan 16-01 — restaurant_id JWT contract + seed)
  - 0059_baseline_items_v.sql (Plan 16-02 — comparable-items source set)
  - 0011_kpi_daily_mv_real.sql (Phase 1 — base MV being extended)
  - 0007_stg_orderbird_order_items.sql (Phase 2 — line-item source table)

provides:
  - public.kpi_daily_with_comparable_v (VIEW; per (restaurant_id, business_date) revenue_eur + revenue_comparable_eur)
  - revenue_comparable_eur column for Track-B counterfactual fits (CONTEXT.md D-03 / D-04)

affects:
  - downstream Plan 05 counterfactual_fit.py — MUST source revenue from this view's revenue_comparable_eur, never raw kpi_daily_mv (CI Guard 9 enforces in Plan 11)

tech-stack:
  added: []
  patterns:
    - wrapper-view-on-MV (analog supabase/migrations/0054_forecast_with_actual_v.sql)
    - text-cast item_gross_amount_eur via COALESCE/NULLIF (analog 0029_item_counts_daily_mv_add_revenue.sql)
    - transactions-join time anchor (analog 0025_item_counts_daily_mv.sql lines 18-21)

key-files:
  created:
    - tests/sql/test_kpi_daily_with_comparable_v.py
    - supabase/migrations/0060_kpi_daily_with_comparable_v.sql
  modified: []

decisions:
  - mirror Plan 02 deviation pattern — join via transactions for time anchor, text-cast item_gross_amount_eur, since stg_orderbird_order_items has neither occurred_at nor item_gross_cents
  - LEFT JOIN comparable CTE + COALESCE so zero-comparable dates return 0 not NULL (matches client contract test_comparable_zero_when_only_post_campaign_items)
  - runtime-skip pattern in tests (no @pytest.mark.skip decorators) — matches Plan 02 sister file; nothing to remove in Task 2

metrics:
  duration: "2m 51s"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  commits: 2
  completed: "2026-05-02"
---

# Phase 16 Plan 03: kpi_daily_with_comparable_v Summary

Wrapper view `kpi_daily_with_comparable_v` extends `kpi_daily_mv` with `revenue_comparable_eur` (revenue restricted to items in `baseline_items_v`), the canonical KPI surface for Track-B counterfactual fits (CONTEXT.md D-03 / Guard 9 / SC#3).

## What was built

**Migration `0060_kpi_daily_with_comparable_v.sql`** — read-only VIEW (per D-03; not a new MV) with two parts:

1. **`comparable` CTE** — sums per-line-item gross from `stg_orderbird_order_items` joined to `baseline_items_v` (INNER JOIN filters out non-comparable launches like Onsen EGG / Tantan / Hell beer). Time anchor + timezone come from `transactions JOIN restaurants` per the canonical pattern in migrations 0025 / 0029.
2. **Outer SELECT** — LEFT JOINs `kpi_daily_mv` to the CTE on `(restaurant_id, business_date)`, exposing `revenue_eur`, `tx_count`, `avg_ticket_eur`, plus `revenue_comparable_eur = COALESCE(c.revenue_comparable_cents, 0) / 100.0` (no NULLs leaked). RLS via `WHERE k.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid`.

**Test stub `tests/sql/test_kpi_daily_with_comparable_v.py`** — 5 RED pytest cases:

| Test | Asserts |
| --- | --- |
| `test_comparable_revenue_present` | mixed-day: comparable=15.00, total=18.00 |
| `test_comparable_le_total_revenue` | strict invariant: comparable ≤ total per row |
| `test_comparable_zero_when_only_post_campaign_items` | LEFT JOIN + COALESCE => 0, not NULL |
| `test_comparable_rls_anon_zero` | anon JWT returns 0 rows |
| `test_comparable_rls_cross_tenant` | tenant A cannot see tenant B revenue |

Runtime-skip via `_supabase_client()` when SUPABASE_URL / SERVICE_ROLE_KEY are absent — same pattern as Plan 02 sister file.

## Tasks executed

| # | Name | Commit | Files | Notes |
| - | - | - | - | - |
| 1 | RED — write `tests/sql/test_kpi_daily_with_comparable_v.py` | `cda45cf` | tests/sql/test_kpi_daily_with_comparable_v.py | 5 tests; runtime skip |
| 2 | GREEN — write `supabase/migrations/0060_kpi_daily_with_comparable_v.sql` | `f19566c` | supabase/migrations/0060_kpi_daily_with_comparable_v.sql | view + RLS + GRANT |

## Acceptance criteria

### Task 1
- [x] `tests/sql/test_kpi_daily_with_comparable_v.py` exists
- [x] 5 test functions defined with the exact names in the plan
- [x] Tests assert `revenue_comparable_eur <= revenue_eur` invariant
- [x] `pytest --collect-only` returns 5 tests

### Task 2
- [x] `supabase/migrations/0060_kpi_daily_with_comparable_v.sql` exists
- [x] `CREATE OR REPLACE VIEW public.kpi_daily_with_comparable_v` present
- [x] `revenue_comparable_eur` column present
- [x] `INNER JOIN public.baseline_items_v` present (comparable filter)
- [x] `LEFT JOIN comparable` present (preserves zero-comparable dates)
- [x] `auth.jwt()->>'restaurant_id'` present (NOT `tenant_id`)
- [x] `GRANT SELECT ON public.kpi_daily_with_comparable_v TO authenticated` present
- [x] No `CREATE MATERIALIZED VIEW` (D-03 mandates view, not MV)
- [x] No `@pytest.mark.skip` decorators in test file (none added; runtime skip used per Plan 02 sister-file pattern)

### Plan-level (16-03-PLAN.md)
- [x] View invariant `revenue_comparable_eur ≤ revenue_eur` provable from SQL definition: `c.revenue_comparable_cents` is a SUM filtered by `INNER JOIN baseline_items_v`, which is a subset of the items contributing to `kpi_daily_mv.revenue_cents` (which sums `transactions.gross_cents` over the same join key); the per-line-item gross summed from filtered staging rows ≤ the per-tx gross stored in `transactions`.
- [x] Guards 1/2/3/3b/4/6/7/8 clean (Guard 5 is pre-existing migration drift — Plan 04 db push resolves)

## Deviations from plan

### Inherited from Plan 02 (Rule 1 — bug in plan literal SQL)

**1. [Rule 1 — Bug] Plan literal SQL references columns that do not exist on `stg_orderbird_order_items`**

- **Found during:** Task 2 (migration body).
- **Issue:** 16-03-PLAN.md Task 2 action block contains literal SQL using `soi.occurred_at AT TIME ZONE r.timezone` and `soi.item_gross_cents`. Migration `0007_stg_orderbird_order_items.sql` defines neither column — `occurred_at` lives on `transactions`, and per-line gross is stored as text in `item_gross_amount_eur`. Same plan-spec gap inherited from `12-PROPOSAL.md §7 lines 806-825`; Plan 02 applied the same fix in `0059_baseline_items_v.sql`.
- **Fix:** Mirrored canonical pattern from migrations 0025 (`item_counts_daily_mv`) + 0029 (`item_counts_daily_mv_add_revenue`):
  - Time anchor + timezone via `JOIN public.transactions t ON t.restaurant_id = oi.restaurant_id AND t.source_tx_id = oi.invoice_number` then `JOIN public.restaurants r ON r.id = t.restaurant_id`, taking `(t.occurred_at AT TIME ZONE r.timezone)::date`.
  - Per-line gross via `(SUM(COALESCE(NULLIF(oi.item_gross_amount_eur, '')::numeric, 0)) * 100)::bigint AS revenue_comparable_cents` (matches kpi_daily_mv.revenue_cents shape).
- **Files modified:** `supabase/migrations/0060_kpi_daily_with_comparable_v.sql`.
- **Documentation:** Inline DEVIATION block at top of migration (lines 12-29). Same disposition as Plan 02 SUMMARY.
- **Commit:** `f19566c`.

### Plan literal vs Plan 02 alignment cleanup (Rule 3 — process)

**2. [Rule 3 — Blocking] Plan Task 2 instructs "remove `@pytest.mark.skip` decorators" but RED file uses runtime-skip pattern**

- **Found during:** Task 2 cleanup step.
- **Issue:** Task 2's action block ends with "After writing the migration, remove `@pytest.mark.skip` decorators from `tests/sql/test_kpi_daily_with_comparable_v.py`." But the sister file `tests/sql/test_baseline_items_v.py` (Plan 02 Task 1) uses runtime-skip via `_supabase_client()` — no `@pytest.mark.skip` decorators. To stay consistent with Plan 02 (and to keep the file collectable in CI without manipulating decorators), Task 1 here followed the same pattern.
- **Fix:** No decorators to remove; the runtime-skip pattern auto-flips to GREEN on Plan 04 db push when env vars are present in DEV. Documented in test file docstring + this SUMMARY.
- **Files modified:** none — decision baked into Task 1.
- **Commit:** `cda45cf` (Task 1 — pattern locked there).

## Self-Check

Verified after writing this SUMMARY:

- [x] `supabase/migrations/0060_kpi_daily_with_comparable_v.sql` exists on disk
- [x] `tests/sql/test_kpi_daily_with_comparable_v.py` exists on disk
- [x] Commit `cda45cf` (Task 1 RED) present in `git log`
- [x] Commit `f19566c` (Task 2 GREEN) present in `git log`
- [x] No `Co-authored-by: Claude` lines in either commit message

```
$ git log --oneline f19566c cda45cf -2
f19566c feat(16-03): GREEN — kpi_daily_with_comparable_v migration 0060
cda45cf test(16-03): RED — kpi_daily_with_comparable_v invariant + RLS stubs
```

## Self-Check: PASSED

## What's next

Plan 04 (Wave 1, depends_on [01, 02, 03]) runs `supabase db push` against DEV. Once the cascade lands:
- The 5 RED tests in `tests/sql/test_kpi_daily_with_comparable_v.py` flip to GREEN once a fixture-loaded DEV is available.
- `revenue_comparable_eur ≤ revenue_eur` invariant becomes empirically observable.
- Guard 5 (migration drift) clears.
- Plan 05 (`counterfactual_fit.py`) gains its read source for Track-B fits.
