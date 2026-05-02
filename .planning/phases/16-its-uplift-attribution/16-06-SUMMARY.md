---
phase: 16
plan: 06
title: cumulative_uplift.py — bootstrap CI math (TDD)
subsystem: backend
status: complete
tags: [bootstrap, monte-carlo, CI, uplift, ITS, attribution, atomic-update, feature-flags, T-16-02, TDD]
requirements_addressed: [UPL-04, UPL-05, UPL-07]
threats_mitigated: [T-16-02]
dependency_graph:
  requires:
    - "Plan 04 — feature_flags + pipeline_runs.fit_train_end (RED stubs in tests/forecast/test_offweek_reminder.py)"
    - "Plan 05 — counterfactual_fit.py writes forecast_track='cf' rows that this aggregator reads"
    - "RESEARCH §1 — D-08 textbook bootstrap pseudocode (one path per resample, percentile 2.5/97.5)"
    - "RESEARCH §5 — atomic UPDATE pattern + SUCCESSFUL_CF_MODELS resilience pattern"
  provides:
    - "scripts/forecast/cumulative_uplift.py — bootstrap CI orchestrator + offweek reminder fire"
    - "tests/forecast/test_cumulative_uplift.py — 9 tests (6 per-window + 3 per-day)"
    - "check_offweek_reminder helper — atomic UPDATE on feature_flags (T-16-02 mitigation)"
    - "compute_per_day_uplift_rows — D-11 sparkline shape-of-uplift rows"
  affects:
    - "Plan 07 will create campaign_uplift backing table consumed by this module's upserts"
    - "Plan 09 (CampaignUpliftCard) will read campaign_uplift_v rows produced here"
    - "Plan 13 (forecast-refresh.yml extension) will invoke `python -m scripts.forecast.cumulative_uplift`"
tech_stack:
  added: []
  patterns:
    - "Path-level bootstrap CI (textbook D-08 form): `for k in range(N): p = rng.integers(0, P); sums[k] = (actual − paths[:, p]).sum()`"
    - "Deterministic seed=42 default for snapshot stability across runs"
    - "Per-day seed offset (seed=42+i) for rolling cumulative rows — keeps each day deterministic but distinct"
    - "SUCCESSFUL_CF_MODELS list built from pipeline_runs.status — partial-fit resilience (UPL-07)"
    - "Atomic UPDATE on feature_flags with WHERE enabled=false AND remind_on_or_after_date<=today — race-safe single-flight (T-16-02)"
    - "Two-step DB load: forecast_with_actual_v for mean yhat + actuals; forecast_daily for 200-path yhat_samples (joined in Python)"
    - "Guard 9 / D-04 enforcement: kpi_name='revenue_comparable_eur' hardcoded in compute_uplift_for_window — ValueError on misuse"
    - "Test stub of `supabase` package via `sys.modules` injection (mirrors scripts/forecast/tests/test_run_all_grain_loop.py)"
key_files:
  created:
    - scripts/forecast/cumulative_uplift.py
    - tests/forecast/test_cumulative_uplift.py
  modified:
    - tests/forecast/test_offweek_reminder.py
decisions:
  - "Adopted RESEARCH §1's textbook bootstrap form (one path per resample, NOT bootstrap-mean form). Test_bootstrap_one_path_per_resample mocks rng.integers and asserts the impl never passes size= — the bootstrap-mean form is documented in RESEARCH §1 only as reference and explicitly rejected."
  - "compute_per_day_uplift_rows landed in Task 2 alongside main_uplift (which calls it from _process_campaign_model) rather than in Task 4. Task 4 added the 3 contract tests that lock the per-day rolling-cumulative behavior. Pragmatic deviation from strict TDD ordering — main_uplift integration test in Task 1 required the helper to exist."
  - "Default reminder writer uses write_failure as the closest existing pipeline_runs helper (status='failure' carrying error_msg='Time to plan an off-week to re-anchor the counterfactual'). Per RESEARCH §5: status field carries the discriminator; KISS over a dedicated write_reminder helper."
  - "check_offweek_reminder accepts an injected write_reminder callable for tests. The default (None) calls _default_write_reminder(client, restaurant_id=...); the test path calls write_reminder(client) — matching the existing test_offweek_reminder.py contract."
  - "Window kinds upserted: campaign_window (start..end), cumulative_since_launch (start..run_date), per_day (one per day in the cumulative window). Plan 07 owns the migration that extends the PK to (restaurant_id, campaign_id, model_name, window_kind, as_of_date)."
metrics:
  tasks_completed: 4
  tasks_total: 4
  duration_seconds: ~375
  completed_date: "2026-05-02"
  files_created: 2
  files_modified: 1
  tests_added: 9
  tests_unskipped: 4
  loc_added: 1295
---

# Phase 16 Plan 06: cumulative_uplift.py — bootstrap CI math (TDD) Summary

Pure-numpy 1000-resample bootstrap CI on per-(campaign, model, window) cumulative uplift, plus atomic-fire-once off-week reminder via Postgres UPDATE on feature_flags — closes UPL-04, UPL-05, UPL-07 and mitigates T-16-02 end-to-end.

## What was built

- **`scripts/forecast/cumulative_uplift.py` (728 LOC)** — orchestrator + 4 public compute helpers + 1 reminder helper.
- **`tests/forecast/test_cumulative_uplift.py` (538 LOC)** — 9 tests covering CI coverage, determinism, textbook-form guard, per-window contract, per-day rolling cumulative.
- **`tests/forecast/test_offweek_reminder.py`** — 4 RED stubs from Plan 04 unskipped against the new helper.

### Public surface

| Function | Purpose |
|---|---|
| `bootstrap_uplift_ci(actual, paths, n_resamples=1000, seed=42)` | Pure-numpy textbook D-08 CI math |
| `compute_uplift_for_window(client, *, restaurant_id, campaign_id, model_name, start_date, end_date)` | Per-window aggregator (returns None for empty windows) |
| `compute_naive_dow_uplift(client, ...)` | D-09 cross-check column source |
| `compute_per_day_uplift_rows(*, ..., target_dates)` | D-11 sparkline rolling rows |
| `check_offweek_reminder(client, *, today, write_reminder=None)` | Atomic UPDATE on feature_flags (T-16-02) |
| `main_uplift(client, run_date)` | Top-level orchestrator: campaign × successful CF model loop + reminder fire |
| `main()` / `__main__` | CLI entry: `python -m scripts.forecast.cumulative_uplift [--run-date YYYY-MM-DD]` |

## TDD execution log

| Task | Phase | Commit | Verification |
|---|---|---|---|
| 1 | RED — 6 skip-marked tests | `716b5c6` | `pytest --collect-only` returns 6 tests; all skipped (cumulative_uplift.py absent) |
| 2 | GREEN — cumulative_uplift.py | `071ecca` | All 6 tests pass; imports clean (`bootstrap_uplift_ci`, `check_offweek_reminder`, `main_uplift`, `compute_uplift_for_window`, `compute_naive_dow_uplift`, `compute_per_day_uplift_rows`) |
| 3 | REFACTOR — unskip offweek_reminder | `21a3f0e` | All 4 T-16-02 tests now GREEN against real helper; 0 skip decorators remain |
| 4 | TDD — per-day sparkline tests | `ca51040` | 3 new tests pass; total 13/13 in `tests/forecast/` |

### Final test result

```
============================== 13 passed in 0.95s ==============================
tests/forecast/test_cumulative_uplift.py::test_ci_coverage PASSED
tests/forecast/test_cumulative_uplift.py::test_bootstrap_consistency PASSED
tests/forecast/test_cumulative_uplift.py::test_bootstrap_one_path_per_resample PASSED
tests/forecast/test_cumulative_uplift.py::test_naive_dow_present PASSED
tests/forecast/test_cumulative_uplift.py::test_skip_empty_window PASSED
tests/forecast/test_cumulative_uplift.py::test_two_window_kinds_per_campaign_per_model PASSED
tests/forecast/test_cumulative_uplift.py::test_per_day_rows_count_matches_window_length PASSED
tests/forecast/test_cumulative_uplift.py::test_per_day_cumulative_monotone_for_constant_uplift PASSED
tests/forecast/test_cumulative_uplift.py::test_per_day_ci_truncates_at_day_i PASSED
tests/forecast/test_offweek_reminder.py::test_reminder_fires_once_when_enabled_false_and_date_reached PASSED
tests/forecast/test_offweek_reminder.py::test_reminder_skip_when_already_fired PASSED
tests/forecast/test_offweek_reminder.py::test_reminder_skip_when_date_in_future PASSED
tests/forecast/test_offweek_reminder.py::test_reminder_atomic_under_concurrent_runs PASSED
```

## Plan must_haves verification

All 5 plan-level truths demonstrably true:

| Truth | Evidence |
|---|---|
| `cumulative_uplift.py computes Σ(actual − Track-B) per (campaign, model, window_kind)` | `_process_campaign_model` emits rows for `window_kind ∈ {campaign_window, cumulative_since_launch, per_day}` per (camp, model) |
| `95% CI from 1000 path-level bootstrap resamples of 200 stored sample paths (D-08 textbook form)` | `bootstrap_uplift_ci` loop body matches D-08 pseudocode verbatim; `test_bootstrap_one_path_per_resample` enforces it (raises if `size=` is ever passed to `rng.integers`) |
| `Bootstrap CI bounds for synthetic-known uplift contain truth at 95% rate over 100 simulations` | `test_ci_coverage` runs 100 sims with TRUE uplift = 1500; asserts ≥90/100 contain truth (lenient bound to avoid flake; observed coverage in dev runs: ~94/100) |
| `naive_dow_uplift_eur populated for every campaign-window row` | `compute_naive_dow_uplift` called per window in `_process_campaign_model`; `test_naive_dow_present` verifies |
| `Off-week reminder fires once via atomic UPDATE on feature_flags` | `check_offweek_reminder` issues a single Postgres UPDATE with WHERE enabled=false; `test_reminder_atomic_under_concurrent_runs` confirms 1× fire across 2 simulated concurrent runs (T-16-02 mitigated) |

Plan key_link patterns also satisfied:

| Pattern | Match |
|---|---|
| `lte\('remind_on_or_after_date'` | `cumulative_uplift.py:451` (`.lte("remind_on_or_after_date", today.isoformat())` — quote-agnostic match) |
| `yhat_samples` reads from `forecast_daily` | `_load_yhat_samples` selects `target_date,yhat_samples` from `forecast_daily` for the same (restaurant_id, model_name, kpi_name='revenue_comparable_eur', forecast_track='cf') tuple |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Mock supabase client in `test_two_window_kinds_per_campaign_per_model` returned MagicMock for `.error` attribute, tripping the production code's `getattr(res, 'error', None)` defensive check**

- **Found during:** Task 2 GREEN run.
- **Issue:** `MagicMock(data=[...])` auto-creates a truthy `.error` attribute, so the upsert-result error guard treated every successful upsert as a failure.
- **Fix:** Replaced ad-hoc `MagicMock` response objects with `types.SimpleNamespace(data=..., error=None)` inside the test mock router — mirrors `scripts/forecast/tests/test_run_all_grain_loop.py`'s `_make_table_response` pattern. Production code unchanged (defensive check is correct).
- **Files modified:** `tests/forecast/test_cumulative_uplift.py` (test-only fix).
- **Commit:** part of `071ecca`.

**2. [Plan-clarification] Task 4's `compute_per_day_uplift_rows` was implemented in Task 2 rather than Task 4**

- **Found during:** Task 2 GREEN drafting — `main_uplift` orchestrator calls `_process_campaign_model`, which the plan specifies must upsert per-day rows alongside per-window rows. Implementing `main_uplift` without the per-day helper would have left it incomplete and Task 1's integration test (`test_two_window_kinds_per_campaign_per_model`) would not have produced the per-day rows the plan describes as part of `main_uplift`'s contract.
- **Decision:** Implement `compute_per_day_uplift_rows` + its `main_uplift` call sites in Task 2 (GREEN); add the 3 contract-locking tests in Task 4. The 3 Task 4 tests pass on first run because the impl is already present — documented honestly here, not papered over.
- **Impact:** No behavior change; only commit ordering differs from the plan's strict TDD sequence. Test/impl separation is preserved per commit (Task 4 is `test(...)`, not `feat(...)`).

**3. [Test-tooling] Removed `pytest` import + `_SKIP_REASON` constant from `test_offweek_reminder.py` after un-skipping**

- **Found during:** Task 3 lint check.
- **Issue:** With all 4 `@pytest.mark.skip` decorators removed, the `pytest` import and `_SKIP_REASON` string were dead code.
- **Fix:** Removed both; added `sys`/`types`/supabase-stub block at the module top so per-test `from scripts.forecast.cumulative_uplift import ...` resolves on machines without supabase-py.
- **Commit:** `21a3f0e`.

### Auth gates

None encountered.

### Architectural changes (Rule 4)

None — all work fit the locked decisions in 16-CONTEXT.md and the patterns in 16-RESEARCH.md.

## Threat Model Verification

| Threat | Status | Verified by |
|---|---|---|
| **T-16-02** — Two concurrent GHA runs double-fire offweek reminder | Mitigated | `test_reminder_atomic_under_concurrent_runs` — across two simulated runs (winner returns 1 row, loser returns 0 rows), `write_reminder.call_count == 1`. The Postgres UPDATE WHERE clause acts as a serialized guard at the row level; no application lock needed. |

No new threat surface introduced. The module is read-only against `forecast_with_actual_v` + `forecast_daily`, write-only against `campaign_uplift` (Plan 07's table) + `pipeline_runs` + `feature_flags`. All writes go through the service-role client (`scripts/forecast/db.make_client`) — never reaches authenticated/anon JWTs. Compatible with C-06 hybrid-RLS rule.

## Performance notes

- **Per-day rolling bootstrap:** 30-day window × 5 models × 1 campaign × 1000 resamples per day = 150K array ops total. Sub-second on a laptop. The plan's 90-day worst case (450 bootstrap calls × 1000 resamples = 450K ops) is still well within the workflow's 10-minute budget. No vectorization required at current scale.
- **DB roundtrips per (campaign, model):** 4 — `forecast_with_actual_v` (campaign window), `forecast_daily.yhat_samples` (campaign window), same pair for cumulative_since_launch window. Naive DoW adds 2 more (`forecast_with_actual_v` for the naive_dow model rows × 2 windows). For 1 campaign × 5 models on the friend's tenant: ~30 selects + 1 upsert per refresh. Trivial against Supabase free tier.

## Self-Check: PASSED

Files created exist:
- `scripts/forecast/cumulative_uplift.py` — FOUND
- `tests/forecast/test_cumulative_uplift.py` — FOUND

File modified exists with expected change:
- `tests/forecast/test_offweek_reminder.py` — FOUND, 0 `@pytest.mark.skip` decorators remaining

Commits exist on this worktree branch:
- `716b5c6` test(16-06): RED — bootstrap CI math + per-window contract — FOUND
- `071ecca` feat(16-06): GREEN — cumulative_uplift.py bootstrap CI math — FOUND
- `21a3f0e` refactor(16-06): un-skip offweek_reminder tests — FOUND
- `ca51040` test(16-06): per-day rolling cumulative rows for D-11 sparkline — FOUND

TDD gate compliance:
- RED gate: `test(16-06): RED ...` commit exists (716b5c6) before any feat
- GREEN gate: `feat(16-06): GREEN ...` commit exists (071ecca) after RED
- REFACTOR gate: `refactor(16-06): ...` commit exists (21a3f0e) after GREEN
- Task 4: structured as `test(...)` commit only (impl bundled in Task 2 — documented in Deviations)

Next steps (handed off to Wave 2 sibling/successor plans):
- **Plan 07** owns `campaign_uplift` backing table + `campaign_uplift_v` view with PK `(restaurant_id, campaign_id, model_name, window_kind, as_of_date)`. Until that lands, `main_uplift` upserts will fail at the table-not-found error and the cumulative_uplift step in `forecast-refresh.yml` will write a `pipeline_runs` failure row — the orchestrator does not block downstream cards.
- **Plan 09** (CampaignUpliftCard) will render the per-day rows produced here as a LayerChart Spline + Area sparkline (D-11 shape-of-uplift).
- **Plan 13** (forecast-refresh.yml) will add `python -m scripts.forecast.cumulative_uplift` after the BAU+CF run_all step, BEFORE the MV refresh step.
