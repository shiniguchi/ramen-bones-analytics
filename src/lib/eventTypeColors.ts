// src/lib/eventTypeColors.ts
// Phase 16.3 D-04 / C-12: single source of truth for event-type → color
// mapping. Lifted verbatim from EventMarker.svelte:60-113 (campaign_start,
// holiday, recurring_event, transit_strike) plus school_holiday teal from
// ROADMAP SC3 (line 390). EventBadgeStrip (Plan 16.3-03) and any future
// consumer reads from this module — never inline hex strings.
//
// EVENT_PRIORITY is re-exported from forecastEventClamp.ts for ergonomic
// single-import in EventBadgeStrip's multi-event-bucket color choice
// (D-03 highest-priority wins).
//
// After Plan 16.3-07 wires EventBadgeStrip into all 5 cards and deletes
// EventMarker.svelte, this module remains the only place the palette
// exists.
import type { EventType } from '$lib/forecastEventClamp';
export { EVENT_PRIORITY } from '$lib/forecastEventClamp';

export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  campaign_start:  '#dc2626', // red — campaign launch (EventMarker.svelte:67)
  transit_strike:  '#dc2626', // red — strike top-bar (EventMarker.svelte:108)
  school_holiday:  '#5eead4', // teal — multi-day block (ROADMAP SC3 line 390)
  holiday:         '#16a34a', // green — public holiday (EventMarker.svelte:78)
  recurring_event: '#eab308'  // yellow — local recurring (EventMarker.svelte:90)
};
