import numpy as np
import pandas as pd


def test_sarimax_fit_and_simulate():
    """Smoke test: SARIMAX fits on 60-day fixture and produces 7-day sample paths."""
    import statsmodels.api as sm
    rng = np.random.default_rng(42)
    n = 60
    y = 500 + 50 * np.sin(np.arange(n) * 2 * np.pi / 7) + rng.normal(0, 10, n)
    exog = pd.DataFrame({'temp': rng.normal(15, 5, n), 'is_open': np.ones(n)})
    model = sm.tsa.SARIMAX(y, exog=exog, order=(1, 0, 1), seasonal_order=(1, 1, 1, 7),
                           enforce_stationarity=False, enforce_invertibility=False)
    result = model.fit(disp=False, maxiter=200)
    h = 7
    exog_pred = pd.DataFrame({'temp': rng.normal(15, 5, h), 'is_open': np.ones(h)})
    samples = result.simulate(nsimulations=h, repetitions=10, anchor='end', exog=exog_pred)
    # statsmodels returns a DataFrame; convert to numpy for consistent assertion
    samples_arr = samples.values if hasattr(samples, 'values') else samples
    assert samples_arr.shape == (h, 10)
    assert not np.isnan(samples_arr).any()


def test_sarimax_fallback_on_convergence():
    """If primary order fails, fallback order should succeed."""
    import statsmodels.api as sm
    rng = np.random.default_rng(99)
    y = rng.normal(100, 1, 30)
    try:
        model = sm.tsa.SARIMAX(y, order=(1, 0, 1), seasonal_order=(1, 1, 1, 7),
                               enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=50)
        if np.isnan(result.params).any():
            raise ValueError('NaN params')
    except Exception:
        model = sm.tsa.SARIMAX(y, order=(1, 0, 1), seasonal_order=(0, 1, 0, 7),
                               enforce_stationarity=False, enforce_invertibility=False)
        result = model.fit(disp=False, maxiter=200)
    assert result is not None
    assert not np.isnan(result.params).any()
