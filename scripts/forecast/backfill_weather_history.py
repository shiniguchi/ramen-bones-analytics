"""One-time weather backfill: Bright Sky 2021-01-01 to 2025-06-10 (D-07).

Also computes and populates weather_climatology (366-row per-DoY averages).

Usage:
  python -m scripts.forecast.backfill_weather_history
  python -m scripts.forecast.backfill_weather_history --start 2021-01-01 --end 2025-06-10
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import date, timedelta

import httpx

from . import db

BRIGHT_SKY_URL = "https://api.brightsky.dev/weather"
LAT = 52.5200  # Berlin
LON = 13.4050

BACKFILL_START = date(2021, 1, 1)
BACKFILL_END = date(2025, 6, 10)


def fetch_brightsky_range(start: date, end: date) -> list[dict]:
    """Fetch daily weather from Bright Sky in monthly chunks."""
    rows = []
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=30), end)
        resp = httpx.get(
            BRIGHT_SKY_URL,
            params={
                "lat": LAT,
                "lon": LON,
                "date": str(current),
                "last_date": str(chunk_end + timedelta(days=1)),
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()

        daily: dict[str, dict] = {}
        for record in data.get("weather", []):
            d = record["timestamp"][:10]
            if d not in daily:
                daily[d] = {"date": d, "temps": [], "precip": 0, "wind": 0, "sun": 0}
            daily[d]["temps"].append(record.get("temperature", 0) or 0)
            daily[d]["precip"] += record.get("precipitation", 0) or 0
            daily[d]["wind"] = max(daily[d]["wind"], record.get("wind_speed", 0) or 0)
            daily[d]["sun"] += (record.get("sunshine", 0) or 0) / 60

        for d, vals in daily.items():
            rows.append(
                {
                    "date": d,
                    "temp_mean_c": round(sum(vals["temps"]) / len(vals["temps"]), 1),
                    "precip_mm": round(vals["precip"], 1),
                    "wind_max_kmh": round(vals["wind"], 1),
                    "sunshine_hours": round(vals["sun"], 1),
                    "is_forecast": False,
                }
            )
        current = chunk_end + timedelta(days=1)
        print(f"  fetched {current} ({len(rows)} total rows)")

    return rows


def compute_climatology(client) -> list[dict]:
    """Compute per-DoY averages from all actual weather_daily rows."""
    resp = (
        client.table("weather_daily")
        .select("date, temp_mean_c, precip_mm, wind_max_kmh, sunshine_hours")
        .eq("is_forecast", False)
        .execute()
    )

    by_doy: dict[tuple, dict] = defaultdict(
        lambda: {"temp": [], "precip": [], "wind": [], "sun": []}
    )
    for row in resp.data or []:
        d = date.fromisoformat(row["date"]) if isinstance(row["date"], str) else row["date"]
        key = (d.month, d.day)
        by_doy[key]["temp"].append(float(row["temp_mean_c"] or 0))
        by_doy[key]["precip"].append(float(row["precip_mm"] or 0))
        by_doy[key]["wind"].append(float(row["wind_max_kmh"] or 0))
        by_doy[key]["sun"].append(float(row["sunshine_hours"] or 0))

    rows = []
    for (month, day), vals in sorted(by_doy.items()):
        n = len(vals["temp"])
        rows.append(
            {
                "month": month,
                "day": day,
                "temp_mean_c": round(sum(vals["temp"]) / n, 1),
                "precip_mm": round(sum(vals["precip"]) / n, 1),
                "wind_max_kmh": round(sum(vals["wind"]) / n, 1),
                "sunshine_hours": round(sum(vals["sun"]) / n, 1),
                "n_years": n,
            }
        )
    return rows


def main(start: date = BACKFILL_START, end: date = BACKFILL_END) -> None:
    client = db.make_client()

    print(f"Fetching Bright Sky weather {start} -> {end}...")
    weather_rows = fetch_brightsky_range(start, end)
    print(f"Fetched {len(weather_rows)} daily rows")

    CHUNK = 100
    for i in range(0, len(weather_rows), CHUNK):
        chunk = weather_rows[i : i + CHUNK]
        client.table("weather_daily").upsert(chunk, on_conflict="date").execute()
    print(f"Upserted {len(weather_rows)} rows to weather_daily")

    print("Computing climatology...")
    clim_rows = compute_climatology(client)
    client.table("weather_climatology").upsert(clim_rows, on_conflict="month,day").execute()
    print(f"Upserted {len(clim_rows)} rows to weather_climatology")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="One-time weather history backfill")
    parser.add_argument("--start", default=str(BACKFILL_START))
    parser.add_argument("--end", default=str(BACKFILL_END))
    args = parser.parse_args()
    main(date.fromisoformat(args.start), date.fromisoformat(args.end))
