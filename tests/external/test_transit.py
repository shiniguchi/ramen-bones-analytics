"""Phase 13 EXT-04: transit_alerts fetcher (BVG RSS via feedparser)."""
from __future__ import annotations
from pathlib import Path
import httpx
import pytest

from scripts.external.transit import fetch_transit, KEYWORDS

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def _mock_get(body, status=200):
    def _g(url, **kwargs):
        req = httpx.Request('GET', url)
        return httpx.Response(status, content=body, request=req)
    return _g


def test_keywords_locked_to_v1_set():
    """Phase 13 D-12: keyword scope is exactly {Streik, Warnstreik}. Extending
    the list is a v1.4 PR — this test prevents accidental scope creep."""
    assert KEYWORDS == ['Streik', 'Warnstreik']


def test_fetch_transit_matches_warnstreik(monkeypatch):
    body = (FIX / 'transit_bvg_rss_strike.xml').read_bytes()
    monkeypatch.setattr(httpx, 'get', _mock_get(body))
    rows = fetch_transit()
    assert len(rows) == 1
    r = rows[0]
    assert 'Warnstreik' in r['title']
    assert r['matched_keyword'] == 'Warnstreik'
    assert r['alert_id']  # sha256-derived, non-empty
    assert r['source_url'].startswith('https://www.bvg.de/')


def test_fetch_transit_returns_empty_when_no_strike(monkeypatch):
    body = (FIX / 'transit_bvg_rss_no_strike.xml').read_bytes()
    monkeypatch.setattr(httpx, 'get', _mock_get(body))
    rows = fetch_transit()
    assert rows == []


def test_fetch_transit_falls_back_when_primary_5xx(monkeypatch):
    """When primary URL returns 5xx, fetcher tries the fallback URL."""
    primary_body = b''
    fallback_body = (FIX / 'transit_bvg_rss_strike.xml').read_bytes()
    calls: list[tuple[str, int]] = []
    def _g(url, **kwargs):
        req = httpx.Request('GET', url)
        if 'verbindungen/stoerungsmeldungen' in url:  # primary
            calls.append((url, 503))
            return httpx.Response(503, content=primary_body, request=req)
        calls.append((url, 200))  # fallback
        return httpx.Response(200, content=fallback_body, request=req)
    monkeypatch.setattr(httpx, 'get', _g)
    rows = fetch_transit()
    assert len(rows) == 1
    # Both URLs were tried in order.
    assert len(calls) >= 2
    assert calls[0][1] == 503
    assert calls[-1][1] == 200
