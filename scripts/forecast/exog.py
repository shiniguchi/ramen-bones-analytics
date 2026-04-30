"""Shared exog matrix builder with 3-tier weather cascade (D-08, D-17, D-18)."""
from __future__ import annotations
import pandas as pd
import numpy as np
from datetime import date, timedelta, datetime
from typing import Dict, Set

# Column order must stay stable — models depend on positional consistency (FCS-06)
EXOG_COLUMNS = [
    'temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours',
    'is_holiday', 'is_school_holiday', 'is_event', 'is_strike', 'is_open',
]

WEATHER_COLS = ['temp_mean_c', 'precip_mm', 'wind_max_kmh', 'sunshine_hours']


def build_exog_matrix_from_data(
    *,
    dates: list,
    weather_df: pd.DataFrame,
    climatology: Dict,
    holidays_set: Set,
    school_set: Set,
    events_set: Set,
    strikes_set: Set,
    shop_cal: Dict,
) -> pd.DataFrame:
    """Build exog matrix from pre-fetched data. Pure function for testability.

    3-tier weather cascade per date:
      Tier 1: actual/forecast value from weather_df (non-NaN)
      Tier 2: not applied here — Bright Sky is fetched before calling this function
      Tier 3: climatology norm keyed by (month, day)
    """
    df = pd.DataFrame({'date': dates})

    # Build a lookup dict from weather_df for fast access
    weather_lookup: Dict[date, Dict[str, float]] = {}
    for _, row in weather_df.iterrows():
        d = row['date']
        # normalise to date if it's a datetime/Timestamp
        if not isinstance(d, date) or isinstance(d, datetime):
            d = pd.Timestamp(d).date()
        weather_lookup[d] = {c: row[c] for c in WEATHER_COLS}

    # Fill weather columns with cascade: actual -> climatology norm
    for col in WEATHER_COLS:
        values = []
        for d in dates:
            raw = weather_lookup.get(d, {}).get(col)
            if raw is not None and not (isinstance(raw, float) and np.isnan(raw)):
                values.append(float(raw))
            else:
                # Tier 3: climatology fallback keyed by (month, day)
                norm = climatology.get((d.month, d.day), {})
                values.append(float(norm.get(col, 0.0)))
        df[col] = values

    # Binary flag columns for calendar/event regressors
    df['is_holiday'] = [int(d in holidays_set) for d in dates]
    df['is_school_holiday'] = [int(d in school_set) for d in dates]
    df['is_event'] = [int(d in events_set) for d in dates]
    df['is_strike'] = [int(d in strikes_set) for d in dates]
    # Default open=True when date not in shop_cal (forward horizon dates)
    df['is_open'] = [int(shop_cal.get(d, True)) for d in dates]

    df = df.set_index('date')
    return df[EXOG_COLUMNS]


def assert_exog_compatible(fit_df: pd.DataFrame, predict_df: pd.DataFrame) -> None:
    """Assert column names, dtypes, and width match between fit and predict (FCS-06, autoplan E1)."""
    if list(fit_df.columns) != list(predict_df.columns):
        raise ValueError(
            f'Exog column mismatch: fit={list(fit_df.columns)} vs predict={list(predict_df.columns)}'
        )
    for col in fit_df.columns:
        if fit_df[col].dtype != predict_df[col].dtype:
            raise ValueError(
                f'Exog dtype mismatch for {col}: fit={fit_df[col].dtype} vs predict={predict_df[col].dtype}'
            )


def build_exog_matrix(client, *, restaurant_id: str, start_date: date, end_date: date) -> tuple:
    """Fetch data from Supabase and build exog matrix. Returns (df, exog_signature).

    If Bright Sky returns fewer than 14 days, falls back to climatology without aborting.
    """
    dates = []
    d = start_date
    while d <= end_date:
        dates.append(d)
        d += timedelta(days=1)

    # Fetch weather from weather_daily (Bright Sky archive + forecast combined)
    weather_resp = (
        client.table('weather_daily')
        .select('*')
        .gte('date', str(start_date))
        .lte('date', str(end_date))
        .execute()
    )
    weather_df = (
        pd.DataFrame(weather_resp.data)
        if weather_resp.data
        else pd.DataFrame(columns=['date'] + WEATHER_COLS + ['weather_source'])
    )
    if not weather_df.empty and 'date' in weather_df.columns:
        weather_df['date'] = pd.to_datetime(weather_df['date']).dt.date

    # Fetch tier-3 climatology norms
    clim_resp = client.table('weather_climatology').select('*').execute()
    climatology: Dict = {}
    for row in (clim_resp.data or []):
        m, day = _doy_to_md(row['day_of_year'])
        climatology[(m, day)] = {c: row[c] for c in WEATHER_COLS}

    # Fetch calendar sets
    holidays_resp = client.table('holidays').select('date').execute()
    holidays_set = {date.fromisoformat(r['date']) for r in (holidays_resp.data or [])}

    school_resp = client.table('school_holidays').select('date').execute()
    school_set = {date.fromisoformat(r['date']) for r in (school_resp.data or [])}

    events_resp = client.table('recurring_events').select('event_date').execute()
    events_set = {date.fromisoformat(r['event_date']) for r in (events_resp.data or [])}

    strikes_resp = client.table('transit_alerts').select('alert_date').execute()
    strikes_set = {
        date.fromisoformat(r['alert_date'])
        for r in (strikes_resp.data or [])
        if r.get('is_strike')
    }

    shop_resp = (
        client.table('shop_calendar')
        .select('date,is_open')
        .eq('restaurant_id', restaurant_id)
        .gte('date', str(start_date))
        .lte('date', str(end_date))
        .execute()
    )
    shop_cal = {date.fromisoformat(r['date']): r['is_open'] for r in (shop_resp.data or [])}

    df = build_exog_matrix_from_data(
        dates=dates,
        weather_df=weather_df,
        climatology=climatology,
        holidays_set=holidays_set,
        school_set=school_set,
        events_set=events_set,
        strikes_set=strikes_set,
        shop_cal=shop_cal,
    )

    # Build signature for traceability (stored in forecast_daily.exog_signature)
    source_counts: Dict = {}
    if not weather_df.empty and 'weather_source' in weather_df.columns:
        source_counts = weather_df['weather_source'].value_counts().to_dict()
    exog_sig = {'sources': source_counts, 'columns': EXOG_COLUMNS, 'n_dates': len(dates)}

    return df, exog_sig


def _doy_to_md(doy: int) -> tuple:
    """Convert day-of-year to (month, day) using 2024 (leap year) as reference."""
    ref = datetime(2024, 1, 1) + timedelta(days=doy - 1)
    return ref.month, ref.day
