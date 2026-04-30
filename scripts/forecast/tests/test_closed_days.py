import pandas as pd
import numpy as np
from datetime import date
from scripts.forecast.closed_days import zero_closed_days, filter_open_days


def test_zero_closed_days_sets_yhat_to_zero():
    preds = pd.DataFrame({
        'target_date': [date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)],
        'yhat': [100.0, 200.0, 300.0],
        'yhat_lower': [80.0, 180.0, 280.0],
        'yhat_upper': [120.0, 220.0, 320.0],
    })
    shop_cal = pd.DataFrame({
        'date': [date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)],
        'is_open': [True, False, True],
    })
    result = zero_closed_days(preds, shop_cal)
    assert result.loc[1, 'yhat'] == 0.0
    assert result.loc[1, 'yhat_lower'] == 0.0
    assert result.loc[1, 'yhat_upper'] == 0.0
    assert result.loc[0, 'yhat'] == 100.0
    assert result.loc[2, 'yhat'] == 300.0


def test_filter_open_days_drops_closed():
    history = pd.DataFrame({
        'date': [date(2026, 4, 27), date(2026, 4, 28), date(2026, 4, 29)],
        'revenue_eur': [500.0, 0.0, 600.0],
        'is_open': [True, False, True],
    })
    result = filter_open_days(history)
    assert len(result) == 2
    assert list(result['revenue_eur']) == [500.0, 600.0]
