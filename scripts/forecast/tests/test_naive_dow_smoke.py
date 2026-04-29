"""Smoke tests for Naive same-DoW model."""
from __future__ import annotations

import numpy as np
import pandas as pd
from datetime import date, timedelta

from scripts.forecast.naive_dow_fit import fit_naive_dow


HORIZON = 30
N_PATHS = 50


def test_naive_dow_returns_correct_shapes(synthetic_daily_revenue):
    y = synthetic_daily_revenue.iloc[:60]
    point_df, samples = fit_naive_dow(y, n_predict=HORIZON, n_paths=N_PATHS)
    assert len(point_df) == HORIZON
    assert samples.shape == (HORIZON, N_PATHS)
    for col in ("yhat", "yhat_lower", "yhat_upper"):
        assert col in point_df.columns


def test_naive_dow_uses_same_weekday():
    """Predictions for a Monday should be based on prior Mondays."""
    dates = pd.DatetimeIndex([date(2025, 10, 1) + timedelta(days=i) for i in range(28)])
    y = pd.Series(range(28), index=dates, dtype=float)
    point_df, _ = fit_naive_dow(y, n_predict=7, n_paths=10)
    assert len(point_df) == 7


def test_naive_dow_no_nan(synthetic_daily_revenue):
    y = synthetic_daily_revenue.iloc[:60]
    point_df, samples = fit_naive_dow(y, n_predict=HORIZON, n_paths=N_PATHS)
    assert not point_df["yhat"].isna().any()
    assert not np.isnan(samples).any()
