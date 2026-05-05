---
plan: 11
phase: 16
title: CI Guard 9 (raw-revenue Track-B) + Guard 10 (2026-04-14 literal) + red-team fixtures
status: complete
completed_at: 2026-05-03
subsystem: ci
tags: [ci, guards, lint, regression]
commits:
  - 3df60c1  # Task 1 — Guards 9 + 10 in scripts/ci-guards.sh + noqa annotation in +page.server.ts
  - 1d82181  # Task 2 — red-team fixture + harness for Guard 9 (incl. awk END-clobber bugfix)
  - e0325cd  # Task 3 — red-team fixture + harness for Guard 10
files_created:
  - tests/ci-guards/red-team-cf-revenue-eur.py
  - tests/ci-guards/red-team-campaign-literal.ts
  - tests/ci-guards/test_guard_9.sh
  - tests/ci-guards/test_guard_10.sh
files_modified:
  - scripts/ci-guards.sh
  - src/routes/+page.server.ts  # `// noqa: guard10` annotations on E2E-fixture-block lines
requirements: [UPL-02, UPL-03]
threats_mitigated: [T-16-05, T-16-06]
deviations:
  - rule: 3 (auto-fix blocking issue)
    type: pre-existing literals + Guard 10 false positive
    found_during: Task 1 verification
    issue: |
      Existing `src/lib/e2eChartFixtures.ts` (lines 55-56) and inline E2E
      fixture block in `src/routes/+page.server.ts` (lines 48-49) contained
      `2026-04-14` literals as test fixture data. The plan's acceptance
      criterion `bash scripts/ci-guards.sh exits 0 (current codebase
      post-Plan-09 has no violations)` could not be met as written. Plan 09
      SUMMARY explicitly flagged this would happen ("Plan 11 Guard 10 will
      need an explicit exemption for these fixture files").
    fix: |
      Guard 10 now (a) `--exclude=e2eChartFixtures.ts` for the dedicated
      fixture file (every line in that file is fixture data), and (b)
      supports a per-line `// noqa: guard10` opt-out for inline E2E
      fixture blocks. Annotated the two fixture lines in
      `+page.server.ts` (which sit inside an
      `if (process.env.E2E_FIXTURES === '1' && ...)` dead-code-in-prod
      branch) with `// noqa: guard10`.
    files_modified: [scripts/ci-guards.sh, src/routes/+page.server.ts]
    commit: 3df60c1
  - rule: 1 (auto-fix bug)
    type: awk END-block clobbered exit code
    found_during: Task 2 verification (test_guard_9.sh failed against
      the red-team fixture)
    issue: |
      First-pass Guard 9 awk script ended with `END { exit 0 }`. POSIX awk
      runs the END block AFTER a rule-level `exit n`, so `END { exit 0 }`
      overwrote the `exit 1` from the rule that detected the regression.
      Result: Guard 9 silently passed even when the red-team fixture was
      copied into `scripts/forecast/`.
    fix: |
      Replaced with sticky `hit` variable: rule-block sets `hit=1` and
      `exit 1`; END block does `exit hit`. Verified end-to-end:
      Guard 9 now correctly fails on fixture and passes on the green tree.
    files_modified: [scripts/ci-guards.sh]
    commit: 1d82181
key_decisions:
  - "Guard 10 uses dual-exclusion model: path-based `--exclude` for the
    dedicated E2E fixture file; per-line `// noqa: guard10` opt-out for
    inline fixture blocks. Mirrors the Guard 9 `# noqa: guard9` pattern
    from RESEARCH §6."
  - "Guard 9's PRIMARY enforcement is the DB CHECK constraint
    `forecast_daily_cf_not_raw_revenue` (Plan 07 / migration 0062);
    Guard 9 the awk lint is SECONDARY fast-fail for code review.
    RESEARCH §6 explicitly recommends this belt-and-suspenders split."
  - "Red-team fixture filenames live OUTSIDE the scan zone
    (`tests/ci-guards/` not `scripts/forecast/`, `.ts` extension under
    `tests/` not `src/`). Pitfall 2.6 (RESEARCH) — fixture paths must
    not poison the green branch."
metrics:
  duration_minutes: ~60
  tasks_completed: 3
  files_created: 4
  files_modified: 2
  commits: 3
---

# Phase 16 Plan 11: CI Guards 9 + 10 + red-team fixtures Summary

Two new CI guards land in `scripts/ci-guards.sh` — Guard 9 (Track-B fits
must never read raw `revenue_eur`) and Guard 10 (the `2026-04-14`
literal is forbidden in `src/`). Each guard ships with a red-team
fixture and a harness script that copies the fixture into the scan zone
temporarily, asserts the guard fires for the right reason, and cleans
up. Mitigates threats T-16-05 and T-16-06; covers requirements UPL-02
and UPL-03.

## What changed

### Task 1 — `scripts/ci-guards.sh` Guards 9 + 10 (`3df60c1`)

#### Guard 9: raw-revenue Track-B regression

Awk-windowed grep over `scripts/forecast/*.py`. Detects co-occurrence of
`forecast_track='cf'` and `kpi_name='revenue_eur'` within 50 lines.

```awk
BEGIN { hit = 0 }
/forecast_track[^=]*=[^=]*['"]cf['"]/ { cf_zone=NR }
/kpi_name[^=]*=[^=]*['"]revenue_eur['"]/ { rev_zone=NR }
cf_zone && rev_zone && (NR - cf_zone < 50) && (NR - rev_zone < 50) {
    printf "%s:%d: revenue_eur+forecast_track=cf co-occurrence\n", FILENAME, NR
    hit = 1
    exit 1
}
END { exit hit }
```

Per-file `# noqa: guard9` opt-out supported for documented false
positives. Heuristic — DB CHECK constraint
`forecast_daily_cf_not_raw_revenue` (Plan 07) is the airtight primary
enforcement.

#### Guard 10: 2026-04-14 literal forbidden in src/

```bash
grep -rnE "2026-?04-?14|April[[:space:]]+14[,]?[[:space:]]+2026" \
     --exclude='e2eChartFixtures.ts' \
     src/ 2>/dev/null \
| grep -v 'noqa:[[:space:]]*guard10'
```

Two-stage filter: `--exclude` removes the dedicated E2E fixture file;
post-filter `grep -v` drops any line carrying `// noqa: guard10`. Both
exclusions are intentionally narrow — production code paths are still
covered.

#### `src/routes/+page.server.ts` annotation

Two lines inside the `if (process.env.E2E_FIXTURES === '1' &&
url.searchParams.get('__e2e') === 'charts')` dead-code-in-prod branch
gained `// noqa: guard10` trailing comments. The block is unreachable
without an explicit env-var opt-in, so the literal is not a real
regression risk — but Guard 10 should still see it and the annotation
is the auditable opt-out.

### Task 2 — Guard 9 red-team (`1d82181`)

`tests/ci-guards/red-team-cf-revenue-eur.py` — minimal Python file
pairing `forecast_track='cf'` with `kpi_name='revenue_eur'` inside a
function body. Fixture is OUTSIDE `scripts/forecast/`, so production CI
does not scan it.

`tests/ci-guards/test_guard_9.sh` — copies the fixture into
`scripts/forecast/__guard9_redteam.py`, runs `scripts/ci-guards.sh`,
asserts non-zero exit AND that the failure was specifically `Guard 9
FAILED` (not some other guard tripping). `trap 'rm -f "$TARGET"' EXIT`
guarantees cleanup on every code path.

**Bugfix bundled in this commit:** First-pass Guard 9 had `END { exit
0 }` which clobbered the rule-block's `exit 1` per POSIX awk semantics.
Replaced with sticky `hit` variable. Without this fix Guard 9 silently
passed the red-team fixture — exactly the failure mode the harness
exists to prevent.

### Task 3 — Guard 10 red-team (`e0325cd`)

`tests/ci-guards/red-team-campaign-literal.ts` — TypeScript file with
`export const REGRESSION_DATE = '2026-04-14'`. Lives under
`tests/ci-guards/`, outside `src/`, so production CI does not scan it.

`tests/ci-guards/test_guard_10.sh` — same harness shape as
`test_guard_9.sh`. Copies the fixture into `src/lib/__guard10_redteam.ts`,
runs the full guard suite, asserts non-zero exit AND `Guard 10 FAILED`
in the log, and cleans up via trap.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Guards 9 + 10 land in script | `grep -c "Guard 9\|Guard 10" scripts/ci-guards.sh` | both strings present |
| Green codebase passes | `bash scripts/ci-guards.sh && echo "$?"` | exit 0 |
| Guard 9 fires on fixture | `bash tests/ci-guards/test_guard_9.sh && echo "$?"` | exit 0 (PASS message) |
| Guard 10 fires on fixture | `bash tests/ci-guards/test_guard_10.sh && echo "$?"` | exit 0 (PASS message) |
| Cleanup verified (g9) | `ls scripts/forecast/__guard9_redteam.py 2>/dev/null` | not found |
| Cleanup verified (g10) | `ls src/lib/__guard10_redteam.ts 2>/dev/null` | not found |
| No file deletions | `git diff --diff-filter=D --name-only HEAD~3 HEAD` | empty |

## Threats

| Threat | Mitigation status |
|--------|-------------------|
| T-16-05 (Tampering — Track-B raw-revenue regression) | mitigated. Guard 9 awk lint catches at CI; DB CHECK constraint catches at write (Plan 07). Red-team fixture verifies guard fires. |
| T-16-06 (Tampering — 2026-04-14 literal in src/) | mitigated. Guard 10 catches at CI. Red-team fixture verifies guard fires. Single allowed source of truth: `supabase/migrations/0058_campaign_calendar.sql` seed (and the dedicated E2E fixture file, which is dead code in prod). |

## Requirements

- **UPL-02** — covered (Guard 9 awk lint + DB CHECK make raw-revenue
  Track-B writes a CI-hard error).
- **UPL-03** — covered (Guard 10 forbids the campaign-date literal in
  `src/`; campaign date must come from `/api/campaign-uplift`).

## Known Stubs

None. Both guards run in production CI immediately on merge.

## Self-Check

- `scripts/ci-guards.sh` contains `Guard 9: raw-revenue Track-B regression`: FOUND
- `scripts/ci-guards.sh` contains `Guard 10: 2026-04-14 literal forbidden`: FOUND
- `scripts/ci-guards.sh` contains regex `2026-?04-?14|April[[:space:]]+14[,]?[[:space:]]+2026`: FOUND
- `tests/ci-guards/red-team-cf-revenue-eur.py` exists: FOUND
- `tests/ci-guards/red-team-campaign-literal.ts` exists: FOUND
- `tests/ci-guards/test_guard_9.sh` exists, executable: FOUND, mode 100755
- `tests/ci-guards/test_guard_10.sh` exists, executable: FOUND, mode 100755
- Commits `3df60c1`, `1d82181`, `e0325cd` exist in branch: FOUND
- `bash scripts/ci-guards.sh` on green tree: exit 0
- `bash tests/ci-guards/test_guard_9.sh`: exit 0
- `bash tests/ci-guards/test_guard_10.sh`: exit 0

## Self-Check: PASSED

## Next

Wave 4 plans 12 + 13 follow. Plan 12 generates the cutoff-sensitivity
log at `tests/forecast/cutoff_sensitivity.md`. Plan 13 extends
`forecast-refresh.yml` with the Track-B fit step + `cumulative_uplift.py`
step, then runs a DEV smoke test of the full nightly cascade.
