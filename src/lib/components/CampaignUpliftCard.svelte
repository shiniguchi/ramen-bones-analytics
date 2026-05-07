<script lang="ts">
  // Phase 16 Plan 09 + Phase 16.1 Plan 03 — dashboard's campaign-uplift card.
  // Phase 18 Plan 04 — hero rewrite consuming weekly_history (Decision A LOCKED).
  // Phase 16.1 D-05..D-11 + D-18: plain-language regime-tier hero (3 maturity
  // tiers × CI matrix → 7 i18n keys), plain secondary line, inline disclosure
  // panel (collapsed by default), and 4 supportive labels (subtitle, sparkline
  // Y label, X caption, counterfactual baseline legend chip). Statistical
  // detail (point estimate, CI bounds, anticipation note, divergence) lives
  // INSIDE the disclosure panel — it is no longer the default visible read.
  // Slotted on +page.svelte alongside the calendar cards and KPI tiles.
  // Wrapped in LazyMount per Phase 11 D-03.
  //
  // Phase 18 Plan 04 — hero reads from data.weekly_history (NOT from
  // campaigns[0].rows.find(window_kind='cumulative_since_launch')).
  // Decision A (LOCKED): maturityTier sourced from chronological weeks since
  // campaign launch — NOT from headline.week.n_days, which is always 7 for
  // completed weeks (would always resolve to 'early'). Rejected option (b)
  // drop-tiering because the existing 7-key i18n set provides richer copy
  // variation in the first 1-2 weeks. Rationale: 18-04-PLAN.md §objective.
  //
  // Reads campaign_start, ci bounds, and the per-day trajectory from
  // /api/campaign-uplift (Plan 08 extended). The legacy hard-coded
  // campaign-start constant in src/lib/forecastConfig.ts is retired —
  // campaign date now comes from campaign_calendar via the API. Guard 10
  // (Plan 11) prevents the date literal from re-appearing in src/.
  //
  // Mobile-scroll fix: Chart.tooltipContext.touchEvents='auto' (NOT
  // 'pan-x') per .claude/memory/feedback_layerchart_mobile_scroll.md.
  // Tooltip.Root uses the snippet-children form (the older shorthand binding
  // throws invalid_default_snippet on Svelte 5 — see
  // .claude/memory/feedback_svelte5_tooltip_snippet.md).
  import { Chart, Svg, Spline, Area, Tooltip, Axis, Rule } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { format, differenceInDays, parseISO } from 'date-fns';
  import { clientFetch } from '$lib/clientFetch';
  import { page } from '$app/state';
  import { t, type MessageKey } from '$lib/i18n/messages';

  type UpliftBlockRow = {
    model_name: string;
    window_kind: 'campaign_window' | 'cumulative_since_launch';
    cumulative_uplift_eur: number;
    ci_lower_eur: number;
    ci_upper_eur: number;
    naive_dow_uplift_eur: number | null;
    n_days: number;
    as_of_date: string;
  };
  type CampaignBlock = {
    campaign_id: string;
    start_date: string;
    end_date: string;
    name: string | null;
    channel: string | null;
    rows: UpliftBlockRow[];
  };
  type DailyPoint = {
    date: string;
    cumulative_uplift_eur: number;
    ci_lower_eur: number;
    ci_upper_eur: number;
  };
  // Phase 18 Plan 04 — WeeklyHistoryPoint shape returned by /api/campaign-uplift.
  type WeeklyHistoryPoint = {
    iso_week_start: string;   // ISO date Mon (yyyy-MM-dd)
    iso_week_end: string;     // ISO date Sun (yyyy-MM-dd)
    model_name: string;
    point_eur: number;
    ci_lower_eur: number;
    ci_upper_eur: number;
    n_days: 7;
  };
  type Payload = {
    campaign_start: string | null;
    cumulative_deviation_eur: number;
    as_of: string;
    model: string;
    ci_lower_eur: number | null;
    ci_upper_eur: number | null;
    naive_dow_uplift_eur: number | null;
    daily: DailyPoint[];
    weekly_history: WeeklyHistoryPoint[];   // Phase 18 Plan 04 — NEW
    campaigns: CampaignBlock[];
  };

  let data = $state<Payload | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  // Phase 18 Plan 04 — selectedWeekIndex for tap-to-scrub (Plan 05 wires bar tap).
  // Declared here so Plan 04's headline pick can reference it; null = use most recent.
  let selectedWeekIndex = $state<number | null>(null);

  $effect(() => {
    void clientFetch<Payload>('/api/campaign-uplift')
      .then((payload) => {
        data = payload;
      })
      .catch((e) => {
        console.error('[CampaignUpliftCard]', e);
        loadError = e instanceof Error ? e.message : 'fetch failed';
      })
      .finally(() => {
        loading = false;
      });
  });

  // Phase 18 Plan 04 — Headline: picks from weekly_history instead of cumulative row.
  // Filters to sarimax model_name only. Uses selectedWeekIndex when set (Plan 05
  // tap-to-scrub); defaults to most recent completed ISO week (last array entry).
  // Returns null when weekly_history is empty/missing → empty-state renders.
  const headline = $derived.by(() => {
    if (!data || !data.campaigns?.[0] || !data.weekly_history?.length) return null;
    const sarimaxWeeks = data.weekly_history.filter((w) => w.model_name === 'sarimax');
    if (sarimaxWeeks.length === 0) return null;
    const idx =
      selectedWeekIndex !== null && selectedWeekIndex < sarimaxWeeks.length
        ? selectedWeekIndex
        : sarimaxWeeks.length - 1;
    return { campaign: data.campaigns[0], week: sarimaxWeeks[idx], weeks: sarimaxWeeks };
  });

  // UPL-06 honest-label rule: when CI bounds straddle zero, replace the
  // hero number with explicit "no detectable lift" copy.
  // Phase 18 Plan 04: reads from headline.week.ci_* (not headline.row.*).
  const ciOverlapsZero = $derived.by(() => {
    if (!headline) return false;
    const lo = headline.week.ci_lower_eur;
    const hi = headline.week.ci_upper_eur;
    return lo <= 0 && hi >= 0;
  });

  // D-09 divergence warning: per-week naive_dow is not bootstrapped (Plan 02 / PATTERNS §2c).
  // Claude's Discretion: divergence warning is disabled on per-week reads.
  // The cumulative-since-launch row (which had naive_dow_uplift_eur) is no longer the hero;
  // per-week rows have naive_dow_uplift_eur=null by construction. Disabled cleanly.
  const divergenceWarning = $derived(false);

  // D-05 / D-06: maturity tier — Phase 18 Plan 04 Decision A (LOCKED).
  // Decision A option (a): derive maturityTier from chronological weeks since campaign launch
  // (Math.floor((today − campaign.start_date) / 7)), NOT from headline.week.n_days.
  // Rationale: per-week rows always have n_days=7, so the old n_days-based derivation
  // would always resolve to 'early' (n_days=7 < 14). Decision A fixes this by anchoring
  // tier to the elapsed duration since launch, which grows week-over-week.
  // Decision A option (b) — drop maturity tiering — was rejected because the existing
  // 7-key i18n set provides richer copy variation in the first 1-2 weeks. See 18-04-PLAN.md.
  type MaturityTier = 'early' | 'midweeks' | 'mature';
  const maturityTier = $derived.by<MaturityTier>(() => {
    // Decision A (Plan 18-04 LOCKED): maturity tier sourced from chronological weeks since
    // campaign launch — NOT from headline.week.n_days, which is always 7 for completed weeks.
    // Rejected option (b) drop-tiering because the existing 7-key i18n set provides richer
    // copy variation in the first 1-2 weeks.
    if (!headline?.campaign?.start_date) return 'early';
    const startMs = parseISO(headline.campaign.start_date).getTime();
    const todayMs = Date.now();
    const weeksSinceLaunch = Math.floor((todayMs - startMs) / (7 * 24 * 60 * 60 * 1000));
    if (weeksSinceLaunch < 2) return 'early';
    if (weeksSinceLaunch < 4) return 'midweeks';
    return 'mature';
  });

  // D-06 tier × CI matrix → resolves to one of 7 hero keys.
  // Phase 18 Plan 04: reads headline.week.point_eur instead of headline.row.cumulative_uplift_eur.
  // Edge case (Claude's Discretion): point_eur === 0 → treat as ciOverlapsZero=true regardless.
  const heroKey = $derived.by<MessageKey>(() => {
    if (!headline) return 'uplift_hero_too_early';
    const tier = maturityTier;
    if (tier === 'early') return 'uplift_hero_too_early';
    const s = headline.week.point_eur;
    const ciOverlap = ciOverlapsZero || s === 0;
    if (ciOverlap) {
      return tier === 'midweeks'
        ? 'uplift_hero_early_not_measurable'
        : 'uplift_hero_mature_no_lift';
    }
    const sign = s > 0 ? 'added' : 'reduced';
    return tier === 'midweeks'
      ? (`uplift_hero_early_${sign}` as MessageKey)
      : (`uplift_hero_mature_${sign}` as MessageKey);
  });

  // Vars for the mature-tier no-lift template ({weeks}).
  // Phase 18 Plan 04: uses weeksSinceLaunch (computed inline) instead of Math.floor(n_days / 7).
  const heroVars = $derived.by<Record<string, string | number> | undefined>(() => {
    if (!headline) return undefined;
    if (heroKey === 'uplift_hero_mature_no_lift') {
      const startMs = parseISO(headline.campaign.start_date).getTime();
      const weeksSinceLaunch = Math.floor((Date.now() - startMs) / (7 * 24 * 60 * 60 * 1000));
      return { weeks: weeksSinceLaunch };
    }
    return undefined;
  });

  // D-06 + Claude's Discretion: point_eur === 0 collapses to ciOverlap.
  // Hoisted out of template because Svelte 5 forbids {@const} as a non-block-immediate child.
  const isCIOverlap = $derived(
    ciOverlapsZero || (headline?.week.point_eur ?? 0) === 0
  );

  // Disclosure panel toggle (D-09 / D-11 — collapsed by default, no localStorage).
  let detailsOpen = $state(false);

  // Phase 18 Plan 04 — Week date label formatter.
  // Produces "{Mon date} – {Sun date}" using Intl.DateTimeFormat (zero bundle cost).
  // i18n key uplift_week_label wiring deferred to Plan 06; Plan 04 renders range directly.
  function formatHeadlineWeekRange(week: WeeklyHistoryPoint, locale: string): string {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    return `${fmt.format(parseISO(week.iso_week_start))} – ${fmt.format(parseISO(week.iso_week_end))}`;
  }

  // Locale-aware date formatter for the headline campaign-start date (used in card title).
  // Intl.DateTimeFormat is built into Cloudflare Workers runtime — zero bundle cost.
  function formatHeadlineDate(iso: string, locale: string): string {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(parseISO(iso));
  }

  // Sparkline source — per-day trajectory consumed directly from API daily[].
  // CONTEXT.md D-11: shape-of-uplift requires the FULL trajectory across
  // every day in the campaign window — NEVER a 2-point synthesized line.
  const sparklineData = $derived.by(() => {
    if (!data || !data.daily || data.daily.length === 0) return [];
    return data.daily.map((d) => ({
      date: parseISO(d.date),
      cum_uplift: d.cumulative_uplift_eur,
      ci_lower: d.ci_lower_eur,
      ci_upper: d.ci_upper_eur
    }));
  });

  function formatEur(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    const sign = v >= 0 ? '+' : '−';
    return `${sign}€${Math.abs(Math.round(v)).toLocaleString('de-DE')}`;
  }
</script>

{#if loading}
  <div
    class="rounded-2xl border border-zinc-200 bg-white p-4 animate-pulse"
    data-testid="campaign-uplift-card"
  >
    <div class="h-6 w-48 bg-zinc-200 rounded mb-3"></div>
    <div class="h-[100px] w-[280px] bg-zinc-100 rounded"></div>
  </div>
{:else if loadError}
  <div
    class="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500"
    data-testid="campaign-uplift-card"
  >
    Could not load uplift.
  </div>
{:else if !data || data.campaigns.length === 0 || !headline}
  <!-- RESEARCH §4 "CF still computing" empty-state.
       Phase 18 Plan 04: headline===null also covers weekly_history.length===0
       (campaign launched < 1 ISO week ago — "too early for first bar").
       v1 always has the seeded campaign_calendar row, so an empty
       campaign_uplift_v on the API side means the counterfactual fits
       have not landed yet — show the "first CI lands tomorrow" copy
       instead of hiding the slot. -->
  <div class="rounded-2xl border border-zinc-200 bg-white p-4" data-testid="campaign-uplift-card">
    {#if data?.campaign_start}
      <h2 class="text-base font-semibold text-zinc-900 mb-1">
        {t(page.data.locale, 'uplift_card_title_with_date', {
          date: formatHeadlineDate(data.campaign_start, page.data.locale)
        })}
      </h2>
      <!-- D-18 hero subtitle — also rendered in empty-state for context -->
      <p class="text-xs text-zinc-500 mb-2" data-testid="uplift-card-subtitle">
        {t(page.data.locale, 'uplift_card_subtitle')}
      </p>
    {/if}
    <p class="text-sm text-zinc-500" data-testid="cf-computing">
      {t(page.data.locale, 'uplift_card_computing')}
    </p>
  </div>
{:else}
  <div
    class="rounded-2xl border border-zinc-200 bg-white p-4"
    data-testid="campaign-uplift-card"
  >
    <h2 class="text-base font-semibold text-zinc-900 mb-1">
      {t(page.data.locale, 'uplift_card_title_with_date', {
        date: formatHeadlineDate(headline.campaign.start_date, page.data.locale)
      })}
    </h2>
    <!-- D-18 hero subtitle — frames the card BEFORE the hero answer -->
    <p class="text-xs text-zinc-500 mb-2" data-testid="uplift-card-subtitle">
      {t(page.data.locale, 'uplift_card_subtitle')}
    </p>

    <!-- Phase 18 Plan 04 — Week date label.
         "Week of {Mon} – {Sun}" via Intl.DateTimeFormat (i18n key wiring in Plan 06).
         data-testid="uplift-week-headline-range" per UPL-09 contract. -->
    <span class="text-sm text-zinc-600 block mb-1" data-testid="uplift-week-headline-range">
      Week of {formatHeadlineWeekRange(headline.week, page.data.locale)}
    </span>

    <p
      class={isCIOverlap ? 'text-lg font-bold text-zinc-900' : 'text-2xl font-bold text-zinc-900'}
      data-testid={isCIOverlap ? 'hero-ci-overlaps' : 'hero-uplift'}
    >
      {t(page.data.locale, heroKey, heroVars)}
    </p>

    <p class="text-sm text-zinc-500 mt-1" data-testid="uplift-secondary-plain">
      {t(page.data.locale, 'uplift_secondary_plain', {
        point: formatEur(headline.week.point_eur),
        lo: formatEur(headline.week.ci_lower_eur),
        hi: formatEur(headline.week.ci_upper_eur)
      })}
    </p>

    {#if sparklineData.length > 0}
      <!-- D-18 sparkline Y-axis label (W4 LOCKED above-Chart placement; not in-Svg Axis primitive) -->
      <p class="text-[11px] text-zinc-500 mb-1 mt-3">{t(page.data.locale, 'uplift_sparkline_y_label')}</p>
      <div class="chart-touch-safe" style:width="280px" style:height="100px">
        <Chart
          data={sparklineData}
          x="date"
          y={['ci_lower', 'ci_upper']}
          xScale={scaleTime()}
          yNice={2}
          padding={{ left: 36, right: 4, top: 4, bottom: 20 }}
          tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
        >
          <Svg>
            <!-- 16.2-06 D-16: Y-axis tick marks (€). 3 ticks at 375px without
                 crowding. cum_uplift is in EUR (line 183: `cum_uplift:
                 d.cumulative_uplift_eur`), so format value directly without
                 cents conversion. W4 LOCKED preserved — the rotated label
                 text stays as <p> ABOVE Chart at line 268. -->
            <Axis
              placement="left"
              ticks={3}
              format={(v: number) => (v < 0 ? '−€' : '€') + Math.abs(Math.round(v))}
              rule
            />

            <!-- 16.2-06 D-17: X-axis tick marks (days since campaign launch).
                 X channel is Date (xScale=scaleTime). Format converts each
                 tick's Date to integer days-since-headline.campaign.start_date.
                 ticks={5} fits 4-5 day labels at 375px. -->
            <Axis
              placement="bottom"
              ticks={5}
              format={(v: Date) => String(differenceInDays(v, parseISO(headline.campaign.start_date)))}
              rule
            />

            <!-- 16.2-06 D-15: counterfactual baseline — horizontal dashed line
                 at y=0 matching the legend chip "Dashed line = no campaign
                 baseline" at line 316-318 below. Rule is a Line-based
                 primitive (NOT Path-based like Spline/Area), so kebab-case
                 stroke-dasharray flows through SVGAttributes<SVGPathElement>
                 unchanged — the C-03 camelCase rule applies only to
                 Path-derived components that destructure props internally. -->
            <Rule y={0} class="stroke-zinc-500" stroke-dasharray="4 4" />

            <Area
              y0="ci_lower"
              y1="ci_upper"
              fill="currentColor"
              fillOpacity={0.06}
              line={false}
              curve={curveMonotoneX}
            />
            <Spline y="cum_uplift" class="stroke-2" curve={curveMonotoneX} />
          </Svg>
          <Tooltip.Root contained={false} class="text-xs">
            {#snippet children({ data: pt })}
              {#if pt}
                <Tooltip.Header value={format(pt.date as Date, 'MMM d')} />
                <Tooltip.List>
                  <Tooltip.Item
                    label={`Day ${differenceInDays(pt.date as Date, parseISO(headline.campaign.start_date))}`}
                    value={formatEur(pt.cum_uplift as number)}
                  />
                  <Tooltip.Item
                    label="95% CI"
                    value={`${formatEur(pt.ci_lower as number)} … ${formatEur(pt.ci_upper as number)}`}
                  />
                </Tooltip.List>
              {/if}
            {/snippet}
          </Tooltip.Root>
        </Chart>
      </div>

      <!-- D-18 X-axis caption -->
      <p class="text-[11px] text-zinc-400 text-center mt-1" data-testid="uplift-sparkline-x-caption">
        {t(page.data.locale, 'uplift_sparkline_x_caption')}
      </p>

      <!-- D-18 counterfactual baseline legend chip -->
      <div class="flex items-center gap-1 text-[11px] text-zinc-500 mt-1" data-testid="uplift-baseline-chip">
        <span aria-hidden="true" class="block w-3 h-px border-t border-dashed border-zinc-400"></span>
        {t(page.data.locale, 'uplift_baseline_label')}
      </div>
    {/if}

    <button
      type="button"
      class="mt-2 inline-flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 hover:underline underline-offset-2"
      aria-expanded={detailsOpen}
      aria-controls="uplift-details-panel"
      onclick={() => (detailsOpen = !detailsOpen)}
      data-testid="uplift-details-trigger"
    >
      {t(page.data.locale, 'uplift_details_trigger')}
      <span aria-hidden="true">{detailsOpen ? '⌄' : '›'}</span>
    </button>

    {#if detailsOpen}
      <div
        id="uplift-details-panel"
        class="mt-2 space-y-2 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600"
        data-testid="uplift-details-panel"
      >
        <!-- Phase 18 Plan 04: show this week's point estimate + CI from headline.week -->
        <p data-testid="dim-point-estimate">
          {formatEur(headline.week.point_eur)}
          (95% CI {formatEur(headline.week.ci_lower_eur)} … {formatEur(headline.week.ci_upper_eur)})
        </p>
        <p data-testid="anticipation-buffer-note">
          {t(page.data.locale, 'uplift_details_anticipation_plain')}
        </p>
        {#if divergenceWarning}
          <p class="text-amber-700" data-testid="divergence-warning">
            {t(page.data.locale, 'uplift_details_divergence_plain')}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
