"""Phase 16 Plan 06: cumulative_uplift.py — bootstrap CI orchestrator.

Reads `forecast_with_actual_v` rows for `forecast_track='cf'` per (model,
target_date), pulls 200 sample paths from `forecast_daily.yhat_samples`,
computes per-campaign-window cumulative uplift `Σ(actual − Track-B)` plus
a 95% bootstrap CI from 1000 path-level resamples (D-08 textbook form per
RESEARCH §1 second pseudocode block — ONE path per resample, percentile
2.5/97.5 quantiles), upserts results into the `campaign_uplift` backing
table for the `campaign_uplift_v` wrapper view (Plan 07).

After per-window writes, this module also fires the off-week reminder
(D-10): an atomic UPDATE on `feature_flags WHERE flag_key='offweek_reminder'
AND enabled=false AND remind_on_or_after_date<=today`. Postgres serializes
the UPDATE — only one of two concurrent runs sees the row mutable, the
other sees `enabled=true` and skips silently. Mitigates T-16-02.

Architecture (RESEARCH §5):
- Pull `pipeline_runs.status` for each `cf_<model>` row of run_date — only
  models with status='success' produce uplift rows (partial-fit resilience).
- naive_dow uplift is computed independently as a cross-check column;
  surfaced by D-09's divergence rule on the dashboard.
- Per CONTEXT.md C-04 / D-04 / Guard 9: Track-B fits use
  `kpi_name='revenue_comparable_eur'` ONLY. This module never writes
  `forecast_track='cf'` directly — it only AGGREGATES. The kpi_name passed
  to compute_uplift_for_window is `revenue_comparable_eur`.

KISS: one orchestrator (`main_uplift`) calls per-(campaign, model) helpers
in a try/except loop. Failure of one model never blocks the others.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import date, datetime, timezone
from typing import Callable, Optional

import numpy as np

from scripts.forecast.db import make_client
from scripts.external.pipeline_runs_writer import write_failure, write_success


# Phase 14 D-04: 200 paths per forecast_daily row. Hard-coded so the
# bootstrap-CI math fails fast if the storage budget changes upstream.
EXPECTED_PATHS_PER_ROW = 200

# All 5 BAU models that may have a corresponding `forecast_track='cf'` fit.
ALL_CF_MODELS = ["sarimax", "prophet", "ets", "theta", "naive_dow"]

# Guard 9 / D-04: Track-B uplift is ALWAYS computed on revenue_comparable_eur.
# A typo to 'revenue_eur' would silently return 0 rows (no CF rows have that
# kpi_name); fail-fast at the SELECT level is acceptable here.
KPI_COMPARABLE = "revenue_comparable_eur"

STEP_NAME = "cumulative_uplift"


# ---------------------------------------------------------------------------
# Pure-numpy bootstrap CI (D-08 textbook form per RESEARCH §1).
# ---------------------------------------------------------------------------

def bootstrap_uplift_ci(
    actual_values: np.ndarray,
    yhat_samples_per_day: list,
    n_resamples: int = 1000,
    confidence_level: float = 0.95,
    seed: int = 42,
) -> dict:
    """1000-bootstrap CI for `Σ(actual − Track-B)` over an N-day window.

    Args:
        actual_values: shape (N,) — actuals from forecast_with_actual_v.
        yhat_samples_per_day: shape (N, 200) — stored paths.
        n_resamples: resample count (default 1000 per UPL-04).
        confidence_level: 0.95 → 2.5/97.5 percentile bounds.
        seed: deterministic so cutoff_sensitivity.md snapshots stable.

    Returns:
        {cumulative_uplift_eur, ci_lower_eur, ci_upper_eur, n_days}.

    Math (D-08 textbook form):
        For k in 0..n_resamples-1:
            p = rng.integers(0, P)            # ONE path index, no size=
            sums[k] = (actual − paths[:, p]).sum()
        ci_lower = quantile(sums, 0.025)
        ci_upper = quantile(sums, 0.975)
    """
    rng = np.random.default_rng(seed)
    actual_values = np.asarray(actual_values, dtype=float)
    paths = np.asarray(yhat_samples_per_day, dtype=float)
    if paths.ndim != 2:
        raise ValueError(
            f"yhat_samples_per_day must be 2-D (N, P); got shape {paths.shape}"
        )
    N, P = paths.shape
    if P != EXPECTED_PATHS_PER_ROW:
        raise AssertionError(
            f"Expected {EXPECTED_PATHS_PER_ROW} stored paths per Phase 14 "
            f"D-04, got {P}"
        )
    if actual_values.shape[0] != N:
        raise ValueError(
            f"actual_values length {actual_values.shape[0]} ≠ paths rows {N}"
        )

    # Point estimate: mean over paths, then sum across window.
    point_estimate = float((actual_values - paths.mean(axis=1)).sum())

    # Textbook form: ONE path per resample (per D-08 wording exactly).
    sums = np.empty(n_resamples, dtype=float)
    for k in range(n_resamples):
        p = rng.integers(0, P)  # NO size= — single int
        sums[k] = float((actual_values - paths[:, p]).sum())

    alpha = (1.0 - confidence_level) / 2.0
    ci_lower = float(np.quantile(sums, alpha))
    ci_upper = float(np.quantile(sums, 1.0 - alpha))

    return {
        "cumulative_uplift_eur": point_estimate,
        "ci_lower_eur": ci_lower,
        "ci_upper_eur": ci_upper,
        "n_days": int(N),
    }


# ---------------------------------------------------------------------------
# Per-day rolling cumulative for D-11 sparkline (Task 4).
# ---------------------------------------------------------------------------

def compute_per_day_uplift_rows(
    *,
    restaurant_id: str,
    campaign_id: str,
    model_name: str,
    actual_values: np.ndarray,
    yhat_samples_per_day: list,
    target_dates: list,
) -> list:
    """Rolling cumulative uplift + CI for the D-11 sparkline (one row/day).

    For day i (0-indexed), runs `bootstrap_uplift_ci` on the slice
    `[0..i+1)` so each row carries that day's running cumulative_uplift_eur
    and 95% CI. Used by Plan 09's LayerChart Spline + Area to show the
    SHAPE of the uplift over the campaign window (not just a 2-point line).

    Args:
        restaurant_id, campaign_id, model_name: identifiers for the row.
        actual_values: shape (N,) — already loaded by caller.
        yhat_samples_per_day: shape (N, 200) — already loaded.
        target_dates: shape (N,) of date — same order as actual_values.

    Returns:
        N dicts each ready to upsert as a `window_kind='per_day'` row.

    Performance: 30-day window × 5 models × 1 campaign × 1000 resamples =
    150K array ops total — sub-second with numpy. Optimize via vectorized
    cumsum only if measured.
    """
    rows = []
    actual_values = np.asarray(actual_values, dtype=float)
    paths = np.asarray(yhat_samples_per_day, dtype=float)
    for i in range(len(actual_values)):
        ci = bootstrap_uplift_ci(
            actual_values=actual_values[: i + 1],
            yhat_samples_per_day=paths[: i + 1].tolist(),
            n_resamples=1000,
            # Per-day seed offset keeps each row deterministic but distinct
            # across days — protects against accidental cross-day correlation
            # in flaky-test scenarios.
            seed=42 + i,
        )
        rows.append({
            "restaurant_id": restaurant_id,
            "campaign_id": campaign_id,
            "model_name": model_name,
            "window_kind": "per_day",
            "cumulative_uplift_eur": ci["cumulative_uplift_eur"],
            "ci_lower_eur": ci["ci_lower_eur"],
            "ci_upper_eur": ci["ci_upper_eur"],
            "naive_dow_uplift_eur": None,  # cross-check is per-window only
            "n_days": i + 1,
            "as_of_date": target_dates[i].isoformat(),
        })
    return rows


# ---------------------------------------------------------------------------
# DB I/O helpers.
# ---------------------------------------------------------------------------

def _to_date(raw) -> date:
    """Coerce supabase response values (str | datetime | date) → date."""
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, str):
        return date.fromisoformat(raw[:10])
    raise ValueError(f"Unexpected date type: {type(raw)!r}")


def _decode_paths(raw) -> list:
    """Decode forecast_daily.yhat_samples (jsonb) into a python list.

    PostgREST may return jsonb as already-parsed list or as a JSON string;
    accept both shapes.
    """
    if raw is None:
        return []
    if isinstance(raw, str):
        return json.loads(raw)
    return list(raw)


def _load_window_rows(
    client,
    *,
    restaurant_id: str,
    model_name: str,
    start_date: date,
    end_date: date,
):
    """Fetch (actual, yhat_mean, target_date) per day from forecast_with_actual_v.

    Filters on the comparable KPI per Guard 9 — `revenue_eur` would silently
    miss all CF rows.
    """
    resp = (
        client.table("forecast_with_actual_v")
        .select("target_date,actual_value,yhat")
        .eq("restaurant_id", restaurant_id)
        .eq("model_name", model_name)
        .eq("kpi_name", KPI_COMPARABLE)
        .eq("forecast_track", "cf")
        .gte("target_date", start_date.isoformat())
        .lte("target_date", end_date.isoformat())
        .order("target_date")
        .execute()
    )
    return list(resp.data or [])


def _load_yhat_samples(
    client,
    *,
    restaurant_id: str,
    model_name: str,
    start_date: date,
    end_date: date,
):
    """Fetch yhat_samples (200 paths) per day from forecast_daily.

    Separate query from forecast_with_actual_v per the plan's contract:
    forecast_with_actual_v is read-only for mean yhat + actual; per-day
    sample paths come from forecast_daily directly. Joined in Python by
    target_date.
    """
    resp = (
        client.table("forecast_daily")
        .select("target_date,yhat_samples")
        .eq("restaurant_id", restaurant_id)
        .eq("model_name", model_name)
        .eq("kpi_name", KPI_COMPARABLE)
        .eq("forecast_track", "cf")
        .gte("target_date", start_date.isoformat())
        .lte("target_date", end_date.isoformat())
        .order("target_date")
        .execute()
    )
    return list(resp.data or [])


# ---------------------------------------------------------------------------
# Public compute helpers (called by main_uplift).
# ---------------------------------------------------------------------------

def compute_uplift_for_window(
    client,
    *,
    restaurant_id: str,
    campaign_id: str,
    model_name: str,
    start_date: date,
    end_date: date,
    kpi_name: str = KPI_COMPARABLE,
) -> Optional[dict]:
    """Compute per-(campaign, model, window) cumulative uplift + CI.

    Returns None if the window has zero days of actual data — caller MUST
    NOT write a row for empty windows. Otherwise returns a dict ready to
    upsert into campaign_uplift, plus the loaded numpy arrays so the
    per-day rolling pass can reuse them without a second DB roundtrip.
    """
    if kpi_name != KPI_COMPARABLE:
        # Guard 9: protect against accidental revenue_eur leak in callers.
        raise ValueError(
            f"kpi_name must be {KPI_COMPARABLE!r} per Guard 9 / D-04; "
            f"got {kpi_name!r}"
        )

    rows = _load_window_rows(
        client,
        restaurant_id=restaurant_id,
        model_name=model_name,
        start_date=start_date,
        end_date=end_date,
    )
    if not rows:
        return None

    # Filter to rows with non-null actual_value — windows extending past
    # last_actual produce yhat-only rows we cannot compute uplift on.
    rows = [r for r in rows if r.get("actual_value") is not None]
    if not rows:
        return None

    rows.sort(key=lambda r: r["target_date"])
    target_dates = [_to_date(r["target_date"]) for r in rows]
    actual_values = np.array([float(r["actual_value"]) for r in rows], dtype=float)

    # Pull stored paths for the same dates and join in Python.
    sample_rows = _load_yhat_samples(
        client,
        restaurant_id=restaurant_id,
        model_name=model_name,
        start_date=start_date,
        end_date=end_date,
    )
    samples_by_date: dict = {}
    for sr in sample_rows:
        d = _to_date(sr["target_date"])
        samples_by_date[d] = _decode_paths(sr.get("yhat_samples"))

    # Align: keep only dates present in BOTH actuals and samples.
    aligned_actuals = []
    aligned_paths = []
    aligned_dates = []
    for i, d in enumerate(target_dates):
        paths = samples_by_date.get(d)
        if paths is None or len(paths) == 0:
            continue
        aligned_actuals.append(actual_values[i])
        aligned_paths.append(paths)
        aligned_dates.append(d)

    if not aligned_actuals:
        return None

    actual_arr = np.asarray(aligned_actuals, dtype=float)
    ci = bootstrap_uplift_ci(
        actual_values=actual_arr,
        yhat_samples_per_day=aligned_paths,
        n_resamples=1000,
        seed=42,
    )

    return {
        "result": ci,
        "actual_values": actual_arr,
        "yhat_samples_per_day": aligned_paths,
        "target_dates": aligned_dates,
    }


def compute_naive_dow_uplift(
    client,
    *,
    restaurant_id: str,
    campaign_id: str,
    start_date: date,
    end_date: date,
) -> Optional[float]:
    """Cross-check column for D-09 / UPL-05 — `Σ(actual − naive_dow_yhat)`.

    No CI needed; this is a sanity comparator surfaced only when the
    SARIMAX uplift sign disagrees or magnitude diverges by >50%.
    """
    rows = _load_window_rows(
        client,
        restaurant_id=restaurant_id,
        model_name="naive_dow",
        start_date=start_date,
        end_date=end_date,
    )
    if not rows:
        return None
    rows = [r for r in rows if r.get("actual_value") is not None]
    if not rows:
        return None
    total = 0.0
    for r in rows:
        total += float(r["actual_value"]) - float(r["yhat"])
    return total


# ---------------------------------------------------------------------------
# Off-week reminder fire (D-10, RESEARCH §5).
# ---------------------------------------------------------------------------

def _default_write_reminder(client, *, restaurant_id: Optional[str] = None) -> None:
    """Default reminder writer: pipeline_runs row with status='reminder'.

    Uses the existing write_failure helper as the closest existing shape;
    error_msg field carries the human-readable reminder text (per
    RESEARCH §5: 'using write_failure as the closest existing helper,
    status=reminder' is acceptable KISS).
    """
    write_failure(
        client,
        step_name="offweek_reminder",
        started_at=datetime.now(timezone.utc),
        error_msg=(
            "Time to plan an off-week to re-anchor the counterfactual"
        ),
        restaurant_id=restaurant_id,
    )


def check_offweek_reminder(
    client,
    *,
    today: date,
    write_reminder: Optional[Callable] = None,
) -> bool:
    """Atomic-fire-once contract for the off-week reminder (T-16-02).

    Issues a single Postgres UPDATE with WHERE clauses that act as a
    serialized guard: only the FIRST run that sees `enabled=false AND
    remind_on_or_after_date <= today` modifies the row; the second sees
    `enabled=true` and modifies 0 rows. T-16-02 mitigated at the DB layer.

    Args:
        client: supabase service-role client.
        today: date to compare against `remind_on_or_after_date` (date object;
            we ISO-format it inside).
        write_reminder: optional injected callable for tests; default fires
            via pipeline_runs.

    Returns:
        True if THIS run won the race and fired the reminder; False if
        already fired (silently skipped).
    """
    resp = (
        client.table("feature_flags")
        .update({"enabled": True, "updated_at": "now()"})
        .eq("flag_key", "offweek_reminder")
        .eq("enabled", False)
        .lte("remind_on_or_after_date", today.isoformat())
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        # Race lost OR not yet time — skip silently (idempotent).
        return False

    fire = write_reminder or _default_write_reminder
    restaurant_id = rows[0].get("restaurant_id") if rows else None
    if write_reminder is not None:
        # Test-injected reminder — pass the client only (matches test signature).
        fire(client)
    else:
        fire(client, restaurant_id=restaurant_id)
    return True


# ---------------------------------------------------------------------------
# Orchestration.
# ---------------------------------------------------------------------------

def _get_restaurant_id(client) -> str:
    """Mirror run_all._get_restaurant_id."""
    resp = client.table("restaurants").select("id").limit(1).execute()
    rows = resp.data or []
    if not rows:
        raise RuntimeError("No restaurants found in the restaurants table")
    return rows[0]["id"]


def _list_campaigns(client, *, restaurant_id: str) -> list:
    resp = (
        client.table("campaign_calendar")
        .select("campaign_id,restaurant_id,start_date,end_date,name,channel")
        .eq("restaurant_id", restaurant_id)
        .execute()
    )
    return list(resp.data or [])


def _successful_cf_models(client, *, run_date: date) -> list:
    """Per RESEARCH §5: build SUCCESSFUL_CF_MODELS list from pipeline_runs.

    A cf_<model> row with status='success' whose `started_at` falls on this
    run_date (UTC) passes through. Failures (e.g., SARIMAX LinAlgError
    fallback that propagated) are excluded — partial-fit resilience per
    UPL-07.

    Plan 16-12 fix (Rule 3 — blocking bug): pipeline_runs has no `run_date`
    column; the schema uses `started_at` (timestamptz). Probe via
    `started_at >= run_date 00:00 AND started_at < (run_date+1) 00:00`.
    """
    from datetime import timedelta

    start_iso = f"{run_date.isoformat()}T00:00:00+00:00"
    end_iso = f"{(run_date + timedelta(days=1)).isoformat()}T00:00:00+00:00"
    succeeded = []
    for model in ALL_CF_MODELS:
        try:
            resp = (
                client.table("pipeline_runs")
                .select("status,started_at")
                .eq("step_name", f"cf_{model}")
                .gte("started_at", start_iso)
                .lt("started_at", end_iso)
                .order("started_at", desc=True)
                .limit(1)
                .execute()
            )
            data = resp.data or []
            if data and data[0].get("status") == "success":
                succeeded.append(model)
        except Exception as e:  # noqa: BLE001
            # Soft-fail: a probe failure must not block other models.
            sys.stderr.write(
                f"[cumulative_uplift] cf_{model} status probe failed: {e}\n"
            )
            continue
    return succeeded


def _upsert_campaign_uplift_rows(client, rows: list) -> int:
    """Upsert into the campaign_uplift backing table (Plan 07).

    Plan 07 owns the migration; this writer is best-effort against the
    expected PK `(restaurant_id, campaign_id, model_name, window_kind,
    as_of_date)`. If the table doesn't exist yet the upsert raises and
    main_uplift logs to pipeline_runs as a failure row.
    """
    if not rows:
        return 0
    res = (
        client.table("campaign_uplift")
        .upsert(
            rows,
            on_conflict="restaurant_id,campaign_id,model_name,window_kind,as_of_date",
        )
        .execute()
    )
    if getattr(res, "error", None):
        raise RuntimeError(f"campaign_uplift upsert failed: {res.error}")
    return len(rows)


def _process_campaign_model(
    client,
    *,
    restaurant_id: str,
    campaign: dict,
    model_name: str,
    run_date: date,
) -> list:
    """Compute the two per-window rows + N per-day rows for one (camp, model).

    Returns the list of rows ready to upsert (empty if window had no data).
    Mutates nothing on failure — caller decides whether to retry / skip.
    """
    campaign_id = campaign["campaign_id"]
    start_date = _to_date(campaign["start_date"])
    end_date = _to_date(campaign["end_date"])

    # Two windows per D-08:
    # (a) campaign_window: [start_date, end_date]
    # (b) cumulative_since_launch: [start_date, run_date]
    cumulative_end = max(end_date, run_date)

    naive_dow_window = compute_naive_dow_uplift(
        client,
        restaurant_id=restaurant_id,
        campaign_id=campaign_id,
        start_date=start_date,
        end_date=end_date,
    )
    naive_dow_cumulative = compute_naive_dow_uplift(
        client,
        restaurant_id=restaurant_id,
        campaign_id=campaign_id,
        start_date=start_date,
        end_date=cumulative_end,
    )

    out_rows: list = []

    cw = compute_uplift_for_window(
        client,
        restaurant_id=restaurant_id,
        campaign_id=campaign_id,
        model_name=model_name,
        start_date=start_date,
        end_date=end_date,
    )
    if cw is not None:
        cw_ci = cw["result"]
        out_rows.append({
            "restaurant_id": restaurant_id,
            "campaign_id": campaign_id,
            "model_name": model_name,
            "window_kind": "campaign_window",
            "cumulative_uplift_eur": cw_ci["cumulative_uplift_eur"],
            "ci_lower_eur": cw_ci["ci_lower_eur"],
            "ci_upper_eur": cw_ci["ci_upper_eur"],
            "naive_dow_uplift_eur": naive_dow_window,
            "n_days": cw_ci["n_days"],
            "as_of_date": end_date.isoformat(),
        })

    cs = compute_uplift_for_window(
        client,
        restaurant_id=restaurant_id,
        campaign_id=campaign_id,
        model_name=model_name,
        start_date=start_date,
        end_date=cumulative_end,
    )
    if cs is not None:
        cs_ci = cs["result"]
        out_rows.append({
            "restaurant_id": restaurant_id,
            "campaign_id": campaign_id,
            "model_name": model_name,
            "window_kind": "cumulative_since_launch",
            "cumulative_uplift_eur": cs_ci["cumulative_uplift_eur"],
            "ci_lower_eur": cs_ci["ci_lower_eur"],
            "ci_upper_eur": cs_ci["ci_upper_eur"],
            "naive_dow_uplift_eur": naive_dow_cumulative,
            "n_days": cs_ci["n_days"],
            "as_of_date": run_date.isoformat(),
        })

        # D-11 sparkline: per-day rolling rows over the cumulative window.
        per_day_rows = compute_per_day_uplift_rows(
            restaurant_id=restaurant_id,
            campaign_id=campaign_id,
            model_name=model_name,
            actual_values=cs["actual_values"],
            yhat_samples_per_day=cs["yhat_samples_per_day"],
            target_dates=cs["target_dates"],
        )
        out_rows.extend(per_day_rows)

    return out_rows


def main_uplift(client, run_date: date) -> int:
    """Top-level orchestrator. Returns total rows upserted.

    Flow:
      1. Resolve restaurant_id.
      2. Build SUCCESSFUL_CF_MODELS from pipeline_runs (RESEARCH §5).
      3. For each campaign × successful model: compute + upsert per-window
         and per-day rows (D-08 + D-11).
      4. Fire off-week reminder (D-10) — atomic UPDATE on feature_flags.
      5. Write final pipeline_runs row (success / failure with details).
    """
    started_at = datetime.now(timezone.utc)
    total_rows = 0
    try:
        restaurant_id = _get_restaurant_id(client)
        campaigns = _list_campaigns(client, restaurant_id=restaurant_id)
        successful_models = _successful_cf_models(client, run_date=run_date)

        for campaign in campaigns:
            for model_name in successful_models:
                try:
                    rows = _process_campaign_model(
                        client,
                        restaurant_id=restaurant_id,
                        campaign=campaign,
                        model_name=model_name,
                        run_date=run_date,
                    )
                    if rows:
                        total_rows += _upsert_campaign_uplift_rows(client, rows)
                except Exception as e:  # noqa: BLE001
                    # Per-model isolation: log + continue (UPL-07 resilience).
                    write_failure(
                        client,
                        step_name=STEP_NAME,
                        started_at=started_at,
                        error_msg=(
                            f"campaign={campaign.get('campaign_id')!r} "
                            f"model={model_name!r}: {e}\n{traceback.format_exc()}"
                        ),
                        restaurant_id=restaurant_id,
                    )
                    continue

        # D-10: fire off-week reminder regardless of model successes.
        check_offweek_reminder(client, today=run_date)

        write_success(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            row_count=total_rows,
            restaurant_id=restaurant_id,
        )
        return total_rows
    except Exception as e:  # noqa: BLE001
        write_failure(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            error_msg=f"{e}\n{traceback.format_exc()}",
        )
        raise


def main() -> int:
    """CLI entry. Returns POSIX-style exit code."""
    run_date = date.today()
    if "--run-date" in sys.argv:
        i = sys.argv.index("--run-date")
        if i + 1 < len(sys.argv):
            run_date = date.fromisoformat(sys.argv[i + 1])
    client = make_client()
    try:
        rows = main_uplift(client, run_date=run_date)
        print(f"[cumulative_uplift] upserted {rows} rows for run_date={run_date}")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"[cumulative_uplift] FAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
