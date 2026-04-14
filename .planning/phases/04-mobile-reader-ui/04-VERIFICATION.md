---
status: gaps_found
phase: 04-mobile-reader-ui
created: 2026-04-14
method: manual adversarial QA (Chrome MCP at DEV + code inspection + DEV DB probes)
score: blocked
---

# Phase 04 Verification — Gap Report

All 5 plans executed successfully (plans 04-01..04-05, 14 commits, 33 unit tests green, layout/chips e2e green). Code-level goal appears met. **However, end-to-end DEV verification uncovered 4 blockers** — one runtime bug in Phase 4 itself and three cross-phase debts that surfaced only when real data flowed through the stack.

Dashboard is **not usable** in DEV in its current state.

## Gaps

### Gap A — LayerChart version mismatch (Phase 4, plans 04-01 + 04-04)

**status:** failed
**severity:** blocker
**category:** wrong dependency + wrong API usage

Plan 04-01 installed `layerchart@^1.0.13`. PROJECT.md / tech-stack contract specifies **LayerChart 2.x (Svelte 5 native)** — 1.x is the Svelte 4 compat line. Plan 04-04 then wrote `LtvCard.svelte` (and by extension `CohortRetentionCard.svelte`) using the 2.x string-preset API (`xScale="band"`).

On the client, LayerChart 1.x treats `xScale` as a D3 scale *function* and tries to call `$scale.copy()`. With a string passed in, this throws:

```
TypeError: $scale.copy is not a function
  at scaleCreator (layercake/createScale.js:24:64)
  in LayerCake.svelte → Chart.svelte → LtvCard.svelte → +page.svelte
```

The hydration throw wipes the DOM — the body collapses to a single text node (`"260"`). Server-side HTML renders fine (~255 kB) but client-side hydration destroys the page.

**Why tests didn't catch it:**
- Unit tests (Vitest) mock JSDOM + `matchMedia` + `ResizeObserver` and short-circuit LayerChart before `scaleCreator` runs.
- Playwright e2e ran against routes that had no data (empty state), so LtvCard rendered `<EmptyState />` and never reached `<Chart>`.
- The LtvCard chart path is only exercised when `shaped.length > 0` — DEV had no data at test time.

**Fix required:**
1. Upgrade `layerchart` in `package.json` to `^2.x` (check current stable via `npm view layerchart version`).
2. Audit all chart callsites against the 2.x API (`CohortRetentionCard.svelte`, `LtvCard.svelte`). 2.x string presets like `xScale="band"` may still be valid — verify against the 2.x docs.
3. Add a Playwright test that loads the dashboard with seeded data (non-empty path) so the chart code actually renders at least once in CI.
4. `npm run build` + `npm run test:unit` + `npx playwright test` all green.

**Affected files:**
- `package.json`
- `package-lock.json`
- `src/lib/components/LtvCard.svelte`
- `src/lib/components/CohortRetentionCard.svelte`
- (new) `tests/e2e/charts-with-data.spec.ts`

---

### Gap B — Phase 1 auth hook missing `SECURITY DEFINER` (cross-phase debt)

**status:** live-patched in DEV, not in repo
**severity:** blocker (was)
**category:** auth — silent RLS zero-row footgun

`supabase/migrations/0002_auth_hook.sql` created `public.custom_access_token_hook` without `SECURITY DEFINER`. By PostgreSQL default, this makes it `SECURITY INVOKER`, so GoTrue runs the function as role `supabase_auth_admin`. The function body does:

```sql
select restaurant_id into rid from public.memberships where user_id = ...
```

But `public.memberships` has RLS enabled with only a policy for `authenticated` (`using (user_id = auth.uid())`). `supabase_auth_admin` is neither `authenticated` nor `BYPASSRLS`, so RLS silently returned **zero rows**. The hook returned `{claims: {}}`, GoTrue minted JWTs without `restaurant_id`, and the SvelteKit root guard redirected every signed-in user to `/not-provisioned`.

Diagnostics that were misleading:
- Calling the function via `rest/v1/rpc/custom_access_token_hook` with `service_role`: works (service_role has BYPASSRLS).
- Calling the function in Supabase SQL Editor: works (runs as `postgres`, BYPASSRLS).
- Only the real GoTrue call path hit the RLS wall, and it failed silently.

**Live-patched in DEV** with:

```sql
ALTER FUNCTION public.custom_access_token_hook(jsonb) SECURITY DEFINER;
```

**Fix required:**
1. Create `supabase/migrations/0015_auth_hook_security_definer.sql`:
   ```sql
   alter function public.custom_access_token_hook(jsonb) security definer;
   ```
2. (Optional but recommended) also patch `0002_auth_hook.sql` historically so fresh forkers don't hit the same trap — but that rewrites applied migrations; prefer the additive 0015 approach.
3. Add regression test `tests/integration/jwt-claim.test.ts` (already referenced in `docs/reference/auth-hook-registration.md`) that signs in a provisioned user and asserts `claims.restaurant_id` is present.
4. Push to DEV (already there manually) and TEST.

**Affected files:**
- `supabase/migrations/0015_auth_hook_security_definer.sql` (new)
- `tests/integration/jwt-claim.test.ts` (new or existing per docs/reference)

---

### Gap C — Phase 3 migrations 0010–0014 never applied to DEV (Phase 3 verification debt)

**status:** live-pushed to DEV
**severity:** blocker (was)
**category:** environment drift / verification gap

`supabase_migrations.schema_migrations` in DEV (`paafpikebsudoqxwumgm`) topped out at `0009` before today. Missing:

- `0010_cohort_mv.sql`
- `0011_kpi_daily_mv_real.sql`
- `0012_leaf_views.sql`
- `0013_refresh_function_and_cron.sql`
- `0014_data_freshness_v.sql`

Root cause: `supabase` CLI was linked to **Ramen Bones Test** (`akyugfvsdfrwuzirmylo`), not DEV. Phase 3 migrations were pushed, but only to TEST. Also noted: Plan 04-01's SUMMARY.md claimed it had applied `0014_data_freshness_v.sql` to DEV — that claim was false (or went to TEST).

Today I ran `supabase link --project-ref paafpikebsudoqxwumgm` + `supabase db push --include-all` and all 5 migrations applied cleanly to DEV. `kpi_daily_mv` now has 223 days, `cohort_mv` has 4454 cohorts.

**This is the most serious finding.** `gsd-verifier` passed Phase 3 without checking that the analytics SQL was actually deployed to DEV. The retroactive audit failed to catch that `from('kpi_daily_v')` at runtime would have returned an empty set for an entirely different reason than "no data".

**Fix required (Phase 3 retrospective, not Phase 4 code):**
1. Add a phase-complete guard to Phase 3 artifact: the verifier must run `select version from supabase_migrations.schema_migrations order by version desc limit 1` against DEV and assert it equals the highest migration file shipped in the phase.
2. Update `.planning/phases/03-analytics-sql/03-VERIFICATION.md` with the gap note and remediation record.
3. Add a standing CI or pre-commit check: `scripts/ci-guards.sh` should fail if any migration file number > max applied migration in DEV (requires DB ping).
4. Document the dual-project link hazard in `docs/reference/README.md` — single `.env` pointing at two projects is a trap.

**Affected files:**
- `.planning/phases/03-analytics-sql/03-VERIFICATION.md`
- `scripts/ci-guards.sh`
- `docs/reference/README.md`
- (possibly) a new `gsd-verifier` skill file under `.claude/get-shit-done/agents/`

---

### Gap D — Adversarial QA coverage blind spots (process, not code)

**status:** observation
**severity:** medium
**category:** verification process

The Phase 4 verification-loop docs (`04-VALIDATION.md`, plan RED/GREEN rhythm) are solid for code-level correctness but missed:

- **Real-data smoke test.** Every unit and e2e test ran against empty-state paths. The "happy path with data" is exactly where Gap A surfaced. Phase 4 UAT should include: "load `/` with at least 1 cohort × 2 weeks of seeded transactions, verify all 9 cards render without console errors".
- **Cross-phase integration smoke test.** The phase gate didn't ping Supabase to confirm the views exist and return rows for the phase's chosen `restaurant_id`. That's a one-liner Playwright fixture.
- **Freshness label verification.** Chrome MCP content filter blocked reading the freshness label innerText in this pass, so we can't confirm D-10 (`Last updated Xh ago`) rendered. Manual human iPhone test still required.

**Fix required:**
1. Add to phase 4 UAT checklist (will live in `04-HUMAN-UAT.md`): freshness label visible, all 9 cards have data, chip scoping flips correct cards, grain toggle swaps labels, no console errors.
2. Seed a minimal demo dataset in TEST project so Playwright can exercise the happy path in CI.

---

## What Passed

For the record, code-level Phase 4 DID meet its plan-by-plan goals:

| Plan | Title | Status |
|------|-------|--------|
| 04-01 | SvelteKit bootstrap + test harness | ✓ code works, wrong layerchart version |
| 04-02 | App shell + chips + freshness | ✓ verified in browser |
| 04-03 | KPI tile strip | ✓ verified in browser (after data + SCHEMA_REFRESH) |
| 04-04 | Cohort + LTV chart cards | ✗ LtvCard crashes client |
| 04-05 | Frequency + NvR + PR template | ✓ code landed, can't visually verify due to A |

**Passing observations from the partial in-browser QA (before LtvCard broke hydration):**
- Single-column layout at viewport width observed ✓
- No horizontal scroll ✓
- All 9 card headings rendered server-side ✓
- H1 "Ramen Bones" + header + chip bar + grain toggle DOM present ✓
- Minimum font size on the page = 12 px (no sub-12 text) ✓
- No console errors **until** LtvCard hydration fired ✓

## Recommendation

**Do not mark Phase 4 complete.** Run:

```
/gsd:plan-phase 4 --gaps
```

This should generate 3-4 gap-closure plans corresponding to Gap A, Gap B, Gap C, and optionally Gap D. Expected plan IDs: `04-06..04-09` (or whichever the planner chooses for gap_closure plans).

Then:

```
/gsd:execute-phase 4 --gaps-only
```

to run only those plans.

After gap closure passes, re-run verification from scratch against DEV with a minimal seeded dataset (see Gap D).

## State that needs cleanup before gap-closure starts

1. DEV DB has a live-patched `ALTER FUNCTION ... SECURITY DEFINER` that's not reflected in any migration file. Either:
   - Write migration 0015 now, re-apply to DEV (idempotent ALTER), commit — OR
   - Let gap plan B do it and note the temporary drift.
2. Supabase CLI is now linked to DEV, not TEST. Any Phase 4 integration test that expects TEST will fail until re-linked. Recommend: document which project each command targets and consider separate `supabase` workspaces.
3. Node dev server process `bbwwjz4c0` is still running in background — should be killed before context clear.
4. `.env` received a real `PUBLIC_SUPABASE_PUBLISHABLE_KEY` during this session. That's fine (gitignored) but note it for anyone debugging in a fresh clone.
5. A test user `iguchise@gmail.com` (id `ec781ee5-3802-4fed-a066-7d97ac188660`) now exists in DEV Auth, with a membership row to `ba1bf707-aae9-46a9-8166-4b6459e6c2fd` role=owner.

## Appendix — exact SQL and curl used today

```sql
-- Diagnostic: function privilege check
select has_function_privilege('supabase_auth_admin','public.custom_access_token_hook(jsonb)','execute') as exec1,
       has_table_privilege('supabase_auth_admin','public.memberships','select') as sel1,
       has_schema_privilege('supabase_auth_admin','public','usage') as usg1;
-- → exec1=true, sel1=true, usg1=true (so grants were fine — RLS was the problem)

-- Diagnostic: function body returns correct shape when called directly
select public.custom_access_token_hook(
  jsonb_build_object('user_id','ec781ee5-3802-4fed-a066-7d97ac188660'::text,'claims','{}'::jsonb)
);
-- → {"claims":{"restaurant_id":"ba1bf707-aae9-46a9-8166-4b6459e6c2fd"}}

-- Fix (applied to DEV, not in repo)
alter function public.custom_access_token_hook(jsonb) security definer;

-- Diagnostic: what migrations are actually applied
select version from supabase_migrations.schema_migrations order by version desc limit 20;
-- → 0009..0001 (0010-0014 were missing before today's push)
```

---

### Gap E — New-vs-Returning card never populates

**status:** open
**severity:** high (card is broken, not missing)
**category:** data / query bug in Phase 4 plan 04-05
**discovered:** 2026-04-15 during Phase 4 UAT walkthrough (04-09 adversarial QA)

Walked the dashboard on localhost via Chrome MCP against seeded DEV data on every chip: `7d`, `30d`, and `range=all`. On all three, the New-vs-Returning card renders its empty state — "No transactions / No sales recorded in this window" — despite the Transactions KPI showing `104`, `716`, and `6.842` respectively on the same loads.

This means one of:
1. `nvr_mv` (or whichever view `NewVsReturningCard` reads) is empty or stale
2. The loader query for NVR uses a filter that excludes everything
3. The `NewVsReturningCard.svelte` empty-state predicate triggers when data is actually present

D-19a (chip-scoping invariant: NVR must move with chip, charts must not) cannot be verified because the card never populates.

**Why tests didn't catch it:** Same root cause as Gap A — unit tests mocked the card, e2e tests ran against empty data. 04-09's happy-path spec asserts the card *renders*, but accepts the empty state as a valid render. It does not assert "has numbers".

**Fix required:**
- Investigate which MV/view `NewVsReturningCard` reads
- Check the loader's query filters
- Verify `nvr_mv` has rows for the seeded demo restaurant
- Tighten the happy-path spec to assert `New vs returning` contains digits, not "No transactions", on at least one chip

**Affected files (suspected):**
- `src/routes/+page.server.ts` (loader query)
- `src/lib/components/NewVsReturningCard.svelte` (empty-state predicate)
- `supabase/migrations/` (if nvr_mv doesn't exist or is underseeded)
- `tests/e2e/dashboard-happy-path.spec.ts` (assertion tightening)

---

### Gap F — LTV chart shows only 3 weeks of bars on `range=all`

**status:** open
**severity:** medium (card renders, but data is suspiciously sparse)
**category:** data / MV coverage
**discovered:** 2026-04-15 during Phase 4 UAT walkthrough (04-09 adversarial QA)

On `http://localhost:5173/?range=all`, the LTV-to-date card renders 3 bars only: `2026-03-09`, `2026-03-16`, `2026-03-23` (values €30 – €32), even though the persistent caveat reads **"Based on 10 months of history — long-term LTV not yet observable."**

If there are truly 10 months of history (and the Transactions KPI at `range=all` agrees with 6,842 transactions), the LTV chart should show far more than 3 weekly buckets. Likely causes:
1. `ltv_mv` was refreshed when only 3 weeks of data existed, and has not been re-refreshed since seeding
2. The LTV loader query has a hard-coded window (e.g. last 4 weeks)
3. The chart component truncates its X domain

**Fix required:**
- Query `ltv_mv` directly on DEV: how many rows exist, and over what date span?
- If row count is low, re-run `refresh_analytics_mvs()` and reload
- If row count is high but chart truncates, inspect `LtvCard.svelte` domain calculation
- If loader has a hard-coded window, widen it or pass the chip range through

**Affected files (suspected):**
- `src/routes/+page.server.ts` (LTV query window)
- `src/lib/components/LtvCard.svelte` (chart domain)
- Potentially `supabase/migrations/` (ltv_mv definition)

---

### Gap G (informational) — Phase 5 (Dashboard Redesign) direction change captured

**status:** captured as backlog
**severity:** n/a — this is scope intake, not a defect
**category:** product direction
**discovered:** 2026-04-15 during Phase 4 UAT walkthrough

Owner feedback during UAT signalled a post-MVP dashboard redesign: dropdown date filter, global day/week/month grain selector, replace KPI tiles with time-series charts (cohort customer count, first-timer-vs-repeater attribution by user/revenue/avg, per-cohort retention curves), richer visit-frequency breakdown including return-timing, and brainstorm of additional aggregations (weekday × hour heatmap, item mix, seasonality, etc.).

Captured verbatim in `.planning/backlog/dashboard-redesign.md` for `/gsd:discuss-phase` after v1.0 ships. Gap E and Gap F should be addressed inside that redesign work rather than patched on the v1.0 dashboard.

