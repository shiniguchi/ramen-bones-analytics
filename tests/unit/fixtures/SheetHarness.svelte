<script lang="ts">
  import Sheet from '$lib/components/ui/sheet.svelte';
  let { open = false, title }: { open?: boolean; title?: string } = $props();
</script>

<Sheet {open} {title}>
  <p>sheet-body-content</p>
</Sheet>
