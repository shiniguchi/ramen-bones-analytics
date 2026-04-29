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
import html
import re
from datetime import datetime, timezone
from typing import Any
import httpx
import feedparser

from . import _http

# REVIEW MS-3: stored XSS defense. BVG RSS is attacker-controllable in the
# limited sense that anyone with access to publish the feed (or to spoof DNS)
# can inject HTML/JS payloads into title/description. Strip tags + decode
# entities at INGEST so the raw DB row is plain text.
_HTML_TAG_RE = re.compile(r'<[^>]+>')

TITLE_MAX = 500
DESCRIPTION_MAX = 1000


def _strip_html(text: str | None, max_len: int | None = None) -> str | None:
    """Remove HTML tags + decode entities + collapse whitespace.

    Conservative: drops *anything* that looks like a tag (regex, not a
    parser). Acceptable for short-form RSS title/description; would be
    wrong for rich content. Returns None for empty/whitespace-only input.
    """
    if not text:
        return None
    cleaned = _HTML_TAG_RE.sub('', text)
    cleaned = html.unescape(cleaned)
    cleaned = ' '.join(cleaned.split())
    if not cleaned:
        return None
    if max_len and len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned


def _safe_url(url: str | None) -> str:
    """Allowlist http(s):// only. Anything else (javascript:, data:, file:)
    becomes empty string — Phase 15 renderer should treat empty as 'no link'.
    REVIEW MS-3: prevents javascript:/data: URI XSS via the source_url field.
    """
    if not url:
        return ''
    s = url.strip()
    if s.startswith('http://') or s.startswith('https://'):
        return s
    return ''

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

    REVIEW C-10: detects feedparser silent-fail on HTML responses (the
    documented BVG-stale-URL case where the endpoint returns 200 + landing
    page HTML instead of RSS). feedparser.parse() does NOT raise on HTML —
    it returns version='', entries=[]. We treat that as upstream-unavailable.

    REVIEW MS-3: title / description / source_url are sanitized at ingest
    (strip HTML, html.unescape, scheme-allowlist URLs) so a compromised feed
    can't plant stored XSS or javascript: URIs that would later detonate in
    the Phase 15 dashboard renderer.
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
    # C-10: feedparser silent-fail detection. Empty version = format not
    # recognized (HTML, plain text, gibberish). Refuse to write 'success'
    # rows from a non-feed response.
    if not feed.version:
        bozo_reason = ''
        if getattr(feed, 'bozo', False):
            exc = getattr(feed, 'bozo_exception', None)
            bozo_reason = f' bozo={type(exc).__name__ if exc else "True"}'
        raise UpstreamUnavailableError(
            f'feedparser could not identify feed format (received {len(body)}B body, '
            f'likely HTML landing page or plain text){bozo_reason}'
        )

    rows: list[dict[str, Any]] = []
    for entry in feed.entries:
        raw_title = entry.get('title', '') or ''
        raw_desc  = entry.get('description', '') or ''
        raw_link  = entry.get('link', '') or ''
        # MS-3 sanitization happens BEFORE keyword matching so we don't
        # silently drop a Streik whose title is wrapped in stray markup.
        title = _strip_html(raw_title, max_len=TITLE_MAX)
        desc  = _strip_html(raw_desc,  max_len=DESCRIPTION_MAX)
        link  = _safe_url(raw_link)
        # If sanitization stripped the title to nothing, the row is unusable —
        # skip rather than insert an empty-title row.
        if not title:
            continue
        haystack = f'{title} {desc or ""}'
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
            'description':     desc,
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
