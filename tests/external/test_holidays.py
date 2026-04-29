"""Phase 13 EXT-02: holidays fetcher — federal + Berlin (BE) including Frauentag."""
from __future__ import annotations
from datetime import date

from scripts.external.holidays import fetch_holidays


def test_returns_federal_dates_for_2026():
    rows = fetch_holidays(years=[2026])
    by_date = {r['date']: r for r in rows}
    # Tag der Deutschen Einheit is federal.
    assert date(2026, 10, 3) in by_date
    assert by_date[date(2026, 10, 3)]['country_code'] == 'DE'


def test_includes_berlin_frauentag_2026():
    """Internationaler Frauentag (Mar 8) is a Berlin-only holiday."""
    rows = fetch_holidays(years=[2026])
    frauentag = [r for r in rows if r['date'] == date(2026, 3, 8)]
    assert len(frauentag) == 1
    assert frauentag[0]['subdiv_code'] == 'BE'
    assert 'frauentag' in frauentag[0]['name'].lower() or 'frau' in frauentag[0]['name'].lower()


def test_dedupes_when_federal_and_be_collide():
    """If a date is BOTH federal and BE-listed, BE wins per migration 0042 comment."""
    rows = fetch_holidays(years=[2026])
    by_date: dict = {}
    for r in rows:
        by_date.setdefault(r['date'], []).append(r)
    # No two rows for the same date.
    for d, items in by_date.items():
        assert len(items) == 1, f'duplicate row for {d}: {items}'
