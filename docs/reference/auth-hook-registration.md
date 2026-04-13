# Custom Access Token Hook — Registration

Migration `0002_auth_hook.sql` creates the function `public.custom_access_token_hook`.
Supabase does not fire the hook automatically — it must be registered via the Auth hooks
configuration. The Dashboard path is the supported path as of April 2026.

## Dashboard steps (required for every environment: DEV, TEST, PROD-of-a-fork)

1. Open the Supabase project → **Authentication** → **Hooks** (left sidebar).
2. Scroll to **Custom Access Token Hook** → click **Add a new hook**.
3. Select **Postgres function** → schema `public` → function `custom_access_token_hook`.
4. Click **Create hook**.
5. Sign out any existing session (old JWTs do not have the claim yet).
6. Sign back in and confirm `claims.restaurant_id` is present in the decoded access token.

## Verification

Run the JWT claim test in Plan 06 against the project to confirm:

    npx vitest run tests/integration/jwt-claim.test.ts

## config.toml (experimental — forker convenience)

At the time of writing, `supabase/config.toml` support for declaring this hook is
inconsistent across CLI versions. Prefer the Dashboard path. If your CLI supports it:

    [auth.hook.custom_access_token]
    enabled = true
    uri = "pg-functions://postgres/public/custom_access_token_hook"

If the Dashboard shows the hook as active after `supabase config push`, it worked.
Otherwise fall back to manual Dashboard registration.

## Forgetting this step

If the hook is not registered, every wrapper view returns zero rows for authenticated
users and the two-tenant isolation test in Plan 06 will fail immediately with
`expected data.length > 0`. That failure is the canonical symptom of an unregistered hook.
