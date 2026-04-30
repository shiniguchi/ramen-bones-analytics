"""Shared exog matrix builder with 3-tier weather cascade (D-08, D-17, D-18)."""
from __future__ import annotations
import pandas as pd
import numpy as np
from datetime import date, timedelta, datetime
from typing import Dict, Set

# Column order must stay stable — models depend on positional consistency (FCS-06)
# Note: sunshine_hours dropped — weather_daily has cloud_cover, not sunshine_hours,
# and converting cloud_cover to sunshine_hours is unreliable.
EXOG_COLUMNS = [
    'temp_mean_c', 'precip_mm', 'wind_max_kmh',
    'is_holiday', 'is_school_holiday', 'is_event', 'is_strike', 'is_open',
]

# Canonical weather column names used in the exog matrix
WEATHER_COLS = ['temp_mean_c', 'precip_mm', 'wind_max_kmh']

# Mapping from weather_daily actual DB columns to canonical exog names:
#   temp_min_c + temp_max_c -> temp_mean_c (average)
#   precip_mm -> precip_mm (direct)
#   wind_kph -> wind_max_kmh (rename, same unit approximation)
# cloud_cover is available but not mapped — sunshine_hours dropped from exog


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
    # Actual columns: date, location, temp_min_c, temp_max_c, precip_mm,
    #                 wind_kph, cloud_cover, provider, fetched_at
    weather_resp = (
        client.table('weather_daily')
        .select('date,temp_min_c,temp_max_c,precip_mm,wind_kph')
        .gte('date', str(start_date))
        .lte('date', str(end_date))
        .limit(10000)
        .execute()
    )
    weather_df = (
        pd.DataFrame(weather_resp.data)
        if weather_resp.data
        else pd.DataFrame(columns=['date'] + WEATHER_COLS)
    )
    if not weather_df.empty and 'date' in weather_df.columns:
        weather_df['date'] = pd.to_datetime(weather_df['date']).dt.date
        # Derive canonical exog columns from actual weather_daily columns
        weather_df['temp_mean_c'] = (weather_df['temp_min_c'] + weather_df['temp_max_c']) / 2.0
        weather_df['wind_max_kmh'] = weather_df['wind_kph']

    # Fetch tier-3 climatology norms
    clim_resp = client.table('weather_climatology').select('*').execute()
    climatology: Dict = {}
    for row in (clim_resp.data or []):
        m, day = _doy_to_md(row['day_of_year'])
        climatology[(m, day)] = {c: row[c] for c in WEATHER_COLS}

    # Fetch calendar sets
    holidays_resp = client.table('holidays').select('date').execute()
    holidays_set = {date.fromisoformat(r['date']) for r in (holidays_resp.data or [])}

    # school_holidays stores date ranges (start_date, end_date), expand to individual dates
    school_resp = client.table('school_holidays').select('start_date,end_date').execute()
    school_set = set()
    for r in (school_resp.data or []):
        s = date.fromisoformat(r['start_date'])
        e = date.fromisoformat(r['end_date'])
        d = s
        while d <= e:
            school_set.add(d)
            d += timedelta(days=1)

    # recurring_events stores date ranges (start_date, end_date), expand to individual dates
    events_resp = client.table('recurring_events').select('start_date,end_date').execute()
    events_set = set()
    for r in (events_resp.data or []):
        s = date.fromisoformat(r['start_date'])
        e = date.fromisoformat(r['end_date'])
        d = s
        while d <= e:
            events_set.add(d)
            d += timedelta(days=1)

    # transit_alerts has pub_date and matched_keyword; infer strike from keyword
    strikes_resp = client.table('transit_alerts').select('pub_date,matched_keyword').execute()
    strikes_set = {
        date.fromisoformat(r['pub_date'][:10])
        for r in (strikes_resp.data or [])
        if r.get('matched_keyword', '').lower() in ('strike', 'streik')
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
    weather_rows = len(weather_df) if not weather_df.empty else 0
    exog_sig = {'weather_rows': weather_rows, 'columns': EXOG_COLUMNS, 'n_dates': len(dates)}

    return df, exog_sig


def _doy_to_md(doy: int) -> tuple:
    """Convert day-of-year to (month, day) using 2024 (leap year) as reference."""
    ref = datetime(2024, 1, 1) + timedelta(days=doy - 1)
    return ref.month, ref.day
