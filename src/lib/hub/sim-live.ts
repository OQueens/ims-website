// Phase-2 live-market wiring for the hub Rate Simulator (client-only). This is the
// ONLY hub module that imports the engine's Phase-2 barrel (index.phase2), which
// pulls `firebase/database` as a VALUE import — so firebase lands solely in this
// lazily-imported client chunk, never the SSR/build bundle or the main hub bundle.
//
// Mirrors the dashboard's App.tsx init: configureEngine({ db }) once, then
// loadMarketRates() to overlay the curated SPECIALTIES band with fresh, multi-
// source RTDB data. The sim-adapter's quote path reads that SAME SPECIALTIES
// singleton, so once this resolves every re-quote reflects live data — exactly the
// dashboard's "static first paint, then live" behaviour.
//
// SINGLETON CONTRACT (verified against the prod bundle 2026-06-26): sim-adapter
// (../rate-engine/index) and this module (../rate-engine/index.phase2 → marketRates)
// both resolve to the one ./specialties module — Vite/Rollup dedup it into a single
// shared chunk, so loadMarketRates' in-place mutation reaches the adapter's reads.
// Do NOT add a manualChunks rule, resolve.alias, or optimizeDeps entry that could
// split specialties.ts into two instances — that would silently make this a no-op.
//
// Supabase is intentionally NOT injected here: the hub sim's quote path
// (quoteFromFactors → calculateRate) consumes only the RTDB market overlay, never
// the Supabase CRNA cell envelope (a BLS-anchored sanity FLOOR the sim doesn't
// surface). RTDB `rate-simulator/*` is public-read, so no credentials reach the
// browser.
import { configureEngine, loadMarketRates } from '../rate-engine/index.phase2';
import { getHubFirebaseDb } from './hub-firebase';

let _inflight: Promise<number> | null = null;

/** Configure the engine with the hub's RTDB handle and load the live market
 *  overlay. Single-flight + memoised: the first call does the work, every later
 *  call returns the same resolved result without re-reading the RTDB. Resolves to
 *  the count of specialties overlaid (loadMarketRates' return). Never throws —
 *  loadMarketRates already absorbs any fetch/parse error into a safe static
 *  fallback, so a slow or unreachable RTDB degrades to the curated band, it never
 *  breaks the quote. */
export function initLiveMarket(): Promise<number> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    configureEngine({ db: getHubFirebaseDb() });
    return loadMarketRates();
  })();
  return _inflight;
}

/** Test-only reset of the single-flight memo. */
export function __resetSimLive(): void {
  _inflight = null;
}
