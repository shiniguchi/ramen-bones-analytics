# scripts/forecast/aggregation.py
# Phase 15 v2 D-14: bucket daily input into weekly (ISO Mon-start) or
# monthly (first-of-month) for grain-specific model fits. Sum aggregation
# matches the user's mental model: weekly revenue = sum of 7 daily values;
# monthly invoice_count = sum of all in-month transactions.
#
# date_col defaults to 'business_date' (kpi_daily_mv canonical column) but
# can be overridden — model fit scripts internally rename to 'date', so they
# call these helpers with date_col='date'.
import pandas as pd

def bucket_to_weekly(df: pd.DataFrame, *, value_col: str, date_col: str = 'business_date') -> pd.DataFrame:
    """Aggregate `df` (must have a date column) into ISO-week buckets keyed by Monday start."""
    out = df.copy()
    # Ensure datetime so .dt accessor works (handles both date and datetime input).
    out[date_col] = pd.to_datetime(out[date_col])
    # Floor to ISO-Monday week start.
    out['week_start'] = out[date_col] - pd.to_timedelta(out[date_col].dt.weekday, unit='D')
    g = out.groupby('week_start', as_index=False)[value_col].sum()
    return g

def bucket_to_monthly(df: pd.DataFrame, *, value_col: str, date_col: str = 'business_date') -> pd.DataFrame:
    """Aggregate `df` into calendar-month buckets keyed by first-of-month."""
    out = df.copy()
    out[date_col] = pd.to_datetime(out[date_col])
    out['month_start'] = out[date_col].dt.to_period('M').dt.start_time
    g = out.groupby('month_start', as_index=False)[value_col].sum()
    return g
