"""Theta model fit + bootstrap sample paths.

Non-exog model: takes a clean open-day-only pandas Series and predicts N steps.
Uses statsforecast AutoTheta with weekly seasonality. Bootstrap from residuals
since Theta lacks native simulate().
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import AutoTheta

from .sample_paths import bootstrap_from_residuals


def fit_theta(
    y: pd.Series,
    n_predict: int = 365,
    n_paths: int = 200,
    seed: int = 42,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit Theta via statsforecast, bootstrap residuals for sample paths.

    Returns (point_df, samples) matching the ETS interface.
    """
    # statsforecast expects unique_id/ds/y DataFrame
    if isinstance(y.index, pd.DatetimeIndex):
        ds = y.index
    else:
        ds = pd.date_range("2025-01-01", periods=len(y), freq="D")

    sf_df = pd.DataFrame({"unique_id": "kpi", "ds": ds, "y": y.values.astype(float)})

    sf = StatsForecast(models=[AutoTheta(season_length=7)], freq="D")
    sf.fit(sf_df)
    forecast_df = sf.predict(h=n_predict, level=[95])

    yhat = forecast_df["AutoTheta"].values
    yhat_lower = forecast_df.get("AutoTheta-lo-95", forecast_df["AutoTheta"]).values
    yhat_upper = forecast_df.get("AutoTheta-hi-95", forecast_df["AutoTheta"]).values

    # residuals for bootstrap
    try:
        fitted_df = sf.forecast_fitted_values()
        fitted_vals = fitted_df["AutoTheta"].values
        residuals = sf_df["y"].values - fitted_vals
        residuals = residuals[~np.isnan(residuals)]
    except Exception:
        residuals = np.diff(y.values)

    samples = bootstrap_from_residuals(yhat, residuals, n_paths=n_paths, seed=seed)

    forecast_dates = pd.date_range(
        start=ds[-1] + pd.Timedelta(days=1), periods=n_predict, freq="D"
    )

    point_df = pd.DataFrame(
        {"yhat": yhat, "yhat_lower": yhat_lower, "yhat_upper": yhat_upper},
        index=forecast_dates,
    )

    return point_df, samples
