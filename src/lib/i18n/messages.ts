// Static UI string dictionary. Per-locale, flat keys for forkability.
//
// - Add a new key: append to every locale's object (TypeScript enforces this
//   via MessageKey = keyof typeof messages.en).
// - Add a new locale: mirror `./locales.ts` and copy the `en` block as a
//   starting translation.
// - Placeholders use `{name}` syntax; pass values via the 2nd arg to `t()`.
//
// LLM-generated insight copy lives in the `insights.i18n` jsonb column
// (migration 0037), NOT here. This file is only for compile-time-known text.
import type { Locale } from './locales';
import { DEFAULT_LOCALE } from './locales';

const en = {
  brand_name: 'Ramen Bones',
  logout: 'Sign out',
  language: 'Language',

  grain_day: 'Day',
  grain_week: 'Week',
  grain_month: 'Month',

  repeater_cohort_title: 'Repeaters acquired by first-visit grouping',
  repeater_cohort_subtitle:
    'Customers who came back 2+ times, grouped by visit count — placed in their first-visit period.',
  cohort_retention_title: 'Retention rate by acquisition grouping',

  clamp_badge_label: 'Weekly view',
  clamp_badge_tooltip:
    'Daily cohorts have too few repeat customers to chart (min {n}). Showing weekly cohorts instead.'
} as const;

export type MessageKey = keyof typeof en;

export const messages: Record<Locale, Record<MessageKey, string>> = {
  en,
  de: {
    brand_name: 'Ramen Bones',
    logout: 'Abmelden',
    language: 'Sprache',

    grain_day: 'Tag',
    grain_week: 'Woche',
    grain_month: 'Monat',

    repeater_cohort_title: 'Wiederkehrende Kunden nach Erstbesuch-Kohorte',
    repeater_cohort_subtitle:
      'Kunden mit 2+ Besuchen, nach Besuchsanzahl gruppiert — eingeordnet nach Erstbesuch-Zeitraum.',
    cohort_retention_title: 'Kundenbindungsrate nach Akquisitions-Kohorte',

    clamp_badge_label: 'Wochenansicht',
    clamp_badge_tooltip:
      'Tägliche Kohorten haben zu wenige Wiederkehrer für eine Auswertung (Min. {n}). Wöchentliche Kohorten werden angezeigt.'
  },
  ja: {
    brand_name: 'Ramen Bones',
    logout: 'ログアウト',
    language: '言語',

    grain_day: '日',
    grain_week: '週',
    grain_month: '月',

    repeater_cohort_title: '初回来店グループ別のリピーター',
    repeater_cohort_subtitle:
      '2回以上来店した顧客を来店回数別にグループ化し、初回来店の期間に割り当てています。',
    cohort_retention_title: '獲得グループ別のリテンション率',

    clamp_badge_label: '週次表示',
    clamp_badge_tooltip:
      '日次コホートはリピーター数が少なすぎるため表示できません（最小 {n}）。代わりに週次コホートを表示します。'
  },
  es: {
    brand_name: 'Ramen Bones',
    logout: 'Cerrar sesión',
    language: 'Idioma',

    grain_day: 'Día',
    grain_week: 'Semana',
    grain_month: 'Mes',

    repeater_cohort_title: 'Repetidores adquiridos por cohorte de primera visita',
    repeater_cohort_subtitle:
      'Clientes con 2 o más visitas, agrupados por número de visitas — ubicados en su período de primera visita.',
    cohort_retention_title: 'Tasa de retención por cohorte de adquisición',

    clamp_badge_label: 'Vista semanal',
    clamp_badge_tooltip:
      'Las cohortes diarias tienen muy pocos clientes recurrentes para graficar (mín. {n}). Mostrando cohortes semanales en su lugar.'
  },
  fr: {
    brand_name: 'Ramen Bones',
    logout: 'Se déconnecter',
    language: 'Langue',

    grain_day: 'Jour',
    grain_week: 'Semaine',
    grain_month: 'Mois',

    repeater_cohort_title: 'Clients fidèles acquis par cohorte de première visite',
    repeater_cohort_subtitle:
      'Clients avec 2+ visites, regroupés par nombre de visites — classés par période de première visite.',
    cohort_retention_title: 'Taux de rétention par cohorte d\'acquisition',

    clamp_badge_label: 'Vue hebdomadaire',
    clamp_badge_tooltip:
      'Les cohortes quotidiennes ont trop peu de clients fidèles pour être tracées (min. {n}). Affichage des cohortes hebdomadaires à la place.'
  }
};

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

/**
 * Look up a UI string by key. Falls back to the default locale's string if the
 * key is missing in the target locale, then to the raw key as a last resort.
 * Placeholders like `{n}` are interpolated from `vars`.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const raw =
    messages[locale]?.[key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  return interpolate(raw, vars);
}
