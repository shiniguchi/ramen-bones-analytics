---
phase: 16-its-uplift-attribution
verified: 2026-05-03T22:55:00Z
status: human_needed
score: 6/6 must-haves verified (final UI gate pending DEV preview)
re_verification: false
human_verification:
  - test: "CampaignUpliftCard renders at 375×667 on DEV preview"
    expected: "Hero shows 'Cumulative uplift: −€1,008' OR 'CI overlaps zero — no detectable lift' (95% CI straddles zero per cutoff_sensitivity.md, expect the latter); 280×100 sparkline + low-opacity CI band visible; tap-to-pin tooltip shows day-N + CI range; 11px anticipation-buffer note at the bottom; no console errors."
    why_human: "Localhost-first IntersectionObserver under Chrome MCP headless tab is unreliable — Plan 09 documented all 6 LazyMount slots stay in skeleton state. Real Supabase auth + a real interactive browser are required to drive the IO callback that mounts the card. Documented post-push gate per Plan 09 SUMMARY 'Visual verification — PARTIAL' and Plan 10 'visual: PARTIAL' notes."
  - test: "EventMarker red 3px campaign-start line overlays RevenueForecastCard + InvoiceCountForecastCard at 2026-04-14 on DEV"
    expected: "Red vertical line at the 2026-04-14 x-coordinate visible on both forecast cards' chart layers; clamped to overlap rules from forecastEventClamp.ts (campaign_start has priority 5, top of stack)."
    why_human: "Same Chrome-MCP IntersectionObserver gate as Plan 09; Plan 10 explicitly defers final visual smoke to DEV preview. The Playwright spec at tests/e2e/forecast-event-markers.spec.ts is in place but ran under DEV happy-path mode."
overrides: []
---

# Phase 16: ITS Uplift Attribution — Verification Report

**Phase Goal:** Friend-owner sees a single dedicated card on the dashboard answering "did the 2026-04-14 campaign work?" via Track-B counterfactual fit on pre-campaign era only, with cumulative `actual − Track-B` per campaign window, 95% Monte Carlo CIs, and honest "CI overlaps zero — no detectable lift" labeling when warranted.

**Verified:** 2026-05-03T22:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                                          | Status     | Evidence                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `campaign_calendar` records start/end/name/channel/notes; tenant-scoped via `auth.jwt()->>'restaurant_id'`; service_role writes; 2026-04-14 friend-owner campaign seeded as first row                                          | ✓ VERIFIED | `supabase/migrations/0058_campaign_calendar.sql` lines 16-51 — table schema, RLS policy, REVOKE writes from authenticated/anon, idempotent INSERT for `friend-owner-2026-04-14` row                                                                                                |
| 2   | Track-B fits on pre-campaign data only; `TRAIN_END = campaign_start − 7d`; `pipeline_runs.fit_train_end` audit; CI test asserts no leak; sensitivity log at 5×3 grid (5 models × {-14,-7,-1}d)                                  | ✓ VERIFIED | `0063_pipeline_runs_fit_train_end.sql` adds audit column; `scripts/forecast/counterfactual_fit.py:45-75` computes `train_end = earliest + offset` (default -7d, C-04); `tests/forecast/cutoff_sensitivity.md` 5×3 grid with sarimax 1.139 PASS + prophet 0.890 PASS in [0.8, 1.25] band; `check_cutoff_sensitivity.sh` validator runs clean |
| 3   | `revenue_comparable_eur` excludes coincidentally launched menu items; Track-B fits on this baseline-comparable revenue only (CI grep guard forbids regression)                                                                  | ✓ VERIFIED | `0059_baseline_items_v.sql` (items first seen ≥7d before campaign), `0060_kpi_daily_with_comparable_v.sql` (extends kpi_daily_mv), `counterfactual_fit.py:39` (`CF_KPIS = ['revenue_comparable_eur', 'invoice_count']`); Guard 9 grep + DB CHECK constraint `forecast_daily_cf_not_raw_revenue` (0064 line 158); test_guard_9.sh PASS |
| 4   | `campaign_uplift_v` exposes per-campaign `Σ(actual − Track-B)` with 95% MC CI from 1000 sample paths AND `naive_dow_uplift_eur` cross-check column; cumulative-since-launch as running total per (campaign, model)              | ✓ VERIFIED | `0064_campaign_uplift_v.sql` Part A (backing table with `cumulative_uplift_eur, ci_lower_eur, ci_upper_eur, naive_dow_uplift_eur, n_days, as_of_date`) + Part B1 (`campaign_uplift_v` headline view, DISTINCT ON dedup by latest as_of_date) + Part B2 (`campaign_uplift_daily_v` per-day sparkline); `cumulative_uplift.py:64,166,353` `bootstrap_uplift_ci(..., n_resamples=1000)`; `compute_naive_dow_uplift` cross-check at line 368; window_kinds `campaign_window` + `cumulative_since_launch` |
| 5   | `CampaignUpliftCard.svelte` renders at 375px; "CI overlaps zero — no detectable lift" copy when CI includes 0; never single-point estimate without CI; tap-to-pin tooltip explains 7d anticipation buffer                       | ✓ VERIFIED (code) / ⚠ PARTIAL (visual) | `src/lib/components/CampaignUpliftCard.svelte` 249 lines — Tooltip.Root snippet form (line 219), `ciOverlapsZero` derived (94-99), exact "CI overlaps zero — no detectable lift" string (181), dim point-estimate w/ CI fallback (183-186), 280×100px chart (197), `touchEvents: 'auto'` (205), anticipation-buffer note (245-247), slotted on `+page.svelte:294`. Visual gate at DEV preview pending — human verification needed (see Plan 09 SUMMARY "Visual — PARTIAL") |
| 6   | `cumulative_uplift.py` runs nightly after Track-B; quarterly off-week reminder fires from `feature_flags` on 2026-10-15; `EventMarker.svelte` overlays campaign-start markers on RevenueForecastCard from Phase 15            | ✓ VERIFIED | `.github/workflows/forecast-refresh.yml` lines 65-91 cascade: `run_all` (BAU+CF default --track=both) → `cumulative_uplift` → `refresh_forecast_mvs`; `0061_feature_flags.sql` seeds `(restaurant_id, 'offweek_reminder', false, '2026-10-15')`; `cumulative_uplift.py:413-447` atomic UPDATE on `feature_flags WHERE flag_key='offweek_reminder' AND remind_on_or_after_date <= current_date`; `EventMarker.svelte:62-64` campaign_start type, wired in RevenueForecastCard:174 + InvoiceCountForecastCard:174; `/api/forecast/+server.ts:90,143,184` 5th events source `campaignRows` from `campaign_calendar` |

**Score:** 6/6 truths verified (5 fully; 1 code-verified, visual-PARTIAL — see human_verification)

### Required Artifacts

| Artifact                                                  | Expected                                                            | Status     | Details                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/0058_campaign_calendar.sql`          | table + RLS + 2026-04-14 seed                                       | ✓ VERIFIED | 51 lines, `auth.jwt()->>'restaurant_id'` policy, REVOKE writes, idempotent seed                                                                  |
| `supabase/migrations/0059_baseline_items_v.sql`           | view: items first seen ≥7d before campaign                          | ✓ VERIFIED | 70 lines; CTE `first_seen` + INNER JOIN `min_campaign`; 7-day buffer matches C-04                                                              |
| `supabase/migrations/0060_kpi_daily_with_comparable_v.sql` | wrapper view extending `kpi_daily_mv` with `revenue_comparable_eur` | ✓ VERIFIED | 85 lines; INNER JOIN baseline_items_v on item_name; LEFT JOIN with COALESCE for missing dates                                                    |
| `supabase/migrations/0061_feature_flags.sql`              | table + seed `offweek_reminder` 2026-10-15                          | ✓ VERIFIED | 58 lines; (restaurant_id, flag_key) PK; idempotent seed; ON CONFLICT DO NOTHING                                                                  |
| `supabase/migrations/0063_pipeline_runs_fit_train_end.sql` | ALTER TABLE add `fit_train_end date`                                | ✓ VERIFIED | 24 lines; ADD COLUMN IF NOT EXISTS for idempotence                                                                                              |
| `supabase/migrations/0064_campaign_uplift_v.sql`          | backing table + 2 wrapper views + DB CHECK constraint               | ✓ VERIFIED | 163 lines; Part A backing table; Part B1 `campaign_uplift_v` (DISTINCT ON); Part B2 `campaign_uplift_daily_v` (per-day); Part C CHECK constraint forbids (`cf` + `revenue_eur`) |
| `supabase/migrations/0065_comparable_views_service_role_bypass.sql` | Wave-4 hotfix: relax JWT filter for service_role reads on 4 views    | ✓ VERIFIED | 264 lines; recreates forecast_with_actual_v, baseline_items_v, kpi_daily_with_comparable_v, campaign_uplift_v, campaign_uplift_daily_v with `(jwt IS NULL) OR ...` shape   |
| `supabase/migrations/0066_forecast_with_actual_v_comparable.sql` | Wave-4 hotfix: extend forecast_with_actual_v CASE for `revenue_comparable_eur` actuals | ✓ VERIFIED | 57 lines; LEFT JOIN kpi_daily_with_comparable_v + new CASE branch                                                                              |
| `scripts/forecast/counterfactual_fit.py`                  | Track-B orchestrator; --train-end-offset; pipeline_runs writes      | ✓ VERIFIED | 255 lines; `main_cf` + per-model resilient try/except + `write_success(fit_train_end=train_end)` + `assert kpi_name != 'revenue_eur'` enforced upstream by Guard 9 + DB CHECK |
| `scripts/forecast/cumulative_uplift.py`                   | bootstrap CI + naive_dow cross-check + offweek-reminder atomic UPDATE | ✓ VERIFIED | 738 lines; `bootstrap_uplift_ci(..., n_resamples=1000)` (line 64+); naive_dow cross-check (line 368); `check_offweek_reminder` (line 422); `started_at` probe (Plan 12 fix line 495-517) |
| `scripts/forecast/run_all.py`                             | --track={bau,cf,both} flag (default both)                           | ✓ VERIFIED | 353 lines; `--track` argparse arg (line 324-327); pass-through to `counterfactual_fit.main_cf` when track in ('cf','both') (line 266-267)         |
| `scripts/forecast/{sarimax,prophet,ets,theta,naive_dow}_fit.py` | each accepts `track='cf'`, `train_end`; reads from `kpi_daily_with_comparable_v` for CF | ✓ VERIFIED | sarimax_fit.py:264 `track='bau'/'cf'` param; line 279-289 CF branch sources from `_load_comparable_history`; CF anchors `pred_dates` on `train_end` (line 326, Plan 12 fix); other 4 models follow same shape |
| `src/lib/components/CampaignUpliftCard.svelte`            | hero + sparkline + honest CI label + 7d anticipation tooltip         | ✓ VERIFIED | 249 lines; lazy-fetches /api/campaign-uplift; `ciOverlapsZero` rule; exact "CI overlaps zero — no detectable lift" string; Tooltip.Root snippet form; touchEvents:'auto' |
| `src/lib/components/EventMarker.svelte`                   | campaign_start red 3px line carries from Phase 15                   | ✓ VERIFIED | 114 lines; existing component, lines 62-64 render campaign_start vertical line; clamped via forecastEventClamp.ts priority 5                  |
| `src/routes/api/campaign-uplift/+server.ts`               | extended payload (ci_lower/upper, naive_dow, daily[], campaigns[])  | ✓ VERIFIED | 156 lines; reads campaign_uplift_v + campaign_uplift_daily_v; Phase 15 D-08 back-compat fields preserved (`campaign_start`, `cumulative_deviation_eur`); T-16-04 leak check (no raw paths in response) |
| `src/routes/api/forecast/+server.ts`                      | 5th event source `campaign_calendar` → `campaign_start` events      | ✓ VERIFIED | line 90-94 Promise.all includes `campaignRows`; line 143 query; line 184 mapping `{ type: 'campaign_start', date, label }`                       |
| `src/routes/+page.svelte`                                 | CampaignUpliftCard slotted between InvoiceCountForecastCard + KPI tiles, wrapped in LazyMount | ✓ VERIFIED | line 23 import; line 289-296 LazyMount + CampaignUpliftCard slot at minHeight=180px                                                            |
| `tests/forecast/cutoff_sensitivity.md`                    | 5×3 grid (5 models × 3 cutoffs); ratio band [0.8, 1.25]              | ✓ VERIFIED | 50 lines; sarimax 1.139 PASS, prophet 0.890 PASS, ets FLAG (sign-flip), theta INFO (pre-existing Plan 05 bug — not Plan 12 regression), naive_dow 0.897 PASS |
| `tests/forecast/check_cutoff_sensitivity.sh`              | validator that sarimax+prophet ratios are in band                    | ✓ VERIFIED | Run output: `OK: sarimax ratio 1.139 in band [0.8, 1.25]` + `OK: prophet ratio 0.89 in band [0.8, 1.25]` + `PASS: cutoff_sensitivity.md well-formed` |
| `scripts/ci-guards.sh`                                    | Guard 9 + Guard 10 + DB CHECK fallback                               | ✓ VERIFIED | Guard 9 awk windowing forbids cf+revenue_eur co-occurrence; Guard 10 forbids 2026-04-14 in src/ (excluded files: e2eChartFixtures.ts; per-line `noqa: guard10`); both red-team fixtures + harnesses `test_guard_9.sh` and `test_guard_10.sh` PASS |
| `.github/workflows/forecast-refresh.yml`                  | cascade BAU+CF (run_all) → cumulative_uplift → MV refresh           | ✓ VERIFIED | 93 lines; `Run forecast pipeline` step (run_all default --track=both) → `Run cumulative uplift` step → `Refresh forecast MVs` RPC; cron `0 7 * * 1`; concurrency `forecast-refresh` |
| `.github/workflows/migrations.yml`                        | workflow_dispatch trigger for feature-branch DEV                    | ✓ VERIFIED | line 5 `workflow_dispatch:` present                                                                                                              |
| `tests/e2e/forecast-event-markers.spec.ts`                | Playwright spec for EventMarker campaign_start                       | ✓ VERIFIED | 132 lines; created by Plan 10                                                                                                                    |

### Key Link Verification

| From                                  | To                                            | Via                                                                  | Status   | Details                                                                                                            |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| CampaignUpliftCard.svelte             | /api/campaign-uplift                          | `clientFetch<Payload>('/api/campaign-uplift')` in `$effect`          | ✓ WIRED | line 67; sets `data` state on success; sparkline + headline render off `data.campaigns[0]` + `data.daily`         |
| /api/campaign-uplift                  | campaign_uplift_v + campaign_uplift_daily_v   | `locals.supabase.from('campaign_uplift_v').select(...)` + sister view | ✓ WIRED | lines 71-88; two parallel queries via `Promise.all` + `fetchAll` paginator                                         |
| campaign_uplift_v / _daily_v          | campaign_uplift backing table                 | INNER JOIN campaign_calendar; DISTINCT ON dedup                      | ✓ WIRED | 0064 Part B1 + B2 + 0065 service_role bypass relaxation                                                            |
| cumulative_uplift.py (write path)     | campaign_uplift backing table                 | service_role upsert per (campaign × model × window_kind × as_of)      | ✓ WIRED | confirmed end-to-end on DEV — 80 rows landed for friend-owner-2026-04-14 (Plan 13 smoke test, run 25292741916)     |
| cumulative_uplift.py (read path)      | forecast_with_actual_v + forecast_daily       | service_role queries (post-0065 + 0066 hotfix)                        | ✓ WIRED | actual_value flows for `kpi_name='revenue_comparable_eur'` via 0066 LEFT JOIN to kpi_daily_with_comparable_v        |
| counterfactual_fit.py                 | kpi_daily_with_comparable_v                   | per-model `_load_comparable_history`                                  | ✓ WIRED | sarimax_fit.py:106-135 reads `revenue_comparable_eur` capped at train_end                                          |
| run_all.py                            | counterfactual_fit.main_cf                    | `--track={bau,cf,both}` argparse → main_cf invocation                | ✓ WIRED | run_all.py:266-267                                                                                                  |
| forecast-refresh.yml                  | run_all + cumulative_uplift + refresh_forecast_mvs | sequential `run:` steps                                              | ✓ WIRED | lines 43-91; concurrency lock, env-isolated service_role per step                                                  |
| /api/forecast (events array)          | campaign_calendar                             | 5th source `campaignRows` mapped to `{ type: 'campaign_start', date, label }` | ✓ WIRED | lines 90, 143, 184                                                                                                 |
| EventMarker.svelte                    | RevenueForecastCard + InvoiceCountForecastCard | Slotted at `:174` in both forecast cards (existing Phase 15 wiring)   | ✓ WIRED | grep confirms imports + usage                                                                                       |
| CampaignUpliftCard slot               | +page.svelte                                  | LazyMount wrapper at line 292-296                                     | ✓ WIRED | minHeight=180px; positioned between InvoiceCountForecastCard + KPI tiles                                            |

### Data-Flow Trace (Level 4)

| Artifact                | Data Variable                | Source                                              | Produces Real Data | Status      |
| ----------------------- | ---------------------------- | --------------------------------------------------- | ------------------ | ----------- |
| CampaignUpliftCard.svelte | `data` ($state Payload)      | `/api/campaign-uplift` → campaign_uplift_v + _daily_v | YES (DEV-confirmed: 80 rows in backing table) | ✓ FLOWING |
| /api/campaign-uplift    | `rows`, `dailyRows`          | campaign_uplift_v + campaign_uplift_daily_v        | YES (post-0065 service_role bypass + post-0066 comparable CASE) | ✓ FLOWING |
| forecast-refresh cascade | campaign_uplift backing rows | `cumulative_uplift.py` upserts                       | YES (DEV smoke test 2026-05-03 wrote 80 rows for friend-owner-2026-04-14: 5 models × {campaign_window + cumulative_since_launch + 14 per_day}) | ✓ FLOWING |
| EventMarker overlay     | `events[]` (campaign_start)  | `/api/forecast` events array (from campaign_calendar) | YES                | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                      | Command                                              | Result                                                         | Status |
| --------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- | ------ |
| All CI guards (1-10) pass                     | `bash scripts/ci-guards.sh`                          | "All CI guards passed."                                        | ✓ PASS |
| Guard 9 catches red-team fixture              | `bash tests/ci-guards/test_guard_9.sh`               | "PASS: Guard 9 caught the red-team fixture"                    | ✓ PASS |
| Guard 10 catches red-team fixture             | `bash tests/ci-guards/test_guard_10.sh`              | "PASS: Guard 10 caught the red-team fixture"                   | ✓ PASS |
| Sensitivity validator green                   | `bash tests/forecast/check_cutoff_sensitivity.sh`    | "PASS: cutoff_sensitivity.md well-formed; sarimax+prophet ratios in [0.8, 1.25]" | ✓ PASS |
| Migration drift check clean                   | (in ci-guards.sh) `check-migration-drift`            | "local_max=0066 remote_max=0066 OK"                            | ✓ PASS |
| Planning-docs drift validator                 | `.claude/scripts/validate-planning-docs.sh`          | "✅ planning docs in sync"                                     | ✓ PASS |
| End-to-end forecast-refresh cascade smoke     | (Plan 13 GHA workflow_dispatch run 25292741916)       | "80 rows upserted" for friend-owner-2026-04-14 in 4m9s          | ✓ PASS |
| Phase 16 forecast unit tests                  | `python -m pytest tests/forecast/test_cumulative_uplift.py tests/forecast/test_counterfactual_fit.py` | 14 passed, 1 failed (`test_two_window_kinds_per_campaign_per_model` — mocked-router stale vs Plan 12 `started_at` probe; live DEV cascade produced both window kinds successfully) | ⚠ PARTIAL (mocked, not real) |

### Requirements Coverage

| Requirement | Source Plan(s)                | Description                                                                                       | Status     | Evidence                                                                                                       |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| UPL-01      | 16-01                         | campaign_calendar tenant-scoped + admin-only writes + 2026-04-14 seed                             | ✓ SATISFIED | Migration 0058 + RLS + REVOKE + idempotent INSERT for friend-owner-2026-04-14                                 |
| UPL-02      | 16-04, 16-05                  | Track-B fits on pre-campaign data only; pipeline_runs.fit_train_end audits + CI test no leak       | ✓ SATISFIED | Migration 0063; counterfactual_fit.py train_end logic; tests/forecast/test_counterfactual_fit.py asserts no campaign-era leak |
| UPL-03      | 16-02, 16-03, 16-05, 16-11    | revenue_comparable_eur derived; Track-B never fits raw revenue (CI guard + DB CHECK)              | ✓ SATISFIED | Migrations 0059 + 0060; Guard 9 (lint) + 0064 Part C `forecast_daily_cf_not_raw_revenue` CHECK constraint     |
| UPL-04      | 16-06, 16-07                  | per-window Σ(actual − Track-B) + 95% MC CI from 1000 paths + cumulative-since-launch running total  | ✓ SATISFIED | Migration 0064 + cumulative_uplift.py `bootstrap_uplift_ci(n_resamples=1000)` + DEV evidence: 80 rows, 5 models × 16 row-types |
| UPL-05      | 16-06, 16-07                  | naive_dow_uplift_eur cross-check column                                                           | ✓ SATISFIED | Column in 0064 Part A; populated via `compute_naive_dow_uplift` in cumulative_uplift.py:368-388                |
| UPL-06      | 16-09                         | CampaignUpliftCard renders cumulative uplift; "CI overlaps zero" labeling; never single-point w/o CI | ✓ SATISFIED (code) / ⚠ PARTIAL (visual) | CampaignUpliftCard.svelte:179-194 honest-label rule + dim point-estimate w/ CI fallback. Final visual gate at DEV preview pending. |
| UPL-07      | 16-04, 16-06, 16-13           | cumulative_uplift.py runs nightly after Track-B; offweek_reminder fires from feature_flags 2026-10-15 | ✓ SATISFIED | forecast-refresh.yml cascade BAU+CF → cumulative_uplift → MV refresh; 0061 seeds offweek_reminder; cumulative_uplift.py:413-447 atomic UPDATE |

**Orphaned requirements:** 0. All UPL-01..07 requirements claimed by ≥1 plan in this phase.

### Anti-Patterns Found

| File                           | Line(s) | Pattern                                                                | Severity | Impact                                                                                                                                                                                                                                                |
| ------------------------------ | ------- | ---------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests/forecast/test_cumulative_uplift.py | 309-409 | Mocked-router test `test_two_window_kinds_per_campaign_per_model` fails because the mock supplies `pipeline_runs.status='success'` but the post-Plan-12 production code probes `started_at` (Plan 12 hotfix at cumulative_uplift.py:495-517) | ℹ Info | Test-only failure. Production cascade verified end-to-end on DEV with 80 rows landed (Plan 13 smoke run 25292741916). The mock is stale relative to the Plan 12 fix; this is the same testability gap Plan 12 SUMMARY explicitly called out: "All three were untestable from Plan 03/05/06 internal tests (mocked DB clients); first end-to-end DEV exposure was Plan 12 sensitivity runs." Recommend follow-up to update the mock in a code-review hygiene plan. Does NOT block Phase 16 goal. |
| tests/forecast/cutoff_sensitivity.md | 23 | theta model row reads "FAIL — pre-existing Plan 05 bug" at all 3 cutoffs | ℹ Info | Plan 12 SUMMARY decision #3 explicitly classifies theta failure as a pre-existing Plan 05 hygiene bug, not a Plan 12 regression. Sensitivity validator passes anyway because the 2 headline-eligible models (sarimax + prophet) PASS the band. Goal achievement (SC#2) not affected — the sensitivity grid contract is met. |

No blocker or warning anti-patterns. Two informational items, both pre-documented and explicitly out-of-scope per Plan 12 decisions.

### Re-verification — N/A

Initial verification.

### Gaps Summary

No code gaps. All 6 ROADMAP success criteria, all 7 UPL requirements, all 8 migrations (0058-0066, intentional 0062 skip), all 23 expected artifacts, and the end-to-end forecast-refresh cascade are present and verified — including the Plan 13 DEV smoke test that produced 80 campaign_uplift rows for friend-owner-2026-04-14 in 4m9s.

The single blocker preventing automatic `passed` status is the **localhost-first UI gate** that Plans 09 + 10 explicitly deferred to DEV preview because the Chrome-MCP-controlled tab IntersectionObserver does not fire reliably under the headless visibility state, leaving every LazyMount slot in skeleton state during local QA. This is a tooling limitation, not a code defect — the component contract was verified via unit tests and console-clean fixture page-load. Final visual confirmation belongs on the CF Pages preview URL with a real sign-in session.

### Recommended Follow-ups (post-ship)

1. **Run gsd-code-review on Phase 16 before /gsd-ship.** Code review has not been run on this phase yet.
2. **Update mocked test `test_two_window_kinds_per_campaign_per_model`** to pass `started_at` in the mocked `pipeline_runs` row so it matches the Plan 12 production probe.
3. **Plan 05 hygiene fix for theta_fit.py** — `StatsForecast.forecast(df=...)` signature mismatch surfaced by Plan 12's first end-to-end CF run; pre-existing, not Phase 16 regression.
4. **After 2026-04-14 + 28 open business days**, re-run cumulative_uplift weekly — current n_days=14 has wide CIs; statistical power improves with the longer post-launch window (cutoff_sensitivity.md note line 49).

### Human Verification Required

#### 1. CampaignUpliftCard renders correctly on DEV preview at 375×667

**Test:** Push branch `feature/phase-16-its-uplift-attribution`, wait for CF Pages build, drive Chrome MCP against the DEV preview URL at 375×667, sign in with the friend-owner Supabase credentials, scroll past `InvoiceCountForecastCard`.

**Expected:**
- Card heading: "Did the Apr 14, 2026 campaign work?"
- Hero: "CI overlaps zero — no detectable lift" (per cutoff_sensitivity.md the 95% CI for the sarimax cumulative-since-launch row straddles zero at €-1008.53 [€-3488.76, €1764.85])
- Below hero: dim point-estimate `−€1,009 (95% CI −€3,489 … €1,765)`
- 280×100px sparkline visible with low-opacity Area CI band + Spline line
- Tap-to-pin tooltip on the sparkline shows "Day N", uplift €amount, and "95% CI X … Y"
- 11px gray anticipation-buffer note at the bottom
- Console: 0 errors

**Why human:** Chrome MCP's controlled-tab visibility state does not fire IntersectionObserver callbacks reliably under localhost; all 6 LazyMount slots stayed in `animate-pulse` skeleton state during Plan 09's localhost gate. Documented in 16-09-SUMMARY.md "Visual verification — PARTIAL".

#### 2. EventMarker red campaign-start line overlays both forecast cards on DEV

**Test:** Same DEV preview session, scroll through `RevenueForecastCard` and `InvoiceCountForecastCard`.

**Expected:** Red 3px vertical line at the 2026-04-14 x-coordinate visible on both cards' chart layers; clamping behavior consistent with `forecastEventClamp.ts` priority 5 (campaign_start at top of stack when overlapping with other event types).

**Why human:** Same Chrome-MCP IntersectionObserver gate as Item 1; Plan 10 SUMMARY classifies the localhost smoke as PARTIAL pending DEV.

---

_Verified: 2026-05-03T22:55:00Z_
_Verifier: Claude (gsd-verifier)_
