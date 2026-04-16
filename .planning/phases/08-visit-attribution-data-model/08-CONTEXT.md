# Phase 8: Visit Attribution Data Model - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Every transaction carries its card_hash's nth-visit number (`visit_seq`) and a binary cash/card flag (`is_cash`). Unused views, components, and filter code are removed. The dashboard temporarily loses frequency, new-vs-returning, and LTV cards until Phase 9/10 replaces them with visit-count-attributed charts.

</domain>

<decisions>
## Implementation Decisions

### MV Shape & visit_seq Grain
- **D-01:** New dedicated `visit_attribution_mv` with one row per transaction. Does NOT extend cohort_mv. Clean separation: cohort_mv stays per-customer, visit_attribution_mv is per-transaction.
- **D-02:** MV includes ALL transactions (card and cash). Cash rows get `visit_seq=NULL`, `is_cash=true`. Makes the MV a universal join target for Phase 9/10 charts without needing to UNION cash rows back in.
- **D-03:** `visit_seq` is computed via `ROW_NUMBER() OVER (PARTITION BY restaurant_id, card_hash ORDER BY occurred_at)` counting all transactions for that card_hash. Cash transactions (NULL card_hash) get `visit_seq=NULL`.
- **D-04:** MV columns: `restaurant_id uuid`, `tx_id text` (sourced from `transactions.source_tx_id` — `transactions` has no surrogate `id`; PK is composite `(restaurant_id, source_tx_id)`), `card_hash text`, `is_cash boolean`, `visit_seq integer` (NULL for cash), `business_date date`.
- **D-05:** Unique index on `(restaurant_id, tx_id)`. Follows canonical pattern: REVOKE ALL on raw MV + wrapper view `visit_attribution_v` with JWT restaurant_id filter + GRANT SELECT to authenticated.

### is_cash Derivation Rule
- **D-06:** `is_cash = (card_hash IS NULL)`. Consistent with Phase 2/3 convention where cash = no Worldline card = NULL card_hash. Covers edge cases where payment_method is non-standard but card_hash is still NULL.

### Dead Code Cleanup
- **D-07:** Full cleanup in Phase 8. Drop SQL views AND remove all frontend references in one phase:
  - SQL: DROP `frequency_v`, `new_vs_returning_v`, `ltv_v`
  - Frontend: Remove queries for these views from `src/routes/+page.server.ts`, remove UI cards/components that render them
  - Frontend: Delete `src/lib/components/CountryMultiSelect.svelte`
  - Frontend: Remove `_applyCountryFilter()` from `src/routes/+page.server.ts`
  - SQL: Remove `wl_issuing_country` column from `transactions_filterable_v`
  - Frontend: Remove `country` param from `filtersSchema` in `src/lib/filters.ts`, remove CountryMultiSelect from `FilterSheet.svelte`
- **D-08:** Dashboard after Phase 8 will show: Revenue KPI cards + Cohort retention chart. Frequency, new-vs-returning, and LTV cards are gone until Phase 9/10 adds replacement charts.

### Blackout Handling
- **D-09:** No special blackout exclusion in visit_attribution_mv. April 2026 Worldline blackout transactions already have `card_hash=NULL`, so they naturally get `is_cash=true` and `visit_seq=NULL`. The data is unrecoverable — these appear as cash in charts. Revenue is still counted.

### Claude's Discretion
- Migration file numbering and splitting (likely `0020_visit_attribution_mv.sql` + `0021_drop_dead_views.sql` or combined)
- Whether to drop views in a separate migration from the MV creation (for cleaner rollback)
- Exact position of `visit_attribution_mv` refresh in `refresh_analytics_mvs()` DAG (likely after cohort_mv)
- Test fixture design for visit_seq verification
- Whether `payment_method` filter param should also be removed from filtersSchema (it's separate from country, but Phase 9 replaces it with cash/card)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MV Pattern (copy exactly)
- `supabase/migrations/0010_cohort_mv.sql` — Canonical MV pattern: materialized view + unique index + REVOKE ALL + wrapper view + GRANT SELECT
- `supabase/migrations/0011_kpi_daily_mv_real.sql` — Second MV following same pattern
- `supabase/migrations/0013_refresh_function_and_cron.sql` — `refresh_analytics_mvs()` function to update with new MV

### Views to Drop
- `supabase/migrations/0012_leaf_views.sql` — Defines frequency_v (lines 128-177), new_vs_returning_v (lines 183-237), ltv_v (lines 77-122)

### Frontend to Clean Up
- `src/routes/+page.server.ts` — Queries frequency_v (lines 202-206), new_vs_returning_v (lines 209-215), ltv_v (lines 245-249); _applyCountryFilter (lines 33-56)
- `src/lib/components/CountryMultiSelect.svelte` — Country filter component to delete
- `src/lib/components/FilterSheet.svelte` — Imports CountryMultiSelect (line 9), uses it (lines 117-120)
- `src/lib/filters.ts` — filtersSchema with `country` and `payment_method` params (lines 37-45)

### Transactions Filterable View
- `supabase/migrations/0019_transactions_country_cardtype.sql` — Current transactions_filterable_v definition (lines 202-213), exposes wl_issuing_country

### Phase 2/3 Prior Art
- `.planning/phases/02-ingestion/02-CONTEXT.md` — D-07/08: card_hash + cash=NULL convention
- `.planning/phases/03-analytics-sql/03-CONTEXT.md` — D-01..D-05: cohort_mv shape, D-06/07: blackout exclusion, D-17: wrapper view pattern, D-20: refresh function pattern

### Project
- `CLAUDE.md` — Tech stack, critical gotchas (RLS + MV, REFRESH CONCURRENTLY)
- `.planning/REQUIREMENTS.md` §VA-01, VA-02, VA-03 — The three requirements this phase satisfies

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/migrations/0010_cohort_mv.sql` — Copy-paste template for visit_attribution_mv structure
- `supabase/migrations/0013_refresh_function_and_cron.sql` — Existing refresh function to extend
- `scripts/seed-demo-data.sql` — Demo data with deterministic visit sequences per card_hash (card A: 4 visits, card E: 4 visits, card H: 6 visits)

### Established Patterns
- One MV per concern, one migration per discrete change
- MV + unique index + REVOKE ALL + wrapper view + JWT filter + GRANT SELECT
- `business_date` derived via `AT TIME ZONE restaurants.timezone` (Phase 1 D-09)
- SECURITY DEFINER function for refresh, granted only to postgres/service_role
- Vitest integration tests against TEST Supabase project

### Integration Points
- `transactions` table (Phase 2) — source for visit_attribution_mv
- `restaurants.timezone` — joined for business_date derivation
- `refresh_analytics_mvs()` — must add new MV refresh
- `src/routes/+page.server.ts` — remove dead view queries and country filter
- `src/lib/filters.ts` — remove country param from schema
- `src/lib/components/FilterSheet.svelte` — remove CountryMultiSelect usage
- `scripts/ci-guards.sh` — may need new MV name added to guard regex

</code_context>

<specifics>
## Specific Ideas

- The MV is designed as a universal join target: all transactions (card + cash), with NULL visit_seq for cash. This avoids UNION workarounds in Phase 9/10 chart queries.
- Dashboard temporarily loses 3 cards (frequency, new-vs-returning, LTV) — this is intentional. Phase 9/10 replaces them with visit-count-attributed versions.
- Country filter removal is a clean break — not hidden, fully removed from schema, UI, and server code. Phase 9 replaces with simpler cash/card filter.

</specifics>

<deferred>
## Deferred Ideas

- **payment_method filter param removal** — Phase 9 simplifies filters to inhouse/takeaway + cash/card. Whether to remove `payment_method` from filtersSchema is Phase 9's call.
- **Visit-count bucket labels** (1st, 2nd, 3rd, 4x, 5x...) — Phase 10 chart concern, not data model.

</deferred>

---

*Phase: 08-visit-attribution-data-model*
*Context gathered: 2026-04-16*
