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
