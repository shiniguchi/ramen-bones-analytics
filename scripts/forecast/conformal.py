"""Phase 17 BCK-02: conformal CI calibration at h=35.

Per Vovk/Shafer split-conformal (Option 1 from RESEARCH §ConformalIntervals
Integration): collect absolute residuals from prior folds at the matching
horizon-step h, take the (1-alpha) empirical quantile, add to the point
forecast for the (lower, upper) CI band.

D-03 lock: statsforecast.cross_validation is NOT used as the loop driver.
backtest.py (Wave 2) owns the rolling-origin loop; this module owns
calibration math only. Pure function — no DB, no I/O, deterministic.
"""
from __future__ import annotations

import numpy as np


def calibrate_conformal_h35(
    fold_residuals: dict[int, np.ndarray],
    alpha: float = 0.05,
) -> dict:
    """Return {'qhat_h35': float} — the conformal quantile to add ± to the point forecast.

    Args:
        fold_residuals: {fold_idx: signed_residuals_at_h35} — backtest.py collects
            one residual array per fold (typically size N_FOLDS=4 per BCK-01/D-02).
        alpha: 1 - desired CI coverage. Default 0.05 (95% CI per BCK-02 spec).

    Returns:
        {'qhat_h35': float}. Returns nan if no residuals are available
        (cold-start case — backtest.py should write PENDING verdict instead).
    """
    # Cold-start: no folds available yet
    if not fold_residuals:
        return {'qhat_h35': float('nan')}

    # Pool all signed residuals across folds into one flat array
    arrays = [np.asarray(r, dtype=float) for r in fold_residuals.values()]
    all_residuals = np.concatenate(arrays) if arrays else np.array([], dtype=float)

    # No residuals to compute quantile over
    if all_residuals.size == 0:
        return {'qhat_h35': float('nan')}

    # Symmetric conformal: take absolute value, then empirical (1-alpha) quantile
    qhat = float(np.quantile(np.abs(all_residuals), 1 - alpha))
    return {'qhat_h35': qhat}
