"""Phase 16.1 D-14 / D-15 — friend-persona window-start anchor tests.

Wave 0 RED tests for:
- window_start_for_grain (NEW helper) — D-14 math.
- pred_dates_for_grain (extended) — D-15 Option B window kwarg + B2 train_end.

These tests RED-fail until 16.1-04 Task 2 + Task 3 land.

Import style note: package-prefixed `from scripts.forecast.grain_helpers import ...`
matches the canonical convention used by every sibling test file (test_aggregation.py,
test_sample_paths.py, test_eval.py, test_run_all_grain_loop.py). Plan-text said
`from grain_helpers import ...` (bare) — empirically that fails with
`ModuleNotFoundError` under the existing `(cd scripts/forecast && pytest tests/...)`
runner because pytest's rootdir adds the rootdir, not the per-package directory,
to sys.path. Tracked as Rule 1 deviation in 16.1-04-SUMMARY.md.
"""
from __future__ import annotations
from datetime import date, timedelta
import pytest

from scripts.forecast.grain_helpers import pred_dates_for_grain, window_start_for_grain


# --- D-14 window_start_for_grain ---

def test_window_start_day_monday():
    # Mon Apr 27 (CW18 day 1) -> CW18 incomplete -> CW17 (Apr 20-26) latest complete -> Mon Apr 20.
    assert window_start_for_grain(date(2026, 4, 27), 'day') == date(2026, 4, 20)


def test_window_start_day_sunday_same_week():
    # Sun Apr 26 -> CW17 (Apr 20-26) IS complete -> Mon Apr 20.
    assert window_start_for_grain(date(2026, 4, 26), 'day') == date(2026, 4, 20)


def test_window_start_day_sunday_next_week():
    # Sun May 3 -> CW18 (Apr 27 - May 3) latest complete -> Mon Apr 27.
    assert window_start_for_grain(date(2026, 5, 3), 'day') == date(2026, 4, 27)


def test_window_start_week():
    # last_actual=Mon Apr 27 -> day anchor=Apr 20 -> -28d = Mar 23 (Mon of CW13).
    assert window_start_for_grain(date(2026, 4, 27), 'week') == date(2026, 3, 23)


def test_window_start_month_endmonth_complete():
    # W8: Apr 30 -> end-of-month -> April complete (relative to last_actual=Apr 30) ->
    # start_of_April - 3mo = Jan 1. Matches owner's May-4-2026 example.
    assert window_start_for_grain(date(2026, 4, 30), 'month') == date(2026, 1, 1)


def test_window_start_month_midmonth_incomplete():
    # W8: Apr 27 mid-month -> April INCOMPLETE relative to last_actual=Apr 27 ->
    # latest complete = March -> start_of_March - 3mo = 2025-12-01.
    # This is the genuine edge case where mid-month last_actual diverges
    # from a calendar-today reading.
    assert window_start_for_grain(date(2026, 4, 27), 'month') == date(2025, 12, 1)


def test_window_start_today_anchor():
    # Cold-start: last_actual=None should NOT crash; helper must accept today_fallback.
    # Behavior: pretend today=2026-05-04 (Mon); latest_complete_week ends Sun May 3 -> Mon Apr 27.
    result = window_start_for_grain(None, 'day', today_fallback=date(2026, 5, 4))
    assert result == date(2026, 4, 27)


def test_window_start_unknown_grain_raises():
    with pytest.raises(ValueError, match='Unknown granularity'):
        window_start_for_grain(date(2026, 4, 27), 'hour')  # type: ignore


# --- D-15 pred_dates_for_grain extension ---

def test_pred_dates_window_none_backcompat():
    # window_start=None must produce IDENTICAL output to pre-D-15 (forward-only).
    run = date(2026, 5, 3)
    result = pred_dates_for_grain(run_date=run, granularity='day', horizon=372, window_start=None)
    assert len(result) == 372
    assert result[0] == run + timedelta(days=1)
    assert result[-1] == run + timedelta(days=372)


def test_pred_dates_window_kwarg_default_is_none():
    # Calling without window_start kwarg must equal calling with window_start=None.
    run = date(2026, 5, 3)
    a = pred_dates_for_grain(run_date=run, granularity='day', horizon=372)
    b = pred_dates_for_grain(run_date=run, granularity='day', horizon=372, window_start=None)
    assert a == b


def test_pred_dates_with_window_day():
    run = date(2026, 5, 3)
    ws = date(2026, 4, 20)
    horizon = 372
    result = pred_dates_for_grain(run_date=run, granularity='day', horizon=horizon, window_start=ws)
    # First date = window_start.
    assert result[0] == ws
    # Last date = run_date + horizon.
    assert result[-1] == run + timedelta(days=horizon)
    # Sorted ascending, no duplicates.
    assert result == sorted(set(result))
    # Length = (run_date + horizon - window_start) + 1 = (May 3 + 372 - Apr 20) + 1 = 386.
    expected_len = (run + timedelta(days=horizon) - ws).days + 1
    assert len(result) == expected_len  # 386 at this fixture


def test_pred_dates_with_window_week():
    # Window=Mon CW13 (Mar 23). run_date=Sun May 3 (CW18). All entries must be Mondays.
    run = date(2026, 5, 3)
    ws = date(2026, 3, 23)
    result = pred_dates_for_grain(run_date=run, granularity='week', horizon=57, window_start=ws)
    assert result[0] == ws
    # Every entry is a Monday.
    assert all(d.weekday() == 0 for d in result), [(d, d.weekday()) for d in result if d.weekday() != 0]
    # Sorted ascending, unique, exactly 7 days apart.
    gaps = [(b - a).days for a, b in zip(result, result[1:])]
    assert all(g == 7 for g in gaps), gaps


def test_pred_dates_with_window_month():
    # Window=Jan 1 2026. run_date=May 3 2026. All entries must be first-of-month.
    run = date(2026, 5, 3)
    ws = date(2026, 1, 1)
    result = pred_dates_for_grain(run_date=run, granularity='month', horizon=17, window_start=ws)
    assert result[0] == ws
    # Every entry is first-of-month.
    assert all(d.day == 1 for d in result)
    # Strictly increasing.
    assert result == sorted(set(result))


def test_pred_dates_with_window_respects_train_end():
    # B2: window_start (Apr 20) precedes train_end+1 (Apr 26 = train_end Apr 25 + 1d).
    # Past-side output MUST drop dates strictly less than train_end+1d.
    run = date(2026, 5, 3)
    ws = date(2026, 4, 20)
    train_end = date(2026, 4, 25)
    horizon = 372
    result = pred_dates_for_grain(
        run_date=run, granularity='day', horizon=horizon,
        window_start=ws, train_end=train_end,
    )
    # First date must be train_end + 1d = Apr 26, NOT window_start (Apr 20).
    assert result[0] == train_end + timedelta(days=1), result[:5]
    # Pre-train_end+1 dates dropped entirely.
    assert all(d >= train_end + timedelta(days=1) for d in result)
    # Forward portion still ends at run + horizon.
    assert result[-1] == run + timedelta(days=horizon)
    # Sorted, unique.
    assert result == sorted(set(result))


def test_pred_dates_with_window_no_train_end():
    # B2: train_end=None (default) preserves Task 3 behavior — first date = window_start.
    run = date(2026, 5, 3)
    ws = date(2026, 4, 20)
    horizon = 372
    # Calling without train_end kwarg = back-compat path.
    result = pred_dates_for_grain(
        run_date=run, granularity='day', horizon=horizon, window_start=ws,
    )
    assert result[0] == ws


def test_pred_dates_window_unknown_grain_raises():
    with pytest.raises(ValueError, match='Unknown granularity'):
        pred_dates_for_grain(
            run_date=date(2026, 5, 3), granularity='hour', horizon=10, window_start=date(2026, 4, 20),  # type: ignore
        )
