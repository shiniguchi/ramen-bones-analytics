import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.TEST_SUPABASE_URL!;
const SERVICE = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.TEST_SUPABASE_ANON_KEY!;

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function tenantClient(): SupabaseClient {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
