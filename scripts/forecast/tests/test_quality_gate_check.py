"""Phase 17 BCK-06: tests for quality_gate_check.py.

Mocks supabase to assert exit-0 vs exit-1 behavior across:
  - Empty enabled_models  -> PASS
  - Empty verdicts        -> PASS (cold-start)
  - Enabled FAIL          -> FAIL
  - Enabled PASS only     -> PASS
  - Disabled FAIL         -> PASS (don't block on disabled models)
  - Mixed verdicts (latest is FAIL on enabled model) -> FAIL
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest

if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub

from scripts.forecast.quality_gate_check import _find_enabled_failures  # noqa: E402


def _build_client(*, flags: list[dict], verdicts: list[dict]):
    """Mock supabase that routes feature_flags vs forecast_quality table calls."""
    client = MagicMock(name='client')

    def make_chain(rows):
        chain = MagicMock()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.like.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain
        resp = MagicMock(); resp.data = rows
        chain.execute.return_value = resp
        return chain

    def table_router(name):
        if name == 'feature_flags':
            return make_chain(flags)
        if name == 'forecast_quality':
            return make_chain(verdicts)
        return make_chain([])

    client.table.side_effect = table_router
    return client


def test_empty_enabled_models_returns_no_failures():
    client = _build_client(flags=[], verdicts=[])
    assert _find_enabled_failures(client) == []


def test_cold_start_no_rolling_origin_rows_returns_no_failures():
    flags = [{'flag_key': 'model_sarimax', 'enabled': True}]
    client = _build_client(flags=flags, verdicts=[])
    assert _find_enabled_failures(client) == []


def test_enabled_fail_returns_failure():
    flags = [{'flag_key': 'model_sarimax', 'enabled': True}]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 7,
         'gate_verdict': 'FAIL', 'evaluated_at': '2026-05-12T23:00:00Z'},
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    failures = _find_enabled_failures(client)
    assert failures == [('sarimax', 7, 'FAIL')]


def test_enabled_pass_returns_no_failures():
    flags = [{'flag_key': 'model_sarimax', 'enabled': True}]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 7,
         'gate_verdict': 'PASS', 'evaluated_at': '2026-05-12T23:00:00Z'},
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    assert _find_enabled_failures(client) == []


def test_disabled_fail_does_not_block():
    """A disabled model with FAIL verdict must NOT block — it's already disabled."""
    flags = [{'flag_key': 'model_sarimax', 'enabled': False}]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 7,
         'gate_verdict': 'FAIL', 'evaluated_at': '2026-05-12T23:00:00Z'},
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    assert _find_enabled_failures(client) == []


def test_pending_does_not_block():
    flags = [{'flag_key': 'model_sarimax', 'enabled': True}]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 120,
         'gate_verdict': 'PENDING', 'evaluated_at': '2026-05-12T23:00:00Z'},
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    assert _find_enabled_failures(client) == []


def test_uncalibrated_does_not_block():
    flags = [{'flag_key': 'model_sarimax', 'enabled': True}]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 365,
         'gate_verdict': 'UNCALIBRATED', 'evaluated_at': '2026-05-12T23:00:00Z'},
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    assert _find_enabled_failures(client) == []


def test_latest_verdict_wins_when_multiple_per_model_horizon():
    """If FAIL appears in older row but PASS in newer row, gate uses PASS."""
    flags = [{'flag_key': 'model_sarimax', 'enabled': True}]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 7,
         'gate_verdict': 'PASS', 'evaluated_at': '2026-05-12T23:00:00Z'},  # newer
        {'model_name': 'sarimax', 'horizon_days': 7,
         'gate_verdict': 'FAIL', 'evaluated_at': '2026-05-05T23:00:00Z'},  # older
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    assert _find_enabled_failures(client) == []


def test_multiple_enabled_models_one_fails():
    flags = [
        {'flag_key': 'model_sarimax', 'enabled': True},
        {'flag_key': 'model_prophet', 'enabled': True},
    ]
    verdicts = [
        {'model_name': 'sarimax', 'horizon_days': 7,
         'gate_verdict': 'PASS', 'evaluated_at': '2026-05-12T23:00:00Z'},
        {'model_name': 'prophet', 'horizon_days': 35,
         'gate_verdict': 'FAIL', 'evaluated_at': '2026-05-12T23:00:00Z'},
    ]
    client = _build_client(flags=flags, verdicts=verdicts)
    failures = _find_enabled_failures(client)
    assert failures == [('prophet', 35, 'FAIL')]
