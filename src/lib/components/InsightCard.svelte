<script lang="ts">
  // InsightCard.svelte — text-only headline + body card prepended to the
  // dashboard stream. Passive (no interactivity, icons, or animations) per
  // 05-UI-SPEC §Interaction Contracts. Renders only when the loader passes a
  // non-null insight; the parent guards with {#if data.latestInsight}.
  type Insight = {
    headline: string;
    body: string;
    business_date: string;
    fallback_used: boolean;
    is_yesterday: boolean;
  };

  let { insight }: { insight: Insight } = $props();
</script>

<section
  role="article"
  class="rounded-xl border border-zinc-200 bg-white p-4"
>
  {#if insight.is_yesterday}
    <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mb-1">
      From yesterday
    </span>
  {/if}

  <h2 class="text-xl font-semibold leading-tight text-zinc-900">
    {insight.headline}
  </h2>

  <p class="mt-2 text-sm leading-normal text-zinc-700">
    {insight.body}
  </p>

  {#if insight.fallback_used}
    <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mt-3">
      · auto-generated
    </span>
  {/if}
</section>
