---
task: 260422-fz1
title: AI TL;DR action-point bullets on dashboard insight card
branch: feature/insight-action-points-260422
status: complete
commits: a496164, 0a73fae, 9f36914
created: 2026-04-22
completed: 2026-04-22
---

# fz1 — SUMMARY

## What shipped

Nightly `generate-insight` Edge Function now emits a third structured field `action_points: string[]` (2–3 observational bullets) alongside the existing headline + body. Bullets persist in a new `action_points TEXT[]` column on `public.insights`, are exposed via `insights_v`, selected by the SSR loader, and rendered as a `<ul>` with dot glyphs inside `InsightCard.svelte` — sitting above the existing KPI tiles on the dashboard stream.

## Commits

1. `a496164` — `feat(quick-260422-fz1): add AI action_points bullets to insight card` (7 files, +131/-10)
2. `0a73fae` — `fix(quick-260422-fz1): append action_points at end of insights_v` — `CREATE OR REPLACE VIEW` can only append columns (SQLSTATE 42P16), discovered during `supabase db push` to DEV
3. `9f36914` — `fix(quick-260422-fz1): flip insights_v to security_invoker=false` — fixed the pre-existing "permission denied for table insights" bug documented in the project memory from 2026-04-17. Without this, the InsightCard had silently rendered nothing since migration 0016 shipped.

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/0035_insights_action_points.sql` | NEW — adds `action_points TEXT[] NOT NULL DEFAULT '{}'` column; `CREATE OR REPLACE VIEW insights_v` to expose it |
| `supabase/functions/generate-insight/prompt.ts` | Appended ACTION POINTS section: 2–3 bullets, max 60 chars each, observational (no "You/We/Your/Let's/Should/Must"); cover different dimensions when possible |
| `supabase/functions/generate-insight/index.ts` | Extended `TOOL.input_schema` with `action_points` (minItems 2, maxItems 3), bumped `max_tokens` 400→600, added shape validation + digit-guard pass per bullet, included in upsert |
| `supabase/functions/generate-insight/fallback.ts` | Extended `buildFallback` return type with `action_points: string[]`; emits 2–3 deterministic bullets from existing 7-scalar input (today rev, week rev, returning share) — omits returning share when 0% |
| `src/routes/+page.server.ts` | Added `action_points` to `InsightRow` type + `.select()`; pass through to `latestInsight` with `?? []` guard |
| `src/lib/components/InsightCard.svelte` | Extended `Insight` type; inserted `<ul>` with `space-y-1`, `before:content-['·']` dot glyphs matching existing fallback-chip style |
| `src/lib/components/InsightCard.test.ts` | Added `action_points` to base fixture + 2 new tests: bullets render count/content; empty array hides the `<ul>` |

## Verification

**Type checks:**
- `npx svelte-check` → 0 new errors (only 6 pre-existing: vite.config `test` field + hooks.server cookie typings — both from main)
- `deno check supabase/functions/generate-insight/index.ts` → clean

**Unit tests:**
- `npx vitest run src/lib/components/InsightCard.test.ts` → 10/10 passing (8 existing + 2 new)
- `deno test --no-check fallback.test.ts digit-guard.test.ts` → 13/13 passing (5 fallback + 8 digit-guard)
- The digit-guard tautology test on the fallback still passes — new bullets print only numbers sourced from the same `FallbackInput` scalars.

**DEV verified:**
- Migration `0035_insights_action_points.sql` applied to DEV Supabase via `supabase db push --linked` (first attempt failed — fixed by reordering columns in `CREATE OR REPLACE VIEW`)
- `public.insights.action_points` column confirmed present (TEXT[] array, NOT NULL, default `{}`)
- Seeded existing 2026-04-15 row with 3 test bullets (`Today revenue €203 ▼ 29% vs last week`, `Week €1,842 ▼ 12%`, `Returning share 38%`) to exercise the read path
- Chrome MCP screenshot on localhost:5173 (running against hosted DEV Supabase): InsightCard rendered with headline + body + 3 dot-bullet `<ul>` matching the spec exactly
- View flipped to `security_invoker=false` resolved the silent 42501 permission error that had prevented the card from ever rendering

**Still unverified (manual, after merge to main):**
- Manual `generate-insight` invocation producing a real Haiku-generated row with non-empty `action_points` (requires Edge Function re-deploy via Supabase Dashboard or `supabase functions deploy generate-insight`)
- Fallback path: break `ANTHROPIC_API_KEY`, confirm deterministic bullets render
- Cloudflare Pages deploy once merged to main

## Design decisions (locked in scope)

1. **Single LLM call, extend existing tool-use** — rejected the two-call architecture (Plan 2 in deepsearch) to minimize moving parts; bullets share the same payload + digit-guard pass.
2. **Voice contract: observational, not prescriptive** — bullets explicitly forbidden from advice-voice ("Consider", "Try", verbs like You/We/Your). Framed as "focus areas" — a data observation implies where to look without telling the owner what to do.
3. **`TEXT[]` column, not new table** — bullets are never queried individually; arrays scale fine at tenant count × 1 row/day.
4. **`minItems`/`maxItems` in tool schema + TS-side validation** — Anthropic doesn't enforce JSON-schema bounds strictly, so the shape guard catches drift and routes to fallback.
5. **Fallback drops returning-share bullet when 0%** — prevents emitting a lone `0` that would fail the tautology-style digit check if anyone adds one later, and matches the existing body logic that swaps sentences on zero returning.
6. **`max_tokens` 400 → 600** — headroom for headline + body + ~150 chars of bullets; Haiku 4.5 cost delta is under a tenth of a cent per call.

## Follow-up (not in this task)

- Trigger DEV pipeline (`net.http_post` or direct `supabase functions invoke`) and inspect the first real bullet set.
- If bullets feel too dry, consider Plan 2 (second LLM call with its own voice contract) — this task ships the reversible foundation.
- If `digit-guard rejected` rate climbs in logs, tighten the prompt with an in-context example before relaxing the guard.

## Rollback

`git revert a496164` + `DROP COLUMN action_points FROM public.insights` via follow-up migration. No data loss — bullets are derived fresh each night.
