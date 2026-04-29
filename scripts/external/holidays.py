"""Phase 13 EXT-02: holidays fetcher (python-holidays).

Returns rows for federal DE + Berlin (BE) state for the requested years.
Each date appears exactly once. `subdiv_code` distinguishes:
  - NULL  -> federal holiday observed nationally (Tag der Deutschen Einheit, etc.)
  - 'BE'  -> Berlin-only holiday not observed federally (Internationaler
             Frauentag, March 8, since 2019)

REVIEW C-11: prior implementation had two bugs.
  1. It seeded by federal first, then iterated BE entries and overwrote with
     `subdiv_code='BE'` on any name mismatch. But pyholidays returns localized
     names that may differ between Germany() and Germany(subdiv='BE') for
     the SAME federal date — flipping a national holiday's `subdiv_code` to
     'BE' incorrectly. Downstream filters on `subdiv_code IS NULL` for
     "federal" would have missed those rows.
  2. When names matched, it kept federal-seed-with-NULL but the loop variable
     was unused — a comment claimed "BE wins" which was the opposite of what
     the code actually did when names matched.

NEW APPROACH: Germany(subdiv='BE') is a SUPERSET that includes both federal
and BE-only dates with their (BE-locale) names. We iterate that ONCE, then
look up each date in Germany() (federal-only) to decide the subdiv_code.
Federal name wins when the date is federal — consistent string match
downstream regardless of BE locale variation.
"""
from __future__ import annotations
from datetime import date, datetime, timezone
from typing import Any
import holidays as pyholidays


def fetch_holidays(*, years: list[int]) -> list[dict[str, Any]]:
    de_federal = pyholidays.Germany(years=years)
    de_berlin  = pyholidays.Germany(subdiv='BE', years=years)  # superset

    rows: list[dict[str, Any]] = []
    for d, be_name in de_berlin.items():
        if d in de_federal:
            # Federal holiday — observed nationwide, also lands in BE results.
            # Use the federal name for downstream string-match consistency.
            rows.append({
                'date': d,
                'name': de_federal[d],
                'country_code': 'DE',
                'subdiv_code': None,
            })
        else:
            # BE-only (Frauentag etc.) — keep the BE-localized name.
            rows.append({
                'date': d,
                'name': be_name,
                'country_code': 'DE',
                'subdiv_code': 'BE',
            })
    return rows


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
