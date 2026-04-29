"""Phase 13 EXT-04: BVG RSS strike-alert fetcher.

Primary URL:  https://www.bvg.de/de/verbindungen/stoerungsmeldungen.xml
Fallback URL: https://www.bvg.de/de/aktuell/stoerungen/rss.xml

URL VERIFICATION (2026-04-29) — KNOWN PRODUCTION GAP:
  - Primary URL returns HTTP 200 but `text/html` (BVG serves its landing
    page with a 200 status; the `.xml` extension does NOT yield RSS).
  - Fallback URL returns HTTP 404.
  - Both URLs are kept in `URLS` below as a structural placeholder so the
    fetcher's contract (provider switch + 5xx fallback + keyword filter)
    is fully shipped, BUT in production this fetcher will currently log
    a `pipeline_runs` row with row_count=0 (the HTML body has no <item>
    elements feedparser recognizes as RSS, so no alerts match KEYWORDS).
  - run_all.py's per-source try/except (Task 16) isolates this gracefully.
  - v1.4 follow-up: lock down a working endpoint. Candidates to investigate:
      * https://www.bvg.de/de/verbindungen/bahn-und-bus-stoerungen (HTML, scrape)
      * VBB-Verkehrsverbund Berlin-Brandenburg GTFS-RT alerts feed
      * BVG ATOM/RSS migration (BVG may have moved feeds; check meta tags)
  - Tests in tests/external/test_transit.py use monkeypatched httpx.get
    against hand-rolled fixtures, so they pass regardless of the live URL
    state — the test contract is the parsing/keyword logic, not the URL.

Phase 13 keyword scope (D-12):
    KEYWORDS = ['Streik', 'Warnstreik']
v1.4 PR may extend (Ausfall, Sperrung, Bauarbeiten, Gleisarbeiten) without
schema change.
"""
from __future__ import annotations
import hashlib
from datetime import datetime, timezone
from typing import Any
import httpx
import feedparser

from . import _http

URLS = [
    'https://www.bvg.de/de/verbindungen/stoerungsmeldungen.xml',  # primary  — STALE 2026-04-29 (200 text/html, not RSS)
    'https://www.bvg.de/de/aktuell/stoerungen/rss.xml',           # fallback — STALE 2026-04-29 (404)
]
KEYWORDS = ['Streik', 'Warnstreik']


class UpstreamUnavailableError(Exception):
    pass


def _alert_id(title: str, pub_date_iso: str) -> str:
    h = hashlib.sha256()
    h.update(title.encode('utf-8'))
    h.update(b'|')
    h.update(pub_date_iso.encode('utf-8'))
    return h.hexdigest()[:32]


def _match_keyword(text: str) -> str | None:
    # Sort longest-first so 'Warnstreik' wins over its substring 'Streik'.
    for k in sorted(KEYWORDS, key=len, reverse=True):
        if k.lower() in text.lower():
            return k
    return None


def _fetch_one(url: str) -> bytes:
    r = _http.request_with_retry('GET', url)
    if r.status_code >= 500:
        raise UpstreamUnavailableError(f'BVG {r.status_code} on {url}')
    r.raise_for_status()
    return r.content


def fetch_transit() -> list[dict[str, Any]]:
    """Try URLs in order; first 2xx wins. If all fail, raise UpstreamUnavailableError.

    REVIEW C-21: each per-URL request retries on transient
    429/503/ConnectError/ReadTimeout via _http.request_with_retry.
    """
    body = None
    last_err: Exception | None = None
    for url in URLS:
        try:
            body = _fetch_one(url)
            break
        except UpstreamUnavailableError as e:
            last_err = e
            continue
    if body is None:
        raise UpstreamUnavailableError(f'All BVG URLs failed; last={last_err}')

    feed = feedparser.parse(body)
    rows: list[dict[str, Any]] = []
    for entry in feed.entries:
        title = entry.get('title', '') or ''
        desc  = entry.get('description', '') or ''
        link  = entry.get('link', '') or ''
        haystack = f'{title} {desc}'
        matched = _match_keyword(haystack)
        if matched is None:
            continue
        # feedparser parses pubDate into entry.published_parsed (struct_time, UTC).
        pp = entry.get('published_parsed')
        if pp is not None:
            pub_dt = datetime(*pp[:6], tzinfo=timezone.utc)
        else:
            pub_dt = datetime.now(timezone.utc)
        rows.append({
            'alert_id':        _alert_id(title, pub_dt.isoformat()),
            'title':           title,
            'pub_date':        pub_dt,
            'matched_keyword': matched,
            'description':     desc[:1000] if desc else None,
            'source_url':      link,
        })
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r, 'pub_date': r['pub_date'].isoformat()}
        for r in rows
    ]
    res = client.table('transit_alerts').upsert(payload, on_conflict='alert_id').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'transit_alerts upsert failed: {res.error}')
    return len(payload)


def freshness_hours(rows: list[dict[str, Any]]) -> float | None:
    if not rows:
        return None
    latest = max(r['pub_date'] for r in rows)
    return (datetime.now(timezone.utc) - latest).total_seconds() / 3600.0
