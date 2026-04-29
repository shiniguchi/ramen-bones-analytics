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
