<script lang="ts">
  import { LogOut } from 'lucide-svelte';
</script>

<header class="flex items-center justify-between px-4 py-4">
  <h1 class="text-xl font-semibold text-zinc-900">Ramen Bones</h1>
  <form method="POST" action="/?/logout">
    <button
      type="submit"
      aria-label="Sign out"
      class="min-h-11 min-w-11 inline-flex items-center justify-center rounded-full text-zinc-900 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
    >
      <LogOut size={20} />
    </button>
  </form>
</header>
