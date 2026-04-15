---
status: partial
phase: 05-insights-forkability
source: [05-06-PLAN.md]
started: 2026-04-15T00:00:00Z
updated: 2026-04-15T12:00:00Z
---

## Current Test

number: 3
name: Friend's iPhone sign-off on the InsightCard
expected: |
  Friend opens the dashboard on their iPhone, eye lands on InsightCard first,
  reads the headline without prompting, answers the "useful / already knew /
  confusing" question with a verbatim reaction.
awaiting: user to run the handoff with the friend and return the verbatim reaction

## Tests

### 1. GitHub repo metadata via gh CLI
expected: `gh repo view --json visibility,repositoryTopics,description` shows 9 topics + description
result: pass
note: |
  Repo kept intentionally PRIVATE (not PUBLIC as plan assumed). Topics +
  description set via `gh repo edit`. Public-flip deferred — see Test 2.

### 2. Fresh-clone fork walkthrough on throwaway Supabase project
expected: End-to-end clone → fork-dryrun.sh → README Phase 1..Ship → InsightCard visible in <45min
result: skipped
reason: |
  User has explicitly deferred this until the repo flips public. The repo is
  intentionally PRIVATE for v1 — the fork-walkthrough validates the
  public-forkability claim (INS-05 marketing surface), which is a post-v1
  decision, not a ship blocker for putting the card in the friend's hands.
  This UAT item must be re-opened BEFORE any future
  `gh repo edit --visibility public` flip. Until then, `scripts/fork-dryrun.sh`
  (already green as of 05-05) is the canonical forkability smoke test.
deferred_until: "public visibility flip"
tracked_requirement: INS-05

### 3. Friend's iPhone sign-off on the InsightCard
expected: |
  Friend opens DEV URL on iPhone Safari → InsightCard renders → friend reads
  headline aloud → answers the 4-question script with a verbatim reaction.
result: [pending]
blocked_by: human-action (user must physically hand phone to friend)

## Summary

total: 3
passed: 1
issues: 0
pending: 1
skipped: 1 (deferred)
blocked: 0

## Gaps

<!-- No failed gaps yet. Test 2 is a deferred scope item, not a failure. -->
