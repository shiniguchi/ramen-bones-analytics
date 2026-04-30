"""Shared fixtures for Phase 14 forecast tests."""
from __future__ import annotations
import numpy as np
import pandas as pd
import pytest
from datetime import date, timedelta
from unittest.mock import MagicMock


@pytest.fixture
def synthetic_daily_revenue() -> pd.Series:
    """90-day synthetic daily revenue with weekly seasonality + trend."""
    rng = np.random.default_rng(42)
    n = 90
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    trend = np.linspace(800, 1000, n)
    weekly = 200 * np.sin(2 * np.pi * np.arange(n) / 7)
    noise = rng.normal(0, 50, n)
    values = trend + weekly + noise
    return pd.Series(values, index=pd.DatetimeIndex(dates), name='revenue_eur')


@pytest.fixture
def synthetic_daily_counts() -> pd.Series:
    """90-day synthetic daily invoice counts."""
    rng = np.random.default_rng(43)
    n = 90
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    base = 50 + 10 * np.sin(2 * np.pi * np.arange(n) / 7)
    noise = rng.normal(0, 5, n)
    values = np.maximum(base + noise, 1).astype(int)
    return pd.Series(values, index=pd.DatetimeIndex(dates), name='invoice_count')


@pytest.fixture
def shop_calendar_df() -> pd.DataFrame:
    """120-day shop calendar: closed on Mon+Tue before 2026-02-03, open all days after."""
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(120)]
    regime_shift = date(2026, 2, 3)
    is_open = []
    for d in dates:
        if d < regime_shift and d.weekday() in (0, 1):
            is_open.append(False)
        else:
            is_open.append(True)
    return pd.DataFrame({'date': dates, 'is_open': is_open})


@pytest.fixture
def mock_exog_df() -> pd.DataFrame:
    """90-day mock exog matrix with all required columns."""
    rng = np.random.default_rng(44)
    n = 90
    start = date(2025, 10, 1)
    dates = [start + timedelta(days=i) for i in range(n)]
    return pd.DataFrame({
        'temp_mean_c': rng.normal(10, 5, n),
        'precip_mm': np.maximum(rng.normal(2, 3, n), 0),
        'wind_max_kmh': np.maximum(rng.normal(15, 8, n), 0),
        'sunshine_hours': np.maximum(rng.normal(5, 3, n), 0),
        'is_holiday': rng.choice([0, 1], n, p=[0.95, 0.05]),
        'is_school_holiday': rng.choice([0, 1], n, p=[0.85, 0.15]),
        'has_event': rng.choice([0, 1], n, p=[0.9, 0.1]),
        'is_strike': np.zeros(n, dtype=int),
        'is_open': np.ones(n, dtype=int),
        'weather_source': ['archive'] * n,
    }, index=pd.DatetimeIndex(dates))


@pytest.fixture
def mock_supabase_client():
    """Mock Supabase client that records upsert calls."""
    client = MagicMock()
    mock_response = MagicMock()
    mock_response.data = []
    mock_response.error = None
    # Support .table().upsert().execute() chain
    client.table.return_value.upsert.return_value.execute.return_value = mock_response
    # Support .table().select().eq().execute() chain
    client.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_response
    # Support .table().insert().execute() chain
    client.table.return_value.insert.return_value.execute.return_value = mock_response
    return client
