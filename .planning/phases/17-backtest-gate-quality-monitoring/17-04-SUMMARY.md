---
phase: 17-backtest-gate-quality-monitoring
plan: "04"
subsystem: scripts/forecast
tags: [python, argparse, cli, forecasting, retrofit, backtest]
dependency_graph:
  requires: []
  provides: [argparse CLI flags on all 5 fit scripts, FORECAST_TRACK env-var wiring]
  affects: [scripts/forecast/backtest.py (plan 17-05 — subprocess fold driver)]
tech_stack:
  added: []
  patterns:
    - argparse block at top of __main__ before env-var reads (argparse-first ordering)
    - FORECAST_TRACK env var for forecast_daily scope isolation per fold
key_files:
  created:
    - scripts/forecast/tests/test_fit_scripts_argparse.py
  modified:
    - scripts/forecast/sarimax_fit.py
    - scripts/forecast/prophet_fit.py
    - scripts/forecast/ets_fit.py
    - scripts/forecast/theta_fit.py
    - scripts/forecast/naive_dow_fit.py
decisions:
  - All 5 scripts use _parser/_args prefix to avoid shadowing; consistent across all retrofits
  - argparse placed BEFORE env-var reads in __main__ so --help exits 0 without RESTAURANT_ID/KPI_NAME/RUN_DATE set
  - FORECAST_TRACK env var defaulting to 'bau' preserves Phase 14 BAU pipeline behavior identically
  - train_end_override=None when --train-end omitted preserves existing compute-inside-fit_and_write behavior
metrics:
  duration: ~8 minutes
  completed: "2026-05-06"
  tasks_completed: 2
  files_modified: 5
  files_created: 1
---

# Phase 17 Plan 04: Fit Scripts argparse Retrofit Summary

Retrofit argparse onto all 5 fit scripts (sarimax, prophet, ets, theta, naive_dow) so backtest.py (plan 17-05) can subprocess-spawn each one with `--train-end`, `--eval-start`, `--fold-index` per fold. Also adds `FORECAST_TRACK` env var read (Issue 1) so per-fold writes scope-isolate to non-BAU track values in `forecast_daily`.

## Commits

| Hash | Description |
|------|-------------|
| `0b4716d` | feat(17-04): argparse retrofit on sarimax_fit |
| `aab99f5` | feat(17-04): argparse retrofit on prophet_fit |
| `e63d6f1` | feat(17-04): argparse retrofit on ets_fit |
| `fa7e69d` | feat(17-04): argparse retrofit on theta_fit |
| `02c0e8a` | feat(17-04): argparse retrofit on naive_dow_fit |
| `a830b12` | test(17-04): integration tests for argparse retrofit on all 5 fit scripts |

## A3 Pre-flight Verification

All 5 scripts already had `train_end: Optional[date] = None` in their `fit_and_write` signatures (Phase 16 CF era). No A3 fallback needed — no kwarg additions were required.

```
scripts/forecast/sarimax_fit.py:def fit_and_write(
scripts/forecast/sarimax_fit.py:    train_end: Optional[date] = None,
scripts/forecast/prophet_fit.py:def fit_and_write(
scripts/forecast/prophet_fit.py:    train_end: Optional[date] = None,
scripts/forecast/theta_fit.py:def fit_and_write(
scripts/forecast/theta_fit.py:    train_end: Optional[date] = None,
scripts/forecast/ets_fit.py:def fit_and_write(
scripts/forecast/ets_fit.py:    train_end: Optional[date] = None,
scripts/forecast/naive_dow_fit.py:def fit_and_write(
scripts/forecast/naive_dow_fit.py:    train_end: Optional[date] = None,
```

## Diff Stats

```
scripts/forecast/ets_fit.py       | 23 ++++++++++++++++++++++-
scripts/forecast/naive_dow_fit.py | 22 ++++++++++++++++++++++
scripts/forecast/prophet_fit.py   | 23 ++++++++++++++++++++++-
scripts/forecast/sarimax_fit.py   | 23 ++++++++++++++++++++++-
scripts/forecast/theta_fit.py     | 22 ++++++++++++++++++++++
5 files changed, 110 insertions(+), 3 deletions(-)
```

The 3 deletions are the `# Read env vars` comment lines replaced with `# Read env vars (UNCHANGED from Phase 14 BAU behavior)` — no semantic changes.

## Argparse Block Applied (same shape on all 5 scripts)

```python
if __name__ == '__main__':
    # Phase 17 BCK-01 — argparse retrofit so backtest.py can subprocess us per fold.
    # argparse runs FIRST (before env-var reads) so --help works without env vars set.
    import argparse
    _parser = argparse.ArgumentParser(description='Phase 14/17 {model}_fit script')
    _parser.add_argument('--train-end', type=str, default=None,
        help='YYYY-MM-DD. Override default train_end_for_grain. Used by backtest.py per fold.')
    _parser.add_argument('--eval-start', type=str, default=None,
        help='YYYY-MM-DD. First date of evaluation window (recorded only).')
    _parser.add_argument('--fold-index', type=int, default=None,
        help='0-indexed fold number. Optional.')
    _args = _parser.parse_args()

    # Read env vars (UNCHANGED from Phase 14 BAU behavior)
    ...

    train_end_override = date.fromisoformat(_args.train_end) if _args.train_end else None
    # Issue 1: FORECAST_TRACK env-var override for backtest fold scope-isolation.
    track = os.environ.get('FORECAST_TRACK', 'bau').strip() or 'bau'

    ...
    n = fit_and_write(
        client,
        ...,
        track=track,                   # Issue 1: FORECAST_TRACK env var
        train_end=train_end_override,  # Phase 17 BCK-01
    )
```

## Test Results

```
============================= 15 passed in 15.99s ==============================
```

All 15 parametrized tests pass (3 tests × 5 scripts):
- `test_help_exits_zero` — --help exits 0 without env vars
- `test_help_lists_all_three_flags` — --help output includes all 3 flags
- `test_argparse_runs_before_env_var_validation` — argparse first, then env-var check fails

## Deviations from Plan

None — plan executed exactly as written.

- A3 pre-flight: all 5 scripts already had `train_end: Optional[date] = None` — no fallback add needed.
- The 5 commits are individual per-script commits as specified.
- The 3 "deletions" in diff are comment-only changes (`# Read env vars` → more descriptive variant).

## Known Stubs

None.

## Threat Flags

None. Changes are purely additive argparse CLI flags in `__main__` blocks. No new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- [x] `scripts/forecast/tests/test_fit_scripts_argparse.py` exists and is committed (`a830b12`)
- [x] All 5 fit scripts modified and individually committed
- [x] 15 tests pass
- [x] `grep -c "train_end=train_end_override" ...` returns 1 for all 5 scripts
- [x] `grep -l "FORECAST_TRACK" ...` returns 5 files
- [x] No modifications to STATE.md or ROADMAP.md
