---
phase: 17-backtest-gate-quality-monitoring
plan: "06"
subsystem: forecast-pipeline
tags: [python, run_all, feature-flags, model-skip-logic, db-read, backtest-gate]
dependency_graph:
  requires: [17-01]
  provides: [feature-flags-aware-model-selection]
  affects: [scripts/forecast/run_all.py]
tech_stack:
  added: []
  patterns: [AND-intersect-db-env, graceful-db-fallback, bare-name-extraction]
key_files:
  created:
    - scripts/forecast/tests/test_run_all_feature_flags.py
  modified:
    - scripts/forecast/run_all.py
decisions:
  - "Graceful try/except fallback to env_set when DB read fails — nightly cron never blocked on transient DB issues"
  - "DEFAULT_MODELS extended to include naive_dow_with_holidays (BCK-03 baseline now runs nightly)"
  - "models list sorted after AND-intersect for deterministic subprocess spawn order"
metrics:
  duration: "~12 min"
  completed: "2026-05-06"
  tasks: 2
  files: 2
---

# Phase 17 Plan 06: Feature Flags — run_all.py Model Skip Logic Summary

**One-liner:** AND-intersect of env var allowlist and feature_flags.enabled=true DB rows gates which models run_all.py spawns each nightly cron cycle.

## What Was Built

### Task 1: `_get_enabled_models` helper + AND-intersect at `__main__` + DEFAULT_MODELS extension

**Commit:** `ee47a95`

Added `_get_enabled_models(client, restaurant_id)` helper to `scripts/forecast/run_all.py` immediately after the existing `_get_restaurant_id` helper. Single bulk query to `feature_flags WHERE flag_key LIKE 'model_%'`; returns bare model names (e.g. `['sarimax', 'naive_dow']`, no `model_` prefix) for enabled rows.

Wired AND-intersect logic at the model-resolution call site in `main()`:

```python
env_set = {m.strip() for m in env_models.split(',') if m.strip()}
try:
    db_set = set(_get_enabled_models(client, restaurant_id))
except Exception as e:
    # graceful fallback — never block nightly cron on DB read failure
    db_set = env_set
models = sorted(env_set & db_set)
if not models:
    print('[run_all] WARN: env_set ∩ feature_flags is empty — no models will run', ...)
```

Extended `DEFAULT_MODELS` to include `naive_dow_with_holidays` (BCK-03 baseline added in plan 17-03).

### Task 2: Tests for AND-intersect + WARN behavior + graceful fallback

**Commit:** `de60f70`

Created `scripts/forecast/tests/test_run_all_feature_flags.py` with 6 tests:

| Test | What it verifies |
|------|-----------------|
| `test_returns_bare_names_for_enabled` | Enabled rows return bare names; disabled row excluded |
| `test_empty_when_no_rows` | No rows in feature_flags -> empty list |
| `test_excludes_all_disabled` | All rows disabled -> empty list |
| `test_query_uses_like_filter` | `.like('flag_key', 'model_%')` in chain (T-17-04d) |
| `test_query_uses_restaurant_id_filter` | `.eq('restaurant_id', ...)` in chain (T-17-04e) |
| `test_data_none_returns_empty` | resp.data=None handled gracefully |

## Verification

### `git diff scripts/forecast/run_all.py`

```diff
-DEFAULT_MODELS = 'sarimax,prophet,ets,theta,naive_dow'
+DEFAULT_MODELS = 'sarimax,prophet,ets,theta,naive_dow,naive_dow_with_holidays'

 def _get_restaurant_id(client) -> str:
     ...

+def _get_enabled_models(client, restaurant_id: str) -> list[str]:
+    """Phase 17 BCK-04: read enabled-model rows from feature_flags.
+    ...
+    """
+    resp = (
+        client.table('feature_flags')
+        .select('flag_key,enabled')
+        .eq('restaurant_id', restaurant_id)
+        .like('flag_key', 'model_%')
+        .execute()
+    )
+    return [
+        row['flag_key'].removeprefix('model_')
+        for row in (resp.data or [])
+        if row.get('enabled') is True
+    ]

-        models = [m.strip() for m in env_models.split(',') if m.strip()]
+        env_set = {m.strip() for m in env_models.split(',') if m.strip()}
+        try:
+            db_set = set(_get_enabled_models(client, restaurant_id))
+        except Exception as e:
+            print(... 'falling back to env_set only', file=sys.stderr)
+            db_set = env_set
+        models = sorted(env_set & db_set)
+        if not models:
+            print('[run_all] WARN: env_set ∩ feature_flags is empty ...', ...)
```

**Diff stats:** 1 file, 39 insertions(+), 2 deletions(-)
(The 2 deletions are the modified DEFAULT_MODELS line and the replaced models= line — no functional code was deleted.)

### pytest output

```
============================= test session starts ==============================
platform darwin -- Python 3.13.7
collected 6 items

scripts/forecast/tests/test_run_all_feature_flags.py::test_returns_bare_names_for_enabled PASSED
scripts/forecast/tests/test_run_all_feature_flags.py::test_empty_when_no_rows PASSED
scripts/forecast/tests/test_run_all_feature_flags.py::test_excludes_all_disabled PASSED
scripts/forecast/tests/test_run_all_feature_flags.py::test_query_uses_like_filter PASSED
scripts/forecast/tests/test_run_all_feature_flags.py::test_query_uses_restaurant_id_filter PASSED
scripts/forecast/tests/test_run_all_feature_flags.py::test_data_none_returns_empty PASSED

============================== 6 passed in 0.02s ===============================
```

### Phase 14 Invariant Verification

Simulation: all 6 `feature_flags` rows `enabled=true` (post migration 0067 seed from plan 17-01), env var unset.

- `env_models` = DEFAULT_MODELS = `'sarimax,prophet,ets,theta,naive_dow,naive_dow_with_holidays'`
- `env_set` = `{'sarimax', 'prophet', 'ets', 'theta', 'naive_dow', 'naive_dow_with_holidays'}`
- `db_set` = `{'sarimax', 'prophet', 'ets', 'theta', 'naive_dow', 'naive_dow_with_holidays'}` (all enabled)
- `env_set & db_set` = same 6 elements
- Result: sorted 6-model list, identical to Phase 14 BAU behavior (plus `naive_dow_with_holidays` which is a net-additive change from BCK-03)

**Phase 14 invariant: PRESERVED.** The AND-intersect does not remove any models when all rows are enabled.

### DEFAULT_MODELS extension decision

`DEFAULT_MODELS` previously had 5 models and did NOT include `naive_dow_with_holidays`. This plan added it as the 6th entry (BCK-03 requirement: the regressor-aware baseline must also run nightly so its forecasts are available for last-7-day evaluation).

## Decisions Made

1. **Graceful fallback on DB read failure:** `try/except` around `_get_enabled_models` falls back to `env_set` (all env-listed models run). Acceptable trade-off: gate veto temporarily ineffective until DB recovers; nightly cron never broken by transient network issues.
2. **`sorted()` on intersect:** Deterministic subprocess spawn order regardless of set iteration order.
3. **No change to `--models` CLI flag behavior:** When `--models` is explicitly passed, the AND-intersect is bypassed (models come from CLI, not env var). This preserves manual override capability for one-off runs.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all logic is wired; the `_get_enabled_models` function issues a real DB query at runtime.

## Threat Flags

None — the two threat model items (T-17-04d, T-17-04e) are mitigated by the `.like()` and `.eq()` filters as specified, with tests pinning both.

## Self-Check: PASSED

- `scripts/forecast/run_all.py` exists and has `_get_enabled_models`: FOUND
- `scripts/forecast/tests/test_run_all_feature_flags.py` exists: FOUND
- Commit `ee47a95`: FOUND
- Commit `de60f70`: FOUND
- 6 tests pass: VERIFIED
