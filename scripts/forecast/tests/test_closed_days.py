"""Tests for closed-day handling utilities (D-01 / D-03)."""
from __future__ import annotations
import numpy as np
import pandas as pd
import pytest
from datetime import date, timedelta

from scripts.forecast.closed_days import (
    zero_closed_days,
    build_open_day_series,
    map_open_predictions_to_calendar,
)


# ---------------------------------------------------------------------------
# D-01: zero_closed_days
# ---------------------------------------------------------------------------

def test_zero_closed_days_sets_yhat_to_zero():
    """Mon (closed) + Tue (closed) + Wed (open) — closed days get yhat=0."""
    # Mon 2025-10-06, Tue 2025-10-07, Wed 2025-10-08
    preds = pd.DataFrame({
        'target_date': pd.to_datetime(['2025-10-06', '2025-10-07', '2025-10-08']),
        'yhat': [100.0, 200.0, 300.0],
        'yhat_lower': [80.0, 160.0, 250.0],
        'yhat_upper': [120.0, 240.0, 350.0],
    })
    shop_cal = pd.DataFrame({
        'date': [date(2025, 10, 6), date(2025, 10, 7), date(2025, 10, 8)],
        'is_open': [False, False, True],
    })

    result = zero_closed_days(preds, shop_cal)

    # closed days zeroed
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-06'), 'yhat'].iloc[0] == 0.0
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-06'), 'yhat_lower'].iloc[0] == 0.0
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-06'), 'yhat_upper'].iloc[0] == 0.0
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-07'), 'yhat'].iloc[0] == 0.0

    # open day untouched
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-08'), 'yhat'].iloc[0] == 300.0
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-08'), 'yhat_lower'].iloc[0] == 250.0
    assert result.loc[result['target_date'] == pd.Timestamp('2025-10-08'), 'yhat_upper'].iloc[0] == 350.0


def test_zero_closed_days_preserves_extra_columns():
    """Extra columns in preds survive untouched."""
    preds = pd.DataFrame({
        'target_date': pd.to_datetime(['2025-10-06', '2025-10-07']),
        'yhat': [100.0, 200.0],
        'yhat_lower': [80.0, 160.0],
        'yhat_upper': [120.0, 240.0],
        'model': ['sarimax', 'sarimax'],
    })
    shop_cal = pd.DataFrame({
        'date': [date(2025, 10, 6), date(2025, 10, 7)],
        'is_open': [False, True],
    })

    result = zero_closed_days(preds, shop_cal)
    assert 'model' in result.columns
    assert result['model'].tolist() == ['sarimax', 'sarimax']


def test_zero_closed_days_with_fixture(shop_calendar_df):
    """Use the shared 120-day fixture; Mon+Tue before regime shift are closed."""
    n = 10
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    preds = pd.DataFrame({
        'target_date': pd.to_datetime(dates),
        'yhat': np.full(n, 500.0),
        'yhat_lower': np.full(n, 400.0),
        'yhat_upper': np.full(n, 600.0),
    })

    result = zero_closed_days(preds, shop_calendar_df)

    for _, row in result.iterrows():
        d = row['target_date'].date()
        cal_row = shop_calendar_df[shop_calendar_df['date'] == d]
        if not cal_row.empty and not cal_row['is_open'].iloc[0]:
            assert row['yhat'] == 0.0
            assert row['yhat_lower'] == 0.0
            assert row['yhat_upper'] == 0.0


# ---------------------------------------------------------------------------
# D-03: build_open_day_series
# ---------------------------------------------------------------------------

def test_build_open_day_series_filters_closed():
    """7-day series with 2 closed days -> returns 5 values, no zeros."""
    start = date(2025, 10, 6)  # Monday
    dates = [start + timedelta(days=i) for i in range(7)]
    values = [100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0]
    y = pd.Series(values, index=pd.DatetimeIndex(dates), name='revenue_eur')

    shop_cal = pd.DataFrame({
        'date': dates,
        # Mon + Tue closed, rest open
        'is_open': [False, False, True, True, True, True, True],
    })

    result = build_open_day_series(y, shop_cal)

    # should only have 5 open-day values
    assert len(result) == 5
    # index is reset to 0-based contiguous
    assert list(result.index) == list(range(5))
    # values are the open-day originals
    assert list(result.values) == [300.0, 400.0, 500.0, 600.0, 700.0]


def test_build_open_day_series_all_open():
    """When all days are open, output == input (with reset index)."""
    dates = [date(2025, 10, 8) + timedelta(days=i) for i in range(5)]
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    y = pd.Series(values, index=pd.DatetimeIndex(dates), name='revenue_eur')
    shop_cal = pd.DataFrame({'date': dates, 'is_open': [True] * 5})

    result = build_open_day_series(y, shop_cal)
    assert len(result) == 5
    np.testing.assert_array_equal(result.values, values)


def test_build_open_day_series_with_fixture(shop_calendar_df, synthetic_daily_revenue):
    """Fixture: 90-day revenue, 120-day calendar. Open-day count matches."""
    result = build_open_day_series(synthetic_daily_revenue, shop_calendar_df)

    # count open days in the 90-day window
    cal_slice = shop_calendar_df[
        shop_calendar_df['date'].isin([d.date() for d in synthetic_daily_revenue.index])
    ]
    expected_open = cal_slice['is_open'].sum()
    assert len(result) == expected_open


# ---------------------------------------------------------------------------
# D-03: map_open_predictions_to_calendar
# ---------------------------------------------------------------------------

def test_map_open_predictions_to_calendar():
    """5 calendar dates, 2 closed -> 3 open predictions mapped, closed=0."""
    start = date(2025, 10, 6)  # Monday
    calendar_dates = [start + timedelta(days=i) for i in range(5)]
    shop_cal = pd.DataFrame({
        'date': calendar_dates,
        # Mon + Tue closed, Wed-Fri open
        'is_open': [False, False, True, True, True],
    })
    # 3 open-day predictions
    open_preds = np.array([300.0, 400.0, 500.0])

    result = map_open_predictions_to_calendar(open_preds, shop_cal, calendar_dates)

    assert isinstance(result, np.ndarray)
    assert len(result) == 5
    assert result[0] == 0.0  # Mon closed
    assert result[1] == 0.0  # Tue closed
    assert result[2] == 300.0  # Wed open
    assert result[3] == 400.0  # Thu open
    assert result[4] == 500.0  # Fri open


def test_map_open_predictions_all_open():
    """All open — predictions map 1:1."""
    dates = [date(2025, 10, 8) + timedelta(days=i) for i in range(3)]
    shop_cal = pd.DataFrame({'date': dates, 'is_open': [True] * 3})
    open_preds = np.array([10.0, 20.0, 30.0])

    result = map_open_predictions_to_calendar(open_preds, shop_cal, dates)
    np.testing.assert_array_equal(result, [10.0, 20.0, 30.0])


def test_map_open_predictions_length_mismatch_raises():
    """If open_preds length != open-day count, raise ValueError."""
    dates = [date(2025, 10, 6) + timedelta(days=i) for i in range(5)]
    shop_cal = pd.DataFrame({
        'date': dates,
        'is_open': [False, False, True, True, True],
    })
    # wrong length: 2 predictions but 3 open days
    open_preds = np.array([300.0, 400.0])

    with pytest.raises(ValueError, match="open_preds length"):
        map_open_predictions_to_calendar(open_preds, shop_cal, dates)
