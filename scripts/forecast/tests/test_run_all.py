"""Tests for the forecast orchestrator (run_all.py)."""
from __future__ import annotations

import os
import pytest
from unittest.mock import MagicMock, patch


class TestGetEnabledModels:
    """Unit tests for get_enabled_models()."""

    def test_get_enabled_models_from_env(self, monkeypatch):
        """FORECAST_ENABLED_MODELS env var overrides defaults."""
        monkeypatch.setenv('FORECAST_ENABLED_MODELS', 'sarimax,prophet')
        from scripts.forecast.run_all import get_enabled_models
        result = get_enabled_models()
        assert result == ['sarimax', 'prophet']

    def test_get_enabled_models_default(self, monkeypatch):
        """No env var returns all 5 default models."""
        monkeypatch.delenv('FORECAST_ENABLED_MODELS', raising=False)
        from scripts.forecast.run_all import get_enabled_models
        result = get_enabled_models()
        assert result == ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']

    def test_get_enabled_models_override_arg(self, monkeypatch):
        """Explicit override argument takes precedence over env var."""
        monkeypatch.setenv('FORECAST_ENABLED_MODELS', 'ets,theta')
        from scripts.forecast.run_all import get_enabled_models
        result = get_enabled_models(override='sarimax')
        assert result == ['sarimax']

    def test_get_enabled_models_strips_whitespace(self, monkeypatch):
        """Whitespace around model names is stripped."""
        monkeypatch.setenv('FORECAST_ENABLED_MODELS', ' sarimax , prophet ')
        from scripts.forecast.run_all import get_enabled_models
        result = get_enabled_models()
        assert result == ['sarimax', 'prophet']

    def test_get_enabled_models_empty_string_uses_default(self, monkeypatch):
        """Empty override string falls through to env, then defaults."""
        monkeypatch.delenv('FORECAST_ENABLED_MODELS', raising=False)
        from scripts.forecast.run_all import get_enabled_models
        result = get_enabled_models(override='')
        assert result == ['sarimax', 'prophet', 'ets', 'theta', 'naive_dow']


class TestFetchHistory:
    """Unit tests for _fetch_history()."""

    def test_fetch_revenue_divides_by_100(self):
        """revenue_eur KPI reads revenue_cents and divides by 100."""
        from scripts.forecast.run_all import _fetch_history

        client = MagicMock()
        # Mock the chained call: .table().select().eq().order().execute()
        mock_resp = MagicMock()
        mock_resp.data = [
            {'business_date': '2026-01-01', 'revenue_cents': 100000},
            {'business_date': '2026-01-02', 'revenue_cents': 120000},
        ]
        (client.table.return_value
         .select.return_value
         .eq.return_value
         .order.return_value
         .execute.return_value) = mock_resp

        series = _fetch_history(client, 'rest-1', 'revenue_eur')
        assert len(series) == 2
        assert series.iloc[0] == pytest.approx(1000.0)
        assert series.iloc[1] == pytest.approx(1200.0)

    def test_fetch_invoice_count_as_is(self):
        """invoice_count KPI reads tx_count directly (no division)."""
        from scripts.forecast.run_all import _fetch_history

        client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.data = [
            {'business_date': '2026-01-01', 'tx_count': 42},
            {'business_date': '2026-01-02', 'tx_count': 55},
        ]
        (client.table.return_value
         .select.return_value
         .eq.return_value
         .order.return_value
         .execute.return_value) = mock_resp

        series = _fetch_history(client, 'rest-1', 'invoice_count')
        assert len(series) == 2
        assert series.iloc[0] == 42
        assert series.iloc[1] == 55

    def test_fetch_unknown_kpi_raises(self):
        """Unknown KPI name raises ValueError."""
        from scripts.forecast.run_all import _fetch_history
        client = MagicMock()
        with pytest.raises(ValueError, match='Unknown kpi_name'):
            _fetch_history(client, 'rest-1', 'nonexistent_kpi')


class TestMainExitCodes:
    """Integration-level tests for main() exit codes."""

    @patch('scripts.forecast.run_all._run_model')
    @patch('scripts.forecast.run_all._fetch_history')
    @patch('scripts.forecast.run_all._get_restaurant_id')
    @patch('scripts.forecast.run_all.db.make_client')
    @patch('scripts.forecast.run_all.evaluate_last_7')
    def test_returns_0_on_partial_success(
        self, mock_eval, mock_client, mock_rid, mock_fetch, mock_run
    ):
        """main() returns 0 if at least one model succeeds."""
        import pandas as pd
        from scripts.forecast.run_all import main

        mock_client.return_value = MagicMock()
        mock_rid.return_value = 'rest-1'
        mock_fetch.return_value = pd.Series([100, 200], name='test')
        # First call succeeds, second fails
        mock_run.side_effect = [42, Exception('boom')] * 5  # enough for 2 KPIs x N models
        mock_eval.return_value = []

        result = main(models=['sarimax'], run_date='2026-04-29')
        assert result == 0

    @patch('scripts.forecast.run_all._run_model')
    @patch('scripts.forecast.run_all._fetch_history')
    @patch('scripts.forecast.run_all._get_restaurant_id')
    @patch('scripts.forecast.run_all.db.make_client')
    @patch('scripts.forecast.run_all.evaluate_last_7')
    def test_returns_1_on_all_failures(
        self, mock_eval, mock_client, mock_rid, mock_fetch, mock_run
    ):
        """main() returns 1 if every model fails."""
        import pandas as pd
        from scripts.forecast.run_all import main

        mock_client.return_value = MagicMock()
        mock_rid.return_value = 'rest-1'
        mock_fetch.return_value = pd.Series([100, 200], name='test')
        mock_run.side_effect = Exception('all fail')
        mock_eval.return_value = []

        result = main(models=['sarimax'], run_date='2026-04-29')
        assert result == 1
