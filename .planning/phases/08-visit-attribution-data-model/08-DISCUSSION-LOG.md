# Phase 8: Visit Attribution Data Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 08-visit-attribution-data-model
**Areas discussed:** MV shape & visit_seq grain, is_cash derivation rule, Dead code cleanup scope, Blackout handling in visit_seq

---

## MV shape & visit_seq grain

### Q1: Should visit_seq live in its own dedicated MV, or extend cohort_mv?

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated MV | New visit_attribution_mv with one row per transaction. Clean separation — cohort_mv stays per-customer. Independent refresh. | ✓ |
| Extend cohort_mv | Add visit_seq as column to cohort_mv. Fewer MVs but changes grain from per-customer to per-transaction (breaking change). | |
| Join-based view (no new MV) | Compute visit_seq as a plain view. No materialization overhead but ROW_NUMBER on every query. | |

**User's choice:** Dedicated MV (Recommended)
**Notes:** None

### Q2: Should the MV include ALL transactions or only card transactions?

| Option | Description | Selected |
|--------|-------------|----------|
| All transactions | One row per transaction. Cash rows get visit_seq=NULL, is_cash=true. Universal join target. | ✓ |
| Card-only transactions | Only rows where card_hash IS NOT NULL. Smaller MV but charts need separate cash UNION. | |

**User's choice:** All transactions (Recommended)
**Notes:** None

### Q3: Should visit_seq count across ALL payment types for a card_hash?

| Option | Description | Selected |
|--------|-------------|----------|
| All transactions for that card_hash | ROW_NUMBER partitioned by card_hash. Simple. | ✓ |
| You decide | Let Claude pick the counting approach. | |

**User's choice:** All transactions for that card_hash (Recommended)
**Notes:** None

---

## is_cash derivation rule

### Q1: How should is_cash be derived?

| Option | Description | Selected |
|--------|-------------|----------|
| card_hash IS NULL | Consistent with Phase 2/3 convention. Covers blackout edge cases. | ✓ |
| payment_method = 'Bar' | Explicit intent-based. German POS label for cash. Blackout misclassification risk. | |
| Hybrid: both conditions | Strictest. Adds third 'unknown' category. Most honest but more complex. | |

**User's choice:** card_hash IS NULL (Recommended)
**Notes:** None

---

## Dead code cleanup scope

### Q1: How should Phase 8 handle dropping views that are still referenced in the UI?

| Option | Description | Selected |
|--------|-------------|----------|
| Full cleanup in Phase 8 | Drop SQL views + all frontend references. Dashboard temporarily loses cards. | ✓ |
| SQL-only in Phase 8, UI in Phase 9 | Drop SQL views but leave UI broken between phases. | |
| Defer all drops to Phase 9 | Phase 8 only creates new MV. Dead code stays longer. | |

**User's choice:** Full cleanup in Phase 8 (Recommended)
**Notes:** None

### Q2: Should the country filter parameter be removed entirely or just hidden from UI?

| Option | Description | Selected |
|--------|-------------|----------|
| Remove entirely | Drop from filtersSchema, remove component, remove server function. Clean break. | ✓ |
| Keep in schema, hide from UI | Remove component but leave param as no-op. Less risky but dead code. | |

**User's choice:** Remove entirely (Recommended)
**Notes:** None

---

## Blackout handling in visit_seq

### Q1: Should visit_attribution_mv exclude the April 2026 Worldline blackout transactions?

| Option | Description | Selected |
|--------|-------------|----------|
| No exclusion needed | Blackout transactions already have card_hash=NULL → is_cash=true, visit_seq=NULL naturally. | ✓ |
| Exclude blackout period | Same date-range exclusion as cohort_mv. Adds 'unknown' state. | |
| Flag but don't exclude | Add is_blackout boolean column. Most flexible but unnecessary for most restaurants. | |

**User's choice:** No exclusion needed (Recommended)
**Notes:** None

---

## Claude's Discretion

- Migration file numbering and splitting
- Exact position of visit_attribution_mv in refresh DAG
- Test fixture design
- Whether payment_method filter param should also be removed (deferred to Phase 9)

## Deferred Ideas

- payment_method filter param removal (Phase 9 scope)
- Visit-count bucket labels for charts (Phase 10 scope)
