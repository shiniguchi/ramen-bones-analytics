#!/usr/bin/env bash
# scripts/ci-guards.sh — fails CI on any forbidden pattern.
#
# Implements the four D-14 grep guards plus Guard 3b (D-08) from
# .planning/phases/01-foundation/01-CONTEXT.md. Runs in .github/workflows/guards.yml
# on every PR and push to main. Designed to be runnable locally too:
#
#   bash scripts/ci-guards.sh
#
# Exits 0 on clean repo, 1 on any guard failure.
set -u
fail=0

# Guard 1 (D-14.1 + Phase 3 D-24 + Phase 5 D-16): No raw _mv or raw
# analytics/insights base-table refs from src/. Frontend may only touch the
# *_v wrapper views — never a raw MV, never raw `transactions` /
# `stg_orderbird_order_items`, and (Phase 5) never raw `insights` (must go
# through `insights_v`). src/ does not exist until Phase 4; guard is a no-op
# until then.
if [ -d src ]; then
  if grep -rnE "from[[:space:]]+['\"]?transactions['\"]?|\.from\(['\"]transactions['\"]\)|\.from\(['\"]insights['\"]\)|\bstg_orderbird_order_items\b|\b[a-z_]+_mv\b" src/ 2>/dev/null; then
    echo "::error::Guard 1 FAILED: src/ references a materialized view or raw analytics/insights table directly. Use the *_v wrapper views (cohort_v, kpi_daily_v, retention_curve_v, ltv_v, frequency_v, new_vs_returning_v, insights_v)."
    fail=1
  fi
fi

# Guard 2 (D-14.2): getSession() on server without getClaims/getUser in the same file.
# Scans src/ server files AND docs/reference/*.example (Phase 4 copy targets) so the
# reference hooks.server.ts.example acts as a positive baseline.
rm -f /tmp/guard2
find src docs/reference -type f \( -name 'hooks.server.ts' -o -name 'hooks.server.ts.example' -o -name '+*.server.ts' -o -name '+*.server.ts.example' \) 2>/dev/null | while read -r f; do
  if grep -q 'getSession(' "$f" && ! grep -qE '(getClaims|getUser)\(' "$f"; then
    echo "::error::Guard 2 FAILED: $f calls getSession() without getClaims/getUser validation."
    echo "fail" >> /tmp/guard2
  fi
done
if [ -f /tmp/guard2 ]; then fail=1; rm /tmp/guard2; fi

# Guard 3 (D-14.3): REFRESH MATERIALIZED VIEW without CONCURRENTLY.
# Two-pass grep (no -P) for runner portability.
while IFS= read -r file; do
  if grep -nE 'REFRESH MATERIALIZED VIEW' "$file" | grep -v 'CONCURRENTLY' >/dev/null; then
    echo "::error::Guard 3 FAILED: $file has REFRESH MATERIALIZED VIEW without CONCURRENTLY."
    fail=1
  fi
done < <(find supabase/migrations -name '*.sql' 2>/dev/null)

# Guard 3b (D-08): CREATE MATERIALIZED VIEW must have CREATE UNIQUE INDEX in the same file.
# Required so REFRESH MATERIALIZED VIEW CONCURRENTLY works in Phase 3.
while IFS= read -r file; do
  if grep -qi 'create materialized view' "$file" && ! grep -qi 'create unique index' "$file"; then
    echo "::error::Guard 3b FAILED: $file creates a MV without a unique index (blocks CONCURRENTLY refresh)."
    fail=1
  fi
done < <(find supabase/migrations -name '*.sql' 2>/dev/null)

# Guard 4 (D-14.4 / FND-07): card_hash joined to any column listed in pii-columns.txt.
# Manifest is empty in Phase 1 (Phase 2 appends as the scraper introduces PII columns).
# Comment lines (#-prefixed) and blank lines are skipped so the guard never crashes.
if [ -s pii-columns.txt ]; then
  while IFS= read -r col; do
    [ -z "$col" ] && continue
    case "$col" in '#'*) continue ;; esac
    if grep -rnE "card_hash.*${col}|${col}.*card_hash" supabase/migrations/ src/ 2>/dev/null; then
      echo "::error::Guard 4 FAILED: card_hash referenced alongside PII column '${col}'."
      fail=1
    fi
  done < pii-columns.txt
fi

# Guard 5 (Phase 4 Gap C): migration drift against the linked Supabase project.
# Prevents the Phase 3 silent-drift recurrence (local SQL ahead of DEV).
echo "=== Guard: migration drift ==="
if ! bash "$(dirname "$0")/check-migration-drift.sh"; then
  echo "::error::Guard 5 FAILED: migration drift detected — see scripts/check-migration-drift.sh output."
  fail=1
fi

# Guard 6 (Phase 6 FLT-07): no dynamic SQL inside .from(/.rpc( calls.
# Delegated to scripts/ci-guards/no-dynamic-sql.sh so individual guards can
# be invoked standalone in local dev. Runs only if src/ exists.
if [ -d src ]; then
  if ! bash "$(dirname "$0")/ci-guards/no-dynamic-sql.sh"; then
    echo "::error::Guard 6 FAILED: src/ contains \${} inside .from(/.rpc( — use zod-validated params + .eq()/.in()/.gte()."
    fail=1
  fi
fi

# Guard 7 (Phase 12 FND-10 / D-09..D-11): JWT claim is `restaurant_id`, NOT
# `tenant_id`. PROPOSAL.md §7 schema sketches use the wrong claim and must
# be mechanically renamed before any v1.3 migration is written. This guard
# catches the regression. Scan paths per D-10: supabase/migrations/,
# scripts/forecast/, scripts/external/, src/. Excludes .planning/ (proposal
# text intentionally documents the wrong claim) and tools/ (audit script
# operates on existing restaurant_id columns).
#
# Pre-filter paths that exist on disk — `grep -rE` exits 2 when a path is
# missing, which bash's `if` treats as falsy, silently swallowing real
# matches. scripts/forecast/ + scripts/external/ are created in Phase 13;
# until then they're absent and must be excluded from the grep call.
GUARD7_CANDIDATES="supabase/migrations/ scripts/forecast/ scripts/external/ src/"
GUARD7_PATHS=""
for _p in $GUARD7_CANDIDATES; do
  [ -e "$_p" ] && GUARD7_PATHS="$GUARD7_PATHS $_p"
done
if [ -n "$GUARD7_PATHS" ]; then
  if grep -rnEH "auth\.jwt\(\)[[:space:]]*->>[[:space:]]*'tenant_id'" $GUARD7_PATHS 2>/dev/null; then
    echo "::error::Guard 7 FAILED: auth.jwt()->>'tenant_id' found — JWT claim in this codebase is 'restaurant_id', not 'tenant_id'. Rename the reference (PROPOSAL.md §7 sketches must be mechanically renamed before paste)."
    fail=1
  fi
  # D-11 (b): bare `'tenant_id'` quoted-string occurrences on a line that
  # ALSO mentions auth.jwt — catches paraphrased forms like
  # `auth.jwt() ->> 'tenant_id'::text` or `(auth.jwt())->>'tenant_id'`.
  if grep -rnEH "auth\.jwt.*'tenant_id'" $GUARD7_PATHS 2>/dev/null; then
    echo "::error::Guard 7 FAILED: 'tenant_id' quoted on a line referencing auth.jwt — JWT claim in this codebase is 'restaurant_id'."
    fail=1
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "All CI guards passed."
fi
exit $fail
