<!-- docs/reference/login/+page.svelte.example -->
<script lang="ts">
  import type { ActionData } from './$types';
  let { form }: { form: ActionData } = $props();
</script>

<main>
  <h1>Sign in</h1>
  <form method="POST">
    <label>
      Email
      <input name="email" type="email" required value={form?.email ?? ''} />
    </label>
    <label>
      Password
      <input name="password" type="password" required />
    </label>
    <button type="submit">Sign in</button>
    {#if form?.message}<p role="alert">{form.message}</p>{/if}
  </form>
</main>
