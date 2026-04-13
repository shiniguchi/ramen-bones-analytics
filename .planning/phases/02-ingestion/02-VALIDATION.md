---
phase: 2
slug: ingestion
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-14
updated: 2026-04-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing from Phase 1) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/ingest/` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/ingest/`
- **After every plan wave:** `npm run test`
- **Before `/gsd:verify-work`:** Full suite + `bash scripts/ci-guards.sh` must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 1 | ING-01 | migration | `psql -f supabase/migrations/0007_stg_orderbird_order_items.sql && bash scripts/ci-guards.sh` | ❌ | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | ING-03, ING-04 | migration | `psql -f supabase/migrations/0008_transactions_columns.sql && psql -f supabase/migrations/0009_storage_bucket.sql && bash scripts/ci-guards.sh` | ❌ | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | ING-05 | fixture | `test $(wc -l < tests/ingest/fixtures/sample.csv) -ge 25 && head -1 tests/ingest/fixtures/sample.csv \| tr ',' '\n' \| wc -l \| grep -q '^29$'` | ❌ W0 | ⬜ pending |
| 02-02-T2 | 02-02 | 1 | ING-01..05 | test-stub | `npx vitest run tests/ingest/ 2>&1 \| grep -E 'Cannot find module\|Test Files'` | ❌ W0 | ⬜ pending |
| 02-03-T1 | 02-03 | 2 | ING-03, ING-04 | unit | `npx vitest run tests/ingest/hash.test.ts tests/ingest/normalize.test.ts && bash scripts/ci-guards.sh` | ❌ W0 (depends on 02-02-T2) | ⬜ pending |
| 02-03-T2 | 02-03 | 2 | ING-01, ING-02 | dry-run | `npx tsx scripts/ingest/index.ts --dry-run 2>&1 \| grep -q '"rows_read"'` | ❌ | ⬜ pending |
| 02-04-T1 | 02-04 | 3 | ING-01, ING-02 | integration | `npx vitest run tests/ingest/loader.test.ts tests/ingest/idempotency.test.ts` | ❌ W0 (depends on 02-02-T2) | ⬜ pending |
| 02-04-T2 | 02-04 | 3 | ING-05 | artifact | `test -f .planning/phases/02-ingestion/02-04-REAL-RUN.md && grep -q rows_read .planning/phases/02-ingestion/02-04-REAL-RUN.md && grep -q '## Ingestion' README.md` | ❌ | ⬜ pending |
| 02-04-T3 | 02-04 | 3 | ING-05 | checkpoint:human-verify | manual — founder spot-checks 25 real rows in DEV SQL editor | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Requirement Coverage

| Requirement | Plans | Tasks |
|-------------|-------|-------|
| ING-01 (CSV → staging upsert) | 02-01, 02-02, 02-03, 02-04 | 02-01-T1, 02-02-T2, 02-03-T2, 02-04-T1 |
| ING-02 (idempotent on `(restaurant_id, invoice_number)` / `(restaurant_id, source_tx_id)`) | 02-01, 02-03, 02-04 | 02-01-T1, 02-03-T2, 02-04-T1 |
| ING-03 (normalization: voids/refunds/tips/brutto/netto) | 02-01, 02-03 | 02-01-T2, 02-03-T1 |
| ING-04 (sha256 card_hash pre-write, cash NULL) | 02-01, 02-02, 02-03 | 02-01-T1/T2, 02-02-T2, 02-03-T1 |
| ING-05 (founder reviews ≥20 real rows) | 02-02, 02-04 | 02-02-T1, 02-04-T2, 02-04-T3 (human checkpoint) |

All five requirements covered. ING-02 wording in REQUIREMENTS.md says `source_tx_id = order_id` but CONTEXT D-04 overrides to `source_tx_id = invoice_number` — plans follow CONTEXT.

---

## Wave 0 Requirements (Plan 02-02 delivers all)

- [ ] `tests/ingest/fixtures/sample.csv` — 24+ rows covering 11 D-21 scenarios + DST row + missing-wl_card_number row (02-02-T1)
- [ ] `tests/ingest/fixtures/README.md` — scenario-to-decision map, ING-05 fixture artifact
- [ ] `tests/ingest/hash.test.ts` — ING-04 RED stubs (02-02-T2)
- [ ] `tests/ingest/normalize.test.ts` — ING-03 RED stubs (02-02-T2)
- [ ] `tests/ingest/loader.test.ts` — ING-01 RED stubs (02-02-T2)
- [ ] `tests/ingest/idempotency.test.ts` — ING-02 RED stubs (02-02-T2)

Wave 0 completion flips `wave_0_complete: true` in frontmatter after 02-02 lands.

---

## Wave Structure

| Wave | Plans | Parallel? | Notes |
|------|-------|-----------|-------|
| 1 | 02-01 (schema) + 02-02 (fixture + stubs) | Yes — disjoint files | 02-01 touches migrations + pii-columns; 02-02 touches tests/ingest/ only |
| 2 | 02-03 (loader impl) | Sequential | Depends on 02-01 (tables exist) and 02-02 (tests exist to turn GREEN) |
| 3 | 02-04 (integration + UAT) | Sequential | Depends on 02-03; contains founder checkpoint |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder confirms ≥20 real CSV rows' interpretation matches business reality | ING-05 | Human domain judgment on voids/tips/brutto semantics; no automated oracle exists | Task 02-04-T3 checkpoint: run the queries in that task's `how-to-verify` block against DEV and compare against raw CSV rows |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify OR a Wave 0 dependency + human checkpoint for the one manual-only task
- [x] Sampling continuity: every auto task in wave 2/3 has an automated command, no 3 consecutive tasks lack verification
- [x] Wave 0 covers all MISSING references (sample.csv + 4 test stubs from 02-02)
- [x] No watch-mode flags (`vitest run` not `vitest`)
- [x] Feedback latency < 15s (unit tests only; integration tests bounded by TEST project roundtrip)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready for execution
