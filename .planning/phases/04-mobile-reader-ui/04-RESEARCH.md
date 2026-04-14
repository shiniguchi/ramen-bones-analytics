# Phase 4: Mobile Reader UI - Research

**Researched:** 2026-04-14
**Domain:** SvelteKit 2 + Svelte 5 + Cloudflare Pages + Supabase SSR + LayerChart (mobile-first analytics dashboard)
**Confidence:** HIGH (stack is locked by CLAUDE.md + 04-CONTEXT.md + 04-UI-SPEC.md; all reference files already exist)

## Summary

Phase 4 is the first SvelteKit code in the repo. Everything architecturally load-bearing is already decided — stack is locked (CLAUDE.md), decisions are locked (04-CONTEXT.md D-01..D-22), visual/interaction contract is locked (04-UI-SPEC.md), and the auth wiring is pre-written under `docs/reference/*.example`. The planner's job is execution sequencing, not design.

Three things make this phase non-trivial despite the locked inputs: (1) it's the first time `src/` exists, so `svelte.config.js`, `vite.config.ts`, `src/app.html`, `src/app.d.ts`, Tailwind v4 + shadcn-svelte@next init, and CF Pages bindings must all land at once and pass Phase 1's CI guards on the first PR; (2) Phase 4 ships one tiny migration (`0014_data_freshness_v.sql`) that must follow Phase 1's wrapper-view + JWT-filter + REVOKE pattern exactly; (3) the `+page.server.ts` loader must query six wrapper views in parallel via `@supabase/ssr` (not the admin client) and shape the response so each card's empty/error state is per-card, not global.

**Primary recommendation:** Bootstrap in one "Wave 0" plan (SvelteKit init + adapter-cloudflare + Tailwind v4 + shadcn-svelte@next init + copy-paste reference files + data_freshness_v migration + smoke test that CI guards still pass), then split implementation into per-card plans (KPI tiles, cohort card, LTV card, frequency card, new-vs-returning card) that each end with a 375px screenshot and a component-scoped Vitest.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Layout & Navigation**
- **D-01:** Single scrolling page at `/`. All cards stack top-to-bottom on one route. Login redirects here after auth; logout icon (`⎋`) in header top-right.
- **D-02:** Card order: Revenue KPIs → Cohort retention → LTV-to-date → Visit frequency → New vs returning.
- **D-03:** Compact header with restaurant name left, logout glyph right. Header scrolls away; only chip bar is sticky.

**Date-Range Chips**
- **D-04:** Chips scope to revenue cards only (plus the D-19a exception for new-vs-returning). Cohort, LTV, frequency are chip-independent and operate on full history.
- **D-05:** Default chip `7d`. Sticky at top. Persisted via `?range=7d` query param (not localStorage).

**KPI Strip**
- **D-06:** Top of page: three fixed revenue tiles — `Revenue · Today`, `Revenue · 7d`, `Revenue · 30d`. Ignore the chip; always render those three windows.
- **D-07:** Below fixed tiles: chip-scoped `Tx count` and `Avg ticket` cards.
- **D-08:** Revenue card shape: big number + delta vs prior period. No sparkline. Delta computed server-side from two kpi_daily_v windows. Green positive, red negative, gray when prior is zero.
- **D-09:** Integer EUR with thousands separator (`€ 4,280`). Avg ticket is the only KPI with decimals (`€ 18.40`). Cents→euros division in page server, never in SQL.

**Freshness Signal**
- **D-10:** "Last updated Xh ago" derived from `MAX(ingested_at)` via a new `data_freshness_v` plain wrapper view. Phase 4 ships `0014_data_freshness_v.sql`. `cron.job_run_details` rejected. `MAX(business_date)` rejected.
- **D-10a:** Freshness label as muted caption under sticky chip bar. Default muted, yellow `>30h`, red `>48h`. Thresholds are UI constants.

**Cohort Retention Card**
- **D-11:** LayerChart overlaid line curves. One line per cohort, x=periods since first visit, y=retention %. NULLs render as natural gaps. Last 4 cohorts by default. ≤4 series.
- **D-12:** Grain segmented toggle `[Day | Week | Month]` inside the cohort card header. Default Week. Card-local, not global.
- **D-13:** No horizon marker line. Natural NULL gaps are sufficient.
- **D-14:** Hide cohorts where `cohort_size < 5` from the chart (UI constant `SPARSE_MIN_COHORT_SIZE = 5`). Fallback: if all visible are sparse, show them anyway with a hint.
- **D-15:** Touch tooltips — tap-to-pin, no hover. Tooltip shows cohort_start, period, retention_rate, cohort_size.

**LTV Card**
- **D-16:** Simple bar chart (LayerChart bars). One bar per cohort (last 4), height = ltv_cents/100. Shares grain with cohort card via `?grain=` URL param.
- **D-17:** Persistent italic footer: `Based on {N} months of history — long-term LTV not yet observable.` `N` computed server-side. Always visible, no modal, no icon.

**Frequency & New-vs-Returning**
- **D-18:** Frequency card is plain divs with Tailwind width percentages — NOT a LayerChart chart. 5 rows (1/2/3–5/6–10/11+), bar width proportional to customer_count.
- **D-19:** New-vs-returning card: stacked horizontal bar for current chip window, three segments (new / returning / cash_anonymous). Legend below with revenue tie-out.
- **D-19a:** The D-04 exception: the new-vs-returning card IS chip-scoped. All other analytics cards are not. This nuance is load-bearing.

**Empty & Loading States**
- **D-20:** Per-card empty messages via shared `EmptyState.svelte` keyed by card id; copy in `src/lib/emptyStates.ts`. Cards stay in layout at empty-state size (no layout shift).
- **D-21:** First paint is SSR with all data loaded via `Promise.all([...])` in `+page.server.ts`. No skeletons, no streamed promises in v1.
- **D-22:** Per-card error fallback (neutral "Couldn't load — try refreshing."). Other cards still render. Server-side log only; no toast.

### Claude's Discretion

- **Chart library:** LayerChart 2.x as recommended (can swap within CLAUDE.md's approved stack; `svelte-chartjs` forbidden).
- **UI primitives:** shadcn-svelte@next + Tailwind v4 Vite plugin (not PostCSS). Copy-paste blocks.
- **Auth flow:** Copy `docs/reference/*.example` verbatim to `src/`, drop `.example` suffix. Email+password only. Login at `/login` → redirect to `/`. Logout = form POST action.
- **Deploy:** CF Pages Git integration (push to main → auto-deploy). `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_PUBLISHABLE_KEY` in CF Pages settings. `wrangler pages dev` for local preview.
- **375px verification (UI-11):** PR-time checklist; Chrome DevTools device mode + screenshot. Optional `scripts/verify-viewport.mjs` Playwright screenshot.
- **Palette/typography:** Tailwind zinc/neutral; no brand system in v1.
- **Routes:** Only `/` and `/login`.
- **Env vars:** `$env/static/public` for publishable key + URL. No service role in frontend.
- **Loader parallelism:** `Promise.all` over `.from()` calls is the default; planner can pick RPC if measured.
- **Query params:** `?range=7d&grain=week` — single source of truth, SSR-readable, shareable.

### Deferred Ideas (OUT OF SCOPE)

- Nightly Claude Haiku insight card (Phase 5).
- Skeleton placeholders / streamed promises.
- LTV/frequency grain selectors (weekly-only in v1).
- Horizon marker line on cohort chart.
- Signup / self-serve onboarding.
- Custom password reset route.
- Tenant switcher.
- Alerting / push on stale data.
- Dashboard UI for pg_cron refresh status.
- Desktop-optimized layout (sidebar, multi-column).
- Custom date-range picker.
- Playwright 375px screenshot automation (stretch; likely Phase 5).
- Sparkline charts on KPI tiles.
- LayerChart bundle size audit (defer until first deploy).
- German localization.
- Dark mode (light only in v1).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | SvelteKit 2 + Svelte 5 + adapter-cloudflare deploys to CF Pages with @supabase/ssr | §1 Bootstrap, §2 Auth, §10 Deploy |
| UI-02 | Mobile-first 375px single-column card stream, no desktop sidebar | §5 Mobile layout, §3 Tailwind v4 |
| UI-03 | Login via Supabase Auth email+password, redirect to dashboard on success | §2 Auth, reference files at `docs/reference/login/*.example` |
| UI-04 | Revenue KPI cards (today / 7d / 30d, avg ticket, tx count) at top | §6 Data loader, §8 Card patterns, D-06..D-09 |
| UI-05 | First-visit cohort chart (day/week/month toggle) via LayerChart | §4 LayerChart Spline, D-11..D-12 |
| UI-06 | Retention curve per cohort, mobile-legible, ≤4 series, touch tooltips | §4 LayerChart + Tooltip, D-11/D-15 |
| UI-07 | LTV view with data-depth caveat copy | §4 LayerChart Bars, §9 freshness/caveat derivation, D-16/D-17 |
| UI-08 | Repeat visit rate + visit-frequency distribution | §8 Frequency card (plain divs), D-18 |
| UI-09 | Preset date-range chips (Today/7d/30d/90d/All) only global filter | §7 URL state + runes, D-04/D-05 |
| UI-10 | Empty/sparse states handled gracefully | §8 Empty/loading/error pattern, D-20..D-22 |
| UI-11 | Every PR verified at 375px | §5 Viewport contract, §10 PR checklist |
</phase_requirements>

## Standard Stack

### Core (all locked by CLAUDE.md)

| Library | Version (verify at bootstrap) | Purpose | Why Standard |
|---------|-------------------------------|---------|--------------|
| `@sveltejs/kit` | ^2.x | App framework | SvelteKit 2 is the current major; Svelte 5 is only supported on SvelteKit 2. |
| `svelte` | ^5.x | UI reactivity (runes) | `$state`/`$derived`/`$effect` runes; `$app/stores` deprecated → use `$app/state`. |
| `@sveltejs/adapter-cloudflare` | ^7.x (7.2.8 at CLAUDE.md time) | CF Pages/Workers build target | Official adapter, handles `platform.env` bindings. |
| `@supabase/ssr` | ^0.5.x (repo already pinned `^0.5.2`) | SvelteKit cookie-based auth | Replaces deprecated `@supabase/auth-helpers-sveltekit`. MANDATORY per CLAUDE.md + D-12. |
| `@supabase/supabase-js` | ^2.x (repo pinned `^2.103.0`) | DB client | Already in `package.json`. Works in Workers runtime. |
| `tailwindcss` | ^4.x | Styling | v4 uses Vite plugin (NOT PostCSS). Mobile-first breakpoints default. |
| `@tailwindcss/vite` | ^4.x | Tailwind v4 Vite plugin | Replaces PostCSS pipeline. Add to `vite.config.ts` plugins. |
| `layerchart` | ^2.x | Charts (cohort curves, LTV bars) | Svelte 5 native. `svelte-chartjs` FORBIDDEN per CLAUDE.md. |
| `date-fns` | ^4.x | Date math, `formatDistanceToNowStrict`, `format` | TS-native, tree-shakes to ~2–5 kB. Repo already has `date-fns-tz` 3.2.0. |
| `lucide-svelte` | current | Icon library (logout icon) | shadcn-svelte default. |

### Dev

| Tool | Purpose |
|------|---------|
| `vite` | ^5.x — bundler (built into SvelteKit 2) |
| `svelte-check` | TypeScript type-checking for `.svelte` files |
| `@sveltejs/vite-plugin-svelte` | Svelte compiler Vite plugin (installed by `sv create`) |
| `wrangler` | ^3.x — CF local preview (`wrangler pages dev .svelte-kit/cloudflare`) |

### shadcn-svelte@next (copy-paste, not a runtime dep)

shadcn-svelte `@next` is the Tailwind v4 + Svelte 5 channel. Init via:

```bash
npx shadcn-svelte@next init
# then add per UI-SPEC component inventory:
npx shadcn-svelte@next add button card input label toggle-group tooltip
```

Components land in `src/lib/components/ui/` as editable source (not `node_modules`). Forkers customize freely.

### Version verification (REQUIRED before plan 04-01)

Run and pin actual installed versions into `package.json`:

```bash
npm view @sveltejs/kit version
npm view @sveltejs/adapter-cloudflare version
npm view svelte version
npm view @supabase/ssr version
npm view layerchart version
npm view tailwindcss version
npm view @tailwindcss/vite version
npm view shadcn-svelte@next version
npm view lucide-svelte version
npm view date-fns version
```

CLAUDE.md cites HIGH-confidence versions as of April 2026 but training data can drift. The bootstrap plan MUST verify before install, not after.

### Alternatives Considered (and why NOT)

| Instead of | Could Use | Why NOT (for this phase) |
|------------|-----------|--------------------------|
| LayerChart | svelte-chartjs | FORBIDDEN by CLAUDE.md. Not Svelte 5 compatible. |
| LayerChart | ECharts / svelte-echarts | Larger bundle, overkill for ≤4 series on phone. |
| @supabase/ssr | @supabase/auth-helpers-sveltekit | DEPRECATED. CI guard 2 enforces. |
| shadcn-svelte@next | Skeleton UI / Bits UI direct | shadcn-svelte wins on forkability (copy-paste, not npm lock-in). |
| Tailwind v4 Vite plugin | Tailwind v3 + PostCSS | v4 is current; v3 path is a dead-end. |
| CF Pages Git integration | `wrangler pages deploy` from GHA | Git integration is zero-config and matches CLAUDE.md. |

## Architecture Patterns

### File Layout (first time `src/` exists)

```
ramen-bones-analytics/
├── svelte.config.js          # adapter-cloudflare
├── vite.config.ts            # @tailwindcss/vite + sveltekit plugin
├── tsconfig.json             # extends .svelte-kit/tsconfig.json
├── wrangler.toml             # CF Pages local preview (optional)
├── src/
│   ├── app.html              # <body class="bg-zinc-50"> etc.
│   ├── app.css               # @import "tailwindcss"; + CSS vars from shadcn init
│   ├── app.d.ts              # App.Locals: supabase, safeGetSession
│   ├── hooks.server.ts       # COPIED from docs/reference/hooks.server.ts.example
│   ├── lib/
│   │   ├── supabase.ts       # (optional browser client helper; server uses locals.supabase)
│   │   ├── emptyStates.ts    # D-20 shared copy lookup
│   │   ├── sparseFilter.ts   # SPARSE_MIN_COHORT_SIZE = 5 (D-14)
│   │   ├── format.ts         # formatEUR(cents), formatDelta(pct), formatCaveat(months)
│   │   ├── dateRange.ts      # chipToRange('7d') → { from, to }
│   │   ├── filterState.svelte.ts   # Svelte 5 runes store for range + grain
│   │   └── components/
│   │       ├── ui/           # shadcn-svelte primitives (button, card, input, label, toggle-group, tooltip)
│   │       ├── DashboardHeader.svelte
│   │       ├── DateRangeChips.svelte
│   │       ├── FreshnessLabel.svelte
│   │       ├── KpiTile.svelte
│   │       ├── CohortRetentionCard.svelte
│   │       ├── LtvCard.svelte
│   │       ├── FrequencyCard.svelte
│   │       ├── NewVsReturningCard.svelte
│   │       └── EmptyState.svelte
│   └── routes/
│       ├── +layout.server.ts  # COPIED from docs/reference/+layout.server.ts.example
│       ├── +layout.svelte     # <slot/> shell, globals
│       ├── +page.server.ts    # Promise.all over 7 wrapper views
│       ├── +page.svelte       # card stream
│       └── login/
│           ├── +page.svelte   # COPIED from docs/reference/login/+page.svelte.example
│           └── +page.server.ts # COPIED from docs/reference/login/+page.server.ts.example
├── supabase/migrations/
│   └── 0014_data_freshness_v.sql  # NEW — plain wrapper view over transactions
└── docs/reference/  # unchanged; kept as CI-guard baseline per Phase 1 D-14
```

**Pattern:** Copy `docs/reference/*.example` verbatim, drop `.example`. Do NOT rewrite. CI guard 2 already validates the reference files, so the copy is pre-vetted.

### `svelte.config.js` (canonical)

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // default routes config is fine for a single-route dashboard
      routes: { include: ['/*'], exclude: ['<all>'] }
    }),
    alias: {
      '$lib': './src/lib'
    }
  }
};
```

### `vite.config.ts` (canonical)

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()]
});
```

Note the plugin order: `tailwindcss()` BEFORE `sveltekit()`. Source: Tailwind v4 Vite plugin docs.

### `src/app.css` (Tailwind v4 entry)

```css
@import "tailwindcss";

/* shadcn-svelte @next CSS variables land here after `npx shadcn-svelte@next init` */
```

Tailwind v4 uses `@import "tailwindcss"`, NOT the v3 `@tailwind base/components/utilities` triple.

### `src/app.d.ts` (must declare locals types)

```ts
// src/app.d.ts
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      safeGetSession: () => Promise<{
        session: Session | null;
        user: User | null;
        claims: Record<string, unknown> | null;
      }>;
    }
    interface PageData {
      restaurantId: string;
    }
  }
}
export {};
```

### `+page.server.ts` (loader shape, D-21)

```ts
// src/routes/+page.server.ts
import type { PageServerLoad } from './$types';
import { chipToRange } from '$lib/dateRange';

export const load: PageServerLoad = async ({ locals, url }) => {
  const range = url.searchParams.get('range') ?? '7d';
  const grain = url.searchParams.get('grain') ?? 'week';
  const { from, to } = chipToRange(range);         // compute Berlin-business-date window
  const priorFrom = /* mirror window */;
  const priorTo   = /* mirror window */;

  const s = locals.supabase;

  // Parallel fan-out across wrapper views ONLY (never raw *_mv or transactions)
  const [
    kpiToday, kpi7d, kpi30d,       // three fixed windows (D-06)
    kpiChip, kpiChipPrior,         // chip-scoped current + prior (for delta)
    cohort,
    retention,
    ltv,
    frequency,
    newVsReturning,
    freshness
  ] = await Promise.all([
    s.from('kpi_daily_v').select('*').gte('business_date', todayStart).lte('business_date', todayEnd),
    s.from('kpi_daily_v').select('*').gte('business_date', last7dFrom).lte('business_date', last7dTo),
    s.from('kpi_daily_v').select('*').gte('business_date', last30dFrom).lte('business_date', last30dTo),
    s.from('kpi_daily_v').select('*').gte('business_date', from).lte('business_date', to),
    s.from('kpi_daily_v').select('*').gte('business_date', priorFrom).lte('business_date', priorTo),
    s.from('cohort_v').select('*'),                  // or inlined — Phase 3 picks
    s.from('retention_curve_v').select('*').eq('grain', grain),
    s.from('ltv_v').select('*').eq('grain', grain),
    s.from('frequency_v').select('*'),
    s.from('new_vs_returning_v').select('*').gte('business_date', from).lte('business_date', to),
    s.from('data_freshness_v').select('last_ingested_at').single()
  ]);

  // Per-card error isolation: a single .error does NOT bubble; card renders EmptyState
  return {
    range, grain,
    kpi: {
      today:      shapeKpi(kpiToday),
      sevenD:     shapeKpi(kpi7d),
      thirtyD:    shapeKpi(kpi30d),
      chip:       shapeKpiWithDelta(kpiChip, kpiChipPrior, range),
    },
    cohort: shapeCohort(cohort, retention, grain),
    ltv:    shapeLtv(ltv, grain),
    frequency: frequency.data ?? [],
    newVsReturning: newVsReturning.data ?? [],
    freshness: freshness.data?.last_ingested_at ?? null,
    monthsOfHistory: deriveMonthsOfHistory(cohort)    // for D-17 caveat
  };
};
```

Critical rules:
1. `Promise.all` over the `.from()` calls — every network hop runs in parallel (D-21).
2. Each result is handled per-card; a `.error` on one call returns an empty shape with a sentinel, not a thrown 500.
3. NEVER use `locals.supabase.from('*_mv')` or `.from('transactions')` — CI Guard 1 will fail the build.
4. NEVER use `getSession()` alone in a server file without `getClaims()` or `getUser()` nearby — CI Guard 2 will fail.
5. `safeGetSession()` is already called by `+layout.server.ts` and `restaurantId` is injected into JWT via Phase 1 hook, so the wrapper-view filter happens automatically server-side.

### `+page.svelte` (card stream shell)

```svelte
<script lang="ts">
  import DashboardHeader from '$lib/components/DashboardHeader.svelte';
  import DateRangeChips from '$lib/components/DateRangeChips.svelte';
  import FreshnessLabel from '$lib/components/FreshnessLabel.svelte';
  import KpiTile from '$lib/components/KpiTile.svelte';
  import CohortRetentionCard from '$lib/components/CohortRetentionCard.svelte';
  import LtvCard from '$lib/components/LtvCard.svelte';
  import FrequencyCard from '$lib/components/FrequencyCard.svelte';
  import NewVsReturningCard from '$lib/components/NewVsReturningCard.svelte';

  let { data } = $props();
</script>

<DashboardHeader />
<div class="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur px-4 py-2">
  <DateRangeChips range={data.range} />
  <FreshnessLabel lastIngestedAt={data.freshness} />
</div>
<main class="mx-auto max-w-screen-sm px-4 pb-12">
  <div class="flex flex-col gap-6">
    <KpiTile title="Revenue · Today" kpi={data.kpi.today} deltaWindow="day" />
    <KpiTile title="Revenue · 7d"    kpi={data.kpi.sevenD}  deltaWindow="7d" />
    <KpiTile title="Revenue · 30d"   kpi={data.kpi.thirtyD} deltaWindow="30d" />
    <KpiTile title="Transactions"    kpi={data.kpi.chip}    deltaWindow={data.range} metric="tx_count" />
    <KpiTile title="Avg ticket"      kpi={data.kpi.chip}    deltaWindow={data.range} metric="avg_ticket" />
    <CohortRetentionCard data={data.cohort} grain={data.grain} />
    <LtvCard data={data.ltv} monthsOfHistory={data.monthsOfHistory} />
    <FrequencyCard data={data.frequency} />
    <NewVsReturningCard data={data.newVsReturning} />
  </div>
</main>
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie-based auth session for SSR | Custom cookie jar + JWT refresh | `@supabase/ssr` `createServerClient` | Token refresh + double-submit cookie + `sb-*` naming is a known footgun; auth-helpers sunset for this reason. |
| "Last updated X ago" label | Custom `Math.floor((now - ts) / 3600)` | `date-fns/formatDistanceToNowStrict({ roundingMethod: 'floor' })` | Handles pluralization, unit bumps at 48h+, edge cases. |
| Line chart + overlay + tooltip | Hand-rolled SVG path math | LayerChart `<Chart><Svg><Axis/><Spline/><Tooltip/></Svg></Chart>` | Touch handling, coordinate systems, responsive sizing all handled. |
| Bar chart | Hand-rolled rects | LayerChart `<Bars/>` (LTV) / plain Tailwind divs (frequency, D-18) | LayerChart for "real" charts; divs only because frequency has exactly 5 rows. |
| Stacked horizontal bar (new vs returning) | Custom flex math | Plain `<div class="flex h-3">` with percentage widths | Three segments, one row — not a chart, don't pull in chart lib for it. Explicit decision in D-18/D-19. |
| Segmented toggle (grain) | Custom radio hack | shadcn-svelte `toggle-group` block | Handles keyboard, aria-radiogroup, focus ring. |
| Date math / Berlin timezone | Custom offset math | `date-fns-tz` (already in `package.json`) + server-side derivation | Already proven in Phase 2. |
| EUR formatting | Custom thousands separator | `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })` + strip `.00` when needed | Native, zero-dep, locale-aware. |
| Query param state sync | localStorage + effect | SvelteKit `url.searchParams` + `goto('?range=7d', { keepFocus: true, noScroll: true })` | SSR-friendly, shareable, no client-only state. |

**Key insight:** Three things in this phase look like they "need to be custom" but aren't — the freshness label (date-fns handles it), the frequency bars (plain divs win at 5 rows per D-18), and the grain toggle (shadcn block). Everything else leans on the library.

## Common Pitfalls

### Pitfall 1: Calling `getSession()` alone on the server

**What goes wrong:** CI Guard 2 fails the build on any server file that calls `getSession(` without a matching `getClaims(` or `getUser(` in the same file. `getSession()` reads the cookie but does NOT re-validate the JWT against Supabase — it trusts whatever the browser sent.

**Why it happens:** Every Supabase tutorial older than mid-2024 shows `getSession()` first.

**How to avoid:** Use `locals.safeGetSession()` (already wired in `docs/reference/hooks.server.ts.example`), which calls `getClaims()` after `getSession()`. The reference file is the canonical pattern; copy it verbatim.

**Warning signs:** Any `+page.server.ts` or `+layout.server.ts` that imports `supabase.auth` directly instead of going through `locals`.

### Pitfall 2: Querying raw `*_mv` or `transactions` from `src/`

**What goes wrong:** CI Guard 1 fails the build — src/ must only reference `*_v` wrapper views.

**Why it happens:** Auto-complete suggests table names from types; `cohort_mv` looks tempting.

**How to avoid:** Only use `kpi_daily_v`, `cohort_v` (or `retention_curve_v` — whichever Phase 3 settled on), `retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`, and the new `data_freshness_v`. Check `supabase/migrations/0012_leaf_views.sql` for the exact view names.

**Warning signs:** `grep -E '_mv\b|from\s+.transactions' src/` returns any result.

### Pitfall 3: Tailwind v4 PostCSS leftovers

**What goes wrong:** `postcss.config.*` in repo root makes Tailwind v4 fall over — v4 uses the Vite plugin, not PostCSS.

**Why it happens:** Old project templates ship `postcss.config.js`. This repo has no v3 leftovers, but the Vitest config currently stubs postcss (`css.postcss: {}`) — that's a test-only config and is fine.

**How to avoid:** Do NOT add a `postcss.config.*` file. Add `@tailwindcss/vite` to `vite.config.ts` plugins and `@import "tailwindcss"` to `src/app.css`. Nothing else.

**Warning signs:** Build error mentioning `postcss` or Tailwind classes not applying in dev.

### Pitfall 4: Workers runtime ≠ Node

**What goes wrong:** Any use of `fs`, `path`, `crypto` (Node API), `Buffer`, or Node-only npm packages breaks the Cloudflare build at runtime, not build time.

**Why it happens:** Svelte 5 runes work everywhere; copy-paste from Node tutorials.

**How to avoid:** Use Web Platform APIs only — `fetch`, `crypto.subtle`, `Uint8Array`, `URL`, `URLSearchParams`. `@supabase/supabase-js` is already fetch-based and safe. `date-fns` is pure JS and safe. LayerChart runs in the browser so doesn't matter.

**Warning signs:** `wrangler pages dev .svelte-kit/cloudflare` throws "module not found" or "X is not a function" at runtime.

### Pitfall 5: REFRESH MATERIALIZED VIEW CONCURRENTLY omitted in the new migration

**What goes wrong:** Phase 4 adds `0014_data_freshness_v.sql`. If it's a plain view (not an MV), CI Guard 3 is inert — but if a future drive-by refactor converts it to an MV without `CONCURRENTLY` + unique index, Guard 3/3b fails.

**Why it happens:** Well-meaning perf optimization.

**How to avoid:** Keep `data_freshness_v` as `CREATE VIEW`, not `CREATE MATERIALIZED VIEW`. `MAX(ingested_at)` against `transactions` is a trivial aggregate — plain view is correct.

### Pitfall 6: Chip-scope bleed on analytics cards (D-04 vs D-19a)

**What goes wrong:** Developer passes `range` to `CohortRetentionCard` "for consistency", retention now re-computes on chip change, breaks the analytical contract from Phase 3.

**Why it happens:** Prop drilling looks clean.

**How to avoid:** ONLY these three cards receive `range`: `Transactions` KPI tile, `Avg ticket` KPI tile, `NewVsReturningCard`. All others are chip-independent. Enforce via component prop types — `CohortRetentionCard` does not accept a `range` prop at all.

**Warning signs:** Grain toggle and range chip both change the cohort chart.

### Pitfall 7: Sparse-cohort filter in SQL

**What goes wrong:** Developer "helps" by filtering `cohort_size < 5` in `retention_curve_v`.

**Why it happens:** Looks cleaner than UI filtering.

**How to avoid:** Phase 3 D-05 explicitly keeps SQL honest — `cohort_size` is exposed on every row, UI drops sparse cohorts via the `SPARSE_MIN_COHORT_SIZE = 5` constant in `src/lib/sparseFilter.ts`. Don't touch the view.

### Pitfall 8: LTV caveat shown as a tooltip/modal

**What goes wrong:** Friend never taps the info icon, reads the raw LTV number as gospel, makes a bad decision.

**Why it happens:** Info icons feel more "polished".

**How to avoid:** D-17 is explicit — persistent italic footer, always visible, no icon, no modal.

### Pitfall 9: Loading `PUBLIC_SUPABASE_*` from `$env/dynamic/public`

**What goes wrong:** Dynamic env vars are evaluated at request time and force dynamic rendering; slower TTFB, possible CF Workers build issues.

**How to avoid:** Use `$env/static/public` (already used in `hooks.server.ts.example`). `PUBLIC_*` static vars are baked at build time.

### Pitfall 10: Building shadcn-svelte@next before installing Tailwind v4

**What goes wrong:** `shadcn-svelte@next init` writes `components.json` and CSS variables assuming Tailwind v4 is installed. If ordering is wrong, init fails or produces broken CSS vars.

**How to avoid:** Install and configure Tailwind v4 FIRST (`npm install tailwindcss @tailwindcss/vite` + update `vite.config.ts` + `src/app.css`), THEN run `npx shadcn-svelte@next init`.

## Runtime State Inventory

> Not applicable — Phase 4 is a greenfield SvelteKit bootstrap + a new plain view. No renames, no data migrations, no OS-level registrations.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — new feature, no renames | None |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | Two NEW vars (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`) — add to CF Pages project settings + `.env.example` | Add to CF Pages dashboard before first deploy |
| Build artifacts | None (no prior `src/`) | Fresh build on first push |

## Code Examples

### LayerChart 2.x — Retention Curve (D-11, D-15)

```svelte
<!-- src/lib/components/CohortRetentionCard.svelte -->
<script lang="ts">
  import { Chart, Svg, Axis, Spline, Tooltip, Highlight } from 'layerchart';
  import { scaleLinear, scaleOrdinal } from 'd3-scale';
  import { SPARSE_MIN_COHORT_SIZE } from '$lib/sparseFilter';

  type Row = { cohort_start: string; period: number; retention_rate: number; cohort_size: number };
  let { data, grain }: { data: Row[]; grain: 'day'|'week'|'month' } = $props();

  // Group rows by cohort; drop sparse; take last 4
  const series = $derived.by(() => {
    const byCohort = new Map<string, Row[]>();
    for (const r of data) {
      if (!byCohort.has(r.cohort_start)) byCohort.set(r.cohort_start, []);
      byCohort.get(r.cohort_start)!.push(r);
    }
    const all = Array.from(byCohort.entries())
      .map(([cohort, rows]) => ({ cohort, rows, size: rows[0]?.cohort_size ?? 0 }));
    const fresh = all.filter(s => s.size >= SPARSE_MIN_COHORT_SIZE);
    const chosen = (fresh.length > 0 ? fresh : all).slice(-4);
    return chosen;
  });

  const palette = ['#2563eb', '#0891b2', '#7c3aed', '#db2777'];
</script>

<div class="rounded-xl border border-zinc-200 bg-white p-4">
  <div class="flex items-center justify-between">
    <h2 class="text-xl font-semibold text-zinc-900">Cohort retention</h2>
    <!-- toggle-group grain selector here -->
  </div>
  {#if series.length === 0}
    <EmptyState card="cohort" />
  {:else}
    <div class="h-64 mt-4">
      <Chart
        data={series.flatMap((s, i) => s.rows.map(r => ({ ...r, cohort: s.cohort, color: palette[i] })))}
        x="period"
        y="retention_rate"
        yDomain={[0, 1]}
        yNice
        padding={{ left: 28, bottom: 20, top: 8, right: 8 }}
      >
        <Svg>
          <Axis placement="left" format={(v) => `${Math.round(v * 100)}%`} grid />
          <Axis placement="bottom" />
          {#each series as s, i}
            <Spline data={s.rows} x="period" y="retention_rate" class="stroke-2" stroke={palette[i]} />
          {/each}
          <Highlight points lines />
          <Tooltip.Root let:data>
            <Tooltip.Header>{data.cohort_start} · Week {data.period}</Tooltip.Header>
            <Tooltip.List>
              <Tooltip.Item label="Retention" value={`${Math.round(data.retention_rate * 100)}%`} />
              <Tooltip.Item label="Cohort size" value={`${data.cohort_size} customers`} />
            </Tooltip.List>
          </Tooltip.Root>
        </Svg>
      </Chart>
    </div>
  {/if}
</div>
```

> **Note:** LayerChart 2.x exact API (`<Spline>` vs `<Line>`, `<Highlight>` vs `<Points>`, `<Tooltip.Root>` slot props) should be verified against https://layerchart.com/docs/components at plan time. The shape above reflects LayerChart's "composable SVG primitives over Layer Cake" mental model but exact prop names may drift. MEDIUM confidence on exact component names, HIGH confidence on the pattern.

### LayerChart 2.x — LTV Bars (D-16)

```svelte
<!-- src/lib/components/LtvCard.svelte -->
<script lang="ts">
  import { Chart, Svg, Axis, Bars } from 'layerchart';
  type Row = { cohort_start: string; ltv_cents: number };
  let { data, monthsOfHistory }: { data: Row[]; monthsOfHistory: number } = $props();
  const shaped = $derived(data.slice(-4).map(r => ({ ...r, ltv_eur: r.ltv_cents / 100 })));
  const caveat = $derived(
    monthsOfHistory < 1
      ? 'Based on less than a month of history — long-term LTV not yet observable.'
      : `Based on ${monthsOfHistory} months of history — long-term LTV not yet observable.`
  );
</script>

<div class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-xl font-semibold text-zinc-900">LTV-to-date</h2>
  {#if shaped.length === 0}
    <EmptyState card="ltv" />
  {:else}
    <div class="h-48 mt-4">
      <Chart data={shaped} x="cohort_start" y="ltv_eur" xScale="band" padding={{ left: 36, bottom: 24 }}>
        <Svg>
          <Axis placement="left" format={(v) => `€${v}`} grid />
          <Axis placement="bottom" />
          <Bars class="fill-blue-600 fill-opacity-85 rounded-t" />
        </Svg>
      </Chart>
    </div>
  {/if}
  <p class="mt-2 text-xs italic text-zinc-500">{caveat}</p>
</div>
```

### Frequency card (D-18, plain divs)

```svelte
<!-- src/lib/components/FrequencyCard.svelte -->
<script lang="ts">
  type Row = { bucket: string; customer_count: number };
  let { data }: { data: Row[] } = $props();
  const max = $derived(Math.max(1, ...data.map(r => r.customer_count)));
</script>

<div class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-xl font-semibold text-zinc-900">Visit frequency</h2>
  {#if data.length === 0}
    <EmptyState card="frequency" />
  {:else}
    <ul class="mt-4 flex flex-col gap-2">
      {#each data as r}
        <li class="flex items-center gap-2 text-sm">
          <span class="w-20 text-zinc-500">{r.bucket}</span>
          <div class="flex-1 h-3 rounded bg-zinc-100 overflow-hidden">
            <div class="h-full bg-zinc-500" style="width: {(r.customer_count / max) * 100}%"></div>
          </div>
          <span class="w-12 text-right tabular-nums text-zinc-900">{r.customer_count}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

### New vs Returning stacked bar (D-19)

```svelte
<!-- src/lib/components/NewVsReturningCard.svelte -->
<script lang="ts">
  type Row = { segment: 'new'|'returning'|'cash_anonymous'; revenue_cents: number };
  let { data }: { data: Row[] } = $props();
  const totals = $derived.by(() => {
    const ret = data.find(r => r.segment === 'returning')?.revenue_cents ?? 0;
    const neu = data.find(r => r.segment === 'new')?.revenue_cents ?? 0;
    const cash = data.find(r => r.segment === 'cash_anonymous')?.revenue_cents ?? 0;
    const total = ret + neu + cash;
    return { ret, neu, cash, total };
  });
  const eur = (cents: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(cents / 100);
</script>

<div class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-xl font-semibold text-zinc-900">New vs returning</h2>
  {#if totals.total === 0}
    <EmptyState card="newVsReturning" />
  {:else}
    <div class="flex h-3 w-full overflow-hidden rounded mt-4">
      <div class="bg-blue-600"    style="width: {(totals.ret  / totals.total) * 100}%"></div>
      <div class="bg-indigo-300"  style="width: {(totals.neu  / totals.total) * 100}%"></div>
      <div class="bg-zinc-200"    style="width: {(totals.cash / totals.total) * 100}%"></div>
    </div>
    <ul class="mt-3 text-sm space-y-1">
      <li class="flex items-center gap-2"><span class="size-3 bg-blue-600 rounded-sm"></span>Returning <span class="ml-auto tabular-nums">{eur(totals.ret)}</span></li>
      <li class="flex items-center gap-2"><span class="size-3 bg-indigo-300 rounded-sm"></span>New <span class="ml-auto tabular-nums">{eur(totals.neu)}</span></li>
      <li class="flex items-center gap-2"><span class="size-3 bg-zinc-200 rounded-sm"></span>Cash <span class="ml-auto tabular-nums">{eur(totals.cash)}</span></li>
    </ul>
  {/if}
</div>
```

### FreshnessLabel with date-fns (D-10, D-10a)

```svelte
<!-- src/lib/components/FreshnessLabel.svelte -->
<script lang="ts">
  import { formatDistanceToNowStrict, differenceInHours } from 'date-fns';
  let { lastIngestedAt }: { lastIngestedAt: string | null } = $props();

  const label = $derived.by(() => {
    if (!lastIngestedAt) return { text: 'No data yet', color: 'text-zinc-500' };
    const ts = new Date(lastIngestedAt);
    const hours = differenceInHours(new Date(), ts);
    const text = `Last updated ${formatDistanceToNowStrict(ts, { roundingMethod: 'floor' })} ago${hours > 48 ? ' — data may be outdated' : ''}`;
    const color = hours > 48 ? 'text-red-600' : hours > 30 ? 'text-yellow-600' : 'text-zinc-500';
    return { text, color };
  });
</script>

<p class="text-xs {label.color}">{label.text}</p>
```

### Filter state with Svelte 5 runes (URL-synced)

```svelte
<!-- src/lib/components/DateRangeChips.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { range }: { range: string } = $props();
  const chips = [
    { id: 'today', label: 'Today' },
    { id: '7d',    label: '7d' },
    { id: '30d',   label: '30d' },
    { id: '90d',   label: '90d' },
    { id: 'all',   label: 'All' },
  ] as const;

  function select(id: string) {
    const url = new URL(page.url);
    url.searchParams.set('range', id);
    goto(url, { replaceState: false, keepFocus: true, noScroll: true });
  }
</script>

<div role="group" aria-label="Date range" class="flex gap-2 overflow-x-auto">
  {#each chips as chip}
    <button
      type="button"
      class="min-h-11 min-w-11 px-3 rounded-full text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 {range === chip.id ? 'bg-blue-600 text-white' : 'bg-white border border-zinc-200 text-zinc-900'}"
      aria-current={range === chip.id}
      onclick={() => select(chip.id)}
    >
      {chip.label}
    </button>
  {/each}
</div>
```

**Notes on runes:**
- Use `$props()`, `$state()`, `$derived()`, `$derived.by()`, `$effect()` — not Svelte 4 `export let` / stores.
- `$app/state` (NOT `$app/stores`) for `page` — the stores API is deprecated in Svelte 5 per CLAUDE.md note.
- Filter state lives in the URL, NOT in a module-level rune. SSR reads it in `+page.server.ts`; the chip component writes via `goto(url)`. Single source of truth.

### `data_freshness_v` migration (Phase 4 NEW)

```sql
-- supabase/migrations/0014_data_freshness_v.sql
-- D-10: expose MAX(ingested_at) per tenant for the "Last updated X ago" label.
-- Plain view (not a materialized view) — trivial aggregate, sub-ms query.
-- Follows Phase 1 D-06/07/08 wrapper pattern: JWT-filter + REVOKE raw + GRANT on view.

CREATE OR REPLACE VIEW public.data_freshness_v AS
SELECT
  t.restaurant_id,
  MAX(t.ingested_at) AS last_ingested_at
FROM public.transactions t
WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id')
GROUP BY t.restaurant_id;

GRANT SELECT ON public.data_freshness_v TO authenticated;
-- raw transactions remains REVOKE'd from authenticated per Phase 1
```

Verify with tenant-isolation test (Phase 1/3 pattern): seed two tenants, confirm session A only sees row for tenant A.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@supabase/auth-helpers-sveltekit` | `@supabase/ssr` | 2024 | MANDATORY. CI Guard 2 enforces. |
| `getSession()` trusted on server | `safeGetSession()` → `getClaims()`/`getUser()` | 2024 | D-12 + CI Guard 2. |
| Tailwind v3 + PostCSS | Tailwind v4 + `@tailwindcss/vite` | 2024-late | Vite plugin path only. No PostCSS config. |
| Svelte 4 stores (`$app/stores`) | Svelte 5 runes + `$app/state` | 2024-late | `writable()` / `readable()` patterns discouraged outside legacy. |
| svelte-chartjs | LayerChart 2.x | 2024-late | svelte-chartjs unmaintained, no Svelte 5. FORBIDDEN by CLAUDE.md. |
| shadcn-svelte (stable, Tailwind v3) | shadcn-svelte@next (Tailwind v4 + Svelte 5) | 2024-late | `@next` channel required for this stack. |
| Moment.js | date-fns 4 | long ago | Size + deprecation. |

**Deprecated / outdated:**
- `@tailwind base;` three-line directive (v3) → `@import "tailwindcss";` (v4)
- `postcss.config.cjs` with tailwind plugin → `vite.config.ts` with `@tailwindcss/vite`
- `export let foo` → `let { foo } = $props()`

## Open Questions

1. **Exact LayerChart 2.x component/prop names**
   - What we know: Svelte 5 native, composable SVG primitives over Layer Cake. Component names like `<Chart>`, `<Svg>`, `<Axis>`, `<Spline>`, `<Bars>`, `<Tooltip>` are idiomatic to Layer Cake lineage.
   - What's unclear: Exact 2.x API (`<Spline>` vs `<Line>`, `<Tooltip.Root>` slot shape, `<Highlight>` exists in 2.x).
   - Recommendation: At the start of plan 04-03 (cohort card), spike LayerChart from https://layerchart.com/docs/components and pin actual component names. Budget 30 min. Adjust examples in this doc if they drift.

2. **Which Phase 3 view is the cohort wrapper?**
   - What we know: Phase 3 ships `cohort_mv` (raw), `retention_curve_v`, `ltv_v`, `frequency_v`, `new_vs_returning_v`. 04-CONTEXT mentions "`cohort_v` (name TBD by Phase 3 planner — may be inlined)".
   - What's unclear: Is there a standalone `cohort_v` or is cohort-level data only reachable via `retention_curve_v`?
   - Recommendation: Before plan 04-03, read `supabase/migrations/0012_leaf_views.sql` to confirm the exact view name. The loader query must match reality.

3. **`months_of_history` derivation for the LTV caveat (D-17)**
   - What we know: CONTEXT says "computed in `+page.server.ts` from `DATE_PART('month', now() - MIN(first_visit_business_date))` on the cohort wrapper view".
   - What's unclear: Whether Phase 3 exposes `first_visit_business_date` / `cohort_start` on a wrapper view the frontend can hit, or whether Phase 4 needs an additional derived column.
   - Recommendation: Check `retention_curve_v` / `ltv_v` columns first. If neither exposes the earliest cohort start, compute client-side from `Math.min(...cohort_starts)` in the loader. Do NOT add a new MV for this.

4. **CF Pages Git integration vs GHA `wrangler pages deploy`**
   - What we know: CONTEXT (Claude's Discretion) says "CF Pages Git integration (push to main → auto-deploy)". No custom Wrangler workflow in Phase 4.
   - What's unclear: Whether CF Pages project is already created or needs first-time setup.
   - Recommendation: Plan 04-01 includes a one-time human step: create the CF Pages project via dashboard, connect to the GitHub repo, set `PUBLIC_SUPABASE_URL` + `PUBLIC_SUPABASE_PUBLISHABLE_KEY` in project settings, set build command (`npm run build`) and output directory (`.svelte-kit/cloudflare`). Document in README.

5. **375px automated verification (UI-11 stretch)**
   - What we know: CONTEXT says "optional stretch `scripts/verify-viewport.mjs` Playwright screenshot".
   - What's unclear: Whether Phase 4 should ship this or defer to Phase 5.
   - Recommendation: DEFER. Ship PR-checklist-driven manual verification in v1; the Playwright screenshot plan is a Phase 5 polish item.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | SvelteKit build, npm | ✓ (already used by repo) | 20+ | — |
| npm | Dep install | ✓ | — | — |
| Supabase CLI | Migration for `0014_data_freshness_v.sql` | ✓ (used by Phases 1–3) | — | — |
| Supabase DEV project | Runtime data + migration target | ✓ (Phases 1–3 running against it) | — | — |
| Cloudflare Pages account | Deploy target | ⚠ assume yes (first use) | — | `wrangler pages dev` for local verification only |
| GitHub repo connected to CF Pages | Git integration deploy | ⚠ first use | — | Manual `wrangler pages deploy` from GHA |
| `wrangler` CLI | Local CF preview | ✗ (not in `package.json`) | — | Install as devDep in plan 04-01 |
| Chrome DevTools | 375px manual verification | ✓ (reviewer's browser) | — | — |
| Playwright | Optional 375px automation | ✗ (not installed; deferred) | — | Manual screenshot in PR |

**Missing with no fallback:** None — every runtime dep is either present or trivially installable via the bootstrap plan.

**Missing with fallback:**
- `wrangler` — install in plan 04-01 as a devDependency.
- Playwright for viewport automation — defer, manual screenshot is sufficient.

**Human-in-loop step:** CF Pages project creation + env var setup must happen once in the Cloudflare dashboard. Can't be automated from the plan itself.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 1.6.1 (already installed) + `@testing-library/svelte` (TO ADD) + `vitest-environment-jsdom` (TO ADD) |
| Config file | `vitest.config.ts` (exists; has `css.postcss: {}` stub) |
| Quick run command | `npm test -- tests/ui/<specific>` |
| Full suite command | `npm test && npm run test:guards` |
| Phase gate | Full suite green + `npm run build` (SvelteKit) + `npm run check` (svelte-check) + manual 375px screenshot on CF Pages preview |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| UI-01 | SvelteKit build emits `.svelte-kit/cloudflare` artifact; `@supabase/ssr` wired | build | `npm run build` (exit 0) | ❌ Wave 0 (no `src/` yet) |
| UI-01 | CI guards still pass with new `src/` tree | guard | `bash scripts/ci-guards.sh` | ✅ exists |
| UI-02 | Dashboard shell renders without horizontal scroll at 375px | manual | Chrome DevTools device mode on CF preview | manual-only |
| UI-03 | Login page renders; invalid creds returns error message | integration (Vitest + jsdom) | `npm test -- tests/ui/login.test.ts` | ❌ Wave 0 |
| UI-03 | `+layout.server.ts` redirects to `/login` when no session | unit (mock `locals`) | `npm test -- tests/ui/layout.test.ts` | ❌ Wave 0 |
| UI-04 | `+page.server.ts` shapes KPI data from `kpi_daily_v` rows (fixture) | unit | `npm test -- tests/ui/page-server.test.ts` | ❌ Wave 0 |
| UI-04 | KpiTile renders big number + delta caption with correct color | component | `npm test -- tests/ui/kpi-tile.test.ts` | ❌ Wave 0 |
| UI-05 | Cohort card renders 4 lines for 4 cohorts (snapshot) | component | `npm test -- tests/ui/cohort.test.ts` | ❌ Wave 0 |
| UI-05 | Grain toggle updates URL `?grain=` | component | `npm test -- tests/ui/cohort.test.ts` | ❌ Wave 0 |
| UI-06 | Retention values 0–1 mapped to 0–100% on axis | unit (pure function) | `npm test -- tests/ui/format.test.ts` | ❌ Wave 0 |
| UI-06 | Sparse cohorts (`cohort_size < 5`) excluded; fallback when all sparse | unit | `npm test -- tests/ui/sparse-filter.test.ts` | ❌ Wave 0 |
| UI-07 | LTV caveat string shape: `"Based on {N} months of history..."` w/ N<1 branch | unit | `npm test -- tests/ui/format.test.ts` | ❌ Wave 0 |
| UI-08 | Frequency card widths proportional to customer_count | component | `npm test -- tests/ui/frequency.test.ts` | ❌ Wave 0 |
| UI-09 | Chip click updates `?range=` URL; default `7d` respected | component | `npm test -- tests/ui/chips.test.ts` | ❌ Wave 0 |
| UI-09 | Chip-scope rules: chips affect only KPI chip tiles + new-vs-returning | integration | `npm test -- tests/ui/page-server.test.ts` (assert only chip cards change on range switch) | ❌ Wave 0 |
| UI-10 | Each card renders `EmptyState` when data is `[]` | component | `npm test -- tests/ui/empty-states.test.ts` | ❌ Wave 0 |
| UI-10 | Loader per-card error does not block other cards | unit | `npm test -- tests/ui/page-server.test.ts` | ❌ Wave 0 |
| UI-11 | Every PR includes 375px screenshot in PR body | manual + reviewer gate | PR template checklist | manual-only |
| (new) | `data_freshness_v` tenant isolation | integration (admin client, Phase 1 pattern) | `npm test -- tests/phase4-freshness.test.ts` | ❌ Wave 0 |
| (new) | CI Guard 1 still passes with src/ populated | guard | `bash scripts/ci-guards.sh` | ✅ exists |
| (new) | CI Guard 2 still passes with src/hooks.server.ts + +layout.server.ts | guard | `bash scripts/ci-guards.sh` | ✅ exists |

### Sampling Rate
- **Per task commit:** `npm test -- tests/ui/<changed>` + `bash scripts/ci-guards.sh` (< 15s typical)
- **Per wave merge:** `npm test && npm run test:guards && npm run check && npm run build`
- **Phase gate:** Full suite green → manual 375px screenshot on CF Pages preview deploy attached to PR → `/gsd:verify-work`

### Wave 0 Gaps

- [ ] Install: `@testing-library/svelte`, `@testing-library/jest-dom`, `jsdom`, `svelte-check`, `@sveltejs/kit`, `svelte`, `@sveltejs/adapter-cloudflare`, `@tailwindcss/vite`, `tailwindcss`, `layerchart`, `date-fns`, `lucide-svelte`, `wrangler` (devDep). Verify versions per §"Version verification".
- [ ] `vitest.config.ts` — extend with `environment: 'jsdom'` for component tests (may need a second vitest project so integration tests stay node).
- [ ] `tests/ui/` directory — does not exist.
- [ ] `tests/ui/fixtures/` — fake Supabase response fixtures for loader tests (kpi_daily_v rows, cohort rows with 4 cohorts + 1 sparse, frequency 5 buckets, new_vs_returning 3 segments, data_freshness_v row).
- [ ] `tests/ui/_mocks/supabase.ts` — mock `locals.supabase.from().select().gte()...` chain for loader unit tests.
- [ ] Component tests for: KpiTile, CohortRetentionCard, LtvCard, FrequencyCard, NewVsReturningCard, DateRangeChips, FreshnessLabel, EmptyState.
- [ ] `tests/phase4-freshness.test.ts` — tenant-isolation test for `data_freshness_v` (mirror Phase 1/3 tenant-isolation pattern).
- [ ] PR template checklist: "☐ 375px screenshot attached".

**Note:** Wave 0 should author these as RED stubs (it.todo) before any production code lands — same pattern Phase 3 used successfully in plan 03-01.

## Sources

### Primary (HIGH confidence)

- `CLAUDE.md` §Recommended Stack, §What NOT to Use, §Critical Gotchas 1/3/4 — stack lock, forbidden packages, MV+RLS wrapper pattern, Workers runtime constraints
- `.planning/phases/04-mobile-reader-ui/04-CONTEXT.md` — 22 locked decisions (D-01..D-22)
- `.planning/phases/04-mobile-reader-ui/04-UI-SPEC.md` — typography/color/spacing/interaction contract
- `docs/reference/hooks.server.ts.example` — canonical `safeGetSession` pattern (already CI-guard-validated)
- `docs/reference/+layout.server.ts.example` — canonical redirect-to-login + restaurantId extraction
- `docs/reference/login/*.example` — canonical email+password flow
- `scripts/ci-guards.sh` — authoritative list of forbidden patterns (Guard 1: raw `*_mv` / `transactions`; Guard 2: `getSession` without `getClaims`/`getUser`; Guard 3/3b: MV refresh/index rules)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-04/06/07/08/12/14 — wrapper-view + REVOKE pattern, JWT claim injection, `getSession` ban
- `.planning/phases/03-analytics-sql/03-CONTEXT.md` — D-04/05/08/11/12/14/24 — weekly-default grain, sparse filter in UI not SQL, NULL masking → natural chart gaps, 4-bucket new_vs_returning with tie-out, Guard 1 extension
- `.planning/REQUIREMENTS.md` §UI-01..UI-11
- `.planning/ROADMAP.md` §Phase 4 success criteria

### Secondary (MEDIUM — to verify fresh at plan time)

- https://svelte.dev/docs/kit/adapter-cloudflare — adapter docs
- https://supabase.com/docs/guides/auth/server-side/sveltekit — SSR auth guide
- https://www.shadcn-svelte.com/docs/migration/tailwind-v4 — init flow for @next
- https://tailwindcss.com/docs/installation/using-vite — Vite plugin install
- https://layerchart.com/docs — LayerChart 2.x components (confirm exact prop/slot names at plan time)
- https://svelte.dev/docs/svelte/$state — Svelte 5 runes reference

### Tertiary (LOW — reference only)

- https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-site/ — CF Pages + SvelteKit guide (general pattern; Git integration flow is the same regardless of version)

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — locked by CLAUDE.md, already in-repo partially (`@supabase/ssr`, `@supabase/supabase-js`, `date-fns-tz`)
- Architecture: **HIGH** — file layout dictated by SvelteKit conventions + copy-paste reference files
- Auth flow: **HIGH** — reference files exist and are CI-guard-validated
- LayerChart API specifics: **MEDIUM** — 2.x API exact prop names need spike at plan 04-03 time
- Phase 3 wrapper view names: **MEDIUM** — `cohort_v` vs inlined unclear; verify from `0012_leaf_views.sql` at plan time
- shadcn-svelte@next component API: **MEDIUM** — `@next` channel can change between research and plan
- Pitfalls: **HIGH** — all come from Phase 1/3 prior art or explicit CLAUDE.md rules
- Validation architecture: **HIGH** — mirrors Phase 3 Wave 0 RED-stub pattern that worked

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — stack is stable; re-verify LayerChart + shadcn-svelte@next before plan 04-03 if older)
