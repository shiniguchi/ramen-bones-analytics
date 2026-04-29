"""Phase 13 EXT-03: school_holidays fetcher (ferien-api.de raw httpx)."""
from __future__ import annotations
import json
from pathlib import Path
from datetime import date, datetime, timezone, timedelta
import httpx
import pytest

from scripts.external.school import fetch_school, upsert, freshness_hours, UpstreamUnavailableError

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def _mock_get(payload, status=200):
    def _g(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(status, json=payload, request=req)
    return _g


def test_fetch_school_returns_six_blocks_for_2026(monkeypatch):
    payload = json.loads((FIX / 'school_holidays_be_2026.json').read_text())
    monkeypatch.setattr(httpx, 'get', _mock_get(payload))
    rows = fetch_school(years=[2026])
    assert len(rows) == 6
    names = [r['block_name'] for r in rows]
    assert any('Sommer' in n for n in names)
    assert any('Weihnacht' in n for n in names)
    sommer = next(r for r in rows if 'Sommer' in r['block_name'])
    assert sommer['start_date'] == date(2026, 7, 9)
    assert sommer['end_date'] == date(2026, 8, 21)
    assert sommer['state_code'] == 'BE'
    assert sommer['year'] == 2026


def test_fetch_school_raises_on_5xx(monkeypatch):
    monkeypatch.setattr(httpx, 'get', _mock_get({'error': 'down'}, status=503))
    with pytest.raises(UpstreamUnavailableError):
        fetch_school(years=[2026])


# REVIEW T-1: upsert() + freshness_hours() unit tests.

def test_school_upsert_calls_table_with_correct_on_conflict(mock_client):
    """on_conflict must match 0043's PK (state_code, block_name, start_date)."""
    rows = [{
        'state_code': 'BE', 'block_name': 'Sommerferien',
        'start_date': date(2026, 7, 9), 'end_date': date(2026, 8, 21),
        'year': 2026,
    }]
    n = upsert(mock_client, rows)
    assert n == 1
    call = mock_client.calls[0]
    assert call['table'] == 'school_holidays'
    assert call['on_conflict'] == 'state_code,block_name,start_date'
    # Both date columns must be ISO-string-serialized.
    assert call['payload'][0]['start_date'] == '2026-07-09'
    assert call['payload'][0]['end_date']   == '2026-08-21'


def test_school_upsert_returns_zero_on_empty(mock_client):
    assert upsert(mock_client, []) == 0
    assert mock_client.calls == []


def test_school_freshness_hours_returns_none_on_empty():
    """Contract: empty -> None (no rows to compute freshness from)."""
    assert freshness_hours([]) is None


def test_school_freshness_hours_clamps_to_zero_for_future_end_date():
    """REVIEW MS-4: school break end_dates often live in the future
    (the API publishes upcoming blocks). Clamp keeps freshness_h ≥ 0
    so the Phase 15 stale-data badge can't mis-read negative as
    'ultra-fresh'."""
    future = date.today() + timedelta(days=30)
    assert freshness_hours([{'end_date': future}]) == 0.0


def test_school_freshness_hours_uses_tz_aware_now():
    """REVIEW MS-4 regression: must use datetime.now(timezone.utc), not
    deprecated datetime.utcnow(). Compute against a known past end_date
    and assert the result lands in a wide-but-deterministic band.

    The function compares to MIDNIGHT UTC of end_date, so for `today - 2d`
    the diff is in [48h, 72h) regardless of when in the day the test runs."""
    past = date.today() - timedelta(days=2)
    h = freshness_hours([{'end_date': past}])
    assert h is not None
    assert 48.0 <= h < 72.0, f'expected [48, 72) hours, got {h}'
