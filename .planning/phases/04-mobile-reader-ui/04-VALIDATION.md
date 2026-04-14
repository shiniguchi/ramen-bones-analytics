---
phase: 04
slug: mobile-reader-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit/component) + Playwright (e2e/visual 375px) — both installed in Wave 0 |
| **Config file** | `vite.config.ts` (vitest inline) + `playwright.config.ts` |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm run test` (vitest + playwright) |
| **Estimated runtime** | ~60 seconds (unit ~10s, e2e ~50s) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green at 375px viewport
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-xx | 01 | 0 | Wave 0 bootstrap | infra | `npm run build` | ❌ W0 | ⬜ pending |
| 04-02-xx | 02 | 1 | UI-01, UI-02 | e2e | `playwright test layout.spec.ts` | ❌ W0 | ⬜ pending |
| 04-03-xx | 03 | 2 | UI-03, UI-04, UI-05 | component | `vitest run kpi-cards` | ❌ W0 | ⬜ pending |
| 04-04-xx | 04 | 2 | UI-06, UI-07, UI-08 | component | `vitest run cohort-ltv` | ❌ W0 | ⬜ pending |
| 04-05-xx | 05 | 3 | UI-09, UI-10, UI-11 | e2e | `playwright test freq-nvr.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` + `@testing-library/svelte` installed
- [ ] `playwright` + browser binaries installed
- [ ] `playwright.config.ts` — 375px viewport default, Mobile Safari + Chrome
- [ ] `tests/unit/` — RED stub per KPI/chart card (UI-03..UI-10)
- [ ] `tests/e2e/layout.spec.ts` — 375px no horizontal scroll stub (UI-01, UI-02)
- [ ] `tests/e2e/chips.spec.ts` — preset date-range chip stub (UI-11)
- [ ] CI guard: fail if any PR omits Playwright screenshot at 375px

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cloudflare Pages project creation | UI-01 | First-time dashboard setup | Create Pages project, bind env vars, confirm deploy URL |
| Friend opens on real iPhone Safari | UI-01, UI-02 | Real device trust | Share DEV URL, confirm login + dashboard loads at 375px |
| "Last updated Xh ago" matches real ingest | UI-03 | Requires real cron run | Trigger extractor, verify label updates within 5 min |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
