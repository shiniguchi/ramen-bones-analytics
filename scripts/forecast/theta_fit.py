"""Phase 14: AutoTheta model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.theta_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE from env vars.
Writes 365 rows to forecast_daily via chunked upsert (100 rows/chunk).

Design decisions:
  D-03: Train on open-day-only series.
  D-16: Bootstrap residuals for 200 sample paths (no native simulate in StatsForecast).
  No exog — Theta is purely univariate.
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import AutoTheta

from scripts.forecast.db import make_client
from scripts.forecast.closed_days import zero_closed_days, filter_open_days
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
N_PATHS = 200
HORIZON = 365
STEP_NAME = 'forecast_theta'
CHUNK_SIZE = 100
SEASON_LENGTH = 7  # weekly seasonality


def _fetch_history(client, *, restaurant_id: str, kpi_name: str) -> pd.DataFrame:
    """Fetch kpi_daily_mv history including is_open flag for open-day filtering."""
    resp = (
        client.table('kpi_daily_mv')
        .select('date,revenue_eur,invoice_count,is_open')
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
    """Fetch shop_calendar rows for the forecast window."""
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


def _fit_theta(y: np.ndarray) -> tuple:
    """Fit AutoTheta on open-day series.

    StatsForecast expects a DataFrame with columns: unique_id, ds, y.
    freq=1 means integer-indexed (step = one open day).

    Returns (fitted StatsForecast object, in-sample fitted values for residual computation).
    """
    n = len(y)
    # Build integer time index (open-day index, not calendar dates)
    train_df = pd.DataFrame({
        'unique_id': ['ts'] * n,
        'ds': np.arange(n),
        'y': y.astype(float),
    })

    sf = StatsForecast(
        models=[AutoTheta(season_length=SEASON_LENGTH)],
        freq=1,
    )
    sf.fit(train_df)
    return sf, train_df


def _open_future_dates(shop_cal: pd.DataFrame, pred_dates: list) -> list:
    """Return subset of pred_dates that are open days."""
    open_set = set(shop_cal.loc[shop_cal['is_open'], 'date'])
    cal_dates = set(shop_cal['date'])
    return [d for d in pred_dates if d not in cal_dates or d in open_set]


def _build_forecast_rows(
    *,
    samples: np.ndarray,
    open_dates: list,
    all_pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
) -> list[dict]:
    """Map open-day samples to calendar forecast rows. Closed dates get yhat=0."""
    open_date_idx = {d: i for i, d in enumerate(open_dates)}

    rows = []
    for target_date in all_pred_dates:
        idx = open_date_idx.get(target_date)
        if idx is not None and idx < len(samples):
            path_values = samples[idx]
            yhat = float(np.mean(path_values))
            yhat_lower = float(np.percentile(path_values, 10))
            yhat_upper = float(np.percentile(path_values, 90))
            yhat_samples_json = paths_to_jsonb(samples, idx)
        else:
            yhat = 0.0
            yhat_lower = 0.0
            yhat_upper = 0.0
            yhat_samples_json = None

        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': str(target_date),
            'model_name': 'theta',
            'run_date': str(run_date),
            'forecast_track': 'bau',
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': yhat_samples_json,
            'exog_signature': json.dumps({'model': 'theta', 'season_length': SEASON_LENGTH}),
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
    """Core logic: fit AutoTheta on open days, bootstrap 200 paths, write 365 rows.

    Returns the number of rows written to forecast_daily.
    """
    # 1. Fetch training history
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)

    # 2. Filter to open days only (D-03)
    open_history = filter_open_days(history)
    if len(open_history) < SEASON_LENGTH * 2:
        raise RuntimeError(
            f'Insufficient open-day history: {len(open_history)} rows (need >= {SEASON_LENGTH * 2})'
        )
    y = open_history['y'].values

    # 3. Fit AutoTheta model
    sf, train_df = _fit_theta(y)
    print(f'[theta_fit] Fitted AutoTheta for {kpi_name} on {len(y)} open-day observations')

    # 4. Define prediction window
    pred_start = run_date + timedelta(days=1)
    pred_end = run_date + timedelta(days=HORIZON)
    all_pred_dates = [pred_start + timedelta(days=i) for i in range(HORIZON)]

    # 5. Fetch shop calendar and find open future dates
    shop_cal = _fetch_shop_calendar(
        client,
        restaurant_id=restaurant_id,
        start_date=pred_start,
        end_date=pred_end,
    )
    open_future = _open_future_dates(shop_cal, all_pred_dates)
    n_open = len(open_future)
    if n_open == 0:
        raise RuntimeError('No open days in forecast window — check shop_calendar')

    # 6. Point forecast for n_open open days using StatsForecast predict
    #    Returns DataFrame with columns: unique_id, ds, AutoTheta
    pred_df = sf.predict(h=n_open)
    point_forecast = pred_df['AutoTheta'].values  # shape: (n_open,)

    # 7. Compute in-sample residuals for bootstrap (D-16)
    #    Use fitted values from the training pass to get residuals
    fitted_df = sf.forecast_fitted_values()
    fitted_vals = fitted_df['AutoTheta'].values
    residuals = y[:len(fitted_vals)] - fitted_vals
    residuals = residuals[~np.isnan(residuals)]  # strip NaN warm-up period

    # 8. Bootstrap 200 sample paths from residuals (D-16)
    samples = bootstrap_from_residuals(
        point_forecast=point_forecast,
        residuals=residuals,
        n_paths=N_PATHS,
    )
    assert samples.shape == (n_open, N_PATHS), f'Unexpected samples shape: {samples.shape}'

    # 9. Build forecast rows
    rows = _build_forecast_rows(
        samples=samples,
        open_dates=open_future,
        all_pred_dates=all_pred_dates,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
    )
    preds_df = pd.DataFrame(rows)
    preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date

    # 10. Zero closed days post-hoc (belt-and-suspenders)
    preds_df = zero_closed_days(preds_df, shop_cal)

    # 11. Restore target_date to str for upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)

    # 12. Chunked upsert
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
        print(f'[theta_fit] Done: {n} rows written for {kpi_name}')
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        print(f'[theta_fit] FAILED:\n{err_msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=err_msg,
                restaurant_id=restaurant_id,
            )
        except Exception as write_err:
            print(f'[theta_fit] Could not write failure row: {write_err}', file=sys.stderr)
        sys.exit(1)
