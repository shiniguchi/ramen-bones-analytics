"""Phase 17 BCK-04: tests for _apply_gate_to_feature_flags.

Mocks supabase client and asserts the feature_flags.update call pattern:
  - non-baseline FAIL verdict → update called with enabled=False, flag_key='model_{name}'
  - non-baseline PASS verdict → update NOT called
  - PENDING verdict → update NOT called (gate silent until evaluable)
  - baseline models (naive_dow / naive_dow_with_holidays) → NEVER updated (R7 hard guard)
  - mixed verdicts → only FAIL non-baselines flip

These tests run offline (no DB) in <1s.
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, call

import pytest

# --- Stub supabase before importing backtest ---
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub

from scripts.forecast.backtest import _apply_gate_to_feature_flags, BASELINE_MODELS  # noqa: E402


def _build_mock_client():
    """Build a MagicMock client where table().update().eq().eq().execute() chains work."""
    client = MagicMock(name='supabase_client')
    chain = MagicMock(name='query_chain')
    chain.update.return_value = chain
    chain.eq.return_value = chain
    chain.execute.return_value = MagicMock(data=[])
    client.table.return_value = chain
    return client, chain


class TestGateBaselines:
    """R7 hard guard: baselines are never flipped, regardless of verdict."""

    def test_baseline_models_constant_contains_naive_dow(self):
        assert 'naive_dow' in BASELINE_MODELS

    def test_baseline_models_constant_contains_naive_dow_with_holidays(self):
        assert 'naive_dow_with_holidays' in BASELINE_MODELS

    def test_naive_dow_never_flipped_even_on_fail(self):
        """R7: naive_dow with FAIL verdict → no update call (impossible by gate logic; tests guard)."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={'naive_dow': 'FAIL'},
        )
        chain.update.assert_not_called()

    def test_naive_dow_with_holidays_never_flipped_even_on_fail(self):
        """R7: naive_dow_with_holidays with FAIL → no update call."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={'naive_dow_with_holidays': 'FAIL'},
        )
        chain.update.assert_not_called()

    def test_both_baselines_fail_no_update(self):
        """Both baselines FAIL → zero update calls."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={
                'naive_dow': 'FAIL',
                'naive_dow_with_holidays': 'FAIL',
            },
        )
        chain.update.assert_not_called()


class TestGateNonBaseline:
    """Non-baseline models are flipped on FAIL only."""

    def test_failing_model_flips_enabled_false(self):
        """sarimax FAIL → update called with enabled=False and flag_key='model_sarimax'."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={'sarimax': 'FAIL'},
        )
        chain.update.assert_called_once()
        update_payload = chain.update.call_args.args[0]
        assert update_payload['enabled'] is False
        # Verify flag_key='model_sarimax' was passed to eq()
        eq_calls = chain.eq.call_args_list
        flag_key_calls = [c for c in eq_calls if c.args[0] == 'flag_key']
        assert any(c.args[1] == 'model_sarimax' for c in flag_key_calls)

    def test_passing_model_does_not_flip(self):
        """sarimax PASS → no update call."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={'sarimax': 'PASS'},
        )
        chain.update.assert_not_called()

    def test_pending_model_does_not_flip(self):
        """PENDING aggregate → no flip (gate silent until evaluable)."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={'prophet': 'PENDING'},
        )
        chain.update.assert_not_called()

    def test_uncalibrated_model_does_not_flip(self):
        """UNCALIBRATED aggregate → no flip."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={'ets': 'UNCALIBRATED'},
        )
        chain.update.assert_not_called()

    def test_multiple_failing_models_all_flip(self):
        """sarimax + ets both FAIL → exactly 2 update calls."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={
                'sarimax': 'FAIL',
                'ets': 'FAIL',
            },
        )
        assert chain.update.call_count == 2


class TestGateMixed:
    """Mixed verdict scenarios."""

    def test_mixed_only_failing_non_baselines_flipped(self):
        """sarimax FAIL + prophet PASS + naive_dow FAIL + theta PENDING + ets FAIL.

        Expected: 2 update calls (sarimax + ets). prophet (PASS) and theta (PENDING)
        not flipped. naive_dow (baseline) never flipped.
        """
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={
                'sarimax': 'FAIL',
                'prophet': 'PASS',
                'naive_dow': 'FAIL',        # baseline: guard skips
                'theta': 'PENDING',
                'ets': 'FAIL',
            },
        )
        # Only sarimax + ets are non-baseline FAIL
        assert chain.update.call_count == 2

    def test_all_pass_no_flips(self):
        """All non-baseline models PASS → zero update calls."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='r1',
            model_aggregate_verdicts={
                'sarimax': 'PASS',
                'prophet': 'PASS',
                'ets': 'PASS',
                'theta': 'PASS',
                'naive_dow': 'PASS',
                'naive_dow_with_holidays': 'PASS',
            },
        )
        chain.update.assert_not_called()

    def test_restaurant_id_passed_to_eq(self):
        """The restaurant_id filter is applied in the update chain."""
        client, chain = _build_mock_client()
        _apply_gate_to_feature_flags(
            client,
            restaurant_id='tenant-xyz',
            model_aggregate_verdicts={'theta': 'FAIL'},
        )
        eq_calls = chain.eq.call_args_list
        rid_calls = [c for c in eq_calls if c.args[0] == 'restaurant_id']
        assert any(c.args[1] == 'tenant-xyz' for c in rid_calls)
