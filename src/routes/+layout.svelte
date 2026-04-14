<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-zinc-50 overflow-x-hidden">
  {@render children()}
</div>
