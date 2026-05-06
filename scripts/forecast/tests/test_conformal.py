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
