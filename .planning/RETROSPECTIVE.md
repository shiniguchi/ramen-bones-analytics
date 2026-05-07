# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

---

## Milestone: v1.4 — Weekly Campaign Read

**Shipped:** 2026-05-07
**Phases:** 1 (Phase 18) | **Plans:** 7 | **Sessions:** 1 (single-day sprint)

### What Was Built

- DB migration 0069: `campaign_uplift.window_kind` extended to `'iso_week'`; `campaign_uplift_weekly_v` sister wrapper view
- `compute_iso_week_uplift_rows()`: per-ISO-week bootstrap CI (1000 paths, re-fit on 7-day slice — not derived from daily bounds)
- `/api/campaign-uplift`: `weekly_history[]` array alongside existing `daily[]` (backwards-compat)
- `CampaignUpliftCard` hero: "Week of Apr 27 – May 3: −€149" replaces "Since April 14th"
- Bar chart with CI whiskers, color-coded bars, tap-to-scrub via `selectedWeekIndex $state`
- 3 i18n keys × 5 locales; `ModelAvailabilityDisclosure` compatibility confirmed

### What Worked

- **Single-day sprint from context to merge:** Design discussion, 7 plans, 7 SUMMARY files, PR #31, and milestone archive all in one session on 2026-05-07.
- **"Skip redundant questions after discuss-phase" memory:** No re-questioning of decisions already locked in the opening chat. Saved ~30 min of dialog overhead.
- **TDD RED/GREEN discipline held across all 7 plans** — tests written before implementation in every plan, including the bootstrap helper, API endpoint, and hero + bar chart.
- **DEV spot-check as regression anchor:** Manual computation from the 2026-05-07 conversation (sarimax ≈ −€149) served as a regression fixture. Pipeline hit −€149.04 — confirmed methodological parity.
- **Option C (manual rect) fallback decision was fast:** When Decision B Primary (three filtered `<Bars>`) produced NaN bars, the fallback was already specified in the plan. No rabbit-holing.
- **Overflow fix discovered during QA (not production):** The LayerChart `lc-layout-svg` CSS specificity trap was caught in the 6-round QA before the user ever saw it.

### What Was Inefficient

- **Decision B Primary → Option C:** Two implementation cycles for the bar chart (RED → GREEN → fallback Option C). The LayerChart per-bar API gap was researchable before committing to Decision B Primary — Context7 query confirmed the gap, but only after the first approach failed.
- **`yDomain` bar-visibility bug (Plan 18-06):** Bars disappeared because `yDomain` included `ci_lower_eur` which is negative — bars above the 0 baseline became invisible. Caught and fixed (commit 8b31212), but a test for yDomain inclusion of ci bounds would have caught it earlier.
- **Tailwind vs LayerChart CSS specificity:** The `overflow-hidden` vs `lc-layout-svg` specificity issue is a known LayerChart gotcha. Should be a standing rule: always use `style:overflow` on chart containers, never Tailwind class.

### Patterns Established

- **Per-window-kind bootstrap seed namespaces:** per-day 42+i, iso_week 100_000+k. Future per-window writers pick the next band (200_000+k). Documented as a forward-compat invariant in the helper docstring.
- **Sister wrapper views for `campaign_uplift` discriminator values:** `campaign_uplift_v` (cumulative_since_launch) | `campaign_uplift_daily_v` (per_day) | `campaign_uplift_weekly_v` (iso_week) — same shape, swap WHERE filter only.
- **`style:overflow="hidden"` on chart containers:** Always inline, never Tailwind class, because LayerChart's `lc-layout-svg` uses `overflow: visible` in component-scoped CSS which wins over external Tailwind.
- **`onBarClick` (camelCase) is the actual LayerChart 2.x prop name** — docs examples use lowercase; source confirms camelCase. Verified in `node_modules/layerchart/dist/components/Bars.svelte:19`.
- **Decision A for maturity tier:** When adding per-window-kind bars, check whether `n_days` is always the same value (7 for weekly) — if so, maturity tier must be anchored to elapsed campaign duration, not data completeness.

### Key Lessons

1. **Research per-bar render APIs before committing to a multi-block color-coding approach** — a 5-min Context7 query would have skipped Decision B Primary entirely and jumped to Option C directly.
2. **`yDomain` must include CI bounds, not just point values** — if CI bounds are negative and yDomain is [0, max_point], bars above 0 are invisible because the scale starts at 0 but the axis origin may not. Test: assert chart renders bars for a dataset with point_eur > 0 even when ci_lower_eur < 0.
3. **LayerChart CSS specificity is a production risk** — any chart container using Tailwind overflow/clip classes should be audited and converted to `style:` directives.
4. **Backwards-compat shim accumulation:** Every feature that "keeps the old rows for backwards-compat" is a cleanup debt. v1.5 should open with a cleanup phase for `cumulative_since_launch` pipeline + API surface.

### Cost Observations

- Model mix: primarily Sonnet 4.6 for implementation + Haiku for quick checks
- Sessions: 1 (single-day, 7 plans end-to-end)
- Notable: context carried across all 7 plans without reset; memory system (feedback_layerchart_mobile_scroll.md, feedback_svelte5_tooltip_snippet.md) successfully prevented regressions from prior phases

---

## Milestone: v1.5 — Cold-Start Trim

**Shipped:** 2026-05-07
**Phases:** 1 (Phase 19) | **Plans:** 4 | **Sessions:** 1 (~1.5 hours)

### What Was Built

- `LazyMount.svelte` `loader` prop — 9 chart cards deferred via dynamic import; LayerChart/d3 off critical path
- `/api/item-counts` + `/api/benchmark` — SSR `Promise.all` 6→3 (exceeded target of 4)
- `messages.ts` 76 KB → 3.6 KB — 5 per-locale dict files with `loadDict()` switch-case for Vite static analysis
- NaN tooltip band rect fix in CalendarCounts/RevenueCard (caught in phase-final QA, not production)

### What Worked

- **Narrowly scoped milestone:** Three independent perf axes meant each plan was ~10–15 min, no cross-plan blocking, and no design uncertainty. The `loader` prop design was obvious from the existing `LazyMount` API surface.
- **Vite static analysis constraint discovered proactively:** Switch-case pattern in `loadDict()` (not template literal) was identified in plan research before any code was written — skipped a debug cycle.
- **`$effect` for `seedDict` in `+layout.svelte`:** Svelte 5's initial-capture warning on reactive side-effects was handled on first attempt with the correct primitive.
- **Phase-final QA surfaced a real bug:** NaN tooltip band rects were a pre-existing latent issue in CalendarCounts/RevenueCard — caught by QA in this phase rather than discovered in production.

### What Was Inefficient

- **19-02 changes lost in worktree merge overwrite** — the 19-02 deferred-fetch implementation was silently overwritten when the 19-03 executor worktree was merged; required a restoration commit (`5e648c8`). Cost: one extra commit + a re-verification round.
- **SC target said "6→4" but implementation delivered 6→3:** The spec was slightly off (both `item-counts` and `benchmark` were deferrable alongside an existing deferred endpoint). Not a problem, but shows the SC number wasn't traced to the actual query count.

### Patterns Established

- **`LazyMount loader` as the canonical deferral pattern:** For any Svelte component whose module tree includes LayerChart or large d3 transitive deps, `<LazyMount loader={() => import('./Card.svelte')}>` is now the standard — no more snippet-form `<LazyMount>` for chart cards.
- **`loadDict()` switch-case, not template literal:** Vite requires static string analysis to emit per-locale chunks. Template literals (`import(\`./dict/${locale}.ts\`)`) produce a single catch-all chunk, not 5 separate ones.
- **SSR hydration handshake:** `loadDict()` (server) → `getDict()` (serialize into page data) → `seedDict()` (client rehydrate) is the three-step pattern for any lazy-loaded shared state that needs server pre-seeding.

### Key Lessons

1. **Worktree merges need explicit verification of previously-deferred-plan outputs** — when merging a later-plan worktree onto a base branch, the earlier-plan changes must be explicitly checked, not assumed present.
2. **SC "Promise.all N→M" targets should be derived from an actual query-count audit** — don't guess the final number; count the queries in `+page.server.ts` before writing the SC.
3. **`messages.en` compatibility shim is now blocking cleanup:** 3 test files import `messages.en` directly. Each milestone that adds more test files using the old import pattern makes cleanup harder. Should be resolved in v1.6 early.

### Cost Observations

- Model mix: primarily Sonnet 4.6
- Sessions: 1 (~1.5 hours for 4 plans, branch, and milestone archive)
- Notable: pure-perf milestone with no UX changes — no Chrome MCP verification round needed; build-output inspection + unit tests were the verification path

---

## Cross-Milestone Trends

| Metric | v1.0 | v1.1 | v1.2 | v1.3 | v1.4 | v1.5 |
|--------|------|------|------|------|------|------|
| Phases | 5 | 2 | 4 | 9 | 1 | 1 |
| Plans | 29 | 9 | 17 | 47 | 7 | 4 |
| Days | ~2 | ~1 | ~3 | ~9 | 1 | <1 |
| PRs | 1 | 1 | 1 | 6 | 1 | TBD |
| TDD adoption | partial | partial | growing | consistent | full | full |

**Trend:** Performance-only milestones with no UX changes are the fastest to execute — no Chrome MCP verification round, no friend-persona acceptance cycle. Pure perf work verifiable by build output + unit tests alone. Worktree merge discipline needs a checklist: always verify earlier-plan outputs after merging a later worktree.
