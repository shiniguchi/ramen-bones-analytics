---
phase: 16
slug: its-uplift-attribution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Per-requirement test map is the source of truth for `## Validation Architecture` in 16-RESEARCH.md.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | pytest 7.x (Python — counterfactual fits, bootstrap math, RLS auth tests), vitest (Svelte components, integration), Playwright (E2E with auth'd JWT, per `project_silent_error_isolation.md`) |
| **Config files** | `pytest.ini` (Python), `vitest.config.ts` (Svelte), `playwright.config.ts` (E2E), `scripts/ci-guards.sh` (grep guards), `tests/integration/tenant-isolation.test.ts` (RLS) |
| **Quick run command** | `pytest tests/forecast/ -x --tb=short` (Python) **OR** `npm run test:unit -- --run` (Svelte) — pick the one matching the wave being executed |
| **Full suite command** | `npm run check && npm run test:unit -- --run && pytest tests/forecast/ && bash scripts/ci-guards.sh && npm run test:e2e` |
| **Estimated runtime** | ~25s quick · ~3min full · ~6min full+E2E |

---

## Sampling Rate

- **After every task commit:** Run quick command for the current wave's language (Python or Svelte)
- **After every plan wave:** Run full Python suite (Wave 1–2) **or** full TS+Svelte suite (Wave 3–4) **or** ci-guards.sh (any wave touching scripts or migrations)
- **Before `/gsd-verify-work`:** Full suite + E2E green; localhost-first Chrome MCP verification on `CampaignUpliftCard` (per C-11)
- **Max feedback latency:** ≤ 30 seconds for unit tests; ≤ 3 minutes for full suite

---

## Per-Task Verification Map

> Filled by planner during step 8. Initial seeds below; planner expands every task with its own row. Format expected by `/gsd-execute-phase`'s Nyquist sampler.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | UPL-01 | T-16-01 (RLS bypass on campaign_calendar) | Anon JWT cannot SELECT; tenant JWT can SELECT only own restaurant_id rows | integration | `npx playwright test tests/integration/tenant-isolation.test.ts -g campaign_calendar` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 1 | UPL-03 | — | `baseline_items_v` excludes Onsen EGG / Tantan / Hell beer (campaign-era launches) | unit | `pytest tests/sql/test_baseline_items_v.py -x` | ❌ W0 | ⬜ pending |
| 16-03-01 | 03 | 1 | UPL-03 | — | `kpi_daily_with_comparable_v.revenue_comparable_eur ≤ kpi_daily_mv.revenue_eur` for every (date, restaurant_id) | unit | `pytest tests/sql/test_kpi_daily_with_comparable_v.py -x` | ❌ W0 | ⬜ pending |
| 16-04-01 | 04 | 1 | UPL-07 | T-16-02 (off-week reminder fires twice) | Atomic UPDATE with `WHERE enabled=false` ensures single fire | unit | `pytest tests/forecast/test_offweek_reminder.py -x` | ❌ W0 | ⬜ pending |
| 16-05-01 | 05 | 2 | UPL-02 | T-16-03 (CF fit reads campaign-era data) | `pipeline_runs.fit_train_end < min(campaign_calendar.start_date)` for every cf row | integration | `pytest tests/forecast/test_counterfactual_fit.py::test_no_campaign_era_leak -x` | ❌ W0 | ⬜ pending |
| 16-05-02 | 05 | 2 | UPL-02 | — | `--track=cf` writes `forecast_track='cf'` rows for all 5 BAU models | integration | `pytest tests/forecast/test_counterfactual_fit.py::test_all_models_write_cf -x` | ❌ W0 | ⬜ pending |
| 16-06-01 | 06 | 2 | UPL-04 | — | Bootstrap CI bounds for synthetic-known uplift contain truth at 95% rate over 100 simulations (statistical coverage test) | unit | `pytest tests/forecast/test_cumulative_uplift.py::test_ci_coverage -x` | ❌ W0 | ⬜ pending |
| 16-06-02 | 06 | 2 | UPL-04 | — | `Σ yhat_samples` over a window matches direct sum of mean ± 1000-bootstrap CI within 1% tolerance | unit | `pytest tests/forecast/test_cumulative_uplift.py::test_bootstrap_consistency -x` | ❌ W0 | ⬜ pending |
| 16-06-03 | 06 | 2 | UPL-05 | — | `naive_dow_uplift_eur` populated for every campaign-window row | unit | `pytest tests/forecast/test_cumulative_uplift.py::test_naive_dow_present -x` | ❌ W0 | ⬜ pending |
| 16-07-01 | 07 | 2 | UPL-04 | — | `campaign_uplift_v` row exists for `(restaurant_id='friend', campaign='2026-04-14', model='sarimax', window_kind='cumulative_since_launch')` after end-to-end fixture run | integration | `pytest tests/forecast/test_campaign_uplift_v.py -x` | ❌ W0 | ⬜ pending |
| 16-08-01 | 08 | 3 | UPL-04, UPL-05 | T-16-04 (sample-path leak to client) | API response contains `ci_lower`, `ci_upper`, `naive_dow_uplift_eur`; never raw `yhat_samples` | unit | `npm run test:unit -- src/routes/api/campaign-uplift/+server.test.ts` | ❌ W0 | ⬜ pending |
| 16-09-01 | 09 | 3 | UPL-06 | — | When CI overlaps zero, hero text reads "CI overlaps zero — no detectable lift" and point estimate is dimmer | unit | `npm run test:unit -- src/lib/components/CampaignUpliftCard.test.ts` | ❌ W0 | ⬜ pending |
| 16-09-02 | 09 | 3 | UPL-06 | — | Sparkline renders Spline + Area at fill-opacity 0.06; touchEvents 'auto'; Tooltip.Root uses `{#snippet children({ data })}` | unit | `npm run test:unit -- src/lib/components/CampaignUpliftCard.test.ts -g layerchart_contract` | ❌ W0 | ⬜ pending |
| 16-09-03 | 09 | 3 | UPL-06 | — | Localhost Chrome MCP renders the card at 375px without console errors; "CI overlaps zero" copy visible when fixture forces zero-overlap CI | manual+E2E | Chrome MCP at `http://localhost:5173/?demo=zero-uplift` | ❌ W0 | ⬜ pending |
| 16-10-01 | 10 | 3 | UPL-06 | — | `EventMarker` for campaign_start renders red 3px line on `RevenueForecastCard` for the seeded 2026-04-14 row via `/api/forecast` | E2E | `npx playwright test tests/e2e/forecast-event-markers.spec.ts -g campaign_start` | ❌ W0 | ⬜ pending |
| 16-11-01 | 11 | 4 | UPL-02, UPL-03 | T-16-05 (raw revenue_eur regression in CF) | CI guard 9 fails when test fixture inserts `kpi_name='revenue_eur'` AND `forecast_track='cf'` together | unit | `bash scripts/ci-guards.sh && bash tests/ci-guards/test_guard_9.sh` | ❌ W0 | ⬜ pending |
| 16-11-02 | 11 | 4 | — | T-16-06 (`2026-04-14` literal in src/) | CI guard 10 fails when test fixture writes the literal under `src/` | unit | `bash scripts/ci-guards.sh && bash tests/ci-guards/test_guard_10.sh` | ❌ W0 | ⬜ pending |
| 16-12-01 | 12 | 4 | UPL-02 | — | `tests/forecast/cutoff_sensitivity.md` exists with 5 models × 3 cutoffs (-14d/-7d/-1d) populated, sensitivity ratio in `[0.8, 1.25]` for at least sarimax/prophet | manual | `bash tests/forecast/check_cutoff_sensitivity.sh` | ❌ W0 | ⬜ pending |
| 16-13-01 | 13 | 4 | UPL-02, UPL-04, UPL-07 | — | `forecast-refresh.yml` workflow has Track-B fit step + `cumulative_uplift.py` step; runs in <5min on ubuntu-latest | manual | `gh workflow run forecast-refresh.yml --ref feature/phase-16-its-uplift-attribution` then check logs | ❌ W0 | ⬜ pending |

> **Threat refs (T-16-XX) link to PLAN.md `<threat_model>` blocks. Planner must populate the threat block; checker verifies cross-reference.**

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Tests below MUST exist as stubs before Wave 1 begins (per Nyquist contract). Stubs may be skip-marked but the file/function must resolve so the planner's per-task verifier commands don't 404.

- [ ] `tests/sql/test_baseline_items_v.py` — stubs for UPL-03 (excludes Onsen EGG / Tantan / Hell beer)
- [ ] `tests/sql/test_kpi_daily_with_comparable_v.py` — stubs for UPL-03 (revenue_comparable_eur ≤ revenue_eur invariant)
- [ ] `tests/forecast/test_offweek_reminder.py` — stubs for UPL-07 (atomic-fire-once)
- [ ] `tests/forecast/test_counterfactual_fit.py` — stubs for UPL-02 (no campaign-era leak; all 5 BAU models)
- [ ] `tests/forecast/test_cumulative_uplift.py` — stubs for UPL-04, UPL-05 (CI coverage; naive_dow cross-check)
- [ ] `tests/forecast/test_campaign_uplift_v.py` — stubs for UPL-04 (end-to-end view query)
- [ ] `tests/forecast/check_cutoff_sensitivity.sh` — script that asserts `cutoff_sensitivity.md` has 5×3 grid populated
- [ ] `src/routes/api/campaign-uplift/+server.test.ts` — extend Phase 15 stub for new payload
- [ ] `src/lib/components/CampaignUpliftCard.test.ts` — Wave 0 stub for honest-label rule + sparkline contract
- [ ] `tests/integration/tenant-isolation.test.ts` — extend with `campaign_calendar`, `feature_flags`, `campaign_uplift_v` cases (auth'd JWT, NOT just service-role) per `project_silent_error_isolation.md`
- [ ] `tests/e2e/forecast-event-markers.spec.ts` — extend Phase 15 spec with `campaign_start` marker case
- [ ] `tests/ci-guards/test_guard_9.sh`, `tests/ci-guards/test_guard_10.sh` — fixture tests for the new grep guards

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `CampaignUpliftCard` visual layout at 375px (iPhone SE) — sparkline shape, hero number sizing, tooltip touch target ≥44×44px | UPL-06 | Visual verdict — automated DOM tests can't judge "looks readable" | Chrome MCP `mcp__claude-in-chrome__navigate` to `http://localhost:5173`, switch viewport to 375×667, screenshot, eyeball |
| Honest-label copy phrasing — "CI overlaps zero — no detectable lift" reads naturally to a non-technical owner | UPL-06 | Subjective copy review | Show fixture-forced zero-overlap demo to friend-owner; confirm comprehension |
| `cutoff_sensitivity.md` interpretation — does the ratio uplift(-14d)/uplift(-7d) ∈ [0.8, 1.25] hold for ≥3 of 5 models on real data? | UPL-02 | Real data only | Run `python scripts/forecast/run_all.py --track=cf --train-end-offset=-14`, then `-7`, then `-1`; manually compute ratios |
| `2026-10-15` off-week reminder narrative line appears in nightly InsightCard generation when fired | UPL-07 | Live system check 6 months out — guard with feature_flags fixture for tests | Manually flip `feature_flags.remind_on_or_after_date` to today in dev DB; trigger nightly Insight pipeline; check InsightCard text |

---

## Validation Sign-Off

- [ ] Every task in PLAN.md(s) has `<automated>` verify command OR a Wave 0 stub dependency
- [ ] Sampling continuity: no 3 consecutive tasks lack an automated verify command
- [ ] Wave 0 covers all 12 missing test files listed above
- [ ] No watch-mode flags in any verify command (`--run` for vitest; pytest avoids `-f`)
- [ ] Feedback latency < 30s per quick run
- [ ] `nyquist_compliant: true` set in frontmatter once planner has filled all task rows

**Approval:** pending
