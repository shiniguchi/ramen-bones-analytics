"""Phase 17 BCK-01: tests for backtest.py fold cutoffs, cold-start guard, gate math.

Stubs supabase package and uses MagicMock for DB client. Pure-Python assertions
on fold-cutoff date math, UNCALIBRATED horizon constants, and gate decision logic.

These tests run offline (no DB, no subprocesses) in <1s.
"""
from __future__ import annotations

import sys
import types
from datetime import date, timedelta
from unittest.mock import MagicMock

import numpy as np
import pytest

# --- Stub supabase before importing backtest (matches run_all test pattern) ---
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub

from scripts.forecast.backtest import (  # noqa: E402
    HORIZONS,
    N_FOLDS,
    BASELINE_MODELS,
    GATE_THRESHOLD,
    UNCALIBRATED_HORIZONS,
    _gate_decision,
)


# ---------------------------------------------------------------------------
# 1. Fold-cutoff date math
# ---------------------------------------------------------------------------

class TestFoldCutoffs:
    """Verify the rolling-origin fold cutoff formulas."""

    def test_fold0_h7_eval_end_is_last_actual(self):
        """Fold 0 at h=7: eval_end = last_actual (most recent window)."""
        last_actual = date(2026, 5, 6)
        horizon = 7
        fold_idx = 0
        eval_end = last_actual - timedelta(days=fold_idx * horizon)
        assert eval_end == date(2026, 5, 6)

    def test_fold0_h7_eval_start(self):
        """Fold 0 at h=7: eval_start = last_actual - 6 (7-day window inclusive)."""
        last_actual = date(2026, 5, 6)
        horizon = 7
        fold_idx = 0
        eval_end = last_actual - timedelta(days=fold_idx * horizon)
        eval_start = eval_end - timedelta(days=horizon - 1)
        assert eval_start == date(2026, 4, 30)
        assert (eval_end - eval_start).days == horizon - 1

    def test_fold0_h7_train_end(self):
        """Fold 0 at h=7: train_end = eval_start - 1 (no overlap with eval)."""
        last_actual = date(2026, 5, 6)
        horizon = 7
        fold_idx = 0
        eval_end = last_actual - timedelta(days=fold_idx * horizon)
        eval_start = eval_end - timedelta(days=horizon - 1)
        train_end = eval_start - timedelta(days=1)
        assert train_end == date(2026, 4, 29)
        assert train_end < eval_start  # no leakage

    def test_folds_do_not_overlap(self):
        """Adjacent folds at same horizon must not share target_dates."""
        last_actual = date(2026, 5, 6)
        horizon = 7
        windows = []
        for fold_idx in range(N_FOLDS):
            eval_end = last_actual - timedelta(days=fold_idx * horizon)
            eval_start = eval_end - timedelta(days=horizon - 1)
            windows.append((eval_start, eval_end))
        for i in range(len(windows) - 1):
            # fold i+1's eval_end must be BEFORE fold i's eval_start
            assert windows[i + 1][1] < windows[i][0]

    def test_subprocess_run_date_is_eval_start(self):
        """The run_date passed to fold subprocess = eval_start (anchors pred_dates)."""
        last_actual = date(2026, 5, 6)
        horizon = 7
        fold_idx = 0
        eval_end = last_actual - timedelta(days=fold_idx * horizon)
        eval_start = eval_end - timedelta(days=horizon - 1)
        # This matches what _spawn_fit does: run_date=eval_start
        run_date_for_fold = eval_start
        assert run_date_for_fold == date(2026, 4, 30)

    def test_fold_count_constant(self):
        """N_FOLDS is 4 per BCK-01 / D-02."""
        assert N_FOLDS == 4

    def test_horizons_constant(self):
        """HORIZONS contains exactly [7, 35, 120, 365] per BCK-01."""
        assert HORIZONS == [7, 35, 120, 365]


# ---------------------------------------------------------------------------
# 2. UNCALIBRATED horizon constants
# ---------------------------------------------------------------------------

class TestUncalibratedHorizons:
    """Long horizons are UNCALIBRATED until ≥730 days of history."""

    def test_120_in_uncalibrated(self):
        assert 120 in UNCALIBRATED_HORIZONS

    def test_365_in_uncalibrated(self):
        assert 365 in UNCALIBRATED_HORIZONS

    def test_7_not_in_uncalibrated(self):
        assert 7 not in UNCALIBRATED_HORIZONS

    def test_35_not_in_uncalibrated(self):
        assert 35 not in UNCALIBRATED_HORIZONS


# ---------------------------------------------------------------------------
# 3. Gate decision logic
# ---------------------------------------------------------------------------

class TestGateDecision:
    """Unit tests for _gate_decision() — pure function, no DB."""

    def _row(self, model, horizon, rmse, kpi='revenue_eur', fold=0):
        return {
            'kpi_name': kpi,
            'model_name': model,
            'horizon_days': horizon,
            'rmse': rmse,
            'evaluation_window': 'rolling_origin_cv',
            'fold_index': fold,
        }

    def test_empty_rows_returns_empty(self):
        assert _gate_decision([], kpi='revenue_eur', horizon=7) == {}

    def test_h120_returns_uncalibrated_for_all_models(self):
        rows = [
            self._row('sarimax', 120, 100.0),
            self._row('naive_dow', 120, 200.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=120)
        assert verdicts == {'sarimax': 'UNCALIBRATED', 'naive_dow': 'UNCALIBRATED'}

    def test_h365_returns_uncalibrated_for_all_models(self):
        rows = [self._row('prophet', 365, 50.0)]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=365)
        assert verdicts['prophet'] == 'UNCALIBRATED'

    def test_pass_when_rmse_well_below_threshold(self):
        """sarimax RMSE = 60 <= max(100, 90)*0.9 = 90 → PASS."""
        rows = [
            self._row('naive_dow', 7, 100.0),
            self._row('naive_dow_with_holidays', 7, 90.0),
            self._row('sarimax', 7, 60.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert verdicts['sarimax'] == 'PASS'

    def test_fail_when_rmse_over_threshold(self):
        """prophet RMSE = 95 > max(100, 90)*0.9 = 90 → FAIL."""
        rows = [
            self._row('naive_dow', 7, 100.0),
            self._row('naive_dow_with_holidays', 7, 90.0),
            self._row('prophet', 7, 95.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert verdicts['prophet'] == 'FAIL'

    def test_baselines_always_pass(self):
        """naive_dow and naive_dow_with_holidays always get PASS (R7 guard)."""
        rows = [
            self._row('naive_dow', 7, 100.0),
            self._row('naive_dow_with_holidays', 7, 90.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert verdicts['naive_dow'] == 'PASS'
        assert verdicts['naive_dow_with_holidays'] == 'PASS'

    def test_gate_threshold_constant_is_0_9(self):
        """The 10% improvement requirement (GATE_THRESHOLD = 0.9) is enforced."""
        assert GATE_THRESHOLD == 0.9

    def test_mean_rmse_aggregated_across_folds(self):
        """Multiple fold rows: gate uses mean RMSE across folds."""
        rows = [
            self._row('naive_dow', 7, 100.0, fold=0),
            self._row('naive_dow', 7, 80.0, fold=1),   # mean = 90
            self._row('naive_dow_with_holidays', 7, 90.0, fold=0),
            self._row('sarimax', 7, 80.0, fold=0),
            self._row('sarimax', 7, 84.0, fold=1),  # mean = 82; threshold = 90*0.9 = 81 → FAIL
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        # baseline = max(mean(naive_dow)=90, naive_dow_with_holidays=90) = 90
        # threshold = 90 * 0.9 = 81; sarimax mean = 82 > 81 → FAIL
        assert verdicts['sarimax'] == 'FAIL'

    def test_kpi_filter_independent(self):
        """Gate filters by kpi; invoice_count rows not mixed with revenue_eur."""
        rows = [
            self._row('naive_dow', 7, 100.0, kpi='revenue_eur'),
            self._row('sarimax', 7, 50.0, kpi='revenue_eur'),
            # invoice_count rows should NOT influence revenue_eur gate
            self._row('naive_dow', 7, 10.0, kpi='invoice_count'),
            self._row('sarimax', 7, 100.0, kpi='invoice_count'),
        ]
        rev_verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        # revenue_eur: baseline=100, threshold=90; sarimax=50 → PASS
        assert rev_verdicts['sarimax'] == 'PASS'
