# CF Pages Decision for Phase 10 UAT

**Path chosen:** A (already unblocked)

**Commit originally flagged:** a3623b9 — `feat(05-09): add idempotent seed-recent-transactions.sql for gap 3 closure` (2026-04-15)

**Root cause (historical):** At the time Phase 06 Plan 05 deferred its human UAT, no `.github/workflows/deploy.yml` existed — commits after a3623b9 accumulated without any CI path publishing to Cloudflare Pages.

**Fix already applied (not by this task):** On 2026-04-15 22:25 UTC, commit `24481554088` ("ci: add CF Pages deploy workflow") landed a working `deploy.yml` using `cloudflare/wrangler-action@v3`. Every subsequent push to `main` has deployed successfully:

| Date (UTC)            | Workflow run | Status  | Deploy URL                                            |
| --------------------- | ------------ | ------- | ----------------------------------------------------- |
| 2026-04-17 00:47      | 24541822878  | success | https://0c11e6dc.ramen-bones-analytics.pages.dev      |
| 2026-04-17 00:00      | 24540362909  | success | main branch                                           |
| 2026-04-15 23:01      | 24482789461  | success | main branch                                           |
| 2026-04-15 22:56      | 24482612504  | success | main branch                                           |
| 2026-04-15 22:25      | 24481554088  | success | (workflow added here)                                 |

**Verification (from `gh run list --workflow=deploy.yml --limit=5`):** last 5 deploys all succeeded; most recent deploy log confirms `✨ Deployment complete! Take a peek over at https://0c11e6dc.ramen-bones-analytics.pages.dev`.

**Phase 10 UAT runs against:** the CF Pages preview URL for whichever branch is merged to `main`. Phase 10 branch work (currently on `gsd/v1.2-dashboard-simplification-visit-attribution`) deploys to DEV automatically once merged. No local-preview workaround needed.

**Branch-scope nuance (not a blocker):** `deploy.yml` triggers only on `push` to `main` (plus `workflow_dispatch`). Phase branches do not auto-deploy — this is intentional and does not require fixing. When Phase 10 is ready for 375px UAT, either:
1. Merge the phase branch to `main` (standard flow — auto-deploy fires), or
2. Run `gh workflow run deploy.yml --ref gsd/v1.2-dashboard-simplification-visit-attribution` for an out-of-band deploy.

**STATE.md follow-up:** Blocker entry "CF Pages deploy pipeline broken since a3623b9" is STALE and should be removed. Tracked in state update at the end of this plan.

**Hygiene flag (not urgent):** wrangler-action@v3 is on Node.js 20, which GitHub will deprecate on 2026-09-16. Pin to a Node 24-compatible version (or set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`) before September — outside Phase 10 scope.
