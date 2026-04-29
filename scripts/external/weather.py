"""Phase 13 EXT-01: weather fetcher.

Provider switch via WEATHER_PROVIDER env (default 'brightsky').

Bright Sky API:    https://api.brightsky.dev/weather?lat=52.52&lon=13.40&date=YYYY-MM-DD&last_date=YYYY-MM-DD
Open-Meteo API:    https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.40
                    &start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
                    &daily=temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max,cloud_cover_mean
                    &timezone=Europe/Berlin

Both APIs cover the historical-archive + forecast continuum; we cap forecast at +7 days.
30-day chunking keeps each request modest and lets one failed chunk be
reported as fallback without nuking a long backfill.

Returns (rows, upstream_freshness_h).
"""
from __future__ import annotations
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any
import httpx

from . import _http

LOCATION = 'berlin'
LAT = 52.52
LON = 13.40
CHUNK_DAYS = 30


class UpstreamUnavailableError(Exception):
    """Raised when the configured weather provider returns a non-2xx status.
    run_all.py catches this and writes a 'fallback' row to pipeline_runs."""


class PartialUpstreamError(UpstreamUnavailableError):
    """Raised when at least one chunk succeeded but a LATER chunk failed.

    REVIEW C-14: prior fetch_weather threw away every row already collected
    on chunk-N failure (one transient 502 on chunk 7 of 12 lost the first 6
    chunks of work). This exception carries the partial rows + freshness so
    run_all._run_weather can still upsert them and record a 'fallback' row
    that reflects the partial-data reality instead of a clean 'failure'.
    """
    def __init__(self, message: str, rows: list[dict[str, Any]], freshness_h: float | None):
        super().__init__(message)
        self.rows = rows
        self.freshness_h = freshness_h


def _chunks(start: date, end: date, n: int) -> list[tuple[date, date]]:
    out = []
    cur = start
    while cur <= end:
        chunk_end = min(end, cur + timedelta(days=n - 1))
        out.append((cur, chunk_end))
        cur = chunk_end + timedelta(days=1)
    return out


def normalize_brightsky(payload: dict[str, Any], location: str) -> list[dict[str, Any]]:
    """Bright Sky returns sub-daily entries under `weather`. Reduce to one
    row per date with min/max temperature and summed precipitation."""
    by_date: dict[date, dict[str, Any]] = {}
    for entry in payload.get('weather', []) or []:
        ts = entry.get('timestamp')
        if not ts:
            continue
        d = datetime.fromisoformat(ts.replace('Z', '+00:00')).date()
        bucket = by_date.setdefault(d, {
            'date': d, 'location': location, 'provider': 'brightsky',
            'temps': [], 'precip': 0.0, 'winds': [], 'clouds': [],
        })
        if (t := entry.get('temperature')) is not None:
            bucket['temps'].append(t)
        if (p := entry.get('precipitation')) is not None:
            bucket['precip'] += p
        if (w := entry.get('wind_speed')) is not None:
            bucket['winds'].append(w)
        if (c := entry.get('cloud_cover')) is not None:
            bucket['clouds'].append(c)
    rows: list[dict[str, Any]] = []
    for d, b in sorted(by_date.items()):
        rows.append({
            'date': b['date'],
            'location': b['location'],
            'temp_min_c': min(b['temps']) if b['temps'] else None,
            'temp_max_c': max(b['temps']) if b['temps'] else None,
            'precip_mm':  b['precip'],
            'wind_kph':   max(b['winds']) if b['winds'] else None,
            'cloud_cover': sum(b['clouds']) / len(b['clouds']) if b['clouds'] else None,
            'provider':   'brightsky',
        })
    return rows


def normalize_open_meteo(payload: dict[str, Any], location: str) -> list[dict[str, Any]]:
    """Open-Meteo returns parallel arrays under `daily` keyed by index."""
    daily = payload.get('daily', {}) or {}
    times = daily.get('time', []) or []
    rows: list[dict[str, Any]] = []
    for i, t in enumerate(times):
        rows.append({
            'date': date.fromisoformat(t),
            'location': location,
            'temp_min_c': (daily.get('temperature_2m_min') or [None])[i],
            'temp_max_c': (daily.get('temperature_2m_max') or [None])[i],
            'precip_mm':  (daily.get('precipitation_sum') or [None])[i],
            'wind_kph':   (daily.get('wind_speed_10m_max') or [None])[i],
            'cloud_cover': (daily.get('cloud_cover_mean') or [None])[i],
            'provider':   'open-meteo',
        })
    return rows


def _fetch_brightsky(start: date, end: date) -> dict[str, Any]:
    url = 'https://api.brightsky.dev/weather'
    params = {'lat': LAT, 'lon': LON, 'date': start.isoformat(), 'last_date': end.isoformat()}
    r = _http.request_with_retry('GET', url, params=params)
    if r.status_code >= 500:
        raise UpstreamUnavailableError(f'brightsky {r.status_code}')
    r.raise_for_status()
    return r.json()


def _fetch_open_meteo(start: date, end: date) -> dict[str, Any]:
    url = 'https://api.open-meteo.com/v1/forecast'
    params = {
        'latitude': LAT, 'longitude': LON,
        'start_date': start.isoformat(), 'end_date': end.isoformat(),
        'daily': 'temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max,cloud_cover_mean',
        'timezone': 'Europe/Berlin',
    }
    r = _http.request_with_retry('GET', url, params=params)
    if r.status_code >= 500:
        raise UpstreamUnavailableError(f'open-meteo {r.status_code}')
    r.raise_for_status()
    return r.json()


def _freshness_h(rows: list[dict[str, Any]]) -> float | None:
    """Hours since the latest PAST date in `rows`.

    REVIEW C-13: forecast responses include future dates; computing
    freshness against MAX(all dates) yields a negative number which the
    Phase 15 stale-data badge would mis-read as "ultra-fresh". Clamp to
    dates <= today; pure-forecast responses report 0.0; empty -> None.
    """
    today = datetime.now(timezone.utc).date()
    past_dates = [r['date'] for r in rows if r['date'] <= today]
    if past_dates:
        latest = max(past_dates)
        latest_dt = datetime(latest.year, latest.month, latest.day, tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - latest_dt).total_seconds() / 3600.0)
    if rows:
        return 0.0
    return None


def fetch_weather(*, start_date: date, end_date: date) -> tuple[list[dict[str, Any]], float | None]:
    """Fetch weather observations + forecast for [start_date, end_date].

    REVIEW C-21: each chunk request retries transparently via _http on transient
    429/503/ConnectError/ReadTimeout up to 3 attempts (exponential backoff).
    Non-retriable 5xx (500/502/504) still propagate to the UpstreamUnavailableError
    branch so a hard outage routes to a 'fallback' pipeline_runs row.

    REVIEW C-14: when a chunk fails AFTER prior chunks succeeded, raise
    PartialUpstreamError carrying the already-fetched rows + computed
    freshness. run_all._run_weather catches this and still upserts the
    partial data, then records a 'fallback' row. Old behavior threw 12+
    chunks of work away on a single transient 502.
    """
    provider = os.environ.get('WEATHER_PROVIDER', 'brightsky').strip().lower()
    rows: list[dict[str, Any]] = []
    for chunk_start, chunk_end in _chunks(start_date, end_date, CHUNK_DAYS):
        try:
            if provider == 'open-meteo':
                payload = _fetch_open_meteo(chunk_start, chunk_end)
                rows.extend(normalize_open_meteo(payload, LOCATION))
            else:
                payload = _fetch_brightsky(chunk_start, chunk_end)
                rows.extend(normalize_brightsky(payload, LOCATION))
        except UpstreamUnavailableError as e:
            if rows:
                raise PartialUpstreamError(
                    f'{e} (after {len(rows)} successful rows)',
                    rows, _freshness_h(rows),
                ) from e
            raise  # nothing fetched yet — full failure as before
    return rows, _freshness_h(rows)


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r, 'date': r['date'].isoformat() if hasattr(r['date'], 'isoformat') else r['date']}
        for r in rows
    ]
    res = client.table('weather_daily').upsert(payload, on_conflict='date,location').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'weather_daily upsert failed: {res.error}')
    return len(payload)
