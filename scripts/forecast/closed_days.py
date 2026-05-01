"""Closed-day handling for forecast models (D-01, D-03).

Load-bearing assumption (I-3): dates that are NOT present in shop_calendar
are treated as OPEN. Both helpers below derive their behavior from this
default:

  * ``zero_closed_days`` only zeroes preds for dates that exist in the
    calendar AND have ``is_open=False``. Anything not in the calendar
    keeps the model's predicted yhat -- i.e. is implicitly "open".
  * ``filter_open_days`` only sees rows that the caller has already
    LEFT-joined against shop_calendar with the same missing=open default.

This matters at the 372-day daily forecast horizon: most pred_dates are
absent from shop_calendar (it's only populated for confirmed closures /
known holidays), so the missing=open default is exactly what produces the
smooth forward forecast curve.

If shop_calendar gains "default closed for unknown" semantics later, this
contract MUST update in lockstep with the consumer logic in *_fit.py and
the SQL building shop_cal sets that feed these helpers.
"""
from __future__ import annotations
import pandas as pd


def zero_closed_days(preds: pd.DataFrame, shop_cal: pd.DataFrame) -> pd.DataFrame:
    """Force yhat/yhat_lower/yhat_upper to 0 for closed dates (D-01).

    Closed = present in ``shop_cal`` with ``is_open=False``. Dates absent
    from ``shop_cal`` are left untouched (i.e. treated as open) -- see the
    module docstring for why this default matters at long horizons.
    """
    closed_dates = set(shop_cal.loc[~shop_cal['is_open'], 'date'])
    mask = preds['target_date'].isin(closed_dates)
    preds = preds.copy()
    preds.loc[mask, ['yhat', 'yhat_lower', 'yhat_upper']] = 0.0
    if 'yhat_samples' in preds.columns:
        preds.loc[mask, 'yhat_samples'] = None
    return preds


def filter_open_days(history: pd.DataFrame) -> pd.DataFrame:
    """Filter to open days only for non-exog models (D-03).

    Assumes ``history.is_open`` was populated by an upstream LEFT JOIN that
    treats missing-from-shop_calendar as ``True`` -- see module docstring.
    """
    return history[history['is_open']].reset_index(drop=True)
