"""Phase 16 UPL-07: atomic-fire-once contract for offweek_reminder.

Mitigates T-16-02: two concurrent GHA cron runs must NOT double-fire the
offweek reminder. The contract is an atomic Postgres UPDATE on
public.feature_flags filtered by (flag_key='offweek_reminder', enabled=false,
remind_on_or_after_date<=today). Postgres serializes UPDATEs on the same row
at REPEATABLE READ; only one of two simultaneous runs sees `enabled=false`
and writes the row. The other receives 0 rows updated and skips the reminder.

GREEN pass (Plan 06 Task 3): cumulative_uplift.py now exports
check_offweek_reminder; all four tests are unskipped here.

Mocking strategy mirrors scripts/forecast/tests/test_run_all_grain_loop.py:
build a MagicMock supabase client whose
  client.table('feature_flags').update(...).eq(...).eq(...).lte(...).execute()
chain returns a configurable Mock(data=[...]) per test.
"""
from __future__ import annotations

import sys
import types
from datetime import date
from unittest.mock import MagicMock

# Stub the supabase package so the import chain in cumulative_uplift.py
# resolves on machines without supabase-py installed (mirrors
# scripts/forecast/tests/test_run_all_grain_loop.py).
if "supabase" not in sys.modules:
    _supabase_stub = types.ModuleType("supabase")
    _supabase_stub.create_client = lambda *a, **kw: None  # type: ignore[attr-defined]
    _supabase_stub.Client = type("Client", (), {})  # type: ignore[attr-defined]
    sys.modules["supabase"] = _supabase_stub


def _build_mock_client(*, update_returns_rows: int):
    """Build a supabase client mock whose feature_flags update chain returns
    `update_returns_rows` rows in `.data`.

    The chain shape matches the contract:
      client.table('feature_flags')
            .update({'enabled': True, 'updated_at': 'now()'})
            .eq('flag_key', 'offweek_reminder')
            .eq('enabled', False)
            .lte('remind_on_or_after_date', <today_iso>)
            .execute()
    """
    client = MagicMock(name="supabase_client")
    chain = MagicMock(name="feature_flags_chain")
    chain.update.return_value = chain
    chain.eq.return_value = chain
    chain.lte.return_value = chain

    response = MagicMock()
    response.data = [{"restaurant_id": "rest-1", "flag_key": "offweek_reminder"}] * update_returns_rows
    chain.execute.return_value = response

    client.table.return_value = chain
    return client, chain


def test_reminder_fires_once_when_enabled_false_and_date_reached():
    """When today >= remind_on_or_after_date and enabled=false, the atomic
    UPDATE returns 1 row and write_reminder is invoked exactly once."""
    from scripts.forecast.cumulative_uplift import check_offweek_reminder  # noqa: F401

    client, chain = _build_mock_client(update_returns_rows=1)
    write_reminder = MagicMock(name="write_reminder")

    check_offweek_reminder(
        client,
        today=date(2026, 10, 15),
        write_reminder=write_reminder,
    )

    # Assert the update chain was constructed correctly.
    client.table.assert_called_with("feature_flags")
    chain.update.assert_called_once_with({"enabled": True, "updated_at": "now()"})
    chain.eq.assert_any_call("flag_key", "offweek_reminder")
    chain.eq.assert_any_call("enabled", False)
    chain.lte.assert_called_once_with("remind_on_or_after_date", "2026-10-15")
    chain.execute.assert_called_once()

    # Reminder must fire exactly once.
    assert write_reminder.call_count == 1


def test_reminder_skip_when_already_fired():
    """When the atomic UPDATE returns 0 rows (race already lost — another
    concurrent run won the row), write_reminder is NOT called and no
    exception is raised."""
    from scripts.forecast.cumulative_uplift import check_offweek_reminder  # noqa: F401

    client, chain = _build_mock_client(update_returns_rows=0)
    write_reminder = MagicMock(name="write_reminder")

    check_offweek_reminder(
        client,
        today=date(2026, 10, 16),
        write_reminder=write_reminder,
    )

    chain.execute.assert_called_once()
    assert write_reminder.call_count == 0


def test_reminder_skip_when_date_in_future():
    """When today < remind_on_or_after_date, the UPDATE filter
    `lte('remind_on_or_after_date', today)` returns 0 rows by definition.
    write_reminder must not fire."""
    from scripts.forecast.cumulative_uplift import check_offweek_reminder  # noqa: F401

    client, chain = _build_mock_client(update_returns_rows=0)
    write_reminder = MagicMock(name="write_reminder")

    check_offweek_reminder(
        client,
        today=date(2026, 10, 14),  # one day before target
        write_reminder=write_reminder,
    )

    chain.lte.assert_called_once_with("remind_on_or_after_date", "2026-10-14")
    assert write_reminder.call_count == 0


def test_reminder_atomic_under_concurrent_runs():
    """Simulate two concurrent GHA cron runs: the first UPDATE returns 1 row
    (won the race), the second returns 0 rows (lost the race). Across both
    invocations write_reminder must be called exactly ONCE — no double-fire.

    This is the direct test of T-16-02 mitigation.
    """
    from scripts.forecast.cumulative_uplift import check_offweek_reminder  # noqa: F401

    today = date(2026, 10, 15)
    write_reminder = MagicMock(name="write_reminder")

    # Run A: wins the race — update returns 1 row.
    client_a, _ = _build_mock_client(update_returns_rows=1)
    check_offweek_reminder(client_a, today=today, write_reminder=write_reminder)

    # Run B: loses the race — update returns 0 rows.
    client_b, _ = _build_mock_client(update_returns_rows=0)
    check_offweek_reminder(client_b, today=today, write_reminder=write_reminder)

    # Exactly one fire across both runs.
    assert write_reminder.call_count == 1, (
        f"T-16-02 violated: write_reminder called {write_reminder.call_count} times "
        "across two concurrent runs. Atomic UPDATE WHERE enabled=false must "
        "ensure single-flight."
    )
