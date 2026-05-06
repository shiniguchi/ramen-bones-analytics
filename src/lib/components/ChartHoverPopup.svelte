<!--
  ChartHoverPopup.svelte — Phase 16.3 D-07 / SC4 popup shell for chart events.

  Renders a per-bucket popup with a header (bucket date + total count) and a
  body listing one row per ForecastEvent (color dot + localized type label +
  user label). On month grain, caps visible rows at 10 with a Show all
  expander; day/week always render every event.

  POSITIONING — auto-flip is the responsibility of the PARENT wrapper. The
  16.3-popup-css-lift.md note states the previous ForecastHoverPopup.svelte
  consumer (RevenueForecastCard.svelte) flipped via LayerChart Tooltip.Root's
  `contained="window"` prop. EventBadgeStrip mounts this popup as a plain
  absolute child outside LayerChart, so it does its own coarse top-of-viewport
  flip via `anchorRect.top < 60` — see EventBadgeStrip.svelte. Per-card
  consumers wiring this popup directly via Tooltip.Root MUST pass
  `contained="window"` to keep the lifted behaviour.

  XSS — every event label is rendered via Svelte text interpolation
  ({event.label}). Never raw-HTML inject (the @-html block tag): campaign
  labels are user-uploaded via campaign_calendar (T-16.3-03-01).

  CSS classes are lifted verbatim from .planning/phases/.../16.3-popup-css-lift.md
  — outer shell, header row, header-label, header-date, event-row.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';
  import { EVENT_TYPE_COLORS } from '$lib/eventTypeColors';
  import type { ForecastEvent, EventType } from '$lib/forecastEventClamp';

  let {
    events,
    bucketDate,
    grain
  }: {
    events: ForecastEvent[];
    bucketDate: string;
    grain: 'day' | 'week' | 'month';
  } = $props();

  // Month grain can carry many events (e.g. school-holiday weeks rolled up to
  // a month); cap visible rows so the popup stays mobile-readable. Day/week
  // never expander — events are already grain-bucketed and capped at 50 by
  // /api/forecast clampEvents().
  const SHOW_ALL_THRESHOLD = 10;
  let showAll = $state(false);

  const visibleEvents = $derived(
    grain === 'month' && !showAll && events.length > SHOW_ALL_THRESHOLD
      ? events.slice(0, SHOW_ALL_THRESHOLD)
      : events
  );

  // EventType is a closed union of 5 string literals; the messages.ts catalog
  // declares one `event_type_<name>` key per literal. The cast crosses the
  // typeof-en MessageKey wall — known-safe because the 5 keys exist (see
  // messages.ts:252-256).
  const typeLabelKey = (type: EventType): MessageKey =>
    `event_type_${type}` as MessageKey;
</script>

<div
  role="tooltip"
  aria-live="polite"
  data-testid="chart-hover-popup"
  class="min-w-[200px] max-w-[280px] rounded-lg border border-zinc-200 bg-white p-3 shadow-md"
>
  <div
    class="flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-1.5"
  >
    <span class="text-xs font-semibold text-zinc-900">{bucketDate}</span>
    <span class="text-[10px] tabular-nums text-zinc-500">
      {t(page.data.locale, 'popup_event_count', { n: events.length })}
    </span>
  </div>

  <ul class="mt-2 space-y-1">
    {#each visibleEvents as event (event.type + '|' + event.date + '|' + event.label)}
      <li class="flex items-baseline gap-2 text-[11px]">
        <span
          class="inline-block h-2 w-2 rounded-full"
          style:background-color={EVENT_TYPE_COLORS[event.type]}
          aria-hidden="true"
        ></span>
        <span class="text-zinc-500"
          >{t(page.data.locale, typeLabelKey(event.type))}</span
        >
        <!-- XSS gate: text interpolation only. event.label is user-uploaded. -->
        <span class="text-zinc-900">{event.label}</span>
      </li>
    {/each}
  </ul>

  {#if grain === 'month' && events.length > SHOW_ALL_THRESHOLD}
    <button
      type="button"
      class="mt-2 text-[10px] text-zinc-500 underline"
      onclick={() => (showAll = !showAll)}
      data-testid="popup-show-all-toggle"
    >
      {showAll
        ? t(page.data.locale, 'popup_show_fewer')
        : t(page.data.locale, 'popup_show_all_events', { n: events.length })}
    </button>
  {/if}
</div>
