"""Phase 16 UPL-04 RED tests: bootstrap CI math + per-window uplift contract.

Plan 16-06 / D-08 textbook form: 1000 path-level bootstrap resamples drawn
from 200 stored sample paths in `forecast_daily.yhat_samples`, percentile
2.5/97.5 quantiles for the 95% CI on the windowed sum `Σ(actual − path)`.

These tests are RED until Plan 06 Task 2 implements
`scripts/forecast/cumulative_uplift.py`. All six are skip-marked here;
Task 2's GREEN pass will remove the skip markers and verify them.

Synthetic numpy fixtures only — no DB, no network. The bootstrap CI math
is pure-numpy and must produce identical bounds for the same seed across
runs (deterministic-snapshot contract).

Coverage targets per the plan:
1. test_ci_coverage              — statistical 95% coverage at ≥90/100 sims
2. test_bootstrap_consistency    — determinism + saturation (1000 vs 5000)
3. test_naive_dow_present        — naive_dow_uplift_eur populated on every
                                   campaign-window row when CF rows exist
4. test_skip_empty_window        — windows with zero actuals → no row
5. test_two_window_kinds_per_campaign_per_model — campaign_window AND
                                   cumulative_since_launch rows written
6. test_bootstrap_one_path_per_resample — D-08 textbook form (one path per
                                   resample, NOT mean of resampled set)
"""
from __future__ import annotations

import sys
import types
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import numpy as np
import pytest


# ---- Stub the supabase package BEFORE cumulative_uplift is imported.
# Mirrors scripts/forecast/tests/test_run_all_grain_loop.py — keeps the
# pytest collection step from exploding on machines without supabase-py.
if "supabase" not in sys.modules:
    _supabase_stub = types.ModuleType("supabase")
    _supabase_stub.create_client = lambda *a, **kw: None  # type: ignore[attr-defined]
    _supabase_stub.Client = type("Client", (), {})  # type: ignore[attr-defined]
    sys.modules["supabase"] = _supabase_stub


# Skip-reason shared across all six tests until Task 2 lands the module.
_SKIP_REASON = (
    "RED: scripts/forecast/cumulative_uplift.py not yet implemented "
    "(Plan 06 Task 2). GREEN pass removes these skip markers."
)


# ---- Synthetic fixtures (numpy only; no DB).

@pytest.fixture
def synthetic_uplift_window():
    """30-day × 200-path fixture with TRUE cumulative uplift = +1500 EUR.

    Construction (per plan): for each day, 200 paths drawn from N(base, 10);
    `actual = base + 50` so `actual − path_mean ≈ 50` per day; window length
    is 30 days, so cumulative uplift ≈ 1500. The path-level CI must contain
    1500 in ≥ 95% of repeated sims (see test_ci_coverage's lenient bound).
    """
    rng = np.random.default_rng(0)
    n_days = 30
    n_paths = 200
    base = 500.0
    # Each row = 200 path draws around `base` with σ=10
    paths = rng.normal(loc=base, scale=10.0, size=(n_days, n_paths))
    actual_values = np.full(n_days, base + 50.0)
    return {
        "actual_values": actual_values,
        "yhat_samples_per_day": paths.tolist(),
        "true_uplift": 50.0 * n_days,  # 1500
        "n_days": n_days,
        "n_paths": n_paths,
    }


# ---- Tests.

def test_ci_coverage():
    """Statistical 95% coverage: across 100 sims with TRUE uplift = 1500,
    at least 90/100 of the bootstrap CIs contain 1500.

    Lenient bound (90) avoids flaking — exact 95% would fail occasionally.
    """
    from scripts.forecast.cumulative_uplift import bootstrap_uplift_ci

    n_sims = 100
    n_days = 30
    n_paths = 200
    base = 500.0
    true_uplift = 50.0 * n_days  # 1500

    contains = 0
    for sim_seed in range(n_sims):
        rng = np.random.default_rng(sim_seed)
        paths = rng.normal(loc=base, scale=10.0, size=(n_days, n_paths))
        actual_values = np.full(n_days, base + 50.0)

        result = bootstrap_uplift_ci(
            actual_values=actual_values,
            yhat_samples_per_day=paths.tolist(),
            n_resamples=1000,
            seed=sim_seed,
        )
        if result["ci_lower_eur"] <= true_uplift <= result["ci_upper_eur"]:
            contains += 1

    assert contains >= 90, (
        f"Bootstrap CI coverage too low: {contains}/{n_sims} contained "
        f"true_uplift={true_uplift}. Expected ≥ 90 for a 95%-target CI."
    )


def test_bootstrap_consistency(synthetic_uplift_window):
    """Determinism + saturation:
      (a) same seed → identical CI bounds across two calls
      (b) n_resamples=1000 vs 5000 (same seed) → CI bounds within 1%
    """
    from scripts.forecast.cumulative_uplift import bootstrap_uplift_ci

    fx = synthetic_uplift_window

    # (a) Determinism
    a = bootstrap_uplift_ci(
        actual_values=fx["actual_values"],
        yhat_samples_per_day=fx["yhat_samples_per_day"],
        n_resamples=1000,
        seed=42,
    )
    b = bootstrap_uplift_ci(
        actual_values=fx["actual_values"],
        yhat_samples_per_day=fx["yhat_samples_per_day"],
        n_resamples=1000,
        seed=42,
    )
    assert a["ci_lower_eur"] == b["ci_lower_eur"], "non-deterministic ci_lower"
    assert a["ci_upper_eur"] == b["ci_upper_eur"], "non-deterministic ci_upper"
    assert a["cumulative_uplift_eur"] == b["cumulative_uplift_eur"]

    # (b) Saturation between 1000 and 5000 resamples (same seed)
    c = bootstrap_uplift_ci(
        actual_values=fx["actual_values"],
        yhat_samples_per_day=fx["yhat_samples_per_day"],
        n_resamples=5000,
        seed=42,
    )

    # The point estimate is independent of n_resamples — same exact value.
    assert a["cumulative_uplift_eur"] == c["cumulative_uplift_eur"]

    # CI bounds within 1% of each other (saturation).
    span = max(abs(a["ci_upper_eur"] - a["ci_lower_eur"]), 1.0)
    assert abs(a["ci_lower_eur"] - c["ci_lower_eur"]) / span < 0.01, (
        f"ci_lower not saturated at 1000 resamples: 1000={a['ci_lower_eur']}, "
        f"5000={c['ci_lower_eur']}, span={span}"
    )
    assert abs(a["ci_upper_eur"] - c["ci_upper_eur"]) / span < 0.01, (
        f"ci_upper not saturated at 1000 resamples: 1000={a['ci_upper_eur']}, "
        f"5000={c['ci_upper_eur']}, span={span}"
    )


def test_bootstrap_one_path_per_resample():
    """D-08 textbook form: ONE path index per resample (not a 200-path
    bootstrap mean). Mock `rng.integers(0, P)` to return a known sequence
    and assert the function calls `paths[:, p].sum()` with that sequence,
    NOT `paths[:, idx].mean(axis=1)` (that's the alternate bootstrap-mean
    form documented in RESEARCH.md §1 for reference only).
    """
    from scripts.forecast import cumulative_uplift as mod

    n_days = 5
    n_paths = 200
    actual_values = np.array([100.0, 110.0, 105.0, 115.0, 95.0])
    # Each path is a constant column for easy verification:
    # paths[:, p] = [p, p, p, p, p] so (actual − paths[:, p]).sum() varies linearly with p.
    paths = np.tile(np.arange(n_paths, dtype=float), (n_days, 1))

    # Capture the sequence of integer draws the bootstrap loop uses.
    fixed_p_sequence = [0, 50, 100, 150, 199] + [42] * 995  # 1000 total
    call_count = {"n": 0}

    real_default_rng = np.random.default_rng

    class _FakeRng:
        def __init__(self):
            self._inner = real_default_rng(42)

        def integers(self, low, high, *args, **kwargs):
            # Return ONE int per call (textbook form). If the impl asks for
            # `size=` we still pop one — that's the wrong code path, fail loud.
            if "size" in kwargs and kwargs["size"] is not None:
                raise AssertionError(
                    "D-08 textbook form must call rng.integers(0, P) for ONE "
                    "path index per resample. The impl passed size=, which "
                    "indicates the bootstrap-mean (resample-200-then-average) "
                    "form — not allowed per CONTEXT.md D-08."
                )
            i = call_count["n"]
            call_count["n"] += 1
            return fixed_p_sequence[i]

    def _fake_default_rng(seed=None):
        return _FakeRng()

    with patch.object(mod.np.random, "default_rng", side_effect=_fake_default_rng):
        result = mod.bootstrap_uplift_ci(
            actual_values=actual_values,
            yhat_samples_per_day=paths.tolist(),
            n_resamples=1000,
            seed=42,
        )

    # Assert the loop drew exactly n_resamples path indices (textbook form).
    assert call_count["n"] == 1000, (
        f"Expected exactly 1000 single-path draws (textbook D-08 form), got "
        f"{call_count['n']}. Likely the impl used `size=P` (bootstrap-mean form)."
    )
    # Sanity: result has the required keys.
    assert "ci_lower_eur" in result
    assert "ci_upper_eur" in result
    assert "cumulative_uplift_eur" in result
    assert "n_days" in result


def test_naive_dow_present():
    """Every campaign-window row written must have `naive_dow_uplift_eur`
    populated (not NULL) when naive_dow CF rows exist for the window.

    This protects D-09 / UPL-05's divergence-warning rule — the column
    must be available for the SARIMAX vs naive_dow cross-check on every row.
    """
    from scripts.forecast.cumulative_uplift import compute_naive_dow_uplift

    # Compute a known naive_dow uplift from synthetic fixture.
    actual_values = np.array([100.0, 110.0, 105.0, 95.0, 120.0])
    naive_yhat = np.array([90.0, 95.0, 100.0, 90.0, 105.0])
    expected_uplift = float((actual_values - naive_yhat).sum())  # = 50

    # Mock client whose naive_dow CF rows match the inputs above.
    client = MagicMock(name="supabase_client")
    chain = MagicMock(name="forecast_with_actual_v_chain")
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.lte.return_value = chain
    chain.order.return_value = chain
    chain.execute.return_value = MagicMock(data=[
        {"target_date": "2026-04-14", "actual_value": 100.0, "yhat": 90.0},
        {"target_date": "2026-04-15", "actual_value": 110.0, "yhat": 95.0},
        {"target_date": "2026-04-16", "actual_value": 105.0, "yhat": 100.0},
        {"target_date": "2026-04-17", "actual_value": 95.0, "yhat": 90.0},
        {"target_date": "2026-04-18", "actual_value": 120.0, "yhat": 105.0},
    ])
    client.table.return_value = chain

    result = compute_naive_dow_uplift(
        client,
        restaurant_id="rest-1",
        campaign_id="friend-owner-2026-04-14",
        start_date=date(2026, 4, 14),
        end_date=date(2026, 4, 18),
    )

    # Must return a number (not None) — naive_dow_uplift_eur populated.
    assert result is not None
    assert isinstance(result, float)
    assert abs(result - expected_uplift) < 0.01, (
        f"naive_dow_uplift_eur off: got {result}, expected {expected_uplift}"
    )


def test_skip_empty_window():
    """When no actuals exist in a window (e.g., future-only window),
    `compute_uplift_for_window` returns None — caller must NOT write a row.
    """
    from scripts.forecast.cumulative_uplift import compute_uplift_for_window

    # Mock client returns empty data for forecast_with_actual_v.
    client = MagicMock(name="supabase_client")
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.gte.return_value = chain
    chain.lte.return_value = chain
    chain.order.return_value = chain
    chain.execute.return_value = MagicMock(data=[])
    client.table.return_value = chain

    result = compute_uplift_for_window(
        client,
        restaurant_id="rest-1",
        campaign_id="future-campaign",
        model_name="sarimax",
        start_date=date(2099, 1, 1),
        end_date=date(2099, 1, 7),
    )

    assert result is None, (
        "Empty windows must return None so main_uplift can skip the row. "
        f"Got: {result}"
    )


def test_two_window_kinds_per_campaign_per_model():
    """For each (campaign, model) pair, exactly two rows are upserted:
    `window_kind='campaign_window'` and `window_kind='cumulative_since_launch'`.
    """
    from scripts.forecast import cumulative_uplift as mod

    # Capture all upsert payloads to campaign_uplift table.
    upserted_rows: list = []

    def _resp(*, data=None):
        """Build a SimpleNamespace-style supabase response: data + error=None.

        Critical: error must be None (not a MagicMock auto-attr) so the
        production code's `getattr(res, 'error', None)` short-circuits.
        """
        return types.SimpleNamespace(data=(data if data is not None else []), error=None)

    def _table_router(name):
        m = MagicMock(name=f"chain[{name}]")
        m.select.return_value = m
        m.eq.return_value = m
        m.gte.return_value = m
        m.lte.return_value = m
        m.order.return_value = m
        m.limit.return_value = m
        m.insert.return_value = m

        def _upsert(payload, **_kwargs):
            if name == "campaign_uplift":
                if isinstance(payload, list):
                    upserted_rows.extend(payload)
                else:
                    upserted_rows.append(payload)
            return m

        m.upsert.side_effect = _upsert

        if name == "restaurants":
            m.execute.return_value = _resp(data=[{"id": "rest-1"}])
        elif name == "campaign_calendar":
            m.execute.return_value = _resp(data=[{
                "campaign_id": "friend-owner-2026-04-14",
                "restaurant_id": "rest-1",
                "start_date": "2026-04-14",
                "end_date": "2026-04-14",
                "name": "First paid Instagram campaign",
                "channel": "instagram",
            }])
        elif name == "pipeline_runs":
            # All cf_<model> rows succeeded for this run_date.
            m.execute.return_value = _resp(data=[{"status": "success"}])
        elif name == "forecast_with_actual_v":
            # Provide enough rows to compute both window_kinds.
            m.execute.return_value = _resp(data=[
                {"target_date": "2026-04-14", "actual_value": 600.0, "yhat": 500.0},
                {"target_date": "2026-04-15", "actual_value": 610.0, "yhat": 505.0},
            ])
        elif name == "forecast_daily":
            # Provide 200-path yhat_samples for the same dates.
            base_paths = [500.0] * 200
            m.execute.return_value = _resp(data=[
                {"target_date": "2026-04-14", "yhat_samples": base_paths},
                {"target_date": "2026-04-15", "yhat_samples": base_paths},
            ])
        elif name == "feature_flags":
            m.execute.return_value = _resp(data=[])
        elif name == "campaign_uplift":
            m.execute.return_value = _resp(data=[])
        else:
            m.execute.return_value = _resp(data=[])
        return m

    client = MagicMock(name="supabase_client")
    client.table.side_effect = _table_router
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data=[])
    client.rpc.return_value = rpc_chain

    mod.main_uplift(client, run_date=date(2026, 4, 20))

    # For one campaign × one successful model, expect exactly 2 per-window rows
    # (campaign_window + cumulative_since_launch). If multiple models succeeded
    # in the mock, multiply accordingly. The mock returns success for any
    # cf_<model> probe, so by default ALL 5 models pass — expect ≥ 2 rows
    # per model. Group by (model_name, window_kind) and assert each model has
    # both window kinds.
    by_model = {}
    for row in upserted_rows:
        wk = row.get("window_kind")
        if wk == "per_day":
            continue  # Task 4 adds these — out of scope for this test
        by_model.setdefault(row["model_name"], set()).add(wk)

    assert len(by_model) >= 1, (
        f"Expected at least 1 model to produce per-window rows. Got: {by_model}. "
        f"All upserts: {upserted_rows!r}"
    )
    for model_name, kinds in by_model.items():
        assert kinds == {"campaign_window", "cumulative_since_launch"}, (
            f"Model {model_name!r}: expected both window kinds, got {kinds}"
        )


# ---------------------------------------------------------------------------
# Task 4: per-day rolling cumulative rows for the D-11 sparkline.
# ---------------------------------------------------------------------------

def test_per_day_rows_count_matches_window_length():
    """For an N-day campaign window with 1 model, exactly N rows are produced
    with `window_kind='per_day'` per (restaurant_id, campaign_id, model_name).
    """
    from scripts.forecast.cumulative_uplift import compute_per_day_uplift_rows

    n_days = 7
    n_paths = 200
    rng = np.random.default_rng(0)
    paths = rng.normal(loc=500.0, scale=10.0, size=(n_days, n_paths))
    actual_values = np.full(n_days, 550.0)
    target_dates = [date(2026, 4, 14) + timedelta(days=i) for i in range(n_days)]

    rows = compute_per_day_uplift_rows(
        restaurant_id="rest-1",
        campaign_id="friend-owner-2026-04-14",
        model_name="sarimax",
        actual_values=actual_values,
        yhat_samples_per_day=paths.tolist(),
        target_dates=target_dates,
    )

    assert len(rows) == n_days, (
        f"Expected exactly {n_days} per-day rows, got {len(rows)}"
    )
    # Every row must have window_kind='per_day' and matching identifiers.
    for i, row in enumerate(rows):
        assert row["window_kind"] == "per_day"
        assert row["restaurant_id"] == "rest-1"
        assert row["campaign_id"] == "friend-owner-2026-04-14"
        assert row["model_name"] == "sarimax"
        assert row["n_days"] == i + 1
        assert row["as_of_date"] == target_dates[i].isoformat()
        # naive_dow_uplift_eur is per-window only — None on per-day rows.
        assert row["naive_dow_uplift_eur"] is None


def test_per_day_cumulative_monotone_for_constant_uplift():
    """When `actual − path_mean ≈ 50` for every day (constructed by drawing
    paths from N(base, 10) and setting actual=base+50), the per-day point
    estimate `cumulative_uplift_eur` should be approximately `50 * (i+1)` —
    monotone-increasing and roughly linear.
    """
    from scripts.forecast.cumulative_uplift import compute_per_day_uplift_rows

    n_days = 10
    n_paths = 200
    base = 500.0
    rng = np.random.default_rng(123)
    paths = rng.normal(loc=base, scale=10.0, size=(n_days, n_paths))
    actual_values = np.full(n_days, base + 50.0)
    target_dates = [date(2026, 4, 14) + timedelta(days=i) for i in range(n_days)]

    rows = compute_per_day_uplift_rows(
        restaurant_id="rest-1",
        campaign_id="c1",
        model_name="sarimax",
        actual_values=actual_values,
        yhat_samples_per_day=paths.tolist(),
        target_dates=target_dates,
    )

    # Day i estimate should be approximately 50 * (i+1) since we constructed
    # actual − path_mean ≈ 50 per day. Allow up to 10 EUR drift per day from
    # path-mean noise (σ=10 / sqrt(200) ≈ 0.7 per day → ~7 over 10 days).
    for i, row in enumerate(rows):
        expected = 50.0 * (i + 1)
        actual_estimate = row["cumulative_uplift_eur"]
        assert abs(actual_estimate - expected) < 10.0, (
            f"Day {i}: expected ≈{expected}, got {actual_estimate} "
            f"(drift > 10 EUR — path-mean estimator broken?)"
        )

    # Monotonicity: each running sum must exceed the previous (uplift is
    # positive every day in this fixture).
    for i in range(1, len(rows)):
        assert rows[i]["cumulative_uplift_eur"] > rows[i - 1]["cumulative_uplift_eur"], (
            f"Monotonicity violated at day {i}: "
            f"prev={rows[i - 1]['cumulative_uplift_eur']}, "
            f"curr={rows[i]['cumulative_uplift_eur']}"
        )


def test_per_day_ci_truncates_at_day_i():
    """Assert the per-day CI for day i is computed against `actual_values[:i+1]`
    (NOT the full window). Patch `bootstrap_uplift_ci` and inspect call args.
    """
    from scripts.forecast import cumulative_uplift as mod

    n_days = 5
    n_paths = 200
    rng = np.random.default_rng(0)
    paths = rng.normal(loc=500.0, scale=10.0, size=(n_days, n_paths))
    actual_values = np.array([550.0, 555.0, 545.0, 560.0, 540.0])
    target_dates = [date(2026, 4, 14) + timedelta(days=i) for i in range(n_days)]

    # Capture the actual_values arg passed to bootstrap_uplift_ci on each call.
    captured_lengths = []

    real_fn = mod.bootstrap_uplift_ci

    def _capturing(*args, **kwargs):
        actual = kwargs.get("actual_values")
        captured_lengths.append(len(actual))
        # Run the real function so the row gets meaningful values.
        return real_fn(*args, **kwargs)

    with patch.object(mod, "bootstrap_uplift_ci", side_effect=_capturing):
        rows = mod.compute_per_day_uplift_rows(
            restaurant_id="rest-1",
            campaign_id="c1",
            model_name="sarimax",
            actual_values=actual_values,
            yhat_samples_per_day=paths.tolist(),
            target_dates=target_dates,
        )

    # Expect exactly N calls to bootstrap_uplift_ci, with lengths 1..N.
    assert captured_lengths == [1, 2, 3, 4, 5], (
        f"CI must truncate at day i (slice [:i+1]); got call-arg lengths "
        f"{captured_lengths}, expected [1, 2, 3, 4, 5]"
    )
    assert len(rows) == n_days


# ---------------------------------------------------------------------------
# Phase 18 (UPL-08): _process_campaign_model emits iso_week rows alongside
# the existing per-window + per-day rows. Unit-level coverage of
# compute_iso_week_uplift_rows() lives in tests/forecast/test_iso_week_uplift.py;
# this test asserts the wiring inside _process_campaign_model so a future
# refactor that drops the call (regression) fails loudly.
# ---------------------------------------------------------------------------

def test_process_campaign_model_emits_iso_week_rows():
    """When the cumulative window spans 14 days starting on a Monday with run_date
    rolled past the second Sunday, _process_campaign_model should emit exactly
    2 iso_week rows alongside the existing campaign_window / cumulative_since_launch /
    per_day rows. Mirrors the _table_router mock pattern from
    test_two_window_kinds_per_campaign_per_model.
    """
    from scripts.forecast import cumulative_uplift as mod

    upserted_rows: list = []

    def _resp(*, data=None):
        return types.SimpleNamespace(data=(data if data is not None else []), error=None)

    # 14 days Mon-Sun spanning W17 (Apr 20-26) + W18 (Apr 27-May 3) so two
    # ISO weeks are fully completed when run_date = May 4 (Mon, W19 day 1).
    days = [date(2026, 4, 20) + timedelta(days=i) for i in range(14)]
    forecast_with_actual_data = [
        {"target_date": d.isoformat(), "actual_value": 600.0, "yhat": 500.0}
        for d in days
    ]
    base_paths = [500.0] * 200
    forecast_daily_data = [
        {"target_date": d.isoformat(), "yhat_samples": base_paths}
        for d in days
    ]

    def _table_router(name):
        m = MagicMock(name=f"chain[{name}]")
        m.select.return_value = m
        m.eq.return_value = m
        m.gte.return_value = m
        m.lte.return_value = m
        m.lt.return_value = m  # _successful_cf_models uses .lt() for the timestamptz upper bound
        m.order.return_value = m
        m.limit.return_value = m
        m.insert.return_value = m

        def _upsert(payload, **_kwargs):
            if name == "campaign_uplift":
                if isinstance(payload, list):
                    upserted_rows.extend(payload)
                else:
                    upserted_rows.append(payload)
            return m

        m.upsert.side_effect = _upsert

        if name == "restaurants":
            m.execute.return_value = _resp(data=[{"id": "rest-1"}])
        elif name == "campaign_calendar":
            m.execute.return_value = _resp(data=[{
                "campaign_id": "friend-owner-2026-04-20",
                "restaurant_id": "rest-1",
                "start_date": "2026-04-20",
                "end_date": "2026-04-20",  # short campaign_window; cumulative window extends to run_date
                "name": "Phase 18 test campaign",
                "channel": "instagram",
            }])
        elif name == "pipeline_runs":
            m.execute.return_value = _resp(data=[{"status": "success"}])
        elif name == "forecast_with_actual_v":
            m.execute.return_value = _resp(data=forecast_with_actual_data)
        elif name == "forecast_daily":
            m.execute.return_value = _resp(data=forecast_daily_data)
        elif name == "feature_flags":
            m.execute.return_value = _resp(data=[])
        elif name == "campaign_uplift":
            m.execute.return_value = _resp(data=[])
        else:
            m.execute.return_value = _resp(data=[])
        return m

    client = MagicMock(name="supabase_client")
    client.table.side_effect = _table_router
    rpc_chain = MagicMock()
    rpc_chain.execute.return_value = MagicMock(data=[])
    client.rpc.return_value = rpc_chain

    # run_date = May 4 (Mon W19 day 1) → both W17 + W18 are completed.
    mod.main_uplift(client, run_date=date(2026, 5, 4))

    # Group by model_name; each successful model should produce exactly 2 iso_week rows
    # (W17 + W18 Sundays = 2026-04-26 and 2026-05-03).
    iso_week_by_model: dict[str, list[str]] = {}
    for row in upserted_rows:
        if row.get("window_kind") != "iso_week":
            continue
        iso_week_by_model.setdefault(row["model_name"], []).append(row["as_of_date"])

    assert len(iso_week_by_model) >= 1, (
        f"Expected at least 1 model to emit iso_week rows. Got: {iso_week_by_model}. "
        f"All upserts: {[(r.get('model_name'), r.get('window_kind'), r.get('as_of_date')) for r in upserted_rows]!r}"
    )
    for model_name, sundays in iso_week_by_model.items():
        assert sorted(sundays) == ["2026-04-26", "2026-05-03"], (
            f"Model {model_name!r}: expected iso_week as_of_dates "
            f"['2026-04-26', '2026-05-03'], got {sorted(sundays)}"
        )

    # Spot-check the iso_week row shape on any one row.
    sample = next(r for r in upserted_rows if r.get("window_kind") == "iso_week")
    assert sample["n_days"] == 7
    assert sample["naive_dow_uplift_eur"] is None
    assert "ci_lower_eur" in sample
    assert "ci_upper_eur" in sample
    assert "cumulative_uplift_eur" in sample
