import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { Locale } from '$lib/i18n/locales';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      safeGetSession: () => Promise<{
        session: Session | null;
        user: User | null;
        claims: Record<string, unknown> | null;
      }>;
      locale: Locale;
    }
    interface PageData {
      restaurantId?: string | null;
      locale: Locale;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
