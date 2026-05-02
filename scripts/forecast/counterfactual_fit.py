"""Phase 16: Track-B counterfactual fits.

Per CONTEXT.md D-06: orchestrate 5 BAU models x 1 grain ('day') x 2 KPIs
sourcing from kpi_daily_with_comparable_v.revenue_comparable_eur (per
UPL-03 / D-04 / Guard 9). Each model fits on pre-campaign data ONLY:
    train_end = min(campaign_calendar.start_date) + train_end_offset
(default -7 per C-04 / D-01).

Writes forecast_track='cf' rows to forecast_daily; writes pipeline_runs
row per model with step_name='cf_<model>' and fit_train_end populated.

Resilient to per-model failure: if SARIMAX fails, naive_dow can still
succeed and produce uplift downstream (D-06).

Standalone debug entry point:
    python -m scripts.forecast.counterfactual_fit \
        [--models sarimax,prophet,ets,theta,naive_dow] \
        [--run-date YYYY-MM-DD] [--train-end-offset -7]
"""
from __future__ import annotations

import argparse
import os
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from scripts.forecast.db import make_client
from scripts.external.pipeline_runs_writer import write_failure, write_success

# CF fits use 'day' granularity ONLY per D-07 (no week/month CF rows).
CF_GRANULARITY = 'day'

# CF KPIs: revenue_comparable_eur (the comparable revenue stream, derived
# from baseline_items_v) and invoice_count. Per Guard 9 / D-04: kpi_name=
# 'revenue_eur' is FORBIDDEN with forecast_track='cf'. The kpi_name written
# to forecast_daily for CF revenue rows MUST be 'revenue_comparable_eur'.
CF_KPIS = ['revenue_comparable_eur', 'invoice_count']

# The 5 BAU models that get a Track-B variant.
CF_MODELS = ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']


def get_train_end(
    client,
    restaurant_id: str,
    train_end_offset: int = -7,
) -> Optional[date]:
    """Returns earliest campaign_calendar.start_date + train_end_offset days.

    Returns None if no campaign exists (no Track-B fit possible — caller
    should skip CF entirely).

    Phase 16 C-04 / D-01: default offset is -7d to avoid anticipation leakage
    (customers may change behavior in the week before a campaign launches).
    """
    resp = (
        client.table('campaign_calendar')
        .select('start_date')
        .eq('restaurant_id', restaurant_id)
        .order('start_date', desc=False)
        .limit(1)
        .execute()
    )
    if not resp.data:
        return None
    earliest_raw = resp.data[0]['start_date']
    if isinstance(earliest_raw, date) and not isinstance(earliest_raw, datetime):
        earliest = earliest_raw
    elif isinstance(earliest_raw, datetime):
        earliest = earliest_raw.date()
    else:
        earliest = date.fromisoformat(str(earliest_raw)[:10])
    return earliest + timedelta(days=train_end_offset)


def fit_one_model(
    client,
    *,
    model: str,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    train_end: date,
) -> int:
    """Fit one (model, kpi) Track-B variant; write rows to forecast_daily.

    Returns number of rows written.

    Per RESEARCH §2 Pitfall 2.3: build_exog_matrix is reused unchanged.
    Per RESEARCH §2 Pitfall 2.4: revenue_comparable_eur has lower variance —
    SARIMAX may fall back to (0,1,0) on convergence failure; surface the
    problem in the pipeline_runs error_msg so cumulative_uplift.py (Plan 06)
    can skip the suspect model.
    """
    # Lazy import per-model fit modules so an import error in one (e.g. prophet
    # missing) doesn't break the whole orchestrator.
    from scripts.forecast import sarimax_fit, prophet_fit, ets_fit, theta_fit, naive_dow_fit
    module_map = {
        'sarimax': sarimax_fit,
        'prophet': prophet_fit,
        'ets': ets_fit,
        'theta': theta_fit,
        'naive_dow': naive_dow_fit,
    }
    if model not in module_map:
        raise ValueError(f'Unknown CF model: {model!r}; expected one of {CF_MODELS}')
    mod = module_map[model]
    return mod.fit_and_write(
        client=client,
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        granularity=CF_GRANULARITY,
        track='cf',
        train_end=train_end,
    )


def main_cf(
    *,
    client,
    restaurant_id: str,
    models,
    run_date: date,
    train_end_offset: int = -7,
) -> dict:
    """Top-level Track-B orchestrator.

    Returns {'attempted': int, 'succeeded': int}. Per-model failure does NOT
    abort — partial success (e.g. 4/5 models) is acceptable per D-06; the
    downstream cumulative_uplift.py picks the available models for uplift.
    """
    train_end = get_train_end(client, restaurant_id, train_end_offset)
    if train_end is None:
        print(
            '[CF] No campaign_calendar rows for restaurant; skipping CF.',
            file=sys.stderr,
        )
        return {'attempted': 0, 'succeeded': 0}

    attempted = 0
    succeeded = 0
    models_to_run = models or CF_MODELS
    for model in models_to_run:
        if model not in CF_MODELS:
            # Skip silently: caller may pass models from BAU list (e.g. weather
            # extractor names) that don't have a CF variant.
            continue
        for kpi in CF_KPIS:
            attempted += 1
            started_at = datetime.now(timezone.utc)
            try:
                n = fit_one_model(
                    client,
                    model=model,
                    restaurant_id=restaurant_id,
                    kpi_name=kpi,
                    run_date=run_date,
                    train_end=train_end,
                )
                write_success(
                    client,
                    step_name=f'cf_{model}',
                    started_at=started_at,
                    row_count=n,
                    restaurant_id=restaurant_id,
                    fit_train_end=train_end,
                )
                succeeded += 1
                print(
                    f'[CF {model}/{kpi}] OK: {n} rows written, '
                    f'fit_train_end={train_end}'
                )
            except Exception:
                err = traceback.format_exc()
                print(f'[CF {model}/{kpi}] FAIL: {err}', file=sys.stderr)
                # Best-effort failure row — don't let pipeline_runs write
                # itself bring the whole orchestrator down.
                try:
                    write_failure(
                        client,
                        step_name=f'cf_{model}',
                        started_at=started_at,
                        error_msg=err,
                        restaurant_id=restaurant_id,
                        fit_train_end=train_end,
                    )
                except Exception as write_err:
                    print(
                        f'[CF {model}/{kpi}] could not write failure row: {write_err}',
                        file=sys.stderr,
                    )
                continue
    print(
        f'[CF] Done: attempted={attempted} succeeded={succeeded} '
        f'train_end={train_end}'
    )
    return {'attempted': attempted, 'succeeded': succeeded}


def _resolve_restaurant_id(client) -> str:
    """Fetch the first restaurant_id (single-tenant v1 — same pattern as run_all)."""
    resp = client.table('restaurants').select('id').limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise RuntimeError('No restaurants found in the restaurants table')
    return rows[0]['id']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Phase 16 Track-B counterfactual fit orchestrator'
    )
    parser.add_argument(
        '--models',
        help='Comma-separated subset of CF_MODELS (default: all 5 models)',
        default=None,
    )
    parser.add_argument(
        '--run-date',
        help='YYYY-MM-DD; defaults to yesterday',
        default=None,
    )
    parser.add_argument(
        '--train-end-offset',
        type=int,
        default=-7,
        help='Days before earliest campaign_calendar.start_date to use as '
             'TRAIN_END for CF fits (default -7 per C-04 / D-01).',
    )
    args = parser.parse_args()

    client = make_client()
    restaurant_id = _resolve_restaurant_id(client)

    selected_models = None
    if args.models:
        selected_models = [m.strip() for m in args.models.split(',') if m.strip()]

    if args.run_date:
        run_date = date.fromisoformat(args.run_date)
    else:
        run_date = date.today() - timedelta(days=1)

    result = main_cf(
        client=client,
        restaurant_id=restaurant_id,
        models=selected_models,
        run_date=run_date,
        train_end_offset=args.train_end_offset,
    )
    # Exit 0 if at least one model succeeded; 1 if everything failed.
    sys.exit(0 if result['succeeded'] > 0 or result['attempted'] == 0 else 1)
