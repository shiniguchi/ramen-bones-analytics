"""Phase 14 / 15-10: ETS model fit and forecast writer.

Subprocess entry point — run as:
    python -m scripts.forecast.ets_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE, GRANULARITY from env vars.

Design decisions:
  D-03: Daily grain trains on open-day-only series (closed days carry
        structural zeros). Weekly/monthly grains aggregate the full daily
        series (closed days roll into bucket sums) — open/closed gating
        only makes sense at daily resolution.
  ETS does not support exog regressors.
  Closed dates in the daily forecast window are post-hoc zeroed (D-01);
  weekly/monthly forecasts skip that step.

15-10: GRANULARITY env (day|week|month) selects native bucket cadence,
TRAIN_END (D-14), horizon, and seasonal_periods.
"""
from __future__ import annotations
import json
import os
import sys
import traceback
from datetime import date, datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd
from statsmodels.tsa.exponential_smoothing.ets import ETSModel

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
STEP_NAME = 'forecast_ets'
CHUNK_SIZE = 100

# 15-10: per-grain knob (D-14). HORIZON_BY_GRAIN now lives in grain_helpers.
SEASONAL_PERIODS_BY_GRAIN = {'day': 7, 'week': 52, 'month': 12}


def _fetch_history(client, *, restaurant_id: str, kpi_name: str) -> pd.DataFrame:
    """Fetch kpi_daily_mv history and shop_calendar is_open for open-day filtering.

    kpi_daily_mv has columns: business_date, revenue_cents, tx_count.
    is_open comes from shop_calendar (not kpi_daily_mv).
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

    # Fetch is_open from shop_calendar (kpi_daily_mv does not have this column)
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
        # Default: assume all days open if no shop_calendar data
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
    """
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


def _fit_ets(y: np.ndarray, *, seasonal_periods: int) -> object:
    """Fit ETSModel with add/add/add components, falling back gracefully.

    Tries (error='add', trend='add', seasonal='add') first.
    Falls back to (error='add', trend=None, seasonal='add') if convergence fails.
    """
    shared_kwargs = dict(seasonal_periods=seasonal_periods)

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


def _build_forecast_rows_daily(
    *,
    samples: np.ndarray,
    open_dates: list,
    all_pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str,
    seasonal_periods: int,
    track: str = 'bau',
) -> list:
    """Daily-grain row builder: maps open-day samples to calendar dates,
    closed dates get yhat=0 (zero_closed_days makes it belt-and-suspenders).
    """
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
            'forecast_track': track,
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': yhat_samples_json,
            'exog_signature': json.dumps({'model': 'ets', 'seasonal_periods': seasonal_periods}),
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
    seasonal_periods: int,
    track: str = 'bau',
) -> list:
    """Weekly/monthly row builder: every bucket gets its sample column."""
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
            'model_name': 'ets',
            'run_date': str(run_date),
            'forecast_track': track,
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': paths_to_jsonb(samples, i),
            'exog_signature': json.dumps({'model': 'ets', 'seasonal_periods': seasonal_periods}),
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
    track: str = 'bau',
    train_end: Optional[date] = None,
) -> int:
    """Core logic: fit ETS at the chosen grain, generate sample paths, write rows.

    Phase 16 D-04 / D-07: when track='cf', source from kpi_daily_with_comparable_v
    (NEVER kpi_daily_mv); cap history at train_end; granularity must be 'day';
    kpi_name must be 'revenue_comparable_eur' or 'invoice_count' (Guard 9).

    Returns the number of rows written to forecast_daily.
    """
    horizon = HORIZON_BY_GRAIN[granularity]
    seasonal_periods = SEASONAL_PERIODS_BY_GRAIN[granularity]

    if track == 'cf':
        assert granularity == 'day', f"CF fits require granularity='day', got {granularity}"
        assert train_end is not None, "CF fits require train_end (min(campaign_start)-7d)"
        history = _load_comparable_history(
            client, restaurant_id=restaurant_id, kpi_name=kpi_name, train_end=train_end,
        )
        last_actual = history['date'].iloc[-1]
        print(
            f'[ets_fit] grain={granularity} TRACK=cf last_actual={last_actual} '
            f'train_end={train_end} horizon={horizon} seasonal_periods={seasonal_periods}'
        )
    else:
        # 1. Fetch training history (BAU path: kpi_daily_mv).
        history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
        last_actual = history['date'].iloc[-1]
        train_end = train_end_for_grain(last_actual, granularity)
        print(
            f'[ets_fit] grain={granularity} last_actual={last_actual} '
            f'train_end={train_end} horizon={horizon} seasonal_periods={seasonal_periods}'
        )

        # 2. Truncate to <= train_end.
        history = history[history['date'] <= train_end].reset_index(drop=True)
    if history.empty:
        raise RuntimeError(f'Empty history after train_end cutoff {train_end}')

    if granularity == 'day':
        # 3a. Daily path: filter to open days (D-03), fit on n_open observations,
        # then fan back out to all calendar days with closed days at 0.
        open_history = filter_open_days(history)
        if len(open_history) < seasonal_periods * 2:
            raise RuntimeError(
                f'Insufficient open-day history: {len(open_history)} rows (need >= {seasonal_periods * 2})'
            )
        y = open_history['y'].values

        result = _fit_ets(y, seasonal_periods=seasonal_periods)
        print(f'[ets_fit] Fitted ETS for {kpi_name}/day on {len(y)} open-day observations')

        # Phase 16 D-07 / 16-12 follow-up: CF fits anchor pred_dates on train_end
        # (ETS simulate(anchor='end') projects from the last fitted observation;
        # the date labels must match the post-train_end window). BAU unchanged.
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

        sim_raw = result.simulate(
            nsimulations=n_open,
            repetitions=N_PATHS,
            anchor='end',
        )
        samples = sim_raw.values if hasattr(sim_raw, 'values') else np.asarray(sim_raw)
        assert samples.shape == (n_open, N_PATHS), f'Unexpected ETS samples shape: {samples.shape}'

        rows = _build_forecast_rows_daily(
            samples=samples,
            open_dates=open_future,
            all_pred_dates=all_pred_dates,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity='day',
            seasonal_periods=seasonal_periods,
            track=track,
        )
        preds_df = pd.DataFrame(rows)
        preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date
        preds_df = zero_closed_days(preds_df, shop_cal)
    else:
        # 3b. Weekly/monthly: aggregate full daily series (open+closed) and fit.
        if granularity == 'week':
            agg = bucket_to_weekly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'week_start': 'bucket_start'})
        else:  # 'month'
            agg = bucket_to_monthly(history, value_col='y', date_col='date')
            agg = agg.rename(columns={'month_start': 'bucket_start'})
        if agg.empty:
            raise RuntimeError(f'Empty aggregation for grain={granularity}')

        y = agg['y'].astype(float).values
        if len(y) < seasonal_periods * 2:
            raise RuntimeError(
                f'Insufficient {granularity} history: {len(y)} buckets (need >= {seasonal_periods * 2})'
            )

        result = _fit_ets(y, seasonal_periods=seasonal_periods)
        print(f'[ets_fit] Fitted ETS for {kpi_name}/{granularity} on {len(y)} buckets')

        pred_dates = pred_dates_for_grain(
            run_date=run_date, granularity=granularity, horizon=horizon,
            window_start=window_start_for_grain(last_actual, granularity),  # D-15 Option B
            train_end=train_end,  # B2: drop dates < train_end + 1d from past-side output
        )
        sim_raw = result.simulate(
            nsimulations=len(pred_dates),
            repetitions=N_PATHS,
            anchor='end',
        )
        samples = sim_raw.values if hasattr(sim_raw, 'values') else np.asarray(sim_raw)
        assert samples.shape == (len(pred_dates), N_PATHS), f'Unexpected ETS samples shape: {samples.shape}'

        rows = _build_forecast_rows_bucket(
            samples=samples,
            pred_dates=pred_dates,
            restaurant_id=restaurant_id,
            kpi_name=kpi_name,
            run_date=run_date,
            granularity=granularity,
            seasonal_periods=seasonal_periods,
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
    _parser = argparse.ArgumentParser(description='Phase 14/17 ets_fit script')
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
        print(f'[ets_fit] Done: {n} rows written for {kpi_name}/{granularity}')
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
