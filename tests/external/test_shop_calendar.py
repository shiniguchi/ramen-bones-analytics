"""Phase 13 EXT-07: shop_calendar fetcher."""
from __future__ import annotations
from pathlib import Path
from datetime import date, timedelta

from scripts.external.shop_calendar import generate_calendar, FORWARD_DAYS

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def test_generate_calendar_covers_365_days_forward():
    today = date(2026, 4, 29)
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    # One row per (restaurant_id, date) for 365 forward days.
    dates = {r['date'] for r in rows}
    assert min(dates) == today
    assert max(dates) == today + timedelta(days=FORWARD_DAYS - 1)
    assert len(dates) == FORWARD_DAYS


def test_generate_calendar_applies_weekly_pattern_correctly():
    today = date(2026, 4, 29)  # Wednesday
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    by_date = {r['date']: r for r in rows}
    # Wednesday is closed in the fixture.
    assert by_date[date(2026, 4, 29)]['is_open'] is False
    # Thursday is open noon-22.
    assert by_date[date(2026, 4, 30)]['is_open'] is True
    assert str(by_date[date(2026, 4, 30)]['open_at']) == '12:00:00'


def test_overrides_win_over_weekly_pattern():
    today = date(2026, 4, 29)
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    by_date = {r['date']: r for r in rows}
    # 2026-05-01 (Friday) is normally OPEN per weekly pattern, but override closes it.
    fri = by_date[date(2026, 5, 1)]
    assert fri['is_open'] is False
    assert fri['reason'] == 'Tag der Arbeit'


def test_generates_for_each_restaurant_in_yaml():
    today = date(2026, 4, 29)
    rows = generate_calendar(FIX / 'shop_hours.yaml', today=today)
    rids = {r['restaurant_id'] for r in rows}
    assert rids == {'11111111-1111-1111-1111-111111111111'}
