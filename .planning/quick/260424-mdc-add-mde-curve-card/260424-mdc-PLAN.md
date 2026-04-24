---
task: 260424-mdc
title: MDE (Minimum Detectable Effect) line chart card on dashboard
branch: quick-260424-mde
status: in-progress
created: 2026-04-24
---

# mdc — MDE line chart card

Add a `MdeCurveCard.svelte` to the dashboard that plots the minimum detectable lift (€/day average) a marketing campaign must produce to be statistically significant, for exposed-sample sizes n₂ ∈ {1…14} days. σ and n₁ are derived live from `getFiltered()` daily revenue, so the curve re-draws whenever filters change or SSR invalidates nightly.

## Formula

```
n_eff(n₁, n₂) = 2·n₁·n₂ / (n₁ + n₂)             ← harmonic mean
MDE(n₂)       = σ · √( C · (n₁ + n₂) / (2·n₁·n₂) )
C             = 2·(z_{α/2} + z_β)² = 2·(1.96 + 0.84)²  ≈ 15.68
```

Sanity: σ=222, n₁=20, n₂=4 → MDE ≈ €340 (matches user's Step-3 teaching PDF).

## Must-haves

- `src/lib/mde.ts` exports pure math helpers; no Svelte imports
- `src/lib/mde.test.ts` verifies MDE(222, 20, 4) ≈ 340 and the curve is strictly decreasing
- `MdeCurveCard.svelte` re-renders reactively from `getFiltered()` via `$derived.by`
- Below `MDE_MIN_BASELINE_DAYS = 7` or σ = 0 → `<EmptyState card="mde-curve" />`
- One dashed vertical reference line at n₂=7 ("1 week")
- Mounted between `CalendarRevenueCard` and `RepeaterCohortCountCard` in `src/routes/+page.svelte`
- 5 new i18n keys added to every locale block (en/de/ja/es/fr)
- Svelte 5 Tooltip.Root uses `{#snippet children({ data })}` (not `let:data`)
- LayerChart `tooltipContext` uses `touchEvents: 'auto'` (not `'pan-x'`)
- `data-testid="mde-curve-card"` for E2E targeting

## Files in scope

**New (3):**
- `src/lib/mde.ts`
- `src/lib/mde.test.ts`
- `src/lib/components/MdeCurveCard.svelte`

**Edited (3):**
- `src/routes/+page.svelte`
- `src/lib/components/EmptyState.svelte`
- `src/lib/i18n/messages.ts`

## Constraints honored

- No SSR / backend work — zero new Supabase calls, zero migrations, zero Edge Function changes.
- No new dependency — LayerChart + date-fns already present.
- Reactive chain uses the established `$derived(getFiltered())` pattern (KpiTile, CalendarRevenueCard).
- Card chrome matches `CalendarRevenueCard.svelte`: `rounded-xl border border-zinc-200 bg-white p-4`.
- No horizontal-scroll wrapper needed — 14 integer ticks fit on a 375 px viewport.
- Zero `LazyMount` — card reads an already-derived store, no network fetch to defer.
- Honors project memory `feedback_layerchart_mobile_scroll` and `feedback_svelte5_tooltip_snippet`.
- No `Co-authored-by: Claude` in commit messages (per CLAUDE.md).

---

## Task 1 — Pure math module + unit tests

**Files (atomic commit):**
- `src/lib/mde.ts` (new)
- `src/lib/mde.test.ts` (new)

**Action:**

### `src/lib/mde.ts`

Pure TS, no Svelte imports. Mirrors `src/lib/trendline.ts` / `kpiAgg.ts` / `cohortAgg.ts` shape.

Exports:
- `MDE_Z_ALPHA_HALF = 1.96` — α=0.05 two-tailed z cutoff
- `MDE_Z_BETA = 0.84` — 80% power z cutoff
- `MDE_C = 2 * (MDE_Z_ALPHA_HALF + MDE_Z_BETA) ** 2` — derived, ≈ 15.68
- `MDE_MAX_CAMPAIGN_DAYS = 14`
- `MDE_MIN_BASELINE_DAYS = 7`
- `dailyRevenuesEUR(rows: readonly DailyRow[]): number[]` — groups by `business_date`, sums `gross_cents`, returns €/day as `number[]`
- `sampleStd(values: readonly number[]): number` — ddof=1; returns 0 when n<2
- `harmonicMean(n1: number, n2: number): number` — returns 0 if either is 0
- `mdeAt(sigma: number, n1: number, n2: number, C = MDE_C): number`
- `mdeCurvePoints(sigma: number, n1: number, maxDays = MDE_MAX_CAMPAIGN_DAYS): Array<{ n2: number; mde: number }>` — n₂ = 1..maxDays

Import `DailyRow` type from `$lib/dashboardStore.svelte`.

### `src/lib/mde.test.ts`

Vitest. At minimum:
- `sampleStd([100, 200, 300])` ≈ 100 (within 0.01)
- `sampleStd([50])` === 0
- `harmonicMean(20, 4)` ≈ 6.667 (within 0.01)
- `mdeAt(222, 20, 4)` ≈ 340 (within 1)  — Step-3 PDF sanity check
- `mdeAt(222, 20, 20)` < `mdeAt(222, 20, 4)` — curve descends as n₂ grows
- `dailyRevenuesEUR` rolls two rows on the same business_date into one day and returns €, not cents
- `mdeCurvePoints(222, 20)` — `.length === 14`, `strict decreasing`, all finite

**Verify:**
```
npm run test -- src/lib/mde.test.ts
```

**Done when:** all test cases pass.

**Commit:** `feat(mde): pure MDE math helpers + unit tests`

---

## Task 2 — Card component + wiring + i18n

**Files (atomic commit):**
- `src/lib/components/MdeCurveCard.svelte` (new)
- `src/routes/+page.svelte`
- `src/lib/components/EmptyState.svelte`
- `src/lib/i18n/messages.ts`

**Action:**

### `src/lib/components/MdeCurveCard.svelte`

Follow `CalendarRevenueCard.svelte` patterns exactly.

Imports:
- `Chart, Svg, Axis, Spline, Tooltip` from `'layerchart'`
- `page` from `'$app/state'`
- `t` from `'$lib/i18n/messages'`
- `formatEUR, formatEURShort` from `'$lib/format'`
- `EmptyState` from `'./EmptyState.svelte'`
- `getFiltered` from `'$lib/dashboardStore.svelte'`
- `dailyRevenuesEUR, sampleStd, mdeCurvePoints, MDE_MIN_BASELINE_DAYS, MDE_MAX_CAMPAIGN_DAYS` from `'$lib/mde'`
- `integerTicks` from `'$lib/trendline'`

Reactive chain:
```
const stats = $derived.by(() => {
  const rev = dailyRevenuesEUR(getFiltered());
  return { n1: rev.length, sigma: sampleStd(rev) };
});
const curve = $derived.by(() =>
  stats.n1 >= MDE_MIN_BASELINE_DAYS && stats.sigma > 0
    ? mdeCurvePoints(stats.sigma, stats.n1, MDE_MAX_CAMPAIGN_DAYS)
    : []
);
const yMax = $derived(curve.length ? curve[0].mde : 0);
```

Template skeleton:
```svelte
<div data-testid="mde-curve-card" class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-base font-semibold text-zinc-900">{t(page.data.locale, 'mde_title')}</h2>
  {#if curve.length === 0}
    <EmptyState card="mde-curve" />
  {:else}
    <div class="mt-4 h-64 chart-touch-safe">
      <Chart
        data={curve}
        x="n2"
        y="mde"
        yDomain={[0, yMax]}
        padding={{ left: 48, right: 12, top: 16, bottom: 28 }}
        tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
      >
        <Svg>
          <Axis placement="left" format={formatEURShort} grid rule />
          <Axis placement="bottom" ticks={integerTicks(MDE_MAX_CAMPAIGN_DAYS)} rule />
          <!-- Dashed vertical reference at n₂=7 ("1 week") — 2-point Spline -->
          <Spline
            data={[{ n2: 7, mde: 0 }, { n2: 7, mde: yMax }]}
            x="n2"
            y="mde"
            class="stroke-zinc-400 [stroke-dasharray:4_4]"
          />
          <Spline class="stroke-zinc-900 stroke-[2]" />
        </Svg>
        <Tooltip.Root>
          {#snippet children({ data: row })}
            <Tooltip.Header>
              {t(page.data.locale, 'mde_tooltip_day', { n2: row.n2 })}
            </Tooltip.Header>
            <Tooltip.Item
              label={t(page.data.locale, 'mde_tooltip_mde')}
              value={formatEUR(row.mde * 100)}
            />
          {/snippet}
        </Tooltip.Root>
      </Chart>
    </div>
    <p class="mt-2 text-xs text-zinc-500">
      {t(page.data.locale, 'mde_caption', {
        n1: stats.n1,
        sigma: formatEUR(stats.sigma * 100)
      })}
    </p>
  {/if}
</div>
```

### `src/routes/+page.svelte`

- Add `import MdeCurveCard from '$lib/components/MdeCurveCard.svelte';` beside the other card imports.
- Insert `<MdeCurveCard />` between the existing `<CalendarRevenueCard />` and `<RepeaterCohortCountCard />`. No `LazyMount` wrapper.

### `src/lib/components/EmptyState.svelte`

- Add `'mde-curve'` to the `card` prop union (wherever the existing `card` type is declared).
- Add a branch that returns the `mde_empty` i18n key message. Pattern-match how existing card slugs route their copy.

### `src/lib/i18n/messages.ts`

Add 5 new keys to every locale block (en, de, ja, es, fr — TypeScript enforces parity via `MessageKey = keyof typeof messages.en`). For de/ja/es/fr use the English copy as placeholder (same approach used in the recent i18n rollout — polish later).

```
mde_title:       'Minimum detectable lift'
mde_caption:     'Based on {n1} days of baseline variability (σ {sigma}/day). Assumes 95% confidence, 80% power.'
mde_tooltip_day: 'Day {n2}'
mde_tooltip_mde: 'Needs ≥ {mde}/day avg'
mde_empty:       'Need ≥ 7 days of baseline data to draw the curve.'
```

**Verify:**
```
npm run test            # must stay green
npx tsc --noEmit        # no type errors (MessageKey parity)
npm run build           # adapter-cloudflare build succeeds
```

**Done when:** `npm run test` + `tsc --noEmit` + `npm run build` all pass, and the branch is ready to push.

**Commit:** `feat(mde): add MdeCurveCard to dashboard with reactive σ/n₁`

---

## Post-execution QA (done after merge/push)

1. Push `quick-260424-mde`, wait for DEV deploy.
2. Chrome MCP: open DEV dashboard at 375 px, screenshot the card.
3. Change range chip (7d → 30d → all) → curve shifts visibly (σ and n₁ change).
4. Apply Mon-only DOW filter → caption `n1` drops; if n₁ < 7 the EmptyState shows.
5. Open DevTools console → zero LayerChart warnings (especially `invalid_default_snippet`).
