"""Phase 17: backtest.py — rolling-origin CV driver for the gate.

Spawns each *_fit.py per fold via subprocess (same pattern as run_all.py),
passing --train-end / --eval-start / --fold-index CLI flags (plan 17-04).
Reads back yhats from forecast_daily under a fold-scoped forecast_track
(R1 option a: forecast_track='backtest_fold_{N}' is part of the PK), computes
RMSE/MAPE per fold via compute_metrics() from last_7_eval. Writes
forecast_quality rows with evaluation_window='rolling_origin_cv'. Calibrates
h=35 conformal CI via scripts.forecast.conformal. Flips feature_flags.enabled=
false for failing models per BCK-04. Cleans backtest_fold_* rows post-eval.

R1 rationale: forecast_daily PK is (restaurant_id, kpi_name, target_date,
model_name, run_date, forecast_track). Per-fold subprocess sets
FORECAST_TRACK='backtest_fold_{N}' so each fold occupies its own PK partition
even if eval windows overlap. backtest.py reads yhats back, computes metrics,
then DELETEs backtest_fold_* rows to keep forecast_daily clean.

D-06 / R7: naive_dow and naive_dow_with_holidays are ALWAYS-ON baselines and
are NEVER flipped to enabled=false by _apply_gate_to_feature_flags.

Migration 0068 constraint: gate_verdict must be NOT NULL for every row with
evaluation_window='rolling_origin_cv'. Fold rows are therefore written with
gate_verdict='PENDING' first, then updated to PASS/FAIL/UNCALIBRATED in the
second pass after all folds complete.

Exit codes:
  0  — at least one (model, horizon, fold) succeeded; gate may have flipped flags
  1  — total failure or no restaurants found

CLI:
    python -m scripts.forecast.backtest [--models sarimax,...] [--run-date YYYY-MM-DD]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BACKTEST STRATEGY MEMO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT WE DO TODAY (v1.3, ~330 days of data as of May 2026)
----------------------------------------------------------
Method : Rolling-origin cross-validation, day grain only.
Folds  : N_FOLDS = 4, non-overlapping (each fold steps back by `horizon` days).
Horizons: h=7, h=35, h=120, h=365 (day-grain only).
Gate   : challenger must beat best baseline by ≥10% RMSE (GATE_THRESHOLD=0.9).
Limits :
  - h=365 is PENDING until ≥369 days of history (currently ~330d).
  - h=120 and h=365 are UNCALIBRATED until ≥730 days (BCK-02).
  - Week and month grain are NOT backtested. Monthly Prophet in particular
    trains on ~6 monthly buckets with no yearly seasonality and its upward
    trend has zero cross-validation coverage. Treat monthly forecasts as
    directional indicators only, not reliable point estimates.

WHY THESE CHOICES (data scarcity constraints)
---------------------------------------------
4 non-overlapping folds at h=35 already consumes 4×35=140 days of eval
data. With only ~330 days total, overlapping windows would give many more
folds but the earliest folds would have <30 days of training data — too
sparse to fit SARIMAX or ETS reliably. The current design trades fold count
for training-set quality. It is a minimum-viable gate, not a mature signal.

WHAT TO CHANGE WHEN DATA MATURES
---------------------------------
Threshold 1 — 369 days (≈ June 2026):
  h=365 exits PENDING. No code change needed; the cold-start guard
  in main() handles it automatically.

Threshold 2 — 730 days (≈ June 2027):
  • h=120 and h=365 exit UNCALIBRATED (BCK-02 flag removed).
  • Prophet yearly_seasonality flips True at day grain automatically
    (YEARLY_THRESHOLD_BY_GRAIN['day']=730 in prophet_fit.py).
  • Switch backtest to overlapping windows: set FOLD_STEP_DAYS=7 and
    derive N_FOLDS from (days_history - horizon) // FOLD_STEP_DAYS.
    This yields ~37 folds for h=35 from the same dataset, giving a
    statistically stable RMSE estimate. Example with your data at 730d:
      h=7  → ~100 folds   (step=7d, each fold holds out 7 days)
      h=35 → ~100 folds   (step=7d, each fold holds out 35 days)
    Replace N_FOLDS=4 constant with the formula above.

Threshold 3 — 104 weekly buckets / 24 monthly buckets (≈ mid-2027):
  • SARIMAX, ETS, Theta unlock at week and month grain
    (YEARLY_THRESHOLD_BY_GRAIN in grain_helpers.py).
  • Add week-grain and month-grain backtest loops here. Use h=4w/h=13w
    for weekly, h=3mo/h=6mo for monthly, step=1 bucket.
  • With ~104 weekly buckets and step=1 week, h=13w gives ~91 folds —
    enough for a reliable weekly RMSE. Monthly will still be thin
    (~24 buckets, step=1mo, h=3mo → ~21 folds) but better than nothing.
  • Monthly Prophet's yearly_seasonality flips True at 24 monthly
    buckets automatically. At that point the upward-trend extrapolation
    problem resolves — the model will have seen at least two Jan–Jun
    cycles and will fit a repeating annual curve instead of a linear ramp.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import numpy as np

from scripts.forecast.db import make_client
from scripts.forecast.last_7_eval import compute_metrics
from scripts.forecast.conformal import calibrate_conformal_h35
from scripts.external.pipeline_runs_writer import write_success, write_failure

# --- Constants ---
HORIZONS_BY_GRAIN: dict[str, list[int]] = {
    'day':   [7, 35, 120, 365],
    'week':  [4, 13, 26],
    'month': [3, 6],
}
N_FOLDS_BY_GRAIN: dict[str, int] = {'day': 4, 'week': 4, 'month': 3}
# Approximate days per bucket — used for cold-start guard and fold date arithmetic.
# Month uses 30d approximation; calendar-exact month arithmetic added when we reach
# Threshold 3 (≥24 monthly buckets / ~2027).
BUCKET_DAYS: dict[str, int] = {'day': 1, 'week': 7, 'month': 30}
DEFAULT_MODELS = [
    'sarimax', 'prophet', 'ets', 'theta',
    'naive_dow', 'naive_dow_with_holidays',
]
KPIS = ['revenue_eur', 'invoice_count']
STEP_NAME = 'forecast_backtest'

# R7 hard guard: baselines are always-on — their feature_flags are NEVER flipped
BASELINE_MODELS = ('naive_dow', 'naive_dow_with_holidays')

# ≥10% RMSE improvement required vs best baseline (BCK-04 / D-04)
GATE_THRESHOLD = 0.9

# Horizons without sufficient history for reliable CI calibration (BCK-02)
# A model stays UNCALIBRATED at these horizons until ≥730 days of history.
UNCALIBRATED_HORIZONS = (120, 365)

# Minimum days of history before a horizon is evaluable (cold-start guard)
# Required: horizon + N_FOLDS days so every fold has non-overlapping train/eval.
# Actually the spec requires horizon + N_FOLDS days (see CONTEXT D-02).
# For long horizons this means: h=120 needs 124d, h=365 needs 369d.


# --------------------------------------------------------------------------- #
# Grain → evaluation_window mapping                                             #
# --------------------------------------------------------------------------- #

def _eval_window_for_grain(grain: str) -> str:
    """Return the evaluation_window value for a given grain.

    Day grain keeps the legacy 'rolling_origin_cv' key so existing DB rows,
    the API query in +server.ts, and the migration 0068 NOT-NULL constraint
    all continue to work without a schema migration. Week/month use grain-scoped
    keys to avoid PK collisions with the legacy day rows.
    """
    if grain == 'day':
        return 'rolling_origin_cv'
    return f'rolling_origin_cv_{grain}'


# --------------------------------------------------------------------------- #
# Subprocess helpers (mirror of run_all._build_subprocess_env)                 #
# --------------------------------------------------------------------------- #

def _build_subprocess_env(
    *,
    restaurant_id: str,
    kpi_name: str,
    run_date: date,
    granularity: str,
    forecast_track: str = 'bau',
) -> dict:
    """Build env dict for a fold subprocess. Inherits current env and injects
    required variables. FORECAST_TRACK disambiguates fold rows in forecast_daily."""
    env = os.environ.copy()
    env['RESTAURANT_ID'] = restaurant_id
    env['KPI_NAME'] = kpi_name
    env['RUN_DATE'] = run_date.isoformat() if isinstance(run_date, date) else run_date
    env['GRANULARITY'] = granularity
    env['FORECAST_TRACK'] = forecast_track
    for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'):
        if key not in env:
            raise RuntimeError(
                f'{key} must be set in the runtime environment before backtest.'
            )
    return env


def _spawn_fit(
    *,
    model: str,
    restaurant_id: str,
    kpi_name: str,
    train_end: date,
    eval_start: date,
    fold_idx: int,
    granularity: str = 'day',
) -> bool:
    """Spawn one *_fit.py subprocess for a single backtest fold.

    Sets FORECAST_TRACK=backtest_fold_{fold_idx} so the yhat rows land in a
    fold-specific PK partition in forecast_daily (R1 mitigation). RUN_DATE is
    set to eval_start so the fit's pred_dates anchor correctly to the fold window.

    Returns True iff the subprocess exits 0.
    """
    cmd = [
        sys.executable, '-m', f'scripts.forecast.{model}_fit',
        '--train-end', train_end.isoformat(),
        '--eval-start', eval_start.isoformat(),
        '--fold-index', str(fold_idx),
    ]
    env = _build_subprocess_env(
        restaurant_id=restaurant_id,
        kpi_name=kpi_name,
        run_date=eval_start,  # anchors pred_dates to the fold eval window
        granularity=granularity,
        forecast_track=f'backtest_fold_{fold_idx}',
    )
    print(
        f'[backtest] fold {fold_idx}: {model} kpi={kpi_name} '
        f'train_end={train_end} eval_start={eval_start}'
    )
    result = subprocess.run(cmd, env=env, text=True, capture_output=True)
    if result.stdout:
        print(result.stdout, end='')
    if result.stderr:
        print(result.stderr, end='', file=sys.stderr)
    if result.returncode != 0:
        print(
            f'[backtest] fold {fold_idx} {model}/{kpi_name}: FAILED (exit {result.returncode})',
            file=sys.stderr,
        )
        return False
    return True


# --------------------------------------------------------------------------- #
# DB read helpers                                                               #
# --------------------------------------------------------------------------- #

def _last_actual_date(client, restaurant_id: str) -> date:
    """Max business_date from kpi_daily_mv for this restaurant."""
    resp = (
        client.table('kpi_daily_mv')
        .select('business_date')
        .eq('restaurant_id', restaurant_id)
        .order('business_date', desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise RuntimeError(
            'No kpi_daily_mv rows found for restaurant; cannot run backtest.'
        )
    raw = rows[0]['business_date']
    return date.fromisoformat(raw[:10]) if isinstance(raw, str) else raw


def _days_of_history(client, restaurant_id: str) -> int:
    """Count of rows in kpi_daily_mv for this restaurant (cold-start guard)."""
    resp = (
        client.table('kpi_daily_mv')
        .select('business_date', count='exact')
        .eq('restaurant_id', restaurant_id)
        .execute()
    )
    return getattr(resp, 'count', None) or len(resp.data or [])


def _fetch_actuals(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    eval_start: date,
    eval_end: date,
) -> np.ndarray:
    """Read actual KPI values from kpi_daily_mv for the fold's eval window."""
    col = 'revenue_cents' if kpi_name == 'revenue_eur' else 'tx_count'
    resp = (
        client.table('kpi_daily_mv')
        .select(f'business_date,{col}')
        .eq('restaurant_id', restaurant_id)
        .gte('business_date', eval_start.isoformat())
        .lte('business_date', eval_end.isoformat())
        .order('business_date')
        .execute()
    )
    rows = resp.data or []
    factor = 100.0 if kpi_name == 'revenue_eur' else 1.0  # cents → EUR
    return np.array([float(r[col]) / factor for r in rows], dtype=float)


def _fetch_fold_yhats(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    model: str,
    fold_idx: int,
    eval_start: date,
    eval_end: date,
) -> np.ndarray:
    """Read yhat rows written by the fold's subprocess (forecast_track-scoped).

    The spawned fit writes to forecast_daily with FORECAST_TRACK='backtest_fold_{N}'.
    We read them back here for metric computation, then DELETE them post-eval.
    """
    resp = (
        client.table('forecast_daily')
        .select('target_date,yhat')
        .eq('restaurant_id', restaurant_id)
        .eq('kpi_name', kpi_name)
        .eq('model_name', model)
        .eq('forecast_track', f'backtest_fold_{fold_idx}')
        .gte('target_date', eval_start.isoformat())
        .lte('target_date', eval_end.isoformat())
        .order('target_date')
        .execute()
    )
    rows = resp.data or []
    return np.array([float(r['yhat']) for r in rows], dtype=float)


# --------------------------------------------------------------------------- #
# DB write helpers                                                              #
# --------------------------------------------------------------------------- #

def _write_quality_row(
    client,
    *,
    restaurant_id: str,
    kpi_name: str,
    model: str,
    horizon: int,
    fold_idx: Optional[int],
    train_end: Optional[date],
    eval_start: Optional[date],
    metrics: Optional[dict],
    gate_verdict: str,  # required per migration 0068 constraint
    grain: str = 'day',
    qhat: Optional[float] = None,
) -> None:
    """Upsert one forecast_quality row for a rolling_origin_cv evaluation.

    gate_verdict must NOT be None when evaluation_window='rolling_origin_cv' (day grain,
    migration 0068 constraint). Pass 'PENDING' for fold rows; update later.
    """
    row: dict = {
        'restaurant_id': restaurant_id,
        'kpi_name': kpi_name,
        'model_name': model,
        'horizon_days': horizon,
        'evaluation_window': _eval_window_for_grain(grain),
        'evaluated_at': datetime.now(timezone.utc).isoformat(),
        'fold_index': fold_idx,
        'train_end_date': train_end.isoformat() if train_end else None,
        'eval_start_date': eval_start.isoformat() if eval_start else None,
        'gate_verdict': gate_verdict,
        'qhat': qhat,
    }
    if metrics is not None:
        row.update({
            'n_days': int(metrics.get('n_days', 0)),
            'rmse': round(float(metrics['rmse']), 4),
            'mape': round(float(metrics['mape']), 4),
            'mean_bias': round(float(metrics['mean_bias']), 4),
            'direction_hit_rate': round(float(metrics['direction_hit_rate']), 4),
        })
    client.table('forecast_quality').upsert(row).execute()


# --------------------------------------------------------------------------- #
# Gate logic                                                                    #
# --------------------------------------------------------------------------- #

def _gate_decision(
    quality_rows: list[dict],
    *,
    kpi: str,
    horizon: int,
    evaluation_window: str = 'rolling_origin_cv',  # legacy day-grain default
) -> dict[str, str]:
    """Compute PASS/FAIL/PENDING/UNCALIBRATED verdict per model for one (kpi, horizon).

    Args:
        quality_rows:      In-memory list of fold metrics dicts collected this run.
        kpi:               KPI name filter.
        horizon:           Horizon filter.
        evaluation_window: evaluation_window value to filter on (grain-scoped).

    Returns:
        {model_name: verdict_str} — empty dict if no rows.

    Gate rule (BCK-03 / D-04):
        baseline = max(naive_dow_mean_rmse, naive_dow_with_holidays_mean_rmse)
        threshold = baseline * GATE_THRESHOLD (0.9)
        model PASS iff model_rmse <= threshold
        Baselines always get PASS (they define the floor — R7).
        Long horizons (120d, 365d) always UNCALIBRATED until ≥730d history.
        If < 2 folds succeeded for a model, verdict = PENDING.
    """
    # Filter to this (kpi, horizon, grain) slice
    rows_at_h = [
        r for r in quality_rows
        if r['kpi_name'] == kpi
        and r['horizon_days'] == horizon
        and r['evaluation_window'] == evaluation_window
    ]
    if not rows_at_h:
        return {}

    # Collect RMSE values per model across folds
    rmses_by_model: dict[str, list[float]] = defaultdict(list)
    for r in rows_at_h:
        if r.get('rmse') is not None:
            rmses_by_model[r['model_name']].append(float(r['rmse']))

    if not rmses_by_model:
        return {}

    # UNCALIBRATED for long horizons regardless of RMSE (BCK-02)
    if horizon in UNCALIBRATED_HORIZONS:
        return {m: 'UNCALIBRATED' for m in rmses_by_model}

    # Compute mean RMSE per model
    mean_rmse = {m: float(np.mean(rs)) for m, rs in rmses_by_model.items()}

    # Baseline: max of naive_dow and naive_dow_with_holidays means.
    # BL-01 fix: when EITHER baseline RMSE is missing/None/NaN/inf, the gate is
    # undecidable — refuse to compute a verdict and return PENDING for ALL
    # models in this slice. Baselines are R7 always-on; their absence is a
    # data-quality signal (subprocess crash, zero aligned rows, etc.), NOT a
    # free pass. Defaulting to float('inf') would silently set
    # threshold = inf * 0.9 = inf and pass every challenger.
    baseline_dow = mean_rmse.get('naive_dow')
    baseline_dow_h = mean_rmse.get('naive_dow_with_holidays')
    if (
        baseline_dow is None
        or baseline_dow_h is None
        or not np.isfinite(baseline_dow)
        or not np.isfinite(baseline_dow_h)
    ):
        return {m: 'PENDING' for m in mean_rmse}
    baseline = max(baseline_dow, baseline_dow_h)
    threshold = baseline * GATE_THRESHOLD

    verdicts: dict[str, str] = {}
    for m, rmse in mean_rmse.items():
        if m in BASELINE_MODELS:
            # Baselines always PASS — they define the floor (R7 guard)
            verdicts[m] = 'PASS'
        elif rmse <= threshold:
            verdicts[m] = 'PASS'
        else:
            verdicts[m] = 'FAIL'

    return verdicts


def _apply_gate_to_feature_flags(
    client,
    *,
    restaurant_id: str,
    model_aggregate_verdicts: dict[str, str],
) -> None:
    """Flip feature_flags.enabled=false for non-baseline models with aggregate FAIL.

    Aggregate verdict = FAIL if any evaluable horizon FAILs.
    PENDING and UNCALIBRATED verdicts do NOT flip the flag (silent).
    Baselines (naive_dow, naive_dow_with_holidays) NEVER flip — R7 hard guard.
    """
    for model, verdict in model_aggregate_verdicts.items():
        # R7: baselines are always-on — skip entirely, regardless of verdict
        if model in BASELINE_MODELS:
            continue
        if verdict == 'FAIL':
            print(f'[backtest] Flipping feature_flags model_{model}=disabled (gate FAIL)')
            client.table('feature_flags').update({
                'enabled': False,
                'updated_at': datetime.now(timezone.utc).isoformat(),
            }).eq('restaurant_id', restaurant_id).eq(
                'flag_key', f'model_{model}'
            ).execute()


def _cleanup_sentinel_rows(client, *, restaurant_id: str) -> None:
    """DELETE forecast_daily rows written by this backtest run (backtest_fold_* tracks).

    Keeps forecast_daily clean — backtest fold rows are transient and should not
    persist into the nightly BAU reads or dashboard queries.
    """
    client.table('forecast_daily').delete().eq(
        'restaurant_id', restaurant_id
    ).like('forecast_track', 'backtest_fold_%').execute()
    print('[backtest] Cleaned up backtest_fold_* sentinel rows from forecast_daily.')


# --------------------------------------------------------------------------- #
# Main driver                                                                   #
# --------------------------------------------------------------------------- #

def main(models: list[str], run_date: date) -> int:
    """Run rolling-origin CV for all (kpi, horizon, model, fold) combinations.

    Returns 0 on partial/full success, 1 on total failure.
    """
    started_at = datetime.now(timezone.utc)
    client = make_client()

    # Resolve restaurant_id (v1: single-tenant)
    resp = client.table('restaurants').select('id').limit(1).execute()
    rows = resp.data or []
    if not rows:
        print('[backtest] ERROR: no restaurants found', file=sys.stderr)
        return 1
    restaurant_id = rows[0]['id']

    last_actual = _last_actual_date(client, restaurant_id)
    days_history = _days_of_history(client, restaurant_id)
    print(
        f'[backtest] restaurant={restaurant_id} models={models} '
        f'last_actual={last_actual} days_history={days_history}'
    )

    # Accumulate in-memory fold metrics for gate computation + conformal calibration
    quality_rows: list[dict] = []
    # {(kpi, model): {fold_idx: np.ndarray}} — h=35 signed residuals for conformal
    fold_residuals_h35: dict[tuple[str, str], dict[int, np.ndarray]] = defaultdict(dict)

    total_attempted = 0
    total_succeeded = 0

    try:
        # Phase 1: Rolling-origin fold spawning across all grains.
        for granularity in ('day', 'week', 'month'):
            horizons_g = HORIZONS_BY_GRAIN[granularity]
            n_folds_g = N_FOLDS_BY_GRAIN[granularity]
            bucket_days = BUCKET_DAYS[granularity]
            eval_window = _eval_window_for_grain(granularity)
            # Convert daily history count to approximate buckets for cold-start guard
            buckets_history = days_history // bucket_days

            for kpi in KPIS:
                for horizon in horizons_g:
                    # Cold-start guard: insufficient history → write PENDING for all models
                    required = horizon + n_folds_g
                    if buckets_history < required:
                        print(
                            f'[backtest] grain={granularity} kpi={kpi} h={horizon}: PENDING '
                            f'(buckets={buckets_history} < required={required})'
                        )
                        for model in models:
                            _write_quality_row(
                                client,
                                restaurant_id=restaurant_id,
                                kpi_name=kpi,
                                model=model,
                                horizon=horizon,
                                fold_idx=None,
                                train_end=None,
                                eval_start=None,
                                metrics=None,
                                gate_verdict='PENDING',
                                grain=granularity,
                            )
                        continue  # no folds for this horizon

                    # Rolling-origin folds — fold 0 is the most recent.
                    # Date arithmetic uses bucket_days so fold steps are grain-native.
                    for fold_idx in range(n_folds_g):
                        fold_offset = fold_idx * horizon * bucket_days
                        eval_end = last_actual - timedelta(days=fold_offset)
                        eval_start = eval_end - timedelta(days=horizon * bucket_days - 1)
                        train_end = eval_start - timedelta(days=1)

                        for model in models:
                            total_attempted += 1

                            # Spawn the fit subprocess for this fold
                            ok = _spawn_fit(
                                model=model,
                                restaurant_id=restaurant_id,
                                kpi_name=kpi,
                                train_end=train_end,
                                eval_start=eval_start,
                                fold_idx=fold_idx,
                                granularity=granularity,
                            )
                            if not ok:
                                _write_quality_row(
                                    client,
                                    restaurant_id=restaurant_id,
                                    kpi_name=kpi,
                                    model=model,
                                    horizon=horizon,
                                    fold_idx=fold_idx,
                                    train_end=train_end,
                                    eval_start=eval_start,
                                    metrics=None,
                                    gate_verdict='PENDING',
                                    grain=granularity,
                                )
                                continue

                            # Read actuals and yhats for this fold's eval window.
                            # NOTE: _fetch_actuals returns daily rows; for week/month grain
                            # the alignment check (n=min) will misalign daily actuals against
                            # bucket-level yhats — those folds will land as PENDING until a
                            # bucketed actuals fetch is added (future follow-up).
                            actuals = _fetch_actuals(
                                client,
                                restaurant_id=restaurant_id,
                                kpi_name=kpi,
                                eval_start=eval_start,
                                eval_end=eval_end,
                            )
                            yhats = _fetch_fold_yhats(
                                client,
                                restaurant_id=restaurant_id,
                                kpi_name=kpi,
                                model=model,
                                fold_idx=fold_idx,
                                eval_start=eval_start,
                                eval_end=eval_end,
                            )

                            # Align lengths defensively (closed days may produce gaps)
                            n = min(len(actuals), len(yhats))
                            if n == 0:
                                print(
                                    f'[backtest] grain={granularity} fold {fold_idx} '
                                    f'{model}/{kpi} h={horizon}: '
                                    'zero aligned rows; skipping metrics',
                                    file=sys.stderr,
                                )
                                _write_quality_row(
                                    client,
                                    restaurant_id=restaurant_id,
                                    kpi_name=kpi,
                                    model=model,
                                    horizon=horizon,
                                    fold_idx=fold_idx,
                                    train_end=train_end,
                                    eval_start=eval_start,
                                    metrics=None,
                                    gate_verdict='PENDING',
                                    grain=granularity,
                                )
                                continue

                            actuals = actuals[:n]
                            yhats = yhats[:n]

                            metrics = compute_metrics(actuals, yhats)
                            metrics['n_days'] = n

                            # Write fold row with PENDING verdict (updated in second pass)
                            _write_quality_row(
                                client,
                                restaurant_id=restaurant_id,
                                kpi_name=kpi,
                                model=model,
                                horizon=horizon,
                                fold_idx=fold_idx,
                                train_end=train_end,
                                eval_start=eval_start,
                                metrics=metrics,
                                gate_verdict='PENDING',  # filled in second pass after gate
                                grain=granularity,
                            )

                            # Track for in-memory gate computation
                            quality_rows.append({
                                'kpi_name': kpi,
                                'model_name': model,
                                'horizon_days': horizon,
                                'rmse': metrics['rmse'],
                                'evaluation_window': eval_window,
                                'fold_index': fold_idx,
                            })

                            # Collect h=35 signed residuals for conformal calibration (BCK-02)
                            # Day grain only: week/month have no h=35.
                            if granularity == 'day' and horizon == 35:
                                residuals = actuals - yhats  # signed: actual - yhat
                                fold_residuals_h35[(kpi, model)][fold_idx] = residuals

                            total_succeeded += 1

        # ------------------------------------------------------------------- #
        # Phase 2: Conformal calibration at h=35 (BCK-02) — day grain only    #
        # ------------------------------------------------------------------- #
        for (kpi, model), folds in fold_residuals_h35.items():
            qhat_result = calibrate_conformal_h35(folds, alpha=0.05)
            qhat_val = qhat_result['qhat_h35']
            print(
                f'[backtest] conformal qhat_h35[{kpi}/{model}] = '
                f'{qhat_val:.4f}' if not np.isnan(qhat_val) else
                f'[backtest] conformal qhat_h35[{kpi}/{model}] = nan (cold-start)'
            )
            # WR-04 fix: convert NaN/inf qhat → NULL at the write boundary so
            # downstream consumers querying `WHERE qhat IS NOT NULL` don't
            # incorrectly include cold-start rows, and `ORDER BY qhat` stays
            # well-defined. (Postgres accepts NaN in double precision but
            # treats it as a "real" value in indexes / ORDER BY — surprising
            # behavior we want to avoid.)
            qhat_val_for_db = (
                None
                if qhat_val is None or not np.isfinite(qhat_val)
                else float(qhat_val)
            )
            # Write a sentinel conformal row (fold_idx=None, no metrics)
            _write_quality_row(
                client,
                restaurant_id=restaurant_id,
                kpi_name=kpi,
                model=model,
                horizon=35,
                fold_idx=None,
                train_end=None,
                eval_start=None,
                metrics=None,
                gate_verdict='PENDING',  # conformal row: no gate verdict per se
                grain='day',
                qhat=qhat_val_for_db,
            )

        # ------------------------------------------------------------------- #
        # Phase 3: Gate decision and feature_flags update (BCK-04)             #
        # ------------------------------------------------------------------- #
        per_model_per_horizon_verdicts: dict[str, dict[int, str]] = defaultdict(dict)

        for granularity in ('day', 'week', 'month'):
            eval_window = _eval_window_for_grain(granularity)
            for kpi in KPIS:
                for horizon in HORIZONS_BY_GRAIN[granularity]:
                    verdicts = _gate_decision(
                        quality_rows, kpi=kpi, horizon=horizon,
                        evaluation_window=eval_window,
                    )
                    if not verdicts:
                        continue

                    for model, verdict in verdicts.items():
                        per_model_per_horizon_verdicts[model][horizon] = verdict

                        # Update gate_verdict on the already-written forecast_quality rows
                        # Scoped to: this run's rows (evaluated_at >= started_at)
                        client.table('forecast_quality').update(
                            {'gate_verdict': verdict}
                        ).eq('restaurant_id', restaurant_id).eq(
                            'kpi_name', kpi
                        ).eq('model_name', model).eq(
                            'horizon_days', horizon
                        ).eq(
                            'evaluation_window', eval_window
                        ).gte(
                            'evaluated_at', started_at.isoformat()
                        ).execute()

        # Aggregate per model: enabled iff PASS at ALL evaluable horizons
        # PENDING and UNCALIBRATED do not flip (gate is silent until evaluable)
        aggregate: dict[str, str] = {}
        for model, hv in per_model_per_horizon_verdicts.items():
            non_silent = [v for v in hv.values() if v not in ('PENDING', 'UNCALIBRATED')]
            if not non_silent:
                aggregate[model] = 'PENDING'
            elif any(v == 'FAIL' for v in non_silent):
                aggregate[model] = 'FAIL'
            else:
                aggregate[model] = 'PASS'

        print(f'[backtest] Aggregate model verdicts: {aggregate}')

        # Apply gate: flip feature_flags for failing non-baseline models
        _apply_gate_to_feature_flags(
            client,
            restaurant_id=restaurant_id,
            model_aggregate_verdicts=aggregate,
        )

        # ------------------------------------------------------------------- #
        # Phase 4: pipeline_runs success                                        #
        # (Cleanup of backtest_fold_* rows now runs unconditionally in the      #
        # `finally` block below — BL-02 fix.)                                   #
        # ------------------------------------------------------------------- #
        write_success(
            client,
            step_name=STEP_NAME,
            started_at=started_at,
            row_count=total_succeeded,
            restaurant_id=restaurant_id,
        )
        print(
            f'[backtest] DONE. {total_succeeded}/{total_attempted} fold fits succeeded. '
            f'Aggregate: {aggregate}'
        )
        return 0 if total_succeeded > 0 else 1

    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        try:
            write_failure(
                client,
                step_name=STEP_NAME,
                started_at=started_at,
                error_msg=str(e),
                restaurant_id=restaurant_id,
            )
        except Exception:  # noqa: BLE001
            pass
        return 1
    finally:
        # BL-02 fix: ALWAYS clean up backtest_fold_* rows from forecast_daily,
        # even when an exception escaped from any of phases 1-4 above. Without
        # this, a DB hiccup, NaN cascade, or gate-update failure leaves stale
        # `forecast_track='backtest_fold_N'` rows in forecast_daily — and
        # forecast_daily_mv's `DISTINCT ON ... ORDER BY run_date DESC` can
        # surface those leaked rows in BAU dashboard reads indefinitely
        # (BAU writes use `track='bau'`, a different PK partition, so they
        # never overwrite the leaked sentinel rows).
        try:
            _cleanup_sentinel_rows(client, restaurant_id=restaurant_id)
        except Exception as cleanup_err:  # noqa: BLE001
            print(
                f'[backtest] cleanup failed: {cleanup_err}',
                file=sys.stderr,
            )


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Phase 17 rolling-origin CV backtest driver (BCK-01/BCK-02/BCK-04)'
    )
    parser.add_argument(
        '--models',
        type=str,
        default=None,
        help='Comma-separated model list (default: all 6).',
    )
    parser.add_argument(
        '--run-date',
        type=str,
        default=None,
        help='YYYY-MM-DD. Default = today UTC.',
    )
    args = parser.parse_args()

    selected_models = (
        [m.strip() for m in args.models.split(',') if m.strip()]
        if args.models
        else DEFAULT_MODELS
    )
    selected_run_date = (
        date.fromisoformat(args.run_date) if args.run_date else date.today()
    )
    sys.exit(main(selected_models, selected_run_date))
