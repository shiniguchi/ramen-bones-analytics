---
phase: 17-backtest-gate-quality-monitoring
plan: "02"
subsystem: python-forecast
tags: [python, statistics, conformal, pure-helper, tdd, bcк-02]
dependency_graph:
  requires: []
  provides: [scripts/forecast/conformal.py::calibrate_conformal_h35]
  affects: [scripts/forecast/backtest.py (Wave 2 plan 17-05 imports this)]
tech_stack:
  added: []
  patterns: [split-conformal absolute-residual quantile, TDD RED-GREEN]
key_files:
  created:
    - scripts/forecast/conformal.py
    - scripts/forecast/tests/test_conformal.py
  modified: []
decisions:
  - "D-03 lock enforced: statsforecast.cross_validation not used as loop driver; conformal math implemented manually as 30-LOC pure function"
  - "Option 1 (manual quantile) chosen over Option 2 (ConformalIntervals private methods) for API stability across statsforecast 1.7"
  - "Cold-start handled via nan return — backtest.py (17-05) must check for nan and write PENDING verdict"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-06"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 17 Plan 02: Conformal CI Calibration Helper Summary

**One-liner:** Pure-function conformal CI calibration using split-conformal absolute-residual quantile math (BCK-02, no statsforecast harness dependency).

## What Was Built

`calibrate_conformal_h35(fold_residuals, alpha=0.05) -> dict` — a 30-LOC pure Python function that pools absolute residuals from rolling-origin CV folds and returns the (1-alpha) empirical quantile as `qhat_h35`. Five unit tests cover known residuals, empty cold-start, alpha sensitivity, and sign handling.

## TDD Gate Compliance

- RED: `test(17-02): add failing tests for calibrate_conformal_h35` — commit `375c995`
- GREEN: `feat(17-02): implement calibrate_conformal_h35 per BCK-02` — commit `4bdbdfc`
- REFACTOR: not needed (implementation was clean on first pass)

## Implementation

### scripts/forecast/conformal.py

```python
"""Phase 17 BCK-02: conformal CI calibration at h=35.

Per Vovk/Shafer split-conformal (Option 1 from RESEARCH §ConformalIntervals
Integration): collect absolute residuals from prior folds at the matching
horizon-step h, take the (1-alpha) empirical quantile, add to the point
forecast for the (lower, upper) CI band.

D-03 lock: statsforecast.cross_validation is NOT used as the loop driver.
backtest.py (Wave 2) owns the rolling-origin loop; this module owns
calibration math only. Pure function — no DB, no I/O, deterministic.
"""
from __future__ import annotations

import numpy as np


def calibrate_conformal_h35(
    fold_residuals: dict[int, np.ndarray],
    alpha: float = 0.05,
) -> dict:
    """Return {'qhat_h35': float} — the conformal quantile to add ± to the point forecast.

    Args:
        fold_residuals: {fold_idx: signed_residuals_at_h35} — backtest.py collects
            one residual array per fold (typically size N_FOLDS=4 per BCK-01/D-02).
        alpha: 1 - desired CI coverage. Default 0.05 (95% CI per BCK-02 spec).

    Returns:
        {'qhat_h35': float}. Returns nan if no residuals are available
        (cold-start case — backtest.py should write PENDING verdict instead).
    """
    # Cold-start: no folds available yet
    if not fold_residuals:
        return {'qhat_h35': float('nan')}

    # Pool all signed residuals across folds into one flat array
    arrays = [np.asarray(r, dtype=float) for r in fold_residuals.values()]
    all_residuals = np.concatenate(arrays) if arrays else np.array([], dtype=float)

    # No residuals to compute quantile over
    if all_residuals.size == 0:
        return {'qhat_h35': float('nan')}

    # Symmetric conformal: take absolute value, then empirical (1-alpha) quantile
    qhat = float(np.quantile(np.abs(all_residuals), 1 - alpha))
    return {'qhat_h35': qhat}
```

### scripts/forecast/tests/test_conformal.py

```python
"""Phase 17 BCK-02: tests for conformal CI calibration at h=35.

Pure-function tests — no DB access required. Mirrors the shape of
test_eval.py:test_rmse_known_values for grep traceability.

Per RESEARCH §ConformalIntervals Integration Option 1, the manual
absolute-residual quantile math replaces statsforecast.ConformalIntervals
as the loop driver (D-03 lock). This test asserts the math is correct.
"""
from __future__ import annotations

import math
import numpy as np
import pytest

from scripts.forecast.conformal import calibrate_conformal_h35


def test_qhat_h35_known_residuals():
    """Pooled |residuals| 95th percentile matches np.quantile."""
    fold_residuals = {
        0: np.array([10.0, -10.0]),
        1: np.array([5.0, -5.0]),
        2: np.array([20.0, -20.0]),
        3: np.array([15.0, -15.0]),
    }
    out = calibrate_conformal_h35(fold_residuals, alpha=0.05)
    expected_qhat = float(np.quantile(np.abs([10, 10, 5, 5, 20, 20, 15, 15]), 0.95))
    assert abs(out['qhat_h35'] - expected_qhat) < 1e-6


def test_empty_residuals_returns_nan():
    """Empty dict -> nan (graceful cold-start)."""
    out = calibrate_conformal_h35({}, alpha=0.05)
    assert math.isnan(out['qhat_h35'])


def test_all_empty_arrays_returns_nan():
    """Dict with empty arrays -> nan (no residuals to quantile over)."""
    out = calibrate_conformal_h35({0: np.array([])}, alpha=0.05)
    assert math.isnan(out['qhat_h35'])


def test_alpha_parameter_changes_quantile():
    """alpha=0.10 -> 90th percentile (smaller than 95th)."""
    residuals = np.array([float(i) for i in range(1, 101)])  # 1..100
    fold_residuals = {0: residuals}
    out_05 = calibrate_conformal_h35(fold_residuals, alpha=0.05)
    out_10 = calibrate_conformal_h35(fold_residuals, alpha=0.10)
    assert out_10['qhat_h35'] < out_05['qhat_h35']


def test_negative_residuals_taken_absolute():
    """np.abs MUST be applied — negatives don't bias quantile downward."""
    fold_residuals = {0: np.array([-100.0, -50.0, -10.0, 10.0, 50.0, 100.0])}
    out = calibrate_conformal_h35(fold_residuals, alpha=0.05)
    expected = float(np.quantile([100, 50, 10, 10, 50, 100], 0.95))
    assert abs(out['qhat_h35'] - expected) < 1e-6
```

## pytest Output

```
============================= test session starts ==============================
platform darwin -- Python 3.8.5, pytest-6.1.1, py-1.9.0, pluggy-0.13.1
rootdir: /Users/shiniguchi/development/ramen-bones-analytics/.claude/worktrees/agent-a3112f4cbc54cd029
collecting ... collected 5 items

scripts/forecast/tests/test_conformal.py::test_qhat_h35_known_residuals PASSED [ 20%]
scripts/forecast/tests/test_conformal.py::test_empty_residuals_returns_nan PASSED [ 40%]
scripts/forecast/tests/test_conformal.py::test_all_empty_arrays_returns_nan PASSED [ 60%]
scripts/forecast/tests/test_conformal.py::test_alpha_parameter_changes_quantile PASSED [ 80%]
scripts/forecast/tests/test_conformal.py::test_negative_residuals_taken_absolute PASSED [100%]

============================== 5 passed in 0.01s ===============================
```

## Commits

- `375c995` — `test(17-02): add failing tests for calibrate_conformal_h35` (RED)
- `4bdbdfc` — `feat(17-02): implement calibrate_conformal_h35 per BCK-02` (GREEN)

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None. Pure function with no I/O surface — no new network endpoints, auth paths, file access, or schema changes.

## Self-Check: PASSED

- `scripts/forecast/conformal.py` — FOUND
- `scripts/forecast/tests/test_conformal.py` — FOUND
- commit `375c995` (RED) — FOUND in git log
- commit `4bdbdfc` (GREEN) — FOUND in git log
- 5 tests passing — VERIFIED
- No forbidden imports (supabase/requests/httpx/subprocess/os.environ) — VERIFIED
