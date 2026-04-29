"""Closed-day handling for forecast pipelines.

Two strategies depending on model type:

D-01 (exog models — SARIMAX, Prophet):
    Train with NaN for closed days + is_open regressor.
    Post-hoc: zero_closed_days() forces yhat=0 on closed dates.

D-03 (non-exog models — ETS, Theta, Naive):
    Train on open-day-only series via build_open_day_series().
    Map predictions back to calendar via map_open_predictions_to_calendar().
"""
from __future__ import annotations
import numpy as np
import pandas as pd


def zero_closed_days(preds: pd.DataFrame, shop_cal: pd.DataFrame) -> pd.DataFrame:
    """Force yhat/yhat_lower/yhat_upper=0 for closed dates (D-01).

    preds: columns target_date, yhat, yhat_lower, yhat_upper (+ any extras)
    shop_cal: columns date, is_open
    """
    result = preds.copy()

    # build a set of closed dates for fast lookup
    closed_dates = set(
        pd.to_datetime(shop_cal.loc[~shop_cal['is_open'], 'date']).dt.normalize()
    )

    # normalize target_date for comparison
    target_dates = pd.to_datetime(result['target_date']).dt.normalize()
    mask = target_dates.isin(closed_dates)

    # zero out forecast columns for closed days
    for col in ('yhat', 'yhat_lower', 'yhat_upper'):
        if col in result.columns:
            result.loc[mask, col] = 0.0

    return result


def build_open_day_series(y: pd.Series, shop_cal: pd.DataFrame) -> pd.Series:
    """Filter to open days only, reset index for contiguous series (D-03).

    y: time series with DatetimeIndex
    shop_cal: columns date, is_open
    """
    # build set of open dates
    open_dates = set(
        pd.to_datetime(shop_cal.loc[shop_cal['is_open'], 'date']).dt.normalize()
    )

    # filter y to open days only
    y_dates = pd.to_datetime(y.index).normalize()
    mask = y_dates.isin(open_dates)
    filtered = y[mask].copy()

    # reset to contiguous integer index for non-exog models
    filtered = filtered.reset_index(drop=True)
    return filtered


def map_open_predictions_to_calendar(
    open_preds: np.ndarray,
    shop_cal: pd.DataFrame,
    calendar_dates: list,
) -> np.ndarray:
    """Map open-day predictions back to calendar dates, 0 for closed (D-03).

    open_preds: array of predictions for open days only
    shop_cal: columns date, is_open
    calendar_dates: list of dates covering the forecast horizon
    """
    # determine which calendar dates are open
    cal_subset = shop_cal[shop_cal['date'].isin(calendar_dates)].copy()
    cal_subset = cal_subset.set_index('date').reindex(calendar_dates)
    is_open = cal_subset['is_open'].values

    n_open = int(is_open.sum())
    if len(open_preds) != n_open:
        raise ValueError(
            f"open_preds length ({len(open_preds)}) != "
            f"open-day count ({n_open}) in calendar"
        )

    # place predictions into open slots, 0 for closed
    result = np.zeros(len(calendar_dates), dtype=float)
    result[is_open] = open_preds

    return result
