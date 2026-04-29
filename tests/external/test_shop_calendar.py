"""Phase 13 EXT-07: shop_calendar fetcher."""
from __future__ import annotations
from pathlib import Path
from datetime import date, time, timedelta

from scripts.external.shop_calendar import generate_calendar, upsert, freshness_hours, FORWARD_DAYS

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


# REVIEW T-1: upsert() + freshness_hours() unit tests.

def test_shop_calendar_upsert_calls_table_with_correct_on_conflict(mock_client):
    """on_conflict must match 0047's PK (restaurant_id, date)."""
    rows = [{
        'restaurant_id': '11111111-1111-1111-1111-111111111111',
        'date':     date(2026, 4, 30),
        'is_open':  True,
        'open_at':  time(12, 0),
        'close_at': time(22, 0),
        'reason':   None,
    }]
    n = upsert(mock_client, rows)
    assert n == 1
    call = mock_client.calls[0]
    assert call['table'] == 'shop_calendar'
    assert call['on_conflict'] == 'restaurant_id,date'
    # date + open_at + close_at must all be ISO-string-serialized.
    p = call['payload'][0]
    assert p['date']     == '2026-04-30'
    assert p['open_at']  == '12:00:00'
    assert p['close_at'] == '22:00:00'


def test_shop_calendar_upsert_serializes_none_times_as_none(mock_client):
    """Closed days have open_at/close_at = None; the serializer must keep None
    (NOT crash trying to call .isoformat() on None)."""
    rows = [{
        'restaurant_id': '11111111-1111-1111-1111-111111111111',
        'date':     date(2026, 4, 29),
        'is_open':  False,
        'open_at':  None,
        'close_at': None,
        'reason':   None,
    }]
    n = upsert(mock_client, rows)
    assert n == 1
    p = mock_client.calls[0]['payload'][0]
    assert p['open_at']  is None
    assert p['close_at'] is None


def test_shop_calendar_upsert_returns_zero_on_empty(mock_client):
    assert upsert(mock_client, []) == 0
    assert mock_client.calls == []


def test_shop_calendar_freshness_hours_is_static_zero():
    """YAML config — bundled data, freshness is always 0."""
    assert freshness_hours() == 0.0
