"""Phase 13 EXT-01: weather fetcher tests — Bright Sky + Open-Meteo + 502 fallback."""
from __future__ import annotations
import json
from pathlib import Path
from datetime import date
from unittest.mock import MagicMock
import httpx
import pytest

from scripts.external.weather import fetch_weather, normalize_brightsky, normalize_open_meteo

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def _mock_httpx_get(payload, status_code=200):
    """Return a callable suitable for monkeypatch.setattr(httpx, 'get', ...).

    Builds a real httpx.Response so .json() / .raise_for_status() behave
    exactly as in production (no shape drift between fake and real).
    """
    def _get(url, params=None, timeout=None, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(status_code, json=payload, request=req)
    return _get


def test_normalize_brightsky_reduces_to_daily():
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    rows = normalize_brightsky(payload, location='berlin')
    assert len(rows) == 3
    apr29 = next(r for r in rows if r['date'] == date(2026, 4, 29))
    assert apr29['temp_min_c'] == 8.0
    assert apr29['temp_max_c'] == 16.0
    assert apr29['precip_mm'] == 0.0
    assert apr29['provider'] == 'brightsky'


def test_normalize_open_meteo_passthrough():
    payload = json.loads((FIX / 'weather_open_meteo_3day.json').read_text())
    rows = normalize_open_meteo(payload, location='berlin')
    assert len(rows) == 3
    apr30 = next(r for r in rows if r['date'] == date(2026, 4, 30))
    assert apr30['temp_min_c'] == 9.0
    assert apr30['temp_max_c'] == 14.0
    assert apr30['precip_mm'] == 4.7
    assert apr30['provider'] == 'open-meteo'


def test_fetch_weather_uses_brightsky_when_env_default(monkeypatch):
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'brightsky')
    monkeypatch.setattr(httpx, 'get', _mock_httpx_get(payload))
    rows, freshness_h = fetch_weather(start_date=date(2026, 4, 29), end_date=date(2026, 5, 1))
    assert len(rows) == 3
    assert all(r['provider'] == 'brightsky' for r in rows)
    assert freshness_h is not None  # at least computed


def test_fetch_weather_uses_open_meteo_when_env_set(monkeypatch):
    payload = json.loads((FIX / 'weather_open_meteo_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'open-meteo')
    monkeypatch.setattr(httpx, 'get', _mock_httpx_get(payload))
    rows, _ = fetch_weather(start_date=date(2026, 4, 29), end_date=date(2026, 5, 1))
    assert len(rows) == 3
    assert all(r['provider'] == 'open-meteo' for r in rows)


def test_fetch_weather_502_raises_upstream_unavailable(monkeypatch):
    """Open-Meteo 502 → raise UpstreamUnavailableError so run_all.py writes a 'fallback' row."""
    from scripts.external.weather import UpstreamUnavailableError
    monkeypatch.setenv('WEATHER_PROVIDER', 'open-meteo')
    def _bad(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(502, json={'error': 'Bad Gateway'}, request=req)
    monkeypatch.setattr(httpx, 'get', _bad)
    with pytest.raises(UpstreamUnavailableError):
        fetch_weather(start_date=date(2026, 4, 29), end_date=date(2026, 5, 1))


def test_fetch_weather_chunks_30_days(monkeypatch):
    """Long backfills must chunk; the test asserts httpx.get is called 2x for 45-day range."""
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'brightsky')
    call_log = []
    def _logging_get(url, params=None, **kwargs):
        call_log.append((url, params or {}))
        req = httpx.Request('GET', url)
        return httpx.Response(200, json=payload, request=req)
    monkeypatch.setattr(httpx, 'get', _logging_get)
    fetch_weather(start_date=date(2026, 1, 1), end_date=date(2026, 2, 14))  # 45 days
    assert len(call_log) >= 2


def test_fetch_weather_partial_chunk_failure_preserves_earlier_rows(monkeypatch):
    """REVIEW C-14: when chunk N fails AFTER chunk 1..N-1 succeeded, the
    fetcher must raise PartialUpstreamError carrying the already-fetched
    rows, NOT throw them away. run_all then upserts the partial data and
    writes a 'fallback' row reflecting the partial-data reality.
    """
    from scripts.external.weather import PartialUpstreamError, UpstreamUnavailableError
    payload = json.loads((FIX / 'weather_brightsky_3day.json').read_text())
    monkeypatch.setenv('WEATHER_PROVIDER', 'brightsky')

    call_count = {'n': 0}
    def _flaky_get(url, params=None, **kwargs):
        call_count['n'] += 1
        req = httpx.Request('GET', url)
        # First chunk: succeed. Second chunk: fail with 502.
        if call_count['n'] == 1:
            return httpx.Response(200, json=payload, request=req)
        return httpx.Response(502, json={'error': 'Bad Gateway'}, request=req)
    monkeypatch.setattr(httpx, 'get', _flaky_get)

    # 45 days = 2 chunks. Chunk 1 returns 3 rows from fixture; chunk 2 502s.
    with pytest.raises(PartialUpstreamError) as excinfo:
        fetch_weather(start_date=date(2026, 1, 1), end_date=date(2026, 2, 14))

    err = excinfo.value
    assert isinstance(err, UpstreamUnavailableError)  # subclass — existing FALLBACK_EXCEPTIONS still catches it
    assert len(err.rows) == 3, f'expected first-chunk rows preserved, got {len(err.rows)}'
    # Freshness was computed against whatever historical dates the fixture has.
    # (The 2026-04-29 fixture dates are far in the future relative to fixture content,
    # but the helper handles that — we just assert it's a number or None, not crashed.)
    assert err.freshness_h is None or isinstance(err.freshness_h, float)


def test_fetch_weather_first_chunk_failure_raises_plain_upstream_unavailable(monkeypatch):
    """REVIEW C-14 boundary: when the VERY FIRST chunk fails (no rows yet),
    fetch_weather raises plain UpstreamUnavailableError — NOT PartialUpstreamError.
    Caller treats it as full failure (no partial-data to flush).
    """
    from scripts.external.weather import PartialUpstreamError, UpstreamUnavailableError
    monkeypatch.setenv('WEATHER_PROVIDER', 'brightsky')

    def _bad(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(502, json={'error': 'Bad Gateway'}, request=req)
    monkeypatch.setattr(httpx, 'get', _bad)

    with pytest.raises(UpstreamUnavailableError) as excinfo:
        fetch_weather(start_date=date(2026, 1, 1), end_date=date(2026, 2, 14))
    assert not isinstance(excinfo.value, PartialUpstreamError), \
        'first-chunk failure must raise plain UpstreamUnavailableError, not PartialUpstreamError'


# REVIEW T-1: upsert() unit tests — pin on_conflict key + empty-rows guard
# without needing a live Supabase.

def test_weather_upsert_calls_table_with_correct_on_conflict(mock_client):
    """on_conflict must be 'date,location' to match weather_daily PK from 0041."""
    from scripts.external.weather import upsert
    rows = [{'date': date(2026, 4, 29), 'location': 'berlin', 'provider': 'brightsky',
             'temp_min_c': 8.0, 'temp_max_c': 16.0, 'precip_mm': 0.0,
             'wind_kph': None, 'cloud_cover': None}]
    n = upsert(mock_client, rows)
    assert n == 1
    assert len(mock_client.calls) == 1
    call = mock_client.calls[0]
    assert call['table'] == 'weather_daily'
    assert call['op'] == 'upsert'
    assert call['on_conflict'] == 'date,location'
    # date must be serialized to ISO string for PostgREST.
    assert call['payload'][0]['date'] == '2026-04-29'


def test_weather_upsert_returns_zero_on_empty(mock_client):
    """Empty rows must NOT issue a DB call (avoids no-op round trips)."""
    from scripts.external.weather import upsert
    n = upsert(mock_client, [])
    assert n == 0
    assert mock_client.calls == []
