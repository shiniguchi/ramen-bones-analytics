<script lang="ts">
  import '../app.css';
  import { seedDict } from '$lib/i18n/messages';

  let { data, children } = $props();

  // Hydrate the locale dict from the SSR payload. $effect runs synchronously
  // during SSR (no-op — cache already warm from loadDict in hooks.server.ts)
  // and on the client before children mount, so t() is always safe to call.
  $effect(() => {
    seedDict(data.locale, data.dict);
  });
</script>

<div class="min-h-screen bg-zinc-50 overflow-x-clip">
  {@render children()}
</div>
