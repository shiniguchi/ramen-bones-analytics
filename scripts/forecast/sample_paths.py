"""Sample path generation for models without native simulation (D-16)."""
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
    sampled = rng.choice(residuals, size=(h, n_paths), replace=True)
    return point_forecast[:, np.newaxis] + sampled


def paths_to_jsonb(paths: np.ndarray, row_idx: int) -> str:
    """Convert one row of sample paths to a JSON array string for Postgres."""
    row = paths[row_idx]
    rounded = [round(float(v), 2) for v in row]
    return json.dumps(rounded)
