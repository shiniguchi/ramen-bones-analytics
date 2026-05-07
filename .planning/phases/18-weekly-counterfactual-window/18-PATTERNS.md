# Phase 18: Patterns to Mirror

**Mapped:** 2026-05-07
**Files analyzed:** 8 (1 migration, 1 python pipeline, 1 SQL view, 1 API route, 1 svelte component, 1 i18n file, tests for 3 layers)
**Closest analogs:** all 8 found in repo (no item lacks an analog)

---

## 1. CHECK constraint extension (DB migration)

**New file:** `supabase/migrations/00NN_campaign_uplift_iso_week.sql` (number TBD by planner — next free slot after the highest existing migration number)

**Closest analog:** `supabase/migrations/0064_campaign_uplift_v.sql:29-32` (which itself extended an existing CHECK created in `0050_forecast_daily.sql`).

**Copy verbatim** (the DROP/ADD pair shape, with the `forecast_daily_kpi_name_check` example as template):

```sql
-- Drop and recreate to add the new value to the allow-list.
ALTER TABLE public.forecast_daily DROP CONSTRAINT IF EXISTS forecast_daily_kpi_name_check;
ALTER TABLE public.forecast_daily
  ADD CONSTRAINT forecast_daily_kpi_name_check
  CHECK (kpi_name IN ('revenue_eur', 'invoice_count', 'revenue_comparable_eur'));
```

The pre-existing CHECK on `campaign_uplift.window_kind` is line 48 of `0064_campaign_uplift_v.sql`:

```sql
window_kind text NOT NULL CHECK (window_kind IN ('campaign_window', 'cumulative_since_launch', 'per_day')),
```

**Adapt for Phase 18:**
- Target table: `public.campaign_uplift` (not `forecast_daily`).
- Constraint name: PostgreSQL auto-generated `campaign_uplift_window_kind_check` (probe with `\d public.campaign_uplift` to confirm; convention is `<table>_<column>_check`).
- New IN-list: `('campaign_window', 'cumulative_since_launch', 'per_day', 'iso_week')`.
- Add a header comment block matching the prose style of `0064:13-21` (explains *why* this migration touches an existing CHECK).
- No new RLS / GRANT block needed — extending an allow-list does not change row visibility.

**Do NOT** drop and recreate the table; that would lose the `campaign_uplift_lookup_idx` and the RLS policy. DROP CONSTRAINT / ADD CONSTRAINT only.

---

## 2. Python pipeline writer adding a new `window_kind`

**New code path:** an additional loop inside `scripts/forecast/cumulative_uplift.py::_process_campaign_model` (or a new sibling helper) that emits one row per completed ISO week with `window_kind='iso_week'`.

**Closest analog:** the same file, `scripts/forecast/cumulative_uplift.py`. Two patterns inside it map directly onto Phase 18's needs:

### 2a. Per-window single-row writer pattern (analog: `campaign_window` + `cumulative_since_launch` blocks at lines 595-639)

```python
cw = compute_uplift_for_window(
    client,
    restaurant_id=restaurant_id,
    campaign_id=campaign_id,
    model_name=model_name,
    start_date=start_date,
    end_date=end_date,
)
if cw is not None:
    cw_ci = cw["result"]
    out_rows.append({
        "restaurant_id": restaurant_id,
        "campaign_id": campaign_id,
        "model_name": model_name,
        "window_kind": "campaign_window",
        "cumulative_uplift_eur": cw_ci["cumulative_uplift_eur"],
        "ci_lower_eur": cw_ci["ci_lower_eur"],
        "ci_upper_eur": cw_ci["ci_upper_eur"],
        "naive_dow_uplift_eur": naive_dow_window,
        "n_days": cw_ci["n_days"],
        "as_of_date": end_date.isoformat(),
    })
```

### 2b. Loop-over-buckets pattern (analog: `compute_per_day_uplift_rows` at lines 133-187 — slices `[0..i+1)`)

```python
for i in range(len(actual_values)):
    ci = bootstrap_uplift_ci(
        actual_values=actual_values[: i + 1],
        yhat_samples_per_day=paths[: i + 1].tolist(),
        n_resamples=1000,
        seed=42 + i,
    )
    rows.append({
        "restaurant_id": restaurant_id,
        "campaign_id": campaign_id,
        "model_name": model_name,
        "window_kind": "per_day",
        "cumulative_uplift_eur": ci["cumulative_uplift_eur"],
        ...
        "n_days": i + 1,
        "as_of_date": target_dates[i].isoformat(),
    })
```

### 2c. Upsert via supabase-py (analog: `_upsert_campaign_uplift_rows` at lines 533-553)

```python
res = (
    client.table("campaign_uplift")
    .upsert(
        rows,
        on_conflict="restaurant_id,campaign_id,model_name,window_kind,as_of_date",
    )
    .execute()
)
if getattr(res, "error", None):
    raise RuntimeError(f"campaign_uplift upsert failed: {res.error}")
```

**Adapt for Phase 18:**
- New helper `compute_iso_week_uplift_rows(...)` that:
  1. Iterates Mon–Sun ISO-week starts strictly between `campaign_start + 7` (skip partial leading week) and `today` (exclude in-progress current week — the trailing-edge rule from `18-CONTEXT.md` line 29).
  2. For each completed week, slices `actual_values` and `yhat_samples_per_day` arrays to that exact 7-day window using a date filter (NOT a contiguous index slice — alignment by date dictionary, like 2c above).
  3. Calls `bootstrap_uplift_ci(...)` with `n_resamples=1000` and a deterministic per-week seed (e.g., `seed=42 + (iso_week_start - campaign_start).days`).
  4. Emits rows with `window_kind='iso_week'`, `n_days=7`, `as_of_date=iso_week_end.isoformat()` (Sunday — per CONTEXT line 27).
  5. `naive_dow_uplift_eur=None` (matches per-day rows at line 183).
- Wire it inside `_process_campaign_model` after the existing `cs` block (line 638), reusing `cs["actual_values"]`, `cs["yhat_samples_per_day"]`, `cs["target_dates"]` to avoid a 2nd DB roundtrip.
- `out_rows.extend(iso_week_rows)` so `_upsert_campaign_uplift_rows` (line 684) handles them with no change — the existing `on_conflict` tuple already includes `window_kind`.
- New ISO-week helper: `scripts/forecast/grain_helpers.py` does NOT yet contain a `completed_iso_weeks(start, today)` function (verified via grep — no `iso_week` / `isocalendar` strings). Add it there alongside `window_start_for_grain` (line 62) following the same docstring/typing style.

**CRITICAL** (per CONTEXT.md line 28): the bootstrap CI **MUST** re-fit on the 7-day slice. Do not derive weekly CI by subtracting daily cumulative bounds.

---

## 3. Wrapper view exposing tenant-scoped reads of a `window_kind` filter

**New file:** `supabase/migrations/00NN_campaign_uplift_weekly_v.sql` — or fold into the same migration as item 1 (atomic schema sync, matching the precedent set by `0064` which combined Part 0 + Part A + Part B1 + Part B2 + Part C in one file).

**Closest analog:** `supabase/migrations/0064_campaign_uplift_v.sql:120-143` — `campaign_uplift_daily_v`. The weekly view should be structurally identical (no DISTINCT ON, since iso_week rows are unique by `(campaign_id, model_name, as_of_date=Sunday)` — the same property that makes per_day rows unique).

**Copy verbatim** the entire Part B2 block as the template:

```sql
CREATE OR REPLACE VIEW public.campaign_uplift_daily_v AS
SELECT
  u.restaurant_id,
  u.campaign_id,
  cc.start_date AS campaign_start,
  cc.end_date AS campaign_end,
  cc.name AS campaign_name,
  cc.channel AS campaign_channel,
  u.model_name,
  u.cumulative_uplift_eur,
  u.ci_lower_eur,
  u.ci_upper_eur,
  u.n_days,
  u.as_of_date,
  u.computed_at
FROM public.campaign_uplift u
INNER JOIN public.campaign_calendar cc
  ON cc.restaurant_id = u.restaurant_id
  AND cc.campaign_id = u.campaign_id
WHERE u.window_kind = 'per_day'
  AND u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid;

GRANT SELECT ON public.campaign_uplift_daily_v TO authenticated;
COMMENT ON VIEW public.campaign_uplift_daily_v IS 'Phase 16 D-11: ...';
```

**Adapt for Phase 18:**
- View name: `public.campaign_uplift_weekly_v`.
- WHERE clause: `WHERE u.window_kind = 'iso_week'` (single substitution).
- COMMENT: rewrite for Phase 18 — pattern: `'Phase 18: read-only per-ISO-week (Mon–Sun) cumulative uplift trajectory for the dashboard bar chart. Tenant-scoped. Same backing table as campaign_uplift_v but filtered to window_kind=iso_week rows. No DISTINCT ON because iso_week rows are unique by (campaign, model, as_of_date) construction (each completed week writes once with as_of_date=Sunday).'`
- Keep `naive_dow_uplift_eur` OUT of the SELECT list (matches `_daily_v` — weekly rows don't carry it; see item 2 above).
- GRANT line is unchanged — the backing table's RLS already filters on `restaurant_id`, but the inline `WHERE u.restaurant_id = (auth.jwt()->>'restaurant_id')::uuid` is the documented belt-and-suspenders shape from `0064` and must be preserved.

---

## 4. SvelteKit `/api/<resource>/+server.ts` route extending its return shape

**File to modify:** `src/routes/api/campaign-uplift/+server.ts` (full source above; 156 lines).

**Current shape — what the file already does:**
- Auth boundary: `locals.safeGetSession()` returns `{ claims }`; null claims → `401 + NO_STORE` headers (line 64-65). No zod validation — the GET handler takes no body / no query params.
- Two parallel `fetchAll<T>()` queries — `campaign_uplift_v` (per-window aggregates) and `campaign_uplift_daily_v` (per-day) — wrapped in `Promise.all` (lines 71-88).
- Group-by-campaign loop builds a `byCampaign: Map<string, CampaignBlock>` (lines 93-115); first campaign drives the headline.
- Headline pick: `campaigns[0]?.rows.find(r => r.model_name === 'sarimax' && r.window_kind === 'cumulative_since_launch')` (lines 119-121).
- Daily array filtered to the headline campaign + sarimax (lines 124-134).
- Error handling: top-level `try/catch` around the whole body; `console.error('[/api/campaign-uplift]', err)` + `return json({ error: 'query failed' }, { status: 500, headers: NO_STORE })` (lines 152-155).

**Copy verbatim** (the third parallel-query slot — drop into the existing `Promise.all`):

```typescript
const [rows, dailyRows] = await Promise.all([
  fetchAll<UpliftRow>(() =>
    locals.supabase
      .from('campaign_uplift_v')
      .select(
        'campaign_id,campaign_start,campaign_end,campaign_name,campaign_channel,model_name,window_kind,cumulative_uplift_eur,ci_lower_eur,ci_upper_eur,naive_dow_uplift_eur,n_days,as_of_date'
      )
      .order('campaign_start', { ascending: false })
      .order('model_name', { ascending: true })
  ),
  fetchAll<DailyRow>(() =>
    locals.supabase
      .from('campaign_uplift_daily_v')
      .select('campaign_id,model_name,cumulative_uplift_eur,ci_lower_eur,ci_upper_eur,as_of_date')
      .eq('model_name', 'sarimax')
      .order('as_of_date', { ascending: true })
  )
]);
```

**Adapt for Phase 18:**
- Add a 3rd `fetchAll<WeeklyRow>()` call against `campaign_uplift_weekly_v` inside the same `Promise.all` array.
- New row type at the top, mirroring `DailyRow` (lines 38-45):
  ```ts
  type WeeklyRow = {
    campaign_id: string;
    model_name: string;
    cumulative_uplift_eur: number;  // 7-day point estimate
    ci_lower_eur: number;
    ci_upper_eur: number;
    n_days: number;                 // always 7 for completed weeks
    as_of_date: string;             // ISO Sunday
  };
  ```
- Filter to headline campaign × all 5 models (or just sarimax if matching daily's `eq('model_name', 'sarimax')` convention — CONTEXT.md line 47 says headline picks sarimax, so single-model query is fine and cheaper).
- Map to the response payload field per CONTEXT.md lines 35-46:
  ```ts
  weekly_history: weeklyRows
    .filter((w) => w.campaign_id === headlineCampaignId)
    .map((w) => ({
      iso_week_start: /* compute Mon from as_of_date Sunday: subtract 6 days */,
      iso_week_end: w.as_of_date,
      model_name: w.model_name,
      point_eur: w.cumulative_uplift_eur,
      ci_lower_eur: w.ci_lower_eur,
      ci_upper_eur: w.ci_upper_eur,
      n_days: w.n_days
    }))
  ```
  (date math via `date-fns` — `subDays(parseISO(as_of_date), 6)` then `format(..., 'yyyy-MM-dd')`. The file already imports `format` from `date-fns` at line 20.)
- Keep all existing top-level fields populated (CONTEXT.md line 48: `cumulative_deviation_eur`, `ci_lower_eur`, `ci_upper_eur` stay for back-compat). Append `weekly_history` to the `json({...})` literal at lines 137-149 — DO NOT remove anything.
- Reuse the same error-handling shape verbatim (lines 152-155).

---

## 5. Svelte component reading the API and rendering a LayerChart visualization

**File to fully rewrite:** `src/lib/components/CampaignUpliftCard.svelte` (currently 388 lines).

**Closest analog:** the same file. Phase 18 reuses its scaffolding; only the chart primitives + hero state-management swap.

### 5a. Fetch + state-setter pattern (lines 67-83) — REUSE VERBATIM

```typescript
let data = $state<Payload | null>(null);
let loading = $state(true);
let loadError = $state<string | null>(null);

$effect(() => {
  void clientFetch<Payload>('/api/campaign-uplift')
    .then((payload) => { data = payload; })
    .catch((e) => {
      console.error('[CampaignUpliftCard]', e);
      loadError = e instanceof Error ? e.message : 'fetch failed';
    })
    .finally(() => { loading = false; });
});
```

**Adapt:** extend the `Payload` type (lines 55-65) with the new `weekly_history: WeeklyHistoryPoint[]` field — no fetcher logic changes.

### 5b. Headline `$derived.by` pick (lines 86-93) — REUSE PATTERN

```typescript
const headline = $derived.by(() => {
  if (!data || data.campaigns.length === 0) return null;
  const c = data.campaigns[0];
  const r = c.rows.find(
    (row) => row.model_name === 'sarimax' && row.window_kind === 'cumulative_since_launch'
  );
  return r ? { campaign: c, row: r } : null;
});
```

**Adapt for Phase 18:**
- Add `selectedWeekIndex = $state<number | null>(null)` for tap-to-scrub (CONTEXT.md "Specific Ideas" line 130).
- Replace the `cumulative_since_launch` find with a "most recent weekly_history entry" pick:
  ```typescript
  const headline = $derived.by(() => {
    if (!data || data.weekly_history.length === 0) return null;
    const sarimaxWeeks = data.weekly_history.filter(w => w.model_name === 'sarimax');
    if (sarimaxWeeks.length === 0) return null;
    const idx = selectedWeekIndex ?? sarimaxWeeks.length - 1;
    return { campaign: data.campaigns[0], week: sarimaxWeeks[idx] };
  });
  ```

### 5c. LayerChart Chart/Svg/Spline/Area/Tooltip composition (lines 23, 269-339) — REPLACE primitives

Existing imports + Chart shell (line 23, 269-278):

```typescript
import { Chart, Svg, Spline, Area, Tooltip, Axis, Rule } from 'layerchart';
```

```svelte
<div class="chart-touch-safe" style:width="280px" style:height="100px">
  <Chart
    data={sparklineData}
    x="date"
    y={['ci_lower', 'ci_upper']}
    xScale={scaleTime()}
    yNice={2}
    padding={{ left: 36, right: 4, top: 4, bottom: 20 }}
    tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
  >
```

**Adapt for Phase 18:**
- Replace the import line with `import { Chart, Svg, Bars, Tooltip, Axis, Rule } from 'layerchart';` (drop `Spline` + `Area`; add `Bars`).
- Keep the wrapper `<div class="chart-touch-safe" style:width="280px" style:height="100px">` exactly — it is the canonical "horizontal-scroll mobile-safe" shell (CONTEXT.md line 69).
- Keep `tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}` — `'auto'` is the locked rule per `feedback_layerchart_mobile_scroll.md` (also tested in `tests/unit/CampaignUpliftCard.test.ts:237-240`).
- Replace `xScale={scaleTime()}` with `xScale={scaleBand()}` (band scale fits LayerChart's `<Bars>` primitive; categorical x-axis = ISO week index/label). Import: add `import { scaleBand } from 'd3-scale';` alongside the existing `scaleTime` import (line 24) — keep `scaleTime` imported only if still used elsewhere in the rewrite.

### 5d. Y-baseline `Rule y={0}` pattern (line 310) — REUSE VERBATIM

```svelte
<Rule y={0} class="stroke-zinc-500" stroke-dasharray="4 4" />
```

(Comment at lines 303-309 explains why kebab-case `stroke-dasharray` flows through unchanged for `Rule` — KEEP that comment.)

### 5e. Maturity-tier × CI-overlap heroKey logic (UPL-06, lines 99-146, 159-161) — REUSE VERBATIM, with `n_days` source swapped

```typescript
const ciOverlapsZero = $derived.by(() => {
  if (!headline) return false;
  const lo = headline.row.ci_lower_eur;
  const hi = headline.row.ci_upper_eur;
  return lo <= 0 && hi >= 0;
});

type MaturityTier = 'early' | 'midweeks' | 'mature';
const maturityTier = $derived.by<MaturityTier>(() => {
  if (!headline) return 'early';
  const n = headline.row.n_days;
  if (n < 14) return 'early';
  if (n < 28) return 'midweeks';
  return 'mature';
});

const heroKey = $derived.by<MessageKey>(() => {
  if (!headline) return 'uplift_hero_too_early';
  const tier = maturityTier;
  if (tier === 'early') return 'uplift_hero_too_early';
  const s = headline.row.cumulative_uplift_eur;
  const ciOverlap = ciOverlapsZero || s === 0;
  if (ciOverlap) {
    return tier === 'midweeks'
      ? 'uplift_hero_early_not_measurable'
      : 'uplift_hero_mature_no_lift';
  }
  const sign = s > 0 ? 'added' : 'reduced';
  return tier === 'midweeks'
    ? (`uplift_hero_early_${sign}` as MessageKey)
    : (`uplift_hero_mature_${sign}` as MessageKey);
});
```

**Adapt for Phase 18:**
- Reads from `headline.week.point_eur` instead of `headline.row.cumulative_uplift_eur` (the new payload shape).
- `n_days` source becomes `headline.week.n_days` — completed weeks always have `n_days = 7` (CONTEXT.md line 52). With `n=7`, the existing tier function returns `'early'` (since 7 < 14), so EVERY weekly hero would resolve to `uplift_hero_too_early` — **VERIFY this with the planner** before committing. CONTEXT.md line 52 explicitly says "verify". Likely fix: change the maturity-tier thresholds for the per-week case (e.g., resolve based on weeks-since-launch from `(today - campaign_start).weeks`, not `n_days` of the slice) — but the planner owns that decision; pattern-mapping notes it's an open ambiguity.
- `cumulative_uplift_eur === 0` collapse rule (line 159-161) reuses verbatim with `point_eur` substitution.

### 5f. Disclosure panel collapse pattern (lines 163-164, 354-385) — REUSE VERBATIM

```typescript
let detailsOpen = $state(false);
```

```svelte
<button
  type="button"
  class="mt-2 inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 hover:underline underline-offset-2"
  aria-expanded={detailsOpen}
  aria-controls="uplift-details-panel"
  onclick={() => (detailsOpen = !detailsOpen)}
  data-testid="uplift-details-trigger"
>
  {t(page.data.locale, 'uplift_details_trigger')}
  <span aria-hidden="true">{detailsOpen ? '⌄' : '›'}</span>
</button>

{#if detailsOpen}
  <div
    id="uplift-details-panel"
    class="mt-2 space-y-2 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600"
    data-testid="uplift-details-panel"
  >
    ...
  </div>
{/if}
```

**Adapt:** keep wholesale per CONTEXT.md "Claude's Discretion" line 82 ("preserve for now").

### 5g. `data-testid` conventions — REUSE / EXTEND

Existing testids the test file (`tests/unit/CampaignUpliftCard.test.ts`) asserts on:
- `campaign-uplift-card` — outermost div (lines 199, 208, 220, 239, 249)
- `cf-computing` — empty-state message (line 232)
- `hero-uplift` / `hero-ci-overlaps` — hero element (lines 252-253)
- `uplift-secondary-plain` (line 258)
- `uplift-card-subtitle` (lines 228, 247)
- `uplift-sparkline-x-caption` (line 343)
- `uplift-baseline-chip` (line 348)
- `uplift-details-trigger` (line 360)
- `uplift-details-panel` (line 370)
- `dim-point-estimate` / `anticipation-buffer-note` / `divergence-warning` (lines 372, 376, 380)

**Adapt for Phase 18:**
- KEEP all existing testids (test file is the contract).
- ADD new testids for the bar chart, e.g. `uplift-week-bar-chart`, `uplift-week-bar` (per-bar, with `data-week-index={i}` for tap targets), `uplift-week-headline-range`. The planner picks final names; the convention is kebab-case + `uplift-` prefix.

---

## 6. Bar chart with whiskers (closest existing analog)

**Bar chart analog:** `src/lib/components/CalendarRevenueCard.svelte:8, 274-281`. Three other components also use `<Bars>`: `CalendarCountsCard.svelte:217`, `CalendarItemRevenueCard.svelte:183`, `RepeaterCohortCountCard.svelte:164`.

**Copy verbatim** the simplest single-series Bars block (RepeaterCohortCountCard / CalendarRevenueCard pattern):

```svelte
{#each series as s, i (s.key)}
  <Bars
    seriesKey={s.key}
    rounded={i !== series.length - 1 ? 'none' : 'edge'}
    radius={4}
    strokeWidth={1}
  />
{/each}
```

**Per-bar styling pattern:** `<Bars>` accepts a `class` prop (passes through to each `<rect>`); per-bar color must be driven by a function-prop or by splitting bars into multiple `<Bars seriesKey>` instances per color group. From `node_modules/layerchart/dist/components/Bars.svelte.d.ts` lines 1-29, `BarsProps` extends `BarPropsWithoutHTML` (which inherits SVG attrs) and supports `[key: string]: any` plus `onBarClick(e, { data })` for tap handlers.

**No analog exists for:**

- **Per-bar CI whiskers (vertical error bars).** No component in `src/lib/components/` uses vertical `<Rule>` instances at per-bar x positions. Closest existing pattern is `Rule y={0}` (a horizontal baseline; `CampaignUpliftCard.svelte:310`). The planner will need to introduce: a `{#each weeklyHistory as w, i}` loop INSIDE the `<Svg>` block, emitting one `<Rule x={i} y={[w.ci_lower_eur, w.ci_upper_eur]} ... />` per week (or hand-rolled `<line>` SVG primitives if Rule's `y` array form doesn't work for vertical orientation). LayerChart's `Rule.svelte.d.ts` (not read; planner should consult Context7 / source) may or may not accept `y={[lo, hi]}` — verify.

- **`onBarClick` handler usage in this codebase.** Grep returned 0 hits for `onBarClick` in `src/`. Phase 18 will be the first user. The prop signature (from Bars.svelte.d.ts line 16-18):
  ```ts
  onBarClick?: (e: MouseEvent, detail: { data: any }) => void;
  ```
  Planner introduces this — no codebase analog to mirror.

- **Per-bar conditional fill class (color coding by CI band sign — gray/green/red per CONTEXT.md lines 54-57).** Not done elsewhere in this codebase. Either (a) split into 3 `<Bars data={...filteredByColor}>` instances per color, or (b) use the `onBarClick`-style API to apply a `class` per bar via a callback prop. The planner picks; suggest (a) for KISS — three filtered arrays drive three `<Bars>` components with class `fill-zinc-400`, `fill-emerald-500`, `fill-rose-500` respectively.

---

## 7. i18n key addition pattern

**File to modify:** `src/lib/i18n/messages.ts` (1333 lines, 5 locale blocks).

**Closest analog:** the entire 4-key Phase 16.1 D-18 supportive-labels block, repeated across all 5 locales:
- `en` block: `messages.ts:215-219`
- `de` block (placeholder = EN): `messages.ts:476-480`
- `ja` block (real translation): `messages.ts:731-734` (and 1 more line for `uplift_baseline_label`)
- `es` block (placeholder = EN): `messages.ts:987-991`
- `fr` block (placeholder = EN): `messages.ts:1243-1247` (anchor: line 1244 `uplift_card_subtitle`)

**Copy verbatim** (the EN block, lines 215-219, as the canonical shape):

```typescript
  // --- Campaign uplift card supportive labels (Phase 16.1 D-18) ---
  uplift_card_subtitle: 'Comparing your actual revenue since launch against what the model predicted without the campaign.',
  uplift_sparkline_y_label: 'Cumulative revenue impact (€)',
  uplift_sparkline_x_caption: 'Days since campaign launch',
  uplift_baseline_label: 'Dashed line = no campaign baseline',
```

**The convention** (encoded in the file's header comment, `messages.ts:1-11`):
1. `en` is the source of truth. `MessageKey = keyof typeof en` (line 280) — TypeScript enforces every other locale satisfies `Record<MessageKey, string>`.
2. Add the new key to **all 5 locale blocks** in the same source order (TypeScript will refuse to compile otherwise).
3. `en` + `ja` get real translations.
4. `de`, `es`, `fr` get **placeholder = EN copy** with a comment marker `'— DE placeholder = EN; v1.4 polish backlog item filed'` (see line 461 / 972 / 1228 for the exact comment shape).
5. Placeholders use `{name}` syntax (line 7) — the `interpolate()` helper at `messages.ts:1307-1312` swaps them.
6. Section header comments: `// --- <Description> (Phase NN <reference>) ---` style, see line 200 / 215 / 252 / 263.

**Adapt for Phase 18 — new keys per CONTEXT.md line 65:**

```typescript
  // --- Phase 18 weekly counterfactual window labels ---
  uplift_week_label: 'Week of {start} – {end}',
  uplift_bar_chart_caption: 'Weekly revenue lift since launch',  // wording: planner refines
  uplift_history_x_axis_label: 'Week',                            // wording: planner refines
```

- Insert into all 5 locale blocks in identical order. Place AFTER the existing `uplift_baseline_label` (lines 219, 480, 734, 991, 1247) so the section grouping stays clustered.
- `en` + `ja` real strings; `de` + `es` + `fr` placeholder = EN with the `v1.4 backlog` comment.
- `MessageKey` type at line 280 auto-extends from the `en` block — no manual type union edit needed.
- The friend-owner is JA — make sure the JA copy reads naturally for "Week of Apr 27 – May 3" (CONTEXT.md line 18).

---

## 8. Tests

### 8a. Python pipeline test convention

**Closest analog:** `tests/forecast/test_cumulative_uplift.py` (538 lines). It tests the SAME module Phase 18 modifies, so Phase 18 adds tests to the same file (or a sibling `test_iso_week_uplift.py`).

**Copy verbatim** (the synthetic-numpy fixture pattern, lines 56-78):

```python
@pytest.fixture
def synthetic_uplift_window():
    rng = np.random.default_rng(0)
    n_days = 30
    n_paths = 200
    base = 500.0
    paths = rng.normal(loc=base, scale=10.0, size=(n_days, n_paths))
    actual_values = np.full(n_days, base + 50.0)
    return {
        "actual_values": actual_values,
        "yhat_samples_per_day": paths.tolist(),
        "true_uplift": 50.0 * n_days,  # 1500
        "n_days": n_days,
        "n_paths": n_paths,
    }
```

The `_table_router` MagicMock pattern (lines 326-379) for full-pipeline tests is also the canonical shape — copy when testing `main_uplift` extension.

**Adapt for Phase 18:**
- New test functions following the file's naming convention `test_<aspect>` — e.g.:
  - `test_iso_week_rows_count_matches_completed_weeks` (analog: `test_per_day_rows_count_matches_window_length` line 416-450)
  - `test_iso_week_skips_in_progress_week` (CONTEXT.md line 29 — "skip current week")
  - `test_iso_week_skips_partial_launch_week` (CONTEXT.md line 30 — "skip Apr 13–19")
  - `test_iso_week_ci_independent_per_week` (CONTEXT.md line 28 — "MUST NOT subtract bounds")

### 8b. Svelte component test convention

**Closest analog:** `tests/unit/CampaignUpliftCard.test.ts` (298 lines). Phase 18 extends this file (the rewrite changes the SUT, so existing tests update or are replaced).

**Copy verbatim** (the hoisted `clientFetchSpy` + fixture-mutation pattern, lines 24-138):

```typescript
const { clientFetchSpy, FIXTURE_HEADLINE_NORMAL, ... } = vi.hoisted(() => {
  // ... define fixtures + spy ...
  const activeFixture = { current: FIXTURE_HEADLINE_NORMAL as unknown };
  const clientFetchSpy = vi.fn(async (url: string) => {
    if (!url.includes('/api/campaign-uplift')) {
      throw new Error(`Expected /api/campaign-uplift URL, got: ${url}`);
    }
    return activeFixture.current;
  });
  (clientFetchSpy as any).__activeFixture = activeFixture;
  return { clientFetchSpy, ... };
});

vi.mock('$lib/clientFetch', () => ({ clientFetch: clientFetchSpy }));

import CampaignUpliftCard from '../../src/lib/components/CampaignUpliftCard.svelte';
```

The source-text contract assertion pattern (lines 231-240) is the canonical shape for "force the rewritten file to keep the mobile-scroll fix":

```typescript
it('tooltip_snippet_contract — Tooltip.Root uses {#snippet children(...)} not let:data', () => {
  const src = readSource();
  expect(src).toMatch(/\{#snippet children\(/);
  expect(src).not.toMatch(/let:data/);
});

it("touch_events_contract — Chart wrapper sets touchEvents: 'auto'", () => {
  const src = readSource();
  expect(src).toMatch(/touchEvents:\s*['"]auto['"]/);
});
```

**Adapt for Phase 18:**
- New fixtures (`FIXTURE_WEEKLY_NORMAL`, `FIXTURE_WEEKLY_EMPTY`, `FIXTURE_WEEKLY_NEGATIVE_LIFT`) on the `Payload` type extended with `weekly_history`.
- DELETE the `layerchart_contract` test at lines 217-229 (it asserts Spline + Area + fill-opacity 0.06 — those primitives are gone in Phase 18). Replace with a `bar_chart_contract` asserting `<Bars>` is rendered (e.g. `expect(container.querySelectorAll('rect.bar').length).toBe(weekly_history.length)` — exact selector verified during GREEN).
- KEEP `tooltip_snippet_contract` and `touch_events_contract` source-text tests verbatim (memory rules from `feedback_svelte5_tooltip_snippet.md` + `feedback_layerchart_mobile_scroll.md` still apply).
- New tests for tap-to-scrub: simulate `click()` on a bar element, then `await flush()`, assert hero text changes.

### 8c. API endpoint test convention

**Closest analog:** `tests/unit/apiEndpoints.test.ts` (882 lines). The hand-rolled chainable supabase mock (lines 30-80) is the canonical shape — quoted comment "pattern from tests/unit/pageServerLoader.test.ts" (line 15) anchors the convention.

**Copy verbatim** the chainable-mock skeleton (lines 30-80) — too long to inline here in full; the planner reads the file directly.

**Adapt for Phase 18:**
- Extend the existing `/api/campaign-uplift` test block (search the file for the existing campaign-uplift suite).
- Add a fixture row set for `campaign_uplift_weekly_v` (3rd table), seed via `state.canned.set('campaign_uplift_weekly_v', [...])`.
- Assert response payload contains `weekly_history: [...]` with the expected row count + sorted by `iso_week_end ASC`.
- Assert auth/null-claims/error/Cache-Control contracts unchanged (the four shared per-endpoint tests at file header line 5-8) — those are inherited from the existing file's harness.

### 8d. SQL view (RLS) test convention

**Closest analog:** `tests/forecast/test_campaign_uplift_v.py:1-110` — the auth pattern via `set_config('request.jwt.claims', json, true)` to simulate tenant-A / tenant-B / anon JWTs. Per the file's docstring line 23-25, this is the discipline encoded in `.claude/memory/project_silent_error_isolation.md` ("assertions run under auth'd JWT — never service_role bypass").

**Adapt for Phase 18:**
- New file `tests/forecast/test_campaign_uplift_weekly_v.py` mirroring the structure of `test_campaign_uplift_v.py`:
  - `test_view_returns_iso_week_rows` — end-to-end visibility under tenant JWT
  - `test_view_rls_anon_zero` — anon JWT returns 0 rows
  - `test_view_rls_cross_tenant` — tenant-A cannot read tenant-B
  - `test_window_kinds_constrained_includes_iso_week` — service-role INSERT of `window_kind='iso_week'` succeeds; `'iso_weekly'` (typo) raises (i.e. the CHECK from item 1 is enforced)
- Reuse `_supabase_client()` (lines 79-96) and `_set_jwt(client, restaurant_id)` (lines 99-110) verbatim.

---

## Cross-cutting locked rules (from CONTEXT.md + memory)

These apply to every Phase 18 file, not just one item:

1. **`touchEvents: 'auto'`** on every `<Chart tooltipContext>` — `feedback_layerchart_mobile_scroll.md` + tested at `tests/unit/CampaignUpliftCard.test.ts:237-240`.
2. **`Tooltip.Root` snippet-children form** (`{#snippet children({ data: pt })}`) — never `let:data` — `feedback_svelte5_tooltip_snippet.md` + tested at `CampaignUpliftCard.test.ts:231-235`.
3. **Localhost-first verification** for any `.svelte` / `.css` edit — `.claude/CLAUDE.md` "Frontend / UI changes: LOCALHOST FIRST" + Stop hook at `.claude/hooks/localhost-qa-gate.js`.
4. **No `Co-authored-by: Claude`** in commits — `.claude/CLAUDE.md` enforces.
5. **Phase branch naming**: `feature/phase-18-weekly-counterfactual-window` — Stop hook recognises this pattern.
6. **Migrations on feature branch**: run `migrations.yml` on the feature ref before DEV /api/* QA — `feedback_migrations_workflow_dispatch.md` (the "DEV /api/* 500 right after migration phase" trap).
7. **Atomic schema sync**: combine the CHECK extension + new view into ONE migration file (precedent: `0064` combines 5 changes — Part 0 + A + B1 + B2 + C).
8. **Bootstrap CI re-fit per week** — never derive from per-day cumulative bounds (CONTEXT.md line 28; correlated samples don't subtract additively).

---

*Phase: 18-weekly-counterfactual-window*
*Patterns mapped: 2026-05-07 — all 8 items have a concrete codebase analog except per-bar whiskers + onBarClick (item 6), where the planner introduces new primitives within established LayerChart conventions.*
