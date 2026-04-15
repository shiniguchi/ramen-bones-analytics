<script lang="ts">
  // 20px checkbox with 44px touch-target wrapper (min-h-11).
  // Uses hidden native input for a11y + native events; visual span for styling.
  import { cn } from '$lib/utils';

  interface Props {
    checked?: boolean;
    label?: string;
    class?: string;
    onCheckedChange?: (v: boolean) => void;
  }

  let {
    checked = $bindable(false),
    label,
    class: className,
    onCheckedChange
  }: Props = $props();
</script>

<label
  data-slot="checkbox"
  class={cn('flex items-center gap-3 min-h-11 cursor-pointer select-none', className)}
>
  <input
    type="checkbox"
    {checked}
    class="sr-only"
    onchange={(e) => {
      checked = e.currentTarget.checked;
      onCheckedChange?.(checked);
    }}
  />
  <span
    role="checkbox"
    aria-checked={checked}
    class={cn(
      'size-5 shrink-0 rounded border border-input flex items-center justify-center transition-colors',
      checked && 'bg-primary border-primary text-primary-foreground'
    )}
  >
    {#if checked}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="size-3.5"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.3a1 1 0 0 1-1.42 0l-3.75-3.77a1 1 0 1 1 1.42-1.41l3.04 3.06 6.54-6.59a1 1 0 0 1 1.414-.006Z"
          clip-rule="evenodd"
        />
      </svg>
    {/if}
  </span>
  {#if label}
    <span class="text-sm">{label}</span>
  {/if}
</label>
