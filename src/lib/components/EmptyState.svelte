<script lang="ts">
  import { emptyStates, type EmptyCard } from '$lib/emptyStates';

  let { card }: { card: EmptyCard } = $props();
  const copy = $derived(emptyStates[card]);
</script>

<div class="flex flex-col items-center justify-center py-8 text-center">
  <p class="text-sm font-semibold text-zinc-900">{copy.heading}</p>
  <p class="mt-1 text-xs text-zinc-500">{copy.body}</p>
</div>
