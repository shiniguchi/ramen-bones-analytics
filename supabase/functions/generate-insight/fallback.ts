// Deterministic fallback template (UI-SPEC §Deterministic Fallback Template).
// Fires when the Haiku call fails JSON parse, tool-shape, digit-guard, or network.
// By construction its output passes digit-guard against its own input payload.

export type FallbackInput = {
  // today_* kept only for back-compat with the deriveFallbackInput shape —
  // the weekly-voice template never renders them. Weekly refresh cadence
  // forbids single-day framing.
  today_revenue_int: number;
  today_delta_pct: number;
  today_delta_sign: "up" | "down" | "flat";
  // Mon–Sun calendar-week aggregates. "last_week_*" is the most recent
  // COMPLETE Mon–Sun window in the data; "last_four_weeks_*" is the 4
  // complete weeks ending on the same Sunday.
  last_week_revenue_int: number;
  last_week_delta_pct: number;
  last_week_delta_sign: "up" | "down" | "flat";
  last_four_weeks_revenue_int: number;
  last_four_weeks_delta_pct: number;
  last_four_weeks_delta_sign: "up" | "down" | "flat";
  returning_pct: number;
};

// Arrow glyph by sign — ▲ up, ▼ down, — flat.
const glyph = (s: "up" | "down" | "flat"): string =>
  s === "up" ? "▲" : s === "down" ? "▼" : "—";

export function buildFallback(
  p: FallbackInput,
): { headline: string; body: string; action_points: string[] } {
  // Weekly-cadence voice: data refreshes once per week, so the card speaks in
  // Mon–Sun calendar-week terms only. No "today" / "yesterday" / "past 7 days"
  // references — weeks are always calendar weeks, not rolling windows.
  const headline = p.last_week_revenue_int === 0
    ? `No transactions logged last week`
    : `Last week €${p.last_week_revenue_int} ${glyph(p.last_week_delta_sign)} ${p.last_week_delta_pct}% vs prior week`;

  // Body covers 3 dimensions: weekly trend + 4-week trend + customer mix.
  // Every digit emitted is already in the payload, so the fallback is
  // tautologically digit-guard-safe (plus the index.ts window-literal
  // whitelist covers structural "4" in "prior 4 weeks").
  const firstSentence =
    `Last week logged €${p.last_week_revenue_int} in revenue (${glyph(p.last_week_delta_sign)} ${p.last_week_delta_pct}% vs prior week).`;
  const secondSentence =
    `Last 4 weeks total €${p.last_four_weeks_revenue_int} (${glyph(p.last_four_weeks_delta_sign)} ${p.last_four_weeks_delta_pct}% vs prior 4 weeks).`;
  const thirdSentence =
    p.returning_pct === 0 || p.returning_pct === undefined
      ? `No repeat customers last week.`
      : `Returning customers drove ${p.returning_pct}% of spend.`;
  const body = `${firstSentence} ${secondSentence} ${thirdSentence}`;

  // Deterministic bullets span three dimensions: weekly trend, monthly trend, mix.
  const action_points: string[] = [
    `Last week €${p.last_week_revenue_int} ${glyph(p.last_week_delta_sign)} ${p.last_week_delta_pct}%`,
    `Last 4 weeks €${p.last_four_weeks_revenue_int} ${glyph(p.last_four_weeks_delta_sign)} ${p.last_four_weeks_delta_pct}%`,
  ];
  if (p.returning_pct && p.returning_pct > 0) {
    action_points.push(`Returning share ${p.returning_pct}%`);
  }

  return { headline, body, action_points };
}
