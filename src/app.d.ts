import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      safeGetSession: () => Promise<{
        session: Session | null;
        user: User | null;
        claims: Record<string, unknown> | null;
      }>;
    }
    interface PageData {
      restaurantId?: string;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
