"""Forecast batch writer — chunked upsert to forecast_daily (FCS-12).

Upserts forecast rows in chunks of CHUNK_SIZE to stay under Supabase
payload limits (~1 MB). Each row carries point estimates, sample paths
as JSONB, and an exog_signature for reproducibility.
"""
from __future__ import annotations
import json
import math
import numpy as np
import pandas as pd
from datetime import date

CHUNK_SIZE = 100

# 6-column composite PK for upsert conflict resolution
_ON_CONFLICT = (
    'restaurant_id,kpi_name,target_date,model_name,run_date,forecast_track'
)


def write_forecast_batch(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    model_name: str,
    run_date: date,
    forecast_track: str,
    point_df: pd.DataFrame,
    samples: np.ndarray,
    exog_signature: dict,
) -> int:
    """Upsert forecast rows to forecast_daily. Returns row count.

    point_df: DataFrame with index=target_date,
              columns=[yhat, yhat_lower, yhat_upper]
    samples:  ndarray shape (n_days, n_paths)
    exog_signature: dict for the exog_signature jsonb column
    """
    # -- build row dicts --
    exog_json = json.dumps(exog_signature)
    run_date_str = run_date.isoformat()

    rows: list[dict] = []
    for i, (target_dt, row) in enumerate(point_df.iterrows()):
        # target_dt is a Timestamp; convert to ISO date string
        target_date_str = target_dt.strftime('%Y-%m-%d')
        rows.append({
            'restaurant_id': restaurant_id,
            'kpi_name': kpi_name,
            'target_date': target_date_str,
            'model_name': model_name,
            'run_date': run_date_str,
            'forecast_track': forecast_track,
            'yhat': round(float(row['yhat']), 2),
            'yhat_lower': round(float(row['yhat_lower']), 2),
            'yhat_upper': round(float(row['yhat_upper']), 2),
            'yhat_samples': json.dumps(np.round(samples[i], 2).tolist()),
            'exog_signature': exog_json,
        })

    # -- chunked upsert --
    n_chunks = math.ceil(len(rows) / CHUNK_SIZE)
    for c in range(n_chunks):
        chunk = rows[c * CHUNK_SIZE : (c + 1) * CHUNK_SIZE]
        client.table('forecast_daily').upsert(
            chunk, on_conflict=_ON_CONFLICT
        ).execute()

    return len(rows)
