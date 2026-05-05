---
plan: 10
phase: 16
title: EventMarker campaign_start E2E + Phase 15 forecast cards smoke test
status: complete
completed_at: 2026-05-03
commits:
  - 9412c1e  # Task 1 — Playwright spec with DEV sign-in mode
files_created:
  - tests/e2e/forecast-event-markers.spec.ts
files_modified: []
deviations:
  - field: file mode
    plan_said: tests/e2e/forecast-event-markers.spec.ts already exists (files_modified, not files_created)
    landed_at: created (the file did not exist on disk; Phase 15 never landed it)
    why: Plan 10's frontmatter assumed Phase 15 had landed a sibling spec. `git log` returns no history for that path; this spec is genuinely new. Functionally identical outcome.
  - field: visual verification gate (Task 2)
    plan_said: Localhost Chrome MCP screenshot of red EventMarker line on RevenueForecastCard + InvoiceCountForecastCard, then DEV preview screenshot match
    actual: PARTIAL — same auth + Chrome-MCP-tab IntersectionObserver quirk that blocked Plan 09 Task 4. EventMarker.svelte already shipped in Phase 15 (no new component code in this plan), so the only thing to verify is the wire-up which is exercised by the Playwright spec under E2E_DEV_HAPPY_PATH.
    why: see 16-09-SUMMARY.md "Visual verification — PARTIAL" for the diagnosis. Final visual gate must run against the DEV preview after push.
---

# Plan 10 Summary

End-to-end wiring smoke test for the new `campaign_start` event marker.
No component code in this plan — `EventMarker.svelte` already supports
the type with a red 3px vertical line (Phase 15 C-09 carry-forward), and
Plan 08 wired the data source. This plan is the regression guard.

## What changed

### Task 1 — `tests/e2e/forecast-event-markers.spec.ts` (`9412c1e`)

New Playwright spec mirroring `dashboard-happy-path.spec.ts`'s two-mode
pattern:

| Mode | Env | Behavior |
|------|-----|----------|
| Fixture | `E2E_FIXTURES=1` | Stubbed-skipped — `/api/forecast` is not served by the `?__e2e=charts` bypass (auth-gated). Placeholder describe kept for a future fixture extension. |
| DEV real sign-in | `E2E_DEV_HAPPY_PATH=1` + `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` | Sign in → scroll to `RevenueForecastCard` → await `/api/forecast?granularity=day` 200 response → assert response body's `events[]` contains `{type:'campaign_start', date:'2026-04-14'}` → assert `[data-event-type="campaign_start"]` is attached inside both `[data-testid="revenue-forecast-card"]` SVG and `[data-testid="invoice-forecast-card"]` SVG. Plus a regression test that the events-array type union didn't lose any pre-existing member. |

Selectors verified against `src/lib/components/EventMarker.svelte`:

```svelte
{#if e.type === 'campaign_start'}
  <line
    data-event-type="campaign_start"
    x1={x(e.date)} x2={x(e.date)}
    y1={0} y2={height}
    stroke="#dc2626"
    stroke-width={3}
    pointer-events="none"
  >
    <title>{e.label}</title>
  </line>
{/if}
```

### Task 2 — Visual smoke (PARTIAL)

`EventMarker.svelte` is unchanged in this plan, so the visual diff between
the pre- and post-Plan-10 dashboard is purely the new red line at the
2026-04-14 x-position on the two forecast cards. The Playwright spec
covers the wiring assertion programmatically; the user-visible check is
deferred to the DEV preview QA called out in 16-09-SUMMARY.

## Verification

| Check | Command | Result |
|-------|---------|--------|
| Spec parses | `npx playwright test tests/e2e/forecast-event-markers.spec.ts --list` | 3 tests discovered ✓ |
| Skip gates honored without env | `npx playwright test tests/e2e/forecast-event-markers.spec.ts -g campaign_start --project=mobile-chrome` | 3 / 3 skipped ✓ |
| EventMarker selector matches actual DOM | grep `data-event-type="campaign_start"` `src/lib/components/EventMarker.svelte` | line 64 ✓ |
| forecast-card data-testid matches | grep `data-testid="revenue-forecast-card"` + `data-testid="invoice-forecast-card"` | both present ✓ |

### How to run the DEV-mode tests

```bash
# 1. Apply Plan 04 migrations on DEV (if not already)
gh workflow run migrations.yml --ref feature/phase-16-its-uplift-attribution

# 2. Wait for the migration job to finish

# 3. Run Playwright with the DEV credentials in env
E2E_DEV_HAPPY_PATH=1 \
TEST_USER_EMAIL=<friend-owner-email> \
TEST_USER_PASSWORD=<friend-owner-password> \
npx playwright test tests/e2e/forecast-event-markers.spec.ts --project=mobile-chrome
```

The two DEV-mode tests will sign in, scroll to each card, await the
`/api/forecast` response, and assert the `campaign_start` marker is wired
end-to-end.

## Threats

No new STRIDE threats. Per the plan: "Wiring verification only — no new
attack surface; campaign_calendar RLS already mitigates T-16-01 in Plan 01."

## Requirements

- **UPL-06** — covered (event marker overlay aspect of the campaign-uplift
  story).

## Next

Wave 3 complete (Plans 08-10 all landed). Wave 4 follows: Plan 11 (CI
guards 9 + 10 + red-team fixtures), Plan 12 (cutoff sensitivity log), and
Plan 13 (forecast-refresh.yml workflow extension + DEV smoke test).

The DEV preview visual gate (deferred from Plan 09 Task 4 + Plan 10 Task 2)
should be driven before kicking off Wave 4 so any rendering regressions
are caught before more changes pile on.
