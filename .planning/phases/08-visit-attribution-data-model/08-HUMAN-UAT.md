---
status: partial
phase: 08-visit-attribution-data-model
source: [08-VERIFICATION.md]
started: 2026-04-16T15:10:00Z
updated: 2026-04-16T15:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Dashboard renders at 375px without dead cards
expected: Revenue KPI cards + Cohort Retention chart visible; FrequencyCard, LtvCard, NewVsReturningCard, CountryMultiSelect gone
result: [pending]

### 2. Nightly refresh cron includes visit_attribution_mv
expected: `SELECT refresh_analytics_mvs()` on DEV completes without error; visit_attribution_mv has rows
result: [pending]

### 3. visit_seq accuracy on real data
expected: Query `SELECT card_hash, visit_seq FROM visit_attribution_v ORDER BY card_hash, visit_seq` shows correct sequential numbering for 3+ card_hash values
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
