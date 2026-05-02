"""Phase 16 / Plan 07 / UPL-04 + UPL-05 + T-16-05 — RED tests for campaign_uplift_v.

Wave 2 stubs (RED): assert the contract that:

  - `public.campaign_uplift_v` exposes per-window aggregate rows joined to
    `campaign_calendar`, with DISTINCT ON dedup keeping only the latest
    `as_of_date` per (campaign_id, model_name, window_kind).
  - `public.campaign_uplift_daily_v` exposes per-day rolling cumulative rows
    (window_kind='per_day') for the dashboard sparkline.
  - The `window_kind` CHECK forbids invalid kinds.
  - The `forecast_daily_cf_not_raw_revenue` CHECK constraint forbids
    `(forecast_track='cf', kpi_name='revenue_eur')` co-occurrence at the DB
    layer — primary T-16-05 mitigation per RESEARCH §6.

These tests are skip-marked at module level until Plan 07 Task 3 (`supabase
db push --linked`) lands migration 0062 on DEV. After that push, the
acceptance criterion is to remove the skip marker and run
`pytest tests/forecast/test_campaign_uplift_v.py -x` — all 7 tests GREEN.

Auth pattern: `set_config('request.jwt.claims', json, true)` via the
service-role client to simulate tenant or anon JWT sessions, mirroring
`tests/integration/tenant-isolation.test.ts` and the sibling
`tests/sql/test_baseline_items_v.py` discipline (assertions run under
auth'd JWT — never service_role bypass — per
.claude/memory/project_silent_error_isolation.md).

Coverage targets per the plan:
  1. test_view_returns_row_for_seeded_campaign  — end-to-end row visible
                                                   for the friend campaign
                                                   under tenant-A JWT
  2. test_view_exposes_campaign_calendar_columns — joined cc.start_date /
                                                   cc.end_date / cc.name /
                                                   cc.channel surface
  3. test_view_rls_anon_zero                    — anon JWT returns 0 rows
  4. test_view_rls_cross_tenant                 — tenant-A cannot read
                                                   tenant-B uplift rows
  5. test_db_check_constraint_blocks_cf_raw_revenue
                                                — service-role INSERT of
                                                   (cf, revenue_eur) raises
                                                   (T-16-05 primary
                                                   mitigation)
  6. test_window_kinds_constrained              — window_kind='campaign'
                                                   (invalid) raises
  7. test_view_dedups_to_latest_as_of_date      — two per-window rows in →
                                                   one row out, latest
                                                   as_of_date wins (DISTINCT
                                                   ON contract for
                                                   deterministic API
                                                   headline pick)
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timezone

import pytest


# Module-level skip — flipped to active after Plan 07 Task 3 db push.
# Remove this marker when migration 0062 is on DEV; the per-test runtime
# `pytest.skip(...)` calls inside `_supabase_client()` then handle the
# "no env vars in CI" path.
pytestmark = pytest.mark.skip(
    reason=(
        "RED: migration 0062 (campaign_uplift backing table + view + CHECK "
        "constraint) not yet on DEV. Plan 07 Task 3 lands the supabase db "
        "push; after that, remove this module-level skip and re-run."
    )
)

# Friend-owner campaign — seeded in migration 0058. Re-stated here so the
# tests are readable without cross-referencing the migration.
FRIEND_CAMPAIGN_ID = "friend-owner-2026-04-14"
CAMPAIGN_START = date(2026, 4, 14)
CAMPAIGN_END = date(2026, 4, 14)


# ---------------------------------------------------------------------------
# Auth + client helpers (mirror tests/sql/test_baseline_items_v.py).
# ---------------------------------------------------------------------------


def _supabase_client():
    """Service-role client; only used inside fixtures for setup/teardown.

    Assertions inside test bodies switch the JWT claim via
    `set_config('request.jwt.claims', ...)` to simulate a tenant or anon
    session. This mirrors the auth'd-JWT discipline from
    tests/integration/tenant-isolation.test.ts per
    .claude/memory/project_silent_error_isolation.md.
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
    """Switch request.jwt.claims so RLS sees a tenant-scoped session.

    `restaurant_id=None` simulates anon (no claim → RLS filters all rows).
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


# ---------------------------------------------------------------------------
# Fixtures.
# ---------------------------------------------------------------------------


@pytest.fixture
def friend_restaurant_id():
    """Resolve the friend's restaurant_id from the restaurants table.

    Returns the first restaurant row's id — same shape as
    cumulative_uplift._get_restaurant_id and the migration 0058 seed
    that anchors campaign_calendar.
    """
    client = _supabase_client()
    resp = client.table("restaurants").select("id").limit(1).execute()
    rows = resp.data or []
    if not rows:
        pytest.skip("No restaurants seeded — cannot run end-to-end view tests")
    return rows[0]["id"]


@pytest.fixture
def tenant_b():
    """A second tenant_id for the cross-tenant RLS test.

    Real fixture (post-push) seeds a public.restaurants row + matching
    campaign_calendar + campaign_uplift rows under this id, then queries
    as tenant A and asserts zero leakage.
    """
    return str(uuid.uuid4())


@pytest.fixture
def seeded_window_rows(friend_restaurant_id):
    """Seed two per-window aggregate rows + N per-day rows for the friend.

    Per Plan 07 acceptance criterion: invokes
    `cumulative_uplift.compute_uplift_for_window` against fixture data,
    OR (post-push smoke path) inserts directly via service_role to
    populate campaign_uplift for the friend campaign.

    Rows seeded (model='sarimax'):
      - (campaign_window, as_of_date=2026-04-14, uplift=100, n_days=1)
      - (cumulative_since_launch, as_of_date=2026-05-01, uplift=120, n_days=18)
      - per_day rows for 2026-04-14..2026-05-01

    Yields the restaurant_id; teardown DELETEs the seeded rows so the
    suite is repeatable.
    """
    client = _supabase_client()
    rows = [
        {
            "restaurant_id": friend_restaurant_id,
            "campaign_id": FRIEND_CAMPAIGN_ID,
            "model_name": "sarimax",
            "window_kind": "campaign_window",
            "cumulative_uplift_eur": 100.00,
            "ci_lower_eur": 50.00,
            "ci_upper_eur": 150.00,
            "naive_dow_uplift_eur": 90.00,
            "n_days": 1,
            "as_of_date": "2026-04-14",
        },
        {
            "restaurant_id": friend_restaurant_id,
            "campaign_id": FRIEND_CAMPAIGN_ID,
            "model_name": "sarimax",
            "window_kind": "cumulative_since_launch",
            "cumulative_uplift_eur": 120.00,
            "ci_lower_eur": 60.00,
            "ci_upper_eur": 180.00,
            "naive_dow_uplift_eur": 110.00,
            "n_days": 18,
            "as_of_date": "2026-05-01",
        },
    ]
    client.table("campaign_uplift").upsert(
        rows,
        on_conflict="restaurant_id,campaign_id,model_name,window_kind,as_of_date",
    ).execute()
    yield friend_restaurant_id
    # Teardown — service_role bypasses RLS so we can clean up our test rows.
    client.table("campaign_uplift").delete().eq(
        "restaurant_id", friend_restaurant_id
    ).eq("campaign_id", FRIEND_CAMPAIGN_ID).execute()


# ---------------------------------------------------------------------------
# Behavior tests — exactly 7 functions per plan acceptance criterion.
# ---------------------------------------------------------------------------


def test_view_returns_row_for_seeded_campaign(seeded_window_rows):
    """End-to-end smoke: seeded campaign row surfaces in campaign_uplift_v.

    Asserts one row exists with the expected
    (campaign_id, model_name, window_kind='cumulative_since_launch') tuple.
    """
    restaurant_id = seeded_window_rows
    client = _supabase_client()
    _set_jwt(client, restaurant_id)
    res = (
        client.from_("campaign_uplift_v")
        .select("campaign_id,model_name,window_kind,cumulative_uplift_eur")
        .eq("campaign_id", FRIEND_CAMPAIGN_ID)
        .eq("model_name", "sarimax")
        .eq("window_kind", "cumulative_since_launch")
        .execute()
    )
    rows = res.data or []
    assert len(rows) == 1, (
        f"campaign_uplift_v missing row for seeded friend campaign; got {rows}"
    )
    assert rows[0]["cumulative_uplift_eur"] == pytest.approx(120.00)


def test_view_exposes_campaign_calendar_columns(seeded_window_rows):
    """campaign_calendar columns are joined into the view.

    Asserts campaign_start, campaign_end, campaign_name, campaign_channel
    surface — the wrapper view INNER JOINs campaign_calendar so the API
    payload doesn't need a second roundtrip.
    """
    restaurant_id = seeded_window_rows
    client = _supabase_client()
    _set_jwt(client, restaurant_id)
    res = (
        client.from_("campaign_uplift_v")
        .select(
            "campaign_id,campaign_start,campaign_end,campaign_name,campaign_channel"
        )
        .eq("campaign_id", FRIEND_CAMPAIGN_ID)
        .eq("model_name", "sarimax")
        .eq("window_kind", "cumulative_since_launch")
        .execute()
    )
    rows = res.data or []
    assert rows, "campaign_uplift_v returned no rows for seeded campaign"
    row = rows[0]
    assert row["campaign_start"] == CAMPAIGN_START.isoformat()
    assert row["campaign_end"] == CAMPAIGN_END.isoformat()
    assert row["campaign_name"] == "First paid Instagram campaign"
    assert row["campaign_channel"] == "instagram"


def test_view_rls_anon_zero(seeded_window_rows):
    """Anon JWT (no restaurant_id claim) returns 0 rows via the view's WHERE."""
    client = _supabase_client()
    _set_jwt(client, None)  # anon — no claim
    res = client.from_("campaign_uplift_v").select("campaign_id").execute()
    rows = res.data or []
    assert rows == [], f"campaign_uplift_v leaked rows to anon JWT; got {rows}"


def test_view_rls_cross_tenant(seeded_window_rows, tenant_b):
    """Tenant A JWT cannot see Tenant B's uplift rows.

    Verifies the wrapper-view's `restaurant_id = (auth.jwt()->>...)::uuid`
    filter actually scopes rows. Tenant A queries with explicit
    .eq('restaurant_id', tenant_b) — the WHERE in the view should drop
    every row regardless of the explicit filter.
    """
    client = _supabase_client()
    # Authenticate as tenant A (the friend), then ask for tenant B rows.
    _set_jwt(client, seeded_window_rows)
    res = (
        client.from_("campaign_uplift_v")
        .select("restaurant_id,campaign_id")
        .eq("restaurant_id", tenant_b)
        .execute()
    )
    rows = res.data or []
    assert rows == [], (
        f"campaign_uplift_v leaked tenant-B rows to tenant-A JWT; got {rows}"
    )


def test_db_check_constraint_blocks_cf_raw_revenue(friend_restaurant_id):
    """T-16-05 primary mitigation: forecast_daily CHECK forbids (cf, revenue_eur).

    Service-role INSERT bypasses RLS but NOT CHECK constraints. The DB
    must reject the row at the constraint layer, mathematically airtight
    per RESEARCH §6.
    """
    client = _supabase_client()
    payload = {
        "restaurant_id": friend_restaurant_id,
        "kpi_name": "revenue_eur",
        "target_date": "2026-04-14",
        "model_name": "sarimax",
        "run_date": "2026-04-14",
        "forecast_track": "cf",
        "yhat": 100.0,
        "yhat_lower": 50.0,
        "yhat_upper": 150.0,
        "granularity": "day",
    }
    with pytest.raises(Exception) as exc_info:
        client.table("forecast_daily").insert(payload).execute()
    msg = str(exc_info.value).lower()
    assert (
        "forecast_daily_cf_not_raw_revenue" in msg
        or "check constraint" in msg
        or "violates" in msg
    ), f"Expected CHECK constraint violation; got {exc_info.value!r}"


def test_window_kinds_constrained(friend_restaurant_id):
    """campaign_uplift.window_kind CHECK rejects unknown kinds.

    Only 'campaign_window', 'cumulative_since_launch', 'per_day' are
    allowed (per migration). Inserting 'campaign' (a typo) must fail.
    """
    client = _supabase_client()
    payload = {
        "restaurant_id": friend_restaurant_id,
        "campaign_id": FRIEND_CAMPAIGN_ID,
        "model_name": "sarimax",
        "window_kind": "campaign",  # invalid — should violate CHECK
        "cumulative_uplift_eur": 0.00,
        "ci_lower_eur": 0.00,
        "ci_upper_eur": 0.00,
        "n_days": 1,
        "as_of_date": "2026-04-14",
    }
    with pytest.raises(Exception) as exc_info:
        client.table("campaign_uplift").insert(payload).execute()
    msg = str(exc_info.value).lower()
    assert (
        "check" in msg or "violates" in msg or "window_kind" in msg
    ), f"Expected CHECK constraint violation on window_kind; got {exc_info.value!r}"


def test_view_dedups_to_latest_as_of_date(friend_restaurant_id):
    """DISTINCT ON contract: two per-window rows in → one row out, latest wins.

    Plan 06 / cumulative_uplift.py upserts a fresh per-window row each
    nightly run with as_of_date=run_date (PK includes as_of_date so each
    night appends a row for audit). After N nights the backing table has
    N rows for the same (campaign, model, window_kind); the view's
    DISTINCT ON + ORDER BY as_of_date DESC must surface exactly 1 row,
    the latest. This is the determinism guarantee for Plan 08's API
    `find()` headline pick.
    """
    client = _supabase_client()
    rows = [
        {
            "restaurant_id": friend_restaurant_id,
            "campaign_id": FRIEND_CAMPAIGN_ID,
            "model_name": "sarimax",
            "window_kind": "cumulative_since_launch",
            "cumulative_uplift_eur": 100.00,
            "ci_lower_eur": 50.00,
            "ci_upper_eur": 150.00,
            "n_days": 14,
            "as_of_date": "2026-04-30",
        },
        {
            "restaurant_id": friend_restaurant_id,
            "campaign_id": FRIEND_CAMPAIGN_ID,
            "model_name": "sarimax",
            "window_kind": "cumulative_since_launch",
            "cumulative_uplift_eur": 120.00,
            "ci_lower_eur": 60.00,
            "ci_upper_eur": 180.00,
            "n_days": 15,
            "as_of_date": "2026-05-01",
        },
    ]
    client.table("campaign_uplift").upsert(
        rows,
        on_conflict="restaurant_id,campaign_id,model_name,window_kind,as_of_date",
    ).execute()

    try:
        _set_jwt(client, friend_restaurant_id)
        res = (
            client.from_("campaign_uplift_v")
            .select("cumulative_uplift_eur,as_of_date")
            .eq("campaign_id", FRIEND_CAMPAIGN_ID)
            .eq("model_name", "sarimax")
            .eq("window_kind", "cumulative_since_launch")
            .execute()
        )
        surfaced = res.data or []
        assert len(surfaced) == 1, (
            f"DISTINCT ON dedup failed — expected 1 row, got {len(surfaced)}: "
            f"{surfaced}"
        )
        assert surfaced[0]["as_of_date"] == "2026-05-01", (
            f"DISTINCT ON ORDER BY as_of_date DESC failed; got {surfaced[0]}"
        )
        assert surfaced[0]["cumulative_uplift_eur"] == pytest.approx(120.00), (
            f"Latest aggregate not surfaced; got {surfaced[0]}"
        )
    finally:
        # Teardown — DELETE the test rows so the suite is repeatable.
        client.table("campaign_uplift").delete().eq(
            "restaurant_id", friend_restaurant_id
        ).eq("campaign_id", FRIEND_CAMPAIGN_ID).execute()
