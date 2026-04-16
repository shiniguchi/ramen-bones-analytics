---
phase: 9
slug: filter-simplification-performance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | VA-12 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | VA-12 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 1 | VA-11 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 1 | VA-13 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 2 | VA-11 | manual | Chrome MCP | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for client-side rebucketing logic (VA-12)
- [ ] Test stubs for filter application logic (VA-11)
- [ ] Test stubs for KPI tile consolidation (VA-13)

*Existing vitest infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Filter bar shows exactly 2 toggles at 375px | VA-11 | Visual layout verification | Open dashboard at 375px, confirm only sales-type and cash/card toggles visible |
| Grain/range change responds <200ms | VA-12 | Perceived latency measurement | Toggle grain, observe no loading spinner or page navigation |
| Revenue tile shows dynamic range label | VA-13 | Visual text verification | Select 7d range, confirm tile title shows "Revenue · 7d" |
| All tiles respect both filters | VA-11 | Cross-component verification | Toggle cash-only + takeaway, verify all tiles update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
