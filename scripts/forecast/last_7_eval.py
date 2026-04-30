"""Nightly forecast evaluation — last 7 days (FCS-07).

Runs after all model fits. For each model, scores the last 7 actual days
against that model's prior 1-day-ahead forecast. Results write to
forecast_quality with evaluation_window='last_7_days'.
"""
from __future__ import annotations
import logging
import numpy as np
from datetime import date, timedelta
from numpy import ndarray

logger = logging.getLogger(__name__)

# Column mapping: kpi_name used in forecast_daily -> column in kpi_daily_v
_KPI_COLUMN_MAP = {
    'revenue_eur': 'revenue_cents',
    'invoice_count': 'tx_count',
}

# Divisors: convert raw kpi_daily_v value to the unit used in forecasts
_KPI_DIVISOR = {
    'revenue_eur': 100,       # cents -> euros
    'invoice_count': 1,       # tx_count is already in count units
}


def compute_metrics(actuals: ndarray, yhats: ndarray) -> dict:
    """Pure computation — no DB calls.

    Returns dict with rmse, mape, bias, direction_hit_rate, n_days.
    Guards against division by zero in MAPE by skipping zero-actual days.
    """
    n = len(actuals)
    errors = yhats - actuals

    # RMSE
    rmse = float(np.sqrt(np.mean(errors ** 2)))

    # MAPE — skip days where actual == 0
    nonzero_mask = actuals != 0
    if nonzero_mask.any():
        mape = float(np.mean(np.abs(errors[nonzero_mask]) / np.abs(actuals[nonzero_mask])))
    else:
        mape = 0.0

    # Bias: mean(yhat - actual)
    bias = float(np.mean(errors))

    # Direction hit rate: fraction of day-over-day transitions
    # where forecast moved the same direction as actual
    if n >= 2:
        actual_diffs = np.diff(actuals)
        yhat_diffs = np.diff(yhats)
        # same direction: both positive, both negative, or both zero
        same_sign = np.sign(actual_diffs) == np.sign(yhat_diffs)
        direction_hit_rate = float(np.mean(same_sign))
    else:
        direction_hit_rate = None

    return {
        'rmse': rmse,
        'mape': mape,
        'bias': bias,
        'direction_hit_rate': direction_hit_rate,
        'n_days': n,
    }


def evaluate_last_7(
    client,
    restaurant_id: str,
    kpi_name: str,
    model_names: list[str],
) -> list[dict]:
    """Score each model's last 7 one-day-ahead forecasts against actuals.

    Reads actuals from kpi_daily_v, forecasts from forecast_daily.
    Writes results to forecast_quality.
    Returns list of metric dicts (one per model).
    """
    # -- Resolve column name in kpi_daily_v --
    kpi_col = _KPI_COLUMN_MAP.get(kpi_name)
    divisor = _KPI_DIVISOR.get(kpi_name, 1)
    if kpi_col is None:
        raise ValueError(f"Unknown kpi_name '{kpi_name}'; expected one of {list(_KPI_COLUMN_MAP)}")

    # -- Fetch latest 7 actual dates --
    resp = (
        client.table('kpi_daily_v')
        .select(f'business_date, {kpi_col}')
        .eq('restaurant_id', restaurant_id)
        .order('business_date', desc=True)
        .limit(7)
        .execute()
    )
    rows = resp.data or []
    if len(rows) < 2:
        logger.warning('Not enough actuals (%d rows) for evaluation', len(rows))
        return []

    # Sort ascending by date
    rows.sort(key=lambda r: r['business_date'])
    actual_dates = [r['business_date'] for r in rows]
    actuals = np.array([r[kpi_col] / divisor for r in rows])

    results: list[dict] = []

    for model_name in model_names:
        # -- Find 1-day-ahead forecast for each actual date --
        # run_date = target_date - 1 day
        yhats_list: list[float] = []
        matched_actuals: list[float] = []
        matched_dates: list[str] = []

        for i, d_str in enumerate(actual_dates):
            d = date.fromisoformat(d_str)
            run_d = (d - timedelta(days=1)).isoformat()

            fc_resp = (
                client.table('forecast_daily')
                .select('yhat')
                .eq('restaurant_id', restaurant_id)
                .eq('kpi_name', kpi_name)
                .eq('model_name', model_name)
                .eq('target_date', d_str)
                .eq('run_date', run_d)
                .limit(1)
                .execute()
            )
            fc_rows = fc_resp.data or []
            if fc_rows:
                yhats_list.append(float(fc_rows[0]['yhat']))
                matched_actuals.append(actuals[i])
                matched_dates.append(d_str)

        if len(yhats_list) < 2:
            logger.warning(
                'Model %s: only %d matched forecasts for %s — skipping',
                model_name, len(yhats_list), kpi_name,
            )
            continue

        # -- Compute metrics --
        metrics = compute_metrics(
            np.array(matched_actuals),
            np.array(yhats_list),
        )
        metrics['model_name'] = model_name
        metrics['kpi_name'] = kpi_name

        # -- Upsert to forecast_quality --
        row = {
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'model_name': model_name,
            'evaluation_window': 'last_7_days',
            'n_days': metrics['n_days'],
            'rmse': round(metrics['rmse'], 4),
            'mape': round(metrics['mape'], 6),
            'bias': round(metrics['bias'], 4) if metrics['bias'] is not None else None,
            'direction_hit_rate': (
                round(metrics['direction_hit_rate'], 4)
                if metrics['direction_hit_rate'] is not None
                else None
            ),
        }
        client.table('forecast_quality').insert(row).execute()

        logger.info(
            'Model %s / %s: RMSE=%.2f  MAPE=%.4f  bias=%.2f  dir=%.2f  n=%d',
            model_name, kpi_name,
            metrics['rmse'], metrics['mape'], metrics['bias'],
            metrics.get('direction_hit_rate', 0) or 0,
            metrics['n_days'],
        )
        results.append(metrics)

    return results
