"""Phase 14: Prophet model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.prophet_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE from env vars.
Writes 365 rows to forecast_daily via chunked upsert (100 rows/chunk).

Constraint C-04: yearly_seasonality MUST be False until history >= 730 days.
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from prophet import Prophet

from scripts.forecast.db import make_client
from scripts.forecast.exog import build_exog_matrix, EXOG_COLUMNS
from scripts.forecast.closed_days import zero_closed_days
from scripts.forecast.sample_paths import paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
N_PATHS = 200
HORIZON = 365
STEP_NAME = 'forecast_prophet'
CHUNK_SIZE = 100

# Regressor columns — weather_source is metadata, not a numeric regressor
_REGRESSOR_COLS = [c for c in EXOG_COLUMNS if c != 'weather_source']


def _fetch_history(client, *, restaurant_id: str, kpi_name: str) -> pd.DataFrame:
    """Fetch kpi_daily_mv history for the given restaurant and KPI."""
    resp = (
        client.table('kpi_daily_mv')
        .select('date,revenue_eur,invoice_count')
        .eq('restaurant_id', restaurant_id)
        .order('date')
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError(f'No history found for restaurant_id={restaurant_id}')
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date']).dt.date
    df = df.sort_values('date').reset_index(drop=True)
    if kpi_name not in df.columns:
        raise RuntimeError(f'KPI column {kpi_name!r} not in kpi_daily_mv response')
    df['y'] = df[kpi_name].astype(float)
    return df


def _fetch_shop_calendar(client, *, restaurant_id: str, start_date: date, end_date: date) -> pd.DataFrame:
    """Fetch shop_calendar rows for closed-day post-hoc zeroing."""
    resp = (
        client.table('shop_calendar')
        .select('date,is_open')
        .eq('restaurant_id', restaurant_id)
        .gte('date', str(start_date))
        .lte('date', str(end_date))
        .execute()
    )
    rows = resp.data or []
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=['date', 'is_open'])
    if not df.empty:
        df['date'] = pd.to_datetime(df['date']).dt.date
    return df


def _build_prophet_df(history: pd.DataFrame, X_fit: pd.DataFrame) -> pd.DataFrame:
    """Build Prophet training DataFrame with ds, y, and regressor columns.

    Prophet requires columns named 'ds' (datetime) and 'y' (target).
    NaN in y is accepted by Prophet. Regressors must be non-NaN.
    """
    df = pd.DataFrame({
        'ds': pd.to_datetime(history['date']),
        'y': history['y'].values,
    })
    # Attach regressor columns from exog matrix
    X_reset = X_fit.reset_index(drop=True)
    for col in _REGRESSOR_COLS:
        if col in X_reset.columns:
            df[col] = X_reset[col].values
    return df


def _build_future_df(pred_dates: list, X_pred: pd.DataFrame) -> pd.DataFrame:
    """Build Prophet future DataFrame with ds and regressor columns.

    NaN in regressor columns is NOT allowed — asserted before use.
    """
    future = pd.DataFrame({'ds': pd.to_datetime(pred_dates)})
    X_reset = X_pred.reset_index(drop=True)
    for col in _REGRESSOR_COLS:
        if col in X_reset.columns:
            future[col] = X_reset[col].values
    return future


def _fit_prophet(train_df: pd.DataFrame) -> Prophet:
    """Fit Prophet model with weekly seasonality and regressors.

    C-04: yearly_seasonality=False required until history >= 730 days.
    """
    m = Prophet(
        yearly_seasonality=False,   # C-04: must stay False for short history
        weekly_seasonality=True,
        daily_seasonality=False,
        uncertainty_samples=N_PATHS,
    )
    # Add numeric regressors (exclude weather_source which is a metadata string)
    for col in _REGRESSOR_COLS:
        if col in train_df.columns:
            m.add_regressor(col)
    m.fit(train_df)
    return m


def _build_forecast_rows(
    *,
    samples: np.ndarray,
    pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    exog_sig: dict,
) -> list[dict]:
    """Convert Prophet sample paths to forecast_daily row dicts.

    samples shape: (HORIZON, N_PATHS).
    """
    rows = []
    for i, target_date in enumerate(pred_dates):
        path_values = samples[i]
        yhat = float(np.mean(path_values))
        yhat_lower = float(np.percentile(path_values, 10))
        yhat_upper = float(np.percentile(path_values, 90))
        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': str(target_date),
            'model_name': 'prophet',
            'run_date': str(run_date),
            'forecast_track': 'bau',
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': paths_to_jsonb(samples, i),
            'exog_signature': json.dumps(exog_sig),
        })
    return rows


def _upsert_rows(client, rows: list[dict]) -> int:
    """Upsert rows in chunks of CHUNK_SIZE. Returns total count inserted/updated."""
    total = 0
    for start in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[start:start + CHUNK_SIZE]
        client.table('forecast_daily').upsert(chunk).execute()
        total += len(chunk)
    return total


def fit_and_write(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
) -> int:
    """Core logic: fit Prophet, generate 200 sample paths, write 365 rows.

    Returns the number of rows written to forecast_daily.
    """
    # 1. Fetch training history
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
    fit_start = history['date'].iloc[0]
    fit_end = history['date'].iloc[-1]

    # 2. Build fit exog matrix
    X_fit, exog_sig = build_exog_matrix(
        client,
        restaurant_id=restaurant_id,
        start_date=fit_start,
        end_date=fit_end,
    )

    # 3. Build Prophet training DataFrame
    train_df = _build_prophet_df(history, X_fit)

    # 4. Build prediction range and exog matrix
    pred_start = run_date + timedelta(days=1)
    pred_end = run_date + timedelta(days=HORIZON)
    pred_dates = [pred_start + timedelta(days=i) for i in range(HORIZON)]

    X_pred, _ = build_exog_matrix(
        client,
        restaurant_id=restaurant_id,
        start_date=pred_start,
        end_date=pred_end,
    )

    # 5. Build future DataFrame and validate no NaN in regressors
    future_df = _build_future_df(pred_dates, X_pred)
    nan_count = future_df[[c for c in _REGRESSOR_COLS if c in future_df.columns]].isna().sum().sum()
    assert nan_count == 0, f'NaN in future regressor columns: {nan_count} cells'

    # 6. Fit Prophet model
    m = _fit_prophet(train_df)
    print(f'[prophet_fit] Fitted Prophet for {kpi_name}')

    # 7. Generate 200 sample paths via predictive_samples
    # Returns dict {'yhat': ndarray of shape (n_samples, n_forecast)}
    raw = m.predictive_samples(future_df)
    yhat_samples = raw['yhat']  # shape: (N_PATHS, HORIZON)
    # Transpose to (HORIZON, N_PATHS) for consistent indexing with sarimax
    samples = yhat_samples.T
    assert samples.shape == (HORIZON, N_PATHS), f'Unexpected samples shape: {samples.shape}'

    # 8. Build forecast rows
    rows = _build_forecast_rows(
        samples=samples,
        pred_dates=pred_dates,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        exog_sig=exog_sig,
    )
    preds_df = pd.DataFrame(rows)
    preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date

    # 9. Fetch shop calendar and zero closed days post-hoc
    shop_cal = _fetch_shop_calendar(
        client,
        restaurant_id=restaurant_id,
        start_date=pred_start,
        end_date=pred_end,
    )
    preds_df = zero_closed_days(preds_df, shop_cal)

    # 10. Restore target_date to str for upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)

    # 11. Chunked upsert
    final_rows = preds_df.to_dict(orient='records')
    n = _upsert_rows(client, final_rows)
    return n


if __name__ == '__main__':
    # Read env vars
    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    kpi_name = os.environ.get('KPI_NAME', '').strip()
    run_date_str = os.environ.get('RUN_DATE', '').strip()

    if not restaurant_id or not kpi_name or not run_date_str:
        print('ERROR: RESTAURANT_ID, KPI_NAME, and RUN_DATE env vars are required', file=sys.stderr)
        sys.exit(1)

    run_date = date.fromisoformat(run_date_str)
    started_at = datetime.now(timezone.utc)
    client = make_client()

    try:
        n = fit_and_write(client, restaurant_id=restaurant_id, kpi_name=kpi_name, run_date=run_date)
        write_success(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            row_count=n,
            restaurant_id=restaurant_id,
        )
        print(f'[prophet_fit] Done: {n} rows written for {kpi_name}')
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        print(f'[prophet_fit] FAILED:\n{err_msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=err_msg,
                restaurant_id=restaurant_id,
            )
        except Exception as write_err:
            print(f'[prophet_fit] Could not write failure row: {write_err}', file=sys.stderr)
        sys.exit(1)
