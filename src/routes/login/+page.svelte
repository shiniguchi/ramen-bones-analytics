<script lang="ts">
  import type { ActionData } from './$types';
  import { enhance } from '$app/forms';
  import { Button, Card, Input, Label } from '$lib/components/ui';
  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);
</script>

<main class="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
  <Card class="w-full max-w-sm p-6">
    <h1 class="mb-6 text-xl font-semibold text-zinc-900">Sign in</h1>
    <form
      method="POST"
      class="flex flex-col gap-4"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          await update();
          submitting = false;
        };
      }}
    >
      <div class="flex flex-col gap-1.5">
        <Label for="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          value={form?.email ?? ''}
          disabled={submitting}
          class="h-11 border-zinc-300"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <Label for="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          disabled={submitting}
          class="h-11 border-zinc-300"
        />
      </div>
      <Button type="submit" disabled={submitting} class="mt-2 h-11 w-full">
        {#if submitting}
          <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
          </svg>
          Signing in…
        {:else}
          Sign in
        {/if}
      </Button>
      {#if form?.message}
        <p role="alert" class="text-sm text-red-600">{form.message}</p>
      {/if}
    </form>
  </Card>
</main>
