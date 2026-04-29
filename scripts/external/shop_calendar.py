"""Phase 13 EXT-07: shop_calendar generator.

Loads config/shop_hours.yaml (one entry per restaurant), expands the
weekly pattern across the next 365 days, applies per-date overrides,
and returns one row per (restaurant_id, date).

Out-of-cycle closures (vacation/illness): friend DMs Shin → Shin updates
YAML + commits → next nightly cron applies (CONTEXT.md D-09).

KNOWN PRE-MERGE ACTION (2026-04-29):
The placeholder restaurant_id `00000000-0000-0000-0000-000000000001` in
config/shop_hours.yaml MUST be replaced with the actual friend-restaurant
UUID before this fetcher's output is upserted in production.
"""
from __future__ import annotations
from datetime import date, timedelta, time
from pathlib import Path
from typing import Any
import yaml

FORWARD_DAYS = 365
WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def _parse_time(v: str | None) -> time | None:
    if v is None:
        return None
    if isinstance(v, time):
        return v
    return time.fromisoformat(v)


def generate_calendar(path: str | Path, *, today: date) -> list[dict[str, Any]]:
    raw = yaml.safe_load(Path(path).read_text(encoding='utf-8')) or []
    rows: list[dict[str, Any]] = []
    for entry in raw:
        rid = entry['restaurant_id']
        weekly = entry.get('weekly_pattern', {}) or {}
        overrides_list = entry.get('overrides', []) or []
        overrides_by_date = {date.fromisoformat(o['date']): o for o in overrides_list}

        for offset in range(FORWARD_DAYS):
            d = today + timedelta(days=offset)
            wname = WEEKDAY_NAMES[d.weekday()]
            wpat  = weekly.get(wname, {}) or {}
            row = {
                'restaurant_id': rid,
                'date':          d,
                'is_open':       bool(wpat.get('is_open', False)),
                'open_at':       _parse_time(wpat.get('open_at')),
                'close_at':      _parse_time(wpat.get('close_at')),
                'reason':        None,
            }
            ov = overrides_by_date.get(d)
            if ov is not None:
                row['is_open']  = bool(ov.get('is_open', row['is_open']))
                row['open_at']  = _parse_time(ov.get('open_at'))  if 'open_at'  in ov else row['open_at']
                row['close_at'] = _parse_time(ov.get('close_at')) if 'close_at' in ov else row['close_at']
                row['reason']   = ov.get('reason')
            rows.append(row)
    return rows


def upsert(client, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    payload = [
        {**r,
         'date':     r['date'].isoformat(),
         'open_at':  r['open_at'].isoformat()  if r['open_at']  else None,
         'close_at': r['close_at'].isoformat() if r['close_at'] else None}
        for r in rows
    ]
    res = client.table('shop_calendar').upsert(payload, on_conflict='restaurant_id,date').execute()
    if getattr(res, 'error', None):
        raise RuntimeError(f'shop_calendar upsert failed: {res.error}')
    return len(payload)


def freshness_hours() -> float:
    return 0.0
