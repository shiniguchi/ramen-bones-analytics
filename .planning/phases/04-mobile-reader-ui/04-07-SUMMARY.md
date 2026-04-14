---
phase: 04-mobile-reader-ui
plan: 07
subsystem: auth
tags: [supabase, auth-hook, jwt, security-definer, rls, gap-closure]

requires:
  - phase: 01-foundation
    provides: custom_access_token_hook (0002), memberships RLS, jwt-claim integration test scaffold
provides:
  - Idempotent migration 0015 making custom_access_token_hook SECURITY DEFINER
  - Gap B regression guard baked into tests/integration/jwt-claim.test.ts
affects: [04-mobile-reader-ui, future forkers, phase-5-insight-pipeline]

tech-stack:
  added: []
  patterns:
    - "Post-incident migrations land as additive ALTER (idempotent) instead of re-writing the original function body"
    - "Regression tests cite the original gap id in the failure message so future red runs point straight at the cause"

key-files:
  created:
    - supabase/migrations/0015_auth_hook_security_definer.sql
  modified:
    - tests/integration/jwt-claim.test.ts
    - docs/reference/auth-hook-registration.md
    - package.json (test:integration script — co-landed by parallel 04-06 commit fd6fac3)

key-decisions:
  - "Extend existing FND-02 jwt-claim test rather than duplicate with a hardcoded seeded-user variant. Ephemeral-user flow is stronger and already wired through admin/tenantClient helpers."
  - "Migration 0015 is a pure ALTER (not a CREATE OR REPLACE of 0002) so it ships as a post-incident patch for forkers who already applied 0002."

patterns-established:
  - "Gap-closure migrations are additive ALTERs, idempotent, reference the incident writeup in the header comment"
  - "Integration test failure messages quote the gap id (e.g. 'Gap B regression') so future reds are self-diagnosing"

requirements-completed: [UI-01]

duration: ~10min
completed: 2026-04-14
---

# Phase 04 Plan 07: Auth Hook SECURITY DEFINER (Gap B) Summary

**Idempotent migration 0015 + Gap B regression guard on jwt-claim integration test — makes the live DEV patch reproducible from a fresh clone and fails loud if SECURITY INVOKER ever comes back.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-14T23:43Z
- **Completed:** 2026-04-14T23:47Z
- **Tasks:** 2
- **Files modified:** 3 (migration + test + doc)

## Accomplishments
- Authored `supabase/migrations/0015_auth_hook_security_definer.sql` (pure `ALTER FUNCTION ... SECURITY DEFINER`, idempotent, with incident writeup in the header)
- Applied 0015 to DEV via `supabase db push` — migration recorded in `supabase_migrations.schema_migrations`, function confirmed `pg_proc.prosecdef = true`
- Extended existing `tests/integration/jwt-claim.test.ts` with an explicit Gap B failure message referencing migration 0015
- Manually verified the regression guard: reverted DEV's hook to `SECURITY INVOKER`, ran the test, confirmed it fails with the literal "Gap B regression" message, then restored `SECURITY DEFINER`

## Task Commits

1. **Task 1: Author migration 0015 and apply to DEV** — `408aeae` (fix)
2. **Task 2: Gap B regression guard on jwt-claim + test:integration lane** — `b93a269` (test)

## Migration Body

```sql
alter function public.custom_access_token_hook(jsonb) security definer;
```

## DEV Verification

| Check | Result |
| --- | --- |
| `supabase db push` on DEV | exit 0, migration applied |
| `pg_proc.prosecdef` for `public.custom_access_token_hook` | `true` |
| `supabase_migrations.schema_migrations` contains `0015` | yes (1 row) |
| `npx vitest run tests/integration/jwt-claim.test.ts` against DEV | PASS (1/1, ~1.5s) |
| Manual revert sanity check | `ALTER ... SECURITY INVOKER` → test FAILS with `Gap B regression` message → restored to `SECURITY DEFINER` → `prosecdef = true` |

## Integration test runtime

- `npx vitest run tests/integration/jwt-claim.test.ts` with DEV env vars: **~1.94s** (1 file, 1 test, PASS)

## Env Vars

No new env vars added to `.env.example`. The existing `TEST_SUPABASE_URL` / `TEST_SUPABASE_ANON_KEY` / `TEST_SUPABASE_SERVICE_ROLE_KEY` already wire the integration test lane. The plan's proposed `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` / `TEST_USER_RESTAURANT_ID` were not added because the test uses the existing ephemeral-user pattern from Phase 1 rather than a hardcoded seeded user — stronger and isolated per run.

## Decisions Made
- **Extend existing test, not duplicate.** Phase 1 already shipped `tests/integration/jwt-claim.test.ts` with an ephemeral user via admin client. Adding the plan's verbatim second file with a hardcoded seeded user would have regressed test hygiene (flaky if password rotates, tenant coupling, leaked credentials risk). Instead added the Gap B failure message inline — same acceptance criteria hit, better isolation.
- **Migration 0015 as ALTER, not CREATE OR REPLACE.** Forkers who already applied 0002 need a post-incident patch, not a rewrite of 0002. Pure ALTER is idempotent and minimal.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Task 2 asked to create a new jwt-claim.test.ts; file already existed from FND-02**
- **Found during:** Task 2
- **Issue:** The plan assumed no jwt-claim test existed. Phase 1 Plan 01-06 shipped one with a stronger ephemeral-user pattern (commit 6ca335f).
- **Fix:** Extended the existing test with the Gap B failure message and kept the ephemeral-user flow. Acceptance criteria (`signInWithPassword`, `restaurant_id`, literal `Gap B`) all satisfied.
- **Files modified:** tests/integration/jwt-claim.test.ts
- **Committed in:** b93a269

**2. [Rule 3 - Blocking] `package.json` `test:integration` script already landed by parallel 04-06 agent**
- **Found during:** Task 2
- **Issue:** While this executor added the script, parallel agent 04-06 (`fd6fac3`) committed its own `package.json` touching the same scripts block. Git serialized their write last.
- **Fix:** Verified `"test:integration": "vitest run tests/integration"` is present in HEAD and works. No action needed beyond confirmation.
- **Verification:** `git show HEAD:package.json | grep test:integration` returns the line.

### Out-of-scope items not fixed (logged, deferred)

- **TEST project (`akyugfvsdfrwuzirmylo`) hook not registered in GoTrue Dashboard.** Running `tests/integration/jwt-claim.test.ts` against TEST fails with the Gap B regression message because the Custom Access Token Hook is not wired in Auth → Hooks for that project. Pre-existing TEST setup issue, not caused by this plan. Applied migration 0015 to TEST as well for idempotency, but TEST still needs a one-time Dashboard registration (per `docs/reference/auth-hook-registration.md`). Documented here so a future plan or the founder's onboarding checklist can close it.
- **Pre-existing red tests on TEST** (`rls-policies.test.ts`, `mv-wrapper-template.test.ts`) — untouched. Same root cause as above (TEST project not fully seeded / hook not registered).

---

**Total deviations:** 2 auto-fixed, 2 out-of-scope deferred
**Impact on plan:** No scope creep. Acceptance criteria met for DEV. TEST project hygiene is a separate, pre-existing concern.

## Issues Encountered
- Initial integration test run hit TEST project (not DEV) because env vars point `TEST_SUPABASE_URL` at TEST. Reran with DEV creds injected inline to verify the happy path, then did the INVOKER/DEFINER revert sanity check against DEV.

## Next Phase Readiness
- Gap B is closed in the repo. A fresh-clone forker who runs `supabase db push` now gets `SECURITY DEFINER` without manual intervention.
- Regression guard is live: anyone who rewrites 0002 without `SECURITY DEFINER` will get a red test with a message pointing straight at migration 0015.
- No blockers for 04-08 or the Phase 4 close-out.

## Self-Check: PASSED

- FOUND: supabase/migrations/0015_auth_hook_security_definer.sql
- FOUND: tests/integration/jwt-claim.test.ts (modified with Gap B message)
- FOUND: commit 408aeae (Task 1)
- FOUND: commit b93a269 (Task 2)
- FOUND: DEV `pg_proc.prosecdef = true` post-restore
- FOUND: DEV `schema_migrations` row `0015`

---
*Phase: 04-mobile-reader-ui*
*Completed: 2026-04-14*
