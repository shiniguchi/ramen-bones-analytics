// Deterministic fallback template (UI-SPEC §Deterministic Fallback Template).
// Fires when the Haiku call fails JSON parse, tool-shape, digit-guard, or network.
// By construction its output passes digit-guard against its own input payload.

export type FallbackInput = {
  today_revenue_int: number;
  today_delta_pct: number;
  today_delta_sign: "up" | "down" | "flat";
  seven_d_revenue_int: number;
  seven_d_delta_pct: number;
  seven_d_delta_sign: "up" | "down" | "flat";
  returning_pct: number;
};

// Arrow glyph by sign — ▲ up, ▼ down, — flat.
const glyph = (s: "up" | "down" | "flat"): string =>
  s === "up" ? "▲" : s === "down" ? "▼" : "—";

export function buildFallback(
  p: FallbackInput,
): { headline: string; body: string; action_points: string[] } {
  let headline: string;
  if (p.today_revenue_int === 0) {
    // Zero-today edge: pivot to the weekly window. Avoid literal digits not in payload
    // (the digit-guard rejects any stray number in our own template output).
    headline = `No transactions recorded today — €${p.seven_d_revenue_int} over the prior week.`;
  } else {
    headline =
      `Revenue €${p.today_revenue_int} today ${glyph(p.today_delta_sign)} ${p.today_delta_pct}% vs last week`;
  }

  // Wording note: we say "prior week" not "prior 7d" so the literal digit 7 is not emitted
  // (digit-guard would flag it unless 7 happens to be in the payload).
  const firstSentence =
    `Week-to-date revenue is €${p.seven_d_revenue_int} (${glyph(p.seven_d_delta_sign)} ${p.seven_d_delta_pct}% vs prior week).`;
  // Zero-returning edge: swap second sentence so we don't print "0% of spend came from returning".
  const secondSentence =
    p.returning_pct === 0 || p.returning_pct === undefined
      ? `No repeat customers in the last week.`
      : `${p.returning_pct}% of this week's spend came from returning customers.`;
  const body = `${firstSentence} ${secondSentence}`;

  // Deterministic bullets built from the same 7 scalars as headline/body.
  // By construction every digit printed here is already in the payload, so the
  // digit-guard would accept these (the LLM path never sees them — fallback only).
  // "Returning share" is omitted when zero to avoid emitting a lone "0".
  const action_points: string[] = [
    p.today_revenue_int === 0
      ? `No revenue today`
      : `Today €${p.today_revenue_int} ${glyph(p.today_delta_sign)} ${p.today_delta_pct}%`,
    `Week €${p.seven_d_revenue_int} ${glyph(p.seven_d_delta_sign)} ${p.seven_d_delta_pct}%`,
  ];
  if (p.returning_pct && p.returning_pct > 0) {
    action_points.push(`Returning share ${p.returning_pct}%`);
  }

  return { headline, body, action_points };
}
