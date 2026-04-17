<script lang="ts">
  // VisitSeqLegend — shared horizontal 8-step gradient + optional Cash swatch (D-08).
  // Consumed by CalendarRevenueCard and CalendarCountsCard inline below their charts.
  // No per-segment labels (2nd/3rd/…/7x) — tooltip reveals those on hover/tap.
  import { VISIT_SEQ_COLORS, CASH_COLOR } from '$lib/chartPalettes';

  let { showCash = true }: { showCash?: boolean } = $props();
</script>

<!-- D-08: horizontal gradient legend, inline below calendar chart card. -->
<div class="mt-3 flex items-center gap-3 text-xs text-zinc-600">
  <span>1st</span>
  <div class="flex h-2 flex-1 overflow-hidden rounded" data-testid="visit-seq-gradient">
    {#each VISIT_SEQ_COLORS as color}
      <div class="flex-1" style:background-color={color}></div>
    {/each}
  </div>
  <span>8x+</span>
  {#if showCash}
    <span class="mx-1 text-zinc-400">|</span>
    <div class="h-2 w-4 rounded" style:background-color={CASH_COLOR} data-testid="cash-swatch"></div>
    <span>Cash</span>
  {/if}
</div>
