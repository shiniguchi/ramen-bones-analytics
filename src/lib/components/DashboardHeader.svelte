<script lang="ts">
  import { LogOut } from 'lucide-svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/messages';
  import { LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from '$lib/i18n/locales';

  const loc = $derived(page.data.locale);

  async function switchLocale(e: Event) {
    const next = (e.target as HTMLSelectElement).value as Locale;
    // 1 year, Lax — static UI preference, no cross-site context needed.
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    // Reload page data so SSR + client re-render with the new locale.
    // Uses invalidateAll (not $app/navigation.replaceState) per the
    // replaceState+invalidate gotcha documented in project memory.
    await goto(page.url, { replaceState: true, invalidateAll: true });
  }
</script>

<header class="flex items-center justify-between gap-3 px-4 py-4">
  <h1 class="text-xl font-semibold text-zinc-900">{t(loc, 'brand_name')}</h1>
  <div class="flex items-center gap-2">
    <label class="sr-only" for="locale-switcher">{t(loc, 'language')}</label>
    <select
      id="locale-switcher"
      data-testid="locale-switcher"
      value={loc}
      onchange={switchLocale}
      class="min-h-11 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
    >
      {#each LOCALES as l (l)}
        <option value={l}>{LOCALE_LABELS[l]}</option>
      {/each}
    </select>
    <form method="POST" action="/?/logout">
      <button
        type="submit"
        aria-label={t(loc, 'logout')}
        class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-full text-zinc-900 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <LogOut size={20} />
      </button>
    </form>
  </div>
</header>
