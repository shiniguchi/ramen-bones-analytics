# scripts/forecast/aggregation.py
# Phase 15 v2 D-14: bucket daily input into weekly (ISO Mon-start) or
# monthly (first-of-month) for grain-specific model fits. Sum aggregation
# matches the user's mental model: weekly revenue = sum of 7 daily values;
# monthly invoice_count = sum of all in-month transactions.
import pandas as pd

def bucket_to_weekly(df: pd.DataFrame, *, value_col: str) -> pd.DataFrame:
    """Aggregate `df` (must have business_date column) into ISO-week buckets keyed by Monday start."""
    out = df.copy()
    # Floor to ISO-Monday week start.
    out['week_start'] = out['business_date'] - pd.to_timedelta(out['business_date'].dt.weekday, unit='D')
    g = out.groupby('week_start', as_index=False)[value_col].sum()
    return g

def bucket_to_monthly(df: pd.DataFrame, *, value_col: str) -> pd.DataFrame:
    """Aggregate `df` into calendar-month buckets keyed by first-of-month."""
    out = df.copy()
    out['month_start'] = out['business_date'].dt.to_period('M').dt.start_time
    g = out.groupby('month_start', as_index=False)[value_col].sum()
    return g
