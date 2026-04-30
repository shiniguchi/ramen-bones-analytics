// src/lib/forecastEventClamp.ts
// Phase 15 D-09 / FUI-05: progressive disclosure for event markers.
// Default cap = 50 markers per chart. When the horizon (1yr at month grain
// has ~12 holiday + ~5 school_holiday + ~10 recurring + 1 campaign + N strikes)
// stays under 50, no clamp. When over, drop lowest-priority type first.
//
// Tie-break within a kept type: earliest date wins (visually nearer the
// "today" reference point, which is what the owner is reading).

export type EventType =
  | 'campaign_start'
  | 'transit_strike'
  | 'school_holiday'
  | 'holiday'
  | 'recurring_event';

export type ForecastEvent = {
  type: EventType;
  date: string;     // YYYY-MM-DD (school_holiday block uses start_date)
  label: string;
  end_date?: string; // school_holiday only — block end
};

export const EVENT_PRIORITY: Record<EventType, number> = {
  campaign_start:  5,
  transit_strike:  4,
  school_holiday:  3,
  holiday:         2,
  recurring_event: 1
};

export function clampEvents(events: readonly ForecastEvent[], max = 50): ForecastEvent[] {
  if (events.length <= max) return events.slice();

  // Sort: priority DESC, then date ASC (ties broken by earlier date kept).
  const sorted = events.slice().sort((a, b) => {
    const dp = EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type];
    if (dp !== 0) return dp;
    return a.date.localeCompare(b.date);
  });

  return sorted.slice(0, max);
}
