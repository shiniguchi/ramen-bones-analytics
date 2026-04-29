"""Phase 13 EXT-02: holidays fetcher — federal + Berlin (BE) including Frauentag."""
from __future__ import annotations
from datetime import date

from scripts.external.holidays import fetch_holidays


def test_returns_federal_dates_for_2026():
    rows = fetch_holidays(years=[2026])
    by_date = {r['date']: r for r in rows}
    # Tag der Deutschen Einheit is federal — observed nationally, NOT BE-specific.
    # REVIEW C-11: was previously flipped to subdiv_code='BE' on locale-name
    # variation between Germany() and Germany(subdiv='BE').
    assert date(2026, 10, 3) in by_date
    assert by_date[date(2026, 10, 3)]['country_code'] == 'DE'
    assert by_date[date(2026, 10, 3)]['subdiv_code'] is None, \
        'federal holiday must have subdiv_code=NULL even when BE returns a different localized name'


def test_includes_berlin_frauentag_2026():
    """Internationaler Frauentag (Mar 8) is a Berlin-only holiday."""
    rows = fetch_holidays(years=[2026])
    frauentag = [r for r in rows if r['date'] == date(2026, 3, 8)]
    assert len(frauentag) == 1
    assert frauentag[0]['subdiv_code'] == 'BE'
    assert 'frauentag' in frauentag[0]['name'].lower() or 'frau' in frauentag[0]['name'].lower()


def test_no_duplicate_rows_per_date():
    """Each date appears exactly once across federal + BE-superset iteration."""
    rows = fetch_holidays(years=[2026])
    by_date: dict = {}
    for r in rows:
        by_date.setdefault(r['date'], []).append(r)
    for d, items in by_date.items():
        assert len(items) == 1, f'duplicate row for {d}: {items}'


def test_federal_dates_keep_federal_name_not_be_localization():
    """REVIEW C-11 regression: when Germany() and Germany(subdiv='BE') return a
    federal date with potentially different localized names, the row must use
    the federal name. Downstream filters that match on a stable federal string
    rely on this — a BE-only locale name would silently miss the row."""
    rows = fetch_holidays(years=[2026])
    by_date = {r['date']: r for r in rows}
    # Pick a few federal dates and check their names match the federal source.
    import holidays as pyholidays
    federal = pyholidays.Germany(years=[2026])
    for fed_date, fed_name in federal.items():
        assert fed_date in by_date, f'federal {fed_date} missing from result'
        assert by_date[fed_date]['name'] == fed_name, \
            f'{fed_date}: expected federal name {fed_name!r}, got {by_date[fed_date]["name"]!r}'
        assert by_date[fed_date]['subdiv_code'] is None, \
            f'{fed_date}: federal date must have subdiv_code=NULL'


def test_empty_years_returns_empty():
    """Edge case: passing no years returns no rows (from REVIEW T-bonus)."""
    assert fetch_holidays(years=[]) == []
