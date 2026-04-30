import numpy as np
from scripts.forecast.sample_paths import bootstrap_from_residuals, paths_to_jsonb


def test_bootstrap_shape():
    point = np.array([100.0, 110.0, 105.0])
    residuals = np.array([1.0, -2.0, 0.5, -1.0, 3.0])
    paths = bootstrap_from_residuals(point, residuals, n_paths=200, seed=42)
    assert paths.shape == (3, 200)


def test_bootstrap_mean_near_point():
    point = np.array([100.0] * 30)
    residuals = np.random.default_rng(0).normal(0, 1, size=100)
    paths = bootstrap_from_residuals(point, residuals, n_paths=1000, seed=42)
    assert abs(paths.mean(axis=1).mean() - 100.0) < 1.0


def test_paths_to_jsonb_format():
    paths = np.array([[1.0, 2.0], [3.0, 4.0]])
    result = paths_to_jsonb(paths, row_idx=0)
    assert result == '[1.0, 2.0]'


def test_paths_to_jsonb_rounds():
    paths = np.array([[1.123456789, 2.987654321]])
    result = paths_to_jsonb(paths, row_idx=0)
    assert result == '[1.12, 2.99]'
