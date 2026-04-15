#!/usr/bin/env bash
# Guard 6 — forbid string interpolation inside Supabase query builders.
# FLT-07: no dynamic SQL; every filter must go through zod-validated params
# and .eq()/.in()/.gte() method chains, never `${}` inside .from()/.rpc().
set -euo pipefail

HITS=$(grep -REn --include='*.ts' --include='*.svelte' \
  -e '\.from\([^)]*\$\{' \
  -e '\.rpc\([^)]*\$\{' \
  src/ || true)

if [[ -n "$HITS" ]]; then
  echo "::error::Guard 6 (no-dynamic-sql) FAILED: forbidden \${} inside .from(/.rpc("
  echo "$HITS"
  exit 1
fi
echo "Guard 6 (no-dynamic-sql): clean"
