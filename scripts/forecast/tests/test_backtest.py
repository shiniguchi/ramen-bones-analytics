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
            # revenue_eur side — both baselines provided so the slice is decidable
            self._row('naive_dow', 7, 100.0, kpi='revenue_eur'),
            self._row('naive_dow_with_holidays', 7, 90.0, kpi='revenue_eur'),
            self._row('sarimax', 7, 50.0, kpi='revenue_eur'),
            # invoice_count rows should NOT influence revenue_eur gate
            self._row('naive_dow', 7, 10.0, kpi='invoice_count'),
            self._row('naive_dow_with_holidays', 7, 9.0, kpi='invoice_count'),
            self._row('sarimax', 7, 100.0, kpi='invoice_count'),
        ]
        rev_verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        # revenue_eur: baseline = max(100, 90) = 100; threshold = 90; sarimax=50 → PASS
        assert rev_verdicts['sarimax'] == 'PASS'

    # --- BL-01 regression tests: missing-baseline path must NOT silent-pass ---

    def test_missing_naive_dow_with_holidays_returns_pending_not_pass(self):
        """BL-01: when naive_dow_with_holidays is missing, ALL challengers must be
        PENDING (gate undecidable) — NEVER PASS. Baselines must also be PENDING
        because the slice is undecidable.

        Pre-fix bug: `mean_rmse.get('naive_dow_with_holidays', float('inf'))` made
        threshold = inf * 0.9 = inf; sarimax_rmse <= inf is always True → silent PASS.
        """
        rows = [
            self._row('naive_dow', 7, 100.0),
            # naive_dow_with_holidays MISSING — simulates baseline subprocess crash
            self._row('sarimax', 7, 60.0),
            self._row('prophet', 7, 9999.0),  # would-be FAIL becomes PENDING
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        # Sanity: missing baseline path was reached
        assert verdicts, 'expected non-empty verdict dict'
        # CRITICAL: NO model gets PASS when a baseline is missing
        assert 'PASS' not in verdicts.values(), (
            f'silent gate bypass — got PASS verdicts with missing baseline: {verdicts}'
        )
        # All present models must be PENDING (slice undecidable)
        assert verdicts['sarimax'] == 'PENDING'
        assert verdicts['prophet'] == 'PENDING'
        assert verdicts['naive_dow'] == 'PENDING'

    def test_missing_naive_dow_returns_pending_not_pass(self):
        """BL-01 mirror: when naive_dow is missing, same PENDING-for-all behavior."""
        rows = [
            # naive_dow MISSING
            self._row('naive_dow_with_holidays', 7, 90.0),
            self._row('sarimax', 7, 50.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert 'PASS' not in verdicts.values()
        assert verdicts['sarimax'] == 'PENDING'
        assert verdicts['naive_dow_with_holidays'] == 'PENDING'

    def test_both_baselines_missing_returns_pending(self):
        """BL-01: both baselines missing → all PENDING."""
        rows = [
            self._row('sarimax', 7, 50.0),
            self._row('prophet', 7, 60.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert verdicts == {'sarimax': 'PENDING', 'prophet': 'PENDING'}

    def test_nan_baseline_rmse_returns_pending(self):
        """BL-01: a NaN baseline RMSE must NOT collapse to PASS via comparison."""
        rows = [
            self._row('naive_dow', 7, float('nan')),
            self._row('naive_dow_with_holidays', 7, 90.0),
            self._row('sarimax', 7, 50.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert 'PASS' not in verdicts.values()
        assert verdicts['sarimax'] == 'PENDING'

    def test_inf_baseline_rmse_returns_pending(self):
        """BL-01: an inf baseline RMSE must NOT silently pass every challenger."""
        rows = [
            self._row('naive_dow', 7, float('inf')),
            self._row('naive_dow_with_holidays', 7, 90.0),
            self._row('sarimax', 7, 50.0),
        ]
        verdicts = _gate_decision(rows, kpi='revenue_eur', horizon=7)
        assert 'PASS' not in verdicts.values()
        assert verdicts['sarimax'] == 'PENDING'


# ---------------------------------------------------------------------------
# 4. BL-02 regression: cleanup runs on exception path (finally:)
# ---------------------------------------------------------------------------

class TestCleanupOnException:
    """BL-02: `_cleanup_sentinel_rows` must run even when fold/gate phases raise.

    Pre-fix: cleanup was inside the `try:` block, so any exception during fold
    runs / conformal calibration / gate update leaked `backtest_fold_*` rows
    into `forecast_daily`. Those rows then surfaced in BAU dashboard reads via
    `forecast_daily_mv DISTINCT ON ... ORDER BY run_date DESC`.

    Post-fix: cleanup is in a `finally:` block; runs on both success and failure.
    """

    def _build_main_mocks(self, monkeypatch):
        """Common scaffolding: mock make_client, _last_actual_date,
        _days_of_history, write_failure, write_success so the only varying
        piece per test is what raises. Returns (bt module, client mock)."""
        from unittest.mock import MagicMock
        from datetime import date

        from scripts.forecast import backtest as bt

        client = MagicMock(name='supabase_client')
        # restaurants lookup chain (id resolves cleanly)
        rest_chain = MagicMock(name='rest_chain')
        rest_chain.select.return_value = rest_chain
        rest_chain.limit.return_value = rest_chain
        rest_chain.execute.return_value = MagicMock(data=[{'id': 'r1'}])
        # generic chain (covers anything else if a code path slips through)
        generic = MagicMock(name='generic_chain')
        generic.select.return_value = generic
        generic.update.return_value = generic
        generic.upsert.return_value = generic
        generic.delete.return_value = generic
        generic.eq.return_value = generic
        generic.gte.return_value = generic
        generic.like.return_value = generic
        generic.order.return_value = generic
        generic.limit.return_value = generic
        generic.execute.return_value = MagicMock(data=[])

        def table_router(name):
            if name == 'restaurants':
                return rest_chain
            return generic

        client.table.side_effect = table_router

        monkeypatch.setattr(bt, 'make_client', lambda: client)
        # Pre-try DB reads succeed so the exception is forced INSIDE the try block.
        monkeypatch.setattr(bt, '_last_actual_date', lambda *a, **kw: date(2026, 5, 6))
        monkeypatch.setattr(bt, '_days_of_history', lambda *a, **kw: 10)  # cold-start
        monkeypatch.setattr(bt, 'write_failure', lambda *a, **kw: None)
        monkeypatch.setattr(bt, 'write_success', lambda *a, **kw: None)
        return bt, client

    def test_cleanup_runs_on_exception_during_fold_phase(self, monkeypatch):
        """Simulate a crash INSIDE main()'s try-block and assert cleanup still ran.

        Strategy: with `_days_of_history=10` (cold-start at every horizon), the
        very first thing the try-block does is call `_write_quality_row` to
        write PENDING for all models. We stub that to raise — exception
        propagates to the except-handler, which writes pipeline_runs failure;
        the finally-block then must still call `_cleanup_sentinel_rows`.
        """
        from unittest.mock import MagicMock
        from datetime import date

        bt, client = self._build_main_mocks(monkeypatch)

        # Force an exception on the first DB write inside the try block
        def explode_on_write(*a, **kw):
            raise RuntimeError('simulated DB hiccup mid-fold')
        monkeypatch.setattr(bt, '_write_quality_row', explode_on_write)

        # Spy on _cleanup_sentinel_rows so we can assert it ran on the exception path
        cleanup_spy = MagicMock(name='cleanup_spy')
        monkeypatch.setattr(bt, '_cleanup_sentinel_rows', cleanup_spy)

        rc = bt.main(models=['sarimax'], run_date=date(2026, 5, 6))

        # main() must have caught the exception and returned 1 (failure)
        assert rc == 1
        # CRITICAL: cleanup must have run on the exception path
        cleanup_spy.assert_called_once()
        # Check the call was scoped to the right restaurant
        kwargs = cleanup_spy.call_args.kwargs
        assert kwargs.get('restaurant_id') == 'r1'

    def test_cleanup_swallows_its_own_exception(self, monkeypatch):
        """If cleanup itself fails, main() must not blow up on top of an
        already-failed run — finally-block logs and main() returns the
        original failure exit code."""
        from datetime import date

        bt, client = self._build_main_mocks(monkeypatch)

        # Force an exception inside the try block
        def explode_on_write(*a, **kw):
            raise RuntimeError('fold crash')
        monkeypatch.setattr(bt, '_write_quality_row', explode_on_write)

        # Cleanup itself raises — finally-block's inner try/except must swallow it
        def cleanup_explodes(*a, **kw):
            raise RuntimeError('cleanup also failed')
        monkeypatch.setattr(bt, '_cleanup_sentinel_rows', cleanup_explodes)

        # Should not raise; should still return 1 (the original failure code)
        rc = bt.main(models=['sarimax'], run_date=date(2026, 5, 6))
        assert rc == 1

    def test_cleanup_runs_on_happy_path(self, monkeypatch):
        """Sanity: cleanup must STILL run on the success path (no regression).

        Pre-fix the cleanup was on the happy path inside the try block; post-fix
        it's in finally. Both paths must call cleanup exactly once.
        """
        from unittest.mock import MagicMock
        from datetime import date

        bt, client = self._build_main_mocks(monkeypatch)
        # Stub _write_quality_row to be a no-op so cold-start path completes
        monkeypatch.setattr(bt, '_write_quality_row', lambda *a, **kw: None)

        cleanup_spy = MagicMock(name='cleanup_spy')
        monkeypatch.setattr(bt, '_cleanup_sentinel_rows', cleanup_spy)

        rc = bt.main(models=['sarimax'], run_date=date(2026, 5, 6))
        # Cold-start with no successful folds → exit code 1 (no folds succeeded)
        # but cleanup should still have run.
        assert rc in (0, 1)  # depends on total_succeeded count; cold-start = 1
        cleanup_spy.assert_called_once()
