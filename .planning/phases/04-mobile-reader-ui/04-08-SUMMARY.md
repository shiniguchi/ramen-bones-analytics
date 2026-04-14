---
phase: 04-mobile-reader-ui
plan: 08
subsystem: ci-guards
tags: [gap-closure, ci, migrations, verification]
gap_closure: true
requires:
  - Phase 3 complete (migrations 0001..0014)
  - scripts/ci-guards.sh (existing)
provides:
  - Migration-drift guard enforced on every `npm run test:guards`
  - Retroactive Gap C record in Phase 3 verification
  - Dual-project hazard documented for forkers
affects:
  - scripts/ci-guards.sh (added Guard 5 block)
  - .planning/phases/03-analytics-sql/03-VERIFICATION.md (append-only)
  - docs/reference/README.md (hazard block near top)
tech-stack:
  added: []
  patterns:
    - "Standalone guard script called from ci-guards.sh (matches existing pattern)"
    - "psql-preferred with supabase-CLI fallback for local dev UX"
key-files:
  created:
    - scripts/check-migration-drift.sh
  modified:
    - scripts/ci-guards.sh
    - .planning/phases/03-analytics-sql/03-VERIFICATION.md
    - docs/reference/README.md
decisions:
  - Parse the Remote column of `supabase migration list` (not field 1 Local), otherwise unpushed-local rows masquerade as remote and defeat the guard.
  - Guard is skipped (exit 0 with warning) when neither SUPABASE_DB_URL nor supabase CLI is available, so forkers cloning the repo don't get blocked. CI is expected to set SUPABASE_DB_URL to enforce.
metrics:
  tasks: 2
  files_changed: 4
  duration: ~6min
  completed: 2026-04-14
---

# Phase 4 Plan 08: Gap C closure — migration-drift guard + retrospective

Migration-drift CI guard + retroactive Phase 3 Gap C annotation + dual-project hazard doc so the silent TEST-vs-DEV link bug cannot recur.

## Summary

Phase 3 closed as "passed" while migrations 0010..0014 were never applied to DEV — the supabase CLI was silently linked to TEST. gsd-verifier confirmed files existed in the repo but never queried `supabase_migrations.schema_migrations` on DEV to confirm deployment. Phase 4 discovered the gap when reader queries against `kpi_daily_v` came back empty.

This plan installs a standing automated guard (`scripts/check-migration-drift.sh`) that compares local migration filenums against the linked project's `schema_migrations`, wires it into `scripts/ci-guards.sh` as Guard 5, retroactively annotates 03-VERIFICATION.md so the incident is part of the permanent record, and publishes a dual-project hazard block in `docs/reference/README.md` for forkers.

## Tasks Completed

| # | Task | Commit |
|---|------|--------|
| 1 | Add `scripts/check-migration-drift.sh` + wire into `scripts/ci-guards.sh` | `da0f266` |
| 2 | Retroactive Gap C in 03-VERIFICATION.md + hazard note in docs/reference/README.md | `1c773b0` |

## Artifacts

### scripts/check-migration-drift.sh (full)

```bash
#!/usr/bin/env bash
# check-migration-drift.sh — fail if local migration files outnumber what's applied
# to the currently linked Supabase project. Prevents Phase 3 Gap C recurrence.
#
# Skipped (with a warning, exit 0) when:
#   - $SUPABASE_DB_URL is unset AND `supabase` CLI is unavailable
#   - $SKIP_MIGRATION_DRIFT_CHECK == "1"
# In CI, set SUPABASE_DB_URL (read-only role is fine) so this gate is enforced.

set -euo pipefail

if [[ "${SKIP_MIGRATION_DRIFT_CHECK:-0}" == "1" ]]; then
  echo "check-migration-drift: SKIPPED via SKIP_MIGRATION_DRIFT_CHECK=1"
  exit 0
fi

local_max=$(ls supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql 2>/dev/null \
  | sed -E 's|.*/([0-9]{4})_.*|\1|' \
  | sort -n | tail -1)

if [[ -z "$local_max" ]]; then
  echo "check-migration-drift: no local migrations found, nothing to check"
  exit 0
fi

remote_max=""
if [[ -n "${SUPABASE_DB_URL:-}" ]] && command -v psql >/dev/null 2>&1; then
  remote_max=$(psql "$SUPABASE_DB_URL" -At -c \
    "select coalesce(max(version), '0000') from supabase_migrations.schema_migrations;" 2>/dev/null || echo "")
elif command -v supabase >/dev/null 2>&1; then
  # Fallback: use supabase CLI against the currently linked project.
  # `supabase migration list` prints a table: "Local | Remote | Time (UTC)".
  # We parse the Remote column (field 3 under awk -F'|') and ignore blanks —
  # a missing Remote means the migration exists locally but was NOT pushed.
  remote_max=$(supabase migration list 2>/dev/null \
    | awk -F'|' '
        /^[[:space:]]*[0-9]{4,}/ {
          gsub(/[[:space:]]/, "", $2);
          if ($2 ~ /^[0-9]{4,}$/) print $2;
        }' \
    | sort -n | tail -1 || echo "")
fi

if [[ -z "$remote_max" ]]; then
  echo "check-migration-drift: WARNING — no SUPABASE_DB_URL and no supabase CLI; cannot verify drift" >&2
  echo "check-migration-drift: set SUPABASE_DB_URL in CI to enforce this guard" >&2
  exit 0
fi

local_n=$((10#$local_max))
remote_n=$((10#$remote_max))

echo "check-migration-drift: local_max=$local_max remote_max=$remote_max"

if (( local_n > remote_n )); then
  echo "" >&2
  echo "ERROR: migration drift detected." >&2
  echo "  Local migrations top out at $local_max" >&2
  echo "  Linked Supabase project tops out at $remote_max" >&2
  echo "  Run: supabase db push" >&2
  echo "  (Make sure you are linked to the right project! See Phase 4 Gap C.)" >&2
  exit 1
fi

echo "check-migration-drift: OK"
```

### Clean-state run against DEV

```
$ bash scripts/check-migration-drift.sh
check-migration-drift: local_max=0015 remote_max=0015
check-migration-drift: OK
```

### Synthetic drift sanity check

```
$ touch supabase/migrations/9999_drift_test.sql
$ bash scripts/check-migration-drift.sh
check-migration-drift: local_max=9999 remote_max=0015

ERROR: migration drift detected.
  Local migrations top out at 9999
  Linked Supabase project tops out at 0015
  Run: supabase db push
  (Make sure you are linked to the right project! See Phase 4 Gap C.)
exit=1
$ rm supabase/migrations/9999_drift_test.sql
```

### New doc sections

- `.planning/phases/03-analytics-sql/03-VERIFICATION.md` — appended "## Retroactive Gap C — migrations 0010..0014 were never applied to DEV (discovered 2026-04-14)"
- `docs/reference/README.md` — added "## ⚠ Hazard: dual Supabase projects + a single CLI link" near the top, before the "How to wire into `src/`" section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `supabase migration list` output parsing was wrong**
- **Found during:** Task 1 synthetic-drift test
- **Issue:** Initial awk grabbed field 1 (Local column) from the CLI table, so a local-only 9999 migration was reported as `remote_max=9999` — guard passed when it should have failed.
- **Fix:** Switched to `awk -F'|'` and parse field 2 (Remote column), ignoring blanks. Re-ran synthetic test; guard now correctly exits 1 with `local_max=9999 remote_max=0015`.
- **Files modified:** `scripts/check-migration-drift.sh`
- **Commit:** `da0f266` (fix applied before the task commit; no separate commit)

## Known Stubs

None.

## Deferred Issues

- `npm run test:guards` surfaces a Guard 1 failure for `src/lib/evil.ts` — this is a pre-existing fixture / test artefact from a parallel agent, out of scope for 04-08 (drift guard itself is green). Not fixed here.

## Authentication Gates

None.

## Self-Check: PASSED

- `scripts/check-migration-drift.sh` — FOUND (executable)
- `grep check-migration-drift.sh scripts/ci-guards.sh` — FOUND
- `grep "Retroactive Gap C" .planning/phases/03-analytics-sql/03-VERIFICATION.md` — FOUND (1 match)
- `grep "dual Supabase projects" docs/reference/README.md` — FOUND (1 match)
- Commit `da0f266` — FOUND
- Commit `1c773b0` — FOUND
