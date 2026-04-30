"""Tests for exog_builder — 3-tier weather cascade + column alignment guard.

Mock Supabase client simulates chained query API:
  client.table(name).select(...).gte(...).lte(...).execute()
  client.table(name).select(...).eq(...).execute()
  client.table(name).select(...).execute()
"""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Helpers: build mock data for each table
# ---------------------------------------------------------------------------

RESTAURANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
TRAIN_START = date(2025, 10, 1)
TRAIN_END = date(2025, 12, 28)   # 89 days
PREDICT_START = date(2025, 12, 29)
PREDICT_END = date(2026, 1, 11)  # 14 days


def _weather_daily_rows() -> list[dict]:
    """30 archive rows + 14 forecast rows starting from TRAIN_START."""
    rows = []
    for i in range(44):
        d = TRAIN_START + timedelta(days=i)
        rows.append({
            "date": d.isoformat(),
            "location": "berlin",
            "temp_mean_c": 10.0 + i * 0.1,
            "precip_mm": max(0, 2.0 - i * 0.05),
            "wind_max_kmh": 15.0 + i * 0.2,
            "sunshine_hours": 4.0 + i * 0.05,
            "is_forecast": i >= 30,  # first 30 = archive, last 14 = forecast
        })
    return rows


def _climatology_rows() -> list[dict]:
    """366 rows covering all month/day combos."""
    rows = []
    # generate all days in a leap year (2024) to get 366 unique (month, day)
    d = date(2024, 1, 1)
    while d <= date(2024, 12, 31):
        rows.append({
            "month": d.month,
            "day": d.day,
            "temp_mean_c": 8.0,
            "precip_mm": 1.5,
            "wind_max_kmh": 12.0,
            "sunshine_hours": 5.0,
        })
        d += timedelta(days=1)
    return rows


def _holidays_rows() -> list[dict]:
    """One holiday in the date range."""
    return [{"date": "2025-12-25"}]


def _school_holidays_rows() -> list[dict]:
    """One school-holiday range overlapping the date range."""
    return [{
        "state_code": "BE",
        "block_name": "Weihnachtsferien",
        "start_date": "2025-12-22",
        "end_date": "2026-01-02",
    }]


def _recurring_events_rows() -> list[dict]:
    """One event overlapping the date range."""
    return [{
        "event_id": "weihnachtsmarkt-2025",
        "start_date": "2025-11-24",
        "end_date": "2025-12-23",
    }]


def _transit_alerts_rows() -> list[dict]:
    """No strikes in this range."""
    return []


def _shop_calendar_rows() -> list[dict]:
    """All dates open for our restaurant."""
    rows = []
    d = TRAIN_START
    end = PREDICT_END + timedelta(days=1)
    while d <= end:
        rows.append({
            "restaurant_id": RESTAURANT_ID,
            "date": d.isoformat(),
            "is_open": True,
        })
        d += timedelta(days=1)
    return rows


# ---------------------------------------------------------------------------
# Mock Supabase client factory
# ---------------------------------------------------------------------------

def _make_mock_client() -> MagicMock:
    """Build a MagicMock that mimics Supabase chained query API.

    Supports chains like:
      client.table('weather_daily').select('*').gte('date', ...).lte('date', ...).execute()
      client.table('holidays').select('date').gte('date', ...).lte('date', ...).execute()
      client.table('school_holidays').select('*').execute()
      client.table('shop_calendar').select('date,is_open').eq('restaurant_id', ...).gte(...).lte(...).execute()
    """
    client = MagicMock()

    # Pre-build response data per table
    table_data = {
        "weather_daily": _weather_daily_rows(),
        "weather_climatology": _climatology_rows(),
        "holidays": _holidays_rows(),
        "school_holidays": _school_holidays_rows(),
        "recurring_events": _recurring_events_rows(),
        "transit_alerts": _transit_alerts_rows(),
        "shop_calendar": _shop_calendar_rows(),
    }

    def table_side_effect(table_name: str):
        """Return a chain-mock whose .execute() yields the right data."""
        chain = MagicMock()
        resp = MagicMock()
        resp.data = table_data.get(table_name, [])

        # Every chained method returns the same chain, so any combination of
        # .select().gte().lte().eq().execute() works.
        chain.select.return_value = chain
        chain.gte.return_value = chain
        chain.lte.return_value = chain
        chain.eq.return_value = chain
        chain.execute.return_value = resp
        return chain

    client.table.side_effect = table_side_effect
    return client


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_client():
    return _make_mock_client()


class TestColumnAlignment:
    """FCS-06: train and predict exog matrices must have identical columns."""

    def test_column_alignment_train_vs_predict(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        X_train = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )
        X_predict = build_exog_matrix(
            mock_client, RESTAURANT_ID, PREDICT_START, PREDICT_END
        )

        assert list(X_train.columns) == list(X_predict.columns), (
            "FCS-06 violation: train and predict exog column sets differ"
        )


class TestNoNaN:
    """Prophet and SARIMAX reject NaN in exogenous regressors."""

    def test_no_nan_in_model_columns(self, mock_client):
        from scripts.forecast.exog_builder import EXOG_COLUMNS, build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        for col in EXOG_COLUMNS:
            assert df[col].isna().sum() == 0, (
                f"NaN found in model column '{col}' — Prophet/SARIMAX will reject"
            )


class TestOutputSchema:
    """Output must contain all 9 EXOG_COLUMNS + weather_source."""

    def test_output_has_all_exog_columns(self, mock_client):
        from scripts.forecast.exog_builder import EXOG_COLUMNS, build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        expected = EXOG_COLUMNS + ["weather_source"]
        for col in expected:
            assert col in df.columns, f"Missing column: {col}"

    def test_index_is_datetime(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )
        assert isinstance(df.index, pd.DatetimeIndex), (
            "Index must be DatetimeIndex for model alignment"
        )

    def test_row_count_matches_date_range(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )
        expected_days = (TRAIN_END - TRAIN_START).days + 1
        assert len(df) == expected_days, (
            f"Expected {expected_days} rows, got {len(df)}"
        )


class TestWeatherSourceCascade:
    """3-tier weather cascade must be tracked in weather_source column."""

    def test_weather_source_tracks_cascade_tiers(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        # Train range covers archive + forecast days (44 weather rows),
        # but the train range is 89 days, so some dates will fall back
        # to climatology.
        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        sources = set(df["weather_source"].unique())
        # At minimum archive and climatology should appear (forecast
        # rows overlap the 30-44 day range within train period).
        assert sources & {"archive", "forecast", "climatology"}, (
            f"Expected at least one of archive/forecast/climatology, got {sources}"
        )

    def test_archive_preferred_over_forecast(self, mock_client):
        """If both archive and forecast exist for a date, archive wins."""
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        # First 30 days should be archive (from mock data)
        first_30 = df.iloc[:30]
        archive_count = (first_30["weather_source"] == "archive").sum()
        assert archive_count == 30, (
            f"First 30 days should all be 'archive', got {archive_count}"
        )

    def test_climatology_fills_missing_dates(self, mock_client):
        """Dates beyond weather_daily coverage use climatology."""
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        # Mock weather_daily has 44 rows. Days 45-89 should be climatology.
        tail = df.iloc[44:]
        clim_count = (tail["weather_source"] == "climatology").sum()
        assert clim_count == len(tail), (
            f"Days beyond weather coverage should be climatology, "
            f"got {clim_count}/{len(tail)}"
        )


class TestBinaryFlags:
    """Holiday, school-holiday, event, strike, is_open flags are 0 or 1."""

    def test_binary_columns_are_zero_or_one(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        binary_cols = [
            "is_holiday", "is_school_holiday", "has_event",
            "is_strike", "is_open",
        ]
        for col in binary_cols:
            unique = set(df[col].unique())
            assert unique <= {0, 1, 0.0, 1.0}, (
                f"Column '{col}' has non-binary values: {unique}"
            )

    def test_holiday_flag_set_for_known_date(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        christmas = pd.Timestamp("2025-12-25")
        assert df.loc[christmas, "is_holiday"] == 1, (
            "Dec 25 should be flagged as holiday"
        )

    def test_school_holiday_range_flagged(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        # School holidays: 2025-12-22 to 2026-01-02
        # Within our train range: 2025-12-22 to 2025-12-28
        dec_23 = pd.Timestamp("2025-12-23")
        assert df.loc[dec_23, "is_school_holiday"] == 1, (
            "Dec 23 should be flagged as school holiday"
        )

    def test_event_flag_set(self, mock_client):
        from scripts.forecast.exog_builder import build_exog_matrix

        df = build_exog_matrix(
            mock_client, RESTAURANT_ID, TRAIN_START, TRAIN_END
        )

        # Event: 2025-11-24 to 2025-12-23
        dec_01 = pd.Timestamp("2025-12-01")
        assert df.loc[dec_01, "has_event"] == 1, (
            "Dec 1 should be flagged as event day (Weihnachtsmarkt)"
        )
