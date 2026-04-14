<script lang="ts">
  import DashboardHeader from '$lib/components/DashboardHeader.svelte';
  import DateRangeChips from '$lib/components/DateRangeChips.svelte';
  import FreshnessLabel from '$lib/components/FreshnessLabel.svelte';

  let { data } = $props();
</script>

<DashboardHeader />
<div class="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur px-4 py-2">
  <DateRangeChips range={data.range} />
  <FreshnessLabel lastIngestedAt={data.freshness} />
</div>
<main class="mx-auto max-w-screen-sm px-4 pb-12">
  <div class="flex flex-col gap-6">
    <!-- KPI tiles (04-03), cohort + LTV (04-04), frequency + NVR (04-05) slot here -->
  </div>
</main>
