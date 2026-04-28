<script lang="ts">
  // InsightCard.svelte — weekly insight card at the top of the dashboard.
  // Read-only for viewers; owner-role admins get inline edit via `use:enhance`
  // form action `?/updateInsight` that calls the SECURITY DEFINER RPC
  // `public.admin_update_insight`. Authorization is enforced server-side; the
  // `isAdmin` prop here only gates the edit UI, not the write permission.
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { DEFAULT_LOCALE, type Locale } from '$lib/i18n/locales';

  type InsightI18nEntry = { headline: string; body: string; action_points: string[] };
  type Insight = {
    id?: string;
    headline: string;
    body: string;
    action_points: string[];
    business_date: string;
    fallback_used: boolean;
    generated_at?: string;
    // Per-locale map, shape enforced by migration 0037. Legacy rows that
    // predate the migration can be absent — fall back to the scalar columns.
    i18n?: Record<string, InsightI18nEntry>;
  };

  let {
    insight,
    isAdmin = false
  }: { insight: Insight; isAdmin?: boolean } = $props();

  // Select the locale-specific view. Fallback chain: requested locale →
  // English → legacy scalar columns. migration 0037 guarantees an `en`
  // block exists for all new rows, so the third branch only fires for
  // pre-0037 data or when the row was edited via the 4-arg legacy RPC.
  const activeLocale = $derived<Locale>(page.data.locale ?? DEFAULT_LOCALE);
  const view = $derived.by<InsightI18nEntry>(() => {
    const loc = activeLocale;
    const locEntry = insight.i18n?.[loc];
    if (locEntry) return locEntry;
    const enEntry = insight.i18n?.[DEFAULT_LOCALE];
    if (enEntry) return enEntry;
    return {
      headline: insight.headline,
      body: insight.body,
      action_points: insight.action_points
    };
  });

  // Locale → Intl BCP47 tag for date formatting. "ja" → "ja-JP", etc.
  // en stays US-style ("Apr 15, 2026"), others use the locale's default.
  const intlTag = $derived.by<string>(() => {
    const loc = activeLocale;
    return loc === 'en' ? 'en-US'
         : loc === 'ja' ? 'ja-JP'
         : loc === 'de' ? 'de-DE'
         : loc === 'es' ? 'es-ES'
         : loc === 'fr' ? 'fr-FR'
         : 'en-US';
  });

  // Weekly-cadence label (e.g. "Week ending Apr 15, 2026" / "2026年4月15日終了週").
  // The dashboard refreshes once per week, so we anchor the card to the
  // snapshot date rather than a relative "yesterday" indicator.
  const weekEndingLabel = $derived.by(() => {
    try {
      const d = new Date(insight.business_date + 'T00:00:00Z');
      const formatted = new Intl.DateTimeFormat(intlTag, {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
      }).format(d);
      return t(activeLocale, 'insight_week_ending', { date: formatted });
    } catch {
      return insight.business_date;
    }
  });

  // Cadence + last-run footer: makes the weekly refresh schedule visible and
  // surfaces the actual generated_at so stale runs (missed Mondays) are obvious
  // instead of silently-old copy.
  const refreshLabel = $derived.by(() => {
    if (!insight.generated_at) return t(activeLocale, 'insight_refreshed_weekly');
    try {
      const d = new Date(insight.generated_at);
      const when = new Intl.DateTimeFormat(intlTag, {
        month: 'short', day: 'numeric', year: 'numeric'
      }).format(d);
      return t(activeLocale, 'insight_refreshed_with_last_run', { date: when });
    } catch {
      return t(activeLocale, 'insight_refreshed_weekly');
    }
  });

  // Local edit state. The form submits to `?/updateInsight` which calls the
  // admin RPC; on success we `invalidateAll()` to pull the updated row.
  let mode = $state<'view' | 'edit'>('view');
  let draftHeadline = $state('');
  let draftBody = $state('');
  // Pad to 3 slots so the form always shows 3 bullet inputs. Empty strings
  // are filtered out server-side (`filter(Boolean)` in the form action).
  let draftBullets = $state<string[]>(['', '', '']);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);

  function enterEdit() {
    // Seed the edit form from the currently-viewed locale so the owner
    // edits the language they're reading. Hidden `locale` input on the
    // form submits the active locale to the updateInsight action.
    draftHeadline = view.headline;
    draftBody = view.body;
    draftBullets = [
      view.action_points[0] ?? '',
      view.action_points[1] ?? '',
      view.action_points[2] ?? ''
    ];
    errorMsg = null;
    mode = 'edit';
  }

  function cancelEdit() {
    errorMsg = null;
    mode = 'view';
  }
</script>

<section
  role="article"
  class="relative rounded-xl border border-zinc-200 bg-white p-4"
>
  <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mb-1">
    {weekEndingLabel}
  </span>

  {#if isAdmin && mode === 'view'}
    <button
      type="button"
      onclick={enterEdit}
      aria-label={t(activeLocale, 'insight_edit_aria')}
      class="absolute top-3 right-3 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
    >
      <!-- pencil icon (Lucide "pencil"), inline SVG so we don't add a dep -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  {/if}

  {#if mode === 'view'}
    <h2 class="text-xl font-semibold leading-tight text-zinc-900">
      {view.headline}
    </h2>

    <p class="mt-2 text-sm leading-normal whitespace-pre-line text-zinc-700">
      {view.body}
    </p>

    {#if view.action_points.length > 0}
      <ul class="mt-3 space-y-1 text-sm leading-normal text-zinc-700">
        {#each view.action_points as bullet}
          <li class="flex gap-2 before:text-zinc-400 before:content-['·']">
            <span>{bullet}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Footer: cadence + last-run timestamp (+ auto-generated chip when the
         fallback template fired instead of Haiku). Combines into one line so
         viewers get the full provenance at a glance. -->
    <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mt-3">
      {refreshLabel}{#if insight.fallback_used}&nbsp;· {t(activeLocale, 'insight_auto_generated')}{/if}
    </span>
  {:else}
    <!-- Edit mode: form posts to the dashboard `updateInsight` action.
         `use:enhance` intercepts to keep the SPA shell, then we reload the
         insight row via invalidateAll() on success. -->
    <form
      method="POST"
      action="?/updateInsight"
      use:enhance={() => {
        saving = true;
        errorMsg = null;
        return async ({ result }) => {
          saving = false;
          if (result.type === 'success' && result.data?.ok) {
            await invalidateAll();
            mode = 'view';
          } else if (result.type === 'success' && !result.data?.ok) {
            errorMsg = String(result.data?.error ?? t(activeLocale, 'insight_update_failed'));
          } else if (result.type === 'failure') {
            errorMsg = String(result.data?.error ?? t(activeLocale, 'insight_update_failed'));
          } else if (result.type === 'error') {
            errorMsg = result.error?.message ?? t(activeLocale, 'insight_update_failed');
          }
        };
      }}
      class="space-y-3"
    >
      <input type="hidden" name="id" value={insight.id ?? ''} />
      <input type="hidden" name="locale" value={activeLocale} />

      <label class="block">
        <span class="block text-xs font-medium text-zinc-600 mb-1">{t(activeLocale, 'insight_headline_label')}</span>
        <textarea
          name="headline"
          bind:value={draftHeadline}
          rows="2"
          required
          class="w-full rounded-md border border-zinc-300 px-2 py-1 text-base font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400"
        ></textarea>
      </label>

      <label class="block">
        <span class="block text-xs font-medium text-zinc-600 mb-1">{t(activeLocale, 'insight_body_label')}</span>
        <textarea
          name="body"
          bind:value={draftBody}
          rows="4"
          required
          class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
        ></textarea>
      </label>

      <fieldset class="space-y-2">
        <legend class="block text-xs font-medium text-zinc-600">{t(activeLocale, 'insight_bullets_label')}</legend>
        {#each draftBullets as _, i}
          <input
            type="text"
            name="action_points"
            bind:value={draftBullets[i]}
            maxlength="80"
            placeholder={t(activeLocale, 'insight_bullet_placeholder', { n: i + 1 })}
            class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        {/each}
      </fieldset>

      {#if errorMsg}
        <p class="text-xs text-red-600" role="alert">{errorMsg}</p>
      {/if}

      <div class="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? t(activeLocale, 'insight_saving') : t(activeLocale, 'insight_save')}
        </button>
        <button
          type="button"
          onclick={cancelEdit}
          disabled={saving}
          class="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {t(activeLocale, 'insight_cancel')}
        </button>
      </div>
    </form>
  {/if}
</section>
