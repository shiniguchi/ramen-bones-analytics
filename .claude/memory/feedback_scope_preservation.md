---
name: Route direction-change feedback to backlog, not current phase
description: When owner gives scope-expanding feedback during verification, capture it as backlog + recommend ship-first
type: feedback
---

During Phase 4 UAT, owner gave feedback describing a dashboard redesign (dropdown filters, chart-heavy layout, attribution analytics). The assistant recommended **ship v1.0 first, capture redesign as backlog** rather than expanding Phase 4 scope mid-flight. Owner approved ("i follow your rec").

**Why:** Aggressive 2-week MVP timeline. Mid-flight scope expansion on verification feedback is the classic way timelines slip. Shipping something rough to the friend unblocks real-world feedback; a perfect dashboard that never ships is strictly worse.

**How to apply:**
- When the owner signals direction changes during verification/UAT phases, pause and explicitly offer: (a) ship current scope as-is and capture feedback for next milestone, or (b) pause current phase and pivot. Do NOT silently expand scope.
- Capture verbatim feedback to `.planning/backlog/<topic>.md` with source attribution + date — do not paraphrase it into your own words
- If the feedback exposes bugs (not just new scope), log them as Gaps in the phase VERIFICATION.md with `status: open` so they surface in `/gsd:progress` and `/gsd:audit-uat` even though they're deferred
- Remind of the 2-week MVP constraint explicitly when recommending deferral — the constraint is the reason
