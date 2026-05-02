---
phase: 16
plan: 04
title: feature_flags + pipeline_runs.fit_train_end migrations (Tasks 1–3)
subsystem: backend
status: partial — Tasks 1, 2, 3 complete; Task 4 (db push) awaiting orchestrator/user
tags: [migration, feature-flags, pipeline-runs, audit-column, RLS, atomic-update, T-16-02]
requirements_addressed: [UPL-02, UPL-07]
threats_mitigated: [T-16-02]
dependency_graph:
  requires:
    - "0058_campaign_calendar.sql (Plan 01) — restaurant_id seed source"
    - "0046_pipeline_runs_extend.sql (Phase 13) — base table for ALTER"
    - "RESEARCH §Q4 RESOLVED — typed remind_on_or_after_date column"
  provides:
    - "supabase/migrations/0061_feature_flags.sql"
    - "supabase/migrations/0063_pipeline_runs_fit_train_end.sql"
    - "tests/forecast/test_offweek_reminder.py (RED — Plan 06 unskips)"
    - "feature_flags table + offweek_reminder seed (per restaurant)"
    - "pipeline_runs.fit_train_end audit column (nullable)"
  affects:
    - "Plan 05 (counterfactual_fit) will populate pipeline_runs.fit_train_end"
    - "Plan 06 (cumulative_uplift) will implement check_offweek_reminder + unskip RED tests"
    - "Plan 07 (campaign_uplift_v) reserves migration slot 0062 (intentionally not created here)"
tech_stack:
  added: []
  patterns:
    - "Typed date column for atomic predicate (avoid string-parse in WHERE)"
    - "Idempotent ADD COLUMN IF NOT EXISTS (mirrors 0046)"
    - "service_role-only writes via REVOKE INSERT/UPDATE/DELETE + GRANT SELECT to authenticated"
    - "RED test with @pytest.mark.skip pinned to Plan 06"
key_files:
  created:
    - supabase/migrations/0061_feature_flags.sql
    - supabase/migrations/0063_pipeline_runs_fit_train_end.sql
    - tests/forecast/__init__.py
    - tests/forecast/test_offweek_reminder.py
  modified: []
decisions:
  - "feature_flags uses typed `remind_on_or_after_date date` column (not parsed from description) — RESEARCH §Q4 RESOLVED. The atomic UPDATE predicate must be a value-comparable filter."
  - "PRIMARY KEY (restaurant_id, flag_key) lets Phase 17 add backtest_gate / other flags without schema regret."
  - "ADD COLUMN IF NOT EXISTS for fit_train_end so re-running 0063 after a partial push is safe."
  - "RED tests use MagicMock supabase client mirroring scripts/forecast/tests/test_run_all_grain_loop.py harness — no real DB or supabase package required."
metrics:
  tasks_completed: 3
  tasks_total: 4
  duration_seconds: ~120
  completed_date: 2026-05-02
  commits: 3
---

# Phase 16 Plan 04: feature_flags + pipeline_runs.fit_train_end Summary (PARTIAL)

**One-liner:** Landed feature_flags table (with offweek_reminder seed, atomic-UPDATE-friendly typed date column) + pipeline_runs.fit_train_end audit ALTER + 4 RED tests for T-16-02 mitigation; `supabase db push` (Task 4) intentionally deferred to user/orchestrator.

## What landed

### Task 1 — `supabase/migrations/0061_feature_flags.sql`  · commit `f68630e`

- `CREATE TABLE public.feature_flags` with PK `(restaurant_id, flag_key)`.
- Typed `remind_on_or_after_date date` column — predicate is an indexed comparison, not a string parse (RESEARCH §Q4 RESOLVED).
- RLS `feature_flags_select` using `auth.jwt()->>'restaurant_id'` (Guard 7 compliant).
- `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated, anon` + `GRANT SELECT TO authenticated` + service_role full rights.
- Idempotent seed: one row per `public.restaurants` with `flag_key='offweek_reminder'`, `enabled=false`, `remind_on_or_after_date='2026-10-15'`. `ON CONFLICT (restaurant_id, flag_key) DO NOTHING` makes re-runs safe.
- Migrates the in-code constant the friend-owner reminder mechanism needs to fire on/after the deliberate off-week.

### Task 2 — `supabase/migrations/0063_pipeline_runs_fit_train_end.sql`  · commit `7403ccb`

- `ALTER TABLE public.pipeline_runs ADD COLUMN IF NOT EXISTS fit_train_end date`.
- BAU rows leave NULL (back-compat with 0046).
- Required for the `test_no_campaign_era_leak` guard to detect counterfactual fits trained past the campaign era.
- Slot 0062 intentionally skipped (Plan 07's `campaign_uplift_v`).

### Task 3 — `tests/forecast/test_offweek_reminder.py`  · commit `34cda9f`

- New test package `tests/forecast/` with `__init__.py`.
- 4 RED tests, all `@pytest.mark.skip(reason="...Plan 06...")`:
  1. `test_reminder_fires_once_when_enabled_false_and_date_reached`
  2. `test_reminder_skip_when_already_fired`
  3. `test_reminder_skip_when_date_in_future`
  4. `test_reminder_atomic_under_concurrent_runs` (direct T-16-02 test)
- MagicMock client emulates the supabase chain `.table('feature_flags').update({...}).eq('flag_key','offweek_reminder').eq('enabled', False).lte('remind_on_or_after_date', today_iso).execute()`.
- `pytest --collect-only` reports exactly 4 tests; full run reports `4 skipped`.

## What did NOT land (Task 4 — checkpoint)

`supabase db push` against DEV is **deferred** to the orchestrator / user per the plan's `type="checkpoint:human-action"` gate. STATE.md and ROADMAP.md are NOT updated by this executor.

The push will land migrations **0058, 0059, 0060, 0061, 0063** (NOT 0062 — that slot is reserved for Plan 07's `campaign_uplift_v`).

## Deviations from Plan

None — Tasks 1, 2, 3 executed exactly as specified.

Notes on environment state:
- `bash scripts/ci-guards.sh` reports Guard 5 (migration drift) FAIL because local migrations top out at 0061/0063 while linked Supabase project is at 0057. **This is the expected pre-Task-4 state** — Task 4 (`supabase db push`) is the resolution, not a deviation. All other guards (1, 2, 3, 3b, 6, 7, 8) are clean.
- No `Co-authored-by: Claude` lines in any commit (per CLAUDE.md).

## Threat Mitigation Recap

**T-16-02 — off-week reminder fires twice under concurrent cron runs:**
Mitigated by the typed `remind_on_or_after_date` column + atomic UPDATE pattern. The contract is now:
```sql
UPDATE public.feature_flags
   SET enabled = true, updated_at = now()
 WHERE flag_key = 'offweek_reminder'
   AND enabled = false
   AND remind_on_or_after_date <= current_date;
```
Postgres serializes UPDATEs on the same row at REPEATABLE READ; only one of two concurrent runs sees `enabled = false`. The RED contract test `test_reminder_atomic_under_concurrent_runs` will go GREEN in Plan 06 when `check_offweek_reminder` is implemented.

## Self-Check: PASSED

Verified files exist:
- `supabase/migrations/0061_feature_flags.sql` — FOUND
- `supabase/migrations/0063_pipeline_runs_fit_train_end.sql` — FOUND
- `tests/forecast/__init__.py` — FOUND
- `tests/forecast/test_offweek_reminder.py` — FOUND

Verified commits exist on `feature/phase-16-its-uplift-attribution`:
- `f68630e` feat(16-04): add feature_flags table + offweek_reminder seed (UPL-07) — FOUND
- `7403ccb` feat(16-04): add pipeline_runs.fit_train_end audit column (UPL-02) — FOUND
- `34cda9f` test(16-04): RED stubs for offweek_reminder atomic-fire-once (T-16-02) — FOUND

Verified verification commands:
- Task 1 `grep` chain on 0061: all 7 markers present.
- Task 2 `grep` chain on 0063: 2/2 markers present.
- Task 3 `pytest --collect-only`: exactly 4 tests collected, all skip-marked.

Awaiting Task 4 (db push) before Wave 2 may begin.
