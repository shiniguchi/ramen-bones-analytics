---
status: pending
phase: 04-mobile-reader-ui
purpose: Adversarial human QA of the mobile reader dashboard against seeded DEV data
runner: human, on a real iPhone (or iOS Simulator) at 375px viewport
prerequisite: scripts/seed-demo-data.sql applied to DEV + refresh_analytics_mvs() executed
---

# Phase 4 — Human UAT Checklist

Run this against the DEV deployment (NOT localhost) on a real iPhone or iOS Simulator at 375×667. Sign in as the seeded test user. Take a screenshot at each `[ ]` step.

## Setup (one-time per session)
- [ ] Confirm DEV has seeded data: visit Supabase SQL editor and run `select count(*) from public.transactions where source_tx_id like 'demo-%';` — must return ≥ 60
- [ ] Confirm MVs are fresh: `select public.refresh_analytics_mvs();`
- [ ] Sign in to the DEV deployment URL as `iguchise@gmail.com`

## Section A — Freshness signal (closes Gap D blind spot 1)
- [ ] Freshness label is visible directly under the sticky chip bar
- [ ] Label text matches "Last updated Xh ago" (X is a number)
- [ ] If `MAX(ingested_at)` is < 30h ago, label is muted gray (default)
- [ ] (Optional) Force-stale test: temporarily push transactions.ingested_at back 36h via SQL; reload; confirm label flips yellow. Revert.

## Section B — All 9 cards have data (closes Gap D blind spot 2)
- [ ] Revenue · Today shows a € number (not "No transactions in this window")
- [ ] Revenue · 7d shows a € number
- [ ] Revenue · 30d shows a € number
- [ ] Tx count card shows a number
- [ ] Avg ticket card shows a € number with decimals
- [ ] Cohort retention card shows ≥ 1 line (curve) on the LayerChart svg
- [ ] LTV card shows ≥ 1 bar on the LayerChart svg
- [ ] Visit frequency card shows the 5 buckets (1, 2, 3–5, 6–10, 11+) with non-zero rows
- [ ] New vs returning card shows a stacked bar with all 3 segments labeled

## Section C — Chip scoping flips correct cards (closes Gap D blind spot 3)
- [ ] Default chip is `7d`
- [ ] Tap `30d`: Tx count and Avg ticket numbers change
- [ ] Tap `30d`: New vs returning bar changes (D-19a — the ONE chip-scoped analytics card)
- [ ] Tap `30d`: Revenue Today / 7d / 30d tiles do NOT change (they are fixed-window per D-06)
- [ ] Tap `30d`: Cohort retention curves do NOT change
- [ ] Tap `30d`: LTV bars do NOT change
- [ ] Tap `30d`: Visit frequency bars do NOT change
- [ ] URL contains `?range=30d` after the tap

## Section D — Grain toggle swaps cohort labels (closes Gap D blind spot 4)
- [ ] Cohort card's grain toggle defaults to `Week`
- [ ] Tap `Day` in the grain toggle: cohort labels in the legend / x-axis change to daily granularity
- [ ] Tap `Month`: labels switch to monthly
- [ ] LTV bars do NOT change when grain toggle changes (LTV is weekly-only in v1, per D-12)

## Section E — Console errors (closes Gap D blind spot 5)
- [ ] Open Safari Web Inspector (or Chrome DevTools remote)
- [ ] Reload the page
- [ ] Console shows ZERO red errors
- [ ] Specifically: no `scale.copy is not a function` (Gap A regression guard)
- [ ] Specifically: no `restaurant_id` undefined / `not provisioned` redirect loop (Gap B regression guard)

## Section F — Layout sanity (UI-11 PR template)
- [ ] Single column at 375px (no horizontal scroll)
- [ ] Header has "Ramen Bones" + logout glyph
- [ ] Chip bar is sticky on scroll
- [ ] No text smaller than 12px

## Sign-off
- [ ] All sections above passed
- [ ] Screenshots attached to the PR / commit
- [ ] Tester signs: ___________________
- [ ] Date: ___________________

---

If any item fails, do NOT mark Phase 4 complete. File a new gap in `04-VERIFICATION.md` and re-run `/gsd:plan-phase 4 --gaps`.
