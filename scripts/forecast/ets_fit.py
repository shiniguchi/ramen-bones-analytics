"""ETS model fit with simulate() sample paths.

Non-exog model: takes a clean open-day-only pandas Series and predicts N steps.
Uses statsmodels ETSModel with additive error/trend/seasonal (period=7).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from statsmodels.tsa.exponential_smoothing.ets import ETSModel


def fit_ets(
    y: pd.Series,
    n_predict: int = 365,
    n_paths: int = 200,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Fit ETS(A,A,A) with weekly seasonality, simulate() for sample paths.

    Parameters
    ----------
    y : pd.Series
        Target time series (daily, open-days only), DatetimeIndex.
    n_predict : int
        Number of future steps to forecast.
    n_paths : int
        Number of simulation paths for uncertainty quantification.

    Returns
    -------
    point_df : pd.DataFrame
        Columns: yhat, yhat_lower, yhat_upper. Index = forecast dates.
    samples : np.ndarray
        Shape (n_predict, n_paths). Simulated future paths.
    """
    # -- fit ETS(A,A,A) with weekly seasonality --
    model = ETSModel(
        y,
        error="add",
        trend="add",
        seasonal="add",
        seasonal_periods=7,
    )
    result = model.fit(disp=False, maxiter=200)

    # -- point forecast via get_prediction --
    pred = result.get_prediction(
        start=len(y),
        end=len(y) + n_predict - 1,
    )
    yhat = pred.predicted_mean.values
    ci = pred.summary_frame(alpha=0.05)
    yhat_lower = ci["pi_lower"].values
    yhat_upper = ci["pi_upper"].values

    # -- sample paths via simulate --
    samples = result.simulate(
        nsimulations=n_predict,
        repetitions=n_paths,
        anchor="end",
    )
    samples = np.asarray(samples, dtype=np.float64)
    # ensure shape is (n_predict, n_paths)
    if samples.ndim == 3:
        samples = samples.squeeze(axis=1)

    # -- build forecast date index --
    last_date = y.index[-1]
    forecast_dates = pd.date_range(
        start=last_date + pd.Timedelta(days=1),
        periods=n_predict,
        freq="D",
    )

    point_df = pd.DataFrame(
        {"yhat": yhat, "yhat_lower": yhat_lower, "yhat_upper": yhat_upper},
        index=forecast_dates,
    )

    return point_df, samples
