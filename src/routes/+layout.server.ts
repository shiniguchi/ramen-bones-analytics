// docs/reference/+layout.server.ts.example
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const { claims } = await locals.safeGetSession();
  if (!claims) throw redirect(303, '/login');

  const restaurantId = claims.restaurant_id as string | undefined;
  if (!restaurantId) throw redirect(303, '/not-provisioned');

  return { restaurantId };
};
