"""Phase 17 BCK-03: regressor-aware multiplicative naive baseline.

D-05 lock: this is a NEW file. naive_dow_fit.py is NOT modified.

Same DoW-seasonal-mean approach as naive_dow_fit, but per-day forecasts are
multiplied by a holiday-flag-combo multiplier learned from historical
residual ratios. Gate (BCK-03) compares challengers against MAX of
naive_dow_fit RMSE and naive_dow_with_holidays RMSE — preventing unfair
gains for models that benefit from weather/holidays exog access.

Subprocess entry point — run as:
    python -m scripts.forecast.naive_dow_with_holidays_fit

Reads RESTAURANT_ID, KPI_NAME, RUN_DATE, GRANULARITY from env vars.
CLI flags --train-end / --eval-start / --fold-index accepted for backtest.py
subprocess invocation (Wave 2 plan 17-05).
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import traceback
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Optional

import numpy as np
import pandas as pd

from scripts.forecast.db import make_client
from scripts.forecast.closed_days import zero_closed_days, filter_open_days
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb
from scripts.forecast.grain_helpers import (
    HORIZON_BY_GRAIN,
    parse_granularity_env,
    pred_dates_for_grain,
    train_end_for_grain,
    window_start_for_grain,
)
# build_exog_matrix returns (df, exog_signature) tuple
from scripts.forecast.exog import build_exog_matrix
from scripts.external.pipeline_runs_writer import write_success, write_failure

# Reuse private helpers from naive_dow_fit (D-05: don't modify there;
# importing private _ symbols is allowed — they are convention, not enforced).
from scripts.forecast.naive_dow_fit import (
    _seasonal_key,
    _fetch_history,
    _fetch_shop_calendar,
    _seasonal_means_and_residuals,
    _open_future_dates,
    _upsert_rows,
)

# --- Constants ---
N_PATHS = 200
STEP_NAME = 'forecast_naive_dow_with_holidays'
MODEL_NAME = 'naive_dow_with_holidays'
CHUNK_SIZE = 100

# The four binary holiday/event flags used for multiplier grouping.
# Excludes weather columns (temp_mean_c, precip_mm, wind_max_kmh) and is_open
# because is_open is a structural constraint, not a demand signal.
HOLIDAY_FLAGS = ('is_holiday', 'is_school_holiday', 'is_event', 'is_strike')


# ---------------------------------------------------------------------------
# New helper: holiday multiplier computation
# ---------------------------------------------------------------------------

def _compute_holiday_multipliers(
    *,
    history_df: pd.DataFrame,         # has 'date' col + 'y' col (open days only)
    exog_df: pd.DataFrame,            # build_exog_matrix output, indexed by date
    seasonal_means: dict,             # {dow_key: mean_y} from _seasonal_means_and_residuals
    granularity: str,
) -> dict:
    """Compute multiplier per holiday-flag combination from historical residual ratios.

    For each historical date d:
        ratio = y[d] / dow_mean[seasonal_key(d)]
    Group ratios by (is_holiday, is_school_holiday, is_event, is_strike) tuple.
    Return mean ratio per combo. Missing combos at predict-time fall back to 1.0.

    Args:
        history_df: Open-day history with 'date' and 'y' columns.
        exog_df: DataFrame indexed by date with boolean flag columns.
        seasonal_means: {seasonal_key: mean_y} from _seasonal_means_and_residuals.
        granularity: 'day', 'week', or 'month' — determines seasonal_key function.

    Returns:
        dict mapping (is_holiday, is_school_holiday, is_event, is_strike) -> float
    """
    ratios_by_combo: dict = defaultdict(list)
    for d, y in zip(history_df['date'], history_df['y']):
        if d not in exog_df.index:
            continue  # no regressor row for this date — skip
        flags = tuple(int(exog_df.loc[d, f]) for f in HOLIDAY_FLAGS)
        dow_mean = seasonal_means.get(_seasonal_key(d, granularity), 0.0)
        if dow_mean > 0:
            ratios_by_combo[flags].append(float(y) / dow_mean)
    return {
        combo: float(np.mean(rs))
        for combo, rs in ratios_by_combo.items()
        if rs
    }


def _apply_holiday_multipliers(
    *,
    future_dates: list,
    seasonal_means: dict,
    exog_df: pd.DataFrame,
    multipliers: dict,
    granularity: str,
) -> np.ndarray:
    """Per future date d: yhat = dow_mean[seasonal_key(d)] * multiplier[combo].

    Combo lookup defaults to 1.0 (== plain naive_dow behavior) when the combo
    was unseen in training history.

    Args:
        future_dates: List of dates to forecast.
        seasonal_means: {seasonal_key: mean_y}.
        exog_df: DataFrame indexed by date with flag columns.
        multipliers: {combo_tuple: float} from _compute_holiday_multipliers.
        granularity: 'day', 'week', or 'month'.

    Returns:
        np.ndarray of shape (len(future_dates),) with holiday-adjusted yhats.
    """
    out = np.zeros(len(future_dates), dtype=float)
    for i, d in enumerate(future_dates):
        base = seasonal_means.get(_seasonal_key(d, granularity), 0.0)
        if d in exog_df.index:
            flags = tuple(int(exog_df.loc[d, f]) for f in HOLIDAY_FLAGS)
            mult = multipliers.get(flags, 1.0)
        else:
            mult = 1.0  # unseen combo — fall back to plain DoW mean
        out[i] = base * mult
    return out


# ---------------------------------------------------------------------------
# Local row-builder: copy of naive_dow_fit._build_forecast_rows_daily with
# MODEL_NAME substituted for hardcoded 'naive_dow'. (Plan note: import of
# _build_forecast_rows_daily was not feasible because it hardcodes 'naive_dow'
# in the row dict. Local copy with SOURCE citation is the cleaner path.)
# Source: naive_dow_fit.py:233-276 [VERIFIED 2026-05-06]
# ---------------------------------------------------------------------------

def _build_forecast_rows_daily_holidays(
    *,
    samples: np.ndarray,
    open_dates: list,
    all_pred_dates: list,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str,
    track: str = 'bau',
    exog_signature: dict | None = None,
) -> list:
    """Daily-grain row builder. Closed dates get yhat=0 (zero_closed_days finalizes)."""
    open_date_idx = {d: i for i, d in enumerate(open_dates)}
    sig_json = json.dumps(exog_signature or {'model': MODEL_NAME, 'granularity': granularity})

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
            'model_name': MODEL_NAME,  # 'naive_dow_with_holidays'
            'run_date': str(run_date),
            'forecast_track': track,
            'granularity': granularity,
            'yhat': round(yhat, 4),
            'yhat_lower': round(yhat_lower, 4),
            'yhat_upper': round(yhat_upper, 4),
            'yhat_samples': yhat_samples_json,
            'exog_signature': sig_json,
        })
    return rows


# ---------------------------------------------------------------------------
# Main fit-and-write function
# ---------------------------------------------------------------------------

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
    """Fit naive_dow_with_holidays and write forecast_daily rows. Returns row count.

    Steps:
      1. Fetch BAU history from kpi_daily_mv.
      2. Apply train_end cutoff (for backtest folds — Phase 17 D-01).
      3. Compute DoW seasonal means + residuals (reuse naive_dow_fit helpers).
      4. Build exog matrix (history window + forecast window) via exog.py.
      5. Compute per-flag-combo holiday multipliers from history.
      6. Apply multipliers to open forecast dates -> point forecast.
      7. Bootstrap sample paths from residuals.
      8. Build forecast_daily rows with model_name='naive_dow_with_holidays'.
      9. Zero-close closed days, upsert to DB.

    Note: daily grain only (week/month grains not yet needed for BCK-03 gate).
    """
    horizon = HORIZON_BY_GRAIN[granularity]

    # 1. Fetch history
    history = _fetch_history(client, restaurant_id=restaurant_id, kpi_name=kpi_name)
    last_actual = history['date'].iloc[-1]

    # 2. Apply train_end cutoff
    if train_end is None:
        train_end = train_end_for_grain(last_actual, granularity)
    history = history[history['date'] <= train_end].reset_index(drop=True)
    if history.empty:
        raise RuntimeError(f'Empty history after train_end cutoff {train_end}')

    print(
        f'[naive_dow_with_holidays] grain={granularity} last_actual={last_actual} '
        f'train_end={train_end} horizon={horizon}'
    )

    # 3. Open-day filter then seasonal means
    open_history = filter_open_days(history)
    if len(open_history) < 7:
        raise RuntimeError(
            f'Insufficient open-day history: {len(open_history)} rows (need >= 7)'
        )

    bucket_dates = list(open_history['date'])
    bucket_values = open_history['y'].values
    seasonal_means, residuals = _seasonal_means_and_residuals(
        bucket_dates=bucket_dates,
        bucket_values=bucket_values,
        granularity=granularity,
    )
    print(
        f'[naive_dow_with_holidays] DoW means for {kpi_name}: '
        f'{len(seasonal_means)} seasonal keys'
    )

    # 4. Build exog matrix covering history + forecast window
    history_start = open_history['date'].iloc[0]
    all_pred_dates = pred_dates_for_grain(
        run_date=run_date,
        granularity=granularity,
        horizon=horizon,
        window_start=window_start_for_grain(last_actual, granularity),
        train_end=train_end,
    )
    if not all_pred_dates:
        raise RuntimeError('No prediction dates generated — check run_date vs train_end')

    exog_end = max(all_pred_dates)
    exog_df, exog_sig = build_exog_matrix(
        client,
        restaurant_id=restaurant_id,
        start_date=history_start,
        end_date=exog_end,
    )

    # 5. Compute holiday multipliers from open history + exog
    multipliers = _compute_holiday_multipliers(
        history_df=open_history,
        exog_df=exog_df,
        seasonal_means=seasonal_means,
        granularity=granularity,
    )
    print(
        f'[naive_dow_with_holidays] multiplier combos learned: {len(multipliers)}'
    )

    # 6. Fetch shop calendar for the forecast window
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

    # 7. Apply multipliers -> holiday-adjusted point forecast on open days
    point_forecast = _apply_holiday_multipliers(
        future_dates=open_future,
        seasonal_means=seasonal_means,
        exog_df=exog_df,
        multipliers=multipliers,
        granularity=granularity,
    )

    # 8. Bootstrap sample paths from across-DoW residuals
    all_residuals = np.concatenate(list(residuals.values())) if residuals else np.array([0.0])
    samples = bootstrap_from_residuals(
        point_forecast=point_forecast,
        residuals=all_residuals,
        n_paths=N_PATHS,
    )
    assert samples.shape == (n_open, N_PATHS), f'Unexpected samples shape: {samples.shape}'

    # 9. Build rows with model_name='naive_dow_with_holidays'
    exog_sig_extended = {
        **exog_sig,
        'model': MODEL_NAME,
        'granularity': granularity,
    }
    rows = _build_forecast_rows_daily_holidays(
        samples=samples,
        open_dates=open_future,
        all_pred_dates=all_pred_dates,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        granularity=granularity,
        track=track,
        exog_signature=exog_sig_extended,
    )
    preds_df = pd.DataFrame(rows)
    preds_df['target_date'] = pd.to_datetime(preds_df['target_date']).dt.date
    preds_df = zero_closed_days(preds_df, shop_cal)

    # 10. Restore target_date to str and upsert
    preds_df['target_date'] = preds_df['target_date'].astype(str)
    final_rows = preds_df.to_dict(orient='records')
    n = _upsert_rows(client, final_rows)
    return n


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Phase 17 BCK-03 naive_dow_with_holidays fit'
    )
    parser.add_argument(
        '--train-end', type=str, default=None,
        help='YYYY-MM-DD. Override default train_end_for_grain. Used by backtest.py per fold.',
    )
    parser.add_argument(
        '--eval-start', type=str, default=None,
        help='YYYY-MM-DD. First date of the evaluation window (recorded only).',
    )
    parser.add_argument(
        '--fold-index', type=int, default=None,
        help='0-indexed fold number. Optional — used by backtest.py for traceability.',
    )
    args = parser.parse_args()

    restaurant_id = os.environ.get('RESTAURANT_ID', '').strip()
    kpi_name = os.environ.get('KPI_NAME', '').strip()
    run_date_str = os.environ.get('RUN_DATE', '').strip()

    if not restaurant_id or not kpi_name or not run_date_str:
        print(
            'ERROR: RESTAURANT_ID, KPI_NAME, RUN_DATE env vars required',
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        granularity = parse_granularity_env(os.environ.get('GRANULARITY'))
    except ValueError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    run_date = date.fromisoformat(run_date_str)
    train_end_override = date.fromisoformat(args.train_end) if args.train_end else None
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
            track=track,
            train_end=train_end_override,
        )
        print(
            f'[naive_dow_with_holidays] Done: {n} rows for {kpi_name}/{granularity}'
        )
        write_success(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            row_count=n,
            restaurant_id=restaurant_id,
        )
        sys.exit(0)
    except Exception:
        err_msg = traceback.format_exc()
        print(f'[naive_dow_with_holidays] FAILED:\n{err_msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=err_msg,
                restaurant_id=restaurant_id,
            )
        except Exception as write_err:
            print(
                f'[naive_dow_with_holidays] Could not write failure row: {write_err}',
                file=sys.stderr,
            )
        sys.exit(1)
