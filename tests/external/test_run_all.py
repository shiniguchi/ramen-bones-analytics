"""Phase 13: run_all.py orchestrator — per-source isolation + exit code semantics."""
from __future__ import annotations
from datetime import date
from unittest.mock import MagicMock, patch
import pytest

from scripts.external import run_all


def _fake_supabase_client():
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value = MagicMock(error=None)
    client.table.return_value.upsert.return_value.execute.return_value = MagicMock(error=None)
    return client


def _client_capturing_inserts():
    """Return (client, captured) where every .table().insert(payload).execute()
    appends payload to `captured` so per-fetcher test_run_all assertions can
    inspect the pipeline_runs row that was written."""
    client = MagicMock()
    captured: list[dict] = []
    def _insert(payload):
        captured.append(payload)
        return MagicMock(execute=MagicMock(return_value=MagicMock(error=None)))
    client.table.return_value.insert.side_effect = _insert
    client.table.return_value.upsert.return_value.execute.return_value = MagicMock(error=None)
    return client, captured


def _stub_all_fetchers(monkeypatch):
    """No-op all fetchers + their upserts. Tests then override one fetcher
    to inject a specific failure path."""
    monkeypatch.setattr(run_all.weather, 'fetch_weather', lambda **kw: ([], None))
    monkeypatch.setattr(run_all.weather, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.holidays, 'fetch_holidays', lambda **kw: [])
    monkeypatch.setattr(run_all.holidays, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.school, 'fetch_school', lambda **kw: [])
    monkeypatch.setattr(run_all.school, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.transit, 'fetch_transit', lambda: [])
    monkeypatch.setattr(run_all.transit, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.events, 'load_events', lambda p: [])
    monkeypatch.setattr(run_all.events, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.shop_calendar, 'generate_calendar', lambda p, today: [])
    monkeypatch.setattr(run_all.shop_calendar, 'upsert', lambda c, rows: 0)


def test_one_source_failure_does_not_abort_the_others(monkeypatch):
    """Per CONTEXT D-06: each fetcher in its own try/except. A failure in
    weather must NOT prevent holidays from being upserted."""
    client = _fake_supabase_client()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    # Weather raises; holidays + transit + events + school + shop_calendar succeed.
    monkeypatch.setattr(run_all.weather, 'fetch_weather',
                        lambda **kw: (_ for _ in ()).throw(RuntimeError('boom')))
    monkeypatch.setattr(run_all.holidays, 'fetch_holidays', lambda **kw: [])
    monkeypatch.setattr(run_all.holidays, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.school, 'fetch_school', lambda **kw: [])
    monkeypatch.setattr(run_all.school, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.transit, 'fetch_transit', lambda: [])
    monkeypatch.setattr(run_all.transit, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.events, 'load_events', lambda p: [])
    monkeypatch.setattr(run_all.events, 'upsert', lambda c, rows: 0)
    monkeypatch.setattr(run_all.shop_calendar, 'generate_calendar', lambda p, today: [])
    monkeypatch.setattr(run_all.shop_calendar, 'upsert', lambda c, rows: 0)

    rc = run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    # Exit 0 because at least one source succeeded.
    assert rc == 0


def test_all_sources_failed_returns_exit_1(monkeypatch):
    """Per CONTEXT D-07: exit 1 only if every source failed."""
    client = _fake_supabase_client()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    err = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('infra down'))
    monkeypatch.setattr(run_all.weather, 'fetch_weather', err)
    monkeypatch.setattr(run_all.holidays, 'fetch_holidays', err)
    monkeypatch.setattr(run_all.school,   'fetch_school',  err)
    monkeypatch.setattr(run_all.transit,  'fetch_transit', err)
    monkeypatch.setattr(run_all.events,   'load_events',   err)
    monkeypatch.setattr(run_all.shop_calendar, 'generate_calendar', err)

    rc = run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    assert rc == 1


def test_upstream_unavailable_writes_fallback_not_failure(monkeypatch):
    """Per CONTEXT D-06: UpstreamUnavailableError → write_fallback (not write_failure)."""
    from scripts.external.weather import UpstreamUnavailableError
    client = _fake_supabase_client()
    captured: list[dict] = []
    def _capture_insert(payload):
        captured.append(payload)
        return MagicMock(execute=MagicMock(return_value=MagicMock(error=None)))
    client.table.return_value.insert.side_effect = _capture_insert
    monkeypatch.setattr(run_all, 'make_client', lambda: client)

    monkeypatch.setattr(run_all.weather, 'fetch_weather',
                        lambda **kw: (_ for _ in ()).throw(UpstreamUnavailableError('502')))
    # Other sources no-op.
    for mod_name, fn_name in [
        ('holidays', 'fetch_holidays'), ('school', 'fetch_school'),
        ('transit', 'fetch_transit'), ('events', 'load_events'),
        ('shop_calendar', 'generate_calendar'),
    ]:
        mod = getattr(run_all, mod_name)
        monkeypatch.setattr(mod, fn_name, (lambda *a, **kw: []))
        if hasattr(mod, 'upsert'):
            monkeypatch.setattr(mod, 'upsert', lambda c, rows: 0)

    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    weather_rows = [r for r in captured if r.get('step_name') == 'external_weather']
    assert len(weather_rows) == 1
    assert weather_rows[0]['status'] == 'fallback'


# REVIEW T-2: school + transit UpstreamUnavailableError -> write_fallback.
# The existing test_upstream_unavailable_writes_fallback_not_failure covers
# weather only; school + transit have identical fallback handling but were
# uncovered.

def test_school_upstream_unavailable_writes_fallback(monkeypatch):
    from scripts.external.school import UpstreamUnavailableError as SchoolUnavailable
    client, captured = _client_capturing_inserts()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    _stub_all_fetchers(monkeypatch)
    monkeypatch.setattr(run_all.school, 'fetch_school',
                        lambda **kw: (_ for _ in ()).throw(SchoolUnavailable('ferien-api 503')))
    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    rows = [r for r in captured if r.get('step_name') == 'external_school']
    assert len(rows) == 1, f'expected exactly one external_school row, got {rows}'
    assert rows[0]['status'] == 'fallback'
    assert 'ferien-api' in rows[0]['error_msg']


def test_transit_upstream_unavailable_writes_fallback(monkeypatch):
    from scripts.external.transit import UpstreamUnavailableError as TransitUnavailable
    client, captured = _client_capturing_inserts()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    _stub_all_fetchers(monkeypatch)
    monkeypatch.setattr(run_all.transit, 'fetch_transit',
                        lambda: (_ for _ in ()).throw(TransitUnavailable('All BVG URLs failed')))
    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    rows = [r for r in captured if r.get('step_name') == 'external_transit']
    assert len(rows) == 1
    assert rows[0]['status'] == 'fallback'
    assert 'BVG' in rows[0]['error_msg']


# REVIEW T-3: per-fetcher general Exception -> write_failure. The aggregate
# "all sources failed -> exit 1" test covered this implicitly but never
# checked the SHAPE of the per-source 'failure' row.

@pytest.mark.parametrize('mod_name,fn_name,step_name,fetch_kwargs', [
    ('weather',       'fetch_weather',     'external_weather',     {'start_date': date(2026, 1, 1), 'end_date': date(2026, 1, 2)}),
    ('holidays',      'fetch_holidays',    'external_holidays',    {'years': [2026]}),
    ('school',        'fetch_school',      'external_school',      {'years': [2026]}),
    ('transit',       'fetch_transit',     'external_transit',     {}),
    ('events',        'load_events',       'external_events',      None),
    ('shop_calendar', 'generate_calendar', 'external_shop_calendar', None),
])
def test_general_exception_writes_failure_row(monkeypatch, mod_name, fn_name, step_name, fetch_kwargs):
    """Each fetcher's Exception path writes a 'failure' row carrying the
    exception text. Without this regression net, a future refactor that
    accidentally swallowed the message (or wrote 'success' on error) would
    ship silently."""
    client, captured = _client_capturing_inserts()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    _stub_all_fetchers(monkeypatch)
    mod = getattr(run_all, mod_name)
    monkeypatch.setattr(mod, fn_name, lambda *a, **kw: (_ for _ in ()).throw(RuntimeError(f'BOOM {mod_name}')))
    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    rows = [r for r in captured if r.get('step_name') == step_name]
    assert len(rows) == 1, f'{mod_name}: expected one row, got {rows}'
    assert rows[0]['status'] == 'failure'
    assert f'BOOM {mod_name}' in rows[0]['error_msg']
    assert rows[0]['row_count'] == 0


# REVIEW T-4: shop_calendar passes restaurant_id through to pipeline_runs —
# the only fetcher that does so. Required so freshness queries scoped by
# tenant work correctly when shop_calendar specifically goes stale.

def test_shop_calendar_propagates_restaurant_id_to_pipeline_runs(monkeypatch):
    client, captured = _client_capturing_inserts()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    _stub_all_fetchers(monkeypatch)
    fake_rid = '11111111-1111-1111-1111-111111111111'
    monkeypatch.setattr(run_all.shop_calendar, 'generate_calendar',
                        lambda p, today: [{'restaurant_id': fake_rid, 'date': today, 'is_open': True}])
    monkeypatch.setattr(run_all.shop_calendar, 'upsert', lambda c, rows: len(rows))
    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    rows = [r for r in captured if r.get('step_name') == 'external_shop_calendar']
    assert len(rows) == 1
    assert rows[0]['status'] == 'success'
    assert rows[0]['restaurant_id'] == fake_rid


def test_shop_calendar_with_empty_rows_writes_null_restaurant_id(monkeypatch):
    """Edge case: when generate_calendar returns [] (no YAML entries),
    restaurant_id falls back to None. Phase 12 audit-row pattern."""
    client, captured = _client_capturing_inserts()
    monkeypatch.setattr(run_all, 'make_client', lambda: client)
    _stub_all_fetchers(monkeypatch)
    # generate_calendar already stubbed to return [] in _stub_all_fetchers.
    run_all.main(start_date=date(2026, 4, 28), end_date=date(2026, 4, 29))
    rows = [r for r in captured if r.get('step_name') == 'external_shop_calendar']
    assert len(rows) == 1
    assert rows[0]['status'] == 'success'
    assert rows[0]['restaurant_id'] is None
