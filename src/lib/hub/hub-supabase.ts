import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Env subset needed for the hub's server-side Supabase reads. Mirrors the
 *  SUPABASE_* fields already in the HubEnv contract (hub-env.ts). */
export interface HubSupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * Single shared server-side Supabase client for the hub. Service-role key
 * (bypasses RLS), no session persistence — the same access pattern /jobs uses.
 *
 * Returns null when the env is unconfigured so callers degrade to an empty
 * real-data state rather than crashing. MUST be used server-side only: the hub
 * reads ims_jobs, ls_events, and the hub-owned tables, several of which are
 * RLS-on with NO public policy, so they can never be queried from the client.
 *
 * This is the seam every hub data read goes through (Overview jobs, Analytics
 * ls_events, Weekly Sync) so the connection + auth options live in one place.
 */
export function getHubSupabase(env: HubSupabaseEnv): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
