---
phase: 3
slug: analytics-sql
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (integration tests hit real Supabase DEV) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:integration -- tests/integration/analytics-sql.test.ts` |
| **Full suite command** | `pnpm test:integration` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD — planner fills from research Per-Task Verification table |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/analytics-sql.test.ts` — stubs for ANL-01..ANL-09
- [ ] `tests/fixtures/analytics-3-customer.sql` — 3-customer fixture (known retention buckets)
- [ ] CI grep guard script — blocks frontend references to `*_mv` / raw `transactions`

*Planner to refine after reading RESEARCH.md Validation Architecture section.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| pg_cron job firing nightly in DEV | ANL-08 | Time-dependent; verify via `cron.job_run_details` after first nightly run | Query `SELECT * FROM cron.job_run_details WHERE jobname='refresh-analytics-mvs' ORDER BY start_time DESC LIMIT 5` in DEV post-deploy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
