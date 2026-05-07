<script lang="ts">
  import '../app.css';
  import { seedDict } from '$lib/i18n/messages';

  let { data, children } = $props();

  // Hydrate the locale dict from the SSR payload on the client before any
  // child component calls t(). On the server this is a no-op (cache already
  // populated by loadDict in hooks.server.ts).
  seedDict(data.locale, data.dict);
</script>

<div class="min-h-screen bg-zinc-50 overflow-x-clip">
  {@render children()}
</div>
