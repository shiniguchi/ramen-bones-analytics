"""Phase 15-10 D-14: shared grain-aware helpers used by all 5 model fit
scripts and by /api/forecast (Phase 15-11). Single source of truth for
horizon, TRAIN_END computation, and forecast bucket date generation.

Extracted from per-script copies that were verbatim-identical (code review
I-1). Math is grain-driven, not model-driven, so there is no
parallel-evolution argument for keeping copies.
"""
from __future__ import annotations
from datetime import date, timedelta

from dateutil.relativedelta import relativedelta

# 15-10 D-14: per-grain forecast horizons (TRAIN_END -> last forecast bucket).
# Daily : 372d (~53 weeks; one extra week vs 52 for edge coverage).
# Weekly: 57 weeks (52 forward + 5-week back-test alignment window).
# Monthly: 17 months (12 forward + 5-month back-test alignment window).
HORIZON_BY_GRAIN: dict[str, int] = {'day': 372, 'week': 57, 'month': 17}

GRANULARITIES: tuple[str, ...] = ('day', 'week', 'month')


def train_end_for_grain(last_actual: date, granularity: str) -> date:
    """Compute the grain-specific TRAIN_END cutoff (D-14).

    Day  : last_actual - 7 days  (one full week back for back-test).
    Week : last_actual - 35 days (5 weeks back so all weekly buckets in
           the window are COMPLETE -- no partial trailing week sneaks in).
    Month: end-of-month for (last_actual.month - 5 calendar months).
           E.g. last_actual=2026-04-26 -> 2025-11-30.

    Note: at weekly/monthly grain the gap between train_end and the first
    forecast bucket can be ~35 days / ~5 months -- that gap is intentional.
    The look-back is sized so each training bucket is fully complete; we
    accept the freshness cost in exchange for unbiased trailing-bucket data.
    """
    if granularity == 'day':
        return last_actual - timedelta(days=7)
    if granularity == 'week':
        return last_actual - timedelta(days=35)
    if granularity == 'month':
        # "end of (last_actual minus 5 calendar months)".
        # Step 1: subtract 5 months from last_actual to land somewhere in target month.
        # Step 2: roll to the last day of THAT month.
        anchor = last_actual - relativedelta(months=5)
        first_of_anchor = anchor.replace(day=1)
        # End of anchor month = (first of next month) - 1 day.
        end_of_anchor = (first_of_anchor + relativedelta(months=1)) - timedelta(days=1)
        return end_of_anchor
    raise ValueError(f'Unknown granularity: {granularity!r}')


def window_start_for_grain(
    last_actual_date: date | None,
    granularity: str,
    today_fallback: date | None = None,
) -> date:
    """Phase 16.1 D-14: friend-persona window start anchored on last complete period.

    Day  : start_of_week(latest_complete_week_ending_before_or_on(last_actual_date))
           -- Monday-anchored. Ex: last_actual=2026-04-27 (Mon, CW18 day 1) ->
           CW18 incomplete -> CW17 (Apr 20-26) latest complete -> 2026-04-20.
           Ex: last_actual=2026-04-26 (Sun, CW17 last day) -> CW17 IS complete ->
           2026-04-20 (same).
    Week : day-grain anchor - 28 days = last 5 complete ISO weeks.
           Ex: 2026-04-27 -> day anchor 2026-04-20 -> 2026-03-23 (Mon CW13).
    Month: start_of_month(latest_complete_month) - 3 months.
           Ex: 2026-04-30 (end-of-month) -> April complete -> 2026-01-01.
           Ex: 2026-04-27 (mid-month) -> April INCOMPLETE -> March latest -> 2025-12-01.

    Cold-start: last_actual_date=None -> use today_fallback (or date.today() if also None).
    "Latest complete" is defined RELATIVE to last_actual_date, not calendar today.
    """
    if last_actual_date is None:
        # Cold-start fallback per RESEARCH.md §"What if cold-start?"
        last_actual_date = today_fallback if today_fallback is not None else date.today()

    if granularity == 'day':
        # weekday(): Mon=0..Sun=6. Find Monday of latest complete week.
        # If last_actual is Sun (weekday=6) -> the week ending on it IS complete -> Mon = Sun - 6d.
        # Else -> previous week is the latest complete -> Mon = (last_actual - weekday) - 7d.
        if last_actual_date.weekday() == 6:  # Sunday
            return last_actual_date - timedelta(days=6)
        # Mon of CURRENT (incomplete) week = last_actual - weekday. Step back 7d for last complete.
        current_monday = last_actual_date - timedelta(days=last_actual_date.weekday())
        return current_monday - timedelta(days=7)

    if granularity == 'week':
        # Day anchor (Monday of latest complete week), then -4 weeks (= 28 days) for 5-week window.
        day_anchor = window_start_for_grain(last_actual_date, 'day')
        return day_anchor - timedelta(days=28)

    if granularity == 'month':
        # Latest complete month: if last_actual is end-of-month (next-day rolls over), THIS month is complete.
        # Else previous month is latest complete. Then start_of(latest_complete) - 3 calendar months.
        next_day = last_actual_date + timedelta(days=1)
        is_end_of_month = next_day.month != last_actual_date.month
        if is_end_of_month:
            latest_complete_first = last_actual_date.replace(day=1)
        else:
            # Previous month: roll back to first-of-previous-month.
            latest_complete_first = (last_actual_date.replace(day=1) - timedelta(days=1)).replace(day=1)
        return latest_complete_first - relativedelta(months=3)

    raise ValueError(f'Unknown granularity: {granularity!r}')


def pred_dates_for_grain(*, run_date: date, granularity: str, horizon: int) -> list:
    """Build native-cadence target_dates starting one bucket after run_date.

    Day  : run_date+1, +2, ... +horizon days.
    Week : next ISO Monday strictly after run_date, then +7d steps.
    Month: first-of-month strictly after run_date, then +1 month steps.

    The first bucket is always strictly AFTER run_date (i.e. if run_date is
    a Monday at week grain, the first returned date is the *following*
    Monday, not the same day).
    """
    if granularity == 'day':
        return [run_date + timedelta(days=i + 1) for i in range(horizon)]
    if granularity == 'week':
        # ISO Monday of week strictly after run_date.
        # weekday(): Mon=0..Sun=6. Days to next Monday = (7 - weekday) % 7, but
        # if run_date itself is a Mon we still want NEXT Mon (not same day).
        days_to_next_mon = (7 - run_date.weekday()) % 7
        if days_to_next_mon == 0:
            days_to_next_mon = 7
        first_mon = run_date + timedelta(days=days_to_next_mon)
        return [first_mon + timedelta(days=7 * i) for i in range(horizon)]
    if granularity == 'month':
        # First-of-month strictly after run_date.
        first = (run_date.replace(day=1) + relativedelta(months=1))
        return [(first + relativedelta(months=i)) for i in range(horizon)]
    raise ValueError(f'Unknown granularity: {granularity!r}')


def parse_granularity_env(env_value: str | None, *, default: str = 'day') -> str:
    """Parse and validate a GRANULARITY env-var value.

    None or empty/whitespace-only -> `default`. Set-but-invalid -> ValueError
    with the same message format the per-script CLI guard used to print, so
    operator-facing error text stays consistent.
    """
    if env_value is None:
        return default
    stripped = env_value.strip()
    if not stripped:
        return default
    if stripped not in HORIZON_BY_GRAIN:
        raise ValueError(
            f'invalid GRANULARITY {stripped!r}; expected one of {list(HORIZON_BY_GRAIN)}'
        )
    return stripped
