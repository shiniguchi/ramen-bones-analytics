---
phase: 04-mobile-reader-ui
plan: 09
subsystem: testing
tags: [playwright, e2e, seed-data, adversarial-qa, human-uat, gap-closure]

requires:
  - phase: 04-mobile-reader-ui
    provides: Layerchart 2.x upgrade (04-06) + DEV migrations synced with drift guard (04-08) — both prerequisites for seeded happy-path spec
provides:
  - Idempotent seed-demo-data.sql that populates DEV with ≥60 cohort-shaped transactions
  - Playwright happy-path spec exercising all 9 dashboard cards against real data (not empty state)
  - Stable data-testids on all 9 cards + FreshnessLabel
  - Adversarial iPhone UAT checklist sections A–F covering all 5 Gap D blind spots
  - Owner walkthrough via Chrome MCP against localhost — sign-off with two genuine bugs exposed (Gaps E + F)
affects: [Phase 5 Insights & Forkability, post-v1.0 Dashboard Redesign]

tech-stack:
  added: []
  patterns:
    - "E2E_FIXTURES env-gated server-side auth + data bypass (reused from 04-06)"
    - "data-testid stable identifiers on visual cards for Playwright assertions"
    - "Adversarial QA checklist as persistent artifact surfaced in /gsd:progress and /gsd:audit-uat"

key-files:
  created:
    - scripts/seed-demo-data.sql
    - tests/e2e/dashboard-happy-path.spec.ts
    - .planning/phases/04-mobile-reader-ui/04-HUMAN-UAT.md
    - .planning/backlog/dashboard-redesign.md
  modified:
    - src/lib/components/FrequencyCard.svelte
    - src/lib/components/FreshnessLabel.svelte
    - src/lib/components/KpiTile.svelte
    - src/lib/components/NewVsReturningCard.svelte
    - playwright.config.ts
    - .planning/phases/04-mobile-reader-ui/04-VERIFICATION.md

key-decisions:
  - "Approved as-is with two known bugs (Gap E NVR-empty, Gap F LTV-sparse) logged — plan charter was to EXPOSE blind spots, not fix all of them"
  - "Defer real-iPhone UAT to PR gate — no Cloudflare Pages DEV deployment exists yet; localhost walkthrough via Chrome MCP is the best we can do today"
  - "Dashboard redesign feedback from owner captured as backlog/dashboard-redesign.md rather than expanding Phase 4 scope"

patterns-established:
  - "Gap closure plans can legitimately complete with new gaps logged — the point of adversarial QA is discovery, not immediate repair"
  - "Happy-path e2e specs must assert content (digits, SVG paths) not just render, or empty-state bugs escape again"

requirements-completed: [UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11]

duration: 65min
completed: 2026-04-15
---

# Phase 04 Plan 09: Gap D Adversarial QA Closure

**The dashboard now has a seeded happy-path guarantee — and the first run against that guarantee exposed two pre-existing card bugs that every prior test had missed.**

## Performance

- **Duration:** ~65 min (spanned two sessions due to mid-plan usage-limit interruption)
- **Started:** 2026-04-14 (seed script work by prior executor)
- **Completed:** 2026-04-15 (walkthrough + sign-off + finalization)
- **Tasks:** 4/4 (1 by prior executor, 2 by continuation executor, 1 human UAT by owner via Chrome MCP)
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments

**Task 1 — Seed script (commits `f5e71f3` + `1bd786a`):**
`scripts/seed-demo-data.sql` populates the test restaurant `ba1bf707-aae9-46a9-8166-4b6459e6c2fd` with ≥60 demo transactions over ≥2 weeks. Idempotent via `demo-*` source_tx_id prefix.

**Task 2 — Happy-path Playwright spec (commit `b6c1ba9`):**
`tests/e2e/dashboard-happy-path.spec.ts` loads `/` against seeded data and asserts: all 9 cards render, KPI tiles contain `€` + digits, cohort SVG has at least one `<path>`, LTV SVG has at least one `<rect>`, FreshnessLabel is visible, zero page or console errors. Co-landed: stable `data-testid` attributes on all 9 cards + FreshnessLabel (KpiTile derives its testid from its title prop). `playwright.config.ts` now defaults `E2E_FIXTURES=1` on both the webServer and the test process so `npx playwright test` exercises the fixtured happy-path by default.

**Task 3 — Human UAT checklist (commit `131860a`):**
`04-HUMAN-UAT.md` covers all 5 Gap D blind spots across sections A–F (freshness, 9-card data presence, chip scoping, grain toggle, console errors, layout sanity). The checklist is structured as a UAT artifact and surfaces in `/gsd:progress` and `/gsd:audit-uat`.

**Task 4 — Human verification (2026-04-15 session, this commit):**
Owner walkthrough via Chrome MCP against `http://localhost:5173` on a macOS Chrome window (512×494 viewport — not a true 375px iPhone run). Tested `/?range=7d`, `/?range=30d`, `/?range=all`. All 9 cards render, console is clean post-reload (Gap A regression guard holds), no `/not-provisioned` redirect (Gap B regression guard holds). KPI tile chip scoping works (transactions `104 → 716 → 6842`, avg ticket `28,43€ → 29,61€ → 29,54€`, delta labels switch from "vs prior 7d" to "vs prior 30d" to "no prior data"). Cohort retention + LTV + Visit frequency stay stable across chip changes (D-19a chip-INDEPENDENT contract holds for those three).

## Bugs surfaced (the point of Gap D)

**Gap E — New-vs-Returning card always empty.** On every chip tested (`7d`, `30d`, `range=all`) the NVR card renders "No sales recorded in this window" even when the Transactions KPI shows 104 / 716 / 6.842 on the same loads. D-19a chip-scoping cannot be verified because the card never populates. Logged in `04-VERIFICATION.md` Gap E. Pre-existing bug from plan 04-05.

**Gap F — LTV chart only shows 3 weekly bars on `range=all`.** Bars render for `2026-03-09 / 03-16 / 03-23` (€30–32) only, despite the "Based on 10 months of history" caveat and 6.842 transactions in scope. Either `ltv_mv` is sparse or the loader has a hard-coded window. Logged in `04-VERIFICATION.md` Gap F. Pre-existing bug from plan 04-04.

Both will be addressed inside the post-v1.0 Dashboard Redesign milestone (see `.planning/backlog/dashboard-redesign.md`). They are NOT fixed inside plan 04-09 because fixing them is out of scope — the plan's charter was to EXPOSE blind spots, and it did.

## Dashboard redesign signal (new, captured as backlog)

During the walkthrough, owner gave direction-change feedback for a post-v1.0 phase: dropdown date filter, global day/week/month grain selector, replace most KPI tiles with time-series charts (cohort customer count, first-timer-vs-repeater attribution by user / revenue-sum / revenue-avg, per-cohort retention curves weekly + monthly), richer visit-frequency card with return-timing detail, and a brainstorm of additional aggregations (weekday × hour heatmap, item mix Pareto, seasonality, etc.). Captured verbatim in `.planning/backlog/dashboard-redesign.md` with known constraints preserved. Not in scope for v1.0; route via `/gsd:discuss-phase` after Phase 5 (Insights & Forkability) ships.

## Test evidence

Automated suite on 04-09 session (from prior executor run, pre-walkthrough):

```
Running 6 tests using 4 workers
  ✓ charts-with-data.spec.ts:17:3 LtvCard + CohortRetentionCard hydrate without scale.copy crash
  ✓ dashboard-happy-path.spec.ts:119:3 all 9 cards render with data, zero console errors
  ✓ dashboard-happy-path.spec.ts:128:3 30d chip navigation keeps URL in sync and chart cards stable
  ✓ layout.spec.ts:8:1 dashboard renders at 375px with no horizontal scroll
  2 skipped  4 passed (8.8s)
```

Unit suite: 33/33 green.

## Deviations

- **Rule 1 (blocking):** `playwright.config.ts` had previously set `E2E_FIXTURES=1` only on the webServer process, not on the test process. Specs therefore silently skipped the fixture-gated assertions. Fixed in task 2 by setting `process.env.E2E_FIXTURES ??= '1'` at the top of `playwright.config.ts` so specs see it too. Documented in the prior executor's session return.
- **Rule 3 (non-blocking):** Plan frontmatter `files_modified` lists 3 files (`04-HUMAN-UAT.md`, `seed-demo-data.sql`, `dashboard-happy-path.spec.ts`). Actual modifications extended to card components (added `data-testid`) and `playwright.config.ts` (env var fix). All are in service of Task 2's "Playwright spec must exercise the chart path on real data" success criterion.
- **Scope deferral:** Task 4's "real iPhone at 375px" gate is deferred to the PR gate for the eventual Cloudflare Pages DEV deployment. No deployed DEV URL exists today (Phase 4 was the first frontend code in this repo). Localhost Chrome MCP walkthrough is the best sign-off available.
