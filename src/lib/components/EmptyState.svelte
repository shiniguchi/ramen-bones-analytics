<script lang="ts">
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { emptyStates, type EmptyCard } from '$lib/emptyStates';

  let { card }: { card: EmptyCard } = $props();
  const copy = $derived(emptyStates[card]);
</script>

<div class="flex flex-col items-center justify-center py-8 text-center">
  <p class="text-sm font-semibold text-zinc-900">{t(page.data.locale, copy.headingKey)}</p>
  <p class="mt-1 text-xs text-balance text-zinc-500">{t(page.data.locale, copy.bodyKey)}</p>
</div>
