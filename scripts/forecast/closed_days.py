"""Closed-day handling for forecast models (D-01, D-03)."""
from __future__ import annotations
import pandas as pd


def zero_closed_days(preds: pd.DataFrame, shop_cal: pd.DataFrame) -> pd.DataFrame:
    """Force yhat/yhat_lower/yhat_upper to 0 for closed dates (D-01)."""
    closed_dates = set(shop_cal.loc[~shop_cal['is_open'], 'date'])
    mask = preds['target_date'].isin(closed_dates)
    preds = preds.copy()
    preds.loc[mask, ['yhat', 'yhat_lower', 'yhat_upper']] = 0.0
    if 'yhat_samples' in preds.columns:
        preds.loc[mask, 'yhat_samples'] = None
    return preds


def filter_open_days(history: pd.DataFrame) -> pd.DataFrame:
    """Filter to open days only for non-exog models (D-03)."""
    return history[history['is_open']].reset_index(drop=True)
