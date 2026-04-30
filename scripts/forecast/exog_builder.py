"""Exogenous regressor matrix builder for forecast models.

Assembles a pandas DataFrame with 9 model columns + 1 metadata column
for any date range. Handles a 3-tier weather cascade:

  1. Actual observations from weather_daily (is_forecast=false) -> 'archive'
  2. Bright Sky forecast from weather_daily (is_forecast=true)  -> 'forecast'
  3. Climatological norms from weather_climatology (per-DoY)    -> 'climatology'

FCS-06 CRITICAL: train and predict exog matrices have IDENTICAL column sets.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

# -- 9 model input columns (order is the contract) --
EXOG_COLUMNS: list[str] = [
    "temp_mean_c",
    "precip_mm",
    "wind_max_kmh",
    "sunshine_hours",
    "is_holiday",
    "is_school_holiday",
    "has_event",
    "is_strike",
    "is_open",
]

# weather subset used in the 3-tier cascade
WEATHER_COLS: list[str] = [
    "temp_mean_c",
    "precip_mm",
    "wind_max_kmh",
    "sunshine_hours",
]


def build_exog_matrix(
    client,
    restaurant_id: str,
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    """Build exog matrix with 3-tier weather cascade.

    Returns DataFrame indexed by date (DatetimeIndex) with
    EXOG_COLUMNS + ['weather_source']. No NaN in model columns.
    """
    # -- generate full date range --
    dates = pd.date_range(start=start_date, end=end_date, freq="D")
    df = pd.DataFrame(index=dates)
    df.index.name = "date"

    # -- weather: 3-tier cascade --
    weather, sources = _build_weather(client, start_date, end_date, dates)
    for col in WEATHER_COLS:
        df[col] = weather[col].values
    df["weather_source"] = sources

    # -- binary flags --
    df["is_holiday"] = _build_holiday_flags(client, start_date, end_date, dates)
    df["is_school_holiday"] = _build_school_holiday_flags(client, dates)
    df["has_event"] = _build_event_flags(client, start_date, end_date, dates)
    df["is_strike"] = _build_strike_flags(client, start_date, end_date, dates)
    df["is_open"] = _build_open_flags(client, restaurant_id, start_date, end_date, dates)

    # -- safety net: fill any remaining NaN in numeric model columns with 0 --
    for col in EXOG_COLUMNS:
        if df[col].isna().any():
            df[col] = df[col].fillna(0)

    # -- return only the contracted columns, in order --
    return df[EXOG_COLUMNS + ["weather_source"]]


# ---------------------------------------------------------------------------
# Weather: 3-tier cascade
# ---------------------------------------------------------------------------

def _build_weather(
    client,
    start_date: date,
    end_date: date,
    dates: pd.DatetimeIndex,
) -> tuple[pd.DataFrame, list[str]]:
    """Fetch weather and apply archive -> forecast -> climatology cascade.

    Returns (weather_df aligned to dates, list of source labels).
    """
    start_str = start_date.isoformat()
    end_str = end_date.isoformat()

    # -- tier 1 + 2: weather_daily (archive + forecast) --
    resp = (
        client.table("weather_daily")
        .select("date,temp_mean_c,precip_mm,wind_max_kmh,sunshine_hours,is_forecast")
        .gte("date", start_str)
        .lte("date", end_str)
        .execute()
    )
    daily_rows = resp.data or []

    # partition into archive (actual) and forecast sets
    archive: dict[str, dict] = {}
    forecast: dict[str, dict] = {}
    for row in daily_rows:
        d = row["date"]  # ISO string
        vals = {c: float(row[c]) if row[c] is not None else 0.0 for c in WEATHER_COLS}
        if row.get("is_forecast"):
            forecast[d] = vals
        else:
            archive[d] = vals

    # -- tier 3: climatology --
    clim_resp = (
        client.table("weather_climatology")
        .select("month,day,temp_mean_c,precip_mm,wind_max_kmh,sunshine_hours")
        .execute()
    )
    clim_rows = clim_resp.data or []

    # build (month, day) -> values lookup
    clim_lookup: dict[tuple[int, int], dict] = {}
    for row in clim_rows:
        key = (int(row["month"]), int(row["day"]))
        clim_lookup[key] = {
            c: float(row[c]) if row[c] is not None else 0.0 for c in WEATHER_COLS
        }

    # -- assemble per-date, applying cascade priority --
    weather_data: list[dict] = []
    source_labels: list[str] = []

    for dt in dates:
        d_str = dt.strftime("%Y-%m-%d")
        md_key = (dt.month, dt.day)

        if d_str in archive:
            weather_data.append(archive[d_str])
            source_labels.append("archive")
        elif d_str in forecast:
            weather_data.append(forecast[d_str])
            source_labels.append("forecast")
        elif md_key in clim_lookup:
            weather_data.append(clim_lookup[md_key])
            source_labels.append("climatology")
        else:
            # ultimate fallback: zeros (should not happen with full climatology)
            weather_data.append({c: 0.0 for c in WEATHER_COLS})
            source_labels.append("climatology")

    weather_df = pd.DataFrame(weather_data, index=dates)
    return weather_df, source_labels


# ---------------------------------------------------------------------------
# Binary flag builders
# ---------------------------------------------------------------------------

def _build_holiday_flags(
    client,
    start_date: date,
    end_date: date,
    dates: pd.DatetimeIndex,
) -> np.ndarray:
    """Fetch holidays table, return 0/1 array aligned to dates."""
    resp = (
        client.table("holidays")
        .select("date")
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .execute()
    )
    rows = resp.data or []
    holiday_dates = {pd.Timestamp(r["date"]) for r in rows}
    return np.array([1 if d in holiday_dates else 0 for d in dates], dtype=int)


def _build_school_holiday_flags(
    client,
    dates: pd.DatetimeIndex,
) -> np.ndarray:
    """Fetch school_holidays ranges, return 0/1 for dates in any range."""
    resp = (
        client.table("school_holidays")
        .select("start_date,end_date")
        .execute()
    )
    rows = resp.data or []

    # collect all school-holiday date ranges
    ranges: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    for r in rows:
        ranges.append((pd.Timestamp(r["start_date"]), pd.Timestamp(r["end_date"])))

    def in_any_range(d: pd.Timestamp) -> int:
        for s, e in ranges:
            if s <= d <= e:
                return 1
        return 0

    return np.array([in_any_range(d) for d in dates], dtype=int)


def _build_event_flags(
    client,
    start_date: date,
    end_date: date,
    dates: pd.DatetimeIndex,
) -> np.ndarray:
    """Fetch recurring_events, return 0/1 for dates within any event range."""
    resp = (
        client.table("recurring_events")
        .select("start_date,end_date")
        .execute()
    )
    rows = resp.data or []

    # collect event ranges
    ranges: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    for r in rows:
        ranges.append((pd.Timestamp(r["start_date"]), pd.Timestamp(r["end_date"])))

    def in_any_range(d: pd.Timestamp) -> int:
        for s, e in ranges:
            if s <= d <= e:
                return 1
        return 0

    return np.array([in_any_range(d) for d in dates], dtype=int)


def _build_strike_flags(
    client,
    start_date: date,
    end_date: date,
    dates: pd.DatetimeIndex,
) -> np.ndarray:
    """Fetch transit_alerts, return 0/1 for dates with a strike alert."""
    resp = (
        client.table("transit_alerts")
        .select("date")
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .execute()
    )
    rows = resp.data or []
    strike_dates = {pd.Timestamp(r["date"]) for r in rows}
    return np.array([1 if d in strike_dates else 0 for d in dates], dtype=int)


def _build_open_flags(
    client,
    restaurant_id: str,
    start_date: date,
    end_date: date,
    dates: pd.DatetimeIndex,
) -> np.ndarray:
    """Fetch shop_calendar for the restaurant, return 0/1. Default True."""
    resp = (
        client.table("shop_calendar")
        .select("date,is_open")
        .eq("restaurant_id", restaurant_id)
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .execute()
    )
    rows = resp.data or []

    # build date -> is_open lookup (default open if missing)
    open_lookup: dict[str, bool] = {}
    for r in rows:
        open_lookup[r["date"]] = bool(r["is_open"])

    return np.array(
        [1 if open_lookup.get(d.strftime("%Y-%m-%d"), True) else 0 for d in dates],
        dtype=int,
    )
