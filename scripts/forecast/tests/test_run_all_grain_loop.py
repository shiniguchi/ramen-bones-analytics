"""15-10 Step 4: integration test for run_all triple-grain loop + freshness gate.

Asserts that scripts.forecast.run_all.main:
  - spawns model x KPI x grain subprocesses (3 grains tagged correctly)
  - aborts cleanly (return 0, no spawns) when last_actual is stale > 8 days

The subprocess + Supabase client are both mocked so the test runs offline
and in <1s. The supabase package isn't required at test time — we stub
the symbols (create_client, Client) into sys.modules before run_all
imports it transitively via scripts.forecast.db and pipeline_runs_writer.
"""
from __future__ import annotations
import sys
import types
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest


# ---- Stub the supabase package BEFORE run_all is imported.
# scripts.forecast.db does `from supabase import create_client, Client` at
# import time; pipeline_runs_writer does `from supabase import Client`. If
# the real supabase package isn't installed (true in some local envs and
# in CI where we don't pin it for unit tests), the import explodes. The
# stub satisfies the import; we never call into either symbol because
# make_client is patched out in each test.
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None  # never called
    _supabase_stub.Client = type('Client', (), {})        # type-hint only
    sys.modules['supabase'] = _supabase_stub


def _make_table_response(*, count=None, data=None):
    """Build a SimpleNamespace-style response object that mimics supabase-py's shape."""
    resp = types.SimpleNamespace()
    resp.count = count
    resp.data = data if data is not None else []
    return resp


def _build_mock_client(*, last_actual_iso: str):
    """Mock supabase client supporting all queries run_all.main makes.

    last_actual_iso controls what max(business_date) the freshness gate sees.
    """
    client = MagicMock(name='supabase_client')

    # ---- weather_daily: count=1 so the weather guard passes.
    weather_chain = MagicMock()
    weather_chain.select.return_value = weather_chain
    weather_chain.limit.return_value = weather_chain
    weather_chain.execute.return_value = _make_table_response(count=1)

    # ---- restaurants: returns one restaurant id.
    restaurants_chain = MagicMock()
    restaurants_chain.select.return_value = restaurants_chain
    restaurants_chain.limit.return_value = restaurants_chain
    restaurants_chain.execute.return_value = _make_table_response(
        data=[{'id': 'rest-1'}]
    )

    # ---- kpi_daily_mv: returns the chosen last_actual.
    kpi_chain = MagicMock()
    kpi_chain.select.return_value = kpi_chain
    kpi_chain.eq.return_value = kpi_chain
    kpi_chain.order.return_value = kpi_chain
    kpi_chain.limit.return_value = kpi_chain
    kpi_chain.execute.return_value = _make_table_response(
        data=[{'business_date': last_actual_iso}]
    )

    def table_router(name):
        if name == 'weather_daily':
            return weather_chain
        if name == 'restaurants':
            return restaurants_chain
        if name == 'kpi_daily_mv':
            return kpi_chain
        # Anything else (e.g. pipeline_runs) — return a fresh mock that
        # absorbs every method call and returns an empty response.
        catchall = MagicMock()
        catchall.select.return_value = catchall
        catchall.eq.return_value = catchall
        catchall.gte.return_value = catchall
        catchall.lte.return_value = catchall
        catchall.order.return_value = catchall
        catchall.limit.return_value = catchall
        catchall.insert.return_value = catchall
        catchall.upsert.return_value = catchall
        catchall.execute.return_value = _make_table_response(data=[])
        return catchall

    client.table.side_effect = table_router

    # rpc('refresh_forecast_mvs', {}).execute() — chained no-op
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = _make_table_response(data=[])
    client.rpc.return_value = rpc_chain

    return client


# Required env vars: _build_subprocess_env enforces these. Patch them in
# at session setup so the test never depends on the developer's shell.
@pytest.fixture(autouse=True)
def _supabase_env(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'http://test.local')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'test-role-key')


def test_run_all_loops_over_three_granularities():
    """1 model x 2 KPIs x 3 grains = 6 spawns, each with a distinct GRANULARITY env."""
    last_actual = (date.today() - timedelta(days=1)).isoformat()
    mock_client = _build_mock_client(last_actual_iso=last_actual)

    with patch('scripts.forecast.run_all.make_client', return_value=mock_client):
        with patch('scripts.forecast.run_all.subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0, stdout='', stderr=''
            )
            # evaluate_last_7 reads from forecast_daily; stub it out.
            with patch('scripts.forecast.run_all.evaluate_last_7'):
                from scripts.forecast.run_all import main
                rc = main(models=['sarimax'])

    assert rc == 0
    assert mock_run.call_count == 6
    spawned_grains = [
        call.kwargs['env']['GRANULARITY'] for call in mock_run.call_args_list
    ]
    assert sorted(spawned_grains) == ['day', 'day', 'month', 'month', 'week', 'week']

    # Sanity: KPIs covered too.
    spawned_kpis = sorted(
        call.kwargs['env']['KPI_NAME'] for call in mock_run.call_args_list
    )
    assert spawned_kpis == [
        'invoice_count', 'invoice_count', 'invoice_count',
        'revenue_eur', 'revenue_eur', 'revenue_eur',
    ]


def test_freshness_gate_aborts_on_stale_data():
    """If last_actual is more than FRESHNESS_GATE_DAYS old, abort cleanly: rc=0, no spawns."""
    stale = (date.today() - timedelta(days=10)).isoformat()
    mock_client = _build_mock_client(last_actual_iso=stale)

    with patch('scripts.forecast.run_all.make_client', return_value=mock_client):
        with patch('scripts.forecast.run_all.subprocess.run') as mock_run:
            with patch('scripts.forecast.run_all.evaluate_last_7'):
                from scripts.forecast.run_all import main
                rc = main(models=['sarimax'])

    assert mock_run.call_count == 0, 'No subprocesses should spawn on stale data'
    assert rc == 0, 'Stale data is a clean abort, not a workflow failure'
