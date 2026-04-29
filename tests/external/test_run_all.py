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
