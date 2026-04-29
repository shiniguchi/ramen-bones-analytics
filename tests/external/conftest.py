"""Shared pytest fixtures for tests/external/.

Provides a minimal MockSupabaseClient that captures `.table().upsert(...)`
and `.table().insert(...)` calls without needing a real Supabase. Each
fetcher's upsert() unit test inspects `client.calls` to assert the
on_conflict key + payload shape — no network, no DB, no supabase-py
import. Fast (~10ms per test) and contract-pinning.
"""
from __future__ import annotations
from typing import Any
import pytest


class _MockResult:
    """Mirrors the .error attribute the fetchers check via `getattr(res, 'error', None)`."""
    def __init__(self, error: Any = None):
        self.error = error


class _MockTable:
    def __init__(self, name: str, calls: list[dict[str, Any]]):
        self.name = name
        self.calls = calls
        self._pending: dict[str, Any] | None = None

    def upsert(self, payload: Any, *, on_conflict: str | None = None, **kwargs: Any) -> '_MockTable':
        self._pending = {
            'table': self.name, 'op': 'upsert', 'payload': payload,
            'on_conflict': on_conflict, **kwargs,
        }
        return self

    def insert(self, payload: Any, **kwargs: Any) -> '_MockTable':
        self._pending = {
            'table': self.name, 'op': 'insert', 'payload': payload, **kwargs,
        }
        return self

    def execute(self) -> _MockResult:
        if self._pending is not None:
            self.calls.append(self._pending)
            self._pending = None
        return _MockResult(error=None)


class MockSupabaseClient:
    """Records every .table(...).upsert(...).execute() chain in `self.calls`.
    Each entry: {'table': str, 'op': 'upsert'|'insert', 'payload': ..., 'on_conflict': str | None}."""
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def table(self, name: str) -> _MockTable:
        return _MockTable(name, self.calls)


@pytest.fixture
def mock_client() -> MockSupabaseClient:
    """Fresh mock per test."""
    return MockSupabaseClient()
