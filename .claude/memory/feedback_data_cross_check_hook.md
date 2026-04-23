---
name: data-cross-check-nudge hook fires on chart-card edits
description: PostToolUse hook in .claude/hooks/data-cross-check-nudge.js triggers a SQL-vs-rendered cross-check protocol whenever a chart-card component is edited.
type: feedback
---

A second PostToolUse hook (`data-cross-check-nudge.js`) sits next to `visual-verify-nudge.js` in `.claude/hooks/`. It fires ONLY on edits to chart-card components — paths matching `pathContains` rules in `cross-check-targets.json`. Currently mapped: `CalendarRevenueCard`, `CalendarCountsCard`, `CalendarItemsCard`, `CalendarItemRevenueCard`, `CohortRetentionCard`, `DailyHeatmapCard`, `RepeaterCohortCountCard`, `KpiTile`.

The reminder forces a strict protocol: extract rendered values from the DOM via Chrome MCP, run the equivalent SQL against the chart's canonical source view via `mcp__supabase-dev__query`, compare row-by-row. PASS requires zero deltas under a NON-default filter combination AND every active filter dim referenced in any local `.filter()` derivation.

**Why:** The 2026-04-20 incident where `CalendarItemsCard` + `CalendarItemRevenueCard` silently showed all-days data when Sat-Sun was selected (their local `.filter()` didn't include the new `days` dimension) was invisible without SQL diff. The visual-verify hook only checks pixels render; it doesn't catch wrong numbers.

**How to apply:**
- When adding a new chart-card component: add a rule to `.claude/hooks/cross-check-targets.json` mapping it to its canonical source view + bucketing semantics. Without the rule, the hook skips it (intentional — narrowly scoped trigger).
- When the protocol fires on an edit, follow it. Don't rationalize-skip even on "styling-only" changes — the SQL-vs-rendered check is the only way to catch silent local-filter drift.
- For unmapped chart components (rule missing), fall back to manual SQL cross-check using `transactions_filterable_v` as the universal raw source.
- Per-repo only: this hook does NOT live in AiLine/shared-docs because the chart→source mapping is project-specific.
