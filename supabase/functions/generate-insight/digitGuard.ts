// Digit-guard: rejects LLM output containing any number not present in the input payload.
// Every numeric token in the LLM-generated text MUST appear verbatim in the flattened payload.

const DIGIT_RE = /\d+(?:[.,]\d+)?/g;

// Normalize European comma decimals to dots so "12,50" matches "12.50".
function normalize(s: string): string {
  return s.replace(/,/g, ".");
}

// Walk any JSON-like value and collect every numeric substring (including digits inside strings).
export function flattenNumbers(obj: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      out.add(normalize(String(v)));
      return;
    }
    if (typeof v === "string") {
      const matches = v.match(DIGIT_RE) ?? [];
      for (const m of matches) out.add(normalize(m));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(obj);
  return out;
}

// Return true iff every digit-run in `text` is in the allowed set. Zero-digit strings pass.
export function digitGuardOk(text: string, allowed: Set<string>): boolean {
  const tokens = text.match(DIGIT_RE) ?? [];
  for (const t of tokens) {
    if (!allowed.has(normalize(t))) return false;
  }
  return true;
}
