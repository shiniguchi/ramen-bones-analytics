---
type: backlog
captured: 2026-05-04
source: Phase 16 wave 4 close — owner Chrome MCP localhost review
target_phase: v1.4 polish
priority: medium
status: captured
---

# EventMarker on-screen legend (red/green/yellow/teal lines need labels)

Owner feedback (2026-05-04):

> "what are those red, yellow, green lines on the 'Revenue forecast' chart?"

## Context

`EventMarker.svelte:11-15` documents the color → type mapping in code comments:

| Color | Type | Visual |
|---|---|---|
| red solid 3px | `campaign_start` | full-height vertical line |
| green dashed 1px | `holiday` | full-height dashed vertical |
| teal background rect | `school_holiday` | range fill spanning start→end |
| yellow 1.5px | `recurring_event` | full-height vertical |
| red 4px bar at top | `transit_strike` | top-of-chart horizontal rect |

But there's **no on-screen legend** explaining this to the user. The owner saw 4 colors of lines on the Revenue forecast chart and couldn't tell what they meant.

## What needs to happen

Add a small legend below the forecast chart (or inside an expandable details/tooltip section) that maps each visual style to its event type and its data source:

- 🔴 Solid 3px line = キャンペーン開始 (campaign_start) — from campaign_calendar
- 🟢 Dashed 1px line = 祝日 (holiday) — federal/Berlin public holidays
- 🟢 Background block = 学校休暇 (school_holiday) — ferien-api.de
- 🟡 1.5px line = 定期イベント (recurring_event) — hand-curated
- 🔴 Top bar = 交通ストライキ (transit_strike) — BVG RSS

Mobile-first: legend must fit at 375px without horizontal scroll. Possibly collapsible (chevron-down to expand) so it doesn't dominate the chart.

## Acceptance

- Owner opens dashboard, taps the legend toggle (or the tiny "info" icon), and sees the color→type map
- Each entry shows both the visual and a plain-language Japanese label
- Legend mirrors the same data sources Phase 13 wired up

## Open questions

- Static below the chart, or modal/tooltip on tap? (Static is more discoverable; modal saves vertical space.)
- Should each entry link to the underlying data (e.g. tap "transit_strike" → list of recent BVG strikes)? Probably v1.5+.
