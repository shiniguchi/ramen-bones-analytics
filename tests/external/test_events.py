"""Phase 13 EXT-05: events fetcher (PyYAML)."""
from __future__ import annotations
from pathlib import Path
from datetime import date

from scripts.external.events import load_events

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
