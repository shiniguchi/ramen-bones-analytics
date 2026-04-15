---
phase: 05-insights-forkability
plan: 03
subsystem: edge-function
tags: [supabase-edge-function, claude-haiku, digit-guard, deterministic-fallback, deno]
requires:
  - public.insights table (05-01 migration 0016)
  - Wave 0 RED test scaffold (05-02)
provides:
  - supabase/functions/generate-insight deployed to DEV
  - digit-guard implementation rejecting hallucinated/rounded numbers
  - deterministic fallback template (zero-today + zero-returning edges)
  - InsightPayload type + buildPayload reader over kpi/cohort/ltv/freq/nvr views
affects:
  - 05-04 (InsightCard) reads rows this function writes
  - 05-05 (forker walkthrough) sets ANTHROPIC_API_KEY + runs this end-to-end with LLM path live
tech_stack:
  added: []
  patterns:
    - "Anthropic tool-use forced JSON shape (tool_choice type:tool)"
    - "Flatten-then-regex digit-guard (commas→dots normalized)"
    - "Fallback-by-construction tautology: template output passes digit-guard against its own payload"
key_files:
  created:
    - supabase/functions/generate-insight/digitGuard.ts
    - supabase/functions/generate-insight/fallback.ts
    - supabase/functions/generate-insight/payload.ts
    - supabase/functions/generate-insight/prompt.ts
    - supabase/functions/generate-insight/index.ts
  modified: []
decisions:
  - "Fallback template wording uses 'prior week' / 'last week' instead of 'prior 7d' / 'last 7 days' — the literal digit 7 leaked past the tautology self-check and violated the digit-guard contract"
  - "payload.ts implements real row→payload shaping (not a stub) so the deployed function produces meaningful data even without LLM"
  - "Deployed with --no-verify-jwt because pg_cron invokes with service-role bearer, not an end-user JWT"
metrics:
  duration: "~12min"
  completed: "2026-04-15"
  tasks: 2
  files: 5
requirements: [INS-01, INS-02, INS-04]
---

# Phase 5 Plan 03: generate-insight Edge Function Summary

One-liner: Supabase Edge Function deployed — loops tenants, calls Haiku 4.5 with tool-use, digit-guards the output, falls back to a deterministic template on any failure, and upserts one row per `(restaurant_id, business_date)` into `public.insights`. 14 Wave 0 Deno tests now GREEN (1 integration test stays ignored per 05-02).

## Tasks Completed

| Task | Name                                                             | Commit  | Files                                            |
| ---- | ---------------------------------------------------------------- | ------- | ------------------------------------------------ |
| 1    | Implement digitGuard, fallback, payload, prompt (TDD GREEN)      | 55c62a6 | digitGuard.ts, fallback.ts, payload.ts, prompt.ts |
| 2    | Implement index.ts orchestrator + deploy + smoke-test            | 1a2da24 | index.ts                                         |

## Verification

- `deno test --allow-env digit-guard.test.ts fallback.test.ts payload.test.ts` → 14 passed, 0 failed, 1 ignored
- `deno check index.ts` → exits 0, zero type errors
- `supabase functions deploy generate-insight --no-verify-jwt` → deployed to project `paafpikebsudoqxwumgm`
- Smoke curl → `200 {"results":[{"restaurant_id":"ba1bf707-...","ok":true,"fallback":true}]}`
- DB check → 1 row in `public.insights` for `2026-04-15`, fallback_used=true, model=`claude-haiku-4-5`
- Headline: `No transactions recorded today — €0 over the prior week.`
- Body: `Week-to-date revenue is €0 (— 0% vs prior week). No repeat customers in the last week.`

Fallback fired because (a) `ANTHROPIC_API_KEY` is not yet set as a function secret (deferred to 05-05 Vault provisioning), and (b) DEV seed data has no transactions for today's business_date. Both are expected; the plan explicitly accepts fallback-path writes as definition of done.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fallback template digit-leak ("7 days" / "7d")**
- **Found during:** Task 1 (running the tautology test)
- **Issue:** Plan's template literal strings `"prior 7d"` and `"last 7 days"` emit the digit `7`, which is not guaranteed to be in the input payload. The 5th fallback test (`tautology check`) computes the allowed-digit set from the 5 scalar inputs and asserts every output digit is in that set. The literal `7` fails unless a payload scalar happens to contain 7.
- **Fix:** Rewrote to `"prior week"` / `"last week"` — preserves the meaning, emits zero stray digits by construction. The plan's `grep -q "last 7 days"` acceptance criterion is a downstream casualty of this fix and was not enforced (the actual test contract is `assertStringIncludes(out.body, "No repeat customers")` which still matches).
- **Files modified:** supabase/functions/generate-insight/fallback.ts
- **Commit:** 55c62a6

**2. [Rule 3 - Blocker] Missing insights table in DEV**
- **Found during:** Task 2 smoke test (first curl returned `PGRST205 Could not find the table 'public.insights'`)
- **Issue:** 05-01 created migrations 0016/0017 but they were never pushed to the linked DEV project. The plan's Task 2 smoke test cannot upsert into a non-existent table.
- **Fix:** `supabase db push --linked --yes` applied both migrations. Smoke test then returned `ok:true` with a row visible via PostgREST.
- **Files modified:** none (migration files already existed)
- **Commit:** n/a (out-of-plan infra push, no code change)

## Known Gates (Not Deviations)

**ANTHROPIC_API_KEY not set as function secret** — expected per plan text: "05-05 README documents the manual step." Function falls back deterministically until 05-05 provisions the Vault secret. INS-04 (key via Deno.env.get, never committed, never in client) is satisfied regardless.

## Downstream Unlock

- **05-04** (InsightCard): reads from `public.insights_v` — now has at least 1 row to render against.
- **05-05** (forker walkthrough): sets ANTHROPIC_API_KEY Vault secret → flips `fallback_used=false` on next cron run.
- **05-02** Wave 0: all active Deno tests GREEN. `05-VALIDATION.md wave_0` one step closer (still need 05-04 vitest + 05-05 fork-dryrun to fully close).

## Self-Check: PASSED

- FOUND: supabase/functions/generate-insight/digitGuard.ts
- FOUND: supabase/functions/generate-insight/fallback.ts
- FOUND: supabase/functions/generate-insight/payload.ts
- FOUND: supabase/functions/generate-insight/prompt.ts
- FOUND: supabase/functions/generate-insight/index.ts
- FOUND commit: 55c62a6
- FOUND commit: 1a2da24
- FOUND: 1 row in public.insights (DEV, 2026-04-15, fallback_used=true)
- CONFIRMED: 14/14 active Deno tests green (`deno test --allow-env`)
- CONFIRMED: `deno check index.ts` exits 0
- CONFIRMED: no hardcoded `sk-ant-` or `eyJhbGciOi` in index.ts
- CONFIRMED: function deployed to DEV, smoke curl returns 200
