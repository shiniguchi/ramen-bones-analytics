# Phase 18 — Deferred Items

Out-of-scope discoveries surfaced during plan execution that don't directly relate to the plan's deliverables. Logged here per the scope-boundary rule (only auto-fix issues directly caused by the current task's changes).

---

## Pre-existing test failure: `test_two_window_kinds_per_campaign_per_model`

**Discovered during:** Plan 18-02 (2026-05-07)
**File:** `tests/forecast/test_cumulative_uplift.py:309-409`
**Status:** Pre-existing — failure predates this plan (confirmed via `git stash` against the Task 1 HEAD).

**Symptom:** `AssertionError: Expected at least 1 model to produce per-window rows. Got: {}. All upserts: []`

**Root cause:** The `_table_router` MagicMock in this test does not stub `chain.lt(...)` (only `.gte()` and `.lte()`). `_successful_cf_models` at `cumulative_uplift.py:517` uses `.lt()` for the upper bound of the timestamptz range probe (Phase 16-12 fix). When `.lt()` returns a fresh unconfigured MagicMock, the probe response data is `data=[]`, so `_successful_cf_models` returns `[]` and the per-campaign-model loop runs zero times.

**Fix (1 line):** Add `m.lt.return_value = m` alongside the existing `m.lte.return_value = m` mock setup. (My new sibling test `test_process_campaign_model_emits_iso_week_rows` includes this fix in its mock harness.)

**Why deferred:** Per scope boundary rule — only auto-fix issues directly caused by current task's changes. This was already broken on entry; fixing it is a one-liner but lives outside the plan's `<files_modified>` contract for the existing function under test. Recommend addressing in a 5-minute drift fix in a future plan or quick task.

**Workaround:** Plan 18-02's new integration test (`test_process_campaign_model_emits_iso_week_rows`) provides equivalent coverage of the per-window writers via a properly-stubbed mock.
