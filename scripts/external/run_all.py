"""Phase 13: run_all.py — nightly external-data orchestrator.

Iterates over six fetchers (weather, holidays, school, transit, events,
shop_calendar). Each runs in its own try/except so one source's failure
does not nuke the others. Per-source result lands as one row in
public.pipeline_runs via pipeline_runs_writer.

Exit codes (D-07):
- 0 if at least one source succeeded — cascade can still proceed
  with partial data.
- 1 if every source failed — hard infra issue; alerts the maintainer
  via GHA failure email.

Entry points:
- nightly cron: `python -m scripts.external.run_all` (dates default
  to yesterday + 7 forward weather days)
- backfill:     `python -m scripts.external.run_all --start-date 2025-06-11`
"""
from __future__ import annotations
import argparse
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import db, pipeline_runs_writer
from . import weather, holidays, school, transit, events, shop_calendar
from .weather import UpstreamUnavailableError as WeatherUnavailable
from .school  import UpstreamUnavailableError as SchoolUnavailable
from .transit import UpstreamUnavailableError as TransitUnavailable

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVENTS_YAML     = REPO_ROOT / 'config' / 'recurring_events.yaml'
SHOP_HOURS_YAML = REPO_ROOT / 'config' / 'shop_hours.yaml'

FALLBACK_EXCEPTIONS = (WeatherUnavailable, SchoolUnavailable, TransitUnavailable)


def make_client():
    """Indirection so tests can monkeypatch the supabase client constructor."""
    return db.make_client()


def _run_weather(client, start_date: date, end_date: date) -> str:
    started = datetime.now(timezone.utc)
    try:
        # Weather always covers 7 forward days regardless of nightly start_date.
        wstart = start_date
        wend = max(end_date, date.today() + timedelta(days=7))
        rows, freshness = weather.fetch_weather(start_date=wstart, end_date=wend)
        n = weather.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_weather', started_at=started,
            row_count=n, upstream_freshness_h=freshness,
        )
        return 'success'
    except FALLBACK_EXCEPTIONS as e:
        pipeline_runs_writer.write_fallback(
            client, step_name='external_weather', started_at=started, error_msg=str(e),
        )
        return 'fallback'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_weather', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_holidays(client, start_date: date, end_date: date) -> str:
    started = datetime.now(timezone.utc)
    try:
        years = sorted({start_date.year, end_date.year, end_date.year + 1})
        rows = holidays.fetch_holidays(years=years)
        n = holidays.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_holidays', started_at=started,
            row_count=n, upstream_freshness_h=holidays.freshness_hours(),
        )
        return 'success'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_holidays', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_school(client, start_date: date, end_date: date) -> str:
    started = datetime.now(timezone.utc)
    try:
        years = sorted({start_date.year, end_date.year, end_date.year + 1})
        rows = school.fetch_school(years=years)
        n = school.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_school', started_at=started,
            row_count=n, upstream_freshness_h=school.freshness_hours(rows),
        )
        return 'success'
    except FALLBACK_EXCEPTIONS as e:
        pipeline_runs_writer.write_fallback(
            client, step_name='external_school', started_at=started, error_msg=str(e),
        )
        return 'fallback'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_school', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_transit(client) -> str:
    started = datetime.now(timezone.utc)
    try:
        rows = transit.fetch_transit()
        n = transit.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_transit', started_at=started,
            row_count=n, upstream_freshness_h=transit.freshness_hours(rows),
        )
        return 'success'
    except FALLBACK_EXCEPTIONS as e:
        pipeline_runs_writer.write_fallback(
            client, step_name='external_transit', started_at=started, error_msg=str(e),
        )
        return 'fallback'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_transit', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_events(client) -> str:
    started = datetime.now(timezone.utc)
    try:
        rows = events.load_events(EVENTS_YAML)
        n = events.upsert(client, rows)
        pipeline_runs_writer.write_success(
            client, step_name='external_events', started_at=started,
            row_count=n, upstream_freshness_h=events.freshness_hours(),
        )
        return 'success'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_events', started_at=started, error_msg=str(e),
        )
        return 'failure'


def _run_shop_calendar(client) -> str:
    started = datetime.now(timezone.utc)
    try:
        today = date.today()
        rows = shop_calendar.generate_calendar(SHOP_HOURS_YAML, today=today)
        n = shop_calendar.upsert(client, rows)
        # Per-restaurant rows; record the FIRST restaurant_id in the YAML on the
        # pipeline_runs row. Multi-restaurant deployments would loop; v1 is single.
        rid = rows[0]['restaurant_id'] if rows else None
        pipeline_runs_writer.write_success(
            client, step_name='external_shop_calendar', started_at=started,
            row_count=n, upstream_freshness_h=shop_calendar.freshness_hours(),
            restaurant_id=rid,
        )
        return 'success'
    except Exception as e:
        pipeline_runs_writer.write_failure(
            client, step_name='external_shop_calendar', started_at=started, error_msg=str(e),
        )
        return 'failure'


def main(*, start_date: date, end_date: date) -> int:
    client = make_client()

    statuses = [
        _run_weather(client, start_date, end_date),
        _run_holidays(client, start_date, end_date),
        _run_school(client, start_date, end_date),
        _run_transit(client),
        _run_events(client),
        _run_shop_calendar(client),
    ]
    print(f'run_all: results = {dict(zip(["weather","holidays","school","transit","events","shop_calendar"], statuses))}')
    # Exit 0 if at least one success; exit 1 only if every source hit failure.
    if any(s == 'success' for s in statuses):
        return 0
    return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Phase 13 external-data orchestrator')
    parser.add_argument('--start-date', help='YYYY-MM-DD; defaults to yesterday', default=None)
    parser.add_argument('--end-date',   help='YYYY-MM-DD; defaults to today',     default=None)
    args = parser.parse_args()
    sd = date.fromisoformat(args.start_date) if args.start_date else date.today() - timedelta(days=1)
    ed = date.fromisoformat(args.end_date)   if args.end_date   else date.today()
    sys.exit(main(start_date=sd, end_date=ed))
