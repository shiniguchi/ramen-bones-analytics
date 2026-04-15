# Phase 6: Filter Foundation - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A shared, mobile-first filter bar drives every existing v1.0 card through a single zod-validated SSR pipeline. Phase 6 scope is **4 filters** (date range, day/week/month grain, sales type, payment method). The remaining two filter requirements are deferred to later phases where their source columns land:

- **FLT-05 (country filter)** → moves to **Phase 7 (Column Promotion)** — depends on `wl_issuing_country` being promoted to `transactions`.
- **FLT-06 (repeater-bucket filter)** → moves to **Phase 8 (Star Schema)** — depends on `dim_customer.lifetime_bucket` / `fct_transactions.lifetime_bucket`.

**Roadmap amendment required:** `ROADMAP.md` Phase 6 "Requirements" line and `REQUIREMENTS.md` FLT-05/FLT-06 phase assignments must be updated before planning concludes.

**In scope:**
- Replace fixed-preset `DateRangeChips` with a custom picker (presets + custom range) — FLT-01
- Keep existing global `GrainToggle` (day/week/month) — FLT-02 already satisfied structurally, re-wire through the new schema
- Add sales-type filter — FLT-03
- Add payment-method filter (auto-populated `SELECT DISTINCT`) — FLT-04
- Single zod-validated SSR pipeline; no dynamic SQL; ci-guard for `${` inside `.from(…)` — FLT-07

**Out of scope (this phase):**
- FLT-05 country filter (→ Phase 7)
- FLT-06 repeater-bucket filter (→ Phase 8)
- Any data-model / MV changes
- Desktop-specific layouts

</domain>

<decisions>
## Implementation Decisions

### Scope Amendment
- **D-01:** Phase 6 ships 4 filters, not 6. Planner must also emit a migration-style patch to `ROADMAP.md` (move FLT-05 to Phase 7, FLT-06 to Phase 8) and `REQUIREMENTS.md` (update phase column for FLT-05/FLT-06) as part of the phase's deliverables.

### Filter Bar Layout
- **D-02:** Filter bar is **sticky to the top of the viewport** at 375px. Must remain reachable while the user scrolls the card grid (no scroll-back-to-change required).
- **D-03:** **Split hierarchy**: date range picker + grain toggle live **inline on the sticky bar** (they change most often). Sales-type + payment-method live **inside a "Filters" button** that opens a sheet/drawer.
- **D-04:** **Active-state indicator**: non-default controls get a subtle colored **border/tint** on the control itself. No badge count, no removable chip row. Keep it minimal.
- **D-05:** Vertical budget for the sticky bar must be tight — do not eat more than ~72px, and profile against existing card layout at 375px.

### Date Picker
- **D-06:** Widget is a **custom Svelte popover** triggered from a picker button on the sticky bar. The popover contains:
  - Preset buttons: **Today / 7d / 30d / 90d / All**
  - Two **native `<input type="date">`** elements for the custom-range case (zero-dep, OS-native pickers, free a11y)
- **D-07:** **Default range = 7d** when no `?from`/`?to`/`?range` is present (preserves v1.0 behavior).
- **D-08:** **Closed-state button label**: preset name if the current range matches a preset ("7d"), otherwise `"Custom"`; show the actual from/to dates on a second line underneath.
- **D-09:** Presets live **only inside the popover** — no chip row alongside the picker button. Replaces the current `DateRangeChips` entirely.

### Dropdown Widget ('All' semantics)
- **D-10:** Dropdown widget is **shadcn-svelte Command/Popover** with checkbox items (combobox-style). No native `<select>` (fails multi-select on mobile); no custom bottom-sheet.
- **D-11:** **Multi-select** for both sales-type and payment-method. URL carries comma-separated values (`?payment=visa,mastercard`). zod parses to `string[]`. SQL composes to `IN (...)` via the Supabase client's `.in()` method — still no string interpolation.
- **D-12:** **'All' sentinel = absent param**. No `?payment=all` in the URL. zod defaults missing fields to `undefined`; the load function skips the corresponding `.in()` call. Reduces URL noise and keeps the default view's URL clean of filter params.
- **D-13:** **Empty options**: if `SELECT DISTINCT` returns 0 rows for a dropdown's source column (in the full table, not the currently-filtered view), the dropdown is **hidden entirely**. Do not render a disabled "All only" control.
- **D-14:** Dropdown `DISTINCT` queries should run against the **full wrapper view unfiltered by other filters** (decouple options from current filter state — avoids options disappearing when a user narrows another filter).

### Reset + URL Hygiene
- **D-15:** **"Reset all filters" button** lives **inside the Filters sheet** (not on the sticky bar). Visible at all times when the sheet is open; functionally a no-op when already default.
- **D-16:** **Defaults ARE kept in the URL** explicitly (`?range=7d&grain=week`). Verbose but unambiguous — makes shared URLs, debugging, and state inspection straightforward. Contradicts the typical "strip defaults" pattern; do not strip.
- **D-17:** **Invalid/malformed params coerce to defaults** via `z.enum(...).catch('<default>')` on every field. Page always renders; no redirects, no 400 pages. Unknown params are ignored (not stripped via redirect).
- **D-18:** Filter changes trigger a **full SSR navigation** via `goto(newUrl)` — matches existing `DateRangeChips`/`GrainToggle` pattern (D-04/D-05 from Phase 4). `load()` re-runs server-side against Supabase. No client-side query caching layer.

### Zod Schema
- **D-19:** **Single flat schema** in `src/lib/filters.ts` (new file) covering all filter params. Exports both the parser and a `FiltersState` type. Downstream: load function and any client components import the type, never a stringly-typed URL params object.
- **D-20:** Schema is the **only place** that knows default values. Components treat missing as default via the parser, not by hand-coded fallbacks.

### Claude's Discretion
- Exact sheet transition (slide-up vs. drawer vs. modal) — planner/UI-phase to decide.
- Exact border/tint color for non-default active state — should map to the existing Tailwind token palette.
- Whether to use `invalidateAll: true` inside `goto()` for smoother transitions — D-18 allows either; pick the one that avoids flicker.
- Loading/skeleton state on filter change — existing per-card EmptyState already covers error isolation; planner decides if a transition skeleton is needed.
- How the picker popover positions at 375px (centered sheet, anchored below button, or full-width modal) — mobile UX call at implementation time.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 6: Filter Foundation" — phase goal, success criteria, FLT requirements list (planner must also patch this file to move FLT-05 → Phase 7 and FLT-06 → Phase 8)
- `.planning/REQUIREMENTS.md` §"Filter Foundation" (FLT-01 … FLT-07) and phase-mapping table (rows 201–207) — planner must patch FLT-05/06 phase assignments

### Data model (downstream phases — reference only)
- `.planning/v1.1-DATA-MODEL.md` §2 (`wl_issuing_country` promotion) — explains why FLT-05 can't ship in Phase 6
- `.planning/v1.1-DATA-MODEL.md` §3 (`dim_customer.lifetime_bucket`) and §4.1 (`fct_transactions.lifetime_bucket`) — explains why FLT-06 can't ship in Phase 6

### Prior phase decisions that bind this phase
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — establishes URL-as-state-source, `$app/state` (not stores), `min-h-11` touch targets, per-card error isolation, SSR load pattern (D-04/D-05/D-08/D-19a references in existing components)
- `.planning/phases/03-analytics-sql/03-CONTEXT.md` — establishes `*_v` wrapper-view pattern; new `SELECT DISTINCT` queries must go through wrappers, not raw tables/MVs

### Existing code the phase extends
- `src/lib/dateRange.ts` — `chipToRange()` helper; extend or replace to accept `{from, to}` custom ranges. Berlin TZ math must survive.
- `src/lib/components/DateRangeChips.svelte` — to be **replaced** by the new date picker popover
- `src/lib/components/GrainToggle.svelte` — **kept**, but re-wired through the new zod pipeline
- `src/routes/+page.server.ts` — the single load function that composes all filter WHERE clauses; current code reads `range` + `grain` directly from `url.searchParams` and will be refactored to `parseFilters(url)`
- `src/lib/kpiAgg.ts`, `src/lib/nvrAgg.ts`, `src/lib/sparseFilter.ts` — aggregation helpers that consume the query results; check whether they need sales-type/payment-method awareness or stay pass-through

### Stack + conventions
- `CLAUDE.md` §"Technology Stack" — shadcn-svelte `@next`, Tailwind v4, Svelte 5 runes, zod 3.x, date-fns 4.x; CI guard-rail against `${` in `.from(…)`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`chipToRange()` in `src/lib/dateRange.ts`**: Already does Berlin-TZ date math and prior-window calculation. Extend (don't replace) to accept `{from: string, to: string}` in addition to preset IDs. The prior-window logic (D-08 delta tiles) must keep working on custom ranges.
- **`GrainToggle.svelte`**: Already URL-driven, already uses `$app/state`, already min-h-11. Keep as-is structurally; only its URL-update path needs to go through the new filter schema helper.
- **`DashboardHeader.svelte` + sticky layout in `+page.svelte`**: The header is already the natural anchor for a sticky filter bar — extend it, don't create a new shell.
- **`shadcn-svelte` primitives in `src/lib/components/ui/`**: Check what's already installed (Popover, Command, Sheet) before adding new primitives via the CLI.
- **Per-card `EmptyState` component**: Already handles the "filter returned zero rows" case per card. No global zero-result banner is needed — D-13 (hide empty dropdowns) + existing EmptyState covers the UX.

### Established Patterns
- **URL is source of truth**: All state lives in `url.searchParams`; components read via `page.url` from `$app/state`; state updates via `goto(newUrl)`. D-18 preserves this.
- **Per-card error isolation**: A failing query returns `null` and the card renders `EmptyState`. The new filter pipeline must not break this — each card's query stays independently try/catch'd.
- **Wrapper-view-only reads**: Every Supabase call goes through `*_v` views. `SELECT DISTINCT payment_method` must target a wrapper view, not `transactions` directly.
- **Svelte 5 runes** (`$props`, `$state`, `$derived`), not Svelte 4 reactive statements. New components follow the same style.
- **`$app/state`**, not the deprecated `$app/stores`.

### Integration Points
- `+page.server.ts` `load()` — the single choke point where `parseFilters(url)` replaces the current ad-hoc `url.searchParams.get()` calls.
- `+page.svelte` — new `<FilterBar>` component mounts in the header slot, replaces the current `<DateRangeChips>` call site.
- `hooks.server.ts` (existing JWT-binding) — untouched; `locals.supabase` already tenant-scoped, filters compose on top.

### Constraints Discovered
- Worldline/payment fields (`wl_issuing_country`, `card_type`) are **not yet promoted** to `transactions` as of Phase 5 — this is why FLT-05 belongs in Phase 7 (D-01). Verify by grepping current migrations before planning.
- `lifetime_bucket` **does not exist anywhere** in the v1.0 schema — it's introduced in Phase 8's `dim_customer` MV. FLT-06 is not buildable in Phase 6 even with stopgap code.
- `stg_orderbird_order_items.wl_issuing_country` exists (per data-model spec §2.4) — Phase 7, not Phase 6, is where it gets lifted.

</code_context>

<specifics>
## Specific Ideas

- **Sticky bar vertical budget**: keep under ~72px. The card grid is already dense at 375px; every pixel the bar steals is a pixel less for numbers.
- **Button label style**: `"7d"` or `"Custom"` on line 1, actual dates (`"Apr 8 – Apr 15"`) on line 2 underneath — two-line button. Communicates both the semantic intent and the literal dates at a glance.
- **"Reset all" inside sheet, not on bar**: the bar is for high-frequency interactions; reset is rare. Don't waste sticky real estate on it.
- **URL verbosity is intentional**: contra the common "strip defaults" pattern, this project wants defaults in the URL. The founder (growth analyst) will paste URLs into notes/bug reports — explicitness > cleanliness.

</specifics>

<deferred>
## Deferred Ideas

- **FLT-05 country filter** — moves to **Phase 7 (Column Promotion)** where `wl_issuing_country` lands on `transactions`. Phase 7 planner should add the dropdown, "DE only / non-DE only / individual countries" logic, and update the filter schema.
- **FLT-06 repeater-bucket filter** — moves to **Phase 8 (Star Schema)** where `lifetime_bucket` lands on `dim_customer` / `fct_transactions`. Phase 8 planner should add the dropdown and extend the filter schema.
- **"Filters (N)" badge count**: considered for D-04 and rejected in favor of subtle border/tint. If user-testing shows the tint is too subtle, revisit in a future iteration — not a scope item for this phase.
- **Inline removable active-filter chips**: considered and rejected for screen-space reasons at 375px. Not a backlog item.
- **Multi-select via custom bottom-sheet**: considered and rejected in favor of shadcn-svelte Command/Popover. Not a backlog item.
- **Strip-defaults URL mode**: considered and explicitly rejected (D-16). Not a backlog item.
- **Client-side query caching / CSR filter updates**: considered and rejected in favor of full SSR (D-18). Revisit only if perceived latency becomes a complaint.

### Reviewed Todos (not folded)
No pending todos matched Phase 6 scope at discussion time.

</deferred>

---

*Phase: 06-filter-foundation*
*Context gathered: 2026-04-15*
</content>
</invoke>