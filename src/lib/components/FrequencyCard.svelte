<script lang="ts">
  // FrequencyCard — D-18: plain divs only, NO LayerChart import.
  // Shows 5 fixed frequency buckets as horizontal bar rows.
  import EmptyState from '$lib/components/EmptyState.svelte';

  type Row = { bucket: string; customer_count: number };
  let { data }: { data: Row[] } = $props();

  // Max customer count for proportional bar widths; at least 1 to avoid 0/0.
  const max = $derived(Math.max(1, ...data.map(r => r.customer_count)));

  // Bucket display labels — map DB string values to readable labels.
  const BUCKET_LABELS: Record<string, string> = {
    '1': '1 visit',
    '2': '2 visits',
    '3-5': '3–5 visits',
    '6-10': '6–10 visits',
    '11+': '11+ visits'
  };

  // Sort rows by the natural bucket order (1, 2, 3-5, 6-10, 11+).
  const BUCKET_ORDER = ['1', '2', '3-5', '6-10', '11+'];
  const sorted = $derived(
    [...data].sort(
      (a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)
    )
  );
</script>

<div class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-xl font-semibold text-zinc-900">Visit frequency</h2>
  {#if data.length === 0}
    <EmptyState card="frequency" />
  {:else}
    <ul class="mt-4 flex flex-col gap-2">
      {#each sorted as r}
        <li class="flex items-center gap-2 text-sm">
          <!-- Fixed-width bucket label -->
          <span class="w-20 shrink-0 text-zinc-500">
            {BUCKET_LABELS[r.bucket] ?? r.bucket}
          </span>
          <!-- Bar track: flex-1 so it fills available width -->
          <div class="h-3 flex-1 overflow-hidden rounded bg-zinc-100">
            <!-- Proportional bar: width = customer_count / max * 100% -->
            <div
              class="h-full bg-zinc-500"
              style="width: {(r.customer_count / max) * 100}%"
            ></div>
          </div>
          <!-- Right-aligned customer count -->
          <span class="w-12 shrink-0 text-right tabular-nums text-zinc-900">
            {r.customer_count}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
