<script lang="ts">
  import DashboardHeader from '$lib/components/DashboardHeader.svelte';
  import DateRangeChips from '$lib/components/DateRangeChips.svelte';
  import FreshnessLabel from '$lib/components/FreshnessLabel.svelte';
  import KpiTile from '$lib/components/KpiTile.svelte';

  let { data } = $props();
</script>

<DashboardHeader />
<div class="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur px-4 py-2">
  <DateRangeChips range={data.range} />
  <FreshnessLabel lastIngestedAt={data.freshness} />
</div>
<main class="mx-auto max-w-screen-sm px-4 pb-12">
  <div class="flex flex-col gap-6">
    <!-- Fixed revenue tiles: always show Today / 7d / 30d regardless of chip (D-06) -->
    <KpiTile
      title="Revenue · Today"
      value={data.kpi.revenueToday.value}
      prior={data.kpi.revenueToday.prior}
      format="eur-int"
      windowLabel={data.kpi.revenueToday.priorLabel}
      emptyCard="revenueFixed"
    />
    <KpiTile
      title="Revenue · 7d"
      value={data.kpi.revenue7d.value}
      prior={data.kpi.revenue7d.prior}
      format="eur-int"
      windowLabel={data.kpi.revenue7d.priorLabel}
      emptyCard="revenueFixed"
    />
    <KpiTile
      title="Revenue · 30d"
      value={data.kpi.revenue30d.value}
      prior={data.kpi.revenue30d.prior}
      format="eur-int"
      windowLabel={data.kpi.revenue30d.priorLabel}
      emptyCard="revenueFixed"
    />

    <!-- Chip-scoped tiles: follow selected range (D-07) -->
    <KpiTile
      title="Transactions"
      value={data.kpi.txCount.value}
      prior={data.kpi.txCount.prior}
      format="int"
      windowLabel={data.kpi.txCount.priorLabel}
      emptyCard="revenueChip"
    />
    <!-- Avg ticket: only tile with decimals (D-09) -->
    <KpiTile
      title="Avg ticket"
      value={data.kpi.avgTicket.value}
      prior={data.kpi.avgTicket.prior}
      format="eur-dec"
      windowLabel={data.kpi.avgTicket.priorLabel}
      emptyCard="revenueChip"
    />

    <!-- Cohort + LTV (04-04) and frequency + NVR (04-05) slot here -->
  </div>
</main>
