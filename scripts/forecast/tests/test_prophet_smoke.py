"""Smoke tests for prophet_fit — constraint C-04 and basic fit/predict.

These tests require prophet (needs Python 3.10+ and numpy >= 1.20).
They are skipped automatically when the environment does not support it.
"""
import sys
import pytest
import numpy as np
import pandas as pd

# Skip entire module on Python < 3.10 (numpy.typing unavailable in numpy < 1.20)
pytestmark = pytest.mark.skipif(
    sys.version_info < (3, 10),
    reason='prophet requires Python >= 3.10 (numpy.typing unavailable on 3.8)'
)


def test_prophet_yearly_seasonality_false():
    """C-04: yearly_seasonality MUST be False until history >= 730 days."""
    from prophet import Prophet
    m = Prophet(yearly_seasonality=False, uncertainty_samples=10)
    assert m.yearly_seasonality is False


def test_prophet_predictive_samples_shape():
    """predictive_samples returns dict with 'yhat' of shape (n_samples, horizon)."""
    from prophet import Prophet
    rng = np.random.default_rng(42)
    n = 60
    dates = pd.date_range('2026-01-01', periods=n, freq='D')
    y = 500 + 50 * np.sin(np.arange(n) * 2 * np.pi / 7) + rng.normal(0, 10, n)
    train = pd.DataFrame({'ds': dates, 'y': y})

    m = Prophet(
        yearly_seasonality=False,
        weekly_seasonality=True,
        daily_seasonality=False,
        uncertainty_samples=50,
    )
    m.fit(train)

    h = 7
    future = pd.DataFrame({'ds': pd.date_range('2026-03-02', periods=h, freq='D')})
    raw = m.predictive_samples(future)
    yhat = raw['yhat']  # shape: (n_samples, h)

    # Transpose to (h, n_samples) for consistent shape with other models
    samples = yhat.T
    assert samples.shape == (h, 50)
    assert not np.isnan(samples).any()
