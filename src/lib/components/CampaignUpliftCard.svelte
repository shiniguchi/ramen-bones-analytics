<script lang="ts">
  // Phase 16 Plan 09 — dashboard's campaign-uplift card.
  // RESEARCH §3 + §4 / CONTEXT.md D-11. Hero number + 280×100px sparkline
  // (LayerChart Spline + low-opacity Area CI band) + tap-to-pin tooltip +
  // honest "CI overlaps zero" label rule. Slots between
  // InvoiceCountForecastCard and the KPI tiles on +page.svelte. Wrapped in
  // LazyMount per Phase 11 D-03.
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
  import { Chart, Svg, Spline, Area, Tooltip } from 'layerchart';
  import { scaleTime } from 'd3-scale';
  import { curveMonotoneX } from 'd3-shape';
  import { format, differenceInDays, parseISO } from 'date-fns';
  import { clientFetch } from '$lib/clientFetch';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';

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
  type Payload = {
    campaign_start: string | null;
    cumulative_deviation_eur: number;
    as_of: string;
    model: string;
    ci_lower_eur: number | null;
    ci_upper_eur: number | null;
    naive_dow_uplift_eur: number | null;
    daily: DailyPoint[];
    campaigns: CampaignBlock[];
  };

  let data = $state<Payload | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

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

  // Headline: sarimax × cumulative_since_launch for the most recent campaign.
  const headline = $derived.by(() => {
    if (!data || data.campaigns.length === 0) return null;
    const c = data.campaigns[0];
    const r = c.rows.find(
      (row) => row.model_name === 'sarimax' && row.window_kind === 'cumulative_since_launch'
    );
    return r ? { campaign: c, row: r } : null;
  });

  // UPL-06 honest-label rule: when CI bounds straddle zero, replace the
  // hero number with explicit "no detectable lift" copy. Falls back to
  // ci_lower_eur/ci_upper_eur from the headline row OR the top-level
  // ci bounds (in case the headline row has fewer fields populated).
  const ciOverlapsZero = $derived.by(() => {
    if (!headline) return false;
    const lo = headline.row.ci_lower_eur;
    const hi = headline.row.ci_upper_eur;
    return lo <= 0 && hi >= 0;
  });

  // D-09 divergence warning: sarimax vs naive_dow disagree by sign OR
  // magnitude differs by >50%. Surfaces a low-key amber note rather than
  // a blocking message — methodology check, not a dealbreaker.
  const divergenceWarning = $derived.by(() => {
    if (!headline) return false;
    const n = headline.row.naive_dow_uplift_eur;
    if (n === null) return false;
    const s = headline.row.cumulative_uplift_eur;
    const signDisagree = Math.sign(s) !== Math.sign(n) && (s !== 0 || n !== 0);
    const magnitudeDivergent = Math.abs(s - n) / Math.max(Math.abs(s), 1) > 0.5;
    return signDisagree || magnitudeDivergent;
  });

  // D-05 / D-06: maturity tier from server-truth headline.row.n_days.
  type MaturityTier = 'early' | 'midweeks' | 'mature';
  const maturityTier = $derived.by<MaturityTier>(() => {
    if (!headline) return 'early';
    const n = headline.row.n_days;
    if (n < 14) return 'early';
    if (n < 28) return 'midweeks';
    return 'mature';
  });

  // D-06 tier × CI matrix → resolves to one of 7 hero keys.
  // Edge case (Claude's Discretion): cumulative_uplift_eur === 0 → treat as ciOverlapsZero=true regardless.
  const heroKey = $derived.by<string>(() => {
    if (!headline) return 'uplift_hero_too_early';
    const tier = maturityTier;
    if (tier === 'early') return 'uplift_hero_too_early';
    const s = headline.row.cumulative_uplift_eur;
    const ciOverlap = ciOverlapsZero || s === 0;
    if (ciOverlap) {
      return tier === 'midweeks'
        ? 'uplift_hero_early_not_measurable'
        : 'uplift_hero_mature_no_lift';
    }
    const sign = s > 0 ? 'added' : 'reduced';
    return tier === 'midweeks'
      ? `uplift_hero_early_${sign}`
      : `uplift_hero_mature_${sign}`;
  });

  // Vars for the mature-tier no-lift template ({weeks}); undefined otherwise.
  const heroVars = $derived.by<Record<string, string | number> | undefined>(() => {
    if (!headline) return undefined;
    if (heroKey === 'uplift_hero_mature_no_lift') {
      return { weeks: Math.floor(headline.row.n_days / 7) };
    }
    return undefined;
  });

  // Disclosure panel toggle (D-09 / D-11 — collapsed by default, no localStorage).
  let detailsOpen = $state(false);

  // Locale-aware date formatter for the headline campaign-start date.
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
       v1 always has the seeded campaign_calendar row, so an empty
       campaign_uplift_v on the API side means the counterfactual fits
       have not landed yet — show the "first CI lands tomorrow" copy
       instead of hiding the slot (matches sibling card convention; a
       blank gap on the dashboard reads as broken UI). The hard "no
       campaigns at all + no calendar row" case is theoretical for v1
       and would still hit this same shell — acceptable per spec. -->
  <div class="rounded-2xl border border-zinc-200 bg-white p-4" data-testid="campaign-uplift-card">
    <h2 class="text-base font-semibold text-zinc-900 mb-1">
      {#if data?.campaign_start}
        Did the {format(parseISO(data.campaign_start), 'MMM d, yyyy')} campaign work?
      {:else}
        Campaign uplift
      {/if}
    </h2>
    <p class="text-sm text-zinc-500" data-testid="cf-computing">
      Counterfactual is computing — first CI lands tomorrow morning.
    </p>
  </div>
{:else}
  <div
    class="rounded-2xl border border-zinc-200 bg-white p-4"
    data-testid="campaign-uplift-card"
  >
    <h2 class="text-base font-semibold text-zinc-900 mb-1">
      Did the {format(parseISO(headline.campaign.start_date), 'MMM d, yyyy')} campaign work?
    </h2>

    {#if ciOverlapsZero}
      <p class="text-lg font-bold text-zinc-900" data-testid="hero-ci-overlaps">
        CI overlaps zero — no detectable lift
      </p>
      <p class="text-sm text-zinc-500 mt-0.5" data-testid="dim-point-estimate">
        {formatEur(headline.row.cumulative_uplift_eur)}
        (95% CI {formatEur(headline.row.ci_lower_eur)} … {formatEur(headline.row.ci_upper_eur)})
      </p>
    {:else}
      <p class="text-2xl font-bold text-zinc-900" data-testid="hero-uplift">
        Cumulative uplift: {formatEur(headline.row.cumulative_uplift_eur)}
      </p>
      <p class="text-xs text-zinc-500 mt-0.5">
        95% CI {formatEur(headline.row.ci_lower_eur)} … {formatEur(headline.row.ci_upper_eur)}
      </p>
    {/if}

    {#if sparklineData.length > 0}
      <div class="mt-3 chart-touch-safe" style:width="280px" style:height="100px">
        <Chart
          data={sparklineData}
          x="date"
          y={['ci_lower', 'ci_upper']}
          xScale={scaleTime()}
          yNice={2}
          padding={{ left: 0, right: 0, top: 4, bottom: 4 }}
          tooltipContext={{ mode: 'bisect-x', touchEvents: 'auto' }}
        >
          <Svg>
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
          <Tooltip.Root contained="window" class="max-w-[80vw] text-xs">
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
    {/if}

    {#if divergenceWarning}
      <p class="mt-2 text-xs text-amber-600" data-testid="divergence-warning">
        Naive baseline disagrees — review the methodology.
      </p>
    {/if}

    <p class="mt-2 text-[11px] text-zinc-400" data-testid="anticipation-buffer-note">
      Counterfactual fits on data ≥7 days before the campaign start (anticipation buffer).
    </p>
  </div>
{/if}
