// src/lib/forecastConfig.ts
// Phase 15 D-08: hard-coded campaign-start for the cumulative-deviation calc
// in /api/campaign-uplift and ForecastHoverPopup.
//
// Phase 16 replaces this constant with a campaign_calendar table lookup;
// the endpoint URL contract /api/campaign-uplift remains stable, only the
// backing data source changes. Keep this file as the SINGLE source of the
// 2026-04-14 literal — a Phase 16 CI grep guard will forbid the literal
// reappearing anywhere else in src/.

export const CAMPAIGN_START: Date = new Date('2026-04-14T00:00:00Z');
