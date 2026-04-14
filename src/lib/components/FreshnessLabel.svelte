<script lang="ts">
  // D-10 / D-10a: humanized "Last updated Xh ago" with threshold coloring.
  // Default muted, yellow >30h, red >48h, plus a stale-warning suffix.
  import { formatDistanceToNowStrict, differenceInHours } from 'date-fns';

  let { lastIngestedAt }: { lastIngestedAt: string | null } = $props();

  const label = $derived.by(() => {
    if (!lastIngestedAt) return { text: 'No data yet', color: 'text-zinc-500' };
    const ts = new Date(lastIngestedAt);
    const hours = differenceInHours(new Date(), ts);
    const suffix = hours > 48 ? ' \u2014 data may be outdated' : '';
    const text = `Last updated ${formatDistanceToNowStrict(ts, { roundingMethod: 'floor' })} ago${suffix}`;
    const color =
      hours > 48 ? 'text-red-600' : hours > 30 ? 'text-yellow-600' : 'text-zinc-500';
    return { text, color };
  });
</script>

<p class="text-xs {label.color}">{label.text}</p>
