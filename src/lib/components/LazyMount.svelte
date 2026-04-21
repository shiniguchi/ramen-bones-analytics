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
  // Usage:
  //   <LazyMount minHeight="320px" onvisible={loadRetention}>
  //     {#snippet children()}
  //       <CohortRetentionCard
  //         dataWeekly={retention}
  //         dataMonthly={retentionMonthly}
  //       />
  //     {/snippet}
  //   </LazyMount>

  import type { Snippet } from 'svelte';

  let {
    minHeight = '240px',
    rootMargin = '200px',   // start fetching ~one viewport early
    onvisible,
    children
  }: {
    minHeight?: string;
    rootMargin?: string;
    onvisible?: () => void;
    children: Snippet;
  } = $props();

  let sentinel: HTMLDivElement;
  let mounted = $state(false);

  $effect(() => {
    if (!sentinel || mounted) return;
    // Fallback: SSR / no IntersectionObserver → mount immediately.
    if (typeof IntersectionObserver === 'undefined') {
      mounted = true;
      onvisible?.();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          mounted = true;
          onvisible?.();
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
  {#if mounted}
    {@render children()}
  {:else}
    <!-- Simple skeleton; card components will replace on mount -->
    <div class="animate-pulse bg-neutral-100 rounded-lg" style:min-height={minHeight}></div>
  {/if}
</div>
