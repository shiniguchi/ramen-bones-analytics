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

# Strip leading zeros for numeric comparison
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
