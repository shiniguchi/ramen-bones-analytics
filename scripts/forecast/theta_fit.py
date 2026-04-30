"""Phase 14 / 15-10: AutoTheta model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.theta_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE, GRANULARITY from env vars.

Design decisions:
  D-03: Daily grain trains on open-day-only series. Weekly/monthly grains
        aggregate the full daily history (closed days roll into bucket sums).
  D-16: Bootstrap residuals for 200 sample paths (no native simulate in
        StatsForecast).
  No exog — Theta is purely univariate.

15-10: GRANULARITY env (day|week|month) selects native bucket cadence,
TRAIN_END (D-14), horizon, and season_length.
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from dateutil.relativedelta import relativedelta
from statsforecast import StatsForecast
from statsforecast.models import AutoTheta

from scripts.forecast.db import make_client
from scripts.forecast.closed_days import zero_closed_days, filter_open_days
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
N_PATHS = 200
STEP_NAME = 'forecast_theta'
CHUNK_SIZE = 100

# 15-10: per-grain knobs (D-14).
HORIZON_BY_GRAIN = {'day': 372, 'week': 57, 'month': 17}
SEASON_LENGTH_BY_GRAIN = {'day': 7, 'week': 52, 'month': 12}


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
    """Fetch kpi_daily_mv history and shop_calendar is_open for open-day filtering."""
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
    df.rename(columns={'business_date': 'date'}, inplace=True)
    df['date'] = pd.to_datetime(df['date']).dt.date
    df['revenue_eur'] = df['revenue_cents'] / 100.0
    df['invoice_count'] = df['tx_count'].astype(float)
    df = df.sort_values('date').reset_index(drop=True)

    cal_resp = (
        client.table('shop_calendar')
        .select('date,is_open')
        .eq('restaurant_id', restaurant_id)
        .gte('date', str(df['date'].iloc[0]))
        .lte('date', str(df['date'].iloc[-1]))
        .limit(10000)
        .execute()
    )
    cal_rows = cal_resp.data or []
    if cal_rows:
        cal_df = pd.DataFrame(cal_rows)
        cal_df['date'] = pd.to_datetime(cal_df['date']).dt.date
        cal_lookup = dict(zip(cal_df['date'], cal_df['is_open']))
        df['is_open'] = [cal_lookup.get(d, True) for d in df['date']]
    else:
        df['is_open'] = True

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


def _fit_theta(y: np.ndarray, *, season_length: int) -> tuple:
    """Fit AutoTheta on a 1-D series.

    StatsForecast expects a DataFrame with columns: unique_id, ds, y.
    freq=1 means integer-indexed (step = one bucket; we don't expose calendar
    dates to StatsForecast since open-day filtering / bucket cadence already
    aligns rows).

    Returns (fitted StatsForecast object, training DataFrame).
    """
    n = len(y)
    train_df = pd.DataFrame({
        'unique_id': ['ts'] * n,
        'ds': np.arange(n),
        'y': y.astype(float),
    })

    sf = StatsForecast(
        models=[AutoTheta(season_length=season_length)],
        freq=1,
    )
    sf.fit(train_df)
    return sf, train_df


def _open_future_dates(shop_cal: pd.DataFrame, pred_dates: list) -> list:
    """Return subset of pred_dates that are open days."""
    open_set = set(shop_cal.loc[shop_cal['is_open'], 'date'])
    cal_dates = set(shop_cal['date'])
    return [d for d in pred_dates if d not in cal_dates or d in open_set]


def _build_forecast_rows_daily(
    *,
    samples: np.ndarray,
    open_dates: list,
    all_pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str,
    season_length: int,
) -> list:
    """Daily-grain row builder. Closed dates get yhat=0 (fixed up by zero_closed_days)."""
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
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': yhat_samples_json,
            'exog_signature': json.dumps({'model': 'theta', 'season_length': season_length}),
        })
    return rows


def _build_forecast_rows_bucket(
    *,
    samples: np.ndarray,
    pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str,
    season_length: int,
) -> list:
    """Weekly/monthly row builder."""
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
            'model_name': 'theta',
            'run_date': str(run_date),
            'forecast_track': 'bau',
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': paths_to_jsonb(samples, i),
            'exog_signature': json.dumps({'model': 'theta', 'season_length': season_length}),
        })
    return rows


def _upsert_rows(client, rows: list) -> int:
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
    """Core logic: fit AutoTheta at the chosen grain, bootstrap paths, write rows."""
    horizon = HORIZON_BY_GRAIN[granularity]
    season_length = SEASON_LENGTH_BY_GRAIN[granularity]

    # 1. Fetch training history.
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
    last_actual = history['date'].iloc[-1]
    train_end = _train_end_for_grain(last_actual, granularity)
    print(
        f'[theta_fit] grain={granularity} last_actual={last_actual} '
        f'train_end={train_end} horizon={horizon} season_length={season_length}'
    )

    # 2. Truncate to <= train_end.
    history = history[history['date'] <= train_end].reset_index(drop=True)
    if history.empty:
        raise RuntimeError(f'Empty history after train_end cutoff {train_end}')

    if granularity == 'day':
        # 3a. Daily path: open-day-only fit + closed-day post-hoc zeroing.
        open_history = filter_open_days(history)
        if len(open_history) < season_length * 2:
            raise RuntimeError(
                f'Insufficient open-day history: {len(open_history)} rows (need >= {season_length * 2})'
            )
        y = open_history['y'].values

        sf, _ = _fit_theta(y, season_length=season_length)
        print(f'[theta_fit] Fitted AutoTheta for {kpi_name}/day on {len(y)} open-day observations')

        all_pred_dates = _pred_dates_for_grain(
            run_date=run_date, granularity='day', horizon=horizon,
        )
        shop_cal = _fetch_shop_calendar(
            client,
            restaurant_id=restaurant_id,
            start_date=all_pred_dates[0],
            end_date=all_pred_dates[-1],
        )
        open_future = _open_future_dates(shop_cal, all_pred_dates)
        n_open = len(open_future)
        if n_open == 0:
            raise RuntimeError('No open days in forecast window — check shop_calendar')

        pred_df = sf.forecast(h=n_open, fitted=True)
        point_forecast = pred_df['AutoTheta'].values

        fitted_df = sf.forecast_fitted_values()
        fitted_vals = fitted_df['AutoTheta'].values
        residuals = y[:len(fitted_vals)] - fitted_vals
        residuals = residuals[~np.isnan(residuals)]

        samples = bootstrap_from_residuals(
            point_forecast=point_forecast,
            residuals=residuals,
            n_paths=N_PATHS,
        )
        assert samples.shape == (n_open, N_PATHS), f'Unexpected samples shape: {samples.shape}'

        rows = _build_forecast_rows_daily(
            samples=samples,
            open_dates=open_future,
            all_pred_dates=all_pred_dates,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity='day',
            season_length=season_length,
        )
        preds_df = pd.DataFrame(rows)
        preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date
        preds_df = zero_closed_days(preds_df, shop_cal)
    else:
        # 3b. Weekly/monthly: aggregate full series, fit on bucket counts.
        if granularity == 'week':
            agg = bucket_to_weekly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'week_start': 'bucket_start'})
        else:  # 'month'
            agg = bucket_to_monthly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'month_start': 'bucket_start'})
        if agg.empty:
            raise RuntimeError(f'Empty aggregation for grain={granularity}')

        y = agg['y'].astype(float).values
        if len(y) < season_length * 2:
            raise RuntimeError(
                f'Insufficient {granularity} history: {len(y)} buckets (need >= {season_length * 2})'
            )

        sf, _ = _fit_theta(y, season_length=season_length)
        print(f'[theta_fit] Fitted AutoTheta for {kpi_name}/{granularity} on {len(y)} buckets')

        pred_dates = _pred_dates_for_grain(
            run_date=run_date, granularity=granularity, horizon=horizon,
        )
        pred_df = sf.forecast(h=horizon, fitted=True)
        point_forecast = pred_df['AutoTheta'].values

        fitted_df = sf.forecast_fitted_values()
        fitted_vals = fitted_df['AutoTheta'].values
        residuals = y[:len(fitted_vals)] - fitted_vals
        residuals = residuals[~np.isnan(residuals)]

        samples = bootstrap_from_residuals(
            point_forecast=point_forecast,
            residuals=residuals,
            n_paths=N_PATHS,
        )
        assert samples.shape == (horizon, N_PATHS), f'Unexpected samples shape: {samples.shape}'

        rows = _build_forecast_rows_bucket(
            samples=samples,
            pred_dates=pred_dates,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity=granularity,
            season_length=season_length,
        )
        preds_df = pd.DataFrame(rows)
        preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date

    # 4. Restore target_date to str for upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)

    # 5. Chunked upsert
    final_rows = preds_df.to_dict(orient='records')
    n = _upsert_rows(client, final_rows)
    return n


if __name__ == '__main__':
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
        print(f'[theta_fit] Done: {n} rows written for {kpi_name}/{granularity}')
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
