# Phase 18 Plan Check

**Verdict:** PASS_WITH_NOTES
**Confidence:** 85
**Checked:** 2026-05-07

The 7 plans cover all 6 ROADMAP success criteria, both locked CONTEXT.md decisions are honored, and both open decisions (A and B) are explicitly resolved with rationale. Plan-level quality is high: atomic commits per task, automated verify on every implementation task, clean dep ordering, comprehensive test coverage at 4 layers (Python unit, API endpoint, Svelte component, RLS view). Localhost-first QA gates at Plans 04/05/06 enforce `.claude/CLAUDE.md`'s frontend-first rule. Migration push to DEV on the feature branch via `migrations.yml` honors the `feedback_migrations_workflow_dispatch.md` memory.

Notes (none rise to BLOCKER): a pinning ambiguity in Plan 02 around the `today` variable name; a small drift between Plan 02 must_haves (`ci_meaningful_at_n7`) and its action list (substituted `naive_dow_uplift_eur_is_none`); a Plan 06 inaccuracy about ModelAvailabilityDisclosure's actual data source (it takes props, not a payload row — but the compatibility check still works); and Plan 04's `divergence-warning` handling on per-week reads is left as Claude's Discretion ambiguity.

## Success-criteria coverage (6 ROADMAP criteria)

| # | Criterion (1 line) | Plan(s) | Status |
|---|---|---|---|
| 1 | Pipeline writes one `iso_week` row per (campaign × model × completed-week × as_of_date) with bootstrap re-fit on 7-day slice; partial launch + in-progress weeks excluded | 18-01, 18-02 | Covered |
| 2 | `/api/campaign-uplift` returns `weekly_history` array with shape `{iso_week_start, iso_week_end, point_eur, ci_*, n_days, model_name}`; tenant-isolated | 18-01 (view), 18-03 (payload) | Covered |
| 3 | Hero replaces "Since April 14th" with "Week of [Mon] – [Sun]"; UPL-06 maturity × CI matrix logic reused | 18-04 (hero rewrite + Decision A), 18-06 (i18n key wiring) | Covered |
| 4 | Bar chart with LayerChart, CI whiskers, color coding (gray/green/red), tap-to-scrub, dashed y=0 baseline | 18-05 (Decision B implementation + verification) | Covered |
| 5 | ModelAvailabilityDisclosure / regime-tier copy continues to work; per-week reads always n_days=7 | 18-04 (n_days source swap to weeks-since-launch), 18-06 Task 2 (regression check) | Covered |
| 6 | Mobile-first: 375×667 phone canvas; horizontal-scroll affordance; `touchEvents: 'auto'` preserves vertical page scroll | 18-05 Task 2 (375×667 + adversarial scroll-while-touching test), 18-07 Round F | Covered |

All 6 criteria have at least one explicit covering task. UPL-08 (pipeline + CI re-fit) is covered by 18-01..18-03. UPL-09 (dashboard hero + bar chart UI) is covered by 18-04..18-06.

## Locked-decision coverage (CONTEXT.md)

| Locked decision | Plan(s) | Status | Reference |
|---|---|---|---|
| Bootstrap CI re-fit per ISO week — NEVER subtracted from per-day cumulative bounds | 18-02 | Covered (must_have truth #4 + docstring requirement; explicitly forbids subtraction; cross-cutting rule #8 in PATTERNS reiterated) | 18-02 must_haves line 20; CONTEXT.md line 28 |
| ISO Mon–Sun week boundaries via `date.isocalendar()` (Mon=1..Sun=7) | 18-02 (Python), 18-03 (API: `subDays(parseISO(asof), 6)`) | Covered (matches `naive_dow_fit.py:66-67` precedent) | RESEARCH §2; CONTEXT.md line 27 |
| Skip in-progress trailing week + skip partial launch leading week | 18-02 | Covered (test_skip_partial_launch_week + test_skip_in_progress_current_week — the contract is encoded as 2 of the 7 unit tests) | CONTEXT.md lines 29-30 |
| Hero REPLACES "Since April 14th" — not added alongside | 18-04 | Covered (Plan rewrites hero entirely; existing top-level fields preserved at API only for future-cleanup back-compat) | CONTEXT.md "this phase does NOT deliver" line 14; Plan 04 must_have truth #2 |
| Bar chart with CI whiskers, color-coded by significance, tap-to-scrub | 18-05 | Covered (Decision B Option B PRIMARY with Option C fallback; CI whiskers via per-row `<Rule>`; gray/emerald/rose mapped from CI band sign; `onbarclick` updates `selectedWeekIndex`) | CONTEXT.md UI lines 53-60 |
| LayerChart `touchEvents: 'auto'` and `Tooltip.Root` snippet-children form preserved | 18-04, 18-05, 18-06 | Covered (preserved as test contract via `tooltip_snippet_contract` and `touch_events_contract` source-text tests; Plan 05 §interfaces reiterates the rule) | feedback_layerchart_mobile_scroll.md, feedback_svelte5_tooltip_snippet.md |
| Localhost-first frontend QA per `.claude/CLAUDE.md` Stop hook | 18-04 Task 2, 18-05 Task 2, 18-06 Task 3 | Covered (3 explicit `checkpoint:human-verify` blocking gates with Playwright MCP recipes) | .claude/CLAUDE.md frontend rule |
| `as_of_date` = the Sunday of the ISO week (stable across runs, idempotent upsert) | 18-01 (CHECK + view body comment), 18-02 (helper writes `target_dates[idxs[-1]].isoformat()`), 18-03 (API derives Mon = Sun − 6) | Covered (explicitly tested via `test_as_of_date_is_sunday_of_iso_week`) | CONTEXT.md line 27 |

## Open-decision resolution (A and B)

### Decision A — maturity tier source

**Resolution:** Plan 04 picks **Option (a) — chronological weeks since campaign launch**, with rationale documented in 3 places:

1. Plan 04 `must_haves.truths` line 19: `"DECISION A LOCKED: maturityTier sourced from (today − campaign.start_date) / 7 ... Rejected option (b) drop-tiering chosen against because the existing 7-key i18n set is cheap to keep and offers richer copy variation."`
2. Plan 04 `<objective>` lines 49-53 — explicit acceptance/rejection narrative.
3. Plan 04 Task 1 Action step 4 — in-code comment requirement: `// Decision A (Plan 18-04 LOCKED): maturity tier sourced from chronological weeks since campaign launch — NOT from headline.week.n_days, which is always 7 for completed weeks. Rejected option (b) drop-tiering because the existing 7-key i18n set provides richer copy variation in the first 1-2 weeks.`

Threshold consistency: existing `n_days < 14 → early`, `< 28 → midweeks` translates to `weeksSinceLaunch < 2 → early`, `< 4 → midweeks`, `≥ 4 → mature`. Plan 04 picks exactly these — **consistent**.

**Application across plans:** The decision touches Plan 04 (hero) and Plan 06 (i18n key wiring uses the resolved tier) only. Plan 05 (bar chart) does not need to know about the tier. ModelAvailabilityDisclosure (Plan 06 Task 2) takes `availableModels`/`grain`/`backtestStatus` props that are unrelated to per-week n_days, so it is unaffected — the Plan 06 description is slightly imprecise about "headline.row.n_days" but the compatibility check still validates the right thing.

**Verification:** Plan 04 Task 1 includes a dedicated test `Decision A — maturity tier reads from weeks-since-launch, not n_days` (Action step 7c). It feeds `campaigns[0].start_date = today − 21 days` and asserts heroKey resolves to `uplift_hero_early_added` / `uplift_hero_early_reduced`, NOT `uplift_hero_too_early` and NOT `uplift_hero_mature_added`. Adequate.

### Decision B — LayerChart per-bar conditional fill

**Resolution:** Plan 05 picks Option B (three filtered `<Bars>` blocks per color class) as **PRIMARY**, with Option C (manual `<rect>` via `chartCtx`) as **FALLBACK**. The plan also allows a runtime upgrade to Option A (snippet override) if a Context7 query at execution time reveals a stable API name.

**Verification step that flips to fallback is explicit and testable:**
- Plan 05 Task 2 step 3a: "Decision B alignment check: Are the bars centered on their x-band positions, OR are some bars offset (a sign Option B's per-Bars-block band scale is computing independently)? If misaligned → fall back to Option C (Action step below)."
- Plan 05 Task 2 step 4: explicit fallback procedure (replace 3 `<Bars>` blocks with `{#each weeklyHistory as wk, i} <rect>` loop using `chartCtx.xScale.bandwidth()`); re-run unit tests; re-verify localhost.
- The mandatory Context7 pre-flight in Plan 05 Task 1 Action step 1 (`npx --yes ctx7@latest docs /techniq/layerchart "Bars onbarclick render snippet per-bar fill"`) gives the executor a chance to upgrade primary to Option A before write.

The verification is a human-verify checkpoint with PASS/FAIL/PARTIAL gating — testable via the visual "are the bars centered" check.

## Plan-level quality findings

### Atomic commits — PASS

Each plan produces 1–3 logical commits, each task scoped to one file family. Plan 01 commits the migration; Plan 02 commits the pipeline + tests; Plan 03 commits the API + tests; Plans 04/05/06 each commit one Svelte rewrite slice; Plan 07 commits planning-docs sync. No bundled commits.

### Verification step on every task — PASS

Every `auto` task has an `<automated>` verify command. Every `checkpoint:human-verify` task has explicit Playwright MCP commands + verify gates. The validate-planning-docs.sh check is the gate for Plan 07.

### Wave / dependency structure — PASS

```
Wave 1: 18-01 (no deps)
Wave 2: 18-02 (depends on 18-01)
Wave 3: 18-03 (depends on 18-01, 18-02)
Wave 4: 18-04 (depends on 18-03)
Wave 5: 18-05 (depends on 18-04)
Wave 6: 18-06 (depends on 18-04, 18-05)
Wave 7: 18-07 (depends on 18-01..06)
```

Linear chain by design (one feature, no parallel tracks). No cycles, no forward references. Plan 02's depends_on of `["18-01"]` is correct: pipeline writes need the CHECK constraint live on LOCAL Supabase. Plan 03's `["18-01", "18-02"]` is correct: API needs the view AND data to make the smoke meaningful. Plans 05 and 06 sharing `18-04` means they must run sequentially since both modify the same `.svelte` file — confirmed in 18-05 `depends_on: ["18-04"]` and 18-06 `depends_on: ["18-04", "18-05"]`.

### Test coverage — PASS

| Layer | Tests | Plan |
|---|---|---|
| Python pipeline (bootstrap helper) | 7 unit tests + 1 integration | 18-02 |
| API endpoint (weekly_history payload) | 4 new test cases | 18-03 |
| Svelte component (hero) | 4 new test cases (covering Decision A) | 18-04 |
| Svelte component (bar chart) | 4 new test cases (covering Decision B) | 18-05 |
| Svelte component (i18n + ModelAvailabilityDisclosure compat) | 1 new test case | 18-06 |
| RLS / view (suggested in PATTERNS §8d, NOT planned) | 0 | — |

**Note:** PATTERNS §8d explicitly recommends adding `tests/forecast/test_campaign_uplift_weekly_v.py` to verify RLS isolation on the new view (test_view_returns_iso_week_rows / test_view_rls_anon_zero / test_view_rls_cross_tenant / test_window_kinds_constrained_includes_iso_week). **None of the 7 plans pick this up.** This is a gap — but not a BLOCKER, because the new view literally clones `campaign_uplift_daily_v` line-for-line (only the `WHERE` clause changes), and `tests/forecast/test_campaign_uplift_v.py` already covers the parent table's RLS pattern. The unique-to-this-phase risk is the CHECK constraint extension — tested transitively via Plan 02's pipeline writing iso_week rows, which would fail if the CHECK rejected them.

### Migration on feature branch via `gh workflow run migrations.yml --ref ...` — PASS

Plan 01 Task 2 explicitly: `gh workflow run migrations.yml --ref feature/phase-18-weekly-counterfactual-window`, with `gh run list --workflow=migrations.yml --limit 1` verification. References `feedback_migrations_workflow_dispatch.md` memory in the rationale. This eliminates the "DEV /api/* 500 right after migration phase" trap memorized as a footgun.

### Plan 07 runs validate-planning-docs.sh — PASS

Plan 07 Task 2 Action step 4: `Run .claude/scripts/validate-planning-docs.sh. Confirm exit 0.` The verify block runs `bash .claude/scripts/validate-planning-docs.sh && echo "VALIDATOR PASS"`. Final sign-off Task 3 re-runs it. Adequate.

### No `Co-authored-by: Claude` in any commit message — PASS

Searched all 7 plans + CONTEXT.md + PATTERNS.md for the forbidden string. Two mentions found:
- 18-CONTEXT.md line 118: project-rules reference, not a commit message.
- 18-PATTERNS.md line 614: rule statement, not a commit message.

No plan template emits a `Co-authored-by:` line. All commit-message templates in Plans 01/03/05/07 are clean (e.g., `"feat(18-03): /api/campaign-uplift returns weekly_history sister to daily (UPL-08)"` — single-line, no co-author footer).

### Minor drifts (WARNING-level)

1. **Plan 02 `must_haves` lists `ci_meaningful_at_n7` test name; Action lists `naive_dow_uplift_eur_is_none` instead.** The 7th test was substituted between must_haves drafting and action drafting. Both are reasonable tests. The `ci_meaningful_at_n7` test (RESEARCH §6 line 472 mentions it) provides valuable coverage of "bootstrap is meaningful at N=7" — could be added as an 8th test. Not a blocker.

2. **Plan 02 `<existing_today_var>` is left as a TBD placeholder.** Action step 2 says "Replace `<existing_today_var>` with the actual variable name in scope (probe the surrounding code...)." The actual variable is `run_date` (visible at `cumulative_uplift.py:562, 638`). The plan says "common patterns: `date.today()` if no TZ work needed" — but `_process_campaign_model` already takes `run_date: date` as a parameter (the canonical pipeline cutoff). This is a small ambiguity the executor must resolve. Not a blocker because the plan instructs the executor to probe the surrounding code, but specifying `run_date` directly would have been cleaner.

3. **Plan 06 Task 2 description of ModelAvailabilityDisclosure is imprecise.** Says "Reads `headline?.row?.n_days` from the campaigns block, NOT from weekly_history." Reality (from `ModelAvailabilityDisclosure.svelte`): the component takes `availableModels`, `grain`, `backtestStatus` as props. It never reads any payload row directly. The compatibility check still works — what the plan actually verifies is that the component renders correctly under the new card structure — but the rationale in the plan misstates the reason it works. Minor doc-quality nit.

4. **No RLS test for the new `campaign_uplift_weekly_v` view.** PATTERNS §8d recommends it; Plan 01 (the migration plan) and Plan 02 (the writer plan) don't include it. Risk is low (view body cloned from `_daily_v`), but adding 4 trivial tests would close the gap. Could be a follow-up commit.

5. **Plan 04's `divergence-warning` derived-state handling on per-week reads is half-decided.** Action step 4 offers two paths ("guard derivation to fall back to null OR disable the divergence warning entirely on per-week reads") and labels it as Claude's Discretion. The 18-04-SUMMARY template asks the executor to record the choice. Not a blocker because the test fixtures exist and either path is verifiable, but it leaves a Hamlet moment for the executor.

6. **Plan 06 Task 1 X-axis-label wiring depends on a runtime Context7 verification.** Says "Verify the API at execution time via Context7 — `npx ctx7 docs /techniq/layerchart 'Axis label placement bottom'`" with a fallback to manual `<text>` SVG. Acceptable since both paths are documented; the executor must pick one based on the API check.

## Goal-backward analysis

Walking through the user-facing outcomes after a verbatim execution of all 7 plans:

1. **"Week of Apr 27 – May 3" replaces "Since April 14th" as the CampaignUpliftCard hero**
   - Plan 04 Task 1 Action 5 wires the new date label via `formatHeadlineWeekRange` + `data-testid="uplift-week-headline-range"`.
   - Plan 06 Task 1 Action 3 swaps the inline fallback to the `t(locale, 'uplift_week_label', {...})` call once the i18n key lands.
   - The old "Since April 14th" string is removed, not preserved alongside.
   - **Will work.**

2. **Bar chart of all completed ISO weeks since campaign launch with CI whiskers + color coding**
   - Plan 02 writes one row per completed ISO week (skipping partial launch + in-progress).
   - Plan 03 surfaces them via `weekly_history` ordered by `as_of_date` ascending.
   - Plan 05 renders them as `<Bars>` (gray/green/red) + per-row `<Rule>` whiskers + `<Rule y={0}>` baseline.
   - Color logic: `ci_lower > 0 → emerald-500`, `ci_upper < 0 → rose-500`, else `zinc-400`. Matches CONTEXT.md line 54-57.
   - **Will work** — provided Decision B's Option B alignment passes the localhost visual check; if not, the documented Option C fallback also produces correct output.

3. **Tap a bar to scrub the hero to that week**
   - Plan 04 declares `selectedWeekIndex = $state<number | null>(null)`.
   - Plan 04 `headline = $derived.by(...)` reads `selectedWeekIndex` to pick which week populates the hero.
   - Plan 05 implements `handleBarClick` and wires `onbarclick={handleBarClick}` on each `<Bars>` block (or `onclick` on each `<rect>` in fallback).
   - Plan 05 Task 1 Action 5 includes `tap_to_scrub` test: simulate click on the first bar, assert hero text changes.
   - **Will work** — the wiring is end-to-end.

4. **API + DB persistence + nightly pipeline behind it**
   - Plan 01: migration 0069 (CHECK + view) applied to LOCAL + DEV via `gh workflow run migrations.yml`.
   - Plan 02: pipeline writes iso_week rows on every nightly `forecast-refresh.yml` run; backfill happens automatically because the helper iterates the full cumulative window.
   - Plan 03: API surfaces them via 3rd `Promise.all` branch + `weekly_history` field.
   - Plan 07 Round A confirms schema + pipeline rows on DEV; Round B confirms `/api/campaign-uplift` returns non-empty array.
   - **Will work.**

5. **Works on a 375×667 phone**
   - Chart wrapper preserves `style:width="280px"` + `style:height="100px"` + `class="chart-touch-safe"`.
   - `tooltipContext.touchEvents: 'auto'` preserved (Plan 05 must_have truth #9; Plan 04 unchanged from existing).
   - `Tooltip.Root` snippet-children form preserved (memorized in `feedback_svelte5_tooltip_snippet.md`).
   - Plan 05 Task 2 Step 3e includes the adversarial check: scroll vertically while finger over chart; page MUST scroll.
   - Plan 07 Round F re-verifies on DEV.
   - **Will work** — assuming Plan 05 Task 2's localhost QA confirms the bar layout doesn't overflow at 280px width with the friend's ~3-week history.

6. **Empty-states correctly when the campaign launched < 1 ISO week ago**
   - Plan 04 `headline` derivation returns `null` when `weekly_history.length === 0`.
   - Plan 04 Task 1 Action 6 explicitly preserves the empty-state path: render the existing `uplift_hero_too_early` heroKey block.
   - Plan 05 Task 1 Action 4 wraps the entire chart block in `{#if weeklyHistory.length > 0}` — chart not rendered when empty.
   - Plan 04 Task 1 Action 7 includes a dedicated test: `empty weekly_history → uplift_hero_too_early`.
   - **Will work.**

All 6 user-facing outcomes have explicit covering tasks + verification. End-to-end execution will produce the working system.

## Issues to fix (if any)

| Severity | Plan | Issue | Suggested fix |
|---|---|---|---|
| WARNING | 18-02 | Action step 2 leaves `<existing_today_var>` as a TBD placeholder; the actual variable name is `run_date` (visible at `cumulative_uplift.py:562, 638` as a parameter to `_process_campaign_model`) | Replace `<existing_today_var>` with `run_date` directly in the plan; add a one-line note: "the existing pipeline cutoff variable in scope is `run_date`, passed as a parameter to `_process_campaign_model`" |
| WARNING | 18-02 | `must_haves.truths` line 25 lists `ci_meaningful_at_n7` test, but Action lists `naive_dow_uplift_eur_is_none` instead — drift between contract and implementation | Either add `ci_meaningful_at_n7` as an 8th test (RESEARCH §6 line 472 explicitly recommends it for N=7 sanity), or update must_haves to drop it and use the substituted name |
| WARNING | 18-06 | Task 2 description says ModelAvailabilityDisclosure "reads `headline?.row?.n_days`" — incorrect; the component takes `availableModels`/`grain`/`backtestStatus` props directly. The compatibility check still works, but the rationale is misstated | Update Task 2 read_first + behavior block: "ModelAvailabilityDisclosure receives `availableModels`/`grain`/`backtestStatus` as props (verified at the file's `let { ... } = $props()` declaration); it does not read directly from any payload row. The compatibility check therefore confirms the parent (CampaignUpliftCard) still passes the same props correctly post-rewrite" |
| WARNING | 18-01, 18-02 | No RLS isolation test for `campaign_uplift_weekly_v` (PATTERNS §8d recommends 4 tests at `tests/forecast/test_campaign_uplift_weekly_v.py`); risk is low because the view clones `_daily_v` line-for-line, but the gap exists | Add a small task to Plan 02 (or a 7-line addendum to Plan 01): create `tests/forecast/test_campaign_uplift_weekly_v.py` mirroring `test_campaign_uplift_v.py` lines 1-110 — 4 tests: tenant returns rows, anon zero rows, cross-tenant zero, CHECK accepts iso_week / rejects iso_weekly typo |
| INFO | 18-04 | `divergence-warning` handling on per-week reads is left as Claude's Discretion ("guard fallback OR disable entirely") — adequate but introduces a small Hamlet moment for the executor | Lock the choice: "disable divergence-warning on per-week reads; cumulative window naive_dow cross-check is preserved by the still-written `cumulative_since_launch` row but not surfaced on per-week hero" — saves the executor 5 minutes |
| INFO | 18-05 | Per-bar fill API (Decision B Option A snippet override) is gated on a runtime Context7 query; the plan correctly defers this but the executor needs to allocate ~10 min for the verification | None required — plan handles this correctly with the fallback chain |
| INFO | 18-06 | X-axis label wiring also depends on a Context7 query at execution time (`Axis label placement bottom`); both paths documented | None required — plan handles this correctly |

**No BLOCKERs identified.** All issues are WARNING or INFO level — they degrade quality marginally but do not prevent the phase goal from being achieved.

