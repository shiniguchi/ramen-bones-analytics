# Phase 09 — Deferred Items

Items discovered during execution that are out-of-scope for the current plan.
Do not fix in 09-04; track for a future pass.

## Pre-existing TypeScript errors (unrelated to 09-04 scope)

Captured 2026-04-16 during `npx tsc --noEmit -p .` verification after 09-04
Task 2. Confirmed pre-existing via `git stash` — all 10 errors also present
with 09-04 changes reverted, so none were introduced by this plan.

```
src/hooks.server.ts(16,18): error TS7006: Parameter 'cookies' implicitly has an 'any' type.
src/hooks.server.ts(17,30): error TS7031: Binding element 'name' implicitly has an 'any' type.
src/hooks.server.ts(17,36): error TS7031: Binding element 'value' implicitly has an 'any' type.
src/hooks.server.ts(17,43): error TS7031: Binding element 'options' implicitly has an 'any' type.
src/hooks.server.ts(31,21): error TS2339: Property 'claims' does not exist on type '{ claims: JwtPayload; header: JwtHeader; signature: Uint8Array<ArrayBufferLike>; } | null'.
src/routes/+page.server.ts(71,6): error TS2339: Property 'catch' does not exist on type 'PromiseLike<DailyRow[]>'.
src/routes/+page.server.ts(81,10): error TS2339: Property 'catch' does not exist on type 'PromiseLike<DailyRow[]>'.
src/routes/+page.server.ts(90,6): error TS2339: Property 'catch' does not exist on type 'PromiseLike<RetentionRow[]>'.
tests/unit/cards.test.ts(140,7): error TS2578: Unused '@ts-expect-error' directive.
vite.config.ts(7,3): error TS2769: No overload matches this call.
```

None live in files touched by 09-04 (`dashboardStore.svelte.ts`,
`+page.svelte`, `tests/unit/dashboardStore.test.ts`). Address in a separate
type-hygiene pass or Phase 10.
