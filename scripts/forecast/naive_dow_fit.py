"""Phase 14 / 15-10: Naive seasonal-mean baseline model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.naive_dow_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE, GRANULARITY from env vars.

Design decisions:
  D-03: Daily grain uses open-day-only history.
  No external library — pure numpy/pandas.

15-10: model_name stays 'naive_dow' (chart legend strings depend on this
per Phase 15 v1's locked decisions) but the seasonal key swings with
granularity:
  day   -> day-of-week  (Mon..Sun, 7 keys)
  week  -> ISO week-of-year (1..53, ~52 keys)
  month -> month-of-year (1..12, 12 keys)
Point forecast = mean of historical bucket values sharing the seasonal key.
200 sample paths via bootstrap_from_residuals using same-key residuals
(D-16). Daily grain still applies the closed-day post-hoc zero-out;
week/month grains skip it (closed days are summed into bucket totals).
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timezone
from collections import defaultdict
from typing import Optional

import numpy as np
import pandas as pd

from scripts.forecast.db import make_client
from scripts.forecast.closed_days import zero_closed_days, filter_open_days
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb
from scripts.forecast.grain_helpers import (
    HORIZON_BY_GRAIN,
    parse_granularity_env,
    pred_dates_for_grain,
    train_end_for_grain,
    window_start_for_grain,  # NEW — Phase 16.1 D-14
)
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
N_PATHS = 200
STEP_NAME = 'forecast_naive_dow'
CHUNK_SIZE = 100

# 15-10: per-grain knob (D-14). HORIZON_BY_GRAIN now lives in grain_helpers.


def _seasonal_key(d: date, granularity: str) -> int:
    """Return the seasonal grouping key for a date at the given grain.

    day  : weekday() (Mon=0..Sun=6)
    week : ISO week number (1..53)
    month: calendar month (1..12)
    """
    if granularity == 'day':
        return d.weekday()
    if granularity == 'week':
        # isocalendar() returns (year, week, weekday); we use week.
        return d.isocalendar()[1]
    if granularity == 'month':
        return d.month
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


def _load_comparable_history(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    train_end: date,
) -> pd.DataFrame:
    """Phase 16 Track-B: source from kpi_daily_with_comparable_v capped at train_end.

    Per Guard 9 / D-04 — CF must NEVER read from kpi_daily_mv.revenue_cents.
    Returns DataFrame with same shape as _fetch_history (date, revenue_eur,
    invoice_count, is_open, y) but with revenue derived from
    revenue_comparable_eur (baseline-items-only revenue).
    """
    # kpi_daily_with_comparable_v exposes revenue_comparable_eur and tx_count.
    # The kpi_name passed in is 'revenue_comparable_eur' or 'invoice_count'
    # (per counterfactual_fit.CF_KPIS); map to the view column.
    col_map = {
        'revenue_comparable_eur': 'revenue_comparable_eur',
        'invoice_count': 'tx_count',
    }
    if kpi_name not in col_map:
        raise RuntimeError(
            f"CF kpi_name must be one of {list(col_map)}; got {kpi_name!r}. "
            "Forbidden kpi_name='revenue_eur' on a Track-B fit (Guard 9)."
        )
    col = col_map[kpi_name]
    resp = (
        client.table('kpi_daily_with_comparable_v')
        .select(f'business_date,{col}')
        .eq('restaurant_id', restaurant_id)
        .lte('business_date', train_end.isoformat())
        .order('business_date')
        .limit(10000)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError(
            f'No CF history from kpi_daily_with_comparable_v for {restaurant_id}/{kpi_name} '
            f'<= {train_end}'
        )
    df = pd.DataFrame(rows)
    df.rename(columns={'business_date': 'date'}, inplace=True)
    df['date'] = pd.to_datetime(df['date']).dt.date
    df = df.sort_values('date').reset_index(drop=True)
    df['y'] = df[col].astype(float)
    # Open-day filter: CF history is pre-campaign by construction; assume open
    # unless shop_calendar says otherwise. Keep is_open default True so the
    # daily filter_open_days call still works.
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


def _seasonal_means_and_residuals(
    *,
    bucket_dates: list,
    bucket_values: np.ndarray,
    granularity: str,
) -> tuple:
    """Group bucket values by seasonal key and return (means, residuals).

    means: dict {key -> mean_y}
    residuals: dict {key -> array of y - mean_y}
    """
    keyed = defaultdict(list)
    for d, v in zip(bucket_dates, bucket_values):
        keyed[_seasonal_key(d, granularity)].append(float(v))
    means = {k: float(np.mean(vs)) for k, vs in keyed.items()}
    residuals = {
        k: np.array([v - means[k] for v in vs], dtype=float)
        for k, vs in keyed.items()
    }
    return means, residuals


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
    track: str = 'bau',
) -> list:
    """Daily-grain row builder. Closed dates get yhat=0 (zero_closed_days finalizes)."""
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
            'model_name': 'naive_dow',
            'run_date': str(run_date),
            'forecast_track': track,
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': yhat_samples_json,
            'exog_signature': json.dumps({'model': 'naive_dow', 'granularity': granularity}),
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
    track: str = 'bau',
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
            'model_name': 'naive_dow',
            'run_date': str(run_date),
            'forecast_track': track,
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': paths_to_jsonb(samples, i),
            'exog_signature': json.dumps({'model': 'naive_dow', 'granularity': granularity}),
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
    track: str = 'bau',
    train_end: Optional[date] = None,
) -> int:
    """Compute seasonal means at the chosen grain, bootstrap paths, write rows.

    Phase 16 D-04 / D-07: when track='cf', source from kpi_daily_with_comparable_v
    (NEVER kpi_daily_mv); cap history at train_end (= min(campaign_start)-7d);
    granularity must be 'day'; kpi_name must be 'revenue_comparable_eur' or
    'invoice_count' (Guard 9 forbids 'revenue_eur' on a CF row).
    """
    horizon = HORIZON_BY_GRAIN[granularity]

    if track == 'cf':
        assert granularity == 'day', f"CF fits require granularity='day', got {granularity}"
        assert train_end is not None, "CF fits require train_end (min(campaign_start)-7d)"
        history = _load_comparable_history(
            client, restaurant_id=restaurant_id, kpi_name=kpi_name, train_end=train_end,
        )
        last_actual = history['date'].iloc[-1]
        # train_end already enforced by SQL filter; keep variable for logging.
        print(
            f'[naive_dow_fit] grain={granularity} TRACK=cf last_actual={last_actual} '
            f'train_end={train_end} horizon={horizon}'
        )
    else:
        # 1. Fetch training history (BAU path: kpi_daily_mv).
        history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
        last_actual = history['date'].iloc[-1]
        train_end = train_end_for_grain(last_actual, granularity)
        print(
            f'[naive_dow_fit] grain={granularity} last_actual={last_actual} '
            f'train_end={train_end} horizon={horizon}'
        )

        # 2. Truncate to <= train_end.
        history = history[history['date'] <= train_end].reset_index(drop=True)
    if history.empty:
        raise RuntimeError(f'Empty history after train_end cutoff {train_end}')

    if granularity == 'day':
        # 3a. Open-day-only history feeds DoW means.
        open_history = filter_open_days(history)
        if len(open_history) < 7:
            raise RuntimeError(
                f'Insufficient open-day history: {len(open_history)} rows (need >= 7)'
            )

        bucket_dates = list(open_history['date'])
        bucket_values = open_history['y'].values
        means, residuals = _seasonal_means_and_residuals(
            bucket_dates=bucket_dates,
            bucket_values=bucket_values,
            granularity='day',
        )
        print(f'[naive_dow_fit] DoW means computed for {kpi_name}: {means}')

        # Phase 16 D-07 / 16-12 follow-up: CF fits anchor pred_dates on train_end
        # (DoW means are timeless, but date labels must align with the post-
        # train_end counterfactual window). BAU unchanged.
        pred_anchor = train_end if track == 'cf' else run_date
        all_pred_dates = pred_dates_for_grain(
            run_date=pred_anchor, granularity='day', horizon=horizon,
            window_start=window_start_for_grain(last_actual, 'day'),  # D-15 Option B
            train_end=train_end,  # B2: drop dates < train_end + 1d from past-side output
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

        global_mean = float(np.mean(list(means.values()))) if means else 0.0
        point_forecast = np.array([
            means.get(_seasonal_key(d, 'day'), global_mean) for d in open_future
        ])
        all_residuals = np.concatenate(list(residuals.values())) if residuals else np.array([0.0])

        samples = bootstrap_from_residuals(
            point_forecast=point_forecast,
            residuals=all_residuals,
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
            track=track,
        )
        preds_df = pd.DataFrame(rows)
        preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date
        preds_df = zero_closed_days(preds_df, shop_cal)
    else:
        # 3b. Weekly/monthly: aggregate full series, then group by week-of-year
        # or month-of-year.
        if granularity == 'week':
            agg = bucket_to_weekly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'week_start': 'bucket_start'})
        else:  # 'month'
            agg = bucket_to_monthly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'month_start': 'bucket_start'})
        if agg.empty:
            raise RuntimeError(f'Empty aggregation for grain={granularity}')

        # bucket_start is a Timestamp; convert to date for _seasonal_key.
        bucket_dates = [pd.Timestamp(b).date() for b in agg['bucket_start']]
        bucket_values = agg['y'].astype(float).values
        if len(bucket_values) < 2:
            raise RuntimeError(
                f'Insufficient {granularity} history: {len(bucket_values)} buckets'
            )

        means, residuals = _seasonal_means_and_residuals(
            bucket_dates=bucket_dates,
            bucket_values=bucket_values,
            granularity=granularity,
        )
        print(f'[naive_dow_fit] {granularity} seasonal means for {kpi_name}: {len(means)} keys')

        pred_dates = pred_dates_for_grain(
            run_date=run_date, granularity=granularity, horizon=horizon,
            window_start=window_start_for_grain(last_actual, granularity),  # D-15 Option B
            train_end=train_end,  # B2: drop dates < train_end + 1d from past-side output
        )

        global_mean = float(np.mean(list(means.values()))) if means else 0.0
        point_forecast = np.array([
            means.get(_seasonal_key(d, granularity), global_mean) for d in pred_dates
        ])
        all_residuals = np.concatenate(list(residuals.values())) if residuals else np.array([0.0])

        samples = bootstrap_from_residuals(
            point_forecast=point_forecast,
            residuals=all_residuals,
            n_paths=N_PATHS,
        )
        assert samples.shape == (len(pred_dates), N_PATHS), f'Unexpected samples shape: {samples.shape}'

        rows = _build_forecast_rows_bucket(
            samples=samples,
            pred_dates=pred_dates,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity=granularity,
            track=track,
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
    # Phase 17 BCK-01 — argparse retrofit so backtest.py can subprocess us per fold.
    # argparse runs FIRST (before env-var reads) so --help works without env vars set.
    import argparse
    _parser = argparse.ArgumentParser(description='Phase 14/17 naive_dow_fit script')
    _parser.add_argument('--train-end', type=str, default=None,
        help='YYYY-MM-DD. Override default train_end_for_grain. Used by backtest.py per fold.')
    _parser.add_argument('--eval-start', type=str, default=None,
        help='YYYY-MM-DD. First date of evaluation window (recorded only).')
    _parser.add_argument('--fold-index', type=int, default=None,
        help='0-indexed fold number. Optional.')
    _args = _parser.parse_args()

    # Read env vars (UNCHANGED from Phase 14 BAU behavior)
    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    kpi_name = os.environ.get('KPI_NAME', '').strip()
    run_date_str = os.environ.get('RUN_DATE', '').strip()

    if not restaurant_id or not kpi_name or not run_date_str:
        print('ERROR: RESTAURANT_ID, KPI_NAME, and RUN_DATE env vars are required', file=sys.stderr)
        sys.exit(1)
    try:
        granularity = parse_granularity_env(os.environ.get('GRANULARITY'))
    except ValueError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    run_date = date.fromisoformat(run_date_str)
    # Phase 17: resolve per-fold overrides from CLI args.
    # When omitted, defaults preserve Phase 14 BAU behavior (train_end=None → computed inside fit_and_write).
    train_end_override = date.fromisoformat(_args.train_end) if _args.train_end else None
    # Issue 1: FORECAST_TRACK env-var override for backtest fold scope-isolation.
    # Default 'bau' preserves Phase 14 BAU pipeline behavior when env var is unset.
    track = os.environ.get('FORECAST_TRACK', 'bau').strip() or 'bau'

    started_at = datetime.now(timezone.utc)
    client = make_client()

    try:
        n = fit_and_write(
            client,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity=granularity,
            track=track,                   # Issue 1: FORECAST_TRACK env var
            train_end=train_end_override,  # Phase 17 BCK-01
        )
        write_success(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            row_count=n,
            restaurant_id=restaurant_id,
        )
        print(f'[naive_dow_fit] Done: {n} rows written for {kpi_name}/{granularity}')
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        print(f'[naive_dow_fit] FAILED:\n{err_msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=err_msg,
                restaurant_id=restaurant_id,
            )
        except Exception as write_err:
            print(f'[naive_dow_fit] Could not write failure row: {write_err}', file=sys.stderr)
        sys.exit(1)
