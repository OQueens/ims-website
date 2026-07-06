// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// engine/runtime.ts — dependency-injection seam.
//
// The engine reaches outside its own folder in exactly two places:
//   - marketRates.ts  needs the Firebase RTDB client (`db`)
//   - crnaCellLookup.ts needs the Supabase client (`supabase`)
// Both now import from here instead of `../../../config/*`. Each host app calls
// configureEngine() once at init with ITS OWN clients — but both hosts MUST
// point at the SAME backends: Supabase `gbakzhibzotugfyktcrt`, Firebase
// `weekly-sync-451e2`. Forking the backends silently breaks the D-39 rate-type
// precedence (it excludes agency bill rates from pay medians).
//
// Module-eval touches no client. The clients are required only when a backend
// function is actually CALLED — which is why the pure Phase-1 calc/parse path
// (calculateRate / parseFreetextInput / non-CRNA sanity) needs no configuration
// at all, even though blsSanityCheck transitively imports this file.
import type { Database } from 'firebase/database'
import type { SupabaseClient } from '@supabase/supabase-js'

let _db: Database | null = null
let _supabase: SupabaseClient | null = null

export function configureEngine(opts: { db?: Database; supabase?: SupabaseClient }): void {
  if (opts.db) _db = opts.db
  if (opts.supabase) _supabase = opts.supabase
}

export function getDb(): Database {
  if (!_db) throw new Error('engine: db not configured — call configureEngine({ db }) at app init')
  return _db
}

export function getSupabase(): SupabaseClient {
  if (!_supabase) throw new Error('engine: supabase not configured — call configureEngine({ supabase }) at app init')
  return _supabase
}

/** Test-only reset. Not part of the public API. */
export function __resetEngineRuntime(): void {
  _db = null
  _supabase = null
}
