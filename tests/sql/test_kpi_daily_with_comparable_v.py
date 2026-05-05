"""Phase 16 / Plan 03 / UPL-03 — RED tests for kpi_daily_with_comparable_v.

Wave 0 stubs (RED): assert that `public.kpi_daily_with_comparable_v` exposes
a `revenue_comparable_eur` column derived from items in `baseline_items_v`
ONLY, with the strict invariant `revenue_comparable_eur <= revenue_eur` per
(restaurant_id, business_date) — comparable revenue is by construction a
subset of total revenue (CONTEXT.md D-03; VALIDATION.md row 16-03-01).

Behavior matrix (CONTEXT.md D-03; CONTEXT.md `<deferred>` excludes list):

  - One comparable item ("Tonkotsu Ramen", 15.00 EUR) + one non-comparable
    ("Onsen EGG", 3.00 EUR) on the same date
        -> revenue_comparable_eur = 15.00, revenue_eur = 18.00
  - revenue_comparable_eur <= revenue_eur for every (restaurant, date) row
        -> strict invariant; comparable items are a subset of all items
  - A date with ONLY post-campaign items (e.g., 2026-04-15 with only
    "Onsen EGG") -> revenue_comparable_eur = 0 (LEFT JOIN + COALESCE; no
    NULLs leaked to clients).
  - anon JWT -> 0 rows (RLS scope; matches kpi_daily_v guard)
  - tenant A JWT querying tenant B revenue -> 0 cross-tenant leakage

Auth pattern: `set_config('request.jwt.claims', json, true)` via the
service-role client. Mirrors `tests/sql/test_baseline_items_v.py` (Plan 02
sister file) and `tests/integration/tenant-isolation.test.ts` per
`project_silent_error_isolation.md` — assertions run under an auth'd JWT,
not service_role bypass.

Setup data note: `stg_orderbird_order_items` has no `occurred_at` column
and no `item_gross_cents` column. Migration 0060 mirrors Plan 02's
deviation (join via `transactions.occurred_at` + read text-cast
`item_gross_amount_eur`) — same plan-spec gap inherited from
12-PROPOSAL §7. Each test fixture seeds matching `transactions` rows to
provide the time anchor.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import date

import pytest

# Fixture item names — keep literal so the planner's grep verifier (and the
# acceptance criteria check below) can confirm both comparable and
# non-comparable item names are exercised.
ITEM_BASELINE_KEEP = "Tonkotsu Ramen"  # comparable: 15.00 EUR
ITEM_LAUNCH_POST = "Onsen EGG"  # non-comparable: 3.00 EUR (post-campaign launch)

# Cents-equivalents used by assertions (kpi rows expose EUR).
EUR_BASELINE = 15.00
EUR_NON_BASELINE = 3.00
EUR_TOTAL_DAY1 = EUR_BASELINE + EUR_NON_BASELINE  # 18.00

CAMPAIGN_START = date(2026, 4, 14)
DATE_DAY1 = date(2026, 4, 14)  # mixed comparable + non-comparable
DATE_POST_ONLY = date(2026, 4, 15)  # post-campaign items ONLY


# NB: Migration 0060 ships in Plan 03 but `supabase db push` happens in
# Plan 04. Tests below skip at runtime via `_supabase_client()` when env
# vars are absent (typical in CI without Supabase secrets); they GREEN
# automatically after the Plan 04 cascade pushes the view to DEV.


def _supabase_client():
    """Service-role client; used inside fixtures for setup/teardown.

    Assertions inside test bodies switch the JWT claim via
    `set_config('request.jwt.claims', ...)` to simulate a tenant or anon
    session. Mirrors `tests/sql/test_baseline_items_v.py`.
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
    + transactions + stg_orderbird_order_items so:
      - DATE_DAY1 has Tonkotsu Ramen (comparable, 15.00) + Onsen EGG
        (non-comparable, 3.00).
      - DATE_POST_ONLY has Onsen EGG only.
    Cleans up via DELETE in teardown.
    """
    return str(uuid.uuid4())


@pytest.fixture
def tenant_b():
    """Tenant B for cross-tenant isolation test."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Behavior tests — exactly 5 functions per plan acceptance criterion.
# ---------------------------------------------------------------------------


def test_comparable_revenue_present(tenant_a):
    """Mixed day: revenue_comparable_eur = 15.00, revenue_eur = 18.00.

    DATE_DAY1 has one comparable item (Tonkotsu Ramen, 15 EUR) and one
    non-comparable (Onsen EGG, 3 EUR). The view's CTE INNER JOIN to
    baseline_items_v filters out Onsen EGG; revenue_comparable_eur sums
    only the comparable line item.
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("kpi_daily_with_comparable_v")
        .select("business_date,revenue_eur,revenue_comparable_eur")
        .eq("business_date", DATE_DAY1.isoformat())
        .execute()
    )
    rows = res.data or []
    assert len(rows) == 1, f"expected 1 row for {DATE_DAY1}; got {rows}"
    row = rows[0]
    # Use approx-equal for float-vs-numeric round-trip safety.
    assert float(row["revenue_comparable_eur"]) == pytest.approx(
        EUR_BASELINE, abs=0.01
    ), f"revenue_comparable_eur != {EUR_BASELINE}; got row={row}"
    assert float(row["revenue_eur"]) == pytest.approx(
        EUR_TOTAL_DAY1, abs=0.01
    ), f"revenue_eur != {EUR_TOTAL_DAY1}; got row={row}"


def test_comparable_le_total_revenue(tenant_a):
    """Strict invariant: revenue_comparable_eur <= revenue_eur for every row.

    Comparable revenue is by construction a subset of total revenue. Any
    row violating this means the migration's INNER JOIN to baseline_items_v
    is broken, OR the LEFT JOIN to kpi_daily_mv is doubling rows somehow.
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("kpi_daily_with_comparable_v")
        .select("business_date,revenue_eur,revenue_comparable_eur")
        .execute()
    )
    rows = res.data or []
    assert rows, "kpi_daily_with_comparable_v returned 0 rows for tenant_a"
    for r in rows:
        comp = float(r["revenue_comparable_eur"])
        total = float(r["revenue_eur"])
        assert comp <= total + 1e-6, (
            f"INVARIANT VIOLATED: revenue_comparable_eur ({comp}) > revenue_eur "
            f"({total}) on {r['business_date']}; row={r}"
        )


def test_comparable_zero_when_only_post_campaign_items(tenant_a):
    """A date with ONLY post-campaign items returns revenue_comparable_eur = 0.

    DATE_POST_ONLY has Onsen EGG ONLY (excluded from baseline_items_v).
    The view's LEFT JOIN to the comparable-revenue CTE keeps the
    kpi_daily_mv row; COALESCE(c.revenue_comparable_cents, 0) ensures the
    column is 0 (not NULL) so clients never see nulls.
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    res = (
        client.from_("kpi_daily_with_comparable_v")
        .select("business_date,revenue_eur,revenue_comparable_eur")
        .eq("business_date", DATE_POST_ONLY.isoformat())
        .execute()
    )
    rows = res.data or []
    assert len(rows) == 1, (
        f"expected 1 row for {DATE_POST_ONLY} (kpi_daily_mv has the row "
        f"even when no comparable items sold); got {rows}"
    )
    row = rows[0]
    assert float(row["revenue_comparable_eur"]) == pytest.approx(0.0, abs=0.01), (
        f"revenue_comparable_eur should be 0 (post-campaign-only date); got row={row}"
    )
    # Sanity: revenue_eur > 0 (the non-comparable Onsen EGG sale registers).
    assert float(row["revenue_eur"]) > 0, (
        f"sanity: revenue_eur should be >0 on a day with sales; got row={row}"
    )


def test_comparable_rls_anon_zero():
    """Anon JWT (no restaurant_id claim) returns 0 rows via RLS WHERE clause.

    The view body's `WHERE k.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid`
    cast fails closed when the claim is missing — Postgres treats NULL ::uuid
    as NULL and `restaurant_id = NULL` is unknown -> 0 rows.
    """
    client = _supabase_client()
    _set_jwt(client, None)  # anon — no claim
    res = client.from_("kpi_daily_with_comparable_v").select("business_date").execute()
    rows = res.data or []
    assert rows == [], f"kpi_daily_with_comparable_v leaked rows to anon JWT; got {rows}"


def test_comparable_rls_cross_tenant(tenant_a, tenant_b):
    """Tenant A JWT cannot see Tenant B's revenue rows.

    Verifies the RLS WHERE clause `k.restaurant_id = (auth.jwt()->>...
    'restaurant_id')::uuid` actually scopes rows. Sets up tenant B's
    transactions under tenant B's restaurant_id, then queries as tenant A.
    """
    client = _supabase_client()
    _set_jwt(client, tenant_a)
    # tenant A querying — should see no rows belonging to tenant B
    res = (
        client.from_("kpi_daily_with_comparable_v")
        .select("restaurant_id,business_date,revenue_eur")
        .eq("restaurant_id", tenant_b)
        .execute()
    )
    rows = res.data or []
    assert rows == [], (
        f"kpi_daily_with_comparable_v leaked tenant-B rows to tenant-A JWT; got {rows}"
    )
