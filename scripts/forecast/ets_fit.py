"""Phase 14: ETS model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.ets_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE from env vars.
Writes 365 rows to forecast_daily via chunked upsert (100 rows/chunk).

Design decisions:
  D-03: Train on open-day-only series (closed days carry structural zeros).
  ETS does not support exog regressors.
  Closed dates in the forecast window are post-hoc zeroed (D-01).
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from statsmodels.tsa.exponential_smoothing.ets import ETSModel

from scripts.forecast.db import make_client
from scripts.forecast.closed_days import zero_closed_days, filter_open_days
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
N_PATHS = 200
HORIZON = 365
STEP_NAME = 'forecast_ets'
CHUNK_SIZE = 100
SEASONAL_PERIODS = 7


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


def _fit_ets(y: np.ndarray) -> object:
    """Fit ETSModel with add/add/add components, falling back gracefully.

    Tries (error='add', trend='add', seasonal='add') first.
    Falls back to (error='add', trend=None, seasonal='add') if convergence fails.
    """
    shared_kwargs = dict(seasonal_periods=SEASONAL_PERIODS)

    try:
        model = ETSModel(y, error='add', trend='add', seasonal='add', **shared_kwargs)
        result = model.fit(disp=False)
        return result
    except Exception as primary_err:
        print(f'[ets_fit] Primary ETS(add,add,add) failed: {primary_err!r}; trying fallback')

    # Fallback: simpler model without trend
    model = ETSModel(y, error='add', trend=None, seasonal='add', **shared_kwargs)
    result = model.fit(disp=False)
    return result


def _open_future_dates(shop_cal: pd.DataFrame, pred_dates: list) -> list:
    """Return subset of pred_dates that are open days (from shop_calendar)."""
    open_set = set(shop_cal.loc[shop_cal['is_open'], 'date'])
    # If date not in calendar assume open (forward dates may be missing)
    return [d for d in pred_dates if d not in set(shop_cal['date']) or d in open_set]


def _build_forecast_rows(
    *,
    samples: np.ndarray,
    open_dates: list,
    all_pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
) -> list[dict]:
    """Build forecast_daily dicts, mapping open-day samples to calendar dates.

    Closed dates receive yhat=0 (handled later by zero_closed_days).
    Open dates use corresponding sample path column.
    """
    # Map open_date -> row index in samples
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
            # Closed day — zeroed later by zero_closed_days
            yhat = 0.0
            yhat_lower = 0.0
            yhat_upper = 0.0
            yhat_samples_json = None

        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': str(target_date),
            'model_name': 'ets',
            'run_date': str(run_date),
            'forecast_track': 'bau',
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': yhat_samples_json,
            'exog_signature': json.dumps({'model': 'ets', 'seasonal_periods': SEASONAL_PERIODS}),
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
    """Core logic: fit ETS on open days, generate 200 sample paths, write 365 rows.

    Returns the number of rows written to forecast_daily.
    """
    # 1. Fetch training history
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)

    # 2. Filter to open days only (D-03)
    open_history = filter_open_days(history)
    if len(open_history) < SEASONAL_PERIODS * 2:
        raise RuntimeError(
            f'Insufficient open-day history: {len(open_history)} rows (need >= {SEASONAL_PERIODS * 2})'
        )
    y = open_history['y'].values

    # 3. Fit ETS model
    result = _fit_ets(y)
    print(f'[ets_fit] Fitted ETS for {kpi_name} on {len(y)} open-day observations')

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

    # 6. Generate 200 sample paths via simulate on open days
    #    simulate(anchor='end') appends n_open steps beyond the fitted end
    sim_raw = result.simulate(
        nsimulations=n_open,
        repetitions=N_PATHS,
        anchor='end',
    )
    samples = sim_raw.values if hasattr(sim_raw, 'values') else np.asarray(sim_raw)
    # Expected shape: (n_open, N_PATHS)
    assert samples.shape == (n_open, N_PATHS), f'Unexpected ETS samples shape: {samples.shape}'

    # 7. Build forecast rows (open days use sample paths, others get 0)
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

    # 8. Zero closed days post-hoc (belt-and-suspenders)
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
        print(f'[ets_fit] Done: {n} rows written for {kpi_name}')
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        print(f'[ets_fit] FAILED:\n{err_msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=err_msg,
                restaurant_id=restaurant_id,
            )
        except Exception as write_err:
            print(f'[ets_fit] Could not write failure row: {write_err}', file=sys.stderr)
        sys.exit(1)
