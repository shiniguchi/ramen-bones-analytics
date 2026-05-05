"""Phase 16 Plan 05: tests for scripts/forecast/counterfactual_fit.py.

Critical invariants (mitigates T-16-03):
  - get_train_end returns earliest_campaign_start + train_end_offset
  - Every Track-B fit receives train_end strictly < min(campaign_start)
  - All 5 models x 2 CF KPIs spawn (10 fit_one_model calls)
  - kpi_name is always in {'revenue_comparable_eur', 'invoice_count'} —
    NEVER 'revenue_eur' (Guard 9 / D-04)

Mocking pattern mirrors scripts/forecast/tests/test_run_all_grain_loop.py:
stub the supabase package before importing counterfactual_fit, then build
MagicMock chains for each table/select/eq/order/limit query.
"""
from __future__ import annotations

import sys
import types
from datetime import date
from unittest.mock import MagicMock, patch

import pytest


# ---- Stub the supabase package BEFORE counterfactual_fit is imported.
# scripts.forecast.db does `from supabase import create_client, Client` at
# import time; pipeline_runs_writer does `from supabase import Client`.
# Same pattern as test_run_all_grain_loop.py.
if 'supabase' not in sys.modules:
    _supabase_stub = types.ModuleType('supabase')
    _supabase_stub.create_client = lambda *a, **kw: None
    _supabase_stub.Client = type('Client', (), {})
    sys.modules['supabase'] = _supabase_stub


def _make_response(*, data=None):
    resp = types.SimpleNamespace()
    resp.data = data if data is not None else []
    return resp


def _build_mock_client(*, campaign_start_iso: str = '2026-04-14'):
    """Mock a supabase client returning a single campaign_calendar row.

    By default returns one campaign at 2026-04-14 — the v1 friend-owner
    campaign per CONTEXT.md specifics.
    """
    client = MagicMock(name='supabase_client')

    campaign_chain = MagicMock()
    campaign_chain.select.return_value = campaign_chain
    campaign_chain.eq.return_value = campaign_chain
    campaign_chain.order.return_value = campaign_chain
    campaign_chain.limit.return_value = campaign_chain
    campaign_chain.execute.return_value = _make_response(
        data=[{'start_date': campaign_start_iso}]
    )

    pipeline_runs_chain = MagicMock()
    pipeline_runs_chain.insert.return_value = pipeline_runs_chain
    pipeline_runs_chain.execute.return_value = _make_response(data=[])

    def table_router(name):
        if name == 'campaign_calendar':
            return campaign_chain
        if name == 'pipeline_runs':
            return pipeline_runs_chain
        catchall = MagicMock()
        for m in ('select', 'eq', 'gte', 'lte', 'order', 'limit', 'insert', 'upsert', 'update'):
            getattr(catchall, m).return_value = catchall
        catchall.execute.return_value = _make_response(data=[])
        return catchall

    client.table.side_effect = table_router
    return client


def _build_empty_campaign_client():
    """Mock a client whose campaign_calendar select returns empty data."""
    client = MagicMock(name='supabase_client_no_campaign')
    campaign_chain = MagicMock()
    campaign_chain.select.return_value = campaign_chain
    campaign_chain.eq.return_value = campaign_chain
    campaign_chain.order.return_value = campaign_chain
    campaign_chain.limit.return_value = campaign_chain
    campaign_chain.execute.return_value = _make_response(data=[])

    def table_router(name):
        if name == 'campaign_calendar':
            return campaign_chain
        catchall = MagicMock()
        for m in ('select', 'eq', 'gte', 'lte', 'order', 'limit', 'insert', 'upsert', 'update'):
            getattr(catchall, m).return_value = catchall
        catchall.execute.return_value = _make_response(data=[])
        return catchall

    client.table.side_effect = table_router
    return client


def test_get_train_end_subtracts_default_seven_days():
    """get_train_end returns min(campaign_start) - 7 days by default."""
    from scripts.forecast.counterfactual_fit import get_train_end
    client = _build_mock_client(campaign_start_iso='2026-04-14')
    train_end = get_train_end(client, 'rest-1', train_end_offset=-7)
    assert train_end == date(2026, 4, 7), f'expected 2026-04-07, got {train_end}'


def test_get_train_end_returns_none_when_no_campaign():
    """get_train_end returns None when campaign_calendar has no rows."""
    from scripts.forecast.counterfactual_fit import get_train_end
    client = _build_empty_campaign_client()
    assert get_train_end(client, 'rest-1', -7) is None


def test_no_campaign_era_leak():
    """T-16-03: every fit_one_model call must use train_end < min(campaign_start).

    Asserts the CI invariant: no Track-B fit ever sees data on or after
    the earliest campaign_calendar.start_date.
    """
    from scripts.forecast import counterfactual_fit
    client = _build_mock_client(campaign_start_iso='2026-04-14')

    captured = []

    def _fake_fit_one_model(*, client, model, restaurant_id, kpi_name, run_date, train_end):
        captured.append({
            'model': model,
            'kpi_name': kpi_name,
            'train_end': train_end,
        })
        return 90  # nominal row count

    # We don't pass `client=` positionally in fit_one_model — main_cf calls it
    # as fit_one_model(client, model=..., ...). Adapt the side_effect accordingly.
    def _side_effect(client_arg, **kwargs):
        captured.append({
            'model': kwargs['model'],
            'kpi_name': kwargs['kpi_name'],
            'train_end': kwargs['train_end'],
        })
        return 90

    with patch('scripts.forecast.counterfactual_fit.fit_one_model', side_effect=_side_effect):
        result = counterfactual_fit.main_cf(
            client=client,
            restaurant_id='rest-1',
            models=None,  # → defaults to all 5
            run_date=date(2026, 5, 1),
            train_end_offset=-7,
        )

    assert result['attempted'] == 10  # 5 models × 2 KPIs
    assert result['succeeded'] == 10
    assert len(captured) == 10

    earliest_campaign = date(2026, 4, 14)
    for call in captured:
        assert call['train_end'] < earliest_campaign, (
            f"T-16-03 LEAK: train_end={call['train_end']} not strictly < "
            f"min(campaign_start)={earliest_campaign} for {call['model']}/{call['kpi_name']}"
        )
        # Default offset is -7, so every train_end must equal 2026-04-07.
        assert call['train_end'] == date(2026, 4, 7)


def test_all_models_write_cf():
    """5 BAU models x 2 CF KPIs = 10 fit_one_model calls; kpi_name guard.

    Asserts kpi_name is always in {'revenue_comparable_eur', 'invoice_count'} —
    NEVER 'revenue_eur' (Guard 9 / D-04).
    """
    from scripts.forecast import counterfactual_fit
    client = _build_mock_client(campaign_start_iso='2026-04-14')

    captured = []

    def _side_effect(client_arg, **kwargs):
        captured.append({
            'model': kwargs['model'],
            'kpi_name': kwargs['kpi_name'],
            'train_end': kwargs['train_end'],
        })
        return 90

    with patch('scripts.forecast.counterfactual_fit.fit_one_model', side_effect=_side_effect):
        counterfactual_fit.main_cf(
            client=client,
            restaurant_id='rest-1',
            models=None,
            run_date=date(2026, 5, 1),
            train_end_offset=-7,
        )

    # All 10 (model, kpi) pairs covered.
    pairs = sorted({(c['model'], c['kpi_name']) for c in captured})
    expected_pairs = sorted([
        (m, k)
        for m in ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']
        for k in ['revenue_comparable_eur', 'invoice_count']
    ])
    assert pairs == expected_pairs, f'unexpected (model,kpi) pairs: {pairs}'

    # Guard 9: kpi_name must NEVER be 'revenue_eur' on a CF fit.
    seen_kpis = {c['kpi_name'] for c in captured}
    assert 'revenue_eur' not in seen_kpis
    assert seen_kpis == {'revenue_comparable_eur', 'invoice_count'}

    # All train_end values should be the same default cutoff.
    train_ends = {c['train_end'] for c in captured}
    assert train_ends == {date(2026, 4, 7)}


def test_cf_skipped_when_no_campaign():
    """No campaign_calendar rows → main_cf returns 0/0 and prints 'No campaign_calendar'."""
    from scripts.forecast import counterfactual_fit
    client = _build_empty_campaign_client()

    with patch('scripts.forecast.counterfactual_fit.fit_one_model') as mock_fit:
        result = counterfactual_fit.main_cf(
            client=client,
            restaurant_id='rest-1',
            models=None,
            run_date=date(2026, 5, 1),
            train_end_offset=-7,
        )

    assert result == {'attempted': 0, 'succeeded': 0}
    assert mock_fit.call_count == 0


def test_partial_failure_resilience():
    """If one model raises, the others still run; failed model gets write_failure
    with fit_train_end populated. attempted==10, succeeded==8 (4 of 5 × 2 KPIs).
    """
    from scripts.forecast import counterfactual_fit
    client = _build_mock_client(campaign_start_iso='2026-04-14')

    failure_calls = []

    def _capture_failure(client_arg, **kwargs):
        failure_calls.append(kwargs)

    def _selective_fit(client_arg, **kwargs):
        if kwargs['model'] == 'prophet':
            raise RuntimeError('synthetic prophet failure')
        return 90

    with patch('scripts.forecast.counterfactual_fit.fit_one_model', side_effect=_selective_fit), \
         patch('scripts.forecast.counterfactual_fit.write_success') as mock_success, \
         patch(
            'scripts.forecast.counterfactual_fit.write_failure',
            side_effect=_capture_failure,
         ):
        result = counterfactual_fit.main_cf(
            client=client,
            restaurant_id='rest-1',
            models=None,
            run_date=date(2026, 5, 1),
            train_end_offset=-7,
        )

    assert result['attempted'] == 10
    assert result['succeeded'] == 8  # prophet x 2 KPIs failed
    # write_failure called exactly twice with step_name='cf_prophet'
    assert len(failure_calls) == 2
    for kwargs in failure_calls:
        assert kwargs['step_name'] == 'cf_prophet'
        assert kwargs['fit_train_end'] == date(2026, 4, 7)
    # write_success called 8 times (the 4 surviving models × 2 KPIs)
    assert mock_success.call_count == 8
