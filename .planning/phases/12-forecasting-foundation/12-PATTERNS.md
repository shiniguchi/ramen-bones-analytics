# Phase 12: Foundation — Decisions & Guards - Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 6 (5 new + 1 modified)
**Analogs found:** 5 / 6 (one fresh-idiom — Python — with TypeScript prior-art)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tools/its_validity_audit.py` | tool / data-audit script | batch → DB write | `scripts/ingest/index.ts` (orchestrator + Supabase write) + `scripts/ingest/upsert.ts` (error handling) | role-match (no Python prior) |
| `scripts/ci-guards/check-cron-schedule.py` | CI guard helper | static-analysis → stdout | `scripts/ci-guards/no-dynamic-sql.sh` (delegated guard helper idiom) | role-match (Python instead of bash) |
| `supabase/migrations/0039_pipeline_runs_skeleton.sql` | migration / table-skeleton | DDL | `supabase/migrations/0014_data_freshness_v.sql` (single-purpose system view) + `0010_cohort_mv.sql` (DDL header style) | role-match (no admin/system table prior) |
| `.github/workflows/its-validity-audit.yml` | CI workflow / scheduled cron | event-driven (cron + dispatch) | `.github/workflows/migrations.yml` (Supabase auth) + `.github/workflows/tests.yml` (full CI shape) | exact (cron pattern needs `schedule:` from `deploy.yml` + `workflow_dispatch`) |
| `tests/ci-guards/red-team-tenant-id.sql` | test fixture | static fixture | `tests/unit/ci-guards.test.ts` (red-team pattern) | role-match (SQL fixture, not TS test) |
| `scripts/ci-guards.sh` (MODIFIED — add Guards 7 & 8) | CI guard script | static-analysis → exit code | `scripts/ci-guards.sh` Guards 4 + 5 + 6 (existing idiom in same file) | exact |

## Pattern Assignments

### `scripts/ci-guards.sh` — MODIFIED, add Guard 7 + Guard 8

**Analog:** `scripts/ci-guards.sh` itself (Guards 4, 5, 6 — same file, paste-and-adapt).

**File header + boilerplate** (lines 1–12):
```bash
#!/usr/bin/env bash
# scripts/ci-guards.sh — fails CI on any forbidden pattern.
# ...
# Exits 0 on clean repo, 1 on any guard failure.
set -u
fail=0
```
Phase 12 keeps this header. Update the comment block (lines 2–10) to also reference Phase 12 D-09..D-14.

**Guard idiom — multi-path grep (model after Guard 4, lines 60–69):**
```bash
# Guard 4 (D-14.4 / FND-07): card_hash joined to any column listed in pii-columns.txt.
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
```
Guard 7 follows this multi-path `grep -rnE` shape. Per CONTEXT D-10 the scan paths are `supabase/migrations/`, `scripts/forecast/`, `scripts/external/`, `src/` — guard `2>/dev/null` so missing dirs don't crash (forecast/ + external/ don't exist yet in Phase 12). Per D-11 the regex must match BOTH `auth.jwt()->>` and `auth.jwt() ->> ` spacing variants.

**Guard idiom — delegated helper script (model after Guard 5, lines 73–77, and Guard 6, lines 82–87):**
```bash
# Guard 5 (Phase 4 Gap C): migration drift against the linked Supabase project.
echo "=== Guard: migration drift ==="
if ! bash "$(dirname "$0")/check-migration-drift.sh"; then
  echo "::error::Guard 5 FAILED: migration drift detected — see scripts/check-migration-drift.sh output."
  fail=1
fi

# Guard 6 (Phase 6 FLT-07): no dynamic SQL inside .from(/.rpc( calls.
if [ -d src ]; then
  if ! bash "$(dirname "$0")/ci-guards/no-dynamic-sql.sh"; then
    echo "::error::Guard 6 FAILED: src/ contains \${} inside .from(/.rpc( — use zod-validated params + .eq()/.in()/.gte()."
    fail=1
  fi
fi
```
Guard 8 follows the Guard 5 / Guard 6 delegation pattern but invokes `python` instead of `bash`:
```bash
# Guard 8 (Phase 12 FND-11): cron schedule overlap / cascade-gap check.
if ! python3 "$(dirname "$0")/ci-guards/check-cron-schedule.py"; then
  echo "::error::Guard 8 FAILED: cron schedule overlap or cascade-gap violation — see check-cron-schedule.py output."
  fail=1
fi
```

**Footer** (lines 89–92):
```bash
if [ "$fail" -eq 0 ]; then
  echo "All CI guards passed."
fi
exit $fail
```
Keep unchanged.

---

### `scripts/ci-guards/check-cron-schedule.py` (CI guard helper, static-analysis)

**Analog:** `scripts/ci-guards/no-dynamic-sql.sh`

**Role match:** thin guard helper, single responsibility, exit 1 + stdout dump on failure, exit 0 + one-line "clean" log on success. The bash analog establishes the contract; Phase 12 swaps the language to Python (only because YAML parsing + DST math need a real language).

**Header + exit contract** (no-dynamic-sql.sh lines 1–5, adapt to Python shebang):
```bash
#!/usr/bin/env bash
# Guard 6 — forbid string interpolation inside Supabase query builders.
# FLT-07: no dynamic SQL; every filter must go through zod-validated params
# and .eq()/.in()/.gte() method chains, never `${}` inside .from()/.rpc().
set -euo pipefail
```
Translate to:
```python
#!/usr/bin/env python3
"""Guard 8 — cron schedule overlap / cascade-gap check.
FND-11: parses every .github/workflows/*.yml schedule.cron AND every
pg_cron.schedule() call in supabase/migrations/, computes UTC + CET (UTC+1)
+ CEST (UTC+2) wall-clock times, asserts (a) no two crons collide in either
DST regime, (b) cascade ordering preserved with >=60-min gap.

Exit 0 on clean schedule, 1 on any violation. Markdown table to stdout on
failure, mirroring the schedule contract table in 12-CONTEXT.md D-12.
"""
```

**Failure-output pattern** (no-dynamic-sql.sh lines 7–17):
```bash
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
```
Translate to:
```python
violations: list[str] = []
# ... build markdown table of (workflow, cron, UTC, CET, CEST, gap_min) ...
if violations:
    print("::error::Guard 8 (cron-schedule) FAILED: overlap or cascade-gap violation")
    print("\n".join(violations))  # markdown table mirroring D-12
    sys.exit(1)
print("Guard 8 (cron-schedule): clean")
```

**No DB / no Supabase deps.** Use only stdlib (`pathlib`, `re`, `sys`) + `pyyaml` (already a transitive dep of `supabase-py`; alternative: parse YAML schedule strings with a focused regex to avoid the dep). Cron parsing — write a focused parser that handles only the 5-field formats the project uses (`0 3 * * *`, `0 9 * * 1`, `0 23 * * 2`); do NOT pull in `croniter` for $0 budget reasons.

**Cron sources to scan:**
1. `.github/workflows/*.yml` — match `schedule:\n\s*-\s*cron:\s*['"]([0-9*/, -]+)['"]`
2. `supabase/migrations/*.sql` — match `cron\.schedule\(\s*'([^']+)'\s*,\s*'([0-9*/, -]+)'`. Two existing call sites: `0013_refresh_function_and_cron.sql` line 56 (`0 3 * * *`) and `0017_insights_cron.sql` line 33 (`15 3 * * *`). The fixture is these two known-good schedules.

---

### `tools/its_validity_audit.py` (Python data-audit CLI, batch → DB write)

**Analog:** `scripts/ingest/index.ts` (TypeScript orchestrator that creates a Supabase client with service-role and writes a report) + `scripts/ingest/upsert.ts` (chunked upsert + error handling).

**No Python prior in repo.** This is the first `tools/*.py` file. Follow the TypeScript orchestrator's *shape* but use `supabase-py` (the v1.3 RESEARCH.md sanctioned dep) and `python-dotenv`.

**Orchestrator shape** (index.ts lines 1–34):
```typescript
// Phase 02 ING-01/02/03/04: CSV ingest orchestrator.
// One-command path: Storage CSV object → staging upsert → transactions upsert
// → JSON report. Exits non-zero on any error so cron detects failure.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env';
// ...
export async function runIngest(opts: { dryRun?: boolean } = {}): Promise<IngestReport> {
  const env = loadEnv();
  const client = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  // ... pipeline ...
}
```
Translate to Python idiom — single-file CLI (no module split for ~150-line audit), explicit env loading, service-role client, `argparse`-style flags including `--dry-run`:
```python
#!/usr/bin/env python3
"""Phase 12 FND-09: ITS validity audit.

Surfaces concurrent-intervention warnings (price hikes, hours shifts,
new menu items) for the 2026-04-14 campaign era. Operates on existing
public.transactions + public.stg_orderbird_order_items. Posts ONE row to
public.pipeline_runs (step_name='its_validity_audit') with status=
'success'|'warning' and error_msg carrying any findings text.

Exits 0 even on findings — surfacing happens via pipeline_runs.error_msg
and the weekly GHA run summary (D-06 + the 'Audit-script error vocabulary'
note in 12-CONTEXT specifics). Hard-failing would block the cascade.
"""
import os, sys, argparse
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client, Client

def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute findings but do not write to pipeline_runs")
    args = parser.parse_args()

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client: Client = create_client(url, key)
    # ... audit logic ...
    return 0

if __name__ == "__main__":
    sys.exit(main())
```

**CLI entry idiom** (index.ts lines 86–97 — match the dry-run + non-zero-on-error contract):
```typescript
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  runIngest({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
```
Critical inversion: per D-06 + specifics, the audit script must exit 0 EVEN ON FINDINGS — it surfaces via `pipeline_runs.error_msg`, not exit code. Only crashes (DB connection failure, env missing) should exit non-zero.

**Error / non-zero contract** (upsert.ts lines 22–28):
```typescript
if (error) {
  // Log invoice + row_index only — never row content (may contain wl_*).
  throw new Error(
    `Staging upsert failed at batch starting row_index=${batch[0]?.row_index} invoice=${batch[0]?.invoice_number}: ${error.message}`,
  );
}
```
Translate — wrap supabase-py calls and re-raise so the script crashes (exit non-zero) on infrastructure errors, but treat audit FINDINGS as data not errors:
```python
res = client.table("pipeline_runs").insert({
    "step_name": "its_validity_audit",
    "started_at": started.isoformat(),
    "finished_at": datetime.now(timezone.utc).isoformat(),
    "status": "warning" if findings else "success",
    "row_count": len(findings),
    "error_msg": "\n".join(findings) if findings else None,
    "commit_sha": os.environ.get("GITHUB_SHA"),
}).execute()
if getattr(res, "error", None):
    raise RuntimeError(f"pipeline_runs insert failed: {res.error}")
```

**Test fixture** — the 2026-04-27 audit findings in PROPOSAL §13 (`Onsen EGG`, `Tantan`, `Hell beer` are post-launch additions; `Pop up menu` is stochastic noise). Wire as a `pytest`-or-inline expected-warnings list the audit reproduces from current data.

**No analog for:** the actual SQL queries against `transactions` / `stg_orderbird_order_items` for concurrent-intervention detection. Planner picks idiomatic SQL — model after the existing `transactions` join shape in `0010_cohort_mv.sql` lines 6–21.

---

### `supabase/migrations/0039_pipeline_runs_skeleton.sql` (DDL, table skeleton)

**Analog:** `supabase/migrations/0014_data_freshness_v.sql` (single-purpose system object, short header) + `0010_cohort_mv.sql` (header style, REVOKE pattern) + `0038_admin_update_insight_i18n.sql` (most recent migration — confirms 0039 is the next number; mixed-case `CREATE OR REPLACE`).

**Header convention — recent migrations** (0038 lines 1–13):
```sql
-- 0038_admin_update_insight_i18n.sql
-- Extends public.admin_update_insight (0036) with a p_locale parameter so
-- owners can correct the InsightCard per-language.
--
-- The function writes into public.insights.i18n via jsonb_set. The BEFORE
-- trigger from 0037 keeps i18n->'en' mirrored into the scalar headline/body/
-- action_points columns, so the 4-arg legacy signature's behavior is
-- preserved when p_locale defaults to 'en'.
```
Apply: `0039_pipeline_runs_skeleton.sql` opens with the file name, a one-sentence purpose, then a comment block stating (a) skeleton scope per D-07, (b) Phase 13 will alter to add `restaurant_id` + `upstream_freshness_h`, (c) hybrid-RLS plan per D-08 (currently NON-tenant-scoped, no RLS policy yet — explicitly call out so future readers don't think it was forgotten).

**Concurrent-safe DDL idiom — pg_cron migrations** (0013 lines 49–60):
```sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-analytics-mvs') then
    perform cron.unschedule('refresh-analytics-mvs');
  end if;
end $$;

select cron.schedule(
  'refresh-analytics-mvs',
  '0 3 * * *',
  $job$select public.refresh_analytics_mvs();$job$
);
```
Phase 12 doesn't add a pg_cron job (the audit cron lives in GHA, not pg_cron) but use this `do $$ ... end $$` idempotent guard pattern if the migration ever needs to re-apply safely. For a plain `create table`, `create table if not exists public.pipeline_runs (...)` is sufficient.

**Permission lockdown idiom** (0010 lines 58–59 + 91–92):
```sql
-- Lock raw MV — wrapper view is the only tenant-facing read path (D-17/D-19)
revoke all on public.cohort_mv from anon, authenticated;
-- ...
revoke all on function public.refresh_cohort_mv() from public, anon, authenticated;
grant execute on function public.refresh_cohort_mv() to service_role;
```
Apply to `pipeline_runs` per D-08 (system table, no tenant access yet):
```sql
create table if not exists public.pipeline_runs (
  run_id              bigserial primary key,
  step_name           text not null,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  status              text,
  row_count           int,
  error_msg           text,
  commit_sha          text
);

-- Phase 12 D-08: NON-tenant-scoped skeleton. No restaurant_id column yet,
-- no RLS policy. Phase 13 alter-table adds restaurant_id + RLS + the
-- upstream_freshness_h numeric column (FND-09 audit posts on this skeleton
-- from week 1; the alter does NOT break the audit cron).
revoke all on public.pipeline_runs from anon, authenticated;
grant select, insert on public.pipeline_runs to service_role;
```

**Phase 13 hybrid-RLS forward-reference** — embed a comment block that documents the alter that's coming (so a planner reading 0039 alone doesn't bake assumptions). Model after 0010 line 61 ("Wrapper view — DO NOT set security_invoker (Pitfall 2)") in-line forward-ref style.

---

### `.github/workflows/its-validity-audit.yml` (CI cron + dispatch)

**Analog:** `.github/workflows/migrations.yml` (Supabase auth setup + linking) + `.github/workflows/deploy.yml` (workflow_dispatch + branches) + `.github/workflows/tests.yml` (env-var injection + `supabase/setup-cli@v1`).

**Triggers — combine `schedule` + `workflow_dispatch`** (deploy.yml lines 2–5 has dispatch; the cron form is canonical GHA):
```yaml
name: Deploy to Cloudflare Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
```
Translate (D-12 row 2 + D-06 cadence):
```yaml
name: ITS Validity Audit
on:
  schedule:
    - cron: '0 9 * * 1'   # Monday 09:00 UTC (D-12)
  workflow_dispatch:
```

**Job + steps shape** (migrations.yml lines 5–18):
```yaml
jobs:
  push:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Link DEV project
        run: supabase link --project-ref ${{ secrets.DEV_SUPABASE_PROJECT_REF }} --password ${{ secrets.DEV_SUPABASE_DB_PASSWORD }}
      - name: Push migrations to DEV
        run: supabase db push --password ${{ secrets.DEV_SUPABASE_DB_PASSWORD }} --yes
```
Translate to Python audit invocation:
```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    env:
      SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}
      GITHUB_SHA: ${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: 'pip'
      - name: Install audit deps
        run: pip install supabase python-dotenv
      - name: Run ITS validity audit
        run: python tools/its_validity_audit.py
```

**Critical:** per D-06 + specifics ("audit cron must not block downstream cascade") the `python tools/...` step's exit code does NOT need a `continue-on-error: true` shield — the script itself is contracted to exit 0 on findings (see `its_validity_audit.py` pattern above). Only infra failures cause non-zero exit, and those SHOULD page.

**Secret naming — match existing convention** from tests.yml lines 9–14 + migrations.yml line 9 (`DEV_SUPABASE_*`, `SUPABASE_ACCESS_TOKEN` are the sanctioned names; do not invent `AUDIT_SUPABASE_*`).

---

### `tests/ci-guards/red-team-tenant-id.sql` (test fixture)

**Analog:** `tests/unit/ci-guards.test.ts` — established the red-team fixture pattern (write evil file, assert guard throws, clean up).

**Red-team idiom** (ci-guards.test.ts lines 36–47):
```typescript
it('FAILS when src/ references cohort_mv', () => {
  mkdirSync(SRC_LIB, { recursive: true });
  writeFileSync(EVIL, "export const x = 'select * from cohort_mv';\n");
  expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).toThrow();
});

it("FAILS when src/ references .from('transactions')", () => {
  mkdirSync(SRC_LIB, { recursive: true });
  writeFileSync(EVIL, "supabase.from('transactions').select('*');\n");
  expect(() => execSync('bash scripts/ci-guards.sh', { stdio: 'pipe' })).toThrow();
});
```
Phase 12 inverts the placement: instead of an inline-written-then-deleted fixture inside a vitest test, it's a checked-in `.sql` file in `tests/ci-guards/` (NOT in `supabase/migrations/`). Per D-11 + the "Guard 7's negative test" specifics block, the fixture content is:
```sql
-- tests/ci-guards/red-team-tenant-id.sql
-- DELIBERATE-VIOLATION fixture for Guard 7. NEVER move this file into
-- supabase/migrations/. The Guard 7 unit test (tests/unit/ci-guards.test.ts
-- extension or a new file) copies this content into a temp file under
-- supabase/migrations/, runs scripts/ci-guards.sh, asserts fail=1, and
-- removes the temp file.

create view public.evil_v as
select *
from public.transactions x
where x.tenant_id::text = (auth.jwt()->>'tenant_id');
```
Path lives outside `supabase/migrations/` so `supabase db push` never picks it up. Per CONTEXT specifics ("the fixture itself NEVER lands in supabase/migrations/"), the Phase 12 plan must NOT add this path to `supabase/config.toml` or any push target.

**Companion test** — the planner extends `tests/unit/ci-guards.test.ts` (don't make a new file) with a Guard 7 case mirroring the existing `mkdirSync` + `writeFileSync` + `execSync` + `expect(...).toThrow()` shape. Re-read the analog at lines 28–53 for paste-and-adapt.

---

## Shared Patterns

### JWT-claim canonical form

**Source:** `supabase/migrations/0010_cohort_mv.sql` line 75; `supabase/migrations/0023_transactions_filterable_v_visit_seq.sql` line 31; `supabase/migrations/0026_transactions_filterable_v_drop_security_invoker.sql` line 37; `supabase/migrations/0014_data_freshness_v.sql` line 15.

**Apply to:** Guard 7 regex MUST match BOTH spacing variants (CONTEXT D-11). Concrete forms in current codebase:

```sql
-- 0010 — no space:
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

-- 0023 / 0026 / 0014 — one space on each side of ->>:
where t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');
```
Guard 7 regex sketch (planner refines): `auth\.jwt\(\)[[:space:]]*->>[[:space:]]*'tenant_id'`. The `[[:space:]]*` covers zero-or-more whitespace, future-proofing both forms.

### `::error::Guard N FAILED:` annotation format

**Source:** `scripts/ci-guards.sh` lines 22, 33, 43, 53, 65, 75, 84.

**Apply to:** Guards 7 + 8 message wording. Format is rigid: `::error::Guard <N> FAILED: <one-line cause>.` followed by an actionable hint where useful. GitHub Actions parses the `::error::` prefix and surfaces it as a job annotation.

### `commit_sha` audit column

**Source:** D-07 column list — `pipeline_runs.commit_sha text`. No prior column in the codebase.

**Apply to:** every row inserted into `pipeline_runs` from any GHA workflow MUST set `commit_sha = ${{ github.sha }}` via env var. Phase 12 establishes the pattern; Phase 13's `external-data-refresh.yml` follows it. The audit script reads `os.environ.get("GITHUB_SHA")` to honor it (locally it's `None`, which is fine — the column is nullable).

### `tools/` vs `scripts/` directory boundary

**Source:** CONTEXT D-04 + Integration Points.

**Apply to:** `tools/` holds repo-maintainer scripts that operate on existing data and post audit results (currently empty; `tools/its_validity_audit.py` is the first occupant). `scripts/` holds runtime extractors / ingest pipelines (`scripts/ingest/`) and CI helpers (`scripts/ci-guards/`). Guard 7's scan-path list per D-10 is the codified boundary — it deliberately EXCLUDES `tools/` because the audit script operates on the canonical `restaurant_id` columns and would never legitimately reference `tenant_id`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (Python idiom for audit script) | tool / data-audit | batch → DB write | First Python script in repo. TS prior-art (`scripts/ingest/`) gives the orchestrator shape; planner picks the Python idiom — `argparse` + `supabase-py` + stdlib `datetime` is the recommended baseline. |

The other 5 files all have at least a role-match analog. No file is starting from zero patterns.

## Metadata

**Analog search scope:**
- `scripts/` (full)
- `scripts/ci-guards/` (full)
- `scripts/ingest/` (TypeScript orchestrator + upsert)
- `.github/workflows/` (4 existing workflows)
- `supabase/migrations/` (recent: 0010, 0013, 0014, 0017, 0023, 0026, 0036, 0038)
- `tests/unit/ci-guards.test.ts` (red-team fixture pattern)

**Files scanned:** ~14 files read in full + directory listings of 5 dirs.

**Pattern extraction date:** 2026-04-28
