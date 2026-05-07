# Phase 19 Discussion Log

**Date:** 2026-05-07
**Format:** Direct conversation in lieu of `/gsd-discuss-phase` per `feedback_skip_redundant_questions.md` memory.
**Decision-making chain:** owner problem statement → `/deepsearch-propose-top2` (research, no code change) → top-2 plans surfaced → owner picked Plan 1 → `/refine-plan-100pct` → 4-pillar audit → locked decisions in `19-CONTEXT.md` + sub-plans.

---

## 1. Owner problem statement (2026-05-07)

> "Hello, so basically the current app is very slow and it was not like this before. I think the cold is not very optimized and we are using those modules threads too heavy the user expect quite a light experiences so let's optimize towards that. also, i want to refine the codes as minimal, scalable, universal, and dynamic as much as possible too."

**Parsed:**
- Symptom: app feels slow on cold open (regression vs prior state)
- Hypothesis: cold start unoptimised; modules heavy
- UX target: light experience on mobile
- Code direction: minimal, scalable, universal, dynamic

---

## 2. `/deepsearch-propose-top2` findings (no code changed)

**Cold-start blockers identified:**

1. **5 chart cards eager-mount above the fold** in `src/routes/+page.svelte:309-349`: `CalendarCountsCard`, `CalendarRevenueCard`, `CalendarItemsCard`, `CalendarItemRevenueCard`, `MdeCurveCard`. Each statically imports from `layerchart` + 2-3 `d3-*` modules. LayerChart pulls 22 d3 packages + dagre + layerstack + memoize + runed (`node_modules/layerchart` = 4.9 MB).
2. **`CalendarCountsCard` + `CalendarRevenueCard` fire `/api/forecast` eagerly** through `createForecastOverlay()` on mount.
3. **`src/lib/i18n/messages.ts` is 76 KB / 1358 LOC** with all 5 locales statically bundled into one module imported by 19 components. 4/5 locales are dead weight on every device.
4. **`CampaignUpliftCard`** (515 LOC + LayerChart + scaleBand + clientFetch) is wrapped in `LazyMount` but slotted *first* (`+page.svelte:274`), so `onvisible` fires immediately — effectively eager.

**Runtime / filter-change baseline (preserved, not in scope):** Phase 16.2-01 trace measured ~2168 ms main-thread blocking per filter change after the dual-cascade fix. The single cascade is still the main runtime offender; not addressed by Phase 19.

**SSR was already cut 11 → 6 in Phase 11.** Remaining slowness is client-side, not SSR.

**Regression timing matches Phase 16 / 16.3 / 18 + i18n rollout** — those phases expanded the eager surface without re-trimming it. Owner's "was fast before" gut is consistent.

---

## 3. Top-2 plans surfaced

**Plan 1 — Trim cold-start surface** (defer all charts + split i18n)
- Pros: directly answers "cold heavy / modules heavy / want light"; ~60-70% bundle drop; zero schema changes; reuses `LazyMount` (already mandated single idiom); reversible per file
- Cons: filter-cascade unchanged; flash-of-skeleton; one extra hop on locale switch
- Effort: Medium (~1.5-2 days)

**Plan 2 — Pre-aggregate at the database** (collapse client cascade)
- Pros: filter clicks drop from ~2 s to <100 ms; smaller wire payload; removes Calendar* duplicate-filter logic; scales to 100k+ tx
- Cons: schema migration + RLS verification footgun; touches 8-10 files; doesn't shrink initial JS bundle directly; bigger contract change
- Effort: Large (3-5 days)

**Recommendation given:** Plan 1 first (cold-start is the symptom). Plan 2 is the architectural follow-on, not a replacement.

---

## 4. Owner decision

Owner accepted the recommendation and asked for `/refine-plan-100pct` against the 4 pillars (minimal / scalable / dynamic / universal) with explicit instruction "make sure to check all the available datasets as well before you refine the plan."

---

## 5. Refinement under 4 pillars

| Pillar | Original (60%) | Refined (100%) |
|---|---|---|
| **Minimal** | "Add Vite manualChunks" | **Cut.** Vite auto-splits dynamic imports; manualChunks is gold-plating. |
| **Minimal** | "Convert imports to await import() inside snippet" | **Sharpened.** Extend existing `LazyMount` with one optional `loader` prop; preserve existing children-snippet API. Single idiom rule (`LazyMount.svelte:8-12`) preserved. |
| **Scalable** | (not addressed) | **Added.** New locale = 1 file, 0 KB cold-bundle. New chart card = 1 LazyMount wrap, 0 KB cold-bundle. |
| **Dynamic** | "Locale resolved server-side" (vague) | **Pinned.** `event.cookies.get(LOCALE_COOKIE)` already populated by `hooks.server.ts:14-15`. No flag, no hardcode. |
| **Universal** | "Split messages.ts into 5 files" | **Sharpened.** 5 dict files at `src/lib/i18n/dict/{en,de,ja,es,fr}.ts`. `t(loc, key)` API surface unchanged. 19 component call sites unmodified. `loadDict()` cache mirrors `clientFetch.ts:13` pattern. |

### Dataset audit (the "check all datasets" follow-up)

Audited every Supabase view consumed by the dashboard. Found 2 SSR-fetched views whose sole consumers are *already* lazy-mounted:
- `item_counts_daily_v` → consumed by `CalendarItemsCard` + `CalendarItemRevenueCard` (lazy after 19-01)
- `benchmark_curve_v` + `benchmark_sources_v` → consumed by `CohortRetentionCard` (already lazy at `+page.svelte:325`)

Adding `/api/item-counts` and `/api/benchmark` (cloning the `/api/kpi-daily` pattern from Phase 11-02) drops SSR `Promise.all` 6 → 4. This wasn't in the original 60% plan — surfaced by the dataset audit.

### CampaignUpliftCard slot-1 issue

Flagged but **deferred from this phase.** Currently lazy-wrapped but visible immediately, so `LazyMount.onvisible` fires on cold load and the chunk loads anyway. Moving the card below the KPI tiles or reducing its `rootMargin` to 0 is a UX call for the owner — not a unilateral engineering decision.

---

## 6. Locked sub-plan decomposition

| Sub-plan | Scope | Depends on |
|---|---|---|
| 19-01 | `LazyMount.loader` prop + 5 chart cards lazy-converted in `+page.svelte` | — |
| 19-02 | `/api/item-counts` + `/api/benchmark` deferred endpoints; SSR `Promise.all` 6 → 4 | 19-01 (consumers must be lazy first) |
| 19-03 | i18n per-locale dynamic imports (5 dicts + `loadDict()` + hook seeding) | — (independent of 19-01/02) |
| 19-04 | Phase-final QA on localhost + DEV; planning-docs drift gate; ship | 19-01, 19-02, 19-03 |

---

## 7. Out-of-scope confirmations

- **Plan 2 (pre-aggregation)** — deferred to a future phase
- **Vite `manualChunks`** — auto-splitting suffices
- **`dashboardStore.filterRows` memoization** — Plan 2 territory
- **`CampaignUpliftCard` slot reorder** — UX call, owner decides
- **New chart cards / new locales / new charts** — feature work, not perf
- **Worker-thread offload of filterRows** — future phase candidate

---

*Logged 2026-05-07. No further discussion expected before /gsd-execute-phase 19.*
