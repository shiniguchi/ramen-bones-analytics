---
plan: 09
phase: 16
title: CampaignUpliftCard.svelte + dashboard slot + retire CAMPAIGN_START
status: complete
completed_at: 2026-05-03
commits:
  - 5021e56  # Tasks 1-2 — test contract + component implementation (TDD coalesced)
  - bfd74bd  # Task 3 — slot card on +page.svelte + retire CAMPAIGN_START
files_created:
  - src/lib/components/CampaignUpliftCard.svelte
  - tests/unit/CampaignUpliftCard.test.ts
files_modified:
  - src/routes/+page.svelte
  - src/lib/forecastConfig.ts
  - tests/unit/forecastConfig.test.ts  # rewrote to assert constant retired
deviations:
  - field: test file location
    plan_said: src/lib/components/CampaignUpliftCard.test.ts
    landed_at: tests/unit/CampaignUpliftCard.test.ts
    why: vitest's include glob is `tests/unit/**/*.test.ts`. All sibling component tests (RevenueForecastCard, InvoiceCountForecastCard, etc.) live there. Same deviation as 16-08.
  - field: TDD pacing
    plan_said: Task 1 RED skeleton + Task 2 GREEN component as separate commits
    landed_at: single commit `5021e56` ("feat(16-09): CampaignUpliftCard.svelte — hero + sparkline + honest CI label")
    why: Tests import the component directly, so a Task-1-only commit would either (a) fail vitest at module-resolution or (b) require an unstubbed shim. Coalescing the TDD pair preserves green-on-every-commit invariant.
  - field: visual verification gate
    plan_said: Localhost Chrome MCP screenshot at 375×667 + DEV preview QA both PASS
    actual: PARTIAL (see Verification section below)
    why: localhost auth requires dev credentials not in env; E2E_FIXTURES bypass route lets the page load but a Chrome-MCP-controlled-tab visibility quirk prevents IntersectionObserver from firing on ANY LazyMount slot (all 6 sat in skeleton state). Component contract verified by unit tests + console-clean fixture page-load. Final visual gate must happen on DEV preview where real auth + real IO operate.
  - field: pre-existing date literals in src/
    plan_said: grep -rnE "2026-?04-?14" src/ returns zero matches
    actual: 4 pre-existing matches in src/lib/e2eChartFixtures.ts (E2E test fixtures) and src/routes/+page.server.ts (SSR fallback fixtures); my own changes introduce zero new occurrences
    why: Both files are dev/test scaffolding, outside Plan 09 scope. Plan 11 Guard 10 will need an explicit exemption for these fixture files when it lands.
---

# Plan 09 Summary

The dashboard now has a campaign-uplift card. It sits between
`InvoiceCountForecastCard` and the Revenue/Transactions KPI tiles, wrapped
in `LazyMount(minHeight=180px)`, and self-fetches `/api/campaign-uplift`
(extended in Plan 08) on mount.

## What changed

### Tasks 1-2 — test contract + component (`5021e56`)

#### `tests/unit/CampaignUpliftCard.test.ts`

Nine vitest cases form the contract the component must satisfy:

1. **shows hero number when CI does not overlap zero** — fixture with
   `ci_lower=200`, `ci_upper=2800`; assert text contains `+€1,500` and NOT
   `CI overlaps zero`.
2. **shows honest label when CI overlaps zero (UPL-06)** — fixture with
   `ci_lower=-300`, `ci_upper=500`; assert hero text reads exactly
   `CI overlaps zero — no detectable lift` and the point estimate appears
   below in dim style (`text-zinc-500`).
3. **layerchart_contract — sparkline uses Spline + Area at fillOpacity 0.06**
   — render output's SVG contains a path with `fill-opacity="0.06"`.
4. **tooltip_snippet_contract** — source-text assertion: file contains
   `{#snippet children(` and does NOT contain the deprecated shorthand
   binding (which throws `invalid_default_snippet` on Svelte 5 — see
   `.claude/memory/feedback_svelte5_tooltip_snippet.md`).
5. **touch_events_contract** — source-text assertion: file contains
   `touchEvents: 'auto'` (per `.claude/memory/feedback_layerchart_mobile_scroll.md`).
6. **hides itself when campaigns array is empty** — fixture with
   `campaigns: []`; assert nothing renders past the skeleton.
7. **shows skeleton during fetch** — pre-resolve assertion: `.animate-pulse`
   is present in container.
8. **shows divergence warning when sarimax vs naive_dow disagree by sign
   (D-09)** — fixture with `cumulative_uplift_eur=500`,
   `naive_dow_uplift_eur=-200`; assert `[data-testid="divergence-warning"]`
   reads `Naive baseline disagrees`.
9. **sparkline_data_contract** — source-text assertion: file contains
   `data.daily.map` (consumes API daily[]) and NOT a 2-point synthesized
   array (CONTEXT.md D-11 shape-of-uplift requirement).

#### `src/lib/components/CampaignUpliftCard.svelte`

Three rendered states keyed off the API payload:

- **Hero** — when `ci_lower_eur > 0 || ci_upper_eur < 0`. Big
  `Cumulative uplift: +€1,500` with `95% CI +€200 … +€2,800` subline.
- **Honest label (UPL-06)** — when `ci_lower_eur ≤ 0 ≤ ci_upper_eur`. Hero
  reads `CI overlaps zero — no detectable lift`; point estimate is dimmed
  below.
- **Skeleton / error / empty** — `animate-pulse` during fetch;
  "Could not load uplift" on error; nothing rendered when
  `campaigns.length === 0`.

LayerChart sparkline — `Chart > Svg > Area + Spline + Tooltip.Root`.
`Area` uses `y0='ci_lower'`, `y1='ci_upper'`, `fillOpacity={0.06}`.
`Spline` uses `y='cum_uplift'`, `class='stroke-2'`, `curve={curveMonotoneX}`.
`Chart.tooltipContext.touchEvents='auto'` preserves PC trackpad vertical
scroll. `Tooltip.Root` uses `{#snippet children({ data: pt })}` (the older
shorthand binding throws `invalid_default_snippet` on Svelte 5 runtime).

D-09 divergence warning — amber note when `sarimax` and `naive_dow`
disagree by sign, OR when `|sarimax − naive_dow| / max(|sarimax|, 1) > 0.5`.

### Task 3 — slot + retirement (`bfd74bd`)

#### `src/routes/+page.svelte`

```svelte
import CampaignUpliftCard from '$lib/components/CampaignUpliftCard.svelte';

<!-- ... InvoiceCountForecastCard LazyMount ... -->

<LazyMount minHeight="180px">
  {#snippet children()}
    <CampaignUpliftCard />
  {/snippet}
</LazyMount>

<!-- D-10 cards 4-5: Revenue + Transactions KPI tiles -->
```

#### `src/lib/forecastConfig.ts`

`CAMPAIGN_START` constant removed; file becomes a comment-only stub with
`export {}` (kept rather than deleted so any orphaned import surfaces as a
TypeScript module-not-found error instead of silent missing-constant).

#### `tests/unit/forecastConfig.test.ts`

Rewrote to assert `CAMPAIGN_START` is no longer exported (
`Object.prototype.hasOwnProperty.call(forecastConfig, 'CAMPAIGN_START')`
returns `false`). If anyone re-adds the constant, the test fails and the
retirement is reversed.

## Verification

| Check | Result | Evidence |
|-------|--------|----------|
| TypeScript errors in modified files | 0 new (7 pre-existing) | `npm run check` |
| CampaignUpliftCard unit tests | 9 / 9 PASS | `npx vitest run tests/unit/CampaignUpliftCard.test.ts` |
| forecastConfig retirement test | 1 / 1 PASS | same run |
| `import CampaignUpliftCard` in +page.svelte | ✓ | grep |
| `CAMPAIGN_START` in src/ | 0 matches | grep |
| New `2026-04-14` literals in my changes | 0 (4 pre-existing in fixture scaffolding remain) | grep |
| Console errors during fixture page-load | 0 | Chrome MCP `read_console_messages` (only Vite HMR debug) |
| LazyMount slot at 180px renders in correct position | ✓ (between InvoiceCountForecastCard at top=-122 and KPI tiles) | Chrome MCP DOM inspection |
| **Card hero + sparkline visible at 375×667** | **PARTIAL** | (see below) |
| **DEV preview screenshot** | **PENDING (post-push QA)** | the user must drive Chrome MCP against the CF Pages preview URL |

### Visual verification — PARTIAL

**What I drove via Chrome MCP at 375×800:**

- Started dev with `E2E_FIXTURES=1 npm run dev`.
- Navigated to `http://localhost:5173/?__e2e=charts` (auth bypass route).
- Patched `window.fetch` to return a synthetic fixture matching the Plan 08
  payload shape, then reloaded.
- Page loaded, console clean (0 errors, only Vite HMR debug messages).
- All 6 LazyMount slots on the page (including the new 180px one at
  top=222, fully in viewport) sat at the `animate-pulse` skeleton state
  even after `scrollIntoView({ block: 'center' })` + 3 s wait.
- Same behavior for sibling LazyMount slots (RevenueForecastCard,
  InvoiceCountForecastCard, DailyHeatmapCard, …) — none mounted.

**Diagnosis:** Chrome-MCP-controlled tabs do not appear to fire
IntersectionObserver callbacks reliably under the headless visibility
state. This affects every LazyMount on the page, not just the new card —
so it is not a regression introduced by Plan 09.

**Final visual gate must happen on the DEV preview** where:
- Real Supabase auth lets the user sign in.
- A normal interactive Chrome / mobile browser fires IO correctly.
- The user can drive Chrome MCP against the DEV URL with their session
  cookie present.

**Pre-push checklist for the user / Friend:**

1. Push `feature/phase-16-its-uplift-attribution` and wait for CF Pages
   build.
2. Drive Chrome MCP against the DEV preview URL at 375×667.
3. Sign in. Scroll past `InvoiceCountForecastCard`.
4. Confirm:
   - Hero number renders: `Cumulative uplift: +€…` (or honest label if CI
     straddles zero).
   - 280×100 sparkline renders with low-opacity CI band + cumulative line.
   - Tap-to-pin tooltip works (touch event); reads
     `Day N · €… · 95% CI …`.
   - Anticipation-buffer note visible below.
   - Browser console reports 0 errors.

## Threats

No new STRIDE threats introduced (the only entry in Plan 09's threat
register is the UX-honesty UPL-06 honest-label rule, mitigated by the
`CI overlaps zero` test case).

## Requirements

- **UPL-06** — covered (hero + honest label + sparkline + divergence
  warning + anticipation-buffer note).

## Next

Plan 10 — extend `tests/e2e/forecast-event-markers.spec.ts` with a
`campaign_start` Playwright case asserting that
`RevenueForecastCard` + `InvoiceCountForecastCard` auto-render the new
EventMarker for the seeded 2026-04-14 row in the events array
(Plan 08 source).
