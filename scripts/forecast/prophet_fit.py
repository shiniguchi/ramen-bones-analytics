"""Prophet model fit with yearly_seasonality pinned False and NaN guard.

C-04: yearly_seasonality=False always — we have < 365 days of data,
and restaurant revenue doesn't follow a yearly cycle within our horizon.
"""
from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd
from prophet import Prophet

# suppress Prophet's verbose stdout
logging.getLogger("prophet").setLevel(logging.WARNING)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

# 9 model regressor columns (same contract as exog_builder.EXOG_COLUMNS)
REGRESSOR_COLS: list[str] = [
    "temp_mean_c",
    "precip_mm",
    "wind_max_kmh",
    "sunshine_hours",
    "is_holiday",
    "is_school_holiday",
    "has_event",
    "is_strike",
    "is_open",
]


def fit_prophet(
    history: pd.DataFrame,
    future: pd.DataFrame,
    n_samples: int = 200,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit Prophet and return point forecast + sample paths.

    Parameters
    ----------
    history : pd.DataFrame
        Must have columns: ds, y, + REGRESSOR_COLS.
    future : pd.DataFrame
        Must have columns: ds + REGRESSOR_COLS. NO NaN allowed in regressors.
    n_samples : int
        Number of posterior predictive samples for uncertainty.

    Returns
    -------
    point_df : pd.DataFrame
        Columns: ds, yhat, yhat_lower, yhat_upper. Rows = future dates only.
    samples : np.ndarray
        Shape (horizon, n_samples). Posterior predictive samples.

    Raises
    ------
    ValueError
        If future regressors contain NaN values.
    """
    # -- guard: NaN in future regressors --
    for col in REGRESSOR_COLS:
        if col in future.columns and future[col].isna().any():
            nan_count = future[col].isna().sum()
            raise ValueError(
                f"NaN in future regressor '{col}' ({nan_count} values). "
                f"Prophet cannot handle NaN in prediction regressors."
            )

    # -- C-04: yearly_seasonality=False always --
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore")

        m = Prophet(
            yearly_seasonality=False,
            weekly_seasonality=True,
            daily_seasonality=False,
            uncertainty_samples=n_samples,
        )

        # add all regressor columns
        for col in REGRESSOR_COLS:
            m.add_regressor(col)

        # fit on history
        m.fit(history)

        # build full dataframe for predict (history + future)
        future_full = pd.concat(
            [history[["ds"] + REGRESSOR_COLS], future[["ds"] + REGRESSOR_COLS]],
            ignore_index=True,
        )

        # point forecast
        forecast = m.predict(future_full)

    # slice to future-only rows
    n_future = len(future)
    forecast_future = forecast.iloc[-n_future:].reset_index(drop=True)

    point_df = forecast_future[["ds", "yhat", "yhat_lower", "yhat_upper"]].copy()

    # -- posterior predictive samples --
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore")
        sample_df = m.predictive_samples(future_full)

    # sample_df["yhat"] is (n_total, n_samples) — slice to future rows
    yhat_samples = sample_df["yhat"][-n_future:]
    samples = np.asarray(yhat_samples, dtype=np.float64)

    return point_df, samples
