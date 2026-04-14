<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    class?: string;
  }

  let { class: className, children, ...rest }: Props = $props();
</script>

<div role="group" class={cn('inline-flex items-center justify-center gap-1', className)} {...rest}>
  {@render children?.()}
</div>
