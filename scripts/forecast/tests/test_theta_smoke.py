"""Smoke tests for Theta fit module (Task 13b).

Verifies shape contracts and numeric output from statsforecast Theta.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from scripts.forecast.theta_fit import fit_theta


# -- constants --

HORIZON = 30
N_PATHS = 50  # keep low for speed


# -- tests --


def test_theta_returns_correct_shapes(synthetic_daily_revenue):
    """Fit 60-day synthetic series, predict 30.
    point_df has 30 rows; samples shape is (30, n_paths)."""
    y = synthetic_daily_revenue.iloc[:60]

    point_df, samples = fit_theta(y, n_predict=HORIZON, n_paths=N_PATHS, seed=42)

    # point_df row count and required columns
    assert len(point_df) == HORIZON
    for col in ("yhat", "yhat_lower", "yhat_upper"):
        assert col in point_df.columns, f"Missing column: {col}"

    # samples shape is (horizon, n_paths)
    assert samples.shape == (HORIZON, N_PATHS)


def test_theta_point_forecast_is_numeric(synthetic_daily_revenue):
    """Verify yhat dtype is float with no NaN values."""
    y = synthetic_daily_revenue.iloc[:60]

    point_df, _ = fit_theta(y, n_predict=HORIZON, n_paths=N_PATHS, seed=42)

    assert np.issubdtype(point_df["yhat"].dtype, np.floating)
    assert not point_df["yhat"].isna().any(), "yhat contains NaN"


def test_theta_samples_no_nan(synthetic_daily_revenue):
    """Sample paths must not contain NaN."""
    y = synthetic_daily_revenue.iloc[:60]

    _, samples = fit_theta(y, n_predict=HORIZON, n_paths=N_PATHS, seed=42)

    assert not np.isnan(samples).any(), "Samples contain NaN"


def test_theta_deterministic_with_seed(synthetic_daily_revenue):
    """Same seed produces identical sample paths."""
    y = synthetic_daily_revenue.iloc[:60]

    _, samples_a = fit_theta(y, n_predict=HORIZON, n_paths=N_PATHS, seed=99)
    _, samples_b = fit_theta(y, n_predict=HORIZON, n_paths=N_PATHS, seed=99)

    np.testing.assert_array_equal(samples_a, samples_b)
