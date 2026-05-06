"""Phase 17 BCK-03: tests for naive_dow_with_holidays helpers.

Pure-function tests on the holiday-multiplier math. Stubs the supabase module
to allow imports through scripts.forecast.naive_dow_fit (which transitively
imports supabase via db.py).
"""
from __future__ import annotations

import sys
import types
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

# Stub supabase before importing naive_dow_with_holidays — same pattern as
# scripts/forecast/tests/test_run_all_grain_loop.py:21-32
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub

from scripts.forecast.naive_dow_with_holidays_fit import (  # noqa: E402
    _compute_holiday_multipliers,
    _apply_holiday_multipliers,
    MODEL_NAME,
    HOLIDAY_FLAGS,
)


def _make_history_with_holiday_lift(*, n_weeks=8, holiday_lift=2.0, strike_drop=0.5):
    """Synthetic 8-week history. Mondays are holidays (lift). Wednesdays are strikes (drop).
    Other days are baseline=100."""
    dates = []
    ys = []
    flags_records = []
    start = date(2025, 6, 9)  # a Monday
    for i in range(n_weeks * 7):
        d = start + timedelta(days=i)
        is_holiday = 1 if d.weekday() == 0 else 0
        is_strike = 1 if d.weekday() == 2 else 0
        baseline = 100.0
        if is_holiday:
            baseline *= holiday_lift
        if is_strike:
            baseline *= strike_drop
        dates.append(d)
        ys.append(baseline)
        flags_records.append({
            'date': d,
            'is_holiday': is_holiday,
            'is_school_holiday': 0,
            'is_event': 0,
            'is_strike': is_strike,
            'is_open': 1,
        })
    history_df = pd.DataFrame({'date': dates, 'y': ys})
    exog_df = pd.DataFrame(flags_records).set_index('date')
    return history_df, exog_df


def test_holiday_multiplier_higher_on_holiday():
    """_compute_holiday_multipliers returns ratio ≈ 2.0 for holiday combo (1,0,0,0).

    Provides seasonal_means={0: 100.0} directly (Monday baseline=100) so:
    - holiday Mondays (y=200) -> ratio = 200/100 = 2.0 (exact)
    - regular Mondays (y=100) -> ratio = 100/100 = 1.0
    Assertion is numerically load-bearing: wrong ratio math fails this test.
    """
    # 4 Mondays: 2 holiday (y=200), 2 regular (y=100)
    mondays_holiday = [date(2026, 1, 5), date(2026, 1, 19)]
    mondays_regular = [date(2026, 1, 12), date(2026, 1, 26)]

    dates = mondays_holiday + mondays_regular
    ys = [200.0, 200.0, 100.0, 100.0]
    history_df = pd.DataFrame({'date': dates, 'y': ys})

    exog_records = [
        {'date': d, 'is_holiday': 1, 'is_school_holiday': 0, 'is_event': 0, 'is_strike': 0, 'is_open': 1}
        for d in mondays_holiday
    ] + [
        {'date': d, 'is_holiday': 0, 'is_school_holiday': 0, 'is_event': 0, 'is_strike': 0, 'is_open': 1}
        for d in mondays_regular
    ]
    exog_df = pd.DataFrame(exog_records).set_index('date')

    # Explicitly set seasonal_means[0] = 100.0 (Monday baseline) so ratios are exact:
    # holiday ratio = 200/100 = 2.0, regular ratio = 100/100 = 1.0
    fixed_seasonal_means = {0: 100.0}  # Monday weekday=0

    multipliers = _compute_holiday_multipliers(
        history_df=history_df,
        exog_df=exog_df,
        seasonal_means=fixed_seasonal_means,
        granularity='day',
    )

    assert (1, 0, 0, 0) in multipliers, f"Holiday combo missing. Got: {list(multipliers.keys())}"
    assert abs(multipliers[(1, 0, 0, 0)] - 2.0) < 0.01, (
        f"Expected holiday multiplier ≈ 2.0, got {multipliers[(1,0,0,0)]}. "
        "This means ratio math is wrong."
    )


def test_no_holiday_combo_falls_back_to_1():
    """Combo unseen at predict-time -> fallback 1.0."""
    multipliers = {(1, 0, 0, 0): 1.5}  # only one known combo
    seasonal_means = {dow: 100.0 for dow in range(7)}
    future_dates = [date(2026, 6, 10)]  # a Wednesday (weekday=2)
    exog_df = pd.DataFrame([{
        'date': future_dates[0],
        'is_holiday': 0, 'is_school_holiday': 1,  # combo (0,1,0,0) unseen
        'is_event': 0, 'is_strike': 0, 'is_open': 1,
    }]).set_index('date')
    yhats = _apply_holiday_multipliers(
        future_dates=future_dates,
        seasonal_means=seasonal_means,
        exog_df=exog_df,
        multipliers=multipliers,
        granularity='day',
    )
    # Wednesday's seasonal_means[2] = 100.0; multiplier=1.0 fallback; yhat=100.
    assert abs(yhats[0] - 100.0) < 1e-6


def test_yhat_equals_dow_mean_when_combo_multiplier_is_1():
    """Combo (0,0,0,0) -> multiplier=1.0 -> yhat == seasonal_mean."""
    multipliers = {(0, 0, 0, 0): 1.0}
    seasonal_means = {dow: 100.0 + dow * 10 for dow in range(7)}
    future_dates = [date(2026, 6, 11)]  # Thursday weekday=3
    exog_df = pd.DataFrame([{
        'date': future_dates[0],
        'is_holiday': 0, 'is_school_holiday': 0,
        'is_event': 0, 'is_strike': 0, 'is_open': 1,
    }]).set_index('date')
    yhats = _apply_holiday_multipliers(
        future_dates=future_dates,
        seasonal_means=seasonal_means,
        exog_df=exog_df,
        multipliers=multipliers,
        granularity='day',
    )
    # seasonal_means[3] = 130.0
    assert abs(yhats[0] - 130.0) < 1e-6


def test_strike_day_pushes_yhat_down():
    """Strike combo (0,0,0,1) -> multiplier < 1.0 -> yhat < dow_mean."""
    # 4 Wednesdays: 2 strike (y=50), 2 regular (y=100). Wednesday weekday=2.
    wednesdays_strike = [date(2026, 1, 7), date(2026, 1, 21)]
    wednesdays_regular = [date(2026, 1, 14), date(2026, 1, 28)]

    dates = wednesdays_strike + wednesdays_regular
    ys = [50.0, 50.0, 100.0, 100.0]
    history_df = pd.DataFrame({'date': dates, 'y': ys})

    exog_records = [
        {'date': d, 'is_holiday': 0, 'is_school_holiday': 0, 'is_event': 0, 'is_strike': 1, 'is_open': 1}
        for d in wednesdays_strike
    ] + [
        {'date': d, 'is_holiday': 0, 'is_school_holiday': 0, 'is_event': 0, 'is_strike': 0, 'is_open': 1}
        for d in wednesdays_regular
    ]
    exog_df = pd.DataFrame(exog_records).set_index('date')
    seasonal_means = {2: 100.0}  # Wednesday mean = 100

    multipliers = _compute_holiday_multipliers(
        history_df=history_df,
        exog_df=exog_df,
        seasonal_means=seasonal_means,
        granularity='day',
    )

    # Strike combo (0,0,0,1): strike y=50 -> ratio=0.5; regular y=100 -> ratio=1.0
    assert (0, 0, 0, 1) in multipliers, f"Strike combo missing. Got: {list(multipliers.keys())}"
    assert multipliers[(0, 0, 0, 1)] < 1.0, (
        f"Strike multiplier should be < 1.0, got {multipliers[(0, 0, 0, 1)]}"
    )
    # mean of [50/100, 50/100] = 0.5
    assert abs(multipliers[(0, 0, 0, 1)] - 0.5) < 0.01, (
        f"Expected strike multiplier ≈ 0.5, got {multipliers[(0, 0, 0, 1)]}"
    )

    # Apply to a future strike Wednesday
    future_dates = [date(2026, 2, 4)]  # Wednesday
    exog_future = pd.DataFrame([{
        'date': future_dates[0],
        'is_holiday': 0, 'is_school_holiday': 0,
        'is_event': 0, 'is_strike': 1, 'is_open': 1,
    }]).set_index('date')
    yhats = _apply_holiday_multipliers(
        future_dates=future_dates,
        seasonal_means={2: 100.0},
        exog_df=exog_future,
        multipliers=multipliers,
        granularity='day',
    )
    # dow_mean[2]=100 * 0.5 = 50
    assert abs(yhats[0] - 50.0) < 0.01, f"Strike yhat should be 50, got {yhats[0]}"


def test_model_name_constant():
    """MODEL_NAME literal matches BCK-03 spec."""
    assert MODEL_NAME == 'naive_dow_with_holidays'


def test_holiday_flags_tuple():
    """HOLIDAY_FLAGS contains exactly the 4 required flag columns."""
    assert HOLIDAY_FLAGS == ('is_holiday', 'is_school_holiday', 'is_event', 'is_strike')
