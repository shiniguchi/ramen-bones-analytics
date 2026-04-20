<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-zinc-50 overflow-x-clip">
  {@render children()}
</div>
