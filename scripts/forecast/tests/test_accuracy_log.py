"""Phase 17 BCK-07: tests for write_accuracy_log.py rendering + honest-failure copy."""
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

from scripts.forecast.write_accuracy_log import (  # noqa: E402
    HONEST_FAILURE_NO_CHALLENGER,
    _group_for_render, _pick_honest_failure_line, _render_latest_run,
)


def test_honest_failure_canonical_string():
    """The exact em-dash + 'no challenger' copy must match BCK-07 spec."""
    expected = (
        '> naive-DoW-with-holidays remains production model — '
        'no challenger promoted this week.'
    )
    assert HONEST_FAILURE_NO_CHALLENGER == expected


def test_pick_honest_failure_when_all_challengers_fail():
    rendered = {
        'naive_dow': {'verdict': 'baseline'},
        'naive_dow_with_holidays': {'verdict': 'baseline'},
        'sarimax': {'verdict': 'FAIL (h=7)'},
        'prophet': {'verdict': 'FAIL (h=35)'},
    }
    assert _pick_honest_failure_line(rendered) == HONEST_FAILURE_NO_CHALLENGER


def test_pick_honest_failure_when_one_challenger_passes():
    rendered = {
        'naive_dow': {'verdict': 'baseline'},
        'sarimax': {'verdict': 'PASS'},
    }
    line = _pick_honest_failure_line(rendered)
    assert 'sarimax promoted' in line
    assert 'PASS' in line


def test_group_for_render_filters_by_kpi():
    rows = [
        {'kpi_name': 'revenue_eur', 'model_name': 'sarimax', 'horizon_days': 7,
         'rmse': 100.0, 'gate_verdict': 'PASS'},
        {'kpi_name': 'invoice_count', 'model_name': 'sarimax', 'horizon_days': 7,
         'rmse': 999.0, 'gate_verdict': 'PASS'},   # ignored — non-revenue
    ]
    rendered = _group_for_render(rows)
    assert 'sarimax' in rendered
    # Cell formatted from revenue_eur RMSE only
    assert 'RMSE 100' in rendered['sarimax']['h7']


def test_render_includes_qhat_line():
    rendered = {
        'naive_dow': {'h7': 'RMSE 100', 'h35': 'RMSE 200', 'h120': 'PENDING', 'h365': 'PENDING', 'verdict': 'baseline'},
    }
    md = _render_latest_run(rendered, '2026-05-12 23:00 UTC', qhat=156.0)
    assert 'qhat_95 = 156 EUR' in md
    assert 'naive_dow' in md


def test_render_orders_baselines_first():
    rendered = {
        'sarimax':  {'h7': 'RMSE 50', 'h35': 'RMSE 60', 'h120': 'PENDING', 'h365': 'PENDING', 'verdict': 'PASS'},
        'naive_dow': {'h7': 'RMSE 100', 'h35': 'RMSE 200', 'h120': 'PENDING', 'h365': 'PENDING', 'verdict': 'baseline'},
    }
    md = _render_latest_run(rendered, '2026-05-12', qhat=0.0)
    # Check ordering within the table rows section only (after the header row separator)
    table_section = md.split('|---|---|---|---|---|---|', 1)[-1]
    naive_idx = table_section.find('naive_dow')
    sarimax_idx = table_section.find('sarimax')
    assert naive_idx < sarimax_idx, 'baselines must render first per stable ordering'
