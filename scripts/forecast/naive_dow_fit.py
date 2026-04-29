"""Naive same-DoW baseline model.

Non-exog model: predicts each future day as the mean of the same
day-of-week from history. Bootstrap from same-DoW residuals.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .sample_paths import bootstrap_from_residuals


def fit_naive_dow(
    y: pd.Series,
    n_predict: int = 365,
    n_paths: int = 200,
    seed: int = 42,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Predict each day as mean of same day-of-week from history.

    Returns (point_df, samples) matching the ETS/Theta interface.
    """
    idx = y.index
    if hasattr(idx[0], "weekday"):
        dow = np.array([d.weekday() for d in idx])
    else:
        dow = np.array([pd.Timestamp(d).weekday() for d in idx])

    # per-DoW means
    dow_means = {}
    for d in range(7):
        vals = y.values[dow == d]
        dow_means[d] = float(vals.mean()) if len(vals) > 0 else float(y.mean())

    # build point forecast by cycling DoW
    last_date = idx[-1]
    if hasattr(last_date, "weekday"):
        start_dow = (last_date.weekday() + 1) % 7
    else:
        start_dow = (pd.Timestamp(last_date).weekday() + 1) % 7

    yhat = np.array([dow_means[(start_dow + i) % 7] for i in range(n_predict)])

    # residuals: actual - dow mean for that day
    residuals = y.values - np.array([dow_means[d] for d in dow])

    samples = bootstrap_from_residuals(yhat, residuals, n_paths=n_paths, seed=seed)

    if isinstance(last_date, pd.Timestamp):
        forecast_dates = pd.date_range(
            start=last_date + pd.Timedelta(days=1), periods=n_predict, freq="D"
        )
    else:
        forecast_dates = pd.RangeIndex(n_predict)

    point_df = pd.DataFrame(
        {
            "yhat": yhat,
            "yhat_lower": np.percentile(samples, 2.5, axis=1),
            "yhat_upper": np.percentile(samples, 97.5, axis=1),
        },
        index=forecast_dates,
    )

    return point_df, samples
