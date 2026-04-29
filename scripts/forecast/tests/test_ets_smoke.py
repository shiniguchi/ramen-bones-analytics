"""Smoke tests for ETS fit module (Task 13a).

Verifies shape contracts and numeric output from statsmodels ETS.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from scripts.forecast.ets_fit import fit_ets


# -- constants --

HORIZON = 30
N_PATHS = 50  # keep low for speed


# -- tests --


def test_ets_returns_correct_shapes(synthetic_daily_revenue):
    """Fit 60-day synthetic series, predict 30.
    point_df has 30 rows; samples shape is (30, n_paths)."""
    y = synthetic_daily_revenue.iloc[:60]

    point_df, samples = fit_ets(y, n_predict=HORIZON, n_paths=N_PATHS)

    # point_df row count and required columns
    assert len(point_df) == HORIZON
    for col in ("yhat", "yhat_lower", "yhat_upper"):
        assert col in point_df.columns, f"Missing column: {col}"

    # samples shape is (horizon, n_paths)
    assert samples.shape == (HORIZON, N_PATHS)


def test_ets_point_forecast_is_numeric(synthetic_daily_revenue):
    """Verify yhat dtype is float with no NaN values."""
    y = synthetic_daily_revenue.iloc[:60]

    point_df, _ = fit_ets(y, n_predict=HORIZON, n_paths=N_PATHS)

    assert np.issubdtype(point_df["yhat"].dtype, np.floating)
    assert not point_df["yhat"].isna().any(), "yhat contains NaN"


def test_ets_samples_no_nan(synthetic_daily_revenue):
    """Sample paths must not contain NaN."""
    y = synthetic_daily_revenue.iloc[:60]

    _, samples = fit_ets(y, n_predict=HORIZON, n_paths=N_PATHS)

    assert not np.isnan(samples).any(), "Samples contain NaN"
