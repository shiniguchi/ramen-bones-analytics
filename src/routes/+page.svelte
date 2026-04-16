<script lang="ts">
  import DashboardHeader from '$lib/components/DashboardHeader.svelte';
  import FilterBar from '$lib/components/FilterBar.svelte';
  import FreshnessLabel from '$lib/components/FreshnessLabel.svelte';
  import KpiTile from '$lib/components/KpiTile.svelte';
  import CohortRetentionCard from '$lib/components/CohortRetentionCard.svelte';
  import InsightCard from '$lib/components/InsightCard.svelte';

  let { data } = $props();
</script>

<DashboardHeader />
<FilterBar
  filters={data.filters}
  window={data.window}
  distinctSalesTypes={data.distinctSalesTypes}
  distinctPaymentMethods={data.distinctPaymentMethods}
/>
<div class="px-4 py-2">
  <FreshnessLabel lastIngestedAt={data.freshness} />
</div>
<main class="mx-auto max-w-screen-sm px-4 pb-12">
  <div class="flex flex-col gap-6">
    <!-- Insight card (05-04) — text-only headline + body, prepended above tiles.
         Hidden when no insight row exists (brand-new tenant). -->
    {#if data.latestInsight}
      <InsightCard insight={data.latestInsight} />
    {/if}

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

    <!-- Cohort retention curve (04-04) — chip-independent, grain-synced via ?grain= -->
    <CohortRetentionCard data={data.retention} grain={data.grain} />
  </div>
</main>
