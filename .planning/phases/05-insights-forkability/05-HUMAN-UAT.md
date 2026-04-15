---
status: complete
phase: 05-insights-forkability
source: [05-06-PLAN.md]
started: 2026-04-15T00:00:00Z
updated: 2026-04-15T12:00:00Z
---

## Current Test

all tests resolved — phase 5 shipped on 2026-04-15

## Tests

### 1. GitHub repo metadata via gh CLI
expected: `gh repo view --json visibility,repositoryTopics,description` shows 9 topics + description
result: pass
note: |
  9 topics + description set via `gh repo edit`. Repo flipped PUBLIC on
  2026-04-15 (user-approved during 05-06 interactive execution). Public flip
  does NOT re-open Test 2 — forkability is explicitly out of v1 scope per
  user direction.

### 2. Fresh-clone fork walkthrough on throwaway Supabase project
expected: End-to-end clone → fork-dryrun.sh → README Phase 1..Ship → InsightCard visible in <45min
result: skipped
reason: |
  Deferred out of v1 scope per user direction: forkability is not a v1
  concern. The v1 audience is a single restaurant (the founder's friend),
  not a hypothetical stranger forking the repo. Running a 30-60 minute
  clean-clone walkthrough to validate README accuracy for users who do not
  yet exist spends real time on a hypothetical. `scripts/fork-dryrun.sh`
  (green as of 05-05) remains the canonical forkability smoke test at CI
  level. Revisit this item only if/when onboarding other restaurants
  becomes an explicit goal.
deferred_until: "onboarding a second restaurant (or explicit public launch push)"
tracked_requirement: INS-05

### 3. Friend's iPhone sign-off on the InsightCard
expected: |
  Friend opens DEV URL on iPhone Safari → InsightCard renders → friend reads
  headline aloud → answers the 4-question script with a verbatim reaction.
result: pass
verbatim: "could see the chart too"
verified: 2026-04-15
note: |
  All 3 prerequisite gaps closed by 05-07 (CF Pages deploy), 05-08 (friend
  auth provisioned), and 05-09 (non-zero insight seeded). Friend successfully
  viewed the InsightCard and the chart stream on their iPhone. Core Value
  test passed. Any deeper UX feedback routes to v1.1 Dashboard Redesign
  milestone, not Phase 5 gap closure.

## Summary

total: 3
passed: 2
issues: 0
pending: 0
skipped: 1 (deferred out of v1 scope)
blocked: 0

## Gaps

### Gap 1: No deployed HTTPS URL exists
status: resolved
severity: blocker
discovered: 2026-04-15
discovered_by: 05-06 Task 3 prerequisite check
description: |
  The app only runs on `localhost:5173` via `npm run dev`. No Cloudflare Pages
  deployment exists. Phase 4 (04-09-SUMMARY.md, 04-HUMAN-UAT.md) explicitly
  noted "no deployed DEV URL exists" and deferred to "the eventual Cloudflare
  Pages DEV deployment" — but no phase has actually built that deployment.
  Phase 5 inherited the gap silently. Task 3 ("friend opens dashboard on iPhone")
  is unexecutable until an HTTPS URL exists.
fix: |
  Wire `wrangler pages deploy` (or connect the new private GitHub repo to a CF
  Pages project), bind PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY
  as environment variables, deploy, capture the *.pages.dev URL.
references:
  - .planning/phases/04-mobile-reader-ui/04-09-SUMMARY.md (line 111)
  - .planning/phases/04-mobile-reader-ui/04-HUMAN-UAT.md (line 82)

### Gap 2: Friend's Supabase auth account not provisioned
status: resolved
severity: blocker
discovered: 2026-04-15
discovered_by: 05-06 Task 3 prerequisite check
description: |
  Phase 1 D-10 stated "founder pre-creates the friend's user via the Supabase
  dashboard and shares credentials" but no record exists that this was actually
  done. The seeded test user `iguchise@gmail.com` is the user's own dev
  account, NOT the friend. Without a real Auth user + a `memberships` row
  linking that user to the seeded restaurant, sign-in lands on
  `/not-provisioned`.
fix: |
  1. Create the friend's user in Supabase Dashboard → Authentication → Users
  2. Insert a row into public.memberships linking the new user_id to
     restaurant_id ba1bf707-aae9-46a9-8166-4b6459e6c2fd with role='owner'
  3. Verify custom_access_token_hook mints a JWT with restaurant_id
  4. Verify sign-in lands on the dashboard, not /not-provisioned
  5. Share credentials with the friend via secure channel
references:
  - supabase/migrations/0005_seed_tenant.sql (membership-not-seeded note)
  - .planning/phases/01-foundation/01-CONTEXT.md (D-10)

### Gap 3: Seed insight is the degenerate "€0" fallback
status: resolved
severity: high
discovered: 2026-04-15
discovered_by: 05-06 Task 3 prerequisite check
description: |
  The only row in public.insights on DEV (id f4b38986-9816-462c-b126-834e7d35a1bb,
  business_date 2026-04-15) was written by 05-03's smoke test via the fallback
  template path because DEV has zero transactions for today's business_date
  (April 2026 Worldline blackout — see 02-04 STATE decisions). Headline reads
  "No transactions recorded today — €0 over the prior week." Body reads
  "Week-to-date revenue is €0 (— 0% vs prior week). No repeat customers in the
  last week." Technically accurate but a terrible first impression — Task 3 is
  meant to test "does a non-technical owner read the story and make a
  decision," but there is no story in a zero-data card. The friend would
  reasonably conclude the app is broken.
fix: |
  1. Either backfill DEV with synthetic recent transactions (50+ rows across
     the past 14 business_days) OR generate enough rows for the past 7 days
     to produce a non-zero LTV/cohort signal
  2. Refresh the materialized views (or wait for the nightly cron)
  3. Manually invoke generate-insight via curl
  4. Verify the new row has fallback_used=false (LLM path) and a non-zero
     headline that mentions a real number
  5. Confirm InsightCard renders the new row, not the old one
references:
  - .planning/phases/05-insights-forkability/05-03-SUMMARY.md (smoke test origin)
  - .planning/phases/02-ingestion/02-04-REAL-RUN.md (Worldline blackout context)
  - tests/ingest/fixtures/sample.csv (synthetic seed candidate)
