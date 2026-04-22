// Deterministic fallback template (UI-SPEC §Deterministic Fallback Template).
// Fires when the Haiku call fails JSON parse, tool-shape, digit-guard, or network.
// By construction its output passes digit-guard against its own input payload.

export type FallbackInput = {
  // Kept for backwards-compat with payloads that still carry today_* — the
  // weekly-voice template no longer reads these, but leaving them allows the
  // type to match `deriveFallbackInput` without churning every caller.
  today_revenue_int: number;
  today_delta_pct: number;
  today_delta_sign: "up" | "down" | "flat";
  seven_d_revenue_int: number;
  seven_d_delta_pct: number;
  seven_d_delta_sign: "up" | "down" | "flat";
  twenty_eight_d_revenue_int: number;
  twenty_eight_d_delta_pct: number;
  twenty_eight_d_delta_sign: "up" | "down" | "flat";
  returning_pct: number;
};

// Arrow glyph by sign — ▲ up, ▼ down, — flat.
const glyph = (s: "up" | "down" | "flat"): string =>
  s === "up" ? "▲" : s === "down" ? "▼" : "—";

export function buildFallback(
  p: FallbackInput,
): { headline: string; body: string; action_points: string[] } {
  // Weekly-cadence voice: data refreshes once per week, so the card speaks in
  // week-anchored terms only. No "today" / "yesterday" references anywhere —
  // those would lie to the reader on days between refreshes.
  const headline = p.seven_d_revenue_int === 0
    ? `No transactions logged in the past 7 days`
    : `Past 7 days €${p.seven_d_revenue_int} ${glyph(p.seven_d_delta_sign)} ${p.seven_d_delta_pct}% vs prior week`;

  // Body covers 2 dimensions: week-over-week trend + 4-week trend + mix.
  // Every digit emitted is already in the payload, so the fallback is
  // tautologically digit-guard-safe.
  const firstSentence =
    `Past 7 days logged €${p.seven_d_revenue_int} in revenue (${glyph(p.seven_d_delta_sign)} ${p.seven_d_delta_pct}% vs prior week).`;
  const secondSentence =
    `Four-week rolling total €${p.twenty_eight_d_revenue_int} (${glyph(p.twenty_eight_d_delta_sign)} ${p.twenty_eight_d_delta_pct}% vs prior 4 weeks).`;
  const thirdSentence =
    p.returning_pct === 0 || p.returning_pct === undefined
      ? `No repeat customers in the past week.`
      : `Returning customers drove ${p.returning_pct}% of spend.`;
  const body = `${firstSentence} ${secondSentence} ${thirdSentence}`;

  // Deterministic bullets span three dimensions: weekly trend, monthly trend, mix.
  const action_points: string[] = [
    `Past 7 days €${p.seven_d_revenue_int} ${glyph(p.seven_d_delta_sign)} ${p.seven_d_delta_pct}%`,
    `Last 4 weeks €${p.twenty_eight_d_revenue_int} ${glyph(p.twenty_eight_d_delta_sign)} ${p.twenty_eight_d_delta_pct}%`,
  ];
  if (p.returning_pct && p.returning_pct > 0) {
    action_points.push(`Returning share ${p.returning_pct}%`);
  }

  return { headline, body, action_points };
}
