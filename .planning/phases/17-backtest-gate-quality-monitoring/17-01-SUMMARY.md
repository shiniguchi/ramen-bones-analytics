---
phase: 17-backtest-gate-quality-monitoring
plan: "01"
subsystem: database-schema + frontend-component
tags: [supabase, migrations, rls, forecast-quality, feature-flags, data-freshness, freshness-label, bcck-04, bck-08]
status: partial-checkpoint
dependency_graph:
  requires: []
  provides:
    - "supabase/migrations/0067_phase17_backtest_schema.sql — forecast_quality diagnostic columns + feature_flags model seeds + data_freshness_v UNION extension"
    - "src/lib/components/FreshnessLabel.svelte — >24h yellow, >30h red per BCK-08"
  affects:
    - "downstream Plan 17-02 through 17-09 — require migration 0067 applied to DEV before running"
    - "FreshnessLabel displayed on dashboard root page"
tech_stack:
  added: []
  patterns:
    - "ALTER TABLE ADD COLUMN IF NOT EXISTS — safe additive migration pattern"
    - "DROP VIEW + CREATE VIEW — required for body-only changes (CREATE OR REPLACE forbids when body changes)"
    - "CROSS JOIN (VALUES ...) for multi-row seed inserts"
    - "UNION ALL in view body to aggregate multiple data sources into single staleness timestamp"
key_files:
  created:
    - supabase/migrations/0067_phase17_backtest_schema.sql
    - .planning/phases/17-backtest-gate-quality-monitoring/17-01-SUMMARY.md
  modified:
    - src/lib/components/FreshnessLabel.svelte
    - tests/unit/cards.test.ts
decisions:
  - "data_freshness_v uses MIN(stage_last) across UNION branches — stalest stage drives badge, not latest"
  - "pipeline_runs UNION branch uses security_invoker=true propagation — no separate RLS needed on the view"
  - "Tests live in tests/unit/cards.test.ts (not a new FreshnessLabel.test.ts) — existing test updated to new thresholds + 3 BCK-08 boundary tests added"
  - "model_name in forecast_daily has NO CHECK constraint — no 4th migration section needed"
  - "step_names forecast_backtest and forecast_naive_dow_with_holidays included in IN-list as future Phase 17 scripts"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-05-06"
  tasks_completed: 2
  tasks_total: 3
  files_created: 2
  files_modified: 2
---

# Phase 17 Plan 01: Migration 0067 + FreshnessLabel Threshold Summary

**One-liner:** Migration 0067 adds backtest diagnostic columns to forecast_quality, seeds 6 per-model feature_flags rows, and extends data_freshness_v with forecast cascade stage UNION branch; FreshnessLabel thresholds tightened to >24h yellow / >30h red per BCK-08.

## Tasks Completed

| Task | Status | Commit | Description |
|------|--------|--------|-------------|
| Task 1: Migration 0067 | DONE | fcdedfd | forecast_quality ALTER + feature_flags seed + data_freshness_v UNION |
| Task 2: FreshnessLabel threshold | DONE | 73afa19 | >24h yellow, >30h red + 3 new BCK-08 boundary tests |
| Task 3: Schema push to DEV | CHECKPOINT | — | Blocking human action: supabase db push + gh workflow run |

## Pre-flight Verification Results

1. **step_name literals check:** `grep -rn "STEP_NAME\s*=" scripts/forecast/` confirmed:
   - `forecast_run_all` (run_all.py:42)
   - `forecast_sarimax` (sarimax_fit.py:50)
   - `forecast_prophet` (prophet_fit.py:57)
   - `forecast_ets` (ets_fit.py:47)
   - `forecast_theta` (theta_fit.py:46)
   - `forecast_naive_dow` (naive_dow_fit.py:50)
   - `forecast_backtest` — NEW, Phase 17 Plan 05 will create this script
   - `forecast_naive_dow_with_holidays` — NEW, Phase 17 Plan 03 will create this script
   - All 8 literals match the migration's IN-list.

2. **model_name CHECK constraint check:** `grep -nE "model_name|CHECK" supabase/migrations/0050_forecast_daily.sql` confirmed `model_name text NOT NULL` with NO CHECK constraint — no 4th migration section needed.

3. **pipeline_runs column verification:** `0039_pipeline_runs_skeleton.sql` confirmed `finished_at timestamptz`, `status text`, `step_name text` — all column names match.

4. **FreshnessLabel pre-change:** Confirmed `hours > 48` for red, `hours > 30` for yellow in the original file.

## Migration 0067 Final SQL Summary

Three sections in `supabase/migrations/0067_phase17_backtest_schema.sql`:

**Section 1 — forecast_quality ALTER:**
- `fold_index integer` (nullable)
- `train_end_date date` (nullable)
- `eval_start_date date` (nullable)
- `gate_verdict text CHECK (gate_verdict IN ('PASS', 'FAIL', 'PENDING', 'UNCALIBRATED') OR gate_verdict IS NULL)`
- PK NOT extended — relies on `evaluated_at` microsecond resolution as disambiguator

**Section 2 — feature_flags CROSS JOIN seed:**
- 6 rows per restaurant: model_sarimax, model_prophet, model_ets, model_theta, model_naive_dow, model_naive_dow_with_holidays
- All `enabled=true`, `ON CONFLICT DO NOTHING`

**Section 3 — data_freshness_v DROP+CREATE:**
- Two UNION ALL branches: (1) transactions.created_at (existing), (2) pipeline_runs.finished_at for 8 forecast step_names
- `MIN(stage_last)` = stalest stage drives the freshness badge
- `WHERE restaurant_id IS NOT NULL` strips global Phase 12 audit rows
- `WITH (security_invoker = true)` + `GRANT SELECT TO authenticated` preserved for RLS correctness

## FreshnessLabel Test Results

```
npm run test -- --run tests/unit/cards.test.ts
14 tests passed
```

- Updated: `FreshnessLabel muted <=24h, yellow >24h, red >30h (D-10a / BCK-08)` (26h yellow, 32h red)
- Added: `FreshnessLabel BCK-08 boundary: yellow at 25h` — was gray under old >30h, now yellow
- Added: `FreshnessLabel BCK-08 boundary: red at 31h` — was yellow under old >48h, now red
- Added: `FreshnessLabel BCK-08 boundary: muted at 23h (under 24h threshold)`

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Adjustments

**1. [Adjustment] Tests added to cards.test.ts, not a new FreshnessLabel.test.ts**
- **Found during:** Task 2
- **Issue:** Plan says to create `src/lib/components/FreshnessLabel.test.ts` or `FreshnessLabel.test.ts`, but existing FreshnessLabel tests already live in `tests/unit/cards.test.ts` — project convention is unit tests in `tests/unit/`
- **Fix:** Updated the existing test in `cards.test.ts` (updated threshold description, boundary values) and added 3 new BCK-08 boundary tests there
- **Files modified:** tests/unit/cards.test.ts

**2. [Adjustment] svelte-kit sync needed in worktree**
- **Found during:** Task 2 test run
- **Issue:** `.svelte-kit/` directory not present in git worktree (it's .gitignored, generated by build), causing `TSCONFIG_ERROR: Tsconfig not found` in vitest
- **Fix:** Ran `npx svelte-kit sync` in worktree to generate `.svelte-kit/tsconfig.json`; all tests then passed
- **Files modified:** None (generated files are gitignored)

## Checkpoint: Task 3 — Blocking Schema Push

**Status:** AWAITING HUMAN ACTION

The migration 0067 SQL file is committed on the worktree-agent branch (`worktree-agent-a23b034f1d3ed50fe`). To apply to DEV, the orchestrator must merge the worktree branch back to the feature branch and push, then run the migrations workflow.

**Steps required:**
1. Orchestrator merges worktree-agent-a23b034f1d3ed50fe → feature/phase-17-backtest-gate-quality-monitoring
2. `git push origin feature/phase-17-backtest-gate-quality-monitoring`
3. `gh workflow run migrations.yml --ref feature/phase-17-backtest-gate-quality-monitoring`
4. Wait ~30s: `gh run list --workflow=migrations.yml --limit 1`
5. Verify on DEV:
   - `SELECT column_name FROM information_schema.columns WHERE table_name='forecast_quality' AND column_name IN ('fold_index','train_end_date','eval_start_date','gate_verdict') ORDER BY column_name;` → 4 rows
   - `SELECT count(*) FROM public.feature_flags WHERE flag_key LIKE 'model_%';` → ≥6
   - `SELECT pg_get_viewdef('public.data_freshness_v'::regclass);` → contains 'pipeline_runs'

## Threat Surface Scan

Files created/modified in this plan introduce security-relevant surface:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: rls-view-body-change | supabase/migrations/0067_phase17_backtest_schema.sql | data_freshness_v now reads pipeline_runs — RLS enforcement relies on security_invoker=true propagating restaurant_id JWT claim to both underlying tables. Verified: pipeline_runs has its own RLS policy allowing restaurant_id IS NULL OR restaurant_id::text = jwt->>'restaurant_id' (0046). |

## Self-Check

Tasks 1 and 2 verified:

- [x] `supabase/migrations/0067_phase17_backtest_schema.sql` exists: YES
- [x] Contains ALTER forecast_quality: YES (grep -c returns 1)
- [x] Contains INSERT feature_flags: YES (grep -c returns 1)
- [x] Contains CREATE VIEW data_freshness_v: YES (grep -c returns 1)
- [x] Contains 'forecast_backtest' literal: YES
- [x] Contains 'forecast_naive_dow_with_holidays' literal: YES
- [x] security_invoker = true present: YES
- [x] GRANT SELECT TO authenticated present: YES
- [x] Commit fcdedfd exists: YES
- [x] FreshnessLabel.svelte has 24 and 30 thresholds: YES
- [x] tests/unit/cards.test.ts has 3 new BCK-08 tests: YES
- [x] Commit 73afa19 exists: YES
- [x] All 14 tests pass: YES

Task 3 (Schema push) is a blocking checkpoint — not yet applied to DEV.

## Self-Check: PARTIAL

Tasks 1 and 2 PASSED. Task 3 is a blocking checkpoint awaiting human action.
