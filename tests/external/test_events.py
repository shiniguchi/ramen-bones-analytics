"""Phase 13 EXT-05: events fetcher (PyYAML)."""
from __future__ import annotations
from pathlib import Path
from datetime import date

from scripts.external.events import load_events, upsert, freshness_hours

FIX = Path(__file__).resolve().parent.parent / 'fixtures' / 'external'


def test_load_test_fixture_yields_two_rows():
    rows = load_events(FIX / 'recurring_events.yaml')
    assert len(rows) == 2
    e1 = next(r for r in rows if r['event_id'] == 'test-event-1')
    assert e1['start_date'] == date(2026, 6, 1)
    assert e1['end_date'] == date(2026, 6, 2)
    assert e1['impact_estimate'] == 'high'
    assert e1['category'] == 'festival'


def test_load_production_yaml_has_unique_event_ids():
    """The production config/recurring_events.yaml must not contain duplicate event_ids
    (the migration's primary key is event_id)."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    rows = load_events(repo_root / 'config' / 'recurring_events.yaml')
    ids = [r['event_id'] for r in rows]
    assert len(ids) == len(set(ids)), f'duplicate event_ids in production YAML: {ids}'


def test_load_production_yaml_has_at_least_14_events():
    """CONTEXT.md D-11: ~15 events for 2026 + 2027."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    rows = load_events(repo_root / 'config' / 'recurring_events.yaml')
    assert len(rows) >= 14


# REVIEW T-1: upsert() + freshness_hours() unit tests.

def test_events_upsert_calls_table_with_correct_on_conflict(mock_client):
    """on_conflict must match 0045's PK (event_id)."""
    rows = [{
        'event_id': 'berlin-marathon-2026', 'name': 'Berlin Marathon',
        'category': 'sports',
        'start_date': date(2026, 9, 27), 'end_date': date(2026, 9, 27),
        'impact_estimate': 'high', 'notes': None, 'source': None,
    }]
    n = upsert(mock_client, rows)
    assert n == 1
    call = mock_client.calls[0]
    assert call['table'] == 'recurring_events'
    assert call['on_conflict'] == 'event_id'
    assert call['payload'][0]['start_date'] == '2026-09-27'
    assert call['payload'][0]['end_date']   == '2026-09-27'


def test_events_upsert_returns_zero_on_empty(mock_client):
    assert upsert(mock_client, []) == 0
    assert mock_client.calls == []


def test_events_freshness_hours_is_static_zero():
    """YAML config — bundled data, freshness is always 0."""
    assert freshness_hours() == 0.0
