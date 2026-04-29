"""Phase 13 EXT-05: events fetcher (PyYAML).

Loads the hand-curated config/recurring_events.yaml. event_id is the
primary key; date strings are parsed to datetime.date objects.
"""
from __future__ import annotations
from datetime import date, datetime
from pathlib import Path
from typing import Any
import yaml


def _parse_date(v: Any) -> date:
    if isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, str):
        return date.fromisoformat(v)
    raise ValueError(f'cannot parse date from {v!r}')


def load_events(path: str | Path) -> list[dict[str, Any]]:
    raw = yaml.safe_load(Path(path).read_text(encoding='utf-8')) or []
    rows: list[dict[str, Any]] = []
    for entry in raw:
        rows.append({
            'event_id':         entry['event_id'],
            'name':             entry['name'],
            'category':         entry['category'],
            'start_date':       _parse_date(entry['start_date']),
            'end_date':         _parse_date(entry['end_date']),
            'impact_estimate':  entry['impact_estimate'],
            'notes':            entry.get('notes'),
            'source':           entry.get('source'),
        })
    ids = [r['event_id'] for r in rows]
    dupes = [x for x in ids if ids.count(x) > 1]
    if dupes:
        raise ValueError(f'duplicate event_ids in YAML: {sorted(set(dupes))}')
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r,
         'start_date': r['start_date'].isoformat(),
         'end_date':   r['end_date'].isoformat()}
        for r in rows
    ]
    res = client.table('recurring_events').upsert(payload, on_conflict='event_id').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'recurring_events upsert failed: {res.error}')
    return len(payload)


def freshness_hours() -> float:
    """Static (YAML) — always 0."""
    return 0.0
