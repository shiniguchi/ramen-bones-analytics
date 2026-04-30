"""Smoke tests for SARIMAX fit module (Task 11).

Uses simpler ARIMA orders for fast convergence on small synthetic data.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from scripts.forecast.sarimax_fit import fit_sarimax


# -- helpers --

SIMPLE_ORDER = (1, 0, 0)
SIMPLE_SEASONAL = (0, 1, 1, 7)
HORIZON = 30
N_PATHS = 50  # keep low for speed


def _make_train_predict_exog(n_train: int, n_predict: int, rng=None):
    """Build aligned train/predict exog DataFrames from conftest pattern."""
    if rng is None:
        rng = np.random.default_rng(44)

    def _block(n, start_date):
        dates = pd.date_range(start=start_date, periods=n, freq="D")
        return pd.DataFrame(
            {
                "temp_mean_c": rng.normal(10, 5, n),
                "precip_mm": np.maximum(rng.normal(2, 3, n), 0),
                "wind_max_kmh": np.maximum(rng.normal(15, 8, n), 0),
                "sunshine_hours": np.maximum(rng.normal(5, 3, n), 0),
                "is_holiday": rng.choice([0, 1], n, p=[0.95, 0.05]),
                "is_school_holiday": rng.choice([0, 1], n, p=[0.85, 0.15]),
                "has_event": rng.choice([0, 1], n, p=[0.9, 0.1]),
                "is_strike": np.zeros(n, dtype=int),
                "is_open": np.ones(n, dtype=int),
                "weather_source": ["archive"] * n,
            },
            index=dates,
        )

    X_train = _block(n_train, "2025-10-01")
    predict_start = X_train.index[-1] + pd.Timedelta(days=1)
    X_predict = _block(n_predict, predict_start)
    return X_train, X_predict


# -- tests --


def test_sarimax_returns_correct_shapes(synthetic_daily_revenue):
    """Fit on 60 days, predict 30. Verify shapes and column names."""
    y = synthetic_daily_revenue.iloc[:60]
    X_train, X_predict = _make_train_predict_exog(60, HORIZON)

    point_df, samples, exog_sig = fit_sarimax(
        y,
        X_train,
        X_predict,
        n_paths=N_PATHS,
        order=SIMPLE_ORDER,
        seasonal_order=SIMPLE_SEASONAL,
    )

    # point_df has correct row count and required columns
    assert len(point_df) == HORIZON
    for col in ("yhat", "yhat_lower", "yhat_upper"):
        assert col in point_df.columns, f"Missing column: {col}"

    # samples shape is (horizon, n_paths)
    assert samples.shape == (HORIZON, N_PATHS)

    # exog_sig is a dict
    assert isinstance(exog_sig, dict)


def test_sarimax_exog_column_assertion(synthetic_daily_revenue):
    """FCS-06: dropping a column from X_predict must raise AssertionError."""
    y = synthetic_daily_revenue.iloc[:60]
    X_train, X_predict = _make_train_predict_exog(60, HORIZON)

    # Drop a column from predict to trigger exog drift guard
    X_predict_bad = X_predict.drop(columns=["precip_mm"])

    with pytest.raises(AssertionError, match="Exog drift"):
        fit_sarimax(
            y,
            X_train,
            X_predict_bad,
            n_paths=N_PATHS,
            order=SIMPLE_ORDER,
            seasonal_order=SIMPLE_SEASONAL,
        )


def test_sarimax_point_forecast_is_numeric(synthetic_daily_revenue):
    """Verify yhat dtype is float with no NaN values."""
    y = synthetic_daily_revenue.iloc[:60]
    X_train, X_predict = _make_train_predict_exog(60, HORIZON)

    point_df, _, _ = fit_sarimax(
        y,
        X_train,
        X_predict,
        n_paths=N_PATHS,
        order=SIMPLE_ORDER,
        seasonal_order=SIMPLE_SEASONAL,
    )

    assert point_df["yhat"].dtype == np.float64 or np.issubdtype(
        point_df["yhat"].dtype, np.floating
    )
    assert not point_df["yhat"].isna().any(), "yhat contains NaN"
