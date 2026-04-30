"""Tests for forecast batch writer (FCS-12)."""
from __future__ import annotations
import numpy as np
import pandas as pd
from datetime import date, timedelta
from scripts.forecast.writer import write_forecast_batch, CHUNK_SIZE


def _make_point_df(n_days: int, start: date = date(2026, 1, 1)) -> pd.DataFrame:
    """Helper: build a point_df with n_days rows."""
    dates = [start + timedelta(days=i) for i in range(n_days)]
    return pd.DataFrame(
        {
            'yhat': np.linspace(100, 200, n_days),
            'yhat_lower': np.linspace(80, 180, n_days),
            'yhat_upper': np.linspace(120, 220, n_days),
        },
        index=pd.DatetimeIndex(dates),
    )


def _make_samples(n_days: int, n_paths: int = 200) -> np.ndarray:
    rng = np.random.default_rng(42)
    return rng.normal(100, 10, (n_days, n_paths))


def test_write_forecast_batch_calls_upsert(mock_supabase_client):
    """2-row batch -> verify upsert called on 'forecast_daily' table, returns 2."""
    point_df = _make_point_df(2)
    samples = _make_samples(2, n_paths=5)
    exog_sig = {'weather_source': 'archive', 'holiday_source': 'api'}

    count = write_forecast_batch(
        mock_supabase_client,
        restaurant_id='rest-001',
        kpi_name='revenue_eur',
        model_name='prophet_v1',
        run_date=date(2026, 4, 29),
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig,
    )

    assert count == 2
    # Should call .table('forecast_daily') exactly once (2 rows < CHUNK_SIZE)
    mock_supabase_client.table.assert_called_with('forecast_daily')
    upsert_mock = mock_supabase_client.table.return_value.upsert
    assert upsert_mock.call_count == 1
    # Verify the rows payload
    rows = upsert_mock.call_args[0][0]
    assert len(rows) == 2
    assert rows[0]['restaurant_id'] == 'rest-001'
    assert rows[0]['kpi_name'] == 'revenue_eur'


def test_write_forecast_batch_chunks_large_batches(mock_supabase_client):
    """365 rows -> verify 4 upsert calls (100+100+100+65), returns 365."""
    point_df = _make_point_df(365)
    samples = _make_samples(365, n_paths=5)
    exog_sig = {'weather_source': 'archive'}

    count = write_forecast_batch(
        mock_supabase_client,
        restaurant_id='rest-001',
        kpi_name='revenue_eur',
        model_name='prophet_v1',
        run_date=date(2026, 4, 29),
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig,
    )

    assert count == 365
    upsert_mock = mock_supabase_client.table.return_value.upsert
    # ceil(365 / 100) = 4 chunks
    assert upsert_mock.call_count == 4
    # Verify chunk sizes: 100, 100, 100, 65
    chunk_sizes = [len(call[0][0]) for call in upsert_mock.call_args_list]
    assert chunk_sizes == [100, 100, 100, 65]


def test_write_forecast_batch_rounds_values(mock_supabase_client):
    """Verify yhat values are rounded to 2 decimals."""
    point_df = pd.DataFrame(
        {
            'yhat': [100.12345],
            'yhat_lower': [90.6789],
            'yhat_upper': [110.999],
        },
        index=pd.DatetimeIndex([date(2026, 1, 1)]),
    )
    samples = np.array([[1.23456, 2.34567]])
    exog_sig = {}

    write_forecast_batch(
        mock_supabase_client,
        restaurant_id='rest-001',
        kpi_name='revenue_eur',
        model_name='prophet_v1',
        run_date=date(2026, 4, 29),
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig,
    )

    rows = mock_supabase_client.table.return_value.upsert.call_args[0][0]
    assert rows[0]['yhat'] == 100.12
    assert rows[0]['yhat_lower'] == 90.68
    assert rows[0]['yhat_upper'] == 111.0


def test_write_forecast_batch_on_conflict_key(mock_supabase_client):
    """Verify the on_conflict kwarg is the 6-column PK."""
    point_df = _make_point_df(1)
    samples = _make_samples(1, n_paths=3)

    write_forecast_batch(
        mock_supabase_client,
        restaurant_id='rest-001',
        kpi_name='revenue_eur',
        model_name='prophet_v1',
        run_date=date(2026, 4, 29),
        forecast_track='bau',
        point_df=point_df,
        samples=samples,
        exog_signature={},
    )

    upsert_mock = mock_supabase_client.table.return_value.upsert
    call_kwargs = upsert_mock.call_args[1]
    expected_key = 'restaurant_id,kpi_name,target_date,model_name,run_date,forecast_track'
    assert call_kwargs['on_conflict'] == expected_key
