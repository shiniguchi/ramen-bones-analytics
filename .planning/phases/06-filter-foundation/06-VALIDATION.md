---
phase: 6
slug: filter-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Populated from `06-RESEARCH.md` §Validation Architecture. Planner must finalize this file alongside PLAN.md files.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + Playwright (existing SvelteKit test setup) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `pnpm test:unit -- --run` |
| **Full suite command** | `pnpm test && pnpm test:e2e && pnpm ci-guards` |
| **Estimated runtime** | ~TBD seconds (planner to measure after Wave 0) |

---

## Sampling Rate

- **After every task commit:** `pnpm test:unit -- --run` (affected files)
- **After every plan wave:** Full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds target

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | FLT-01..07 | Wave 0 RED stubs | `pnpm test:unit -- --run` | ❌ W0 | ⬜ pending |

*Planner: populate this table with one row per task in each PLAN.md. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per RESEARCH.md §Validation Architecture:

- [ ] `pnpm add zod` — schema validator not yet installed
- [ ] `src/lib/filters.test.ts` — RED stubs for zod schema round-trip, `parseFilters()`, `composeFilter()`, "All" sentinel no-op, SQL-injection attempts
- [ ] `src/lib/dateRange.test.ts` — RED stubs for `customToRange({from, to})` Berlin TZ + prior-window math
- [ ] `tests/e2e/filter-bar.spec.ts` — Playwright RED stubs for: chip selection → URL param → card rerender, multi-select dropdown draft-and-apply, back/forward nav, 375px viewport
- [ ] `scripts/ci-guards/no-dynamic-sql.sh` (Guard 6) — greps for `${` inside `.from(` / `.rpc(` calls, fails build
- [ ] Migration 0018 snapshot test — `REFRESH MATERIALIZED VIEW CONCURRENTLY` on regrouped `kpi_daily_mv` with NULL `payment_method` rows (coalesced to `'UNKNOWN'`) succeeds

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Filter bar layout at 375px | FLT-01 | Visual regression requires human eye | Open DEV `/` in Chrome DevTools mobile 375px, verify sticky bar, sheet, chips, dropdowns fit without horizontal scroll |
| iOS Safari popover behavior | FLT-01 | Cannot run iOS Safari in CI | Manual smoke test on real iPhone or BrowserStack |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (zod install, filters.test.ts, dateRange.test.ts, e2e spec, Guard 6, MV snapshot)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
