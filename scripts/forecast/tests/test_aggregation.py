# scripts/forecast/tests/test_aggregation.py
import pandas as pd
from datetime import date
from scripts.forecast.aggregation import bucket_to_weekly, bucket_to_monthly

def test_bucket_to_weekly_iso_monday_start():
    # 2026-04-26 is a Sunday; 2026-04-27 is a Monday (start of new ISO week)
    df = pd.DataFrame({
        'business_date': pd.to_datetime(['2026-04-20', '2026-04-21', '2026-04-26', '2026-04-27']),
        'revenue_eur': [100, 150, 200, 175]
    })
    out = bucket_to_weekly(df, value_col='revenue_eur')
    assert len(out) == 2
    # Week starting 2026-04-20 (Mon): 100 + 150 + 200 = 450
    # Week starting 2026-04-27 (Mon): 175
    assert out.iloc[0]['week_start'] == pd.Timestamp('2026-04-20')
    assert out.iloc[0]['revenue_eur'] == 450
    assert out.iloc[1]['revenue_eur'] == 175

def test_bucket_to_monthly_first_of_month_start():
    df = pd.DataFrame({
        'business_date': pd.to_datetime(['2026-03-31', '2026-04-01', '2026-04-30', '2026-05-01']),
        'invoice_count': [10, 12, 15, 8]
    })
    out = bucket_to_monthly(df, value_col='invoice_count')
    assert len(out) == 3
    months = sorted(out['month_start'].dt.strftime('%Y-%m-%d').tolist())
    assert months == ['2026-03-01', '2026-04-01', '2026-05-01']

def test_bucket_to_weekly_excludes_partial_week():
    # When the input ends mid-week, the partial trailing week is dropped
    # by the consumer (run_all.py uses TRAIN_END as the cutoff).
    df = pd.DataFrame({
        'business_date': pd.to_datetime(['2026-04-19']),  # Sun (last day of prior week)
        'revenue_eur': [100]
    })
    out = bucket_to_weekly(df, value_col='revenue_eur')
    assert len(out) == 1
    assert out.iloc[0]['week_start'] == pd.Timestamp('2026-04-13')  # Mon


def test_bucket_to_weekly_accepts_date_col_override():
    # 15-10: model fit scripts rename business_date -> date before calling
    # the aggregation helpers, so the date_col override must work.
    df = pd.DataFrame({
        'date': pd.to_datetime(['2026-04-20', '2026-04-21']),
        'revenue_eur': [100, 50],
    })
    out = bucket_to_weekly(df, value_col='revenue_eur', date_col='date')
    assert len(out) == 1
    assert out.iloc[0]['week_start'] == pd.Timestamp('2026-04-20')
    assert out.iloc[0]['revenue_eur'] == 150


def test_bucket_to_monthly_accepts_date_col_override():
    df = pd.DataFrame({
        'date': pd.to_datetime(['2026-04-15', '2026-04-30']),
        'invoice_count': [3, 4],
    })
    out = bucket_to_monthly(df, value_col='invoice_count', date_col='date')
    assert len(out) == 1
    assert out.iloc[0]['month_start'] == pd.Timestamp('2026-04-01')
    assert out.iloc[0]['invoice_count'] == 7
