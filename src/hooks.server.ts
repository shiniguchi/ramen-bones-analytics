// docs/reference/hooks.server.ts.example
// Phase 4 will move this to src/hooks.server.ts (rename, drop .example suffix).
// CI guard #2 scans for getSession() calls on server without getClaims/getUser
// in the same file — this file satisfies the pattern as a positive baseline.
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$env/static/public';
import { createServerClient } from '@supabase/ssr';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => event.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            event.cookies.set(name, value, { ...options, path: '/' });
          });
        }
      }
    }
  );

  // safeGetSession: validate JWT via getClaims() (preferred) before trusting the cookie.
  // Never trust getSession() alone — Pattern 5 / D-12 / CI guard #2.
  event.locals.safeGetSession = async () => {
    const { data: { session } } = await event.locals.supabase.auth.getSession();
    if (!session) return { session: null, user: null, claims: null };

    const { data: { claims }, error } = await event.locals.supabase.auth.getClaims();
    if (error || !claims) return { session: null, user: null, claims: null };

    return { session, user: session.user, claims };
  };

  const response = await resolve(event, {
    filterSerializedResponseHeaders: (name) =>
      name === 'content-range' || name === 'x-supabase-api-version'
  });

  // Security headers for SSR responses.
  // adapter-cloudflare only applies `_headers` to static assets, so SSR responses
  // must set these directly. Values mirror `_headers` verbatim — defense-in-depth.
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
  );
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );

  return response;
};
