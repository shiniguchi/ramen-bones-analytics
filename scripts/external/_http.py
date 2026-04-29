"""Phase 13 (REVIEW C-21): shared HTTP retry helper for external fetchers.

WHY:
- Each fetcher previously called `httpx.get(...)` per chunk/year/URL with no
  retry. A single transient 503 / ReadTimeout / ConnectError aborted the
  whole night for a backfill that just hit one bad upstream blip.

WHAT THIS PROVIDES:
- `request_with_retry(method, url, **kwargs)` — exponential-backoff retry on
  transient failures (429, 503, ConnectError, ReadTimeout, ConnectTimeout)
  up to MAX_ATTEMPTS attempts. Non-retriable 5xx (500/502/504) propagate so
  the caller's existing UpstreamUnavailableError path still converts to a
  'fallback' pipeline_runs row.

Hand-rolled, no tenacity dep — keeps requirements.txt small.

Note: kept as module-level dispatch (httpx.get / httpx.post) instead of a
shared httpx.Client so existing fetcher tests that monkeypatch `httpx.get`
keep working. Connection-pool reuse is a follow-up; the retry is the bigger
production win.
"""
from __future__ import annotations
import time
from typing import Any
import httpx

# Default timeout: 30s read, 10s connect. Caller may override via kwargs.
DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Transient HTTP statuses worth retrying. 500/502/504 are NOT retried — they
# propagate so the caller can convert to UpstreamUnavailableError + fallback.
RETRY_STATUSES = frozenset({429, 503})

# Network-layer exceptions we treat as transient.
RETRY_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
)

MAX_ATTEMPTS = 3
BASE_BACKOFF_S = 1.0


def request_with_retry(
    method: str,
    url: str,
    *,
    sleep: Any = time.sleep,
    **kwargs: Any,
) -> httpx.Response:
    """Issue an HTTP request, retrying transient failures with exponential backoff.

    Dispatches to `httpx.<method>(url, **kwargs)` so monkeypatched httpx.get/post
    in tests continues to work. Default timeout applied if caller didn't supply one.

    Returns the response on success. The caller is responsible for inspecting
    `r.status_code` / calling `r.raise_for_status()` for non-transient errors —
    this helper only handles 429/503 + network exceptions.

    `sleep` is injected for tests (pass `lambda _: None` to skip backoff delays).
    """
    kwargs.setdefault('timeout', DEFAULT_TIMEOUT)
    fn = getattr(httpx, method.lower())
    last_exc: BaseException | None = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = fn(url, **kwargs)
        except RETRY_EXCEPTIONS as e:
            last_exc = e
            if attempt < MAX_ATTEMPTS - 1:
                sleep(BASE_BACKOFF_S * (2 ** attempt))
                continue
            raise
        if r.status_code in RETRY_STATUSES and attempt < MAX_ATTEMPTS - 1:
            sleep(BASE_BACKOFF_S * (2 ** attempt))
            continue
        return r
    # Unreachable in practice — the last loop iteration either returns or raises.
    if last_exc is not None:
        raise last_exc
    raise RuntimeError('request_with_retry exhausted attempts without raising')
