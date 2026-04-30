"""Phase 14: Last-7-day forecast evaluator.

Computes RMSE, MAPE, mean_bias, direction_hit_rate for the prior 7 days
and writes results to forecast_quality.

Autoplan E4: direction_hit_rate is computed on OPEN DAYS ONLY.
"""
from __future__ import annotations
import math
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd


# --------------------------------------------------------------------------- #
# Pure function — testable without DB                                          #
# --------------------------------------------------------------------------- #

def compute_metrics(
    actuals: np.ndarray,
    yhats: np.ndarray,
    is_open: Optional[np.ndarray] = None,
) -> dict:
    """Compute forecast accuracy metrics.

    Args:
        actuals: Observed values.
        yhats:   Point forecasts (mean of sample paths).
        is_open: Boolean mask of open days. If None, all days are included.

    Returns dict with keys: rmse, mape, mean_bias, direction_hit_rate.

    RMSE    = sqrt(mean((yhat - actual)^2))
    MAPE    = mean(|yhat - actual| / max(|actual|, 1)) * 100
    mean_bias    = mean(yhat - actual)  — positive = overforecast
    direction_hit_rate = fraction of consecutive open-day pairs where the
                         predicted and actual direction match (up/down).
    """
    actuals = np.asarray(actuals, dtype=float)
    yhats = np.asarray(yhats, dtype=float)

    # RMSE — all days
    rmse = float(np.sqrt(np.mean((yhats - actuals) ** 2)))

    # MAPE — zero actuals replaced by 1 to avoid division-by-zero
    safe_actuals = np.where(actuals == 0.0, 1.0, np.abs(actuals))
    mape = float(np.mean(np.abs(yhats - actuals) / safe_actuals) * 100.0)

    # Mean bias — positive means overforecast
    mean_bias = float(np.mean(yhats - actuals))

    # Direction hit rate — open days only (autoplan E4)
    if is_open is not None:
        is_open = np.asarray(is_open, dtype=bool)
        open_actuals = actuals[is_open]
        open_yhats = yhats[is_open]
    else:
        open_actuals = actuals
        open_yhats = yhats

    direction_hit_rate = _compute_direction_hit_rate(open_actuals, open_yhats)

    return {
        'rmse': rmse,
        'mape': mape,
        'mean_bias': mean_bias,
        'direction_hit_rate': direction_hit_rate,
    }


def _compute_direction_hit_rate(actuals: np.ndarray, yhats: np.ndarray) -> float:
    """Fraction of consecutive pairs where predicted and actual direction match.

    Requires at least 2 observations; returns 0.0 if fewer.
    """
    if len(actuals) < 2:
        return 0.0
    # Day-over-day direction for actual and forecast (+1 = up, -1 = down, 0 = flat)
    actual_dirs = np.sign(np.diff(actuals))
    yhat_dirs = np.sign(np.diff(yhats))
    # Count matches (same sign — includes both flat, though rare in revenue data)
    hits = np.sum(actual_dirs == yhat_dirs)
    return float(hits / len(actual_dirs))


# --------------------------------------------------------------------------- #
# DB-bound function                                                            #
# --------------------------------------------------------------------------- #

def evaluate_last_7(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    model_name: str,
) -> dict:
    """Fetch last 7 actuals + prior-day forecasts, compute metrics, write to forecast_quality.

    Returns the metrics dict that was written.
    """
    eval_end = date.today() - timedelta(days=1)
    eval_start = eval_end - timedelta(days=6)

    # 1. Fetch actual values from kpi_daily_mv for the window
    resp = (
        client.table('kpi_daily_mv')
        .select('date,' + kpi_name + ',is_open')
        .eq('restaurant_id', restaurant_id)
        .gte('date', str(eval_start))
        .lte('date', str(eval_end))
        .order('date')
        .execute()
    )
    actual_rows = resp.data or []
    if not actual_rows:
        raise RuntimeError(f'No actuals found for {restaurant_id} [{eval_start}–{eval_end}]')

    actual_df = pd.DataFrame(actual_rows)
    actual_df['date'] = pd.to_datetime(actual_df['date']).dt.date
    actual_df = actual_df.sort_values('date').reset_index(drop=True)
    actual_dates = list(actual_df['date'])

    # 2. Fetch prior-day forecasts for the same window
    #    A forecast written on run_date targets run_date+N; we look for target_dates in window
    forecast_resp = (
        client.table('forecast_daily')
        .select('target_date,yhat')
        .eq('restaurant_id', restaurant_id)
        .eq('kpi_name', kpi_name)
        .eq('model_name', model_name)
        .in_('target_date', [str(d) for d in actual_dates])
        .execute()
    )
    forecast_rows = forecast_resp.data or []
    forecast_lookup = {
        pd.to_datetime(r['target_date']).date(): float(r['yhat'])
        for r in forecast_rows
    }

    # 3. Align actuals and forecasts — skip dates without a forecast
    aligned_actuals = []
    aligned_yhats = []
    aligned_is_open = []
    for _, row in actual_df.iterrows():
        d = row['date']
        if d not in forecast_lookup:
            continue
        aligned_actuals.append(float(row[kpi_name]))
        aligned_yhats.append(forecast_lookup[d])
        aligned_is_open.append(bool(row.get('is_open', True)))

    if len(aligned_actuals) < 2:
        raise RuntimeError(
            f'Fewer than 2 aligned (actual, forecast) pairs for {model_name}/{kpi_name}; '
            'cannot compute meaningful metrics'
        )

    actuals_arr = np.array(aligned_actuals)
    yhats_arr = np.array(aligned_yhats)
    is_open_arr = np.array(aligned_is_open)

    # 4. Compute metrics
    metrics = compute_metrics(actuals_arr, yhats_arr, is_open=is_open_arr)

    # 5. Compute horizon_reliability_cutoff = min(training_days * 0.2, 60)
    training_days_resp = (
        client.table('kpi_daily_mv')
        .select('date', count='exact')
        .eq('restaurant_id', restaurant_id)
        .execute()
    )
    training_days = training_days_resp.count or 0
    horizon_cutoff = min(math.floor(training_days * 0.2), 60)

    # 6. Write to forecast_quality
    quality_row = {
        'restaurant_id': restaurant_id,
        'kpi_name': kpi_name,
        'model_name': model_name,
        'eval_date': str(date.today()),
        'window_start': str(eval_start),
        'window_end': str(eval_end),
        'rmse': round(metrics['rmse'], 4),
        'mape': round(metrics['mape'], 4),
        'mean_bias': round(metrics['mean_bias'], 4),
        'direction_hit_rate': round(metrics['direction_hit_rate'], 4),
        'horizon_reliability_cutoff': horizon_cutoff,
        'n_obs': len(aligned_actuals),
    }
    client.table('forecast_quality').upsert(quality_row).execute()

    return metrics
