"""Phase 14: SARIMAX model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.sarimax_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE from env vars.
Writes 365 rows to forecast_daily via chunked upsert (100 rows/chunk).

Order strategy (autoplan E6):
  Primary:  SARIMAX(1,0,1)(1,1,1,7)
  Fallback: SARIMAX(1,0,1)(0,1,0,7)  — used on LinAlgError or NaN params
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd
import statsmodels.api as sm
from numpy.linalg import LinAlgError

from scripts.forecast.db import make_client
from scripts.forecast.exog import build_exog_matrix, assert_exog_compatible, EXOG_COLUMNS
from scripts.forecast.closed_days import zero_closed_days
from scripts.forecast.sample_paths import paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
PRIMARY_ORDER = (1, 0, 1)
PRIMARY_SEASONAL = (1, 1, 1, 7)
FALLBACK_SEASONAL = (0, 1, 0, 7)
N_PATHS = 200
HORIZON = 365
STEP_NAME = 'forecast_sarimax'
CHUNK_SIZE = 100


def _fetch_history(client, *, restaurant_id: str, kpi_name: str) -> pd.DataFrame:
    """Fetch kpi_daily_mv history for the given restaurant and KPI.

    kpi_daily_mv has columns: restaurant_id, business_date, revenue_cents,
    tx_count, avg_ticket_cents. We rename/derive to the canonical names
    used by model code: date, revenue_eur, invoice_count.
    """
    resp = (
        client.table('kpi_daily_mv')
        .select('business_date,revenue_cents,tx_count')
        .eq('restaurant_id', restaurant_id)
        .order('business_date')
        .limit(10000)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError(f'No history found for restaurant_id={restaurant_id}')
    df = pd.DataFrame(rows)
    # Map actual MV columns to canonical names
    df.rename(columns={'business_date': 'date'}, inplace=True)
    df['date'] = pd.to_datetime(df['date']).dt.date
    df['revenue_eur'] = df['revenue_cents'] / 100.0
    df['invoice_count'] = df['tx_count'].astype(float)
    df = df.sort_values('date').reset_index(drop=True)
    if kpi_name not in df.columns:
        raise RuntimeError(f'KPI column {kpi_name!r} not in kpi_daily_mv response')
    df['y'] = df[kpi_name].astype(float)
    return df


def _fetch_shop_calendar(client, *, restaurant_id: str, start_date: date, end_date: date) -> pd.DataFrame:
    """Fetch shop_calendar rows for the closed-day post-hoc zeroing."""
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


def _drop_metadata_cols(X: pd.DataFrame) -> pd.DataFrame:
    """Drop non-regressor metadata columns before passing to SARIMAX.

    weather_source is a string metadata column; SARIMAX only accepts numeric regressors.
    """
    drop_cols = [c for c in ['weather_source'] if c in X.columns]
    return X.drop(columns=drop_cols)


def _fit_sarimax(y: np.ndarray, X_fit: pd.DataFrame) -> tuple:
    """Fit SARIMAX with primary order, falling back on LinAlgError or NaN params.

    Returns (result, order_used) where order_used is PRIMARY_SEASONAL or FALLBACK_SEASONAL.
    """
    # Shared model kwargs
    model_kwargs = dict(
        exog=X_fit,
        order=PRIMARY_ORDER,
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    fit_kwargs = dict(disp=False, maxiter=200)

    # Try primary seasonal order first
    try:
        model = sm.tsa.SARIMAX(y, seasonal_order=PRIMARY_SEASONAL, **model_kwargs)
        result = model.fit(**fit_kwargs)
        if np.isnan(result.params).any():
            raise ValueError('NaN params in primary SARIMAX fit')
        return result, PRIMARY_SEASONAL
    except (LinAlgError, ValueError) as primary_err:
        print(f'[sarimax_fit] Primary order {PRIMARY_SEASONAL} failed: {primary_err!r}; trying fallback {FALLBACK_SEASONAL}')

    # Fallback to simpler seasonal order
    model = sm.tsa.SARIMAX(y, seasonal_order=FALLBACK_SEASONAL, **model_kwargs)
    result = model.fit(**fit_kwargs)
    if np.isnan(result.params).any():
        raise RuntimeError('NaN params in fallback SARIMAX fit — cannot produce forecast')
    return result, FALLBACK_SEASONAL


def _build_forecast_rows(
    *,
    samples: np.ndarray,
    pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    exog_sig: dict,
    model_name: str = 'sarimax',
) -> list[dict]:
    """Convert sample paths to forecast_daily row dicts.

    samples must be a numpy ndarray of shape (HORIZON, N_PATHS).
    Row i holds N_PATHS values for pred_dates[i].
    """
    rows = []
    for i, target_date in enumerate(pred_dates):
        # samples[i] is a 1D array of N_PATHS values for day i
        path_values = samples[i]
        yhat = float(np.mean(path_values))
        yhat_lower = float(np.percentile(path_values, 10))
        yhat_upper = float(np.percentile(path_values, 90))
        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': str(target_date),
            'model_name': model_name,
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
    """Core logic: fit SARIMAX, generate 200 sample paths, write 365 rows.

    Returns the number of rows written to forecast_daily.
    """
    # 1. Fetch training history
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
    fit_start = history['date'].iloc[0]
    fit_end = history['date'].iloc[-1]
    y = history['y'].values

    # 2. Build fit exog matrix
    X_fit_raw, exog_sig = build_exog_matrix(
        client,
        restaurant_id=restaurant_id,
        start_date=fit_start,
        end_date=fit_end,
    )
    X_fit = _drop_metadata_cols(X_fit_raw)

    # 3. Build prediction exog matrix (run_date+1 through run_date+HORIZON)
    pred_start = run_date + timedelta(days=1)
    pred_end = run_date + timedelta(days=HORIZON)
    pred_dates = [pred_start + timedelta(days=i) for i in range(HORIZON)]

    X_pred_raw, _ = build_exog_matrix(
        client,
        restaurant_id=restaurant_id,
        start_date=pred_start,
        end_date=pred_end,
    )
    X_pred = _drop_metadata_cols(X_pred_raw)

    # 4. Validate column compatibility (autoplan E1)
    assert_exog_compatible(X_fit, X_pred)

    # 5. Fit SARIMAX with fallback (autoplan E6)
    result, seasonal_used = _fit_sarimax(y, X_fit)
    print(f'[sarimax_fit] Fitted SARIMAX{PRIMARY_ORDER}x{seasonal_used} for {kpi_name}')

    # 6. Generate 200 sample paths
    # statsmodels simulate() returns a DataFrame; convert to numpy for consistent indexing
    samples_raw = result.simulate(
        nsimulations=HORIZON,
        repetitions=N_PATHS,
        anchor='end',
        exog=X_pred,
    )
    samples = samples_raw.values if hasattr(samples_raw, 'values') else np.asarray(samples_raw)
    # Expected shape: (nsimulations, repetitions) i.e. (HORIZON, N_PATHS)
    assert samples.shape == (HORIZON, N_PATHS), f'Unexpected samples shape: {samples.shape}'

    # 7. Build forecast rows
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

    # 8. Fetch shop calendar and zero closed days post-hoc
    shop_cal = _fetch_shop_calendar(
        client,
        restaurant_id=restaurant_id,
        start_date=pred_start,
        end_date=pred_end,
    )
    preds_df = zero_closed_days(preds_df, shop_cal)

    # 9. Restore target_date to str for upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)

    # 10. Chunked upsert
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
        print(f'[sarimax_fit] Done: {n} rows written for {kpi_name}')
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        print(f'[sarimax_fit] FAILED:\n{err_msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=err_msg,
                restaurant_id=restaurant_id,
            )
        except Exception as write_err:
            print(f'[sarimax_fit] Could not write failure row: {write_err}', file=sys.stderr)
        sys.exit(1)
