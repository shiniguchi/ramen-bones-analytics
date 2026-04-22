<script lang="ts">
  // DashboardHeader — brand + custom locale picker (Popover + button list) +
  // logout. The earlier native <select> was replaced because Safari's vibrancy-
  // styled native popover renders option text at low contrast even when the
  // page declares color-scheme: light. The Popover primitive (also used by
  // FilterBar.svelte) keeps the dropdown fully Tailwind-styled and consistent
  // across browsers.
  import { LogOut, Check, Globe } from 'lucide-svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/messages';
  import { LOCALES, LOCALE_LABELS, LOCALE_COOKIE, type Locale } from '$lib/i18n/locales';
  import Popover from './ui/popover.svelte';

  const loc = $derived(page.data.locale);
  let menuOpen = $state(false);

  async function pick(next: Locale) {
    menuOpen = false;
    if (next === loc) return;
    // 1 year, Lax — static UI preference, no cross-site context needed.
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    // Reload page data so SSR + client re-render with the new locale.
    // goto({invalidateAll}) is the canonical pattern per the SvelteKit
    // replaceState+invalidate gotcha documented in project memory.
    await goto(page.url, { replaceState: true, invalidateAll: true });
  }
</script>

<header class="flex items-center justify-between gap-3 px-4 py-4">
  <h1 class="text-xl font-semibold text-zinc-900">{t(loc, 'brand_name')}</h1>
  <div class="flex items-center gap-2">
    <Popover bind:open={menuOpen} class="max-w-[240px]">
      {#snippet trigger()}
        <button
          type="button"
          data-testid="locale-switcher"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t(loc, 'language')}
          onclick={() => (menuOpen = !menuOpen)}
          class="min-h-11 inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <Globe size={16} class="text-zinc-500" />
          <span>{LOCALE_LABELS[loc]}</span>
        </button>
      {/snippet}
      {#snippet children()}
        <div role="menu" aria-label={t(loc, 'language')} class="flex flex-col gap-0.5">
          {#each LOCALES as l (l)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={l === loc}
              data-testid={`locale-option-${l}`}
              onclick={() => pick(l)}
              class="flex min-h-11 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none"
            >
              <span>{LOCALE_LABELS[l]}</span>
              {#if l === loc}
                <Check size={16} class="text-blue-600" />
              {:else}
                <span class="w-4" aria-hidden="true"></span>
              {/if}
            </button>
          {/each}
        </div>
      {/snippet}
    </Popover>
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
