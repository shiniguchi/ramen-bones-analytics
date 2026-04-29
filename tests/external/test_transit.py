"""Phase 13 EXT-04: transit_alerts fetcher (BVG RSS via feedparser)."""
from __future__ import annotations
from pathlib import Path
import httpx
import pytest

from scripts.external.transit import (
    fetch_transit, KEYWORDS, UpstreamUnavailableError,
    _strip_html, _safe_url,
)

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


def test_fetch_transit_raises_on_html_response(monkeypatch):
    """REVIEW C-10: BVG primary URL is documented to return HTTP 200 + landing
    page HTML (not RSS). feedparser.parse() silently returns entries=[] with
    no error — the prior fetcher wrote a fake 'success' row. fetch_transit
    must now raise UpstreamUnavailableError so run_all routes to 'fallback'."""
    html_body = b'<!DOCTYPE html><html><body><h1>BVG Stoerungen</h1></body></html>'
    # All URLs return the same HTML (both primary AND fallback degraded).
    monkeypatch.setattr(httpx, 'get', _mock_get(html_body))
    with pytest.raises(UpstreamUnavailableError, match='feedparser could not identify feed'):
        fetch_transit()


def test_strip_html_removes_tags_and_decodes_entities():
    """REVIEW MS-3: defends against stored XSS via title/description."""
    assert _strip_html('<script>alert(1)</script>Streik') == 'alert(1)Streik'
    assert _strip_html('<b>Warnstreik</b> &amp; mehr') == 'Warnstreik & mehr'
    # Empty / whitespace-only -> None.
    assert _strip_html('') is None
    assert _strip_html('   ') is None
    assert _strip_html(None) is None
    # max_len truncation.
    assert _strip_html('a' * 50, max_len=10) == 'a' * 10


def test_safe_url_allowlists_http_https_only():
    """REVIEW MS-3: javascript:/data:/file: schemes must be neutralized
    before they reach the database, where Phase 15 would later render
    them in an <a href> and trigger XSS."""
    assert _safe_url('https://www.bvg.de/foo') == 'https://www.bvg.de/foo'
    assert _safe_url('http://example.com/x')  == 'http://example.com/x'
    # All non-http(s) schemes -> empty string (NOT NULL preserved for DB constraint).
    assert _safe_url('javascript:alert(1)') == ''
    assert _safe_url('data:text/html;base64,PHNjcmlwdD4=') == ''
    assert _safe_url('file:///etc/passwd') == ''
    assert _safe_url('//evil.com/x') == ''
    assert _safe_url(None) == ''
    assert _safe_url('') == ''


def test_fetch_transit_sanitizes_xss_in_feed(monkeypatch):
    """REVIEW MS-3 integration: hostile RSS payload must not propagate
    HTML or javascript: schemes into the row written to the DB."""
    hostile = b'''<?xml version="1.0"?>
<rss version="2.0"><channel><title>BVG</title>
<item>
  <title><![CDATA[Warnstreik <script>alert('xss')</script> S-Bahn]]></title>
  <description>Heute &amp; morgen <img src=x onerror=alert(1)/></description>
  <link>javascript:alert('hijack')</link>
  <pubDate>Tue, 28 Apr 2026 10:00:00 +0000</pubDate>
</item></channel></rss>'''
    monkeypatch.setattr(httpx, 'get', _mock_get(hostile))
    rows = fetch_transit()
    assert len(rows) == 1
    r = rows[0]
    # Title: tags removed, entities decoded, but the keyword 'Warnstreik' survives.
    assert '<script>' not in r['title']
    assert 'Warnstreik' in r['title']
    # Description: <img> stripped, &amp; decoded.
    assert '<img' not in (r['description'] or '')
    assert '&amp;' not in (r['description'] or '')
    assert 'Heute & morgen' in (r['description'] or '')
    # source_url: javascript: scheme neutralized to empty string.
    assert r['source_url'] == ''


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
