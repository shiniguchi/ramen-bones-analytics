"""Phase 14: one-time backfill of Bright Sky historical weather + climatology norms.

Steps:
  1. Fetch Berlin weather from Bright Sky for 2021-01-01 → 2025-06-10 (monthly chunks).
  2. Upsert into weather_daily (is_forecast=false).
  3. Compute per-DoY climatological norms from the full weather_daily table.
  4. Upsert 366 rows into weather_climatology.
  5. Validate no gap >7 consecutive days in the weather_daily range.
  6. Exit non-zero if validation fails.

CLI:
    python -m scripts.forecast.backfill_weather_history

Bright Sky API docs: https://api.brightsky.dev/
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from typing import Optional

import httpx

from scripts.forecast.db import make_client

# Berlin coordinates
LAT = 52.52
LON = 13.40

BACKFILL_START = date(2021, 1, 1)
BACKFILL_END = date(2025, 6, 10)

BRIGHTSKY_BASE = "https://api.brightsky.dev/weather"

# Maximum allowed consecutive-day gap in weather_daily coverage
MAX_GAP_DAYS = 7


# ---------------------------------------------------------------------------
# Bright Sky fetch helpers
# ---------------------------------------------------------------------------

def _month_chunks(start: date, end: date):
    """Yield (chunk_start, chunk_end) tuples covering [start, end] by month."""
    cursor = start
    while cursor <= end:
        # Last day of current month
        if cursor.month == 12:
            month_end = date(cursor.year + 1, 1, 1) - timedelta(days=1)
        else:
            month_end = date(cursor.year, cursor.month + 1, 1) - timedelta(days=1)
        chunk_end = min(month_end, end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def _fetch_month(client: httpx.Client, chunk_start: date, chunk_end: date) -> list[dict]:
    """Fetch one month of hourly data from Bright Sky and aggregate to daily rows."""
    params = {
        "lat": LAT,
        "lon": LON,
        "date": chunk_start.isoformat(),
        "last_date": chunk_end.isoformat(),
    }
    resp = client.get(BRIGHTSKY_BASE, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    # Bright Sky returns {"weather": [...], "sources": [...]}
    hourly = payload.get("weather", [])

    # Aggregate hourly → daily
    # weather_daily actual columns: date, location, temp_min_c, temp_max_c,
    #   precip_mm, wind_kph, cloud_cover, provider
    daily: dict[str, dict] = {}
    for row in hourly:
        # timestamp format: "2021-01-01T00:00:00+01:00"
        day_str = row.get("timestamp", "")[:10]
        if not day_str:
            continue
        if day_str not in daily:
            daily[day_str] = {
                "date": day_str,
                "temps": [],
                "precip_sum": 0.0,
                "wind_speeds": [],
                "cloud_covers": [],
            }
        d = daily[day_str]
        temp = row.get("temperature")
        if temp is not None:
            d["temps"].append(temp)
        precip = row.get("precipitation")
        if precip is not None:
            d["precip_sum"] += precip
        wind = row.get("wind_speed")
        if wind is not None:
            d["wind_speeds"].append(wind)
        cloud = row.get("cloud_cover")
        if cloud is not None:
            d["cloud_covers"].append(cloud)

    # Build final row list matching weather_daily schema
    rows = []
    for day_str, d in sorted(daily.items()):
        temps = d["temps"]
        rows.append(
            {
                "date": day_str,
                "location": "berlin",
                "temp_min_c": round(min(temps), 2) if temps else None,
                "temp_max_c": round(max(temps), 2) if temps else None,
                "precip_mm": round(d["precip_sum"], 2),
                "wind_kph": (
                    round(max(d["wind_speeds"]), 2)
                    if d["wind_speeds"]
                    else None
                ),
                "cloud_cover": (
                    round(sum(d["cloud_covers"]) / len(d["cloud_covers"]), 1)
                    if d["cloud_covers"]
                    else None
                ),
                "provider": "brightsky",
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def upsert_weather_daily(client, rows: list[dict]) -> None:
    """Upsert a batch of rows into weather_daily."""
    if not rows:
        return
    client.table("weather_daily").upsert(rows, on_conflict="date,location").execute()
    print(f"[backfill] upserted {len(rows)} rows into weather_daily")


def compute_and_upsert_climatology(client) -> None:
    """Compute DoY norms from weather_daily and upsert into weather_climatology.

    Averages temp (from min/max), precip_mm, wind_kph per day-of-year (1-366).
    weather_climatology columns: day_of_year, temp_mean_c, precip_mm,
    wind_max_kmh, sample_years.
    """
    # Fetch all historical rows — actual weather_daily columns
    resp = (
        client.table("weather_daily")
        .select("date,temp_min_c,temp_max_c,precip_mm,wind_kph")
        .limit(10000)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        print("[backfill] No weather_daily rows found — skipping climatology", file=sys.stderr)
        return

    # Aggregate by DoY
    doy_buckets: dict[int, dict] = {}
    for row in rows:
        day = date.fromisoformat(row["date"])
        doy = day.timetuple().tm_yday  # 1-366
        if doy not in doy_buckets:
            doy_buckets[doy] = {
                "temp_sum": 0.0,
                "temp_count": 0,
                "precip_sum": 0.0,
                "precip_count": 0,
                "wind_sum": 0.0,
                "wind_count": 0,
                "years": set(),
            }
        b = doy_buckets[doy]
        b["years"].add(day.year)
        tmin = row.get("temp_min_c")
        tmax = row.get("temp_max_c")
        if tmin is not None and tmax is not None:
            b["temp_sum"] += (tmin + tmax) / 2.0
            b["temp_count"] += 1
        if row.get("precip_mm") is not None:
            b["precip_sum"] += row["precip_mm"]
            b["precip_count"] += 1
        if row.get("wind_kph") is not None:
            b["wind_sum"] += row["wind_kph"]
            b["wind_count"] += 1

    # Build climatology rows matching weather_climatology schema
    clim_rows = []
    for doy in sorted(doy_buckets.keys()):
        b = doy_buckets[doy]
        clim_rows.append(
            {
                "day_of_year": doy,
                "temp_mean_c": (
                    round(b["temp_sum"] / b["temp_count"], 3)
                    if b["temp_count"] > 0
                    else 0.0
                ),
                "precip_mm": (
                    round(b["precip_sum"] / b["precip_count"], 3)
                    if b["precip_count"] > 0
                    else 0.0
                ),
                "wind_max_kmh": (
                    round(b["wind_sum"] / b["wind_count"], 1)
                    if b["wind_count"] > 0
                    else 0.0
                ),
                "sample_years": len(b["years"]),
            }
        )

    client.table("weather_climatology").upsert(clim_rows, on_conflict="day_of_year").execute()
    print(f"[backfill] upserted {len(clim_rows)} rows into weather_climatology")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_no_large_gaps(client) -> bool:
    """Return True if no gap >MAX_GAP_DAYS exists in weather_daily date coverage.

    Fetches all dates, sorts them, and checks consecutive differences.
    """
    resp = (
        client.table("weather_daily")
        .select("date")
        .order("date")
        .execute()
    )
    rows = resp.data or []
    if not rows:
        print("[backfill] VALIDATION FAIL: weather_daily is empty", file=sys.stderr)
        return False

    dates = [date.fromisoformat(r["date"]) for r in rows]
    max_gap: Optional[int] = None
    gap_start: Optional[date] = None
    for i in range(1, len(dates)):
        gap = (dates[i] - dates[i - 1]).days - 1  # interior missing days
        if max_gap is None or gap > max_gap:
            max_gap = gap
            gap_start = dates[i - 1]

    if max_gap is not None and max_gap > MAX_GAP_DAYS:
        print(
            f"[backfill] VALIDATION FAIL: gap of {max_gap} days detected after {gap_start}",
            file=sys.stderr,
        )
        return False

    print(
        f"[backfill] Validation PASS: {len(dates)} days covered, max gap={max_gap or 0} days"
    )
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    sb = make_client()

    print(
        f"[backfill] Fetching Bright Sky weather {BACKFILL_START} → {BACKFILL_END} "
        f"(lat={LAT}, lon={LON})"
    )

    with httpx.Client() as http:
        for chunk_start, chunk_end in _month_chunks(BACKFILL_START, BACKFILL_END):
            print(f"[backfill] Fetching {chunk_start} → {chunk_end} …")
            try:
                rows = _fetch_month(http, chunk_start, chunk_end)
                upsert_weather_daily(sb, rows)
            except Exception as exc:
                print(
                    f"[backfill] ERROR fetching {chunk_start}→{chunk_end}: {exc}",
                    file=sys.stderr,
                )
                return 1

    print("[backfill] Computing climatological norms …")
    compute_and_upsert_climatology(sb)

    print("[backfill] Validating coverage gaps …")
    if not validate_no_large_gaps(sb):
        return 1

    print("[backfill] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
