#!/usr/bin/env bash
# scripts/fork-dryrun.sh
# Smoke-test the forker walkthrough. Asserts every file + env var + migration
# referenced in README is present in a clean repo checkout. Does NOT run
# migrations, does NOT hit network — this is a static gate only.
#
# Exit 0: all checks pass. Exit 1: at least one missing reference.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "ok:   $1"; }

# 1. Required files at repo root
for f in README.md LICENSE .env.example package.json; do
  [[ -f "$f" ]] || fail "missing $f"
  ok "$f exists"
done

# 2. README has every Forker quickstart section
for section in "Phase 1" "Phase 2" "Phase 3" "Phase 4" "Phase 5" "Ship"; do
  grep -q "Forker quickstart — $section" README.md || fail "README missing 'Forker quickstart — $section' section"
  ok "README has '$section' section"
done

# 3. .env.example has all 4 destination sections
for dest in "cf pages" "supabase secrets" "github actions" "local dev"; do
  grep -q "destination: $dest" .env.example || fail ".env.example missing destination: $dest"
  ok ".env.example has '$dest' section"
done

# 4. Key env vars documented
for v in PUBLIC_SUPABASE_URL PUBLIC_SUPABASE_ANON_KEY ANTHROPIC_API_KEY SUPABASE_SERVICE_ROLE_KEY; do
  grep -q "^$v=" .env.example || fail ".env.example missing $v"
  ok ".env.example documents $v"
done

# 5. Edge Function present and deployable
[[ -f supabase/functions/generate-insight/index.ts ]] || fail "Edge Function index.ts missing"
[[ -f supabase/functions/generate-insight/prompt.ts ]] || fail "prompt.ts missing"
[[ -f supabase/functions/generate-insight/digitGuard.ts ]] || fail "digitGuard.ts missing"
[[ -f supabase/functions/generate-insight/fallback.ts ]] || fail "fallback.ts missing"
ok "Edge Function files present"

# 6. Phase 5 migrations present
[[ -f supabase/migrations/0016_insights_table.sql ]] || fail "0016_insights_table.sql missing"
[[ -f supabase/migrations/0017_insights_cron.sql ]] || fail "0017_insights_cron.sql missing"
ok "Phase 5 migrations present"

# 7. No secrets committed
if grep -rEn "sk-ant-[A-Za-z0-9_-]{30,}" . \
    --include="*.ts" --include="*.js" --include="*.svelte" --include="*.md" --include=".env*" \
    2>/dev/null | grep -v ".env.example" | grep -v ".planning/"; then
  fail "potential Anthropic API key committed"
fi
ok "no committed Anthropic secrets"

# 8. LICENSE is MIT
grep -q "MIT License" LICENSE || fail "LICENSE is not MIT"
ok "LICENSE is MIT"

# 9. InsightCard component exists
[[ -f src/lib/components/InsightCard.svelte ]] || fail "InsightCard.svelte missing"
ok "InsightCard.svelte present"

echo ""
echo "fork-dryrun.sh: ALL CHECKS PASSED"
exit 0
