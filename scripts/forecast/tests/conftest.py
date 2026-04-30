import pytest
import pandas as pd
import numpy as np
from datetime import date, timedelta


@pytest.fixture
def synthetic_revenue():
    """90-day synthetic revenue series with weekly seasonality."""
    rng = np.random.default_rng(42)
    dates = [date(2026, 2, 1) + timedelta(days=i) for i in range(90)]
    base = 500 + 100 * np.sin(np.arange(90) * 2 * np.pi / 7)
    noise = rng.normal(0, 30, size=90)
    values = base + noise
    return pd.DataFrame({
        'date': dates,
        'revenue_eur': values,
        'is_open': [not (d.weekday() in (0, 1)) for d in dates],
    })
