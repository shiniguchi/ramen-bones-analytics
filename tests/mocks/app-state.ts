// Stub for $app/state used in vitest (no SvelteKit runtime).
// Provides a minimal `page` object so components can read url.searchParams.
export const page = {
  url: new URL('http://localhost:5173/?range=7d&grain=week'),
  params: {},
  route: { id: '/' },
  status: 200,
  error: null,
  data: {},
  form: null,
  state: {}
};
