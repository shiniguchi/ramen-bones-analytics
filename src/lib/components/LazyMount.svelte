<script lang="ts">
  // Phase 11 D-03 / D-04: IntersectionObserver-gated mount slot.
  // Children render ONLY after the sentinel scrolls into view. Skeleton
  // placeholder reserves visual space (minHeight prop) so layout doesn't
  // jump when the real content mounts.
  //
  // Single trigger API: `onvisible` callback prop. Fires EXACTLY ONCE
  // when the sentinel first intersects. Callers put their data fetch
  // inside the callback. Do NOT introduce alternative triggers (e.g.
  // `{@const _ = loader()}` inside the snippet) — the codebase must
  // have exactly one lazy-load idiom.
  //
  // Two ways to render:
  //   1. Pass `children` snippet (existing behaviour).
  //   2. Pass `loader: () => import('./Card.svelte')` for dynamic-import.
  // Pick exactly ONE; mutually exclusive.
  //
  // Usage (snippet form):
  //   <LazyMount minHeight="320px" onvisible={loadRetention}>
  //     {#snippet children()}
  //       <CohortRetentionCard ... />
  //     {/snippet}
  //   </LazyMount>
  //
  // Usage (loader form — defers the module download until scroll-in):
  //   <LazyMount
  //     minHeight="320px"
  //     onvisible={loadDailyKpi}
  //     loader={() => import('$lib/components/DailyHeatmapCard.svelte')}
  //     props={{ data: dailyKpi }}
  //   />

  import type { Component, Snippet } from 'svelte';

  let {
    minHeight = '240px',
    rootMargin = '200px',   // start fetching ~one viewport early
    onvisible,
    loader,
    props = {},
    children
  }: {
    minHeight?: string;
    rootMargin?: string;
    onvisible?: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loader?: () => Promise<{ default: Component<any> }>;
    props?: Record<string, unknown>;
    children?: Snippet;
  } = $props();

  let sentinel: HTMLDivElement;
  let mounted = $state(false);
  // Holds the dynamically-imported component constructor once the module resolves.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Loaded = $state<Component<any> | null>(null);

  $effect(() => {
    if (!sentinel || mounted) return;
    // Fallback: SSR / no IntersectionObserver → mount immediately.
    if (typeof IntersectionObserver === 'undefined') {
      mounted = true;
      onvisible?.();
      if (loader) loader().then((m) => (Loaded = m.default));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          mounted = true;
          onvisible?.();
          if (loader) loader().then((m) => (Loaded = m.default));
          io.disconnect();
        }
      },
      { rootMargin }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  });
</script>

<div bind:this={sentinel} style:min-height={minHeight} class="w-full">
  {#if !mounted}
    <!-- Simple skeleton; card components will replace on mount -->
    <div class="animate-pulse bg-neutral-100 rounded-lg" style:min-height={minHeight}></div>
  {:else if loader}
    {#if Loaded}
      {@const DynComp = Loaded}
      <DynComp {...props} />
    {:else}
      <!-- Dynamic import in-flight — show skeleton until module resolves -->
      <div class="animate-pulse bg-neutral-100 rounded-lg" style:min-height={minHeight}></div>
    {/if}
  {:else if children}
    {@render children()}
  {/if}
</div>
