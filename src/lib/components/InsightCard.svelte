<script lang="ts">
  // InsightCard.svelte — text-only headline + body card prepended to the
  // dashboard stream. Passive (no interactivity, icons, or animations) per
  // 05-UI-SPEC §Interaction Contracts. Renders only when the loader passes a
  // non-null insight; the parent guards with {#if data.latestInsight}.
  type Insight = {
    headline: string;
    body: string;
    action_points: string[];
    business_date: string;
    fallback_used: boolean;
  };

  let { insight }: { insight: Insight } = $props();

  // Weekly-cadence label (e.g. "Week ending Apr 15, 2026"). The dashboard
  // refreshes once per week, so we anchor the card to the snapshot date
  // rather than a relative "yesterday" indicator.
  const weekEndingLabel = (() => {
    try {
      const d = new Date(insight.business_date + 'T00:00:00Z');
      return 'Week ending ' + new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
      }).format(d);
    } catch {
      return insight.business_date;
    }
  })();
</script>

<section
  role="article"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mb-1">
    {weekEndingLabel}
  </span>

  <h2 class="text-xl font-semibold leading-tight text-zinc-900">
    {insight.headline}
  </h2>

  <p class="mt-2 text-sm leading-normal text-zinc-700">
    {insight.body}
  </p>

  {#if insight.action_points.length > 0}
    <ul class="mt-3 space-y-1 text-sm leading-normal text-zinc-700">
      {#each insight.action_points as bullet}
        <li class="flex gap-2 before:text-zinc-400 before:content-['·']">
          <span>{bullet}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if insight.fallback_used}
    <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mt-3">
      · auto-generated
    </span>
  {/if}
</section>
