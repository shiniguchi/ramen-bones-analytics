import type { PageServerLoad } from './$types';

// Placeholder loader — real data loading lands in 04-02.
export const load: PageServerLoad = async () => {
  return { range: '7d' as const, grain: 'week' as const };
};
