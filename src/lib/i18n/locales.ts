// Single source of truth for supported UI locales.
// Forkers: add a new language by appending its tag here, adding a matching
// entry to LOCALE_LABELS, and translating messages in `./messages.ts`.
// The `INSIGHT_LOCALES` env on the generate-insight Edge Function must be
// kept in sync.
export const LOCALES = ['en', 'de', 'ja', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  ja: '日本語',
  es: 'Español',
  fr: 'Français'
};

export const LOCALE_COOKIE = 'rb_locale';

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (LOCALES as readonly string[]).includes(x);
}
