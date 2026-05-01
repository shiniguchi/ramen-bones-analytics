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

// Dedupe events by (type, date, label). The /api/forecast handler queries
// `holidays` with `subdiv_code.is.null OR subdiv_code.eq.BE`, which can return
// two rows for the same calendar date when a federal holiday overlaps a Berlin
// state observance (both labeled "Tag der Arbeit", "Karfreitag", etc).
// Without dedupe, EventMarker's keyed-each `(e.type + '|' + e.date)` would
// duplicate-key-crash Svelte 5 at runtime. Beyond the crash, the chart cannot
// legibly render two markers stacked at one x — so dedupe is also a UX fix.
function dedupe(events: readonly ForecastEvent[]): ForecastEvent[] {
  const seen = new Set<string>();
  const out: ForecastEvent[] = [];
  for (const e of events) {
    const key = `${e.type}|${e.date}|${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function clampEvents(events: readonly ForecastEvent[], max = 50): ForecastEvent[] {
  const deduped = dedupe(events);
  if (deduped.length <= max) return deduped;

  // Sort: priority DESC, then date ASC (ties broken by earlier date kept).
  const sorted = deduped.sort((a, b) => {
    const dp = EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type];
    if (dp !== 0) return dp;
    return a.date.localeCompare(b.date);
  });

  return sorted.slice(0, max);
}
