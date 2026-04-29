"""Phase 13 EXT-03: school_holidays fetcher (ferien-api.de raw httpx)."""
from __future__ import annotations
import json
from pathlib import Path
from datetime import date
import httpx
import pytest

from scripts.external.school import fetch_school, UpstreamUnavailableError

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
