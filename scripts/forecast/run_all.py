"""Phase 14 / 15-10: run_all.py — nightly forecast pipeline orchestrator.

Spawns each model as a subprocess (autoplan E2), threading Supabase credentials
explicitly into subprocess env (autoplan E7). Iterates models x KPIs x granularities.

15-10 changes:
  - Triple-nested loop adds GRANULARITY (day/week/month) per (model, KPI).
  - GRANULARITY env var threads native bucket cadence into each *_fit subprocess.
  - Freshness gate (D-16): abort cleanly if last_actual_date is stale (>8 days).

After all models: calls refresh_forecast_mvs() RPC.

Exit codes:
  0  — at least one model/KPI/grain combo succeeded, OR clean abort on stale data
  1  — all combos failed OR weather_daily guard tripped

CLI:
    python -m scripts.forecast.run_all [--models sarimax,...] [--run-date YYYY-MM-DD]

Default models from FORECAST_ENABLED_MODELS env var or 'sarimax,prophet,ets,theta,naive_dow'.
"""
from __future__ import annotations
import argparse
import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from scripts.forecast.db import make_client
from scripts.forecast.last_7_eval import evaluate_last_7
from scripts.forecast import counterfactual_fit
from scripts.external.pipeline_runs_writer import write_failure

DEFAULT_MODELS = 'sarimax,prophet,ets,theta,naive_dow'
KPIS = ['revenue_eur', 'invoice_count']
# 15-10: each model fits at 3 grains per refresh per KPI.
GRANULARITIES = ['day', 'week', 'month']
# Freshness gate threshold (D-16): if last_actual is stale by more than this,
# abort run_all cleanly instead of fitting on stale data.
FRESHNESS_GATE_DAYS = 8
STEP_NAME = 'forecast_run_all'


def _check_weather_guard(client) -> int:
    """Return row count in weather_daily. Aborts caller if zero."""
    resp = client.table('weather_daily').select('date', count='exact').limit(1).execute()
    return resp.count or 0


def _get_restaurant_id(client) -> str:
    """Fetch the first restaurant_id from the restaurants table."""
    resp = client.table('restaurants').select('id').limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise RuntimeError('No restaurants found in the restaurants table')
    return rows[0]['id']


def _get_last_actual_date(client, *, restaurant_id: str) -> Optional[date]:
    """Return max(business_date) from kpi_daily_mv for this restaurant, or None if empty.

    Used by the freshness gate to abort cleanly when extractor is behind.
    """
    resp = (
        client.table('kpi_daily_mv')
        .select('business_date')
        .eq('restaurant_id', restaurant_id)
        .order('business_date', desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        return None
    raw = rows[0]['business_date']
    # Supabase returns ISO date strings; coerce to date.
    if isinstance(raw, str):
        return date.fromisoformat(raw[:10])
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    raise RuntimeError(f'Unexpected business_date type from kpi_daily_mv: {type(raw)!r}')


def _build_subprocess_env(
    *,
    restaurant_id: str,
    kpi_name: str,
    run_date: str,
    granularity: str,
) -> dict:
    """Build env dict for subprocess: inherits current env + injects required vars.

    Explicitly threads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (autoplan E7).
    15-10: also threads GRANULARITY so each *_fit picks the matching TRAIN_END,
    horizon, seasonal period, and aggregation step.
    """
    env = os.environ.copy()
    env['RESTAURANT_ID'] = restaurant_id
    env['KPI_NAME'] = kpi_name
    env['RUN_DATE'] = run_date
    env['GRANULARITY'] = granularity
    # Ensure Supabase credentials are present (E7: explicit threading, not implicit inheritance)
    for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'):
        if key not in env:
            raise RuntimeError(
                f'{key} must be set in the environment before running the forecast pipeline'
            )
    return env


def _run_model(
    *,
    model: str,
    restaurant_id: str,
    kpi_name: str,
    run_date: str,
    granularity: str,
) -> bool:
    """Spawn a single model fit as a subprocess. Returns True on success (exit 0)."""
    env = _build_subprocess_env(
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
        granularity=granularity,
    )
    cmd = [sys.executable, '-m', f'scripts.forecast.{model}_fit']
    print(f'[run_all] Spawning: {" ".join(cmd)} KPI={kpi_name} GRAIN={granularity}')
    result = subprocess.run(cmd, env=env, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout, end='')
    if result.stderr:
        print(result.stderr, end='', file=sys.stderr)
    if result.returncode == 0:
        print(f'[run_all] {model}/{kpi_name}/{granularity}: SUCCESS')
        return True
    else:
        print(
            f'[run_all] {model}/{kpi_name}/{granularity}: FAILED (exit {result.returncode})',
            file=sys.stderr,
        )
        return False


def _refresh_mvs(client) -> None:
    """Call refresh_forecast_mvs() RPC to refresh forecast_daily_mv."""
    try:
        client.rpc('refresh_forecast_mvs', {}).execute()
        print('[run_all] refresh_forecast_mvs: done')
    except Exception as e:
        # MV refresh failure is not fatal — data is still in forecast_daily
        print(f'[run_all] refresh_forecast_mvs failed (non-fatal): {e}', file=sys.stderr)


def main(
    *,
    models: Optional[list] = None,
    run_date: Optional[date] = None,
    track: str = 'both',
    train_end_offset: int = -7,
) -> int:
    """Core orchestration logic. Returns 0 on partial/full success, 1 on total failure.

    Phase 16 D-06: ``track`` selects which pass(es) to run.
        'bau'  — Phase 14 BAU loop only (5 models x 2 KPIs x 3 grains = 30 spawns)
        'cf'   — Phase 16 Track-B counterfactual only (5 models x 1 grain x 2 KPIs = 10)
        'both' — BAU then CF (default)
    ``train_end_offset`` is forwarded to counterfactual_fit (default -7d per C-04).
    """
    client = make_client()

    # Weather guard — abort immediately if no weather data at all
    weather_count = _check_weather_guard(client)
    if weather_count == 0:
        print(
            '[run_all] ABORT: weather_daily has 0 rows. '
            'Run scripts.external.run_all first to populate weather data.',
            file=sys.stderr,
        )
        return 1

    # Resolve restaurant_id
    restaurant_id = _get_restaurant_id(client)
    print(f'[run_all] restaurant_id: {restaurant_id}')

    # 15-10 freshness gate (D-16): if extractor is behind, abort cleanly.
    # Writes a pipeline_runs failure row for triage but exits 0 — the workflow
    # itself shouldn't fail when upstream data is just late.
    last_actual = _get_last_actual_date(client, restaurant_id=restaurant_id)
    if last_actual is None:
        msg = 'kpi_daily_mv has no rows for restaurant — extractor never ran?'
        print(f'[run_all] ABORT: {msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=datetime.now(timezone.utc),
                error_msg=msg,
                restaurant_id=restaurant_id,
            )
        except Exception as e:
            print(f'[run_all] could not write failure row: {e}', file=sys.stderr)
        return 0
    days_since_last = (date.today() - last_actual).days
    if days_since_last > FRESHNESS_GATE_DAYS:
        # D-16 freshness gate: clean abort (return 0), not pipeline failure.
        # pipeline_runs_writer only exposes success|fallback|failure; we use
        # write_failure here for triage signal but the workflow exit is 0 so
        # GHA stays green. Filter pipeline_runs by step_name='forecast_run_all'
        # + error_msg starting with 'Stale data' to find these cases.
        msg = f'Stale data: last_actual={last_actual} stale by {days_since_last}d'
        print(f'[run_all] ABORT: {msg}', file=sys.stderr)
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=datetime.now(timezone.utc),
                error_msg=msg,
                restaurant_id=restaurant_id,
            )
        except Exception as e:
            print(f'[run_all] could not write failure row: {e}', file=sys.stderr)
        return 0

    # Resolve models list
    if not models:
        env_models = os.environ.get('FORECAST_ENABLED_MODELS', DEFAULT_MODELS)
        models = [m.strip() for m in env_models.split(',') if m.strip()]

    # Resolve run_date
    if run_date is None:
        run_date = date.today() - timedelta(days=1)
    run_date_str = run_date.isoformat()

    print(
        f'[run_all] models={models} kpis={KPIS} grains={GRANULARITIES} '
        f'run_date={run_date_str} last_actual={last_actual}'
    )

    # Iterate models x KPIs x granularities, spawning each as a subprocess.
    # 15-10: 5 models × 2 KPIs × 3 grains = 30 spawns/refresh on the full pipeline.
    successes = 0
    total = 0
    if track in ('bau', 'both'):
        for model in models:
            for kpi in KPIS:
                for granularity in GRANULARITIES:
                    total += 1
                    ok = _run_model(
                        model=model,
                        restaurant_id=restaurant_id,
                        kpi_name=kpi,
                        run_date=run_date_str,
                        granularity=granularity,
                    )
                    if ok:
                        successes += 1

        print(f'[run_all] BAU done: {successes}/{total} model/KPI/grain combos succeeded')

    # Phase 16 D-06: Track-B (counterfactual) pass — 5 models x 1 grain ('day') x 2 KPIs.
    # In-process call (no subprocess) — keeps per-model failure isolated via
    # counterfactual_fit's try/except wrapper around each fit_one_model call.
    if track in ('cf', 'both'):
        cf_result = counterfactual_fit.main_cf(
            client=client,
            restaurant_id=restaurant_id,
            models=models,
            run_date=run_date,
            train_end_offset=train_end_offset,
        )
        total += cf_result['attempted']
        successes += cf_result['succeeded']
        print(
            f"[run_all] CF done: {cf_result['succeeded']}/{cf_result['attempted']} "
            f'cf_<model>/KPI combos succeeded'
        )

    print(f'[run_all] Completed: {successes}/{total} combos succeeded total')

    # Evaluate last-7-day forecast accuracy for each model/KPI
    # Populates forecast_quality table for accuracy tracking.
    # NOTE: eval still runs at daily grain only — week/month grain accuracy
    # tracking is out of scope for 15-10. TODO: Phase 17 (backtest gate) is
    # the planned home for grain-specific evaluation windows.
    if successes > 0:
        print('[run_all] Running last-7-day evaluation ...')
        for model in models:
            for kpi in KPIS:
                try:
                    evaluate_last_7(
                        client,
                        restaurant_id=restaurant_id,
                        kpi_name=kpi,
                        model_name=model,
                    )
                    print(f'[run_all] eval {model}/{kpi}: OK')
                except Exception as e:
                    # Eval failure is non-fatal — new forecasts are still valid
                    print(f'[run_all] eval {model}/{kpi} failed: {e}', file=sys.stderr)

    # Always attempt MV refresh after all models
    _refresh_mvs(client)

    # Exit 0 if at least one succeeded; 1 if all failed
    return 0 if successes > 0 else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 14 forecast pipeline orchestrator')
    parser.add_argument(
        '--models',
        help=f'Comma-separated model list (default: FORECAST_ENABLED_MODELS env or {DEFAULT_MODELS!r})',
        default=None,
    )
    parser.add_argument(
        '--run-date',
        help='YYYY-MM-DD; defaults to yesterday',
        default=None,
    )
    parser.add_argument(
        '--track',
        choices=['bau', 'cf', 'both'],
        default='both',
        help='Forecast track. bau=Phase 14 BAU only; cf=Phase 16 counterfactual '
             'Track-B only; both=run BAU then CF (default).',
    )
    parser.add_argument(
        '--train-end-offset',
        type=int,
        default=-7,
        help='Days before earliest campaign_calendar.start_date to use as '
             'TRAIN_END for CF fits (default -7 per Phase 12 D-01 / C-04). '
             'Used by tests/forecast/cutoff_sensitivity.md (-14, -7, -1).',
    )
    args = parser.parse_args()

    selected_models = None
    if args.models:
        selected_models = [m.strip() for m in args.models.split(',') if m.strip()]

    selected_run_date = None
    if args.run_date:
        selected_run_date = date.fromisoformat(args.run_date)

    sys.exit(main(
        models=selected_models,
        run_date=selected_run_date,
        track=args.track,
        train_end_offset=args.train_end_offset,
    ))
