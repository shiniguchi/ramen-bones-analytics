"""TDD tests for last_7_eval.compute_metrics — written first, run to fail, then implement."""
import numpy as np
import math
from scripts.forecast.last_7_eval import compute_metrics


def test_rmse_known_values():
    actuals = np.array([100.0, 200.0, 300.0])
    yhats = np.array([110.0, 190.0, 310.0])
    metrics = compute_metrics(actuals, yhats)
    expected_rmse = math.sqrt(((10**2 + 10**2 + 10**2) / 3))
    assert abs(metrics['rmse'] - expected_rmse) < 0.01


def test_mape_known_values():
    actuals = np.array([100.0, 200.0])
    yhats = np.array([110.0, 180.0])
    metrics = compute_metrics(actuals, yhats)
    expected_mape = ((10/100 + 20/200) / 2) * 100
    assert abs(metrics['mape'] - expected_mape) < 0.01


def test_direction_hit_rate_open_days_only():
    """Autoplan finding E4: direction_hit_rate computed on open days only."""
    actuals = np.array([100.0, 0.0, 120.0, 130.0])
    yhats = np.array([105.0, 0.0, 115.0, 135.0])
    is_open = np.array([True, False, True, True])
    metrics = compute_metrics(actuals, yhats, is_open=is_open)
    assert metrics['direction_hit_rate'] == 1.0


def test_bias_positive_means_overforecast():
    actuals = np.array([100.0, 100.0])
    yhats = np.array([110.0, 120.0])
    metrics = compute_metrics(actuals, yhats)
    assert metrics['mean_bias'] == 15.0


def test_mape_zero_actuals_replaced_by_1():
    """Zero actuals use denominator=1 to avoid division-by-zero."""
    actuals = np.array([0.0, 100.0])
    yhats = np.array([10.0, 110.0])
    metrics = compute_metrics(actuals, yhats)
    # mape = mean(|10-0|/1, |110-100|/100) * 100 = mean(10, 0.1) * 100 = 505
    expected = ((10.0 / 1.0 + 10.0 / 100.0) / 2) * 100
    assert abs(metrics['mape'] - expected) < 0.01


def test_direction_hit_rate_without_is_open_uses_all_days():
    """When is_open is None, all days are used for direction computation."""
    actuals = np.array([100.0, 110.0, 105.0])
    yhats = np.array([102.0, 112.0, 116.0])
    # Actual directions: up (+10), down (-5).
    # Yhat directions: up (+10), up (+4). Miss on second pair.
    metrics = compute_metrics(actuals, yhats)
    assert abs(metrics['direction_hit_rate'] - 0.5) < 0.01


def test_compute_metrics_returns_all_keys():
    """All required metric keys are present."""
    actuals = np.array([100.0, 200.0])
    yhats = np.array([100.0, 200.0])
    metrics = compute_metrics(actuals, yhats)
    for key in ('rmse', 'mape', 'mean_bias', 'direction_hit_rate'):
        assert key in metrics
