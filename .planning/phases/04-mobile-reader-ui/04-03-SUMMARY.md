---
phase: 04-mobile-reader-ui
plan: 03
subsystem: frontend-kpi-strip
tags: [sveltekit, svelte5-runes, tailwind-v4, supabase, kpi-tiles, tdd]
requires:
  - src/lib/dateRange.ts chipToRange (04-02)
  - src/lib/format.ts formatEUR (04-02)
  - src/lib/components/EmptyState.svelte (04-02)
  - public.kpi_daily_v (03-03 migration 0011)
  - src/routes/+page.server.ts loader shell (04-02)
provides:
  - src/lib/kpiAgg.ts sumKpi(rows) pure aggregation helper
  - src/routes/+page.server.ts load → data.kpi (8 parallel kpi_daily_v queries)
  - src/lib/components/KpiTile.svelte (title + number + delta + EmptyState)
  - 5 KPI tiles in +page.svelte: Revenue Today/7d/30d + Transactions + Avg ticket
affects:
  - src/routes/+page.server.ts (extended with kpi block)
  - src/routes/+page.svelte (5 KpiTile instances wired in)
  - tests/unit/cards.test.ts (4 KpiTile todos flipped to passing it())
tech-stack:
  added: []
  patterns:
    - "sumKpi helper extracted to src/lib/kpiAgg.ts for pure-function unit testing"
    - "8 parallel Promise.all kpi_daily_v queries in loader (3 fixed + 3 fixed prior + 1 chip + 1 chip prior)"
    - "Per-card error isolation: failed query slot returns null, tile renders EmptyState"
    - "chipPrior resolves to [] when range='all' (no prior window)"
    - "Delta threshold: |pct| < 1 → flat (avoids ▲ +0% noise)"
    - "U+2212 real minus sign for negative deltas (not ASCII hyphen)"
key-files:
  created:
    - src/lib/kpiAgg.ts
    - src/lib/components/KpiTile.svelte
    - tests/unit/kpiLoader.test.ts
  modified:
    - src/routes/+page.server.ts
    - src/routes/+page.svelte
    - tests/unit/cards.test.ts
decisions:
  - "sumKpi extracted to kpiAgg.ts (not inlined in loader): enables pure-unit testing without SvelteKit context; loader calls the helper 8 times via queryKpi helper function"
  - "8 queries not 5: plan noted 'acceptable fan-out = 8' and D-08 requires prior deltas on all 3 fixed revenue tiles; added priorToday, priorW7, priorW30 queries"
  - "Plan verify command grep -c from('kpi_daily_v') >= 5 would fail (only 1 literal occurrence) because queryKpi helper DRYs out the calls; functional requirement (8 actual parallel queries) is met; documented as implementation deviation"
  - "Test isolation fix: cards.test.ts positive delta test uses container.querySelector('p.text-green-700') instead of screen.getByText to avoid multi-render JSDOM accumulation across it() blocks"
metrics:
  duration_minutes: 4
  completed: 2026-04-14
  tasks: 2
  files_created: 3
  files_modified: 3
---

# Phase 04 Plan 03: KPI Strip Summary

KPI tiles wired end-to-end: 8 parallel `kpi_daily_v` queries in loader, `sumKpi` pure helper, `KpiTile` component with delta captions, 5 tiles in the card stream.

## What Shipped

**Task 1 (commits `0bb37b6` RED + `d84c1d6` GREEN) — Loader + sumKpi helper**

- `src/lib/kpiAgg.ts` — `sumKpi(rows)` pure function: sums `revenue_cents` and `tx_count`, recomputes `avg_ticket_cents` as revenue/tx (not an average of averages), handles null input (failed query slot).
- `tests/unit/kpiLoader.test.ts` — 5 unit tests: empty array, sum, avg recomputation, zero-safe, null-safe. RED first, GREEN after helper created.
- `src/routes/+page.server.ts` — extended load function:
  - Builds 4 date windows (`today`, `7d`, `30d`, chip range) via `chipToRange`.
  - Derives 3 fixed prior windows for the revenue delta tiles.
  - `queryKpi(from, to)` helper: queries `kpi_daily_v` with per-card error isolation (returns null on error, logs server-side).
  - 8 parallel `Promise.all` queries: `kToday`, `kTodayPrior`, `k7`, `k7Prior`, `k30`, `k30Prior`, `kChip`, `kChipPrior`.
  - `chipPrior` resolves to `[]` (not null) when `range='all'` — no prior window exists.
  - `data.kpi` shape: `revenueToday`, `revenue7d`, `revenue30d`, `txCount`, `avgTicket` — each with `{ value, prior, priorLabel }`.

**Task 2 (commits `c8fb569` RED + `a87e863` GREEN) — KpiTile component + page wiring**

- `src/lib/components/KpiTile.svelte`:
  - Props: `title`, `value`, `prior`, `format ('eur-int'|'eur-dec'|'int')`, `windowLabel`, `emptyCard`.
  - `display` derived: formatEUR (integer/decimal) or `toLocaleString('de-DE')` for counts.
  - `delta` derived: positive → `▲ +N% vs {label}` `text-green-700`; negative → `▼ −N% vs {label}` `text-red-700` (U+2212 real minus); flat (|pct|<1) → `— flat vs {label}` `text-zinc-500`; no prior → `— no prior data` `text-zinc-500`.
  - `value === null` → `EmptyState card={emptyCard}` fallback.
- `src/routes/+page.svelte` — 5 `KpiTile` instances in the card stream: Revenue Today/7d/30d (fixed, `format="eur-int"`) + Transactions (chip-scoped, `format="int"`) + Avg ticket (chip-scoped, `format="eur-dec"`).
- `tests/unit/cards.test.ts` — 4 KpiTile todos flipped to passing `it()`: integer EUR, positive delta green-700, negative delta red-700, no-prior zinc-500.

## Deviations from Plan

### Implementation Detail: queryKpi helper DRYs out from('kpi_daily_v') calls

- **Found during:** Task 1 implementation.
- **Issue:** Plan's verify command checks `grep -c "from('kpi_daily_v')" src/routes/+page.server.ts | awk '{exit ($1 >= 5) ? 0 : 1}'` — which would fail because a single `queryKpi` helper wraps the one literal `.from('kpi_daily_v')` call.
- **Decision:** Kept the DRY helper. The functional requirement (8 actual parallel queries via `Promise.all`) is fully met. The grep count of 1 literal reflects implementation style, not correctness.
- **Commit:** `d84c1d6`

### Rule 1 — Fix: test isolation in positive delta test

- **Found during:** Task 2 GREEN run.
- **Issue:** Multiple `render()` calls in the same `describe` block accumulate in JSDOM without per-test cleanup. `screen.getByText(/▲.*\+12%/)` matched more than one element.
- **Fix:** Switched to `container.querySelector('p.text-green-700')` — queries within the render's own container, immune to cross-test DOM accumulation.
- **Files modified:** `tests/unit/cards.test.ts`
- **Commit:** `a87e863`

### Auth gates

None.

## Verification

| Check | Result |
| --- | --- |
| `npm run build` | exits 0 |
| `bash scripts/ci-guards.sh` | `All CI guards passed.` |
| `npm run test:unit` | `Tests 17 passed | 10 todo (27)` |
| `grep kpi_daily_v src/routes/+page.server.ts` | matches (8 call sites via queryKpi) |
| `grep from('kpi_daily_v') src/routes/+page.server.ts` | 1 literal (queryKpi helper) |
| No `*_mv` / raw `transactions` refs in `src/` | enforced by Guard 1 |
| `grep KpiTile src/routes/+page.svelte` | 5 matches |
| `grep emptyCard src/lib/components/KpiTile.svelte` | match |

## Requirements Closed

- **UI-04** — KPI strip: 3 fixed revenue tiles (Today/7d/30d) + 2 chip-scoped (Transactions/Avg ticket), each with delta caption vs prior window.

## Known Stubs

`data.kpi.revenueToday.value` etc. will render EmptyState on a browser with no live Supabase connection (no credentials in sandbox). This is expected — verified behavior: `value: null` path → EmptyState `revenueFixed` renders correctly per unit tests. Live data requires DEV Supabase JWT.

Cohort + LTV tiles (04-04) and frequency + NVR (04-05) still slot as comments in `+page.svelte`; the card stream is functional but incomplete until those waves land.

## Self-Check: PASSED

- `src/lib/kpiAgg.ts` — FOUND
- `src/lib/components/KpiTile.svelte` — FOUND
- `tests/unit/kpiLoader.test.ts` — FOUND
- `src/routes/+page.server.ts` (kpi block) — FOUND
- `src/routes/+page.svelte` (5 KpiTile instances) — FOUND
- commit `0bb37b6` (test RED sumKpi) — FOUND
- commit `d84c1d6` (feat loader kpi) — FOUND
- commit `c8fb569` (test RED KpiTile) — FOUND
- commit `a87e863` (feat KpiTile + page) — FOUND
