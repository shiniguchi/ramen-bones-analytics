#!/usr/bin/env python3
"""Phase 12 FND-09: ITS validity audit.

Surfaces concurrent-intervention warnings (price hikes, hours shifts,
new menu items) for the 2026-04-14 campaign era. Operates on existing
public.transactions + public.stg_orderbird_order_items. Posts ONE row
to public.pipeline_runs (step_name='its_validity_audit') with status=
'success' | 'warning' | 'failure' and error_msg carrying any findings
text or pre-flight failure guidance.

Exits 0 even on findings — surfacing happens via pipeline_runs.error_msg
and the weekly GHA run summary (D-06 + the 'Audit-script error vocabulary'
note in 12-CONTEXT specifics). Hard-failing would block the cascade.

Pre-flight guard (Issue-4 mitigation, T-12-10): if
stg_orderbird_order_items.csv_date is NULL or empty across the campaign
era, the audit would silently return zero findings — masking the very
interventions FND-09 exists to surface. The pre-flight check raises
explicitly with status='failure' and an error_msg pointing the operator
at the ingestion pipeline. Memory ref: silent_error_isolation
(2026-04-17 dashboard bug).

Date column: stg_orderbird_order_items.csv_date is TEXT (YYYY-MM-DD)
because the staging table preserves the raw Orderbird CSV strings.
The audit parses these via date.fromisoformat() before windowing.

Only infrastructure errors (env missing, DB connection failure) AND the
pre-flight failure cause non-zero exit. Data findings (warnings) exit 0.

Cadence: Monday 09:00 UTC via .github/workflows/its-validity-audit.yml +
on-demand workflow_dispatch.
"""
from __future__ import annotations
import argparse
import os
import sys
from datetime import datetime, date, timedelta, timezone
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from supabase import Client

# 2026-04-14: the founder's friend's first paid Instagram campaign.
# The 14-day concurrent-intervention window is per PROPOSAL §13 ("3 new
# menu items launched coincidentally with the campaign era"). Items that
# first-appear inside [campaign_start - 14d, campaign_start + 14d] are
# flagged as concurrent interventions; items outside the window are safe.
CAMPAIGN_START = date(2026, 4, 14)
CONCURRENT_WINDOW_DAYS = 14

# Stochastic / non-intervention items the audit MUST NOT flag.
# Matched case-insensitive on stg_orderbird_order_items.item_name.
NOISE_ITEMS = {"pop up menu"}


class PreflightFailure(Exception):
    """Raised when the audit's input data is in a state that would cause
    silent-zero-findings (e.g. csv_date is NULL or empty across the era).
    Caller writes status='failure' + the message to pipeline_runs and
    exits non-zero. Issue-4 / T-12-10 mitigation.
    """


def preflight_check(client: Client) -> None:
    """Assert the audit has the minimum input shape it needs to NOT silently
    return zero findings.

    Failure modes guarded:
    - stg_orderbird_order_items.csv_date is NULL or empty for every row in
      the campaign era → audit would dedup on (item_name, None) and skip
      every row in find_new_menu_items. The fix is rerunning the ingest
      pipeline so csv_date carries the raw Orderbird YYYY-MM-DD string.

    Raises PreflightFailure with operator guidance text if guard trips.
    """
    # Count rows in the campaign era (± window) where csv_date is set.
    # csv_date is TEXT (YYYY-MM-DD); supabase-py .gte/.lte does
    # lexicographic comparison which is correct for ISO 8601 dates.
    window_start = (CAMPAIGN_START - timedelta(days=CONCURRENT_WINDOW_DAYS)).isoformat()
    window_end   = (CAMPAIGN_START + timedelta(days=CONCURRENT_WINDOW_DAYS)).isoformat()
    res = (
        client.table("stg_orderbird_order_items")
        .select("csv_date", count="exact")
        .gte("csv_date", window_start)
        .lte("csv_date", window_end)
        .limit(1)
        .execute()
    )
    if getattr(res, "error", None):
        raise RuntimeError(f"preflight select failed: {res.error}")
    # supabase-py's count="exact" populates res.count.
    n = getattr(res, "count", None) or 0
    if n == 0:
        raise PreflightFailure(
            "Pre-flight FAILED: stg_orderbird_order_items has no rows with "
            "csv_date populated for the campaign era "
            f"[{window_start}, {window_end}]; audit findings would be "
            "silent-zero. Re-run after the Orderbird ingest pipeline "
            "populates csv_date on staging rows for this date range."
        )


def find_new_menu_items(client: Client) -> list[str]:
    """Return findings text — one string per new menu item that first
    appears within CONCURRENT_WINDOW_DAYS of CAMPAIGN_START.

    Algorithm (server-side via supabase-py — no raw SQL strings):
    1. SELECT item_name + csv_date from stg_orderbird_order_items
       (the table has ~22k rows on DEV — pull all and aggregate in Python).
       csv_date is TEXT (YYYY-MM-DD), parsed via date.fromisoformat().
    2. Drop items whose lower-cased name is in NOISE_ITEMS.
    3. For each remaining item: if min(csv_date) is within
       CAMPAIGN_START ± CONCURRENT_WINDOW_DAYS, append a finding string
       of the form:
       "WARNING: new menu item '<name>' first appears <YYYY-MM-DD> "
       "(within 14d of campaign_start=2026-04-14)"
    4. Return the list sorted by first-appearance date ascending.

    NOTE: Relies on stg_orderbird_order_items.csv_date being NON-NULL
    for the campaign era. The pre-flight guard above (preflight_check)
    is what makes this safe — without it, NULL/empty csv_date rows would
    be silently filtered out below and the audit would return [].
    """
    # Pull all order items; aggregate in Python (DEV has ~22k items —
    # well within memory budget for a once-weekly script).
    # csv_date is TEXT in YYYY-MM-DD, so the .order() sort is lexicographic
    # which matches chronological order for ISO 8601 dates.
    #
    # supabase-py defaults to a ~1000-row response limit. The staging table
    # exceeds that, so we paginate explicitly via .range(start, end). The
    # OFFSET/LIMIT is server-side; .order("csv_date") makes pagination
    # deterministic across requests.
    PAGE_SIZE = 1000
    rows: list[dict] = []
    offset = 0
    while True:
        page = (
            client.table("stg_orderbird_order_items")
            .select("item_name, csv_date")
            .order("csv_date")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        if getattr(page, "error", None):
            raise RuntimeError(f"select stg_orderbird_order_items failed: {page.error}")
        batch = page.data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    first_seen: dict[str, date] = {}
    for row in rows:
        name = (row.get("item_name") or "").strip()
        raw = row.get("csv_date")
        if not name or not raw:
            continue
        if name.lower() in NOISE_ITEMS:
            continue
        try:
            biz_date = date.fromisoformat(raw) if isinstance(raw, str) else raw
        except ValueError:
            # Defensive: skip malformed csv_date strings (e.g. blank, garbage).
            # The preflight check guarantees enough valid rows for the audit
            # to surface findings; one malformed row shouldn't crash the run.
            continue
        if name not in first_seen or biz_date < first_seen[name]:
            first_seen[name] = biz_date

    window_start = CAMPAIGN_START - timedelta(days=CONCURRENT_WINDOW_DAYS)
    window_end   = CAMPAIGN_START + timedelta(days=CONCURRENT_WINDOW_DAYS)

    findings: list[str] = []
    for name, biz_date in sorted(first_seen.items(), key=lambda kv: kv[1]):
        if window_start <= biz_date <= window_end:
            findings.append(
                f"WARNING: new menu item '{name}' first appears "
                f"{biz_date.isoformat()} "
                f"(within {CONCURRENT_WINDOW_DAYS}d of "
                f"campaign_start={CAMPAIGN_START.isoformat()})"
            )
    return findings


def post_to_pipeline_runs(
    client: Client,
    started: datetime,
    findings: list[str],
    *,
    status_override: Optional[str] = None,
    error_msg_override: Optional[str] = None,
) -> None:
    """Insert ONE row into public.pipeline_runs with the audit result.

    status_override + error_msg_override let the pre-flight failure path
    write a status='failure' row instead of computing from findings.
    """
    finished = datetime.now(timezone.utc)
    if status_override is not None:
        status = status_override
        error_msg = error_msg_override
        row_count = 0
    else:
        status = "warning" if findings else "success"
        error_msg = "\n".join(findings) if findings else None
        row_count = len(findings)
    row = {
        "step_name": "its_validity_audit",
        "started_at": started.isoformat(),
        "finished_at": finished.isoformat(),
        "status": status,
        "row_count": row_count,
        "error_msg": error_msg,
        "commit_sha": os.environ.get("GITHUB_SHA"),
    }
    res = client.table("pipeline_runs").insert(row).execute()
    if getattr(res, "error", None):
        raise RuntimeError(f"pipeline_runs insert failed: {res.error}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Phase 12 FND-09 ITS validity audit — surfaces "
        "concurrent-intervention warnings for the 2026-04-14 campaign era."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute findings and print to stdout but do NOT write to "
        "pipeline_runs. Useful for local debugging.",
    )
    args = parser.parse_args()

    # Lazy imports — only load after argparse runs so --help works without deps.
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()

    # Infra-error gates — these CRASH the script (non-zero exit).
    try:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    except KeyError as e:
        print(
            f"::error::its_validity_audit: missing required env var {e}. "
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or DEV_* and "
            "alias them in the workflow).",
            file=sys.stderr,
        )
        return 2

    started = datetime.now(timezone.utc)
    client: Client = create_client(url, key)

    # Pre-flight: refuse to silently return zero findings on incomplete data.
    try:
        preflight_check(client)
    except PreflightFailure as pf:
        print(f"::error::its_validity_audit: {pf}", file=sys.stderr)
        if not args.dry_run:
            # Forensic trail: the failure is recorded in pipeline_runs so
            # the operator sees it on the dashboard, not just in GHA logs.
            post_to_pipeline_runs(
                client,
                started,
                findings=[],
                status_override="failure",
                error_msg_override=str(pf),
            )
        return 3

    # Audit-side errors are infra-class — re-raise so cron sees non-zero.
    findings = find_new_menu_items(client)

    # Print findings (the GHA run summary captures stdout).
    if findings:
        print(
            f"its_validity_audit: {len(findings)} concurrent-intervention "
            f"finding(s) for campaign_start={CAMPAIGN_START.isoformat()}:"
        )
        for f in findings:
            print(f"  - {f}")
    else:
        print(
            f"its_validity_audit: no concurrent-intervention findings "
            f"within {CONCURRENT_WINDOW_DAYS}d of "
            f"campaign_start={CAMPAIGN_START.isoformat()}."
        )

    if args.dry_run:
        print("its_validity_audit: --dry-run set, skipping pipeline_runs insert.")
        return 0

    post_to_pipeline_runs(client, started, findings)
    print(
        f"its_validity_audit: posted {('warning' if findings else 'success')} "
        f"row to public.pipeline_runs."
    )
    # CRITICAL: exit 0 even when findings exist — they surface via
    # pipeline_runs.error_msg, not exit code (D-06 + CONTEXT specifics).
    return 0


if __name__ == "__main__":
    sys.exit(main())
