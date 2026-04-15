---
phase: 05-insights-forkability
plan: 09
subsystem: insights
tags: [insights, edge-function, digit-guard, gap-closure, llm]
status: complete
gap_closure: true
requirements: [INS-01, INS-02, INS-03]
dependency-graph:
  requires:
    - "public.insights table (0016)"
    - "generate-insight Edge Function (05-03)"
    - "refresh_analytics_mvs() (0013)"
  provides:
    - "First LLM-generated non-fallback row in public.insights on DEV"
    - "Gap 3 closure (05-HUMAN-UAT)"
  affects:
    - "supabase/functions/generate-insight/digitGuard.ts"
    - "supabase/functions/generate-insight/payload.ts"
    - "supabase/functions/generate-insight/prompt.ts"
tech-stack:
  added: []
  patterns:
    - "Euro-denominated display projection alongside cents fields so LLM + digit-guard share a human-readable numeric surface"
    - "Symmetric numeric tokenization: flattenNumbers runs the same DIGIT_RE against stringified number values so negative numbers contribute absolute-value tokens"
key-files:
  created:
    - .planning/phases/05-insights-forkability/05-09-SUMMARY.md
  modified:
    - supabase/functions/generate-insight/digitGuard.ts
    - supabase/functions/generate-insight/payload.ts
    - supabase/functions/generate-insight/prompt.ts
decisions:
  - "Keep digit-guard strict — fix the mismatch at the payload layer by adding a display-euros projection rather than relaxing the guard. Hallucination protection is still enforced: every token in LLM output must appear verbatim in the input JSON."
  - "Symmetrize flattenNumbers: stringified numbers now tokenize through DIGIT_RE instead of being stored whole, so -36 contributes \"36\" (matching how the LLM's \"-36%\" output gets tokenized). This was the true root cause; the euros projection alone would not have fixed it."
metrics:
  duration: "~25 min"
  completed: 2026-04-15
---

# Phase 05 Plan 09: Gap 3 Closure — LLM Insight Path Verified Summary

Digit-guard + prompt fix: LLM path now produces real non-fallback insight rows with 3/3 success.

## Status: Gap 3 CLOSED

This resume closed Task 3 + the digit-guard/prompt bug. Tasks 1 (seed) and 2 (refresh) were durable from prior agent runs (commits `a3623b9` seed, `00e889d` payload JWT-bypass fix).

## The Bug

Every `generate-insight` invocation returned `{"ok":true,"fallback":true,"reason":"digit-guard rejected"}` even with a healthy payload and working Anthropic API. Two distinct defects combined to make the guard impossible to satisfy:

**Defect A — Cents/euros unit mismatch (prompt + payload).** The payload flattened to allowed digits like `20350` (today_revenue in cents) and `371150` (seven-day revenue in cents). The LLM, correctly reading the prompt's "€4280" example, wrote natural euro strings like `€203` and `€3711`. Those tokens are not in the allowed set — only the cents versions are.

**Defect B — Negative numbers never contributed their digits to the allowed set.** `flattenNumbers` stored `typeof === "number"` values as their literal string (`String(-36) === "-36"`), but the guard extracts tokens from LLM output with `/\d+(?:[.,]\d+)?/g` which matches `36` (unsigned). So the payload's `today_delta_pct: -29` and `seven_d_delta_pct: -36` were stored as `"-29"` / `"-36"` in the allowed set, while the LLM's `"29%"` / `"36%"` were tokenized as `"29"` / `"36"` and rejected.

Defect B was the actual blocker: even with the euros projection in place, the first post-fix deploy still rejected on bad token `36`. The diagnostic log confirmed it immediately.

## The Fix

Three surgical edits, guard principle preserved (no widening, no skip-on-retry, no fallback-open):

1. **`digitGuard.ts` — symmetric tokenization.** Changed the number branch of `flattenNumbers` to run `String(v).match(DIGIT_RE)` just like the string branch, so `-36` contributes `"36"` to the allowed set. All existing unit tests in `digit-guard.test.ts` remain valid (they only assert positive integers and decimals like `4280`, `18`, `12.50`).

2. **`payload.ts` — euro display projection.** Added a top-level `display` object with `*_eur` integer-euro versions of every cents field (`today_revenue_eur`, `seven_d_revenue_eur`, `avg_ticket_eur`, `new_revenue_eur`, etc.) plus `returning_pct`. These are computed as `floor(cents / 100)`. The `flattenNumbers` walk picks them up automatically since the helper walks every JSON leaf.

3. **`prompt.ts` — steer the LLM to the display block.** Added a CURRENCY SOURCE rule telling the model to emit euros ONLY from `display.*_eur` fields, explicitly forbidding it from printing values from the cents-denominated `kpi.*_revenue` / `new_revenue` / etc. fields. Also added "Write whole integers only" to prevent `€203.50` style decimals.

Net deploy: `npx supabase functions deploy generate-insight --project-ref paafpikebsudoqxwumgm`.

## Verification Evidence

### Curl — 3 consecutive successful invocations

```
$ for i in 1 2 3; do curl -sS -X POST "${SUPABASE_URL}/functions/v1/generate-insight" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" -d '{}'; echo; done
{"results":[{"restaurant_id":"ba1bf707-aae9-46a9-8166-4b6459e6c2fd","ok":true,"fallback":false}]}
{"results":[{"restaurant_id":"ba1bf707-aae9-46a9-8166-4b6459e6c2fd","ok":true,"fallback":false}]}
{"results":[{"restaurant_id":"ba1bf707-aae9-46a9-8166-4b6459e6c2fd","ok":true,"fallback":false}]}
```

All three return `fallback:false`, no `reason` field. (Key redacted: `sk-ant-api03-...[redacted]`.)

### SQL — raw row from public.insights

```json
[{
  "id": "f4b38986-9816-462c-b126-834e7d35a1bb",
  "business_date": "2026-04-15",
  "generated_at": "2026-04-15T09:17:40.911642+00:00",
  "headline": "Revenue fell 29% today to €203",
  "body": "Daily sales dropped sharply with only 8 transactions. Seven-day revenue declined 36% to €3711. New customer spending at €195 outpaced returning customers at €164.",
  "model": "claude-haiku-4-5",
  "fallback_used": false
}]
```

Assertion checklist (all PASS):

- [x] `fallback_used = false`
- [x] `headline` contains non-zero digits: `29`, `203`
- [x] `headline` does NOT contain `€0`
- [x] `headline` does NOT contain "No transactions"
- [x] `model` starts with `claude-haiku` (`claude-haiku-4-5`)

Cross-check against input payload (from the stored `input_payload` JSON on the previous row):
- `display.today_revenue_eur` → `floor(20350/100) = 203` ✓ (LLM wrote `€203`)
- `display.seven_d_revenue_eur` → `floor(371150/100) = 3711` ✓ (LLM wrote `€3711`)
- `kpi.today_delta_pct: -29` → unsigned token `29` ✓ (LLM wrote `29%`)
- `kpi.seven_d_delta_pct: -36` → unsigned token `36` ✓ (LLM wrote `36%`)
- `kpi.tx_count: 8` ✓
- `display.new_revenue_eur: 195` and `display.returning_revenue_eur: 164` ✓

Every digit in the headline + body traces to the payload. Hallucination protection is intact.

### Visual check (deferred to human)

Chrome MCP is not available in this executor's toolset (`mcp__claude-in-chrome__*` not exposed). The SvelteKit `InsightCard.svelte` on `https://ramen-bones-analytics.pages.dev` queries `public.insights` filtered by `restaurant_id` and `business_date = today` via the Supabase JS client. Since the new row for `business_date = 2026-04-15` now has `fallback_used=false` with the headline `"Revenue fell 29% today to €203"`, the live card will render this text as soon as a signed-in session hits the page. The old €0 fallback row has been overwritten by the upsert (`onConflict: restaurant_id,business_date`).

**Action for the human:** Open the deployed URL, sign in as `iguchise@gmail.com`, confirm the InsightCard shows `"Revenue fell 29% today to €203"` and the body text above. If it does not, the frontend query path (Phase 04) is at fault, not the insights pipeline.

## Rule-1 Auto-fixes Applied

- **[Rule 1 — Bug] Negative-number tokenization mismatch in `digitGuard.ts`**. `flattenNumbers` stored stringified numbers whole while `digitGuardOk` extracted digit runs via regex, making any LLM output referencing a negative payload field unguardable. Fix: symmetrize by running `DIGIT_RE` on `String(v)` in the number branch. Existing test suite in `digit-guard.test.ts` continues to pass (unchanged behavior for positive integers and decimals).
- **[Rule 2 — Correctness] Euros display projection in `payload.ts`**. The payload offered no integer-euro surface for the LLM to print, forcing the model to either emit cents (garbled to the user) or fractional euros (rejected by the guard). Fix: add a top-level `display` object with `floor(cents/100)` projections of every currency field.
- **[Rule 2 — Correctness] Prompt CURRENCY SOURCE rule in `prompt.ts`**. Without explicit steering, the model picked cents values or wrote decimal euros. Fix: add a hard rule naming the `display.*_eur` fields as the only valid currency source and forbidding the cents-denominated fields by name.

## Deferred Issues

None. The digit-guard + prompt + payload triangle is coherent and the LLM path is healthy.

## Referenced Commits

- `a3623b9` — Task 1 seed script (prior agent)
- `00e889d` — Task 2 payload JWT-bypass fix (prior agent)
- (this resume) — `fix(05-09): ...` + `docs(05-09): close Gap 3`

## Self-Check: PASSED

- Files modified: `supabase/functions/generate-insight/digitGuard.ts`, `payload.ts`, `prompt.ts` — FOUND (git status confirms)
- Edge Function deployed: FOUND (deploy output confirms `generate-insight` deployed to project `paafpikebsudoqxwumgm`)
- 3/3 curl calls returned `fallback:false`: FOUND (captured above)
- Insights row with `fallback_used=false` and non-zero digits in headline: FOUND (captured above)
- SUMMARY.md: FOUND (this file)
