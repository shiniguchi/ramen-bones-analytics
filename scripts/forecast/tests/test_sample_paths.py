"""Tests for sample_paths utilities (FCS-11)."""
import numpy as np
import json
from scripts.forecast.sample_paths import (
    bootstrap_from_residuals,
    paths_to_jsonb,
    aggregate_ci,
)


def test_bootstrap_shape():
    rng = np.random.default_rng(1)
    point = rng.normal(100, 10, 30)
    resid = rng.normal(0, 5, 90)
    paths = bootstrap_from_residuals(point, resid, n_paths=200, seed=42)
    assert paths.shape == (30, 200)


def test_bootstrap_mean_close_to_point():
    rng = np.random.default_rng(1)
    point = np.full(10, 100.0)
    resid = rng.normal(0, 1, 100)
    paths = bootstrap_from_residuals(point, resid, n_paths=1000, seed=42)
    assert abs(paths.mean(axis=1).mean() - 100.0) < 2.0


def test_paths_to_jsonb():
    paths = np.array([[1.1, 2.2], [3.3, 4.4]])
    result = paths_to_jsonb(paths)
    assert len(result) == 2
    parsed_0 = json.loads(result[0])
    assert len(parsed_0) == 2
    assert abs(parsed_0[0] - 1.1) < 0.01


def test_aggregate_ci_daily():
    rng = np.random.default_rng(42)
    paths = rng.normal(100, 10, (7, 200))
    mean, lower, upper = aggregate_ci(paths)
    assert len(mean) == 7
    assert all(lower[i] <= mean[i] <= upper[i] for i in range(7))


def test_aggregate_ci_percentiles():
    paths = np.ones((5, 200)) * 100.0
    mean, lower, upper = aggregate_ci(paths)
    np.testing.assert_allclose(mean, 100.0)
    np.testing.assert_allclose(lower, 100.0)
    np.testing.assert_allclose(upper, 100.0)
