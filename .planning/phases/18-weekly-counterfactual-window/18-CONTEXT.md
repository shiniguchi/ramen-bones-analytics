# Phase 18: Weekly Counterfactual Window — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Source:** Direct conversation (skipped /gsd-discuss-phase per "skip redundant questions after discuss-phase" memory — design discussion happened in chat 2026-05-07 before phase open; all decisions locked inline)

<domain>
## Phase Boundary

**This phase delivers:** Replace `CampaignUpliftCard`'s cumulative-since-launch headline with a per-ISO-week (Mon–Sun) counterfactual answer plus a tap-scrubbable bar-chart history of all completed weeks since campaign launch — friend-owner gets a fresh weekly read on whether the campaign is working, not a single decaying cumulative number that drifts toward "no detectable lift" the longer the campaign runs.

**This phase does NOT deliver:**
- Confidence intervals on per-day uplift slices (the per-day trajectory in the existing sparkline is point-only — re-fitting CIs at every per-day cut is out of scope)
- Cumulative-since-launch headline preservation (it is being REPLACED, not supplemented — user phrasing was "instead of since April 14th")
- Backfill of weekly history rows into prior `as_of_date` snapshots (each nightly run computes the current weekly state going forward; we do NOT replay history)
- New campaigns / multi-campaign UX (single-campaign assumption preserved; matches v1.3 scope)

**User-facing read:** "Week of Apr 27 – May 3: −€149 (95% CI −€620…+€340)" + bar chart showing all past completed weeks since the 2026-04-14 launch.

</domain>

<decisions>
## Implementation Decisions

### Pipeline (DB + Python)

- **DB schema:** Add new value `'iso_week'` to `campaign_uplift.window_kind` CHECK constraint. Existing values (`campaign_window`, `cumulative_since_launch`, `per_day`) stay; cumulative-since-launch row keeps writing for now (Track-B continuity — removing it is a future cleanup, not part of this phase). New rows have `as_of_date` = the Sunday of the ISO week (so per-week rows are stable across runs and dedup naturally).
- **Bootstrap CI re-fit per week:** `scripts/forecast/cumulative_uplift.py` computes a fresh 1000-path bootstrap CI on the 7-day slice for each completed ISO week. **MUST NOT** derive CI by subtracting daily cumulative bounds — bootstrap samples are correlated and don't subtract additively. Each weekly row's CI is independently bootstrapped from the residuals of that 7-day window vs the Track-B counterfactual.
- **Trailing-edge rule:** Skip the in-progress (current) week. As of 2026-05-07 (Wednesday), the most recent completed ISO week is Apr 27 – May 3. May 4 onward is excluded.
- **Leading-edge rule:** Skip the partial launch week. The 2026-04-14 campaign launched Tuesday, so Apr 13–19 is excluded by symmetry with the trailing-edge rule. First valid bar = week of Apr 20–26.
- **Persistence model:** All completed ISO weeks since campaign launch are persisted as separate `campaign_uplift` rows with `window_kind = 'iso_week'`. The bar chart reads the full set; the headline reads the most recent (Sunday-as-of-date is the most recent fully-completed Sunday strictly < `today`).

### API

- `/api/campaign-uplift` returns a new `weekly_history` array on the existing payload alongside `daily` and `campaigns`:
  ```ts
  weekly_history: Array<{
    iso_week_start: string;  // ISO date (Mon)
    iso_week_end: string;    // ISO date (Sun)
    model_name: string;
    point_eur: number;
    ci_lower_eur: number;
    ci_upper_eur: number;
    n_days: 7;               // always 7 for fully-completed ISO weeks
  }>
  ```
- The headline picks the most recent entry by `iso_week_end` for `model_name = 'sarimax'` (matches existing headline-pick convention).
- Existing `cumulative_deviation_eur` / `ci_lower_eur` / `ci_upper_eur` top-level fields stay populated for backwards compatibility but become unused by the rewritten card. Future cleanup phase removes them.

### UI (CampaignUpliftCard)

- **Hero number:** Last completed ISO week. Date label "Week of [Mon date] – [Sun date]" replaces "Since April 14th" string. Maturity tier × CI-overlap matrix logic from UPL-06 reused — fully-completed weeks always have `n_days = 7`, so the tier resolves to "mature" (or whatever tier the existing matrix maps `n_days = 7` to — verify).
- **Bar chart below hero:** LayerChart `Bars` + per-bar CI whiskers (LayerChart `Rule` for whiskers). One bar per ISO week, X axis = ISO week labels (`W17`, `W18`, … or short date `Apr 20`), Y axis = €.
- **Color coding:**
  - Gray (CI straddles 0): no detectable lift this week
  - Green (CI lower > 0): positive lift detected
  - Red (CI upper < 0): negative impact detected
- **Dashed y=0 baseline:** Reuse existing `Rule y={0}` pattern from current sparkline.
- **Interaction:** Tap a bar → hero re-renders with that week's read. State managed via `$state` rune. Default selected = most recent completed week.
- **Empty state (campaign launched < 1 ISO week ago):** Reuse existing "too early" hero copy until first bar lands.

### i18n

- Reuse existing 7-key `uplift_hero_*` set (early / midweeks / mature × CI-overlap matrix). The `{date}` template variable now receives a week range string instead of the launch date.
- New keys for week labels: `uplift_week_label` (template: "Week of {start} – {end}"), `uplift_bar_chart_caption`, `uplift_history_x_axis_label`. Add to `src/lib/i18n/messages.ts` for `en` + `ja` real, `de` / `es` / `fr` placeholder per existing pattern.

### Mobile-first constraints

- Bar chart rendered at 280×100px to match existing sparkline canvas. Once weeks > ~10, horizontal scroll matches the Calendar* card pattern.
- `Chart.tooltipContext.touchEvents: 'auto'` (NOT `'pan-x'`) per `feedback_layerchart_mobile_scroll.md` memory.
- `Tooltip.Root` uses snippet-children form per `feedback_svelte5_tooltip_snippet.md` memory.

### Localhost-first verification (per .claude/CLAUDE.md frontend rule)

- `src/lib/components/CampaignUpliftCard.svelte` is a frontend file → MUST verify on `http://localhost:5173` before claiming task complete (Stop hook enforces this).
- DEV verification is FINAL QA after push, not per-edit feedback loop.

### Claude's Discretion

- ISO week label format ("W17" vs "Apr 20" vs "Apr 20 – Apr 26") — pick what reads best on 375px mobile.
- Bar chart axis tick density — match existing sparkline (3 Y ticks, 5 X ticks) unless density exceeds threshold.
- Whether to retain a separate disclosure panel (current `uplift-details-panel`) — preserve for now; redesign deferred.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 16 lineage (the existing campaign-uplift system this phase modifies)

- `.planning/phases/16-its-uplift-attribution/16-CONTEXT.md` — original UPL-01..07 design contract; per-window aggregates and DISTINCT ON wrapper-view dedup pattern
- `.planning/phases/16-its-uplift-attribution/16-RESEARCH.md` — bootstrap-CI methodology (1000 paths, residual resampling), Track-B counterfactual fit on pre-campaign era only
- `.planning/phases/16-its-uplift-attribution/16-PATTERNS.md` — existing patterns for backing table + thin RLS wrapper view

### Database

- `supabase/migrations/0064_campaign_uplift_v.sql` — `campaign_uplift` table + CHECK constraint (must add `'iso_week'` to allow-list); RLS pattern for tenant scope; DISTINCT ON dedup wrapper-view template
- `supabase/migrations/0066_forecast_with_actual_v_comparable.sql` — `revenue_comparable_eur` aliasing, the actual-vs-forecast view the counterfactual fits against
- `supabase/migrations/0058_campaign_calendar.sql` — `campaign_calendar.start_date` / `end_date` source for the campaign window

### Pipeline

- `scripts/forecast/cumulative_uplift.py` — current per-window + per-day writer; pattern to extend with `iso_week` window_kind
- `scripts/forecast/counterfactual_fit.py` — Track-B fit producing the residuals the bootstrap consumes
- `scripts/forecast/grain_helpers.py` — utility for date bucket math; ISO-week bucketing helper if not present is added here

### API + UI

- `src/routes/api/campaign-uplift/+server.ts` — payload assembler; extend with `weekly_history`
- `src/lib/components/CampaignUpliftCard.svelte` — full rewrite of headline + add bar chart; preserve disclosure panel
- `src/lib/i18n/messages.ts` — add new keys, reuse 7-key hero set with week-range template
- `src/lib/components/ModelAvailabilityDisclosure.svelte` — verify it still works (maturity tier text uses `n_days` from selected week)

### Project conventions

- `CLAUDE.md` (root + .claude/) — workflow rules, localhost-first frontend verification, no Co-authored-by Claude commits
- `.planning/PROJECT.md` §"Forecast Model Availability Matrix" — confirms 5 models always available at day grain (no model-availability gating needed for this phase)
- `.claude/memory/feedback_layerchart_mobile_scroll.md` — `touchEvents: 'auto'` rule
- `.claude/memory/feedback_svelte5_tooltip_snippet.md` — Tooltip.Root snippet-children form

</canonical_refs>

<specifics>
## Specific Ideas

- The conversation 2026-05-07 already computed the answer for Apr 27 – May 3 manually (sarimax: −€149; ets: +€710; prophet: +€187; naive_dow: +€327; theta: +€513) — this can be a regression-test fixture once the pipeline lands, since these are the canonical "first weekly read" values from per-day cumulative differencing. Note however that the pipeline-computed CI will differ from any per-day-derived CI (bootstrap re-fit, not subtracted bounds) — the point estimates should match within rounding.
- Sparkline-style implementation reference: the existing `CampaignUpliftCard.svelte` lines 266–352 already have a working LayerChart `Chart`/`Svg`/`Spline`/`Area`/`Rule`/`Tooltip` setup at 280×100px — clone that scaffold, swap `Spline` + `Area` for `Bars` + per-bar `Rule` whiskers.
- Tap-to-scrub: LayerChart's `Tooltip` already provides hover state; for tap-on-bar, use `<rect onclick={...}>` on the bar primitive itself (LayerChart Bars accepts a `class` and event props) — set a `$state<number | null>` selectedWeekIndex; hero reads `weekly_history[selectedWeekIndex ?? mostRecent]`.

</specifics>

<deferred>
## Deferred Ideas

- **Cumulative-since-launch headline removal in DB / pipeline:** for now, `cumulative_since_launch` rows continue to be written by the existing pipeline path (so the API stays backwards-compatible during deploy). A follow-up cleanup phase removes the writer + the API field once the rewritten card is verified in production.
- **Per-day CI bands on the historic trajectory:** the deleted sparkline showed a CI band; re-introducing per-day CIs would need its own bootstrap-per-day pass. Not requested by the user; out of scope for this phase.
- **Multi-campaign weekly chart:** v1 has one campaign. Multi-campaign UX (e.g., overlay or facet) is a separate UX problem, deferred until a second campaign is loaded.
- **Backfill of weekly history into prior `as_of_date` snapshots:** the audit trail begins from this phase's first run forward.
- **Slider per week (alternative UX considered, rejected 2026-05-07):** the user picked Option C (bar chart) over Option B (slider) because bars show pattern-at-a-glance.
- **Partial launch-week bar (alternative considered, deferred 2026-05-07):** flagged as an open question during design; default = exclude. If the friend-owner asks for it later, a "(short week)" labeled bar is a small follow-up.

</deferred>

---

*Phase: 18-weekly-counterfactual-window*
*Context gathered: 2026-05-07 via direct conversation (no /gsd-discuss-phase); decisions confirmed inline*
