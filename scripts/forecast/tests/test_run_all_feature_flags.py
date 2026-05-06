"""Phase 17 BCK-04: tests for run_all.py feature_flags integration.

Mocks supabase to assert the bulk query shape and verify:
  - returned list contains only bare model names (no 'model_' prefix)
  - disabled rows are excluded
  - .like('flag_key', 'model_%') filter present in the chain
"""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock

import pytest

# Stub the supabase package BEFORE run_all is imported.
# scripts.forecast.db does `from supabase import create_client, Client` at
# import time. If the real supabase package isn't installed (true in some
# local envs and CI), the import explodes. The stub satisfies the import;
# we never call into either symbol — make_client is not called by the helper.
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None  # never called
    _supabase_stub.Client = type('Client', (), {})  # type-hint only
    sys.modules['supabase'] = _supabase_stub

from scripts.forecast.run_all import _get_enabled_models  # noqa: E402


def _mock_client_returning(rows):
    """Build a MagicMock supabase client that returns the given rows from a feature_flags chain."""
    client = MagicMock(name='client')
    chain = MagicMock(name='chain')
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.like.return_value = chain
    response = MagicMock()
    response.data = rows
    chain.execute.return_value = response
    client.table.return_value = chain
    return client, chain


def test_returns_bare_names_for_enabled():
    """Enabled rows return bare model names without 'model_' prefix."""
    rows = [
        {'flag_key': 'model_sarimax', 'enabled': True},
        {'flag_key': 'model_prophet', 'enabled': True},
        {'flag_key': 'model_naive_dow', 'enabled': False},
    ]
    client, _ = _mock_client_returning(rows)
    result = _get_enabled_models(client, 'r1')
    assert set(result) == {'sarimax', 'prophet'}


def test_empty_when_no_rows():
    """No rows in feature_flags -> empty list returned."""
    client, _ = _mock_client_returning([])
    assert _get_enabled_models(client, 'r1') == []


def test_excludes_all_disabled():
    """All rows disabled -> empty list (no models enabled)."""
    rows = [
        {'flag_key': 'model_sarimax', 'enabled': False},
        {'flag_key': 'model_prophet', 'enabled': False},
    ]
    client, _ = _mock_client_returning(rows)
    assert _get_enabled_models(client, 'r1') == []


def test_query_uses_like_filter():
    """Defensive: the .like('flag_key', 'model_%') filter must be in the chain so
    non-model flags (e.g. offweek_reminder) never leak into the enabled list."""
    rows = [{'flag_key': 'model_sarimax', 'enabled': True}]
    client, chain = _mock_client_returning(rows)
    _get_enabled_models(client, 'r1')
    chain.like.assert_called_once()
    like_call = chain.like.call_args
    assert like_call.args[0] == 'flag_key'
    assert like_call.args[1].startswith('model_')


def test_query_uses_restaurant_id_filter():
    """RLS-defense-in-depth: explicit eq('restaurant_id', ...) prevents cross-tenant
    flag leaks if RLS policies are loosened in the future."""
    rows = [{'flag_key': 'model_sarimax', 'enabled': True}]
    client, chain = _mock_client_returning(rows)
    _get_enabled_models(client, 'r1')
    eq_calls = chain.eq.call_args_list
    assert any(c.args == ('restaurant_id', 'r1') for c in eq_calls), (
        'Expected .eq("restaurant_id", "r1") in chain'
    )


def test_data_none_returns_empty():
    """Defensive: resp.data is None (not just empty list) -> still returns []."""
    client = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.like.return_value = chain
    response = MagicMock()
    response.data = None
    chain.execute.return_value = response
    client.table.return_value = chain
    assert _get_enabled_models(client, 'r1') == []
