"""SARIMAX model fit with simulate() sample paths and exog alignment guard.

FCS-06: train and predict exog columns must be identical (minus weather_source).
Uses statsmodels SARIMAX with configurable order and seasonal_order.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX


def fit_sarimax(
    y: pd.Series,
    X_train: pd.DataFrame,
    X_predict: pd.DataFrame,
    n_paths: int = 200,
    order: tuple[int, int, int] = (1, 0, 1),
    seasonal_order: tuple[int, int, int, int] = (1, 1, 1, 7),
) -> tuple[pd.DataFrame, np.ndarray, dict]:
    """Fit SARIMAX and generate point forecast + sample paths.

    Parameters
    ----------
    y : pd.Series
        Target time series (daily revenue or counts), DatetimeIndex.
    X_train : pd.DataFrame
        Exog regressors aligned to y. May include 'weather_source' metadata.
    X_predict : pd.DataFrame
        Exog regressors for the forecast horizon. Same column contract.
    n_paths : int
        Number of simulation paths for uncertainty quantification.
    order : tuple
        ARIMA (p, d, q) order.
    seasonal_order : tuple
        Seasonal (P, D, Q, s) order.

    Returns
    -------
    point_df : pd.DataFrame
        Columns: yhat, yhat_lower, yhat_upper. Index = forecast dates.
    samples : np.ndarray
        Shape (horizon, n_paths). Simulated future paths.
    exog_sig : dict
        Weather source value_counts from X_predict (provenance metadata).
    """
    # -- drop weather_source (metadata, not a model input) --
    train_cols = [c for c in X_train.columns if c != "weather_source"]
    predict_cols = [c for c in X_predict.columns if c != "weather_source"]

    # -- FCS-06: assert column alignment --
    assert set(train_cols) == set(predict_cols), (
        f"Exog drift: train has {sorted(train_cols)}, "
        f"predict has {sorted(predict_cols)}"
    )

    X_tr = X_train[train_cols].astype(float)
    X_pr = X_predict[predict_cols].astype(float)

    # reorder predict columns to match train order
    X_pr = X_pr[X_tr.columns]

    horizon = len(X_pr)

    # -- fit SARIMAX --
    model = SARIMAX(
        y,
        exog=X_tr,
        order=order,
        seasonal_order=seasonal_order,
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    result = model.fit(disp=False, maxiter=200)

    # -- point forecast via get_forecast --
    forecast = result.get_forecast(steps=horizon, exog=X_pr.values)
    yhat = forecast.predicted_mean.values
    ci = forecast.conf_int(alpha=0.05)
    yhat_lower = ci.iloc[:, 0].values
    yhat_upper = ci.iloc[:, 1].values

    # -- sample paths via simulate --
    samples = result.simulate(
        nsimulations=horizon,
        repetitions=n_paths,
        anchor="end",
        exog=X_pr.values,
    )
    # simulate returns (nsimulations, repetitions) — ensure shape
    if samples.ndim == 3:
        # some statsmodels versions return (nsim, 1, nrep)
        samples = samples.squeeze(axis=1)
    samples = np.asarray(samples, dtype=np.float64)

    # -- build point_df --
    point_df = pd.DataFrame(
        {"yhat": yhat, "yhat_lower": yhat_lower, "yhat_upper": yhat_upper},
        index=X_pr.index,
    )

    # -- exog provenance signature --
    exog_sig: dict = {}
    if "weather_source" in X_predict.columns:
        exog_sig = X_predict["weather_source"].value_counts().to_dict()

    return point_df, samples, exog_sig
