// Root auth guard. Runs before every route, including public ones — so
// `/login` and `/not-provisioned` are exempted explicitly to avoid a redirect
// loop when the user lands unauthenticated.
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

const PUBLIC_PATHS = new Set(['/login', '/not-provisioned']);

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (PUBLIC_PATHS.has(url.pathname)) {
    return { restaurantId: null };
  }

  const { claims } = await locals.safeGetSession();
  if (!claims) throw redirect(303, '/login');

  const restaurantId = claims.restaurant_id as string | undefined;
  if (!restaurantId) throw redirect(303, '/not-provisioned');

  return { restaurantId };
};
