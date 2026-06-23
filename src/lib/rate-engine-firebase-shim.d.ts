// PHASE-1 TYPE SHIM — remove at Phase 2.
//
// The vendored engine carries the Phase-2 files marketRates.ts (`import { ref,
// get } from 'firebase/database'`) and runtime.ts (`import type { Database }`).
// Phase-1 hub paths never import them, so `firebase` is intentionally NOT a hub
// dependency yet (Phase 1 = pure core, zero backend wiring). This ambient stub
// lets tsc / the editor resolve those references cleanly without the package.
//
// Phase 2 (when the hub wires Firebase weekly-sync-451e2): `npm i firebase` and
// DELETE this file — the real firebase types then apply.
//
// Lives OUTSIDE src/lib/rate-engine/ so `node scripts/sync-rate-engine.mjs`
// (which rmSyncs that dir) never removes it.
declare module 'firebase/database' {
  export type Database = unknown;
  export function ref(db: unknown, path?: string): unknown;
  export function get(query: unknown): Promise<{ exists(): boolean; val(): unknown }>;
}
