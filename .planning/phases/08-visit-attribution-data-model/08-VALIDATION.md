---
phase: 8
slug: visit-attribution-data-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (via vitest.config.ts) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/integration/phase8-visit-attribution.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/integration/phase8-visit-attribution.test.ts`
- **After every plan wave:** Run `npx vitest run && bash scripts/ci-guards.sh`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | VA-01 | integration | `npx vitest run tests/integration/phase8-visit-attribution.test.ts -x` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | VA-01 | integration | same file | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | VA-02 | integration | same file | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 1 | VA-03 | integration | same file | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 1 | VA-03 | unit (ci-guards) | `bash scripts/ci-guards.sh` | ✅ | ⬜ pending |
| 08-03-01 | 03 | 1 | VA-03 | integration | `npx vitest run tests/integration/phase8-visit-attribution.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/phase8-visit-attribution.test.ts` — covers VA-01 (visit_seq for 3+ customers), VA-01 (cash rows NULL), VA-02 (is_cash derivation), VA-03 (dropped views error), refresh function
- [ ] No framework install needed — Vitest already configured
- [ ] No new fixtures needed — reuse phase 3 test fixtures

*Existing infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard shows only Revenue KPI cards + Cohort retention chart | VA-03 (D-08) | Visual verification of card removal | Load dashboard at 375px, confirm FrequencyCard/NewVsReturningCard/LtvCard/CountryMultiSelect are gone |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
