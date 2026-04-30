"""Phase 14 / 15-10: Prophet model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.prophet_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE, GRANULARITY from env vars.

15-10 changes:
  - GRANULARITY env (day|week|month) selects native bucket cadence.
  - Daily path keeps the original Prophet+exog setup (C-04: yearly_seasonality
    stays False until 730 days of history).
  - Weekly/monthly paths drop exog regressors (exog matrix is daily-shaped;
    bucket-aggregating it is out of scope) and tune Prophet's seasonality
    flags to the bucket cadence.

Constraint C-04: yearly_seasonality MUST be False until history >= 730 days
(daily) / 104 weeks / 24 months. Naive guard: count buckets, gate.
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
from dateutil.relativedelta import relativedelta
from prophet import Prophet

from scripts.forecast.db import make_client
from scripts.forecast.exog import build_exog_matrix, EXOG_COLUMNS
from scripts.forecast.closed_days import zero_closed_days
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly
from scripts.forecast.sample_paths import paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
N_PATHS = 200
STEP_NAME = 'forecast_prophet'
CHUNK_SIZE = 100

# 15-10: per-grain knobs (D-14).
HORIZON_BY_GRAIN = {'day': 372, 'week': 57, 'month': 17}
# Yearly seasonality requires ~2 full cycles; numbers in native buckets.
YEARLY_THRESHOLD_BY_GRAIN = {'day': 730, 'week': 104, 'month': 24}

# Regressor columns — weather_source is metadata, not a numeric regressor
_REGRESSOR_COLS = [c for c in EXOG_COLUMNS if c != 'weather_source']


def _train_end_for_grain(last_actual: date, granularity: str) -> date:
    """Compute the grain-specific TRAIN_END cutoff (D-14)."""
    if granularity == 'day':
        return last_actual - timedelta(days=7)
    if granularity == 'week':
        return last_actual - timedelta(days=35)
    if granularity == 'month':
        anchor = last_actual - relativedelta(months=5)
        first_of_anchor = anchor.replace(day=1)
        end_of_anchor = (first_of_anchor + relativedelta(months=1)) - timedelta(days=1)
        return end_of_anchor
    raise ValueError(f'Unknown granularity: {granularity!r}')


def _pred_dates_for_grain(*, run_date: date, granularity: str, horizon: int) -> list:
    """Build native-cadence target_dates starting one bucket after run_date."""
    if granularity == 'day':
        return [run_date + timedelta(days=i + 1) for i in range(horizon)]
    if granularity == 'week':
        days_to_next_mon = (7 - run_date.weekday()) % 7
        if days_to_next_mon == 0:
            days_to_next_mon = 7
        first_mon = run_date + timedelta(days=days_to_next_mon)
        return [first_mon + timedelta(days=7 * i) for i in range(horizon)]
    if granularity == 'month':
        first = (run_date.replace(day=1) + relativedelta(months=1))
        return [(first + relativedelta(months=i)) for i in range(horizon)]
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


def _build_prophet_df(history: pd.DataFrame, X_fit: Optional[pd.DataFrame]) -> pd.DataFrame:
    """Build Prophet training DataFrame with ds, y, and (daily-only) regressor columns."""
    df = pd.DataFrame({
        'ds': pd.to_datetime(history['date']),
        'y': history['y'].values,
    })
    if X_fit is not None:
        X_reset = X_fit.reset_index(drop=True)
        for col in _REGRESSOR_COLS:
            if col in X_reset.columns:
                df[col] = X_reset[col].values
    return df


def _build_future_df(pred_dates: list, X_pred: Optional[pd.DataFrame]) -> pd.DataFrame:
    """Build Prophet future DataFrame with ds and (daily-only) regressor columns."""
    future = pd.DataFrame({'ds': pd.to_datetime(pred_dates)})
    if X_pred is not None:
        X_reset = X_pred.reset_index(drop=True)
        for col in _REGRESSOR_COLS:
            if col in X_reset.columns:
                future[col] = X_reset[col].values
    return future


def _fit_prophet(
    train_df: pd.DataFrame,
    *,
    granularity: str,
    use_regressors: bool,
    n_buckets: int,
) -> Prophet:
    """Fit Prophet with grain-aware seasonality flags.

    C-04: yearly_seasonality stays False until 2 full yearly cycles of buckets
    are present (730d / 104w / 24m). Weekly seasonality is meaningless when
    each row IS a week or month bucket.
    """
    yearly_ok = n_buckets >= YEARLY_THRESHOLD_BY_GRAIN[granularity]
    weekly_seasonality = (granularity == 'day')

    m = Prophet(
        yearly_seasonality=yearly_ok,
        weekly_seasonality=weekly_seasonality,
        daily_seasonality=False,
        uncertainty_samples=N_PATHS,
    )
    if use_regressors:
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
    granularity: str,
    exog_sig: dict,
) -> list:
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


def fit_and_write(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str = 'day',
) -> int:
    """Core logic: fit Prophet at the chosen grain, generate sample paths, write rows.

    Returns the number of rows written to forecast_daily.
    """
    horizon = HORIZON_BY_GRAIN[granularity]

    # 1. Fetch training history (daily from kpi_daily_mv).
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
    last_actual = history['date'].iloc[-1]
    train_end = _train_end_for_grain(last_actual, granularity)
    print(
        f'[prophet_fit] grain={granularity} last_actual={last_actual} '
        f'train_end={train_end} horizon={horizon}'
    )

    # 2. Truncate to <= train_end before bucketing.
    history = history[history['date'] <= train_end].reset_index(drop=True)
    if history.empty:
        raise RuntimeError(f'Empty history after train_end cutoff {train_end}')

    if granularity == 'day':
        # 3a. Daily path keeps exog regressors.
        fit_start = history['date'].iloc[0]
        fit_end = history['date'].iloc[-1]
        X_fit, exog_sig = build_exog_matrix(
            client,
            restaurant_id=restaurant_id,
            start_date=fit_start,
            end_date=fit_end,
        )
        history_dates = set(history['date'])
        X_fit = X_fit.loc[X_fit.index.isin(history_dates)]

        train_df = _build_prophet_df(history, X_fit)

        pred_dates = _pred_dates_for_grain(
            run_date=run_date, granularity='day', horizon=horizon,
        )
        pred_start = pred_dates[0]
        pred_end = pred_dates[-1]
        X_pred, _ = build_exog_matrix(
            client,
            restaurant_id=restaurant_id,
            start_date=pred_start,
            end_date=pred_end,
        )
        future_df = _build_future_df(pred_dates, X_pred)
        nan_count = future_df[[c for c in _REGRESSOR_COLS if c in future_df.columns]].isna().sum().sum()
        assert nan_count == 0, f'NaN in future regressor columns: {nan_count} cells'

        n_buckets = len(history)
        m = _fit_prophet(train_df, granularity='day', use_regressors=True, n_buckets=n_buckets)
    else:
        # 3b. Weekly/monthly: bucket then fit without regressors.
        if granularity == 'week':
            agg = bucket_to_weekly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'week_start': 'ds'})
        else:  # 'month'
            agg = bucket_to_monthly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'month_start': 'ds'})
        if agg.empty:
            raise RuntimeError(f'Empty aggregation for grain={granularity}')

        train_df = pd.DataFrame({
            'ds': pd.to_datetime(agg['ds']),
            'y': agg['y'].astype(float).values,
        })

        n_buckets = len(train_df)
        if n_buckets < 2:
            raise RuntimeError(
                f'Insufficient {granularity} history: {n_buckets} buckets'
            )

        pred_dates = _pred_dates_for_grain(
            run_date=run_date, granularity=granularity, horizon=horizon,
        )
        future_df = _build_future_df(pred_dates, None)

        m = _fit_prophet(train_df, granularity=granularity, use_regressors=False, n_buckets=n_buckets)
        exog_sig = {'model': 'prophet', 'granularity': granularity, 'n_buckets': n_buckets}

    print(f'[prophet_fit] Fitted Prophet for {kpi_name}/{granularity}')

    # 4. Generate sample paths via predictive_samples.
    raw = m.predictive_samples(future_df)
    samples = raw['yhat']  # shape: (HORIZON, N_PATHS)
    assert samples.shape == (horizon, N_PATHS), f'Unexpected samples shape: {samples.shape}'

    # 5. Build forecast rows.
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

    # 6. Closed-day post-hoc zeroing only at daily grain.
    if granularity == 'day':
        shop_cal = _fetch_shop_calendar(
            client,
            restaurant_id=restaurant_id,
            start_date=pred_dates[0],
            end_date=pred_dates[-1],
        )
        preds_df = zero_closed_days(preds_df, shop_cal)

    # 7. Restore target_date to str for upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)

    # 8. Chunked upsert
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
        print(f'[prophet_fit] Done: {n} rows written for {kpi_name}/{granularity}')
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
