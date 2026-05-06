// src/lib/eventTypeColors.ts
// Phase 16.3 D-04 / C-12: single source of truth for event-type → color
// mapping. Lifted verbatim from the original Phase 15 forecast-marker palette
// (campaign_start, holiday, recurring_event, transit_strike) plus
// school_holiday teal from ROADMAP SC3 (line 390). EventBadgeStrip (Plan
// 16.3-03) and any future consumer reads from this module — never inline hex
// strings.
//
// EVENT_PRIORITY is re-exported from forecastEventClamp.ts for ergonomic
// single-import in EventBadgeStrip's multi-event-bucket color choice
// (D-03 highest-priority wins).
//
// Plan 16.3-07 wired EventBadgeStrip into all 5 date-axis cards; this module
// is now the only place the palette exists.
import type { EventType } from '$lib/forecastEventClamp';
export { EVENT_PRIORITY } from '$lib/forecastEventClamp';

export const EVENT_TYPE_COLORS: Record<EventType, string> = {
  campaign_start:  '#dc2626', // red — campaign launch
  transit_strike:  '#dc2626', // red — strike top-bar
  school_holiday:  '#5eead4', // teal — multi-day block (ROADMAP SC3 line 390)
  holiday:         '#16a34a', // green — public holiday
  recurring_event: '#eab308'  // yellow — local recurring
};
