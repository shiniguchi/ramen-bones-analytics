"""Phase 14 / 15-10: SARIMAX model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.sarimax_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE, GRANULARITY from env vars.

15-10 changes:
  - GRANULARITY env (day|week|month) selects native bucket cadence.
  - TRAIN_END computed per grain so each native horizon ends at the same
    real-world date target (D-14).
  - Horizon, seasonal period, and aggregation step all swing with grain.
  - Closed-days post-hoc zeroing only applies at daily grain.

Order strategy (autoplan E6) per grain:
  Daily:   SARIMAX(1,0,1)(1,1,1,7)   fallback (0,1,0,7)
  Weekly:  SARIMAX(1,0,1)(1,1,1,52)  fallback (0,1,0,52)
  Monthly: SARIMAX(1,0,1)(1,1,1,12)  fallback (0,1,0,12)
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
from dateutil.relativedelta import relativedelta
from numpy.linalg import LinAlgError

from scripts.forecast.db import make_client
from scripts.forecast.exog import build_exog_matrix, assert_exog_compatible, EXOG_COLUMNS
from scripts.forecast.closed_days import zero_closed_days
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly
from scripts.forecast.sample_paths import paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
PRIMARY_ORDER = (1, 0, 1)
N_PATHS = 200
STEP_NAME = 'forecast_sarimax'
CHUNK_SIZE = 100

# 15-10: per-grain knobs (D-14).
HORIZON_BY_GRAIN = {'day': 372, 'week': 57, 'month': 17}
SEASONAL_PERIOD_BY_GRAIN = {'day': 7, 'week': 52, 'month': 12}


def _seasonal_orders(granularity: str) -> tuple:
    """Return (primary, fallback) seasonal_order tuples for the given grain."""
    period = SEASONAL_PERIOD_BY_GRAIN[granularity]
    return (1, 1, 1, period), (0, 1, 0, period)


def _train_end_for_grain(last_actual: date, granularity: str) -> date:
    """Compute the grain-specific TRAIN_END cutoff.

    Daily : last_actual - 7 days
    Weekly: last_actual - 35 days (5 weeks back so week buckets are complete)
    Monthly: end-of-month for (last_actual.month - 5 calendar months)
    """
    if granularity == 'day':
        return last_actual - timedelta(days=7)
    if granularity == 'week':
        return last_actual - timedelta(days=35)
    if granularity == 'month':
        # "end of (last_actual minus 5 calendar months)".
        # Step 1: subtract 5 months from last_actual to land somewhere in target month.
        # Step 2: roll to the last day of THAT month.
        anchor = last_actual - relativedelta(months=5)
        first_of_anchor = anchor.replace(day=1)
        # End of anchor month = (first of next month) - 1 day.
        end_of_anchor = (first_of_anchor + relativedelta(months=1)) - timedelta(days=1)
        return end_of_anchor
    raise ValueError(f'Unknown granularity: {granularity!r}')


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


def _fit_sarimax(y: np.ndarray, X_fit: Optional[pd.DataFrame], granularity: str) -> tuple:
    """Fit SARIMAX with primary order, falling back on LinAlgError or NaN params.

    Returns (result, order_used) where order_used is the seasonal_order tuple
    actually picked. X_fit may be None for non-daily grains (no exog at week/month).
    """
    primary_seasonal, fallback_seasonal = _seasonal_orders(granularity)
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
        model = sm.tsa.SARIMAX(y, seasonal_order=primary_seasonal, **model_kwargs)
        result = model.fit(**fit_kwargs)
        if np.isnan(result.params).any():
            raise ValueError('NaN params in primary SARIMAX fit')
        return result, primary_seasonal
    except (LinAlgError, ValueError) as primary_err:
        print(f'[sarimax_fit] Primary order {primary_seasonal} failed: {primary_err!r}; trying fallback {fallback_seasonal}')

    # Fallback to simpler seasonal order
    model = sm.tsa.SARIMAX(y, seasonal_order=fallback_seasonal, **model_kwargs)
    result = model.fit(**fit_kwargs)
    if np.isnan(result.params).any():
        raise RuntimeError('NaN params in fallback SARIMAX fit — cannot produce forecast')
    return result, fallback_seasonal


def _build_forecast_rows(
    *,
    samples: np.ndarray,
    pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str,
    exog_sig: dict,
    model_name: str = 'sarimax',
) -> list:
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
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': paths_to_jsonb(samples, i),
            'exog_signature': json.dumps(exog_sig),
        })
    return rows


def _upsert_rows(client, rows: list) -> int:
    """Upsert rows in chunks of CHUNK_SIZE. Returns total count inserted/updated."""
    total = 0
    for start in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[start:start + CHUNK_SIZE]
        client.table('forecast_daily').upsert(chunk).execute()
        total += len(chunk)
    return total


def _pred_dates_for_grain(*, run_date: date, granularity: str, horizon: int) -> list:
    """Build list of native-cadence target_dates starting one bucket after run_date.

    Daily : run_date+1, +2, ... +HORIZON days
    Weekly: next ISO Monday after run_date, then +7d steps
    Monthly: first-of-month after run_date, then +1 month steps
    """
    if granularity == 'day':
        return [run_date + timedelta(days=i + 1) for i in range(horizon)]
    if granularity == 'week':
        # ISO Monday of week strictly after run_date.
        # weekday(): Mon=0..Sun=6. Days to next Monday = (7 - weekday) % 7, but
        # if run_date itself is a Mon we still want NEXT Mon (not same day).
        days_to_next_mon = (7 - run_date.weekday()) % 7
        if days_to_next_mon == 0:
            days_to_next_mon = 7
        first_mon = run_date + timedelta(days=days_to_next_mon)
        return [first_mon + timedelta(days=7 * i) for i in range(horizon)]
    if granularity == 'month':
        # First-of-month strictly after run_date.
        first = (run_date.replace(day=1) + relativedelta(months=1))
        return [(first + relativedelta(months=i)) for i in range(horizon)]
    raise ValueError(f'Unknown granularity: {granularity!r}')


def fit_and_write(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str = 'day',
) -> int:
    """Core logic: fit SARIMAX, generate sample paths, write rows.

    Returns the number of rows written to forecast_daily.
    """
    horizon = HORIZON_BY_GRAIN[granularity]

    # 1. Fetch training history (always daily from kpi_daily_mv).
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
    last_actual = history['date'].iloc[-1]
    train_end = _train_end_for_grain(last_actual, granularity)
    print(
        f'[sarimax_fit] grain={granularity} last_actual={last_actual} '
        f'train_end={train_end} horizon={horizon}'
    )

    # 2. Reduce to <= train_end (daily) BEFORE bucketing for week/month grains.
    history = history[history['date'] <= train_end].reset_index(drop=True)
    if history.empty:
        raise RuntimeError(f'Empty history after train_end cutoff {train_end}')

    if granularity == 'day':
        # 3a. Daily path keeps exog regressors and closed-day zeroing.
        fit_start = history['date'].iloc[0]
        fit_end = history['date'].iloc[-1]
        y = history['y'].values

        X_fit_raw, exog_sig = build_exog_matrix(
            client,
            restaurant_id=restaurant_id,
            start_date=fit_start,
            end_date=fit_end,
        )
        X_fit = _drop_metadata_cols(X_fit_raw)
        # Align exog to history dates (kpi_daily_mv may have gaps for zero-tx days)
        history_dates = set(history['date'])
        X_fit = X_fit.loc[X_fit.index.isin(history_dates)]

        pred_dates = _pred_dates_for_grain(
            run_date=run_date, granularity='day', horizon=horizon,
        )
        pred_start = pred_dates[0]
        pred_end = pred_dates[-1]
        X_pred_raw, _ = build_exog_matrix(
            client,
            restaurant_id=restaurant_id,
            start_date=pred_start,
            end_date=pred_end,
        )
        X_pred = _drop_metadata_cols(X_pred_raw)
        assert_exog_compatible(X_fit, X_pred)

        result, seasonal_used = _fit_sarimax(y, X_fit, granularity)
        print(f'[sarimax_fit] Fitted SARIMAX{PRIMARY_ORDER}x{seasonal_used} for {kpi_name}/{granularity}')

        samples_raw = result.simulate(
            nsimulations=horizon,
            repetitions=N_PATHS,
            anchor='end',
            exog=X_pred,
        )
    else:
        # 3b. Weekly/monthly: aggregate first, no exog (SARIMAX exog at higher
        # grain mixes apples/oranges since most exog signals are calendar-day-level).
        if granularity == 'week':
            agg = bucket_to_weekly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'week_start': 'bucket_start'})
        else:  # 'month'
            agg = bucket_to_monthly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'month_start': 'bucket_start'})

        if agg.empty:
            raise RuntimeError(f'Empty aggregation for grain={granularity}')

        y = agg['y'].astype(float).values
        # Need at least 2 full seasonal cycles to fit.
        period = SEASONAL_PERIOD_BY_GRAIN[granularity]
        if len(y) < period * 2:
            raise RuntimeError(
                f'Insufficient {granularity} history: {len(y)} buckets (need >= {period * 2})'
            )

        result, seasonal_used = _fit_sarimax(y, None, granularity)
        print(f'[sarimax_fit] Fitted SARIMAX{PRIMARY_ORDER}x{seasonal_used} for {kpi_name}/{granularity}')

        pred_dates = _pred_dates_for_grain(
            run_date=run_date, granularity=granularity, horizon=horizon,
        )
        samples_raw = result.simulate(
            nsimulations=horizon,
            repetitions=N_PATHS,
            anchor='end',
        )
        exog_sig = {'model': 'sarimax', 'granularity': granularity, 'seasonal_period': period}

    samples = samples_raw.values if hasattr(samples_raw, 'values') else np.asarray(samples_raw)
    # Expected shape: (nsimulations, repetitions) i.e. (horizon, N_PATHS)
    assert samples.shape == (horizon, N_PATHS), f'Unexpected samples shape: {samples.shape}'

    # 4. Build forecast rows
    rows = _build_forecast_rows(
        samples=samples,
        pred_dates=pred_dates,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        granularity=granularity,
        exog_sig=exog_sig,
    )
    preds_df = pd.DataFrame(rows)
    preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date

    # 5. Closed-day post-hoc zeroing only applies at daily grain.
    if granularity == 'day':
        shop_cal = _fetch_shop_calendar(
            client,
            restaurant_id=restaurant_id,
            start_date=pred_dates[0],
            end_date=pred_dates[-1],
        )
        preds_df = zero_closed_days(preds_df, shop_cal)

    # 6. Restore target_date to str for upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)

    # 7. Chunked upsert
    final_rows = preds_df.to_dict(orient='records')
    n = _upsert_rows(client, final_rows)
    return n


if __name__ == '__main__':
    # Read env vars
    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    kpi_name = os.environ.get('KPI_NAME', '').strip()
    run_date_str = os.environ.get('RUN_DATE', '').strip()
    granularity = os.environ.get('GRANULARITY', 'day').strip() or 'day'

    if not restaurant_id or not kpi_name or not run_date_str:
        print('ERROR: RESTAURANT_ID, KPI_NAME, and RUN_DATE env vars are required', file=sys.stderr)
        sys.exit(1)
    if granularity not in HORIZON_BY_GRAIN:
        print(f'ERROR: invalid GRANULARITY {granularity!r}; expected one of {list(HORIZON_BY_GRAIN)}', file=sys.stderr)
        sys.exit(1)

    run_date = date.fromisoformat(run_date_str)
    started_at = datetime.now(timezone.utc)
    client = make_client()

    try:
        n = fit_and_write(
            client,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity=granularity,
        )
        write_success(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            row_count=n,
            restaurant_id=restaurant_id,
        )
        print(f'[sarimax_fit] Done: {n} rows written for {kpi_name}/{granularity}')
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
