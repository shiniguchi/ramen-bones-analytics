"""Phase 14: run_all.py — nightly forecast pipeline orchestrator.

Spawns each model as a subprocess (autoplan E2), threading Supabase credentials
explicitly into subprocess env (autoplan E7). Iterates models x KPIs.

After all models: calls refresh_forecast_mvs() RPC.

Exit codes:
  0  — at least one model/KPI combo succeeded
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

DEFAULT_MODELS = 'sarimax,prophet,ets,theta,naive_dow'
KPIS = ['revenue_eur', 'invoice_count']


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


def _build_subprocess_env(*, restaurant_id: str, kpi_name: str, run_date: str) -> dict:
    """Build env dict for subprocess: inherits current env + injects required vars.

    Explicitly threads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (autoplan E7).
    """
    env = os.environ.copy()
    env['RESTAURANT_ID'] = restaurant_id
    env['KPI_NAME'] = kpi_name
    env['RUN_DATE'] = run_date
    # Ensure Supabase credentials are present (E7: explicit threading, not implicit inheritance)
    for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'):
        if key not in env:
            raise RuntimeError(
                f'{key} must be set in the environment before running the forecast pipeline'
            )
    return env


def _run_model(*, model: str, restaurant_id: str, kpi_name: str, run_date: str) -> bool:
    """Spawn a single model fit as a subprocess. Returns True on success (exit 0)."""
    env = _build_subprocess_env(
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=run_date,
    )
    cmd = [sys.executable, '-m', f'scripts.forecast.{model}_fit']
    print(f'[run_all] Spawning: {" ".join(cmd)} KPI={kpi_name}')
    result = subprocess.run(cmd, env=env, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout, end='')
    if result.stderr:
        print(result.stderr, end='', file=sys.stderr)
    if result.returncode == 0:
        print(f'[run_all] {model}/{kpi_name}: SUCCESS')
        return True
    else:
        print(f'[run_all] {model}/{kpi_name}: FAILED (exit {result.returncode})', file=sys.stderr)
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
) -> int:
    """Core orchestration logic. Returns 0 on partial/full success, 1 on total failure."""
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

    # Resolve models list
    if not models:
        env_models = os.environ.get('FORECAST_ENABLED_MODELS', DEFAULT_MODELS)
        models = [m.strip() for m in env_models.split(',') if m.strip()]

    # Resolve run_date
    if run_date is None:
        run_date = date.today() - timedelta(days=1)
    run_date_str = run_date.isoformat()

    print(f'[run_all] models={models} kpis={KPIS} run_date={run_date_str}')

    # Iterate models x KPIs, spawning each as a subprocess
    successes = 0
    total = 0
    for model in models:
        for kpi in KPIS:
            total += 1
            ok = _run_model(
                model=model,
                restaurant_id=restaurant_id,
                kpi_name=kpi,
                run_date=run_date_str,
            )
            if ok:
                successes += 1

    print(f'[run_all] Completed: {successes}/{total} model/KPI combos succeeded')

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
    args = parser.parse_args()

    selected_models = None
    if args.models:
        selected_models = [m.strip() for m in args.models.split(',') if m.strip()]

    selected_run_date = None
    if args.run_date:
        selected_run_date = date.fromisoformat(args.run_date)

    sys.exit(main(models=selected_models, run_date=selected_run_date))
