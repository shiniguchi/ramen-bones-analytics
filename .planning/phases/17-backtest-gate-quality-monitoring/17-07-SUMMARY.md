---
phase: 17-backtest-gate-quality-monitoring
plan: "07"
subsystem: forecast-pipeline
tags: [github-actions, cron, accuracy-log, markdown, commit-back, GITHUB_TOKEN, BCK-05, BCK-07]
dependency_graph:
  requires: ["17-05"]
  provides: ["forecast-backtest.yml cron", "ACCURACY-LOG.md auto-generation", "BCK-07 commit-back"]
  affects: ["docs/forecast/ACCURACY-LOG.md", ".github/workflows/forecast-backtest.yml"]
tech_stack:
  added: []
  patterns: ["GHA cron + workflow_dispatch dual trigger", "commit-back with [skip ci]", "append-only Markdown log", "TDD red-green for both tasks"]
key_files:
  created:
    - .github/workflows/forecast-backtest.yml
    - scripts/forecast/write_accuracy_log.py
    - docs/forecast/ACCURACY-LOG.md
    - scripts/forecast/tests/test_accuracy_log.py
    - scripts/forecast/tests/test_workflow_yaml.py
  modified: []
decisions:
  - "HONEST_FAILURE_NO_CHALLENGER uses exact em-dash (U+2014) as BCK-07 canonical string"
  - "test_render_orders_baselines_first checks table section only (not honest-failure line) to avoid false positive on challenger model name appearing in promotion copy"
  - "restaurant_id resolved via client.table('restaurants').select('id').limit(1) — v1 single-tenant path"
  - "qhat surface as 0.0 placeholder; Phase 17 backtest writes conformal coverage indirectly; future enhancement when backtest.py exposes qhat column"
metrics:
  duration: "4m"
  completed_date: "2026-05-06"
  tasks_completed: 2
  files_created: 5
---

# Phase 17 Plan 07: Weekly ACCURACY-LOG Cron + Commit-Back Summary

Weekly cron workflow (`forecast-backtest.yml`) with `contents: write` permission fires Tuesday 23:00 UTC, runs `backtest.py`, renders `ACCURACY-LOG.md` via `write_accuracy_log.py`, and commits the result to main with `[skip ci]` to prevent recursive GHA triggers (BCK-05 + BCK-07).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ACCURACY-LOG skeleton + write_accuracy_log.py + tests | d75fdde | docs/forecast/ACCURACY-LOG.md, scripts/forecast/write_accuracy_log.py, scripts/forecast/tests/test_accuracy_log.py |
| 2 | forecast-backtest.yml workflow + YAML parsing tests | 876cc3b | .github/workflows/forecast-backtest.yml, scripts/forecast/tests/test_workflow_yaml.py |

## Artifacts

### `.github/workflows/forecast-backtest.yml`

```yaml
name: Forecast Backtest (Phase 17 BCK-05)
on:
  schedule:
    - cron: '0 23 * * 2'   # Tuesday 23:00 UTC
  workflow_dispatch:
    inputs:
      models:
        description: 'Comma-separated model list (omit for all enabled)'
        required: false
        default: ''

permissions:
  contents: write   # D-07: sole write-permitted forecast workflow

concurrency:
  group: forecast-backtest
  cancel-in-progress: false   # queue, never kill in-flight

jobs:
  backtest:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - actions/checkout@v4 (with token)
      - actions/setup-python@v5 (3.12 + pip cache + cmdstan cache)
      - Install deps
      - Run backtest (MODELS regex-validated before subprocess)
      - Generate ACCURACY-LOG.md
      - Commit ACCURACY-LOG.md with [skip ci]
```

### `scripts/forecast/write_accuracy_log.py`

Key implementation notes:
- `HONEST_FAILURE_NO_CHALLENGER = '> naive-DoW-with-holidays remains production model — no challenger promoted this week.'` — exact em-dash (BCK-07 spec)
- Append-only: prior "Latest run" moved to top of "History" on each write
- Idempotent: byte-identical output skips write (workflow `git diff --staged --quiet` short-circuits commit)
- Restaurant ID: resolved via `client.table('restaurants').select('id').limit(1)` (v1 single-tenant)
- `qhat` surface: currently `0.0` placeholder; future enhancement when `backtest.py` exposes conformal coverage column
- MVP scope: renders `revenue_eur` KPI only; `invoice_count` is future surface (filter already in `_group_for_render`)

### Initial `docs/forecast/ACCURACY-LOG.md` skeleton

```markdown
# Forecast Accuracy Log

Auto-generated weekly by `.github/workflows/forecast-backtest.yml` (Tuesday 23:00 UTC).
Do not edit by hand — the next cron run will overwrite manual edits.

**Production model:** naive_dow_with_holidays

---

## Latest run: (pending first cron)

> Phase 17 just deployed. First weekly backtest runs Tuesday 23:00 UTC after deploy.

---

## History

(empty until first weekly run)
```

## Pytest Output (final)

```
collected 16 items

test_accuracy_log.py::test_honest_failure_canonical_string PASSED
test_accuracy_log.py::test_pick_honest_failure_when_all_challengers_fail PASSED
test_accuracy_log.py::test_pick_honest_failure_when_one_challenger_passes PASSED
test_accuracy_log.py::test_group_for_render_filters_by_kpi PASSED
test_accuracy_log.py::test_render_includes_qhat_line PASSED
test_accuracy_log.py::test_render_orders_baselines_first PASSED
test_workflow_yaml.py::test_backtest_cron_tuesday_2300_utc PASSED
test_workflow_yaml.py::test_backtest_permissions_write PASSED
test_workflow_yaml.py::test_backtest_concurrency_no_cancel PASSED
test_workflow_yaml.py::test_backtest_timeout_minutes PASSED
test_workflow_yaml.py::test_backtest_models_input_validated PASSED
test_workflow_yaml.py::test_backtest_skip_ci_in_commit PASSED
test_workflow_yaml.py::test_gate_workflow_permissions_read SKIPPED (plan 17-08)
test_workflow_yaml.py::test_gate_workflow_pr_trigger SKIPPED (plan 17-08)
test_workflow_yaml.py::test_gate_workflow_cancel_on_supersede SKIPPED (plan 17-08)
test_workflow_yaml.py::test_gate_workflow_5min_timeout SKIPPED (plan 17-08)

======================== 12 passed, 4 skipped in 0.07s =========================
```

## [skip ci] Recursive-Trigger Safety Verification

The commit message in `forecast-backtest.yml` is:
```
git commit -m "docs(forecast): weekly ACCURACY-LOG update [skip ci]"
```

GitHub Actions skips workflow execution on commits whose message contains `[skip ci]` per [GHA docs](https://docs.github.com/en/actions/managing-workflow-runs/skipping-workflow-runs). This prevents `forecast-quality-gate.yml` (plan 17-08) from being triggered by the auto-commit, satisfying T-17-09 from the threat model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test_render_orders_baselines_first false positive**
- **Found during:** Task 1 GREEN phase (test run)
- **Issue:** Test checked `md.find('naive_dow')` vs `md.find('sarimax')` across the full rendered Markdown. When a challenger PASS model appears in the honest-failure line (e.g., "sarimax promoted"), `sarimax_idx` would be < `naive_idx` even though naive_dow rows were correctly rendered first in the table.
- **Fix:** Changed test to split on the table header separator and check ordering within `table_section` only.
- **Files modified:** scripts/forecast/tests/test_accuracy_log.py
- **Commit:** d75fdde

## Threat Flags

None — no new network endpoints or trust boundaries introduced. `GITHUB_TOKEN` scope and `[skip ci]` mitigations explicitly in threat model (T-17-01, T-17-02, T-17-09).

## Known Stubs

- **qhat placeholder**: `qhat = 0.0` in `write_accuracy_log.py`. The conformal CI coverage (qhat_95) is not yet extracted from `backtest.py` output into `forecast_quality` rows. Current output: `qhat_95 = 0 EUR`. Will be wired when plan 17-09 or a future plan adds a `qhat_95` column to `forecast_quality`. The skeleton shows `0` which is technically incorrect but does not prevent BCK-05/BCK-07 from shipping.

## Self-Check: PASSED

- `docs/forecast/ACCURACY-LOG.md` FOUND
- `scripts/forecast/write_accuracy_log.py` FOUND
- `scripts/forecast/tests/test_accuracy_log.py` FOUND
- `.github/workflows/forecast-backtest.yml` FOUND
- `scripts/forecast/tests/test_workflow_yaml.py` FOUND
- Commit d75fdde FOUND
- Commit 876cc3b FOUND
