"""Phase 18 UPL-08: per-ISO-week bootstrap CI tests for compute_iso_week_uplift_rows.

These tests are RED until Plan 18-02 Task 2 implements
`scripts/forecast/cumulative_uplift.compute_iso_week_uplift_rows`.
The grain_helpers helper `bucket_dates_by_iso_week` lands in Task 1 (this file's
sibling action) and is exercised here transitively.

Synthetic numpy fixtures only — no DB, no network. Mirrors the
`synthetic_uplift_window` pattern at tests/forecast/test_cumulative_uplift.py:56-78.

Coverage targets per plan 18-02 behavior block:
1. test_skip_partial_launch_week         — leading-edge rule (campaign launches Tue → first ISO week has < 7 days → no row)
2. test_skip_in_progress_current_week    — trailing-edge rule (week_end >= today → no row)
3. test_one_row_per_completed_week       — two full weeks, today = next Mon → exactly 2 rows
4. test_as_of_date_is_sunday             — every emitted row's as_of_date parses to a Sunday
5. test_n_days_always_7                  — every emitted row has n_days == 7
6. test_naive_dow_uplift_eur_is_none     — every emitted row has naive_dow_uplift_eur is None
7. test_seed_namespace_disjoint_from_per_day — bootstrap CI bounds match a direct seed=100_000 call
"""
from __future__ import annotations

import sys
import types
from datetime import date, timedelta

import numpy as np
import pytest


# Stub the supabase package BEFORE cumulative_uplift is imported — mirrors
# tests/forecast/test_cumulative_uplift.py:39-44 (CI runners without supabase-py).
if "supabase" not in sys.modules:
    _supabase_stub = types.ModuleType("supabase")
    _supabase_stub.create_client = lambda *a, **kw: None  # type: ignore[attr-defined]
    _supabase_stub.Client = type("Client", (), {})  # type: ignore[attr-defined]
    sys.modules["supabase"] = _supabase_stub


# Imported at top so an ImportError on `compute_iso_week_uplift_rows` produces
# a clean RED state (Task 2 implements it).
from scripts.forecast.cumulative_uplift import (  # noqa: E402
    bootstrap_uplift_ci,
    compute_iso_week_uplift_rows,
)
from scripts.forecast.grain_helpers import bucket_dates_by_iso_week  # noqa: E402


# ---- Fixture: build a (actual_values, paths_list, target_dates) triple. ----


@pytest.fixture
def synthetic_window_factory():
    """Build a synthetic cumulative-window slice of arbitrary length.

    Mirrors the `synthetic_uplift_window` shape from test_cumulative_uplift.py
    but parameterised over (start_date, n_days) for the per-week tests.

    Construction: 200 paths drawn from N(500, 10) per day; actual = 550 per
    day → constant +€50/day uplift, +€350/week point estimate. Bootstrap CI
    bounds will be within ~±€50 of that 350 point at 1000 resamples.
    """
    def _build(start_date: date, n_days: int, seed: int = 0):
        rng = np.random.default_rng(seed)
        paths = rng.normal(loc=500.0, scale=10.0, size=(n_days, 200))
        actual_values = np.full(n_days, 550.0)  # constant +€50/day uplift
        target_dates = [start_date + timedelta(days=i) for i in range(n_days)]
        return actual_values, paths.tolist(), target_dates
    return _build


# ---- Tests for compute_iso_week_uplift_rows (RED until Task 2). ----


def test_skip_partial_launch_week(synthetic_window_factory):
    """Leading-edge rule (CONTEXT.md line 30): the partial launch week is excluded.

    Fixture: 13 days starting 2026-04-14 (Tue, ISO W16).
    - W16 (Apr 14-19): only 6 days → partial → SKIPPED.
    - W17 (Apr 20-26): full 7 days, ends Sun Apr 26.
    today = Apr 27 (Mon W18 day 1) so W17 is "completed" (Sun < today).

    Expect: exactly 1 row (W17, as_of_date = '2026-04-26').
    """
    av, paths, dates = synthetic_window_factory(date(2026, 4, 14), 13)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 4, 27),
    )
    assert len(rows) == 1
    assert rows[0]["as_of_date"] == "2026-04-26"  # Sun of W17


def test_skip_in_progress_current_week(synthetic_window_factory):
    """Trailing-edge rule (CONTEXT.md line 29): the in-progress current week is excluded.

    Fixture: 17 days starting 2026-04-20 (Mon, W17). Days span W17 (7) + W18 (7)
    + partial W19 (3 days: May 4-6).
    today = 2026-05-06 (Wed of W19) → W19 is in-progress AND partial.

    Expect: exactly 2 rows (W17 + W18). W19 is filtered by BOTH the partial-bucket
    rule (3 < 7) AND the in-progress rule (May 6 >= May 6) — defense-in-depth.
    """
    av, paths, dates = synthetic_window_factory(date(2026, 4, 20), 17)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 5, 6),
    )
    assert len(rows) == 2
    as_of_dates = sorted(r["as_of_date"] for r in rows)
    assert as_of_dates == ["2026-04-26", "2026-05-03"]


def test_one_row_per_completed_week_when_two_full_weeks_present(synthetic_window_factory):
    """When the cumulative window contains exactly two full Mon-Sun weeks
    AND today has rolled past the second Sunday, both weeks emit a row.
    """
    av, paths, dates = synthetic_window_factory(date(2026, 4, 20), 14)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 5, 4),  # Mon of W19 — both W17 + W18 are completed
    )
    assert len(rows) == 2


def test_as_of_date_is_sunday_of_iso_week(synthetic_window_factory):
    """as_of_date must be the Sunday of the ISO week (idempotent upsert key).

    Per CONTEXT.md line 27: per-week rows are stable across runs because
    as_of_date = the Sunday of the ISO week, and the upsert PK includes
    (..., window_kind, as_of_date). Re-running a nightly cron writes the
    same key → idempotent UPDATE.
    """
    av, paths, dates = synthetic_window_factory(date(2026, 4, 20), 14)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 5, 4),
    )
    assert len(rows) > 0, "Expected at least one row to validate the contract"
    for r in rows:
        d = date.fromisoformat(r["as_of_date"])
        assert d.isocalendar().weekday == 7, (
            f"as_of_date {r['as_of_date']} is not a Sunday "
            f"(weekday={d.isocalendar().weekday}, expected 7)"
        )


def test_n_days_always_7(synthetic_window_factory):
    """Every emitted row covers a fully-completed ISO week → n_days == 7."""
    av, paths, dates = synthetic_window_factory(date(2026, 4, 20), 14)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 5, 4),
    )
    assert len(rows) > 0
    assert all(r["n_days"] == 7 for r in rows)


def test_naive_dow_uplift_eur_is_none(synthetic_window_factory):
    """naive_dow_uplift_eur is per-window only — None on iso_week rows.

    Mirrors compute_per_day_uplift_rows behavior at cumulative_uplift.py:183
    (per-day rows also set this to None). The cross-check column lives only
    on `campaign_window` and `cumulative_since_launch` rows.
    """
    av, paths, dates = synthetic_window_factory(date(2026, 4, 20), 14)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 5, 4),
    )
    assert len(rows) > 0
    assert all(r["naive_dow_uplift_eur"] is None for r in rows)


def test_seed_namespace_disjoint_from_per_day(synthetic_window_factory):
    """Helper uses seed = 100_000 + k for the k-th completed ISO week, disjoint
    from compute_per_day_uplift_rows() which uses seed = 42 + i for the i-th day.

    This test confirms (a) the seed offset is 100_000 + k starting at k=0 for
    the first chronological week, AND (b) the helper hands the 7-day slice to
    bootstrap_uplift_ci with that exact seed (so calling bootstrap_uplift_ci
    directly with seed=100_000 reproduces the helper's CI bounds).
    """
    av, paths, dates = synthetic_window_factory(date(2026, 4, 20), 7)
    rows = compute_iso_week_uplift_rows(
        restaurant_id="r1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=av,
        yhat_samples_per_day=paths,
        target_dates=dates,
        today=date(2026, 4, 28),  # Tue after W17 (Apr 20-26) — single completed week
    )
    assert len(rows) == 1
    direct = bootstrap_uplift_ci(
        actual_values=np.asarray(av),
        yhat_samples_per_day=paths,
        n_resamples=1000,
        seed=100_000,
    )
    assert abs(rows[0]["ci_lower_eur"] - direct["ci_lower_eur"]) < 0.01
    assert abs(rows[0]["ci_upper_eur"] - direct["ci_upper_eur"]) < 0.01
    assert abs(rows[0]["cumulative_uplift_eur"] - direct["cumulative_uplift_eur"]) < 0.01


# ---- Smoke test for bucket_dates_by_iso_week (the grain_helpers helper). ----


def test_bucket_dates_by_iso_week_groups_correctly():
    """Smoke test: 3 dates spanning 2 ISO weeks group as expected."""
    dates = [date(2026, 4, 20), date(2026, 4, 21), date(2026, 4, 27)]
    buckets = bucket_dates_by_iso_week(dates)
    assert len(buckets) == 2
    # W17 contains indices 0, 1 (Apr 20 Mon, Apr 21 Tue)
    assert (2026, 17) in buckets
    assert buckets[(2026, 17)] == [0, 1]
    # W18 contains index 2 (Apr 27 Mon)
    assert (2026, 18) in buckets
    assert buckets[(2026, 18)] == [2]
