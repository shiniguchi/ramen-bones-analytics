<!--
  EventBadgeStrip.svelte — Phase 16.3 D-02 / D-03 / D-06 / D-07.

  Fixed-height (44px) horizontal strip rendering ONE BADGE PER BUCKET (not
  per event). Buckets are passed in by the caller in pixel space (left/width
  relative to the chart canvas), which keeps this component generic — every
  consumer card owns its own xScale (CalendarRevenueCard, CalendarCountsCard,
  CalendarItemsCard, CalendarItemRevenueCard, RepeaterCohortCountCard) and
  precomputes the bucket slots. The strip never reaches into chart
  internals.

  Visual rules (D-03):
  - Single-event bucket: solid background = EVENT_TYPE_COLORS[event.type].
  - Multi-event bucket: solid background = highest-priority event's color
    (per EVENT_PRIORITY); top-right corner counter shows the literal count
    up to 4, then '5+' rollup.
  - Every badge has a 1px white border (border-white class) so it stays
    legible against bar tops / Spline traces underneath.

  Layout (D-06):
  - The strip itself ALWAYS occupies its 44px row, even when no buckets
    have events — empty buckets render no <button> at all, so the chart
    card's vertical layout never jitters when filter chips change.

  Tap target (SC6):
  - Badge width = max(bucket.width, 44px). On day grain a bucket can be
    ~10px wide; promoting to 44px keeps the visible badge wider than the
    underlying bar (acceptable per the friend-persona use case at 375×667).

  Keyboard (a11y):
  - tabindex=0 + role=button (implicit via <button>) + aria-label including
    bucket date + count. Enter / Space toggles the popup.

  Popup (D-07):
  - On click/keypress, opens ChartHoverPopup as an absolute child anchored
    above the badge by default, flipping below when the badge is too close
    to the top of the viewport (anchorRect.top < 60).

  Anti-patterns explicitly avoided:
  - No inline hex strings — all colors flow through EVENT_TYPE_COLORS
    (palette source-of-truth lives in $lib/eventTypeColors).
  - No raw-HTML inject (the @-html block tag) anywhere — campaign labels
    are user-uploaded, XSS-prone.
  - No xScale() call here — caller supplies precomputed buckets (D-02).
-->
<script lang="ts">
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';
  import { EVENT_TYPE_COLORS, EVENT_PRIORITY } from '$lib/eventTypeColors';
  import type { ForecastEvent } from '$lib/forecastEventClamp';
  import ChartHoverPopup from './ChartHoverPopup.svelte';

  type BucketSlot = { iso: string; left: number; width: number };

  let {
    events,
    buckets,
    grain,
    width
  }: {
    events: readonly ForecastEvent[];
    buckets: readonly BucketSlot[];
    grain: 'day' | 'week' | 'month';
    width: number;
  } = $props();

  // Group events by their already-bucketed iso date. /api/forecast emits one
  // ForecastEvent per (type, date, label) tuple after clampEvents() dedupes;
  // the caller card guarantees event.date matches the bucket iso (e.g. by
  // bucketing day-grain dates into week-starts before passing in). We do
  // not re-bucket here — keeps this component a pure render layer.
  const eventsByBucket = $derived.by(() => {
    const m = new Map<string, ForecastEvent[]>();
    for (const ev of events) {
      const arr = m.get(ev.date);
      if (arr) arr.push(ev);
      else m.set(ev.date, [ev]);
    }
    return m;
  });

  // D-03 corner count: literal up to 4, '5+' from 5 upward. Threshold matches
  // the plan's "Counter rollup logic uses '5+' literal" acceptance criterion.
  const COUNT_ROLLUP = 4;
  function countLabel(n: number): string {
    return n <= COUNT_ROLLUP ? String(n) : '5+';
  }

  // EVENT_PRIORITY (campaign_start=5, transit_strike=4, school_holiday=3,
  // holiday=2, recurring_event=1) — highest wins for multi-event color.
  function highestPriorityType(bucketEvents: ForecastEvent[]) {
    return bucketEvents.reduce(
      (best, e) => (EVENT_PRIORITY[e.type] > EVENT_PRIORITY[best.type] ? e : best),
      bucketEvents[0]
    ).type;
  }

  // Tap-target promotion: never go below 44px regardless of underlying bucket
  // width. Day-grain buckets at narrow chart widths can be ~10px; this keeps
  // the touch surface usable without the caller having to special-case it.
  const MIN_TAP_PX = 44;

  let openBucketIso = $state<string | null>(null);
  let anchorRects = $state<Record<string, DOMRect>>({});

  function toggle(bucketIso: string, ev: MouseEvent | KeyboardEvent) {
    if (openBucketIso === bucketIso) {
      openBucketIso = null;
      return;
    }
    const target = ev.currentTarget as HTMLElement;
    anchorRects = { ...anchorRects, [bucketIso]: target.getBoundingClientRect() };
    openBucketIso = bucketIso;
  }
</script>

<div
  data-testid="event-badge-strip"
  class="relative"
  style:height="44px"
  style:width="{width}px"
>
  {#each buckets as b (b.iso)}
    {@const bucketEvents = eventsByBucket.get(b.iso) ?? []}
    {#if bucketEvents.length > 0}
      {@const dominant = highestPriorityType(bucketEvents)}
      {@const badgeWidth = Math.max(b.width, MIN_TAP_PX)}
      <button
        type="button"
        data-testid="event-strip-badge"
        data-bucket-iso={b.iso}
        data-event-count={bucketEvents.length}
        tabindex={0}
        aria-label={t(page.data.locale, 'event_strip_open_popup', {
          date: b.iso,
          count: bucketEvents.length
        })}
        class="absolute top-1 rounded-md border border-white"
        style:left="{b.left}px"
        style:width="{badgeWidth}px"
        style:height="40px"
        style:background-color={EVENT_TYPE_COLORS[dominant]}
        onclick={(e) => toggle(b.iso, e)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle(b.iso, e);
          }
        }}
      >
        {#if bucketEvents.length > 1}
          <span
            class="absolute -top-1 -right-1 rounded-full bg-white px-1 text-[9px] font-bold leading-tight text-zinc-900"
            data-testid="event-strip-count"
          >
            {countLabel(bucketEvents.length)}
          </span>
        {/if}
      </button>

      {#if openBucketIso === b.iso}
        {@const rect = anchorRects[b.iso]}
        {@const flipBelow = !!(rect && rect.top < 60)}
        <div
          class="absolute z-20"
          style:left="{b.left}px"
          style:bottom={flipBelow ? 'auto' : '48px'}
          style:top={flipBelow ? '48px' : 'auto'}
        >
          <ChartHoverPopup events={bucketEvents} bucketDate={b.iso} {grain} />
        </div>
      {/if}
    {/if}
  {/each}
</div>
