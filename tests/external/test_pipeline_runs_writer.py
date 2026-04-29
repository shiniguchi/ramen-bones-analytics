"""Phase 13: pipeline_runs_writer unit tests.

The writer is the single place that knows the (success | fallback | failure)
row shape. Each fetcher gets a uniform interface; tests pin the schema.
"""
from __future__ import annotations
from datetime import datetime, timezone
from unittest.mock import MagicMock
import pytest

from scripts.external.pipeline_runs_writer import (
    write_success, write_fallback, write_failure,
)


def _client_with_capture():
    """Return (mock_client, capture_list) where every insert appends to capture_list."""
    client = MagicMock()
    captured: list[dict] = []
    def insert(payload):
        captured.append(payload)
        return MagicMock(execute=MagicMock(return_value=MagicMock(error=None)))
    client.table.return_value.insert.side_effect = insert
    return client, captured


def test_write_success_shape():
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_success(
        client,
        step_name='external_weather',
        started_at=started,
        row_count=42,
        upstream_freshness_h=1.5,
        commit_sha='abc123',
    )
    assert len(captured) == 1
    row = captured[0]
    assert row['step_name'] == 'external_weather'
    assert row['status'] == 'success'
    assert row['row_count'] == 42
    assert row['upstream_freshness_h'] == 1.5
    assert row['error_msg'] is None
    assert row['commit_sha'] == 'abc123'


def test_write_fallback_carries_error_msg():
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_fallback(
        client,
        step_name='external_weather',
        started_at=started,
        error_msg='502 Bad Gateway from open-meteo; switched to brightsky',
    )
    assert captured[0]['status'] == 'fallback'
    assert 'open-meteo' in captured[0]['error_msg']
    assert captured[0]['row_count'] == 0


def test_write_failure_truncates_long_error():
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    long_err = 'X' * 5000
    write_failure(
        client,
        step_name='external_school',
        started_at=started,
        error_msg=long_err,
    )
    assert captured[0]['status'] == 'failure'
    # Truncate at 2000 chars + ellipsis (D-14 specifics).
    assert len(captured[0]['error_msg']) <= 2010
    assert captured[0]['error_msg'].endswith('...')


# REVIEW T-5: cover the writer paths that were untested.

def test_write_success_propagates_restaurant_id():
    """_run_shop_calendar passes restaurant_id through; the writer must
    forward it to the row payload (not silently drop it). Without this,
    Phase 15 freshness queries scoped by JWT would never resolve to
    shop_calendar's pipeline_runs row."""
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    rid = '11111111-1111-1111-1111-111111111111'
    write_success(
        client,
        step_name='external_shop_calendar',
        started_at=started,
        row_count=365,
        upstream_freshness_h=0.0,
        restaurant_id=rid,
    )
    assert len(captured) == 1
    assert captured[0]['restaurant_id'] == rid


def test_write_success_falls_back_to_github_sha_env(monkeypatch):
    """When commit_sha is not passed, _commit_sha() reads GITHUB_SHA. Used
    by run_all when the CI workflow exports the commit hash."""
    monkeypatch.setenv('GITHUB_SHA', 'sha123abc')
    monkeypatch.delenv('COMMIT_SHA', raising=False)
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_success(client, step_name='external_weather', started_at=started, row_count=1)
    assert captured[0]['commit_sha'] == 'sha123abc'


def test_write_success_falls_back_to_commit_sha_env_when_github_sha_absent(monkeypatch):
    """COMMIT_SHA is the local-dev fallback when GHA isn't setting GITHUB_SHA."""
    monkeypatch.delenv('GITHUB_SHA', raising=False)
    monkeypatch.setenv('COMMIT_SHA', 'localdev42')
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_success(client, step_name='external_weather', started_at=started, row_count=1)
    assert captured[0]['commit_sha'] == 'localdev42'


def test_write_success_commit_sha_is_none_when_neither_env_set(monkeypatch):
    monkeypatch.delenv('GITHUB_SHA', raising=False)
    monkeypatch.delenv('COMMIT_SHA', raising=False)
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_success(client, step_name='external_weather', started_at=started, row_count=1)
    assert captured[0]['commit_sha'] is None


def test_truncate_none_returns_none():
    """Internal helper contract: None input -> None output (no crash on .write_failure(error_msg=None))."""
    from scripts.external.pipeline_runs_writer import _truncate
    assert _truncate(None) is None


def test_truncate_short_string_passes_through_unchanged():
    """Strings <= 2000 chars must NOT be modified or get the '...' suffix."""
    from scripts.external.pipeline_runs_writer import _truncate
    short = 'ferien-api 503: Service Unavailable'
    assert _truncate(short) == short


def test_write_fallback_preserves_row_count_and_freshness():
    """REVIEW C-14 partial-success path: when a fetcher partially succeeds,
    write_fallback receives a non-zero row_count + non-None freshness. The
    writer must NOT zero them out."""
    client, captured = _client_with_capture()
    started = datetime(2026, 4, 29, 0, 0, tzinfo=timezone.utc)
    write_fallback(
        client,
        step_name='external_weather',
        started_at=started,
        error_msg='chunk 12 of 12 hit 502 (after 11 successful chunks)',
        row_count=330,
        upstream_freshness_h=12.5,
    )
    assert captured[0]['status'] == 'fallback'
    assert captured[0]['row_count'] == 330
    assert captured[0]['upstream_freshness_h'] == 12.5
