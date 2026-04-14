<script lang="ts">
  // KpiTile.svelte — KPI metric card with delta caption.
  // Renders a title, big formatted number, and a delta vs prior window.
  // When value is null (query failed), shows EmptyState fallback.
  import EmptyState from './EmptyState.svelte';
  import { formatEUR } from '$lib/format';

  type Props = {
    title: string;
    value: number | null;
    prior: number | null;
    format: 'eur-int' | 'eur-dec' | 'int';
    windowLabel: string | null;
    emptyCard: 'revenueFixed' | 'revenueChip';
  };

  let { title, value, prior, format, windowLabel, emptyCard }: Props = $props();

  // Formatted display value.
  const display = $derived.by(() => {
    if (value === null) return null;
    if (format === 'eur-int') return formatEUR(value);
    if (format === 'eur-dec') return formatEUR(value, true);
    return value.toLocaleString('de-DE');
  });

  // Delta caption: text + color class.
  const delta = $derived.by(() => {
    if (value === null) return null;
    // No prior or zero prior → show "no prior data"
    if (prior === null || prior === 0) {
      return { text: `— no prior data`, color: 'text-zinc-500' };
    }
    const pct = Math.round(((value - prior) / prior) * 100);
    // Flat: |pct| < 1 (avoid "▲ +0%" noise)
    if (Math.abs(pct) < 1) {
      return { text: `— flat vs ${windowLabel}`, color: 'text-zinc-500' };
    }
    if (pct > 0) {
      return { text: `▲ +${pct}% vs ${windowLabel}`, color: 'text-green-700' };
    }
    // U+2212 real minus sign for negative delta (D-08 spec)
    return { text: `▼ \u2212${Math.abs(pct)}% vs ${windowLabel}`, color: 'text-red-700' };
  });
</script>

<section class="rounded-xl border border-zinc-200 bg-white p-4">
  <h2 class="text-sm font-semibold text-zinc-900">{title}</h2>
  {#if display === null}
    <EmptyState card={emptyCard} />
  {:else}
    <!-- Big number: 32px tabular-nums for clean alignment across tiles -->
    <p class="mt-1 text-[32px] leading-[1.1] font-semibold tabular-nums text-zinc-900">{display}</p>
    {#if delta}
      <p class="mt-1 text-xs {delta.color}">{delta.text}</p>
    {/if}
  {/if}
</section>
