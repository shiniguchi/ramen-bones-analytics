"""Phase 13 EXT-02: holidays fetcher (python-holidays).

Returns rows for federal DE + Berlin (BE) state for the requested years.
BE-specific entries (e.g. Internationaler Frauentag) carry subdiv_code='BE';
federal-only entries carry subdiv_code=NULL. If a date appears as BOTH
federal and BE, BE wins (subdiv_code='BE') and the BE name is preferred.
"""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Any
import holidays as pyholidays


def fetch_holidays(*, years: list[int]) -> list[dict[str, Any]]:
    de_federal = pyholidays.Germany(years=years)        # federal
    de_berlin  = pyholidays.Germany(subdiv='BE', years=years)  # BE-specific

    by_date: dict[date, dict[str, Any]] = {}
    # Seed with federal first.
    for d, name in de_federal.items():
        by_date[d] = {
            'date': d,
            'name': name,
            'country_code': 'DE',
            'subdiv_code': None,
        }
    # BE wins on overlap; introduces Frauentag etc.
    for d, name in de_berlin.items():
        # If federal already had this date, replace only when name differs (BE-only marker).
        prior = by_date.get(d)
        if prior is None or prior['name'] != name:
            by_date[d] = {
                'date': d,
                'name': name,
                'country_code': 'DE',
                'subdiv_code': 'BE',
            }
    return list(by_date.values())


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r, 'date': r['date'].isoformat() if hasattr(r['date'], 'isoformat') else r['date']}
        for r in rows
    ]
    res = client.table('holidays').upsert(payload, on_conflict='date').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'holidays upsert failed: {res.error}')
    return len(payload)


def freshness_hours() -> float:
    """Static dataset — freshness is 0 (always current)."""
    return 0.0
