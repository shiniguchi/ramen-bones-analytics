<script lang="ts">
  import type { ActionData } from './$types';
  import { Button, Card, Input, Label } from '$lib/components/ui';
  let { form }: { form: ActionData } = $props();
</script>

<main class="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
  <Card class="w-full max-w-sm p-6">
    <h1 class="mb-6 text-xl font-semibold text-zinc-900">Sign in</h1>
    <form method="POST" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label for="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          value={form?.email ?? ''}
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
          class="h-11 border-zinc-300"
        />
      </div>
      <Button type="submit" class="mt-2 h-11 w-full">Sign in</Button>
      {#if form?.message}
        <p role="alert" class="text-sm text-red-600">{form.message}</p>
      {/if}
    </form>
  </Card>
</main>
