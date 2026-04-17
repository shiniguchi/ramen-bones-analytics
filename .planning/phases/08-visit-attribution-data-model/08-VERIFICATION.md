---
phase: 08-visit-attribution-data-model
status: human_needed
score: 5/5
verified: 2026-04-16
---

# Phase 8: Visit Attribution Data Model — Verification

## Goal
Every transaction carries its card_hash's nth-visit number and a binary cash/card flag; unused views and dead code are removed.

## Must-Haves Verification

### SC-1: visit_seq via ROW_NUMBER — PASSED
- `0020_visit_attribution_mv.sql` lines 9-25: MV uses `ROW_NUMBER() OVER (PARTITION BY t.restaurant_id, t.card_hash ORDER BY t.occurred_at)` with CASE guard for NULL card_hash
- Cash rows get `visit_seq=NULL`, card rows get sequential integers
- Integration test file `tests/integration/phase8-visit-attribution.test.ts` exists with 8 test cases covering 3+ customers with known visit sequences

### SC-2: is_cash boolean — PASSED
- `0020_visit_attribution_mv.sql` line 14: `(t.card_hash is null) as is_cash`
- Derives from card_hash presence per D-06 (not payment_method)
- Integration tests verify both cash (NULL card_hash → is_cash=true) and card (non-NULL → is_cash=false) transactions

### SC-3: MV follows canonical pattern — PASSED
- Unique index: `visit_attribution_mv_pk ON (restaurant_id, tx_id)` (line 29)
- REVOKE ALL: `revoke all on public.visit_attribution_mv from anon, authenticated` (line 32)
- Wrapper view: `visit_attribution_v` with JWT filter `auth.jwt()->>'restaurant_id'` (lines 35-39)
- GRANT SELECT to authenticated (line 42)
- Test helper: `test_visit_attribution(uuid)` SECURITY DEFINER (lines 46-67)

### SC-4: Dead code removed — PASSED
- SQL: `0021_drop_dead_views.sql` drops `test_frequency`, `test_new_vs_returning`, `test_ltv` functions + `frequency_v`, `new_vs_returning_v`, `ltv_v` views
- SQL: `transactions_filterable_v` rewritten without `wl_issuing_country`
- Frontend: `CountryMultiSelect.svelte`, `FrequencyCard.svelte`, `LtvCard.svelte`, `NewVsReturningCard.svelte`, `nvrAgg.ts` all deleted
- Frontend: `_applyCountryFilter` removed from `+page.server.ts`; `country` removed from `filtersSchema`
- No active code references to dropped artifacts (grep clean, only comments)
- CI guards: `bash scripts/ci-guards.sh` exits 0

### SC-5: refresh_analytics_mvs() updated — PASSED
- `0020_visit_attribution_mv.sql` lines 71-82: `refresh_analytics_mvs()` refreshes cohort_mv → kpi_daily_mv → visit_attribution_mv
- Visit attribution MV placed last (no cross-MV dependency, cleanest position)
- Nightly cron verification requires DEV database — deferred to human testing

## Requirements Coverage

| Requirement | Description | Status |
|-------------|-------------|--------|
| VA-01 | visit_seq integer via ROW_NUMBER per card_hash | PASSED |
| VA-02 | is_cash boolean from card_hash IS NULL | PASSED |
| VA-03 | Drop unused views + dead frontend code | PASSED |

## Automated Checks

| Check | Command | Result |
|-------|---------|--------|
| Unit tests | `npx vitest run tests/unit/` (excl. ci-guards) | 57/57 passed |
| CI guards | `bash scripts/ci-guards.sh` | All guards passed |
| Dead code grep | `grep -rn "frequency_v\|new_vs_returning_v\|ltv_v\|CountryMultiSelect\|_applyCountryFilter" src/` | Clean (only comments) |
| Component deletion | File existence check | All 4 card components deleted |

## Human Verification Required

1. **Dashboard renders at 375px** — Revenue KPI cards + Cohort Retention chart visible; Frequency, LTV, NewVsReturning cards gone
2. **Nightly refresh cron** — Trigger `refresh_analytics_mvs()` on DEV and verify visit_attribution_mv refreshes without error
3. **visit_seq accuracy on real data** — Query `visit_attribution_v` on DEV, spot-check 3 card_hash values have correct sequential visit_seq

## Score

**5/5 must-haves verified** (automated). 3 items need human verification on DEV.
