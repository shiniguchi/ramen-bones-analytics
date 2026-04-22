<script lang="ts">
  // InsightCard.svelte — weekly insight card at the top of the dashboard.
  // Read-only for viewers; owner-role admins get inline edit via `use:enhance`
  // form action `?/updateInsight` that calls the SECURITY DEFINER RPC
  // `public.admin_update_insight`. Authorization is enforced server-side; the
  // `isAdmin` prop here only gates the edit UI, not the write permission.
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  type Insight = {
    id?: string;
    headline: string;
    body: string;
    action_points: string[];
    business_date: string;
    fallback_used: boolean;
    generated_at?: string;
  };

  let {
    insight,
    isAdmin = false
  }: { insight: Insight; isAdmin?: boolean } = $props();

  // Weekly-cadence label (e.g. "Week ending Apr 15, 2026"). The dashboard
  // refreshes once per week, so we anchor the card to the snapshot date
  // rather than a relative "yesterday" indicator.
  const weekEndingLabel = $derived.by(() => {
    try {
      const d = new Date(insight.business_date + 'T00:00:00Z');
      return 'Week ending ' + new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
      }).format(d);
    } catch {
      return insight.business_date;
    }
  });

  // Cadence + last-run footer: makes the weekly refresh schedule visible and
  // surfaces the actual generated_at so stale runs (missed Mondays) are obvious
  // instead of silently-old copy. Format: "Refreshed weekly · last run Apr 22".
  const refreshLabel = $derived.by(() => {
    if (!insight.generated_at) return 'Refreshed weekly';
    try {
      const d = new Date(insight.generated_at);
      const when = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      }).format(d);
      return `Refreshed weekly · last run ${when}`;
    } catch {
      return 'Refreshed weekly';
    }
  });

  // Local edit state. The form submits to `?/updateInsight` which calls the
  // admin RPC; on success we `invalidateAll()` to pull the updated row.
  let mode = $state<'view' | 'edit'>('view');
  let draftHeadline = $state('');
  let draftBody = $state('');
  // Pad to 3 slots so the form always shows 3 bullet inputs. Empty strings
  // are filtered out server-side (`filter(Boolean)` in the form action).
  let draftBullets = $state<string[]>(['', '', '']);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);

  function enterEdit() {
    draftHeadline = insight.headline;
    draftBody = insight.body;
    draftBullets = [
      insight.action_points[0] ?? '',
      insight.action_points[1] ?? '',
      insight.action_points[2] ?? ''
    ];
    errorMsg = null;
    mode = 'edit';
  }

  function cancelEdit() {
    errorMsg = null;
    mode = 'view';
  }
</script>

<section
  role="article"
  class="relative rounded-xl border border-zinc-200 bg-white p-4"
>
  <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mb-1">
    {weekEndingLabel}
  </span>

  {#if isAdmin && mode === 'view'}
    <button
      type="button"
      onclick={enterEdit}
      aria-label="Edit insight"
      class="absolute top-3 right-3 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
    >
      <!-- pencil icon (Lucide "pencil"), inline SVG so we don't add a dep -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  {/if}

  {#if mode === 'view'}
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

    <!-- Footer: cadence + last-run timestamp (+ auto-generated chip when the
         fallback template fired instead of Haiku). Combines into one line so
         viewers get the full provenance at a glance. -->
    <span class="block text-xs leading-[1.4] font-normal text-zinc-500 mt-3">
      {refreshLabel}{#if insight.fallback_used}&nbsp;· auto-generated{/if}
    </span>
  {:else}
    <!-- Edit mode: form posts to the dashboard `updateInsight` action.
         `use:enhance` intercepts to keep the SPA shell, then we reload the
         insight row via invalidateAll() on success. -->
    <form
      method="POST"
      action="?/updateInsight"
      use:enhance={() => {
        saving = true;
        errorMsg = null;
        return async ({ result }) => {
          saving = false;
          if (result.type === 'success' && result.data?.ok) {
            await invalidateAll();
            mode = 'view';
          } else if (result.type === 'success' && !result.data?.ok) {
            errorMsg = String(result.data?.error ?? 'update failed');
          } else if (result.type === 'failure') {
            errorMsg = String(result.data?.error ?? 'update failed');
          } else if (result.type === 'error') {
            errorMsg = result.error?.message ?? 'update failed';
          }
        };
      }}
      class="space-y-3"
    >
      <input type="hidden" name="id" value={insight.id ?? ''} />

      <label class="block">
        <span class="block text-xs font-medium text-zinc-600 mb-1">Headline</span>
        <textarea
          name="headline"
          bind:value={draftHeadline}
          rows="2"
          required
          class="w-full rounded-md border border-zinc-300 px-2 py-1 text-base font-semibold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400"
        ></textarea>
      </label>

      <label class="block">
        <span class="block text-xs font-medium text-zinc-600 mb-1">Body</span>
        <textarea
          name="body"
          bind:value={draftBody}
          rows="4"
          required
          class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
        ></textarea>
      </label>

      <fieldset class="space-y-2">
        <legend class="block text-xs font-medium text-zinc-600">Bullets (up to 3)</legend>
        {#each draftBullets as _, i}
          <input
            type="text"
            name="action_points"
            bind:value={draftBullets[i]}
            maxlength="80"
            placeholder={`Bullet ${i + 1}`}
            class="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        {/each}
      </fieldset>

      {#if errorMsg}
        <p class="text-xs text-red-600" role="alert">{errorMsg}</p>
      {/if}

      <div class="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          class="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onclick={cancelEdit}
          disabled={saving}
          class="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  {/if}
</section>
