<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
  }

  let { class: className, children, ...rest }: Props = $props();
</script>

<div class={cn('relative inline-block', className)} {...rest}>
  {@render children?.()}
</div>
