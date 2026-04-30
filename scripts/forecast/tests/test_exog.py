import pandas as pd
import numpy as np
from datetime import date
from scripts.forecast.exog import EXOG_COLUMNS, build_exog_matrix_from_data


def test_exog_columns_consistent():
    """Fit and predict exog matrices must have identical columns (FCS-06)."""
    weather = pd.DataFrame({
        'date': [date(2026, 1, 1), date(2026, 1, 2)],
        'temp_mean_c': [2.0, 3.0],
        'precip_mm': [0.0, 1.0],
        'wind_max_kmh': [15.0, 20.0],
        'sunshine_hours': [3.0, 4.0],
        'weather_source': ['archive', 'archive'],
    })
    holidays_set = set()
    school_set = set()
    events_set = set()
    strikes_set = set()
    shop_cal = {date(2026, 1, 1): True, date(2026, 1, 2): True}

    fit_df = build_exog_matrix_from_data(
        dates=[date(2026, 1, 1), date(2026, 1, 2)],
        weather_df=weather,
        climatology={},
        holidays_set=holidays_set,
        school_set=school_set,
        events_set=events_set,
        strikes_set=strikes_set,
        shop_cal=shop_cal,
    )
    assert list(fit_df.columns) == EXOG_COLUMNS


def test_exog_no_nan():
    """Exog matrix must have zero NaN for Prophet compatibility."""
    weather = pd.DataFrame({
        'date': [date(2026, 7, 1)],
        'temp_mean_c': [np.nan],
        'precip_mm': [np.nan],
        'wind_max_kmh': [np.nan],
        'sunshine_hours': [np.nan],
        'weather_source': ['archive'],
    })
    climatology = {(7, 1): {'temp_mean_c': 22.0, 'precip_mm': 1.5, 'wind_max_kmh': 12.0, 'sunshine_hours': 8.0}}
    df = build_exog_matrix_from_data(
        dates=[date(2026, 7, 1)],
        weather_df=weather,
        climatology=climatology,
        holidays_set=set(),
        school_set=set(),
        events_set=set(),
        strikes_set=set(),
        shop_cal={date(2026, 7, 1): True},
    )
    assert df.isna().sum().sum() == 0
