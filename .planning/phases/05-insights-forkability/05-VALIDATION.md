---
phase: 5
slug: insights-forkability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (SvelteKit), deno test (Edge Function), pgTAP/psql assertions (SQL) |
| **Config file** | `vitest.config.ts` (existing from Phase 4), `supabase/functions/generate-insight/deno.json` (Wave 0) |
| **Quick run command** | `pnpm vitest run --changed` |
| **Full suite command** | `pnpm vitest run && deno test supabase/functions/generate-insight/` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --changed`
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite green + manual fork-from-scratch dry run
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

*Populated by planner. Every task must map to a requirement and an automated command (or Wave 0 reference).*

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| TBD | TBD | TBD | INS-01..06 | TBD | TBD | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `supabase/functions/generate-insight/deno.json` — Deno config + Anthropic SDK import map
- [ ] `supabase/functions/generate-insight/digit-guard.test.ts` — failing stubs for digit-guard regex (INS-02)
- [ ] `supabase/functions/generate-insight/payload.test.ts` — KPI payload shape tests (INS-01)
- [ ] `src/lib/components/InsightCard.test.ts` — render + hide-when-empty stubs (INS-03)
- [ ] `scripts/fork-dryrun.sh` — clean-clone bootstrap script stub (INS-05, INS-06)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fork → one-click deploy succeeds on fresh CF Pages + Supabase project | INS-05 | Requires real third-party accounts | Follow README from scratch in a clean GitHub account; record time-to-first-KPI |
| Claude Haiku output is accurate and non-hallucinatory on real payloads | INS-02 | Subjective LLM quality | Run 7 nights of production payloads, review insights in dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
