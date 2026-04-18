# Retention Math Audit — Feb 9 Cohort

**Date:** 2026-04-18
**Verdict:** **MATH CORRECT — user confusion stems from (a) tooltip label, (b) underlying card_hash stability, not the SQL.**

## TL;DR

- `retention_curve_v` math is internally consistent with `cohort_mv` and raw `transactions`.
- The Feb 9 cohort genuinely has 107 customers and only 3 of them ever returned (1 at wk3, 2 at wk4). The 2% / 0.93% / 1.87% bars are accurate.
- The tooltip string `"2% · 100 cust"` is a UX trap: **"100 cust" is the cohort ACQUISITION size (107 rounded in the user's memory), NOT the number of retained customers at that period.** The user read it as "100 came back" when it actually means "100 were acquired, of which 2% (≈2 people) came back."
- Restaurant serves ~130-170 carded customers/week, not 200. The user's "200/week" estimate was 30–50% too high.
- Universe parity between `cohort_mv` and `retention_curve_v`: ✓ identical (both exclude cash card_hash IS NULL + Worldline blackout 2026-04-01..04-12).

## Ground truth numbers

### Restaurant

| id | name | tz |
|---|---|---|
| `ba1bf707-aae9-46a9-8166-4b6459e6c2fd` | Ramen Shop (v1 tenant) | Europe/Berlin |

### `retention_curve_v` for cohort_week = 2026-02-09

```sql
SELECT * FROM public.test_retention_curve('ba1bf707-aae9-46a9-8166-4b6459e6c2fd'::uuid)
WHERE cohort_week = '2026-02-09' ORDER BY period_weeks LIMIT 30;
```

Observed (trimmed to non-NULL rows — all rows beyond `period_weeks >= 9` are NULL-masked by 0028):

| cohort_week | cohort_size_week | period_weeks | retention_rate  | cohort_age_weeks |
|-------------|------------------|--------------|-----------------|------------------|
| 2026-02-09  | 107              | 0            | 1.0000          | 9                |
| 2026-02-09  | 107              | 1            | 0.0000          | 9                |
| 2026-02-09  | 107              | 2            | 0.0000          | 9                |
| 2026-02-09  | 107              | 3            | 0.0093          | 9                |
| 2026-02-09  | 107              | 4            | 0.0187          | 9                |
| 2026-02-09  | 107              | 5            | 0.0000          | 9                |
| 2026-02-09  | 107              | 6            | 0.0000          | 9                |
| 2026-02-09  | 107              | 7            | 0.0000          | 9                |
| 2026-02-09  | 107              | 8            | 0.0000          | 9                |
| 2026-02-09  | 107              | 9-260        | NULL (horizon)  | 9                |

### Cross-check #2: cohort size against `cohort_mv` raw

```sql
SELECT COUNT(DISTINCT card_hash) FROM cohort_mv
WHERE restaurant_id = '...' AND first_visit_business_date BETWEEN '2026-02-09' AND '2026-02-15';
-- 107
```

Matches `cohort_size_week = 107`. ✓

### Cross-check #3: retained counts vs raw `transactions`

Reproducing the view's bucketing on raw tx:

```sql
WITH c AS (
  SELECT card_hash, first_visit_at FROM cohort_mv
  WHERE restaurant_id = '...' AND cohort_week = '2026-02-09'
),
visits AS (
  SELECT floor(extract(epoch from (t.occurred_at - c.first_visit_at)) / (7 * 86400))::int AS period_weeks,
         c.card_hash
  FROM c JOIN transactions t USING (card_hash)
  WHERE t.restaurant_id = '...'
    AND NOT (t.occurred_at >= '2026-04-01' AND t.occurred_at < '2026-04-12')
)
SELECT period_weeks, COUNT(DISTINCT card_hash) AS retained,
       ROUND(COUNT(DISTINCT card_hash)::numeric / 107 * 100, 2) AS pct
FROM visits GROUP BY period_weeks ORDER BY period_weeks;
```

| period_weeks | retained | pct   |
|--------------|----------|-------|
| 0            | 107      | 100.00 |
| 3            | 1        | 0.93  |
| 4            | 2        | 1.87  |

Matches the view output exactly. ✓

### The three retained customers (proof they're real)

```
 card_prefix | first_visit_berlin  | return_visit_berlin | period_weeks
-------------+---------------------+---------------------+--------------
 3cdbe2df    | 2026-02-11 21:17:33 | 2026-03-07 19:53:06 |      3
 abac7e49    | 2026-02-15 12:06:45 | 2026-03-15 12:42:50 |      4
 d25a9374    | 2026-02-14 19:51:00 | 2026-03-21 12:33:41 |      4
```

Real data, real timestamps. Not a bug.

### Cross-check #4: weekly distinct-customer totals (the "~200/week" claim)

```sql
SELECT date_trunc('week', (occurred_at AT TIME ZONE 'Europe/Berlin'))::date AS biz_week,
       COUNT(DISTINCT card_hash) AS distinct_carded
FROM transactions WHERE restaurant_id = '...' AND card_hash IS NOT NULL
  AND (occurred_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN '2026-01-26' AND '2026-04-15'
GROUP BY 1 ORDER BY 1;
```

| biz_week   | distinct_carded | tx_count |
|------------|----------------|----------|
| 2026-01-26 | 115 | 118 |
| 2026-02-02 | 136 | 137 |
| 2026-02-09 | 139 | 140 |
| 2026-02-16 | 139 | 140 |
| 2026-02-23 | 130 | 130 |
| 2026-03-02 | 135 | 138 |
| 2026-03-09 | 148 | 151 |
| 2026-03-16 | 141 | 143 |
| 2026-03-23 | 171 | 174 |
| 2026-03-30 | 51  | 59  |
| 2026-04-06 | 8   | 21  |
| 2026-04-13 | 8   | 14  |

Observation: carded weekly distinct is 115-171, NOT ~200. User overestimated. On Feb 9 specifically: 139 distinct cards were seen, of which 107 were NEW (first-ever visit) and 32 were returning from an earlier cohort.

## Universe parity: cohort_mv vs retention_curve_v

Both filter identically:
- `card_hash IS NOT NULL` (cash excluded): cohort_mv migration 0010 L16, retention_curve_v reads cohort_mv which already has that filter applied
- Worldline blackout `2026-04-01..04-12`: cohort_mv L17-20, retention_curve_v L42-45 (and 0028 L47-50)
- Tenant scope via `auth.jwt()->>'restaurant_id'`: both ✓

No discrepancy in universe. Retention numerator and denominator come from the same card_hash pool.

## Cohort-size distribution (sanity check on data at large)

```sql
-- 10 months of data, all cards:
-- total_tx=5316, distinct_cards=4462, tx_per_card=1.19
-- 3947/4462 (88%) of customers are single-visit across 10 months
```

This is the headline: **88% of all ever-seen cards in 10 months visited once.** That's why cohort retention looks so flat. The retention math mirrors reality in the table. If the owner thinks retention should be higher, the real question is upstream of the chart — **is `card_hash` stable across return visits for the same human?** (Tokenization by POS may mint a fresh hash per card presentation. That's a data-pipeline question, not a retention-view bug.)

## Actual math bugs found

**None** in `retention_curve_v` or `cohort_mv`.

## UX issue (not a SQL bug, but worth flagging)

`src/lib/components/CohortRetentionCard.svelte:179`:

```svelte
value={`${Math.round(r.rate * 100)}% · ${r.size} cust`}
```

where `r.size` is `cohort_size_week` (line 169) — the **cohort acquisition size**, not the count retained at the hovered period.

On the Feb 9 cohort at period 4, a phone-user sees:

> `2% · 107 cust`

They read this as "2% retention and 107 customers came back" → confusion. It actually means "2% retention of the original 107-customer cohort, so ~2 people came back."

Proposed fix (single line) at `src/lib/components/CohortRetentionCard.svelte:177-180`:

```svelte
<Tooltip.Item
  label={r.cohort}
  value={`${Math.round(r.rate * 100)}% of ${r.size} (${Math.round(r.rate * r.size)} came back)`}
/>
```

Or simpler:

```svelte
value={`${Math.round(r.rate * r.size)} / ${r.size} (${Math.round(r.rate * 100)}%)`}
```

Either variant resolves the user's misread without touching SQL.

## Verdict

- `retention_curve_v` SQL: **MATH CORRECT**
- `cohort_mv` SQL: **MATH CORRECT**
- UI tooltip copy at `CohortRetentionCard.svelte:179`: **AMBIGUOUS — worth a copy tweak** (small UX fix, not a bug)
- Restaurant's weekly volume: 115–171 carded customers, not 200
- Underlying concern for the owner: ~88% single-visit card rate across 10 months is extreme. Either genuine one-timers (tourists?) OR card_hash isn't stable across returning same-human visits. That's a data-pipeline investigation — outside this audit's scope.
