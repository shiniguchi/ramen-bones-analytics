---
type: backlog
captured: 2026-05-04
source: Phase 16 wave 4 close — owner Chrome MCP localhost review
target_phase: Phase 16.1 decimal (recommended — closes the loop on Phase 16's friend-persona acceptance) OR v1.4 polish
priority: high
status: captured
---

# CampaignUpliftCard — plain-language framing for non-statistical reader

Owner feedback (2026-05-04):

> "I don't know how to read 'Did the Apr 14, 2026 campaign work? CI overlaps zero — no detectable lift' chart."

## Context

Phase 16 shipped CampaignUpliftCard per RESEARCH §3 / SC#5, which assumes statistical literacy. Current copy:

- **Subtitle:** "Did the Apr 14, 2026 campaign work?"
- **Hero (when CI overlaps zero):** "CI overlaps zero — no detectable lift"
- **Point estimate:** "−€565 (95% CI −€3,745 ... +€2,298)"
- **Anticipation buffer note:** "Counterfactual fits on data ≥7 days before the campaign start (anticipation buffer)."
- **Naive disagreement:** "Naive baseline disagrees — review the methodology."

For a restaurant owner (Phase 16's primary persona — non-technical, banking-domain not statistics-domain), this reads as alphabet soup. The card's whole point is friend-owner can answer "did it work?" without a data team.

## What needs to happen

Rewrite the friend-facing copy in plain language while keeping the data underneath unchanged. Sketch:

| Current | Plain-language |
|---|---|
| "Did the Apr 14, 2026 campaign work?" | "Did your Apr 14 Instagram campaign bring in extra revenue?" |
| "CI overlaps zero — no detectable lift" | "**Probably not measurable yet** — too early to tell with 14 days of data" |
| "−€565 (95% CI −€3,745 ... +€2,298)" | "Best estimate: ~€565 less revenue than expected, but the range covers anywhere from €3,700 less to €2,300 more — that's normal day-to-day noise, not a confirmed loss" |
| "Counterfactual fits on data ≥7 days before campaign start" | (move to a tap-to-reveal tooltip — keep card lean) |
| "Naive baseline disagrees — review the methodology" | "Two of our checks disagree — we'd want more weeks of data before drawing conclusions" |

## Acceptance

- Friend-owner can read the card on her phone and **state in her own words what it's telling her**, without asking for a translation
- Statistical detail is still available (tap-to-reveal "How is this calculated?" panel)
- When CI is not overlapping zero, the copy adapts: "**Yes, your campaign appears to have ${added,reduced} revenue**" + qualifying CI range in plain words

## Out of scope for the plain-language rewrite

- Changing the underlying math (the −€565 / 95% CI [−€3,745, +€2,298] number stays)
- Moving to a different statistical methodology

## Open questions for plan-phase

- Should plain-language framing become the default and "show me the numbers" be a power-user toggle? (Probably yes, mobile-first / friend-owner persona.)
- Should the headline string vary based on n_days (e.g. day < 14: "too early", 14 ≤ day < 28: "early signal", day ≥ 28: confident framing)?
- After day 28 when CIs tighten, automatically re-render the card vs require manual refresh?
