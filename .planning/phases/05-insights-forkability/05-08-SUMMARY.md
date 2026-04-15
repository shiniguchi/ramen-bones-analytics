---
phase: 05-insights-forkability
plan: 08
status: complete
gap_closure: true
closes_gap: "05-HUMAN-UAT.md Gap 2 — friend's Supabase Auth account not provisioned"
requirements: [INS-03, INS-05]
---

## Outcome

Friend's Supabase Auth user provisioned in DEV and linked to the founder's restaurant as owner. JWT hook verified end-to-end: a real password sign-in mints an access token whose claims include `restaurant_id`. Remaining work is irreducibly manual (browser sign-in on deployed URL + secure credential handoff) and is captured below for the founder to complete.

## Task 1 — Auth user created (Admin API)

Created via Supabase Auth Admin API (`POST /auth/v1/admin/users`) against DEV project, not the Dashboard UI — equivalent result, fewer clicks, `email_confirm: true` so no invite email required.

- **user_id:** `6d6eb5e2-537b-4d15-9e12-f36f408a1da1`
- **email:** `ramenbones.g@gmail.com`
- **email_confirmed_at:** `2026-04-15T22:35:41Z`
- **provider:** email
- **password:** NOT recorded in this file. Held only by the founder and Supabase's hashed storage.

## Task 2 — memberships row inserted

Inserted via PostgREST (`POST /rest/v1/memberships` with service role + `Prefer: resolution=merge-duplicates`). Table shape confirmed from `supabase/migrations/0001_tenancy_schema.sql` — PK is `user_id` alone (not composite), so the plan's example `ON CONFLICT (user_id, restaurant_id)` was adapted to merge-duplicates via PostgREST.

Returned row (verbatim):

```json
[
  {
    "user_id": "6d6eb5e2-537b-4d15-9e12-f36f408a1da1",
    "restaurant_id": "ba1bf707-aae9-46a9-8166-4b6459e6c2fd",
    "role": "owner",
    "created_at": "2026-04-15T22:35:57.20267+00:00"
  }
]
```

## Task 3A — JWT claim verified end-to-end

Instead of calling `custom_access_token_hook` directly (function is revoked from `authenticated`/`anon` and only granted to `supabase_auth_admin`), verified end-to-end by signing in as the friend via `POST /auth/v1/token?grant_type=password` and decoding the returned access token.

Decoded JWT claims (relevant fields):

```json
{
  "sub": "6d6eb5e2-537b-4d15-9e12-f36f408a1da1",
  "email": "ramenbones.g@gmail.com",
  "role": "authenticated",
  "restaurant_id": "ba1bf707-aae9-46a9-8166-4b6459e6c2fd",
  "aal": "aal1"
}
```

`restaurant_id` is present at the top level of the claims object, confirming `custom_access_token_hook` (migrations 0002 + 0015) fires correctly for this user and reads the memberships row inserted in Task 2. This is a stronger signal than a direct function SELECT because it exercises the real GoTrue → hook → JWT path.

## Task 3B — Browser sign-in on deployed URL — PASS

Founder verified on 2026-04-15 via Safari Private Browsing on macOS:

- URL: `https://ramen-bones-analytics.pages.dev/login`
- Credentials: `ramenbones.g@gmail.com` + shared password
- Result: sign-in succeeded, landed on dashboard (not `/not-provisioned`)

Confirms the end-to-end session cookie + JWT path works for the friend's account on the deployed Cloudflare Pages build.

## Task 3C — Secure credential handoff — PENDING (founder)

Not automatable. Founder to:

- Share `ramenbones.g@gmail.com` + password via a secure channel (Signal, 1Password share link, etc.)
- Record channel + date below
- Do NOT use plain email, SMS, or any logged chat system

**Channel used:** in person (face-to-face)
**Date shared:** handled by founder out-of-band
**Friend confirmed receipt:** founder-managed

## Security notes

- Password was provided to the assistant in-chat, used once to create the user, and is not persisted in any committed file, log, or summary artifact.
- The `user_id` UUID is not a secret (it appears in JWT claims visible to the client).
- `SUPABASE_SERVICE_ROLE_KEY` was read from `.env` only; never echoed, logged, or committed.

## Gap closure

Closes `05-HUMAN-UAT.md` Gap 2 at the infra layer. Gap 2 will be fully resolved once Task 3B completes — the founder's browser sign-in is the user-visible confirmation.

Unblocks `05-06` Task 3 (friend's iPhone sign-off on the InsightCard) from the auth side.
