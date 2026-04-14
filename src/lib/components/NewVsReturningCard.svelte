<script lang="ts">
  // NewVsReturningCard — D-19a chip-scoped exception.
  // Receives pre-aggregated shaped data from the loader (already filtered to chip window).
  // Shows stacked horizontal bar + legend with EUR integer values.
  // Colors: returning=bg-blue-600, new=bg-indigo-300, cash=bg-zinc-200.
  import EmptyState from '$lib/components/EmptyState.svelte';
  import { formatEUR } from '$lib/format';

  type Row = { segment: 'new' | 'returning' | 'cash_anonymous'; revenue_cents: number };
  let { data }: { data: Row[] } = $props();

  // Extract per-segment totals from shaped data.
  const totals = $derived.by(() => {
    const ret = data.find(r => r.segment === 'returning')?.revenue_cents ?? 0;
    const neu = data.find(r => r.segment === 'new')?.revenue_cents ?? 0;
    const cash = data.find(r => r.segment === 'cash_anonymous')?.revenue_cents ?? 0;
    const total = ret + neu + cash;
    return { ret, neu, cash, total };
  });
</script>

<div class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-xl font-semibold text-zinc-900">New vs returning</h2>
  {#if totals.total === 0}
    <EmptyState card="newVsReturning" />
  {:else}
    <!-- Stacked horizontal bar — three segments as proportional flex children -->
    <div class="mt-4 flex h-3 w-full overflow-hidden rounded">
      <div class="bg-blue-600"   style="width: {(totals.ret  / totals.total) * 100}%"></div>
      <div class="bg-indigo-300" style="width: {(totals.neu  / totals.total) * 100}%"></div>
      <div class="bg-zinc-200"   style="width: {(totals.cash / totals.total) * 100}%"></div>
    </div>
    <!-- Legend with EUR integer values -->
    <ul class="mt-3 space-y-1 text-sm">
      <li class="flex items-center gap-2">
        <span class="size-3 rounded-sm bg-blue-600"></span>
        Returning
        <span class="ml-auto tabular-nums">{formatEUR(totals.ret)}</span>
      </li>
      <li class="flex items-center gap-2">
        <span class="size-3 rounded-sm bg-indigo-300"></span>
        New
        <span class="ml-auto tabular-nums">{formatEUR(totals.neu)}</span>
      </li>
      <li class="flex items-center gap-2">
        <span class="size-3 rounded-sm bg-zinc-200"></span>
        Cash
        <span class="ml-auto tabular-nums">{formatEUR(totals.cash)}</span>
      </li>
    </ul>
  {/if}
</div>
