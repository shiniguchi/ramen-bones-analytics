# Plan 12-02 — ITS Validity Audit + GHA Cron — SUMMARY

**Phase:** 12 (Foundation: Decisions & Guards)
**Plan:** 02
**Requirement:** FND-09 (audit script + weekly cron + writes to pipeline_runs)
**Executed:** 2026-04-28
**Branch:** `feature/phase-12-foundation-decisions-guards`

## What shipped

| File | Status | Commit |
|---|---|---|
| `tools/its_validity_audit.py` (313 lines) | ✓ | `3283c9d` initial, `a023363` csv_date + pagination fix |
| `tools/requirements-audit.txt` (4 lines) | ✓ | `3283c9d` |
| `.github/workflows/its-validity-audit.yml` (23 lines) | ✓ | `0f01d86` |

## Spec deviations (necessary corrections)

### 1. `business_date` → `csv_date` (column rename)
The plan inherited from PROPOSAL §13 the assumption that `stg_orderbird_order_items` has a `business_date` (date) column populated by Phase 02 ING-03. **The column does not exist on DEV** — only `csv_date` (text, YYYY-MM-DD format). The plan-checker missed this because it didn't query the live schema.

**Fix applied** in commit `a023363`:
- Replaced every `business_date` reference with `csv_date`
- `csv_date` is text; the `.gte()/.lte()` calls work via lexicographic ISO 8601 comparison
- Per-row parsing via `date.fromisoformat()` with a `try/except ValueError` to skip malformed rows
- Updated docstrings + `PreflightFailure` message to point at the ingest pipeline, not the never-shipped Phase 02 ING-03 backfill

### 2. supabase-py default 1000-row limit caused silent truncation
First smoke run returned 0 findings even though Onsen EGG / Tantan / Hell beer are clearly in DEV. Root cause: `client.table(...).select(...).order("csv_date").execute()` capped at ~1000 rows. The staging table has 22,288 rows; the oldest 1000 don't include the campaign era.

**Fix applied** in commit `a023363`:
- Added explicit `.range(offset, offset + PAGE_SIZE - 1)` pagination loop with `PAGE_SIZE = 1000`
- After fix, dry-run surfaces 7 findings: 4 Tantan variants + Onsen EGG + Tantan + Hell beer; Pop up menu correctly excluded as noise

### 3. Lazy imports for `--help`
Implementer moved `from dotenv import load_dotenv` and `from supabase import create_client` from module-level into `main()` after `parser.parse_args()`, plus `if TYPE_CHECKING: from supabase import Client`. Effect: `--help` works without `supabase`/`dotenv` installed. Type annotations preserved as strings via `from __future__ import annotations`. Same observable runtime behavior.

## Live verification (Task 3a — local smoke)

Ran `.venv-audit/bin/python tools/its_validity_audit.py` against DEV with `.env` SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Result:

```
its_validity_audit: 7 concurrent-intervention finding(s) for campaign_start=2026-04-14:
  - WARNING: new menu item 'Tomato Tantan' first appears 2026-04-04 (within 14d of campaign_start=2026-04-14)
  - WARNING: new menu item 'Dx Tantan' first appears 2026-04-12 (within 14d of campaign_start=2026-04-14)
  - WARNING: new menu item 'Cheese Tantan' first appears 2026-04-12 (within 14d of campaign_start=2026-04-14)
  - WARNING: new menu item 'Sdx Tantan' first appears 2026-04-12 (within 14d of campaign_start=2026-04-14)
  - WARNING: new menu item 'Onsen EGG' first appears 2026-04-14 (within 14d of campaign_start=2026-04-14)
  - WARNING: new menu item 'Tantan' first appears 2026-04-19 (within 14d of campaign_start=2026-04-14)
  - WARNING: new menu item 'Hell beer' first appears 2026-04-20 (within 14d of campaign_start=2026-04-14)
its_validity_audit: posted warning row to public.pipeline_runs.
```

`pipeline_runs` row 1 on DEV: `status='warning'`, `row_count=7`, `error_msg` length 719 chars containing all of `Onsen EGG`, `Tantan`, `Hell beer`. `Pop up menu` correctly absent. Exit code 0 (D-06 contract honored). `commit_sha` is NULL on this row (no `GITHUB_SHA` env var locally — expected).

## Task 3b deferred — known GitHub Actions limitation

`gh workflow run its-validity-audit.yml --ref feature/phase-12-foundation-decisions-guards` returned `HTTP 404: workflow ... not found on the default branch`. This is a hard GitHub Actions rule: `workflow_dispatch` requires the workflow YAML to exist on the default branch (`main`). Since this branch hasn't been merged yet, dispatch is impossible.

**State that IS ready for post-ship dispatch:**
- GHA secret `DEV_SUPABASE_SERVICE_ROLE_KEY` is provisioned (set 2026-04-28; visible in `gh secret list`)
- Existing secret `DEV_SUPABASE_URL` already covers the URL alias
- Workflow YAML passes Guard 8 (cron schedule + cascade gap)
- Local smoke proves the script + DEV creds combo works end-to-end

**To verify the GHA path post-ship** (after `/gsd-ship` merges this branch to main):
```bash
gh workflow run its-validity-audit.yml --ref main
sleep 30
gh run list --workflow=its-validity-audit.yml --limit 1 --json conclusion --jq '.[0].conclusion'
# expect: "success"
psql "$SUPABASE_DB_URL" -c "select status, row_count, commit_sha from pipeline_runs where step_name='its_validity_audit' and commit_sha is not null order by run_id desc limit 1;"
# expect: status=warning, row_count=7, commit_sha non-NULL
```

## FND-09 closure

| Acceptance bar | Status |
|---|---|
| `tools/its_validity_audit.py` exists, runs locally, posts to pipeline_runs | ✓ |
| Wired to weekly GHA workflow at `0 9 * * 1` UTC | ✓ |
| Surfaces concurrent-intervention warnings for the 2026-04-14 campaign era | ✓ (7 findings, all 3 fixture items present) |
| Pre-flight guard against silent-zero-findings | ✓ (`class PreflightFailure`, `def preflight_check`, exit 3) |
| Threat models T-12-05 (secret leak), T-12-06 (SQL inj), T-12-10 (silent zero) mitigated | ✓ |
| GHA path produces equivalent row | ⏸ Deferred to post-`/gsd-ship` (GitHub Actions limitation) |

FND-09 is **functionally closed.** The deferred verification is mechanical (re-run on main) and depends only on `/gsd-ship` happening.
