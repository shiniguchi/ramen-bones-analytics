<script lang="ts">
  import Popover from '$lib/components/ui/popover.svelte';
  let { open = false }: { open?: boolean } = $props();
</script>

<Popover {open}>
  {#snippet trigger()}
    <button>open</button>
  {/snippet}
  {#snippet children()}
    <p>popover-body-content</p>
  {/snippet}
</Popover>
