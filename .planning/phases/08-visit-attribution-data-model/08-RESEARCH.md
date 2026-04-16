# Phase 8: Visit Attribution Data Model - Research

**Researched:** 2026-04-16
**Domain:** Postgres materialized views, SvelteKit SSR data pipeline, dead code removal
**Confidence:** HIGH

## Summary

Phase 8 creates a new `visit_attribution_mv` materialized view that tags every transaction with its `visit_seq` (nth visit for that card_hash) and `is_cash` boolean. It also drops three unused SQL views (`frequency_v`, `new_vs_returning_v`, `ltv_v`), removes the country filter UI pipeline, and strips `wl_issuing_country` from `transactions_filterable_v`. The dashboard temporarily loses 3 cards (Frequency, New vs Returning, LTV) until Phase 9/10 replaces them.

All SQL patterns are well-established in the codebase (migrations 0010-0013). The MV follows the canonical pattern: CREATE MATERIALIZED VIEW + unique index + REVOKE ALL + wrapper view with JWT filter + GRANT SELECT. The `refresh_analytics_mvs()` function gets a third REFRESH call. Frontend cleanup is mechanical: delete components, remove queries and data props, strip country filter from FilterSheet/FilterBar.

**Primary recommendation:** Split into two migrations (create MV, then drop dead views) for clean rollback. Frontend cleanup is a single pass through 6 files.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: New dedicated `visit_attribution_mv` with one row per transaction. Does NOT extend cohort_mv.
- D-02: MV includes ALL transactions (card and cash). Cash rows get `visit_seq=NULL`, `is_cash=true`.
- D-03: `visit_seq` computed via `ROW_NUMBER() OVER (PARTITION BY restaurant_id, card_hash ORDER BY occurred_at)` counting all transactions for that card_hash.
- D-04: MV columns: `restaurant_id uuid`, `tx_id uuid`, `card_hash text`, `is_cash boolean`, `visit_seq integer` (NULL for cash), `business_date date`.
- D-05: Unique index on `(restaurant_id, tx_id)`. REVOKE ALL on raw MV + wrapper view `visit_attribution_v` with JWT restaurant_id filter + GRANT SELECT to authenticated.
- D-06: `is_cash = (card_hash IS NULL)`.
- D-07: Full cleanup: DROP frequency_v, new_vs_returning_v, ltv_v; remove frontend queries/components/CountryMultiSelect/_applyCountryFilter/wl_issuing_country from transactions_filterable_v.
- D-08: Dashboard after Phase 8 shows: Revenue KPI cards + Cohort retention chart only.
- D-09: No special blackout exclusion in visit_attribution_mv.

### Claude's Discretion
- Migration file numbering and splitting (likely 0020 + 0021 or combined)
- Whether to split MV creation from view drops (cleaner rollback)
- Exact position of visit_attribution_mv refresh in refresh_analytics_mvs() DAG
- Test fixture design for visit_seq verification
- Whether payment_method filter param should also be removed from filtersSchema

### Deferred Ideas (OUT OF SCOPE)
- payment_method filter param removal (Phase 9's call)
- Visit-count bucket labels (1st, 2nd, 3rd, 4x, 5x...) (Phase 10 chart concern)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VA-01 | Each transaction has a `visit_seq` integer via ROW_NUMBER() OVER (PARTITION BY card_hash ORDER BY occurred_at), materialized in a new MV | MV pattern from 0010_cohort_mv.sql; ROW_NUMBER window function is standard Postgres; D-01..D-05 lock shape |
| VA-02 | Each transaction has an `is_cash` boolean derived from card_hash IS NULL | D-06 locks derivation rule; trivially computed in MV SELECT |
| VA-03 | Drop unused views/MVs and dead frontend code | D-07 enumerates exact artifacts; canonical refs pin line numbers |
</phase_requirements>

## Architecture Patterns

### MV Pattern (copy from 0010_cohort_mv.sql)

The codebase has an established 5-step pattern for every MV. Every new MV MUST follow it exactly:

```sql
-- 1. CREATE MATERIALIZED VIEW
CREATE MATERIALIZED VIEW public.visit_attribution_mv AS
  SELECT ... ;

-- 2. UNIQUE INDEX (required for REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX visit_attribution_mv_pk
  ON public.visit_attribution_mv (restaurant_id, tx_id);

-- 3. REVOKE ALL on raw MV
REVOKE ALL ON public.visit_attribution_mv FROM anon, authenticated;

-- 4. Wrapper view with JWT tenancy filter
CREATE VIEW public.visit_attribution_v AS
SELECT ... FROM public.visit_attribution_mv
WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id');

-- 5. GRANT SELECT to authenticated
GRANT SELECT ON public.visit_attribution_v TO authenticated;
```

**Source:** `supabase/migrations/0010_cohort_mv.sql` (lines 1-78), `0011_kpi_daily_mv_real.sql` (lines 18-51)

### Refresh DAG Pattern (from 0013_refresh_function_and_cron.sql)

The `refresh_analytics_mvs()` function refreshes MVs sequentially in a plpgsql block. Current order: cohort_mv then kpi_daily_mv. The new MV must be added.

**DAG position:** `visit_attribution_mv` reads from `transactions` + `restaurants` only (no dependency on cohort_mv or kpi_daily_mv). It can go in any position. Recommendation: put it AFTER cohort_mv but BEFORE or AFTER kpi_daily_mv -- order does not matter since there's no cross-MV dependency. Putting it last is cleanest.

```sql
CREATE OR REPLACE FUNCTION public.refresh_analytics_mvs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.cohort_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.kpi_daily_mv;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.visit_attribution_mv;  -- NEW
END;
$$;
```

### Test Helper Pattern (from 0012_leaf_views.sql)

Every wrapper view gets a `test_<name>(rid uuid)` SECURITY DEFINER function so integration tests can query it via service_role without minting JWTs:

```sql
CREATE OR REPLACE FUNCTION public.test_visit_attribution(rid uuid)
RETURNS TABLE (
  restaurant_id uuid, tx_id uuid, card_hash text,
  is_cash boolean, visit_seq integer, business_date date
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('restaurant_id', rid::text)::text, true);
  RETURN QUERY SELECT * FROM public.visit_attribution_v;
END;
$$;
REVOKE ALL ON FUNCTION public.test_visit_attribution(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_visit_attribution(uuid) TO service_role;
```

**Source:** `supabase/migrations/0012_leaf_views.sql` (lines 249-344)

### Frontend Data Flow Pattern

`+page.server.ts` queries wrapper views via `locals.supabase.from('view_name')`, collects results in `Promise.all`, and returns a typed object to `+page.svelte`. Components receive data as props. Removal means:
1. Delete the query promise variable
2. Remove from `Promise.all` destructuring
3. Remove from the return object
4. Remove component import + usage in `+page.svelte`

## Recommended Migration Structure

### Migration 1: `0020_visit_attribution_mv.sql`
- CREATE MATERIALIZED VIEW visit_attribution_mv
- CREATE UNIQUE INDEX
- REVOKE ALL
- CREATE VIEW visit_attribution_v
- GRANT SELECT
- CREATE FUNCTION test_visit_attribution(uuid)
- ALTER refresh_analytics_mvs() to include new MV

### Migration 2: `0021_drop_dead_views.sql`
- DROP test helper functions for frequency_v, new_vs_returning_v, ltv_v
- DROP VIEW frequency_v, new_vs_returning_v, ltv_v
- Recreate transactions_filterable_v WITHOUT wl_issuing_country

**Rationale for split:** If the MV creation passes but something goes wrong with drops, rollback is cleaner. Also, ci-guards Guard 1 references these view names in its error message -- the guard itself doesn't need updating since the frontend references will already be gone by the time this migration runs.

## visit_attribution_mv SQL Shape

```sql
CREATE MATERIALIZED VIEW public.visit_attribution_mv AS
SELECT
  t.restaurant_id,
  t.id                          AS tx_id,
  t.card_hash,
  (t.card_hash IS NULL)         AS is_cash,
  CASE
    WHEN t.card_hash IS NOT NULL THEN
      ROW_NUMBER() OVER (
        PARTITION BY t.restaurant_id, t.card_hash
        ORDER BY t.occurred_at
      )
    ELSE NULL
  END::integer                  AS visit_seq,
  (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date
FROM public.transactions t
JOIN public.restaurants r ON r.id = t.restaurant_id;
```

**Key details:**
- D-02: ALL transactions included (no card_hash IS NOT NULL filter, no blackout exclusion per D-09)
- D-03: ROW_NUMBER partitions by `(restaurant_id, card_hash)` -- cash rows (NULL card_hash) get NULL visit_seq via CASE
- D-04: Columns match spec exactly
- `t.id` is the transactions primary key, aliased to `tx_id` per D-04
- `business_date` derived via restaurant timezone per Phase 1 D-09

**ROW_NUMBER with NULL card_hash caveat:** Without the CASE wrapper, ROW_NUMBER would still compute over NULL card_hash rows (all NULLs partition together in Postgres). The CASE ensures cash rows get NULL visit_seq rather than a meaningless sequence number across all cash transactions.

## Dead Code Inventory

### SQL Views to DROP (Migration 0021)

| View | Defined in | Dependencies |
|------|-----------|--------------|
| `frequency_v` | 0012_leaf_views.sql (L128-177) | Reads cohort_mv + transactions |
| `new_vs_returning_v` | 0012_leaf_views.sql (L183-237) | Reads transactions + restaurants + cohort_mv |
| `ltv_v` | 0012_leaf_views.sql (L77-122) | Reads cohort_mv + transactions |

Also DROP the 4 test helper functions:
- `test_frequency(uuid)` (0012 L310-320)
- `test_new_vs_returning(uuid)` (0012 L330-344)
- `test_ltv(uuid)` (0012 L279-300)

### transactions_filterable_v Rewrite

Current definition (0019 L202-213) includes `wl_issuing_country`. Recreate WITHOUT that column:

```sql
CREATE OR REPLACE VIEW public.transactions_filterable_v
WITH (security_invoker = true) AS
SELECT
  t.restaurant_id,
  (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date,
  t.gross_cents,
  t.sales_type,
  t.payment_method
FROM public.transactions t
JOIN public.restaurants r ON r.id = t.restaurant_id
WHERE t.restaurant_id::text = (auth.jwt() ->> 'restaurant_id');
```

Note: CREATE OR REPLACE VIEW can remove trailing columns safely. Existing grants are preserved.

### Frontend Files to Modify

| File | Action | What to Remove |
|------|--------|----------------|
| `src/lib/components/LtvCard.svelte` | DELETE entire file | -- |
| `src/lib/components/FrequencyCard.svelte` | DELETE entire file | -- |
| `src/lib/components/NewVsReturningCard.svelte` | DELETE entire file | -- |
| `src/lib/components/CountryMultiSelect.svelte` | DELETE entire file | -- |
| `src/lib/nvrAgg.ts` | DELETE entire file | shapeNvr helper |
| `src/lib/e2eChartFixtures.ts` | EDIT | Remove E2E_LTV_ROWS export; may keep retention fixtures |
| `src/lib/emptyStates.ts` | EDIT | Remove `ltv`, `frequency`, `newVsReturning` entries |
| `src/routes/+page.svelte` | EDIT | Remove imports + usage of LtvCard, FrequencyCard, NewVsReturningCard; remove `distinctCountries` prop from FilterBar |
| `src/routes/+page.server.ts` | EDIT | Remove `_applyCountryFilter` function, `freqP`/`nvrP`/`ltvP` queries, `distinctCountriesP` query, all country filter logic; remove from Promise.all and return object |
| `src/lib/filters.ts` | EDIT | Remove `country: csvArray()` from filtersSchema |
| `src/lib/components/FilterSheet.svelte` | EDIT | Remove CountryMultiSelect import + usage + countryDraft state + serializeCountry + country in patch |
| `src/lib/components/FilterBar.svelte` | EDIT | Remove distinctCountries prop + country active check |

### Remaining Shared Dependencies After Cleanup

- `retention_curve_v` -- STAYS (used by CohortRetentionCard, Phase 9/10 retention chart)
- `cohort_mv` / `cohort_v` -- STAYS (used by retention_curve_v)
- `kpi_daily_v` -- STAYS (used by KPI tiles)
- `transactions_filterable_v` -- STAYS (used by chip-scoped KPI tiles, minus wl_issuing_country)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Visit sequence numbering | Manual subquery counting | `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` | Window functions handle ties, NULLs, and ordering correctly |
| MV security | Custom RLS on MV | Wrapper view + REVOKE ALL pattern | RLS does not propagate to MVs (CLAUDE.md Gotcha 1) |
| Filter param removal | Partial cleanup | Full removal from zod schema + server + UI | Orphaned params cause silent bugs in future phases |

## Common Pitfalls

### Pitfall 1: ROW_NUMBER over NULL partition
**What goes wrong:** If card_hash IS NULL rows are not excluded from ROW_NUMBER, all cash transactions share a single partition and get arbitrary sequence numbers.
**Why it happens:** Postgres treats all NULLs as equal in PARTITION BY.
**How to avoid:** Wrap ROW_NUMBER in a CASE WHEN card_hash IS NOT NULL THEN ... ELSE NULL END.
**Warning signs:** Cash transactions have visit_seq values instead of NULL.

### Pitfall 2: REFRESH CONCURRENTLY without unique index
**What goes wrong:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` fails with error.
**Why it happens:** Postgres requires at least one unique index on the MV.
**How to avoid:** Always CREATE UNIQUE INDEX before any REFRESH CONCURRENTLY. ci-guards Guard 3b catches this.
**Warning signs:** Guard 3b fails in CI.

### Pitfall 3: Dropping views that have dependent test helpers
**What goes wrong:** DROP VIEW frequency_v fails because test_frequency() depends on it.
**Why it happens:** Functions that reference views create pg_depend entries.
**How to avoid:** DROP FUNCTION first, then DROP VIEW. Or use CASCADE (but be explicit about what cascades).
**Warning signs:** Migration fails with "cannot drop view because other objects depend on it".

### Pitfall 4: CREATE OR REPLACE VIEW column removal
**What goes wrong:** Removing a column from the middle of a view's SELECT list can break dependents.
**Why it happens:** CREATE OR REPLACE VIEW has restrictions on column reordering/removal in some Postgres versions.
**How to avoid:** For transactions_filterable_v, `wl_issuing_country` is the LAST column (appended in migration 0019). Removing the last column via CREATE OR REPLACE is safe. If it were a middle column, you'd need DROP + CREATE.
**Warning signs:** "cannot change name of view column" error.

### Pitfall 5: Orphaned frontend references after SQL drops
**What goes wrong:** TypeScript compiles but Supabase queries return 404/relation-not-found at runtime.
**Why it happens:** Frontend references views that no longer exist in the DB.
**How to avoid:** Delete ALL frontend query code for dropped views in the same PR as the SQL migration. Run ci-guards locally.
**Warning signs:** Runtime errors in +page.server.ts, console errors for view queries.

### Pitfall 6: tx_id column naming
**What goes wrong:** Using `t.id` without alias produces a column named `id` instead of `tx_id`.
**Why it happens:** D-04 specifies the column name as `tx_id`.
**How to avoid:** Always alias: `t.id AS tx_id` in the MV SELECT.
**Warning signs:** Unique index on (restaurant_id, tx_id) fails because column doesn't exist.

## Code Examples

### visit_attribution_mv Full Migration

```sql
-- Source: codebase pattern from 0010_cohort_mv.sql + 0011_kpi_daily_mv_real.sql
-- D-01..D-06, D-09 from 08-CONTEXT.md

CREATE MATERIALIZED VIEW public.visit_attribution_mv AS
SELECT
  t.restaurant_id,
  t.id AS tx_id,
  t.card_hash,
  (t.card_hash IS NULL) AS is_cash,
  CASE
    WHEN t.card_hash IS NOT NULL THEN
      ROW_NUMBER() OVER (
        PARTITION BY t.restaurant_id, t.card_hash
        ORDER BY t.occurred_at
      )
    ELSE NULL
  END::integer AS visit_seq,
  (t.occurred_at AT TIME ZONE r.timezone)::date AS business_date
FROM public.transactions t
JOIN public.restaurants r ON r.id = t.restaurant_id;

CREATE UNIQUE INDEX visit_attribution_mv_pk
  ON public.visit_attribution_mv (restaurant_id, tx_id);

REVOKE ALL ON public.visit_attribution_mv FROM anon, authenticated;

CREATE VIEW public.visit_attribution_v AS
SELECT
  restaurant_id, tx_id, card_hash, is_cash, visit_seq, business_date
FROM public.visit_attribution_mv
WHERE restaurant_id::text = (auth.jwt()->>'restaurant_id');

GRANT SELECT ON public.visit_attribution_v TO authenticated;
```

### Test Fixture Design for visit_seq Verification

The existing phase 3 fixture has 3 customers with known visit patterns:
- hash-a: 3 visits (2025-08-04, 2025-08-18, 2025-09-29) -- expected visit_seq 1, 2, 3
- hash-b: 3 visits (2025-08-05, 2025-08-11, 2025-08-25) -- expected visit_seq 1, 2, 3
- hash-c: 2 visits (2025-11-10, 2025-11-17) -- expected visit_seq 1, 2

The demo seed also has rich visit patterns:
- demo-card-A: 7 visits -- expected visit_seq 1..7
- demo-card-E: 6 visits -- expected visit_seq 1..6
- demo-card-H: 9 visits -- expected visit_seq 1..9
- cash rows (3): all expected is_cash=true, visit_seq=NULL

**Recommendation:** Extend the existing phase3-fixtures with a new integration test file that:
1. Seeds the 3-customer fixture
2. Refreshes MVs (refresh_analytics_mvs now includes visit_attribution_mv)
3. Queries test_visit_attribution(rid) and asserts exact visit_seq per card_hash
4. Asserts cash rows have is_cash=true and visit_seq=NULL

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via vitest.config.ts) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/integration/phase8-visit-attribution.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VA-01 | visit_seq = ROW_NUMBER for 3+ customers with known sequences | integration | `npx vitest run tests/integration/phase8-visit-attribution.test.ts -x` | Wave 0 |
| VA-01 | cash rows have visit_seq=NULL | integration | same file | Wave 0 |
| VA-02 | is_cash=true for NULL card_hash, false otherwise | integration | same file | Wave 0 |
| VA-03 | frequency_v, new_vs_returning_v, ltv_v are dropped (query returns error) | integration | same file | Wave 0 |
| VA-03 | Frontend has zero references to removed artifacts | unit (ci-guards) | `bash scripts/ci-guards.sh` | Existing |
| VA-03 | visit_attribution_v has RLS wrapper + REVOKE ALL | integration | `npx vitest run tests/integration/mv-wrapper-template.test.ts` | Existing pattern |
| SC-5 | refresh_analytics_mvs() refreshes all 3 MVs | integration | same phase8 file | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/integration/phase8-visit-attribution.test.ts -x`
- **Per wave merge:** `npx vitest run && bash scripts/ci-guards.sh`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/phase8-visit-attribution.test.ts` -- covers VA-01, VA-02, VA-03 (MV queries)
- [ ] `tests/integration/helpers/phase8-fixtures.ts` -- optional if reusing phase3 fixtures
- [ ] No framework install needed -- Vitest already configured

## Open Questions

1. **payment_method filter param removal scope**
   - What we know: D-07 says remove `country` from filtersSchema. CONTEXT.md lists payment_method removal as Claude's discretion.
   - What's unclear: Phase 9 replaces payment_method with binary cash/card. Should we remove `payment_method` from filtersSchema now or leave it for Phase 9?
   - Recommendation: Leave payment_method in filtersSchema for Phase 8. Phase 9 explicitly handles filter simplification (VA-11). Removing it now would break the existing payment_method dropdown which still works and is not listed in D-07's removal scope.

2. **E2E fixture file fate**
   - What we know: `src/lib/e2eChartFixtures.ts` exports E2E_LTV_ROWS and E2E_RETENTION_ROWS. LTV data is being dropped.
   - What's unclear: Whether the E2E test harness still needs retention fixtures.
   - Recommendation: Remove E2E_LTV_ROWS. Keep E2E_RETENTION_ROWS if CohortRetentionCard still uses the E2E bypass path. If the entire file becomes empty, delete it and remove the E2E bypass block from +page.server.ts.

3. **ci-guards Guard 1 error message update**
   - What we know: Guard 1's error message lists `frequency_v, new_vs_returning_v, ltv_v` as allowed wrapper views.
   - What's unclear: Whether Guard 1 needs updating after these views are dropped.
   - Recommendation: Guard 1's regex blocks raw `_mv` refs and raw table names. The listed view names in the error message are informational only (not in the regex). Update the comment for accuracy but the guard logic doesn't change.

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/0010_cohort_mv.sql` -- MV pattern template
- `supabase/migrations/0011_kpi_daily_mv_real.sql` -- Second MV instance confirming pattern
- `supabase/migrations/0012_leaf_views.sql` -- Views to drop + test helper pattern
- `supabase/migrations/0013_refresh_function_and_cron.sql` -- Refresh DAG pattern
- `supabase/migrations/0019_transactions_country_cardtype.sql` -- transactions_filterable_v current definition
- `src/routes/+page.server.ts` -- Frontend query pipeline (all line references verified)
- `src/routes/+page.svelte` -- Component usage (all imports verified)
- `src/lib/filters.ts` -- filtersSchema with country param (line 42 verified)

### Secondary (MEDIUM confidence)
- Postgres ROW_NUMBER with NULL partition behavior -- well-documented Postgres standard, verified against training data

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all patterns copied from existing codebase
- Architecture: HIGH -- MV pattern used twice already, no novel decisions
- Pitfalls: HIGH -- pitfalls identified from codebase patterns and Postgres semantics

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable -- no external dependency changes)
