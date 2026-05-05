// src/lib/forecastConfig.ts
// Phase 16 Plan 09 / D-12 / Guard 10: the hard-coded campaign-start constant
// is retired. Campaign date now comes from /api/campaign-uplift (sourced from
// the campaign_calendar table — single source of truth). Guard 10 (Plan 11)
// trips CI on any direct campaign-date literal reappearing under src/ (the
// kind hard-coded before Phase 16).
//
// File kept (rather than deleted) so any orphaned imports surface as a
// TypeScript module-not-found error instead of a silent missing constant.
export {};
