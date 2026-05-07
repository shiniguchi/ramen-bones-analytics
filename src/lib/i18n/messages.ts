// src/lib/i18n/messages.ts
//
// Phase 19-03: en imported eagerly (always needed for MessageKey + fallback).
// Other locales lazy-loaded via loadDict() — one chunk per locale emitted by Vite.
//
// - Add a new key: update en.ts (all other locales' types derive from it).
// - Add a new locale: mirror ./locales.ts, create dict/{locale}.ts, add to loadDict switch.
// - Placeholders use `{name}` syntax; pass values via the 2nd arg to `t()`.
//
// LLM-generated insight copy lives in the `insights.i18n` jsonb column
// (migration 0037), NOT here. This file is only for compile-time-known text.
import type { Locale } from './locales';
import en from './dict/en';

export type MessageKey = keyof typeof en;

type Dict = Record<MessageKey, string>;

// In-memory cache — populated eagerly for en, lazily for other locales.
const dictCache = new Map<Locale, Dict>();
dictCache.set('en', en as Dict);

/**
 * Async locale loader — call once per request in hooks.server.ts to warm
 * the cache before SSR begins. Safe to call multiple times; is a no-op if
 * the locale is already cached.
 *
 * Dynamic imports let Vite emit one async chunk per locale so only the
 * requested locale is fetched over the wire.
 */
export async function loadDict(locale: Locale): Promise<void> {
  if (dictCache.has(locale)) return;
  // Explicit cases keep Vite's static analysis working — it can't tree-shake
  // fully dynamic `import(`./dict/${locale}.ts`)` without them.
  let m: { default: Dict };
  switch (locale) {
    case 'de': m = await import('./dict/de'); break;
    case 'ja': m = await import('./dict/ja'); break;
    case 'es': m = await import('./dict/es'); break;
    case 'fr': m = await import('./dict/fr'); break;
    default:   return; // 'en' is already in cache; unknown locales fall back to en
  }
  dictCache.set(locale, m.default as Dict);
}

/**
 * Synchronous cache seed — called by +layout.svelte to hydrate the client
 * from the SSR payload without a second round-trip.
 * On the server this is a no-op (cache already populated by loadDict).
 */
export function seedDict(locale: Locale, dict: Dict): void {
  dictCache.set(locale, dict);
}

/**
 * Exported for +layout.server.ts to include the dict in the SSR payload.
 * Falls back to the en dict if the requested locale is not yet cached.
 */
export function getDict(locale: Locale): Dict {
  return dictCache.get(locale) ?? (en as Dict);
}

/**
 * Compatibility shim — tests and legacy code that import `messages.en` keep
 * working without changes. Only `en` is available synchronously; for other
 * locales use `loadDict` + `t()` instead.
 * @deprecated Use t() / getDict() / loadDict() directly.
 */
export const messages = {
  get en() { return getDict('en'); }
} as { en: Dict };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => k in vars ? String(vars[k]) : `{${k}}`);
}

/**
 * Look up a UI string by key. Falls back to the en dictionary (the SoT) if
 * the locale dict is not loaded or the key is missing, then to the raw key.
 *
 * Note: the fallback is hardwired to `en`, not DEFAULT_LOCALE — they are
 * different concerns. Changing DEFAULT_LOCALE to 'ja' should not silently
 * route missing-key lookups to Japanese.
 *
 * API unchanged — 19+ call sites unmodified.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const raw = dictCache.get(locale)?.[key] ?? en[key as keyof typeof en] ?? key;
  return interpolate(raw, vars);
}
