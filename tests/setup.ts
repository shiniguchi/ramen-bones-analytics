import 'dotenv/config';
import { beforeAll } from 'vitest';

// Pitfall D (CONTEXT D-16): never run the test suite against the DEV Supabase
// project. If TEST_SUPABASE_URL is missing or matches DEV_SUPABASE_URL, abort.
beforeAll(() => {
  const testUrl = process.env.TEST_SUPABASE_URL;
  const devUrl = process.env.DEV_SUPABASE_URL;
  if (!testUrl) {
    // Tests that actually hit Supabase will fail on client construction;
    // unit-only runs can proceed without env vars.
    return;
  }
  if (devUrl && testUrl === devUrl) {
    throw new Error('Refusing to run tests against DEV project');
  }
});
