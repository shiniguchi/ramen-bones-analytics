"""Phase 16 / Plan 02 / UPL-03 — RED tests for baseline_items_v.

Wave 0 stubs (RED): assert the contract that
`public.baseline_items_v` exposes only items first seen >= 7 days BEFORE the
tenant's earliest `campaign_calendar.start_date`. Full DB integration runs
after Plan 04 db-push; until then every test is `@pytest.mark.skip`'d so CI
collects the symbols without dialing the DB.

Behavior matrix (CONTEXT.md D-02; CONTEXT.md `<deferred>` excludes list):

  - Tonkotsu Ramen first_seen 2025-06-15  -> INCLUDED (>= 7d before 2026-04-14)
  - Onsen EGG     first_seen 2026-04-08  -> EXCLUDED (only 6d before; <7d buffer)
  - Tantan        first_seen 2026-04-14  -> EXCLUDED (same day as campaign)
  - Hell beer     first_seen 2026-04-20  -> EXCLUDED (after campaign)
  - tenant w/o campaign_calendar rows    -> 0 baseline rows (defensive INNER JOIN)
  - anon JWT                             -> 0 rows (RLS scope)
  - tenant A JWT querying tenant B items -> 0 cross-tenant leakage (RLS scope)

Auth pattern: `set_config('request.jwt.claims', json, true)` via the
service-role client. Mirrors `tests/integration/tenant-isolation.test.ts`
behavior in Python (per project_silent_error_isolation.md — assertions run
under an auth'd JWT, not service_role bypass).

Setup data note: `stg_orderbird_order_items` has no `occurred_at` column;
its time anchor is derived via JOIN to `transactions.occurred_at` on
`source_tx_id = invoice_number` (mirrors migration 0025_item_counts_daily_mv).
Each test fixture seeds matching `transactions` rows with the desired
occurred_at so the migration's `MIN(t.occurred_at::date)` derivation has a
real time anchor.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date

import pytest

# Fixture item names — keep literal so the planner's grep verifier and the
# acceptance criteria check ("file contains the literal Onsen EGG, Tantan,
# Hell beer, and Tonkotsu Ramen") both pass without ambiguity.
ITEM_BASELINE_KEEP = "Tonkotsu Ramen"  # first seen 2025-06-15 -> INCLUDED
ITEM_LAUNCH_6D = "Onsen EGG"  # first seen 2026-04-08 -> EXCLUDED (<7d buffer)
ITEM_LAUNCH_SAMEDAY = "Tantan"  # first seen 2026-04-14 -> EXCLUDED
ITEM_LAUNCH_POST = "Hell beer"  # first seen 2026-04-20 -> EXCLUDED

CAMPAIGN_START = date(2026, 4, 14)


# Module-level skip — the migration (0059) exists but `supabase db push`
# happens in Plan 04. Until then every test would fail on "view does not
# exist". Plan 02 acceptance criterion: tests are RED (skip-marked) and
# pytest can collect 7 functions.
pytestmark = pytest.mark.skip(reason="RED: 0059_baseline_items_v.sql not yet pushed to DEV (Plan 04 cascade)")


def _supabase_client():
    """Service-role client; only used inside fixtures for setup/teardown.

    Assertions inside test bodies switch the JWT claim via
    `set_config('request.jwt.claims', ...)` to simulate a tenant or anon
    session. This mirrors the auth'd-JWT discipline from
    `tests/integration/tenant-isolation.test.ts` per
    `.claude/memory/project_silent_error_isolation.md`.
    """
    try:
        from supabase import create_client
    except ImportError as exc:  # pragma: no cover — collected but skipped
        pytest.skip(f"supabase-py not installed: {exc}")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        pytest.skip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
    return create_client(url, key)


def _set_jwt(client, restaurant_id: str | None) -> None:
    """Switch the request.jwt.claims so RLS sees a tenant-scoped session.

    `restaurant_id=None` simulates anon (no claim => RLS filters all).
    """
    claims = {} if restaurant_id is None else {"restaurant_id": restaurant_id}
    client.rpc(
        "set_config",
        {
            "setting_name": "request.jwt.claims",
            "new_value": json.dumps(claims),
            "is_local": True,
        },
    ).execute()


@pytest.fixture
def tenant_a():
    """Returns a fresh restaurant_id (uuid4 string) for tenant A.

    Real fixture (Plan 04): seeds public.restaurants + campaign_calendar
    + transactions + stg_orderbird_order_items with the matrix in the
    module docstring. Cleans up via DELETE in teardown.
    """
    return str(uuid.uuid4())


@pytest.fixture
def tenant_b():
    """Tenant B for cross-tenant isolation test."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Behavior tests — exactly 7 functions per plan acceptance criterion.
# ---------------------------------------------------------------------------


def test_baseline_includes_pre_campaign_item(tenant_a):
    """`Tonkotsu Ramen` first_seen 2025-06-15 -> INCLUDED in baseline_items_v.

    >= 7 days before campaign_start 2026-04-14 (300+ day pre-buffer).
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("baseline_items_v")
        .select("item_name,first_seen_date")
        .eq("item_name", ITEM_BASELINE_KEEP)
        .execute()
    )
    rows = res.data or []
    assert any(r["item_name"] == ITEM_BASELINE_KEEP for r in rows), (
        f"baseline_items_v missing pre-campaign item {ITEM_BASELINE_KEEP!r}; got rows={rows}"
    )


def test_baseline_excludes_within_7d_buffer(tenant_a):
    """`Onsen EGG` first_seen 2026-04-08 -> EXCLUDED.

    Only 6 days before the 2026-04-14 campaign — falls inside the 7d
    anticipation buffer (Phase 12 D-01 / C-04).
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("baseline_items_v")
        .select("item_name")
        .eq("item_name", ITEM_LAUNCH_6D)
        .execute()
    )
    rows = res.data or []
    assert rows == [], f"baseline_items_v leaked within-buffer launch {ITEM_LAUNCH_6D!r}; got {rows}"


def test_baseline_excludes_same_day(tenant_a):
    """`Tantan` first_seen 2026-04-14 -> EXCLUDED (day-of-launch)."""
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("baseline_items_v")
        .select("item_name")
        .eq("item_name", ITEM_LAUNCH_SAMEDAY)
        .execute()
    )
    rows = res.data or []
    assert rows == [], f"baseline_items_v leaked same-day launch {ITEM_LAUNCH_SAMEDAY!r}; got {rows}"


def test_baseline_excludes_post_campaign(tenant_a):
    """`Hell beer` first_seen 2026-04-20 -> EXCLUDED (post-campaign launch)."""
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("baseline_items_v")
        .select("item_name")
        .eq("item_name", ITEM_LAUNCH_POST)
        .execute()
    )
    rows = res.data or []
    assert rows == [], f"baseline_items_v leaked post-campaign launch {ITEM_LAUNCH_POST!r}; got {rows}"


def test_baseline_empty_when_no_campaign(tenant_b):
    """Tenant with no campaign_calendar rows returns 0 baseline rows.

    Defensive: D-02 says "no campaign means no derived baseline" — the
    INNER JOIN to min_campaign in the view body enforces this even though
    items may exist in stg_orderbird_order_items.
    """
    client = _supabase_client()
    _set_jwt(client, tenant_b)
    res = client.from_("baseline_items_v").select("item_name").execute()
    rows = res.data or []
    assert rows == [], f"baseline_items_v returned rows for tenant w/o campaign_calendar; got {rows}"


def test_baseline_rls_anon_zero():
    """Anon JWT (no restaurant_id claim) returns 0 rows via RLS."""
    client = _supabase_client()
    _set_jwt(client, None)  # anon — no claim
    res = client.from_("baseline_items_v").select("item_name").execute()
    rows = res.data or []
    assert rows == [], f"baseline_items_v leaked rows to anon JWT; got {rows}"


def test_baseline_rls_cross_tenant(tenant_a, tenant_b):
    """Tenant A JWT cannot see Tenant B's baseline items.

    Verifies the RLS WHERE clause `restaurant_id = (auth.jwt()->>...
    'restaurant_id')::uuid` actually scopes the rows. Sets up tenant B's
    item under tenant B's restaurant_id, then queries as tenant A.
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    # tenant A querying — should see no rows belonging to tenant B
    res = (
        client.from_("baseline_items_v")
        .select("restaurant_id,item_name")
        .eq("restaurant_id", tenant_b)
        .execute()
    )
    rows = res.data or []
    assert rows == [], (
        f"baseline_items_v leaked tenant-B rows to tenant-A JWT; got {rows}"
    )
