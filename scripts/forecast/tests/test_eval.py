"""Tests for last_7_eval — nightly forecast evaluation module (FCS-07)."""
from __future__ import annotations
import numpy as np
import pytest
from scripts.forecast.last_7_eval import compute_metrics


def test_compute_metrics_known_values():
    """Hand-calculated metrics for a known actuals/yhats pair."""
    actuals = np.array([100, 200, 300, 400, 500, 600, 700])
    yhats = np.array([110, 190, 310, 390, 510, 590, 710])

    m = compute_metrics(actuals, yhats)

    # errors: [10, -10, 10, -10, 10, -10, 10]
    # squared: [100]*7 => MSE = 100 => RMSE = 10
    assert m['rmse'] == pytest.approx(10.0)

    # abs pct errors: 10/100, 10/200, 10/300, 10/400, 10/500, 10/600, 10/700
    # = 0.1, 0.05, 0.0333, 0.025, 0.02, 0.01667, 0.01429
    expected_mape = np.mean([10 / 100, 10 / 200, 10 / 300,
                             10 / 400, 10 / 500, 10 / 600, 10 / 700])
    assert m['mape'] == pytest.approx(expected_mape, rel=1e-6)

    # bias: mean(yhat - actual) = mean([10,-10,10,-10,10,-10,10]) = 10/7
    assert m['bias'] == pytest.approx(10 / 7, rel=1e-6)

    # direction transitions (6 total):
    # actual diffs:  [+100, +100, +100, +100, +100, +100] all up
    # yhat diffs:    [-10 - 10 = wrong? No:
    #   yhat: 110->190 (+80 up), 190->310 (+120 up), 310->390 (+80 up),
    #          390->510 (+120 up), 510->590 (+80 up), 590->710 (+120 up)]
    # actual: all +100 => all up.  yhat: all positive => all up.
    # All 6 transitions match => direction_hit_rate = 1.0
    assert m['direction_hit_rate'] == pytest.approx(1.0)

    assert m['n_days'] == 7


def test_compute_metrics_perfect_forecast():
    """Perfect forecast: all error metrics are zero."""
    vals = np.array([100, 200, 300, 400, 500])
    m = compute_metrics(vals, vals.copy())

    assert m['rmse'] == 0.0
    assert m['mape'] == 0.0
    assert m['bias'] == 0.0
    # direction: actual diffs all +100, yhat diffs all +100 => 1.0
    assert m['direction_hit_rate'] == 1.0
    assert m['n_days'] == 5


def test_compute_metrics_direction_hit_rate():
    """Specific direction-hit scenario: 3 of 4 transitions correct."""
    # actuals: 100 -> 200 -> 300 -> 250 -> 400
    #   diffs: +100(up), +100(up), -50(down), +150(up) => 4 transitions
    actuals = np.array([100, 200, 300, 250, 400])

    # yhats: 110 -> 210 -> 290 -> 260 -> 390
    #   diffs: +100(up), +80(up), -30(down), +130(up)
    # match:   up==up(Y), up==up(Y), down==down(Y), up==up(Y) => 4/4?
    # Need one wrong. Let's flip one:
    # yhats: 110 -> 210 -> 320 -> 260 -> 390
    #   diffs: +100(up), +110(up), -60(down), +130(up)
    # still all match. Need yhat to go wrong on one.
    #
    # actuals: 100 -> 200 -> 300 -> 250 -> 400
    #   diffs: +100, +100, -50, +150
    # yhats: 110 -> 190 -> 310 -> 260 -> 380
    #   diffs: +80, +120, -50, +120 => all same sign. Still 4/4.
    #
    # Let's design it explicitly:
    # actuals: 100 -> 200 -> 150 -> 300 -> 250
    #   diffs: +100(up), -50(down), +150(up), -50(down) => 4 transitions
    actuals = np.array([100, 200, 150, 300, 250])

    # yhats:   105 -> 210 -> 160 -> 280 -> 260
    #   diffs: +105(up), -50(down), +120(up), -20(down) => 4/4 still match
    # Need to get one wrong:
    # yhats:   105 -> 195 -> 200 -> 280 -> 260
    #   diffs: +90(up), +5(up), +80(up), -20(down)
    # match: up==up(Y), up!=down(N), up==up(Y), down==down(Y) => 3/4 = 0.75
    yhats = np.array([105, 195, 200, 280, 260])

    m = compute_metrics(actuals, yhats)
    assert m['direction_hit_rate'] == pytest.approx(0.75)
    assert m['n_days'] == 5


def test_compute_metrics_handles_two_points():
    """Minimum viable: 2 points => 1 transition."""
    actuals = np.array([100, 200])  # up
    yhats = np.array([110, 190])    # up => 1/1

    m = compute_metrics(actuals, yhats)
    assert m['n_days'] == 2
    assert m['direction_hit_rate'] == pytest.approx(1.0)
    assert m['rmse'] == pytest.approx(10.0)
    assert m['bias'] == pytest.approx(0.0)  # mean([10, -10]) = 0


def test_compute_metrics_zero_actual_mape_guard():
    """MAPE skips days where actual == 0 to avoid division by zero."""
    actuals = np.array([0, 100, 200])
    yhats = np.array([10, 110, 190])

    m = compute_metrics(actuals, yhats)
    # MAPE computed only over non-zero actuals: 10/100 + 10/200 = 0.1 + 0.05
    # mean = 0.075
    assert m['mape'] == pytest.approx(0.075)
    assert m['n_days'] == 3


def test_compute_metrics_all_zero_actuals_mape():
    """If all actuals are zero, MAPE should be 0 (not NaN/Inf)."""
    actuals = np.array([0, 0, 0])
    yhats = np.array([10, 20, 30])

    m = compute_metrics(actuals, yhats)
    assert m['mape'] == 0.0
    assert not np.isnan(m['mape'])
