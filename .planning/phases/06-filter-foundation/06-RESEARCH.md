# Phase 6: Filter Foundation - Research

**Researched:** 2026-04-15
**Domain:** SvelteKit SSR filter pipeline + zod validation + Supabase wrapper-view composition on mobile
**Confidence:** HIGH (stack verified against installed package.json; architecture gotcha verified against migration SQL)

## Summary

Phase 6 replaces the ad-hoc `url.searchParams.get()` reads in `src/routes/+page.server.ts` with a single zod-validated filter pipeline (`parseFilters(url)`) that composes Supabase `*_v` wrapper-view queries through the client's typed `.in()` / `.gte()` / `.lte()` methods — never string interpolation. On the UI side, a two-line filter bar (date picker + grain toggle) sticks to the viewport at 375px, while sales-type and payment-method multi-selects live inside a Sheet drawer behind a "Filters" button.

**The central gotcha this research surfaces** (not flagged in CONTEXT.md): `kpi_daily_v`, `retention_curve_v`, `ltv_v`, `frequency_v`, and `new_vs_returning_v` **do not expose `payment_method` or `sales_type` columns** — they aggregate them out. See migration `0011_kpi_daily_mv_real.sql` (groups by `(restaurant_id, business_date)` only) and `0012_leaf_views.sql` (groups by cohort). This means Phase 6 cannot satisfy FLT-03/FLT-04 by just wiring the frontend — it needs a migration that either (a) adds a new wrapper-view family with those dims pushed into the group key, or (b) adds columnar filter views that pre-aggregate at `(business_date × sales_type × payment_method)` grain. The planner MUST address this before wiring the UI; otherwise the SSR load function will have no column to `.eq()` against.

**Primary recommendation:** Ship Phase 6 in three concerns — (1) one new migration `0018_kpi_daily_filter_v.sql` that rebuilds `kpi_daily_mv` with `sales_type` + `payment_method` in the group key and recreates `kpi_daily_v` (plus equivalent changes to the leaf views that need filter-awareness), (2) `src/lib/filters.ts` containing the zod schema + `parseFilters()` + `composeFilter(query, filters)` helpers, (3) the UI layer (FilterBar sticky header + Sheet drawer + custom date popover + hand-rolled Checkbox/Popover/Sheet primitives matching the 04-01 hand-roll pattern). All three land in the same phase; (1) is Wave 0 (data), (2) is Wave 1 (schema + load function), (3) is Wave 2 (components).

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** Phase 6 ships 4 filters (date range, grain, sales_type, payment_method), not 6. FLT-05 → Phase 7, FLT-06 → Phase 8. Planner must patch `ROADMAP.md` and `REQUIREMENTS.md` (phase column for FLT-05/06) as phase deliverables.
- **D-02** Filter bar is sticky to top of viewport at 375px.
- **D-03** Split hierarchy: date range picker + grain toggle inline on sticky bar; sales_type + payment_method inside a "Filters" button that opens a sheet/drawer.
- **D-04** Active-state indicator: non-default controls get subtle colored border/tint on the control itself. No badge count, no removable chip row.
- **D-05** Sticky bar vertical budget ≤ ~72px.
- **D-06** Date widget: custom Svelte popover containing preset buttons (Today / 7d / 30d / 90d / All) + two native `<input type="date">` elements for custom ranges.
- **D-07** Default range = 7d when no `?from`/`?to`/`?range` is present.
- **D-08** Closed-state button label: preset name if matches ("7d"), otherwise "Custom"; actual from/to dates on second line.
- **D-09** Presets live only inside the popover. Replaces `DateRangeChips` entirely.
- **D-10** Dropdown widget = shadcn-svelte-style Command/Popover with checkbox items (combobox-style). No native `<select>`, no custom bottom-sheet.
- **D-11** Multi-select for both sales_type and payment_method. URL carries comma-separated (`?payment=visa,mastercard`). zod parses to `string[]`. SQL uses `.in()`.
- **D-12** "All" sentinel = absent param. zod defaults missing fields to `undefined`; load function skips the corresponding `.in()` call.
- **D-13** Empty options: if `SELECT DISTINCT` returns 0 rows for a dropdown's source column (against the full wrapper view unfiltered by other filters), the dropdown is hidden entirely.
- **D-14** `DISTINCT` queries for dropdown options run against the full wrapper view unfiltered by other filters (options decoupled from current filter state).
- **D-15** "Reset all filters" button lives inside the Filters sheet, not on the sticky bar.
- **D-16** Defaults ARE kept in the URL explicitly (`?range=7d&grain=week`). Do NOT strip.
- **D-17** Invalid/malformed params coerce to defaults via `z.enum(...).catch('<default>')`. Page always renders; no redirects, no 400 pages.
- **D-18** Filter changes trigger full SSR navigation via `goto(newUrl)`. `load()` re-runs server-side.
- **D-19** Single flat zod schema in `src/lib/filters.ts` (new file). Exports parser and `FiltersState` type.
- **D-20** Schema is the ONLY place that knows default values.

### Claude's Discretion

- Sheet transition (slide-up vs. drawer vs. modal) — pick what fits 375px best.
- Exact Tailwind token for non-default active-state border/tint — should map to existing palette.
- `invalidateAll: true` inside `goto()` — allowed either way by D-18; pick the one that avoids flicker.
- Loading/skeleton state on filter change — planner decides if a transition skeleton is needed.
- Popover positioning at 375px (centered sheet vs. anchored vs. full-width modal).

### Deferred Ideas (OUT OF SCOPE)

- **FLT-05 country filter** → Phase 7 (needs `wl_issuing_country` promoted to `transactions`).
- **FLT-06 repeater-bucket filter** → Phase 8 (needs `lifetime_bucket` on `dim_customer` / `fct_transactions`).
- "Filters (N)" badge count — rejected.
- Inline removable active-filter chips — rejected (375px screen budget).
- Custom bottom-sheet multi-select — rejected (use shadcn-svelte Command/Popover).
- Strip-defaults URL mode — rejected (D-16).
- Client-side query caching / CSR filter updates — rejected (D-18).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLT-01 | Custom date-range picker replacing fixed chips; presets + arbitrary from/to | §Pattern 1 (native date input + popover); §Code Examples (`parseFilters` + `chipToRange` extension) |
| FLT-02 | Global day/week/month toggle | Existing `GrainToggle.svelte` kept structurally; re-wired through `parseFilters` |
| FLT-03 | Sales-type multi-select filter | §Critical Gotcha #1 (requires MV regroup migration); §Pattern 3 (`.in()` composition) |
| FLT-04 | Payment-method multi-select filter, auto-populated `SELECT DISTINCT` | §Critical Gotcha #1; §Pattern 4 (DISTINCT options query) |
| FLT-05 | *(deferred to Phase 7)* | — |
| FLT-06 | *(deferred to Phase 8)* | — |
| FLT-07 | All filters compile to zod-validated query params; no dynamic SQL; CI guard against `${` inside `.from()` | §Pattern 2 (zod schema); §Pattern 5 (ci-guards extension); §Don't Hand-Roll |

## Project Constraints (from CLAUDE.md)

- **Stack** (locked, matches installed package.json as of 2026-04-15):
  - SvelteKit 2.57+, Svelte 5.55+ (runes only: `$state` / `$derived` / `$props`, not `$:` reactive)
  - `@supabase/ssr` 0.5.x (NEVER the deprecated `@supabase/auth-helpers-sveltekit`)
  - `@supabase/supabase-js` 2.103.x
  - `@sveltejs/adapter-cloudflare` 7.2.x
  - Tailwind CSS v4.2 via Vite plugin (not PostCSS)
  - date-fns 4.1 + date-fns-tz 3.2 (both installed)
  - NO `zod` installed → must add `zod` 3.x (or `valibot` 1.x as smaller alt) — decision below
- **Read-path rule:** Frontend reads ONLY through `*_v` wrapper views. Raw MVs and raw `transactions` are `REVOKE ALL` on `authenticated` and blocked by `ci-guards.sh` Guard 1.
- **Query composition:** NEVER build `.from()` argument via string interpolation. `ci-guards.sh` will be extended to forbid `${` inside `.from(` per FLT-07.
- **State APIs:** use `$app/state` (NOT the deprecated `$app/stores`).
- **Mobile baseline:** 375px. `min-h-11` on all touch targets. Every PR verified at 375px before merge (04-01 contract).
- **Per-card error isolation:** failing queries return `null`; component renders `EmptyState`. Do NOT break this with a global try/catch around the new filter pipeline.
- **shadcn-svelte CLI is unreachable** (per 04-01 decision): `@next` registry returns HTML in a TTY-less environment. All UI primitives are hand-rolled under `src/lib/components/ui/`. Phase 6 MUST hand-roll the new Popover / Sheet / Command / Checkbox primitives the same way. Do NOT attempt `pnpm dlx shadcn-svelte@next add popover`; it will fail silently and waste a task slot.
- **GSD workflow:** All edits must happen through the GSD workflow — planner produces plans, executor edits files.

## Standard Stack

### Core (already installed — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SvelteKit | 2.57.1 | SSR load + `goto()` + `$app/state` | Phase 4 infrastructure, no change |
| Svelte | 5.55.4 | Runes-based reactivity | Already in use; `$state` across shared filter state |
| `@supabase/supabase-js` | 2.103.0 | `.from().select().in().gte().lte()` typed filter chain | Installed; the ONLY safe way to compose WHERE clauses |
| `@supabase/ssr` | 0.5.2 | Server-side auth for load functions | Installed; no-op for this phase |
| date-fns | 4.1.0 | Parsing/formatting/comparing dates in `chipToRange` extension | Installed; already used in `+page.server.ts` |
| date-fns-tz | 3.2.0 | Berlin timezone math on custom ranges | Installed; used in existing `dateRange.ts` |
| Tailwind CSS | 4.2.2 | Styling; mobile-first breakpoints default | Already configured via `@tailwindcss/vite` |

### New dependency (ADD)
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **zod** | 3.x (latest stable at install time) | Runtime validation of filter query params; `FiltersState` type export | FLT-07 mandates "zod-validated". CLAUDE.md lists zod 3.x as the standard. **Verify version at install time:** `npm view zod version`. |

**Alternative considered:** `valibot` 1.x. ~10× smaller bundle, same DX. **Do not pick it here** — CLAUDE.md explicitly says "zod 3.x" for Ramen Bones, and the bundle cost of zod at Phase 6's schema size (one flat object, ~5 fields) is negligible (<5 kB tree-shaken). Consistency with project convention wins.

**Installation command for planner:**
```bash
pnpm add zod
# or whatever package manager this project uses — check lockfile
```

### What NOT to add
- ❌ `shadcn-svelte` CLI / any new npm primitives — unreachable (see 04-01). Hand-roll.
- ❌ `@internationalized/date` / `cally` / any external date picker — D-06 specifies native `<input type="date">` inside a custom popover. Zero deps is the win.
- ❌ `svelte-query` / `tanstack-query` — rejected by D-18 (full SSR navigation).
- ❌ `bits-ui` — would pull in the full shadcn-svelte peer tree; hand-roll instead.
- ❌ `superforms` — this phase is read-only filter state, not form submission.

## Critical Gotchas (Architectural — read first)

### Gotcha #1: Filter columns don't exist on existing wrapper views (SHOW-STOPPER)

**Evidence:** `supabase/migrations/0011_kpi_daily_mv_real.sql` defines `kpi_daily_mv` as:
```sql
create materialized view public.kpi_daily_mv as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  sum(t.gross_cents)::numeric                   as revenue_cents,
  count(*)::int                                 as tx_count,
  ...
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
group by t.restaurant_id, business_date;  -- ← no sales_type, no payment_method
```
And `kpi_daily_v` selects only `(restaurant_id, business_date, revenue_cents, tx_count, avg_ticket_cents)`. Same shape on all the leaf views (`retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`) — they aggregate by cohort or bucket, not by filter dims.

**Why this matters:** FLT-03 and FLT-04 require `.eq('sales_type', ...)` and `.in('payment_method', [...])` on the query the load function runs. Those columns do not exist on any view the frontend is allowed to read (per CLAUDE.md Guard 1). You cannot satisfy FLT-03/04 with frontend-only changes.

**Options (planner picks):**

1. **Rebuild `kpi_daily_mv` with filter dims in the group key** (recommended for the KPI tiles). New migration `0018_kpi_daily_filter_v.sql` drops-cascade + recreates at `(restaurant_id, business_date, sales_type, payment_method)` grain. Size impact: current MV has ~200 rows (≈1 row per day); after regroup, ~200 × |sales_type| × |payment_method| ≈ 200 × 2 × 5 = ~2000 rows. Negligible. The existing fixed-position KPI tiles (todayW / w7 / w30) that should NOT respect filters stay on a separate unchanged view, OR the load function SUMs across filter dims for those three tiles — planner chooses.

2. **New sibling view `kpi_daily_filtered_v`** on top of the regrouped MV, leaving `kpi_daily_v` untouched. Cleaner backout path; more SQL.

3. **Skip filter-awareness for cards whose underlying view can't support it** (retention, LTV, frequency, NVR). FLT-03/04 only wire to the KPI tiles in Phase 6; other cards accept the filter but ignore it until Phase 8 (star schema). **This is the fastest path but partially violates the "every v1.0 card" success criterion in ROADMAP.md Phase 6.** Recommend documenting in the plan + updating ROADMAP.md success criterion #1 to "every filterable v1.0 card" with an explicit carve-out list.

**Recommendation:** Option 1 + Option 3 combined. Regroup `kpi_daily_mv` to satisfy FLT-03/04 for KPI tiles (the highest-value cards). Document that retention / LTV / frequency / NVR accept filters but currently ignore sales_type/payment_method — those will be wired in Phase 8 when `fct_transactions` lands with denormalized filter dims. Add an explicit ROADMAP.md success-criterion amendment to the phase's Task 1 (alongside the FLT-05/06 deferrals).

**Warning sign during execution:** If you see a plan task that writes `locals.supabase.from('retention_curve_v').eq('sales_type', …)` — STOP. That column doesn't exist on the view and Supabase will return a runtime error ("column does not exist"). The TS types generated from `supabase gen types typescript` will also flag it at check time.

### Gotcha #2: DISTINCT query for dropdown options must go through a wrapper view, not `transactions`

**Evidence:** Guard 1 in `scripts/ci-guards.sh` blocks `.from('transactions')` from `src/`. The DISTINCT query for the payment-method dropdown (FLT-04) must run through a view.

**Options (the new migration from Gotcha #1 solves both):**
- If `kpi_daily_mv` is regrouped to include `payment_method`, then `SELECT DISTINCT payment_method FROM kpi_daily_v WHERE payment_method IS NOT NULL` Just Works.
- Alternatively, a thin view `filter_options_v` exposing only `(restaurant_id, sales_type, payment_method)` at row grain from `transactions`, with the same JWT filter.

**Recommendation:** Combine with Gotcha #1 solution. After regroup, the regrouped `kpi_daily_v` is the dropdown options source.

### Gotcha #3: `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY` breaks Guard 3

**Evidence:** `scripts/ci-guards.sh` Guard 3 fails the build on any `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`. Guard 3b requires a unique index on every MV in the same migration file.

**Implication for Phase 6:** The regrouped `kpi_daily_mv` needs its unique index rebuilt to match the new group key: `create unique index kpi_daily_mv_pk on public.kpi_daily_mv (restaurant_id, business_date, sales_type, payment_method)`. If `payment_method` can be NULL (cash transactions!), `CONCURRENTLY` refresh fails because NULLs aren't unique. Use `coalesce(payment_method, 'UNKNOWN')` in the MV definition or add a partial index + handle NULL separately. **This is a real landmine** — the founder's data has 772 missing_worldline_rows with NULL payment_method (per STATE.md Phase 2 notes).

### Gotcha #4: `refresh_analytics_mvs()` must still work after regroup

**Evidence:** Phase 3 Plan 05 introduced `public.refresh_analytics_mvs()` which is called by pg_cron nightly. If the Phase 6 migration drops-cascade `kpi_daily_mv`, the function may break because it references the MV by name inside a plpgsql EXECUTE string. Verify the function body survives the drop-cascade the same way `refresh_kpi_daily_mv` did in 0011 (EXECUTE-as-string has no schema dep), but re-run it in CI after the migration.

### Gotcha #5: `chipToRange()` must be extended, not replaced

**Evidence:** `src/lib/dateRange.ts` exports a tight Berlin-TZ helper used by 8 parallel KPI queries. The load function relies on `priorFrom` / `priorTo` for D-08 delta tiles. Any extension to accept `{from, to}` custom ranges MUST preserve the prior-window math: given a custom range of N days, `priorTo = from - 1 day`, `priorFrom = priorTo - (N-1) days`. Do not replace the function; add an overload or a sibling `customToRange({from, to})` helper and teach the existing call sites to branch on `FiltersState.range.kind`.

### Gotcha #6: Svelte 5 runes, not stores

**Evidence:** Project uses `$app/state` (not `$app/stores`), `$state()` / `$derived()` / `$props()`. Do NOT introduce `writable()` or Svelte 4 `$:` reactive statements. Shared filter state across the FilterBar and the Sheet drawer must use `$state()` objects passed as props (or module-level `.svelte.ts` rune state if prop-drilling gets ugly — available in Svelte 5.1+).

### Gotcha #7: URL as source of truth — do not double-bind

**Evidence:** D-18 says "full SSR navigation via `goto(newUrl)`". The FilterBar components must NOT hold their own mutable local state for the filter values — they read from `page.url.searchParams` via `$app/state` and build a new URL on change. Any two-way binding (`bind:value={filters.range}`) that mutates a local copy will drift out of sync with the URL. Pattern: the open/closed state of the Popover/Sheet is local `$state`; the filter values are derived from `page.url`.

### Gotcha #8: Popover z-index + sticky header + Safari mobile

**Unverified but likely:** A sticky header with `position: sticky; top: 0; z-index: N` can create a new stacking context that traps child popovers below sibling content. Test the date picker popover on iOS Safari at 375px — if it clips, use a portal/teleport pattern (render the popover in a body-level container via `{#if open}` inside `<svelte:body>` or a `#popover-root` div outside the sticky header). Svelte 5 has no built-in portal; hand-roll with a fixed-position overlay.

## Architecture Patterns

### Recommended file layout (net-new + modified)

```
src/
├── lib/
│   ├── filters.ts                        # NEW — zod schema, parseFilters(), composeFilter(), FiltersState type
│   ├── dateRange.ts                      # MODIFIED — add customToRange({from, to}) sibling; keep chipToRange()
│   └── components/
│       ├── FilterBar.svelte              # NEW — sticky top-bar shell (date picker button + grain toggle + Filters button)
│       ├── DateRangePicker.svelte        # NEW — closed button + popover with presets + native <input type="date"> pair
│       ├── FiltersSheet.svelte           # NEW — drawer with sales-type + payment-method multi-selects + Reset button
│       ├── MultiSelectDropdown.svelte    # NEW — hand-rolled Command/Popover-style combobox with checkbox items
│       ├── GrainToggle.svelte            # KEPT — re-wired to read/write via filters.ts helpers
│       ├── DateRangeChips.svelte         # DELETED — replaced by DateRangePicker
│       └── ui/
│           ├── popover.svelte            # NEW hand-roll — matches existing hand-rolled primitives in ui/
│           ├── sheet.svelte              # NEW hand-roll
│           └── checkbox.svelte           # NEW hand-roll (unless a <label>+<input type=checkbox> wrapper is enough)
├── routes/
│   ├── +page.server.ts                   # MODIFIED — parseFilters(url) replaces ad-hoc searchParams reads; composeFilter() composes .in()/.gte()/.lte() chains
│   └── +page.svelte                      # MODIFIED — <FilterBar filters={...} /> mounted inside/above DashboardHeader
└── supabase/migrations/
    └── 0018_kpi_daily_filter_v.sql       # NEW — regroup kpi_daily_mv with sales_type + payment_method in group key; recreate kpi_daily_v wrapper; unique index includes new columns; coalesce(payment_method, 'UNKNOWN') for NULL safety
scripts/
└── ci-guards.sh                           # MODIFIED — new Guard 6 greps for `${` inside `.from(` in src/
.planning/
├── ROADMAP.md                             # MODIFIED — move FLT-05 → Phase 7, FLT-06 → Phase 8; amend Phase 6 success criterion for Gotcha #1 carve-out
└── REQUIREMENTS.md                        # MODIFIED — phase column for FLT-05/06
```

### Pattern 1: zod schema + `parseFilters()` (the contract)

```typescript
// src/lib/filters.ts  — NEW FILE
import { z } from 'zod';
import { chipToRange, customToRange, type RangeWindow } from './dateRange';

// Presets + 'custom' discriminator. 'all' preserved from v1.0.
const PRESETS = ['today', '7d', '30d', '90d', 'all'] as const;
export type Preset = (typeof PRESETS)[number];

// Comma-separated list → string[]; empty → undefined.
const csvList = z
  .string()
  .optional()
  .transform((s) => (s && s.length ? s.split(',').filter(Boolean) : undefined));

// Flat schema, single source of defaults (D-19, D-20).
// Invalid values coerce to default via .catch() (D-17).
export const filtersSchema = z.object({
  // Date range: either a preset label or a custom from/to pair.
  range: z.enum(PRESETS).catch('7d').default('7d'),      // D-07
  from:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // used only when range=custom semantically
  to:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  grain: z.enum(['day', 'week', 'month']).catch('week').default('week'),
  sales_type: csvList,       // multi-select → string[] | undefined
  payment:    csvList        // multi-select → string[] | undefined (URL key is `payment` not `payment_method` for brevity)
});

export type FiltersState = z.infer<typeof filtersSchema>;

export function parseFilters(url: URL): FiltersState {
  // .parse() never throws because every field uses .catch() or is optional (D-17).
  return filtersSchema.parse({
    range:      url.searchParams.get('range') ?? undefined,
    from:       url.searchParams.get('from')  ?? undefined,
    to:         url.searchParams.get('to')    ?? undefined,
    grain:      url.searchParams.get('grain') ?? undefined,
    sales_type: url.searchParams.get('sales_type') ?? undefined,
    payment:    url.searchParams.get('payment') ?? undefined
  });
}

// Resolve filters → (from, to, priorFrom, priorTo). Wraps chipToRange / customToRange.
export function filtersToWindow(f: FiltersState): RangeWindow {
  if (f.from && f.to) return customToRange({ from: f.from, to: f.to });
  return chipToRange(f.range);
}

// Rebuild the URL from a partial patch. Used by components on filter change
// before calling goto(). Defaults ARE kept in the URL per D-16 — do NOT strip.
export function buildFilterUrl(current: FiltersState, patch: Partial<FiltersState>, pathname = '/'): string {
  const next: Record<string, string> = {
    range: (patch.range ?? current.range) as string,
    grain: (patch.grain ?? current.grain) as string
  };
  // Custom range: include from/to only when both present.
  const from = patch.from ?? current.from;
  const to   = patch.to   ?? current.to;
  if (from && to) { next.from = from; next.to = to; }
  // Multi-selects: serialize array → csv, omit when undefined.
  const sales = patch.sales_type ?? current.sales_type;
  if (sales && sales.length) next.sales_type = sales.join(',');
  const payment = patch.payment ?? current.payment;
  if (payment && payment.length) next.payment = payment.join(',');
  return pathname + '?' + new URLSearchParams(next).toString();
}
```

### Pattern 2: `composeFilter()` — safe Supabase query builder (FLT-07)

```typescript
// src/lib/filters.ts — continued
import type { SupabaseClient } from '@supabase/supabase-js';

// Generic query builder that applies filter dims to any Supabase query.
// Signature is the *chainable* filter builder, not the client — caller has
// already chosen the view via .from(). That's the invariant that matters:
// .from() never takes a user-controlled string.
export function composeFilter<T>(
  query: ReturnType<SupabaseClient['from']>,   // or a more precise filter-builder type
  filters: FiltersState,
  window: RangeWindow
) {
  // Date range is universal — every view has business_date (or equivalent).
  let q = query.gte('business_date', window.from).lte('business_date', window.to);
  // Multi-select → .in() (Supabase translates to SQL `column = ANY($1)`).
  if (filters.sales_type && filters.sales_type.length) {
    q = q.in('sales_type', filters.sales_type);
  }
  if (filters.payment && filters.payment.length) {
    q = q.in('payment_method', filters.payment);   // URL param name → column name mapping happens here
  }
  return q;
}
```

**Why this is safe:** `.in()` uses parameterized queries under the hood (Postgres `= ANY($1::text[])`). There is **no string concatenation** between user input and SQL. Supabase-js serializes the array as a JSONB / PostgREST `in.(a,b,c)` filter. The column name (`'sales_type'`) is a string literal in our code, not from user input. `.from()` is called with a literal view name elsewhere. FLT-07 is satisfied.

### Pattern 3: `+page.server.ts` refactor (integration point)

Replace the two current lines:
```typescript
// BEFORE
const range = (url.searchParams.get('range') ?? '7d') as Range;
const grain = (url.searchParams.get('grain') ?? 'week') as Grain;
```
with:
```typescript
// AFTER
import { parseFilters, filtersToWindow, composeFilter } from '$lib/filters';

const filters = parseFilters(url);
const window = filtersToWindow(filters);
// `range` / `grain` still used downstream for label strings — derive from filters.
const range = filters.range;
const grain = filters.grain;
```

And every `locals.supabase.from('kpi_daily_v').select(...)...gte('business_date', ...)` becomes:
```typescript
const q = locals.supabase.from('kpi_daily_v').select('revenue_cents,tx_count,avg_ticket_cents');
const { data, error } = await composeFilter(q, filters, window);
```

**Preserve per-card error isolation:** each query stays independently try/catched; `composeFilter` returns a builder, not a promise. The existing `queryKpi` helper pattern still works.

### Pattern 4: Dropdown options query (FLT-04, D-13, D-14)

```typescript
// In +page.server.ts load() — run once, in parallel with the KPI queries.
// Options are decoupled from current filter state (D-14): no .in() applied here.
const paymentOptionsP = locals.supabase
  .from('kpi_daily_v')                         // the regrouped-view from Gotcha #1 solution
  .select('payment_method')
  .not('payment_method', 'is', null)
  .then(r => {
    if (r.error || !r.data) return [];
    // Distinct client-side — cheap for <100 rows.
    return Array.from(new Set(r.data.map((x: any) => x.payment_method as string))).sort();
  })
  .catch(() => [] as string[]);

// D-13: if options array is empty, UI hides the dropdown entirely.
// Pass `paymentOptions: string[]` down to <FiltersSheet />.
```

**Important:** `.select('payment_method')` does NOT return distinct rows — PostgREST has no `DISTINCT` keyword. Either:
- Client-side dedupe (as above — fine for ≤100 distinct values).
- Or create a tiny RPC function `get_payment_methods()` that runs `SELECT DISTINCT payment_method FROM kpi_daily_v ...` server-side and call it via `locals.supabase.rpc('get_payment_methods')`. Cleaner, one more migration. Recommended if distinct set grows past ~50.

### Pattern 5: CI guard for dynamic SQL (FLT-07)

```bash
# scripts/ci-guards.sh — NEW GUARD 6 (or whatever the next number is)
# Guard 6 (FLT-07): No string interpolation inside .from(…) in src/.
# Matches .from('...${anything}...') — a template literal inside the call.
if [ -d src ]; then
  if grep -rnE '\.from\(`[^`]*\$\{[^`]*\`\)' src/ 2>/dev/null; then
    echo "::error::Guard 6 FAILED: src/ uses template-literal interpolation inside .from(). View names must be string literals (FLT-07, filter foundation)."
    fail=1
  fi
fi
```

**Write a positive + negative contract test in `tests/unit/ci-guards.test.ts`** (pattern from Phase 3 Plan 01): a synthetic test file containing a forbidden `.from(\`foo${x}\`)` should make the guard exit 1; a clean `.from('kpi_daily_v')` should exit 0.

### Pattern 6: FilterBar shared state via runes (D-03, mobile layout)

```svelte
<!-- src/lib/components/FilterBar.svelte -->
<script lang="ts">
  import { page } from '$app/state';
  import { parseFilters } from '$lib/filters';
  import DateRangePicker from './DateRangePicker.svelte';
  import GrainToggle from './GrainToggle.svelte';
  import FiltersSheet from './FiltersSheet.svelte';
  import { Button } from './ui';

  // Props: dropdown options + counts of non-default filters for the active-state tint (D-04).
  let { paymentOptions, salesTypeOptions }: {
    paymentOptions: string[];
    salesTypeOptions: string[];
  } = $props();

  // Derived from URL — never local copy (Gotcha #7).
  const filters = $derived(parseFilters(page.url));
  const hasNonDefaultFilters = $derived(
    (filters.sales_type?.length ?? 0) > 0 || (filters.payment?.length ?? 0) > 0
  );

  // Local UI state — sheet open/closed is fine as local $state.
  let sheetOpen = $state(false);
</script>

<!-- ~72px vertical budget; min-h-11 on all tap targets -->
<div class="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-3 py-2 flex items-center gap-2">
  <DateRangePicker {filters} class="flex-1 min-h-11" />
  <GrainToggle {filters} class="min-h-11" />
  <Button
    variant="outline"
    class="min-h-11 {hasNonDefaultFilters ? 'border-primary/60 bg-primary/5' : ''}"
    onclick={() => (sheetOpen = true)}
  >
    Filters
  </Button>
</div>

<FiltersSheet bind:open={sheetOpen} {filters} {paymentOptions} {salesTypeOptions} />
```

### Anti-patterns to avoid

- **Local mutable copy of filter state:** `let range = $state(filters.range)` + `bind:value={range}` — drifts from URL; the page.url is the canonical source.
- **`$:` reactive statements:** Svelte 4 style — not in Svelte 5 runes mode.
- **`writable()` stores:** use `$state` in a `.svelte.ts` module instead.
- **Mutating the Sheet's filter draft + applying on close:** CONTEXT.md does not mandate a draft-then-apply UX. Each control change = immediate `goto()` (matches existing chip pattern). If you want draft-and-apply, ask user first.
- **Calling `goto(newUrl, { replaceState: true })`:** breaks back-button history. Use default `goto()` which pushes.
- **Rendering the popover inside the sticky header without a portal check:** Gotcha #8. Test on iOS before committing.
- **Mapping URL param `payment` directly to column `payment` in composeFilter:** the DB column is `payment_method`. Do the mapping inside `composeFilter`, not in zod (URL keys stay short, SQL stays correct).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Query param validation | Custom `if (typeof x === 'string' && ['7d','30d',...].includes(x))` | `zod` .enum().catch() | D-17 requires graceful coercion; zod does this in one line |
| SQL WHERE clause composition | Template string `where ${col} = '${val}'` | Supabase `.eq()` / `.in()` / `.gte()` chain | FLT-07 forbids it and Guard 6 will fail the build |
| Date math on custom ranges | `new Date(from).getTime() + n * 86400000` | date-fns `differenceInDays` / `subDays` + date-fns-tz for Berlin | Existing `dateRange.ts` uses date-fns; consistency |
| Deduplicating dropdown options | Nested `for` loop, `indexOf` check | `Array.from(new Set(arr))` | Stdlib one-liner |
| Checkbox-style combobox | Hand-write keyboard nav, ARIA, focus trap | Pattern-match against existing hand-rolled `toggle-group.svelte` in `src/lib/components/ui/` | Project has a precedent style; follow it |
| Popover positioning | Manual `getBoundingClientRect` + position math | Fixed-position centered or anchored-below-button; full-width at 375px is cleanest | At 375px there's no "position under button" — the popover is effectively modal-ish |

**Key insight:** everything in this phase is compositional. zod, date-fns, and supabase-js already own the hard problems. Hand-roll only the UI primitives (Popover/Sheet/Checkbox/MultiSelectDropdown) because the shadcn CLI is unreachable — and even then, match the existing `src/lib/components/ui/` style (copy + adapt from button.svelte / toggle-group.svelte).

## Common Pitfalls

### Pitfall 1: NULL `payment_method` blows up `REFRESH CONCURRENTLY`

**What goes wrong:** After regrouping `kpi_daily_mv` with `payment_method` in the group key, cash transactions (NULL) all collapse to one "NULL payment_method" row per day, which is fine — BUT the unique index `(restaurant_id, business_date, sales_type, payment_method)` treats NULLs as distinct in Postgres, so if two rows have `payment_method = NULL` (which shouldn't happen after aggregation but CAN happen mid-migration), CONCURRENTLY refresh fails with "could not create unique index".
**Why it happens:** Postgres `UNIQUE` columns allow multiple NULLs; only `UNIQUE NULLS NOT DISTINCT` (Postgres 15+) treats them as equal.
**How to avoid:** Either `coalesce(payment_method, 'UNKNOWN')` in the MV definition so the column is never NULL, OR use `UNIQUE NULLS NOT DISTINCT` (Supabase is Postgres 15+, so available). Recommend the coalesce approach — more portable, makes the dropdown option set explicit ("UNKNOWN" appears in the distinct list, which is actually correct UX — the founder can filter to "cash only" via that sentinel).
**Warning signs:** CI `test:integration` fails on the nightly-refresh test with "could not create unique index cohort_week_...".

### Pitfall 2: `parseFilters` throws on malformed multi-select

**What goes wrong:** `?payment=` (empty) or `?payment=,` (trailing comma) parses to `['']` which then goes into `.in('payment_method', [''])` and returns zero rows silently — everything looks broken.
**Why it happens:** Naive `split(',')` doesn't filter empty strings.
**How to avoid:** The `csvList` transform in Pattern 1 already does `.filter(Boolean)` — enforce it in unit tests with a fixture `?payment=,,,` → `undefined`.

### Pitfall 3: Browser back/forward after filter change shows stale data

**What goes wrong:** `goto(newUrl)` with default `invalidateAll: false` may not re-run `load()` if SvelteKit decides the old data is still valid. The user hits Back and sees the new dashboard with the old URL.
**Why it happens:** SvelteKit client navigations try to reuse already-loaded data.
**How to avoid:** Use `goto(newUrl, { invalidateAll: true })` OR mark the load function as always-invalidated via `depends()` / `url.searchParams` touch. Since the load function already reads `url`, SvelteKit should re-run it automatically — but verify with an e2e test (click a filter, hit Back, assert the KPI tiles match the previous filter values).

### Pitfall 4: Custom-range date input lets user pick `from > to`

**What goes wrong:** User picks `from=2026-04-20, to=2026-04-01`. `chipToRange` / `customToRange` returns a negative window; `.gte().lte()` returns zero rows; every card renders EmptyState.
**Why it happens:** Native `<input type="date">` has no cross-field constraint.
**How to avoid:** `customToRange` swaps the two if from > to, OR zod refines the schema to require `from <= to` and defaults to 7d if violated. Prefer the zod refine — consistent with D-17.
```typescript
.refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be ≤ to' })
// then .catch({ range: '7d', ... }) at the top level
```

### Pitfall 5: Sticky header covers the first KPI tile when filter bar grows

**What goes wrong:** The sticky filter bar is 72px + the existing DashboardHeader is ~56px = 128px of fixed vertical real estate. First KPI tile partially scrolls behind when the user scrolls.
**Why it happens:** `sticky` elements don't add top-padding to following content automatically.
**How to avoid:** Either (a) merge the FilterBar INTO DashboardHeader (D-03 allows this — check 04-CONTEXT.md layout), or (b) add `scroll-margin-top: 128px` to card elements for anchor-scroll correctness. Verify at 375px.

### Pitfall 6: Running `SELECT DISTINCT` on every page load is wasteful but fine at current scale

**What it is:** The dropdown options query runs on every SSR load. At ~6,842 transactions / ~200 days, the cost is negligible (<10ms). At 100× scale it'd matter.
**Not a problem in Phase 6. Not a reason to cache.** Document it and move on. If latency becomes a complaint post-ship, cache in `locals` within the request lifetime or move to a weekly-refreshed `filter_options_v` MV.

### Pitfall 7: Guard 6 false positive on tagged template in non-query context

**What goes wrong:** Guard 6 regex `\.from\(`[^\`]*\${[^\`]*\`\)` might fire on unrelated code: `array.from(\`item-${i}\`)` in JS. Actually no — `array.from(` not `.from(` isn't preceded by a method call chain. But any `stream.from(\`…${x}…\`)` would.
**How to avoid:** Tighten the regex to match only against Supabase-like patterns, e.g., require `supabase` or `locals\.\w+` on the same line or within a short window. Or just accept the false positive and add an inline `// eslint-disable-next-line` sibling comment. Simpler: the guard is specifically "template literal inside any `.from(`" — document the false-positive class and move any legit `array.from(\`...\`)` to `Array.from(...)`.

## Environment Availability

Phase 6 adds one new npm dep (`zod`) and one new migration. Everything else is already available.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / pnpm | Build + tests | ✓ | (existing) | — |
| SvelteKit 2 + Svelte 5 | Everything | ✓ | 2.57 / 5.55 | — |
| `@supabase/supabase-js` | Query composition | ✓ | 2.103.0 | — |
| date-fns / date-fns-tz | `customToRange` | ✓ | 4.1 / 3.2 | — |
| Tailwind v4 | FilterBar styling | ✓ | 4.2 | — |
| `zod` | Filter schema (FLT-07) | ✗ | — | **BLOCKING — must install (`pnpm add zod`)**; planner Task 0 |
| Supabase CLI (migrations) | New migration 0018 | ✓ (assumed; Phase 3 used it) | — | — |
| `pg_cron` running on Supabase | Nightly refresh of regrouped MV | ✓ (live on DEV per Phase 3 Plan 05) | — | — |
| shadcn-svelte CLI | Auto-add Popover/Sheet | ✗ | — | **Hand-roll primitives** (04-01 pattern) — not a blocker, just a task-count adjustment |
| Playwright Chromium mobile emulation | e2e at 375px | ✓ (04-02 config) | — | — |
| Vitest + @testing-library/svelte | Unit tests | ✓ | 4.1 / 5.3 | — |

**Missing with no fallback:** None.
**Missing with fallback:** `zod` (install); `shadcn-svelte` CLI (hand-roll primitives, documented pattern).

## Code Examples

### `customToRange({from, to})` extension (for `dateRange.ts`)

```typescript
// src/lib/dateRange.ts — extension
import { differenceInDays, addDays, subDays, parseISO, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

export function customToRange({ from, to }: { from: string; to: string }): RangeWindow {
  // Defensive swap — Pitfall 4 defense-in-depth.
  const [f, t] = from <= to ? [from, to] : [to, from];
  const fDate = parseISO(f);
  const tDate = parseISO(t);
  const days = differenceInDays(tDate, fDate) + 1;  // inclusive

  const priorTo = subDays(fDate, 1);
  const priorFrom = subDays(priorTo, days - 1);

  return {
    from: f,
    to: t,
    priorFrom: format(priorFrom, 'yyyy-MM-dd'),
    priorTo:   format(priorTo,   'yyyy-MM-dd')
  };
}
```

### Migration 0018 skeleton (the gotcha #1 fix)

```sql
-- supabase/migrations/0018_kpi_daily_filter_v.sql
-- Phase 6 FLT-03/04: regroup kpi_daily_mv with sales_type + payment_method
-- in the group key so the filter pipeline has columns to filter on.
-- Preserves the wrapper-view + CONCURRENTLY refresh + Guard 1 contract.

drop materialized view public.kpi_daily_mv cascade;

create materialized view public.kpi_daily_mv as
select
  t.restaurant_id,
  (t.occurred_at at time zone r.timezone)::date as business_date,
  coalesce(t.sales_type,    'UNKNOWN')            as sales_type,      -- NULL-safe for unique index
  coalesce(t.payment_method,'UNKNOWN')            as payment_method,  -- Pitfall 1
  sum(t.gross_cents)::numeric                     as revenue_cents,
  count(*)::int                                   as tx_count,
  case when count(*) = 0 then null
       else (sum(t.gross_cents)::numeric / count(*)) end as avg_ticket_cents
from public.transactions t
join public.restaurants r on r.id = t.restaurant_id
group by t.restaurant_id,
         (t.occurred_at at time zone r.timezone)::date,
         coalesce(t.sales_type, 'UNKNOWN'),
         coalesce(t.payment_method, 'UNKNOWN');

-- Unique index includes the new dims (Guard 3b + Pitfall 1)
create unique index kpi_daily_mv_pk
  on public.kpi_daily_mv (restaurant_id, business_date, sales_type, payment_method);

revoke all on public.kpi_daily_mv from anon, authenticated;

create view public.kpi_daily_v as
select restaurant_id, business_date, sales_type, payment_method,
       revenue_cents, tx_count, avg_ticket_cents
from public.kpi_daily_mv
where restaurant_id::text = (auth.jwt()->>'restaurant_id');

grant select on public.kpi_daily_v to authenticated;

-- Re-run the refresh function to rebuild the MV with the new body.
-- refresh_analytics_mvs() uses EXECUTE-as-string, so no schema dep (verified 0011).
select public.refresh_analytics_mvs();
```

**Downstream: every existing call to `kpi_daily_v` that SUMs by date must now SUM across `sales_type` + `payment_method` OR apply the new filters. The three fixed-position KPI tiles (today/7d/30d) currently ignore filters — decision time:**
- Option A: they keep ignoring filters (SUM over all sales_type/payment_method). Simpler. Matches "fixed reference" UX.
- Option B: they respect the filters. More consistent. Requires re-running aggregation on every filter change.

**Recommend Option A** — the three fixed tiles are explicitly "context" per 04-CONTEXT (today/week/month as absolute reference). The filter-scoped tile (chipW) already exists and will respect filters. Phase 6 planner makes this explicit.

## State of the Art

| Old (v1.0) | New (v1.1 Phase 6) | Why |
|------------|-----|-----|
| `url.searchParams.get('range') ?? '7d'` ad-hoc | `parseFilters(url)` + zod schema | FLT-07; single source of defaults (D-20) |
| `DateRangeChips.svelte` fixed preset chips | `DateRangePicker.svelte` popover with presets + custom `<input type="date">` pair | FLT-01; preserves presets + adds custom range |
| `GrainToggle.svelte` reads URL directly | Same component, re-wired through `buildFilterUrl()` helper | Consistency — one place to rebuild URLs |
| No filter composition helper | `composeFilter(query, filters, window)` | FLT-07; Guard 6 static check |
| `kpi_daily_v` aggregated by date only | `kpi_daily_v` aggregated by `(date, sales_type, payment_method)` | Gotcha #1 — required for FLT-03/04 |
| CI guards: 5 | CI guards: 6 (new Guard 6 for `${` inside `.from(`) | FLT-07 enforcement |

**Deprecated after this phase:**
- `DateRangeChips.svelte` — delete after wiring the new picker.
- Any direct `url.searchParams.get(...)` reads inside `+page.server.ts` — replaced by `parseFilters`.

## Open Questions

1. **Do retention / LTV / frequency / NVR cards respect sales_type + payment_method filters in Phase 6, or only in Phase 8?**
   - What we know: their underlying MVs aggregate by cohort / bucket, not filter dims. Retrofitting each MV's group key for Phase 6 is scope-blowing.
   - Recommendation: **Phase 6 wires the filters into the load function and SSR pipeline for ALL cards, but retention/LTV/frequency/NVR ignore sales_type and payment_method at the SQL level in Phase 6.** The filter bar still shows them active (with tint), the KPI tiles respect them fully, and the other cards get rewired in Phase 8 when `fct_transactions` lands. Document this carve-out in the ROADMAP.md amendment and in the phase's SUMMARY.md at ship time.
   - Alternative: regroup every leaf view with filter dims in the group key — 4 more migrations, a lot of re-testing of the cohort fixture. **Recommend against.**

2. **Draft-and-apply UX inside the Sheet vs. instant apply per control change?**
   - What we know: D-18 says full SSR navigation on change. That implies instant — but on mobile, flipping four checkboxes inside a sheet and reloading four times is jarring.
   - Recommendation: **Instant apply on the sticky bar (date, grain) because one action = one reload; draft-and-apply inside the Sheet (sales_type, payment_method) with an "Apply" button at the bottom.** This avoids four navigations for a multi-checkbox change. CONTEXT.md does not explicitly rule this out; Claude's Discretion.

3. **URL param names: `sales_type` vs `st`, `payment` vs `pm`?**
   - CONTEXT.md does not specify.
   - Recommendation: **Use full names (`sales_type`, `payment`)** for the founder's URL-in-notes use case (D-16 explicitness principle). The 20-char overhead is negligible.

4. **Do we keep `DateRangeChips.svelte` for backward compat or delete immediately?**
   - D-09 says "Replaces the current DateRangeChips entirely." Delete.

## Validation Architecture

Nyquist validation is enabled (`.planning/config.json` has `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (unit + component via @testing-library/svelte 5.3.1) + Playwright 1.59 (e2e, chromium mobile emulation at 375×667) |
| Config file | `vitest.config.ts`, `playwright.config.ts` (existing) |
| Quick run command | `pnpm test:unit` (vitest run tests/unit) |
| Full suite command | `pnpm test && pnpm test:integration && pnpm test:e2e && pnpm test:guards` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLT-01 | `parseFilters()` coerces `?range=7d` → `{range:'7d', ...}`; `?range=xyz` → default `7d` (D-17) | unit | `pnpm vitest run tests/unit/filters.test.ts -t parseFilters` | ❌ Wave 0 |
| FLT-01 | `parseFilters()` with `?from=2026-04-01&to=2026-04-10` returns custom window; `customToRange` prior-window math matches | unit | `pnpm vitest run tests/unit/dateRange.test.ts -t customToRange` | ❌ Wave 0 |
| FLT-01 | `DateRangePicker` closed-label shows "7d" when matching preset, "Custom" otherwise (D-08) | component | `pnpm vitest run tests/unit/DateRangePicker.test.ts` | ❌ Wave 0 |
| FLT-02 | `GrainToggle` rewires through `buildFilterUrl()` and preserves other filter params | component | `pnpm vitest run tests/unit/GrainToggle.test.ts -t preserves` | ❌ Wave 0 (extend existing) |
| FLT-03 | `composeFilter(q, { sales_type: ['INHOUSE'] })` applies `.in('sales_type', ['INHOUSE'])`; absent → no-op (D-12) | unit (mock Supabase builder) | `pnpm vitest run tests/unit/filters.test.ts -t composeFilter` | ❌ Wave 0 |
| FLT-04 | Dropdown options query returns distinct payment_methods from `kpi_daily_v`; empty array → dropdown hidden (D-13) | integration | `pnpm test:integration -t payment_options` | ❌ Wave 0 |
| FLT-04 | `.in('payment_method', [...])` composes correctly with 1, 2, 5 values; empty array = no-op | unit | `pnpm vitest run tests/unit/filters.test.ts -t multi_in` | ❌ Wave 0 |
| FLT-07 | zod schema parses ALL invalid inputs (null/undefined/bad enum/bad date format) without throwing (D-17) | unit | `pnpm vitest run tests/unit/filters.test.ts -t invalid_inputs` | ❌ Wave 0 |
| FLT-07 | Guard 6 ci-guards script greps for `${` inside `.from(` and fails; a clean `.from('kpi_daily_v')` passes (positive + negative contract test) | integration (shell) | `pnpm test:guards && bash tests/integration/guard6-negative.sh` | ❌ Wave 0 |
| FLT-07 | Integration test: malicious `?range='; DROP TABLE--` coerces to default and returns 200 OK with 7d data | integration | `pnpm test:integration -t sql_injection_coerce` | ❌ Wave 0 |
| All | Sticky filter bar renders at 375px without horizontal scroll; Filters button opens Sheet; checking a box + Apply updates URL | e2e (Playwright) | `pnpm test:e2e tests/e2e/filterbar-375.spec.ts` | ❌ Wave 0 |
| All | URL round-trip: set all filters → `goto()` → parseFilters(page.url) matches input exactly (D-16 defaults in URL) | e2e | `pnpm test:e2e tests/e2e/filter-url-roundtrip.spec.ts` | ❌ Wave 0 |
| All | Back-button navigation after filter change shows previous filter state (Pitfall 3) | e2e | `pnpm test:e2e tests/e2e/filter-back-button.spec.ts` | ❌ Wave 0 |
| Gotcha #1 | After migration 0018, `kpi_daily_v` returns rows with `sales_type` + `payment_method` columns; existing Phase 4 KPI tile totals still match (aggregate across filter dims) | integration | `pnpm test:integration -t kpi_daily_mv_regroup` | ❌ Wave 0 |
| Pitfall 1 | `REFRESH MATERIALIZED VIEW CONCURRENTLY kpi_daily_mv` succeeds after migration 0018 on a fixture with NULL payment_method rows | integration | `pnpm test:integration -t refresh_concurrent_null_safe` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:unit && pnpm test:guards`
- **Per wave merge:** `pnpm test && pnpm test:integration && pnpm test:e2e`
- **Phase gate:** Full suite green + Playwright 375px run green + `pnpm test:guards` green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/filters.ts` + `tests/unit/filters.test.ts` — zod schema + parseFilters + composeFilter coverage (covers FLT-01/03/04/07)
- [ ] `tests/unit/dateRange.test.ts` — extend with `customToRange` cases (covers FLT-01)
- [ ] `tests/unit/DateRangePicker.test.ts` — new component test (covers FLT-01 UX)
- [ ] `tests/unit/GrainToggle.test.ts` — extend to assert preservation of other filter params (covers FLT-02)
- [ ] `tests/integration/filter-pipeline.test.ts` — load function contract with filter combos, dropdown-options query, SQL injection coercion (covers FLT-04/FLT-07)
- [ ] `tests/integration/migration-0018.test.ts` — regrouped MV contract + concurrent refresh null-safety (covers Gotcha #1, Pitfall 1)
- [ ] `tests/integration/guard6-positive.sh` + `guard6-negative.sh` — ci-guards Guard 6 contract tests
- [ ] `tests/e2e/filterbar-375.spec.ts` — sticky layout, Sheet open, apply, back button (covers all requirements at the mobile viewport)
- [ ] `pnpm add zod` — install before any test runs that import from `$lib/filters`

**Nyquist pattern (per 03-01 precedent):** Wave 0 ships RED `it.todo(...)` stubs for every row in the req→test table above. Downstream waves flip `.todo` → `.it` as each component/migration lands. The phase closes when all stubs are GREEN.

## Sources

### Primary (HIGH confidence)
- `package.json` @ project root — verified installed versions of SvelteKit, Svelte, Supabase, date-fns, Tailwind, Playwright, Vitest as of 2026-04-15
- `src/routes/+page.server.ts` — verified current load-function shape, filter-related code, integration points
- `src/lib/dateRange.ts` — verified existing `chipToRange` API that must be extended
- `src/lib/components/` — verified existing component inventory and hand-rolled ui/ primitives
- `scripts/ci-guards.sh` — verified Guard 1 regex shape and extension point for Guard 6
- `supabase/migrations/0011_kpi_daily_mv_real.sql` — verified `kpi_daily_mv` group key does NOT include filter dims (Gotcha #1 evidence)
- `supabase/migrations/0012_leaf_views.sql` — verified leaf views aggregate by cohort, no filter dims (Gotcha #1 scope evidence)
- `supabase/migrations/0008_transactions_columns.sql` — verified `payment_method` and `sales_type` exist on raw `transactions` table
- `.planning/phases/06-filter-foundation/06-CONTEXT.md` — authoritative user decisions
- `.planning/phases/04-mobile-reader-ui/*` — precedent for hand-rolled ui/ primitives, 375px testing, `$app/state` usage, per-card error isolation
- `CLAUDE.md` — authoritative stack, deprecated libraries, Guard rules

### Secondary (MEDIUM confidence)
- Supabase JS docs for `.in()` (training data) — `.in()` uses parameterized `ANY($1)` under the hood. Not re-verified against Context7 this session; behavior consistent across supabase-js 2.x per my training. If planner hits unexpected SQL serialization, verify with a single integration test row.
- zod v3 `z.enum().catch().default()` chaining — well-established API; confidence HIGH from training data.
- Postgres `UNIQUE NULLS NOT DISTINCT` (Postgres 15+) — confirmed standard behavior; Supabase Postgres is ≥15 per CLAUDE.md.

### Tertiary (LOW confidence — flag for validation)
- **iOS Safari popover stacking-context behavior** (Gotcha #8) — a known class of bug but not re-verified against current Safari. Test on real device or Playwright webkit (not available in sandbox per 04-02 decision — will need manual 375px check).
- **SvelteKit `goto()` without `invalidateAll` re-running load on same-URL-different-searchParams** — I'm fairly confident it DOES re-run because `url` is a load-function dependency, but verify with the back-button e2e test.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against installed package.json and project conventions in CLAUDE.md
- Architecture patterns: HIGH — all four patterns match existing Phase 3/4 precedent; zod schema is standard
- **Critical gotcha #1 (MV regroup required):** HIGH — direct evidence from migration 0011 and 0012 SQL bodies
- Pitfalls: HIGH (Pitfalls 1, 3, 4, 5), MEDIUM (Pitfalls 2, 6, 7), LOW (Gotcha #8)
- Validation architecture: HIGH — follows the Nyquist Wave 0 pattern established by Phase 03 Plan 01

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days — stack is stable; only zod version drift is a watch-item)
