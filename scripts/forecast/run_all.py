"""Phase 14: forecast orchestrator — nightly entry point.

Iterates over enabled models x KPIs. Each model runs in its own
try/except so one failure does not nuke the rest. Per-model telemetry
writes to pipeline_runs (via Phase 13's writer, if available).

Exit codes:
- 0 if at least one model/KPI succeeded
- 1 if every model/KPI failed

Entry points:
- nightly cron: python -m scripts.forecast.run_all
- manual:       python -m scripts.forecast.run_all --models sarimax,prophet --run-date 2026-04-29
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd

from . import db
from .exog_builder import build_exog_matrix
from .closed_days import zero_closed_days, build_open_day_series, map_open_predictions_to_calendar
from .sample_paths import bootstrap_from_residuals, aggregate_ci
from .writer import write_forecast_batch
from .last_7_eval import evaluate_last_7

# -- graceful import of pipeline_runs_writer (Phase 13, may not exist yet) --
try:
    from scripts.external import pipeline_runs_writer as prw
except ImportError:
    prw = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# -- constants --
DEFAULT_MODELS = ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']
KPIS = ['revenue_eur', 'invoice_count']
FORECAST_HORIZON = 28  # days ahead to predict
FORECAST_TRACK = 'bau'

# Column mapping: kpi_name -> (column in kpi_daily_v, divisor)
_KPI_MAP = {
    'revenue_eur': ('revenue_cents', 100),
    'invoice_count': ('tx_count', 1),
}

# models that use exog regressors (SARIMAX, Prophet)
_EXOG_MODELS = {'sarimax', 'prophet'}


def get_enabled_models(override: str = '') -> list[str]:
    """Return list of model names to run.

    Priority: override arg > FORECAST_ENABLED_MODELS env > DEFAULT_MODELS.
    """
    raw = override or os.environ.get('FORECAST_ENABLED_MODELS', '')
    if raw.strip():
        return [m.strip() for m in raw.split(',') if m.strip()]
    return list(DEFAULT_MODELS)


def _get_restaurant_id(client) -> str:
    """Fetch the single restaurant_id from restaurants table (v1: one tenant)."""
    resp = client.table('restaurants').select('id').limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise RuntimeError('No restaurant found in restaurants table')
    return rows[0]['id']


def _fetch_history(client, restaurant_id: str, kpi_name: str) -> pd.Series:
    """Fetch historical KPI values from kpi_daily_v.

    Returns a pd.Series with DatetimeIndex and values in forecast units
    (euros for revenue, raw count for invoices).
    """
    if kpi_name not in _KPI_MAP:
        raise ValueError(
            f"Unknown kpi_name '{kpi_name}'; expected one of {list(_KPI_MAP)}"
        )

    col_name, divisor = _KPI_MAP[kpi_name]

    resp = (
        client.table('kpi_daily_v')
        .select(f'business_date, {col_name}')
        .eq('restaurant_id', restaurant_id)
        .order('business_date')
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError(f'No history for {kpi_name} / {restaurant_id}')

    dates = pd.to_datetime([r['business_date'] for r in rows])
    values = [r[col_name] / divisor for r in rows]
    return pd.Series(values, index=dates, name=kpi_name)


def _fetch_shop_calendar(client, restaurant_id: str) -> pd.DataFrame:
    """Fetch shop_calendar for the restaurant. Returns df with date, is_open."""
    resp = (
        client.table('shop_calendar')
        .select('date, is_open')
        .eq('restaurant_id', restaurant_id)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        logger.warning('No shop_calendar rows for %s — assuming all open', restaurant_id)
        return pd.DataFrame(columns=['date', 'is_open'])
    return pd.DataFrame(rows)


def _run_model(
    client,
    *,
    model_name: str,
    kpi_name: str,
    restaurant_id: str,
    history: pd.Series,
    shop_cal: pd.DataFrame,
    run_date: date,
) -> int:
    """Fit one model for one KPI and write results. Returns row count.

    Raises on failure — caller wraps in try/except.
    """
    last_history_date = history.index[-1].date()
    predict_start = last_history_date + timedelta(days=1)
    predict_end = predict_start + timedelta(days=FORECAST_HORIZON - 1)

    if model_name in _EXOG_MODELS:
        return _run_exog_model(
            client,
            model_name=model_name,
            kpi_name=kpi_name,
            restaurant_id=restaurant_id,
            history=history,
            shop_cal=shop_cal,
            run_date=run_date,
            predict_start=predict_start,
            predict_end=predict_end,
        )
    else:
        return _run_nonexog_model(
            client,
            model_name=model_name,
            kpi_name=kpi_name,
            restaurant_id=restaurant_id,
            history=history,
            shop_cal=shop_cal,
            run_date=run_date,
            predict_start=predict_start,
            predict_end=predict_end,
        )


def _run_exog_model(
    client,
    *,
    model_name: str,
    kpi_name: str,
    restaurant_id: str,
    history: pd.Series,
    shop_cal: pd.DataFrame,
    run_date: date,
    predict_start: date,
    predict_end: date,
) -> int:
    """Run an exog-aware model (SARIMAX or Prophet)."""
    train_start = history.index[0].date()
    train_end = history.index[-1].date()

    # build exog matrices for train and predict periods
    X_train = build_exog_matrix(client, restaurant_id, train_start, train_end)
    X_predict = build_exog_matrix(client, restaurant_id, predict_start, predict_end)

    if model_name == 'sarimax':
        from .sarimax_fit import fit_sarimax
        point_df, samples, exog_sig = fit_sarimax(
            y=history, X_train=X_train, X_predict=X_predict
        )
    elif model_name == 'prophet':
        from .prophet_fit import fit_prophet, REGRESSOR_COLS
        # Prophet needs ds + y + regressors in flat DataFrames
        hist_df = pd.DataFrame({
            'ds': history.index,
            'y': history.values,
        })
        for col in REGRESSOR_COLS:
            hist_df[col] = X_train[col].values

        future_df = pd.DataFrame({
            'ds': X_predict.index,
        })
        for col in REGRESSOR_COLS:
            future_df[col] = X_predict[col].values

        point_df, samples = fit_prophet(hist_df, future_df)
        # Prophet point_df has 'ds' column; reindex to DatetimeIndex
        point_df = point_df.set_index('ds')
        exog_sig = {}
        if 'weather_source' in X_predict.columns:
            exog_sig = X_predict['weather_source'].value_counts().to_dict()
    else:
        raise ValueError(f'Unknown exog model: {model_name}')

    # post-hoc: zero closed days (D-01)
    if not shop_cal.empty:
        # build a df with target_date + yhat columns for zero_closed_days
        zdf = point_df.copy()
        zdf['target_date'] = zdf.index
        zdf = zero_closed_days(zdf, shop_cal)
        point_df['yhat'] = zdf['yhat'].values
        point_df['yhat_lower'] = zdf['yhat_lower'].values
        point_df['yhat_upper'] = zdf['yhat_upper'].values

    return write_forecast_batch(
        client,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        model_name=model_name,
        run_date=run_date,
        forecast_track=FORECAST_TRACK,
        point_df=point_df,
        samples=samples,
        exog_signature=exog_sig if model_name == 'sarimax' else exog_sig,
    )


def _run_nonexog_model(
    client,
    *,
    model_name: str,
    kpi_name: str,
    restaurant_id: str,
    history: pd.Series,
    shop_cal: pd.DataFrame,
    run_date: date,
    predict_start: date,
    predict_end: date,
) -> int:
    """Run a non-exog model (ETS, Theta, Naive DOW)."""
    # build open-day-only series for training (D-03)
    if not shop_cal.empty:
        y_open = build_open_day_series(history, shop_cal)
    else:
        y_open = history.reset_index(drop=True)

    # forecast horizon in open-day count
    calendar_dates = pd.date_range(predict_start, predict_end, freq='D')
    if not shop_cal.empty:
        cal_df = shop_cal.copy()
        cal_df['date'] = pd.to_datetime(cal_df['date'])
        open_mask = cal_df.set_index('date').reindex(calendar_dates).get('is_open', True)
        # if calendar doesn't cover future, assume open
        if hasattr(open_mask, 'fillna'):
            open_mask = open_mask.fillna(True)
        n_open = int(open_mask.sum())
    else:
        n_open = len(calendar_dates)

    # each model returns (point_df, samples) with matching interface
    if model_name == 'ets':
        from .ets_fit import fit_ets
        open_point_df, open_samples = fit_ets(y_open, n_predict=n_open)
    elif model_name == 'theta':
        from .theta_fit import fit_theta
        open_point_df, open_samples = fit_theta(y_open, n_predict=n_open)
    elif model_name == 'naive_dow':
        from .naive_dow_fit import fit_naive_dow
        open_point_df, open_samples = fit_naive_dow(y_open, n_predict=n_open)
    else:
        raise ValueError(f'Unknown non-exog model: {model_name}')

    # map open-day predictions back to calendar (D-03)
    point_open = open_point_df['yhat'].values
    if not shop_cal.empty:
        point_cal = map_open_predictions_to_calendar(
            point_open, shop_cal, [d.strftime('%Y-%m-%d') for d in calendar_dates]
        )
        n_paths = open_samples.shape[1]
        samples_cal = np.zeros((len(calendar_dates), n_paths))
        for p in range(n_paths):
            samples_cal[:, p] = map_open_predictions_to_calendar(
                open_samples[:, p], shop_cal,
                [d.strftime('%Y-%m-%d') for d in calendar_dates],
            )
    else:
        point_cal = point_open
        samples_cal = open_samples

    mean, lower, upper = aggregate_ci(samples_cal)
    point_df = pd.DataFrame(
        {
            'yhat': point_cal,
            'yhat_lower': lower,
            'yhat_upper': upper,
        },
        index=calendar_dates,
    )

    return write_forecast_batch(
        client,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        model_name=model_name,
        run_date=run_date,
        forecast_track=FORECAST_TRACK,
        point_df=point_df,
        samples=samples_cal,
        exog_signature={},
    )


def _write_telemetry(
    client,
    *,
    step_name: str,
    started_at: datetime,
    status: str,
    row_count: int = 0,
    error_msg: Optional[str] = None,
    restaurant_id: Optional[str] = None,
) -> None:
    """Write a pipeline_runs row via Phase 13's writer. No-op if unavailable."""
    if prw is None:
        logger.debug('pipeline_runs_writer not available — skipping telemetry')
        return

    try:
        if status == 'success':
            prw.write_success(
                client,
                step_name=step_name,
                started_at=started_at,
                row_count=row_count,
                restaurant_id=restaurant_id,
            )
        else:
            prw.write_failure(
                client,
                step_name=step_name,
                started_at=started_at,
                error_msg=error_msg or 'unknown error',
                restaurant_id=restaurant_id,
            )
    except Exception:
        logger.warning('Failed to write telemetry for %s', step_name, exc_info=True)


def main(
    models: Optional[list[str]] = None,
    run_date: Optional[str] = None,
) -> int:
    """Orchestrate forecast runs across models x KPIs.

    Returns 0 if at least one model/KPI succeeded, 1 if all failed.
    """
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    )

    rd = date.fromisoformat(run_date) if run_date else date.today()
    enabled = models if models else get_enabled_models()

    logger.info('Forecast run: date=%s models=%s kpis=%s', rd, enabled, KPIS)

    client = db.make_client()
    restaurant_id = _get_restaurant_id(client)
    shop_cal = _fetch_shop_calendar(client, restaurant_id)

    any_success = False

    for kpi_name in KPIS:
        # fetch history once per KPI (shared across models)
        try:
            history = _fetch_history(client, restaurant_id, kpi_name)
        except Exception:
            logger.error('Failed to fetch history for %s', kpi_name, exc_info=True)
            continue

        for model_name in enabled:
            step_name = f'forecast_{model_name}_{kpi_name}'
            started_at = datetime.now(timezone.utc)
            try:
                row_count = _run_model(
                    client,
                    model_name=model_name,
                    kpi_name=kpi_name,
                    restaurant_id=restaurant_id,
                    history=history,
                    shop_cal=shop_cal,
                    run_date=rd,
                )
                logger.info(
                    '%s: wrote %d rows', step_name, row_count
                )
                _write_telemetry(
                    client,
                    step_name=step_name,
                    started_at=started_at,
                    status='success',
                    row_count=row_count,
                    restaurant_id=restaurant_id,
                )
                any_success = True
            except Exception as exc:
                logger.error('%s failed: %s', step_name, exc, exc_info=True)
                _write_telemetry(
                    client,
                    step_name=step_name,
                    started_at=started_at,
                    status='failure',
                    error_msg=traceback.format_exc(),
                    restaurant_id=restaurant_id,
                )

    # -- post-model evaluation: score last 7 days for each KPI --
    successful_models = [m for m in enabled]  # evaluate all enabled, even if some failed
    for kpi_name in KPIS:
        try:
            evaluate_last_7(client, restaurant_id, kpi_name, successful_models)
        except Exception:
            logger.error(
                'evaluate_last_7 failed for %s', kpi_name, exc_info=True
            )

    if any_success:
        logger.info('Forecast run complete — at least one model succeeded')
        return 0
    else:
        logger.error('Forecast run complete — ALL models failed')
        return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 14 forecast orchestrator')
    parser.add_argument(
        '--models',
        default='',
        help='Comma-separated model names (default: all enabled)',
    )
    parser.add_argument(
        '--run-date',
        default=None,
        help='YYYY-MM-DD forecast run date (default: today)',
    )
    args = parser.parse_args()

    model_list = get_enabled_models(override=args.models)
    sys.exit(main(models=model_list, run_date=args.run_date))
