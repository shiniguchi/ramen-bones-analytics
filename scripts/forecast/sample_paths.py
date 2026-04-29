"""Sample path utilities for models without native simulation."""
from __future__ import annotations
import json
import numpy as np


def bootstrap_from_residuals(
    point_forecast: np.ndarray,
    residuals: np.ndarray,
    n_paths: int = 200,
    seed: int = 42,
) -> np.ndarray:
    """Generate sample paths by bootstrapping residuals onto point forecast.

    Returns ndarray of shape (len(point_forecast), n_paths).
    """
    rng = np.random.default_rng(seed)
    h = len(point_forecast)
    # sample residuals with replacement for each (day, path)
    sampled = rng.choice(residuals, size=(h, n_paths), replace=True)
    return point_forecast[:, np.newaxis] + sampled


def paths_to_jsonb(paths: np.ndarray) -> list[str]:
    """Convert (n_days, n_paths) array to list of JSON strings (one per day).

    Each JSON string is a flat array of floats, rounded to 2 decimals.
    """
    return [json.dumps(np.round(paths[i], 2).tolist()) for i in range(paths.shape[0])]


def aggregate_ci(
    paths: np.ndarray, alpha: float = 0.05
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute mean + CI from sample paths.

    paths: (n_days, n_paths)
    Returns: (mean, lower, upper) each of shape (n_days,)
    """
    mean = paths.mean(axis=1)
    lower = np.percentile(paths, 100 * alpha / 2, axis=1)
    upper = np.percentile(paths, 100 * (1 - alpha / 2), axis=1)
    return mean, lower, upper
