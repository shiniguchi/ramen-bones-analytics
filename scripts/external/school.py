"""Phase 13 EXT-03: school_holidays fetcher (raw httpx, NOT the abandoned PyPI wrapper).

Endpoint per year:
    https://ferien-api.de/api/v1/holidays/BE/{year}.json

Returns list of {name, start, end, year, stateCode, slug}. We re-shape
into our schema with `block_name` (truncated of "Berlin" suffix) and
`start_date` / `end_date`.
"""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Any
import httpx

STATE = 'BE'
URL_TEMPLATE = 'https://ferien-api.de/api/v1/holidays/{state}/{year}.json'
TIMEOUT = 20.0


class UpstreamUnavailableError(Exception):
    pass


def fetch_school(*, years: list[int]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for y in years:
        url = URL_TEMPLATE.format(state=STATE, year=y)
        r = httpx.get(url, timeout=TIMEOUT)
        if r.status_code >= 500:
            raise UpstreamUnavailableError(f'ferien-api.de {r.status_code} for {y}: {r.text[:200]}')
        r.raise_for_status()
        for entry in r.json() or []:
            name = entry.get('name', '').strip()
            block_name = name.split(' ')[0] if name else 'Unknown'
            start_raw = entry.get('start')
            end_raw   = entry.get('end')
            if not (start_raw and end_raw):
                continue
            rows.append({
                'state_code': STATE,
                'block_name': block_name,
                'start_date': datetime.fromisoformat(start_raw.replace('Z','+00:00')).date(),
                'end_date':   datetime.fromisoformat(end_raw.replace('Z','+00:00')).date(),
                'year': entry.get('year', y),
            })
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r,
         'start_date': r['start_date'].isoformat(),
         'end_date': r['end_date'].isoformat()}
        for r in rows
    ]
    res = client.table('school_holidays').upsert(
        payload, on_conflict='state_code,block_name,start_date'
    ).execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'school_holidays upsert failed: {res.error}')
    return len(payload)


def freshness_hours(rows: list[dict[str, Any]]) -> float | None:
    """Hours since the latest end_date in the returned rows.

    REVIEW MS-4: switched from `datetime.utcnow()` (deprecated in Python 3.12,
    naive datetime) to `datetime.now(timezone.utc)` to match weather.py:139.
    Clamped to >= 0.0 because school break end_dates often live in the future
    (the API publishes upcoming blocks) and a negative freshness would be
    mis-read by the Phase 15 stale-data badge.
    """
    if not rows:
        return None
    latest = max(r['end_date'] for r in rows)
    latest_dt = datetime(latest.year, latest.month, latest.day, tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - latest_dt).total_seconds() / 3600.0)
