---
status: partial
phase: 04-mobile-reader-ui
purpose: Adversarial human QA of the mobile reader dashboard against seeded DEV data
runner: human, on a real iPhone (or iOS Simulator) at 375px viewport
prerequisite: scripts/seed-demo-data.sql applied to DEV + refresh_analytics_mvs() executed
walkthrough_2026-04-15: Chrome MCP localhost walkthrough — signed off by owner with two known issues (see Gaps E + F in 04-VERIFICATION.md). Real-iPhone run still pending for final PR gate.
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
- [x] Localhost walkthrough (Chrome MCP) — 2026-04-15
- [ ] Real iPhone walkthrough against deployed DEV (pending, deferred to PR gate)
- [x] Screenshots captured by assistant during walkthrough (in session)
- **Tester signs:** owner (via assistant, Chrome MCP on macOS at 512×494 — not a true 375px run)
- **Date:** 2026-04-15

### Findings from the 2026-04-15 walkthrough

Gap A regression guard holds (zero `scale.copy is not a function` errors post-reload). Gap B regression guard holds (no `/not-provisioned` redirect). Chip scoping for the KPI tiles works: `7d → 30d → all` moves the Transactions count `104 → 716 → 6.842` and the Avg ticket delta labels update from "vs prior 7d" → "vs prior 30d" → "no prior data". Cohort retention, LTV-to-date, Visit frequency stay stable across chip changes (D-19a chip-INDEPENDENT contract holds for those three). Cohort chart renders with a Week grain default and the Day/Week/Month toggle is present. LTV card renders with bars. Visit frequency renders all 5 buckets (1v=3947, 2v=353, 3–5v=131, 6–10v=21, 11+v=2). Freshness label reads "Last updated 22 hours ago" which is correct for a dev DB that last refreshed MVs yesterday.

**Two genuine issues surfaced — logged as Gap E and Gap F in 04-VERIFICATION.md:**
- **Gap E:** New-vs-Returning card renders "No sales recorded in this window" on every chip including `range=all`. D-19a chip-scoping cannot be verified because the card never populates.
- **Gap F:** LTV chart shows only 3 weekly bars (`2026-03-09/16/23`, €30–32) on `range=all` despite the 10-months-of-history caveat. `ltv_mv` is either sparse or the loader has a hard-coded window.

Both are pre-existing bugs from plans 04-04/04-05 that Gap D's adversarial QA layer was built to surface — **this is exactly the charter of plan 04-09**. They will be fixed inside the post-v1.0 Dashboard Redesign milestone (see `.planning/backlog/dashboard-redesign.md`) rather than patched on the v1.0 dashboard.

The real-iPhone run against the deployed DEV URL is still pending — we don't have a deployed DEV URL yet (Phase 4 was the first frontend code in the repo; no Cloudflare Pages deployment exists). Defer to the PR gate when DEV is live.

---

If any item fails, do NOT mark Phase 4 complete. File a new gap in `04-VERIFICATION.md` and re-run `/gsd:plan-phase 4 --gaps`.
