<script lang="ts">
  // D-10 / D-10a: humanized "Last updated Xh ago" with threshold coloring.
  // Default muted, yellow >30h, red >48h, plus a stale-warning suffix.
  import { formatDistanceToNowStrict, differenceInHours } from 'date-fns';
  import { page } from '$app/state';
  import { t } from '$lib/i18n/messages';

  let { lastIngestedAt }: { lastIngestedAt: string | null } = $props();

  const label = $derived.by(() => {
    const loc = page.data.locale;
    if (!lastIngestedAt) return { text: t(loc, 'freshness_no_data'), color: 'text-zinc-500' };
    const ts = new Date(lastIngestedAt);
    const hours = differenceInHours(new Date(), ts);
    const ago = formatDistanceToNowStrict(ts, { roundingMethod: 'floor' });
    const suffix = hours > 48 ? t(loc, 'freshness_outdated_suffix') : '';
    const text = t(loc, 'freshness_last_updated', { ago }) + suffix;
    const color =
      hours > 48 ? 'text-red-600' : hours > 30 ? 'text-yellow-600' : 'text-zinc-500';
    return { text, color };
  });
</script>

<p data-testid="freshness-label" class="text-xs tabular-nums {label.color}">{label.text}</p>
