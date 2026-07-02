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
import { configureEngine, loadMarketBucketRates } from '../rate-engine/index.phase2';
import { getHubFirebaseDb } from './hub-firebase';

let _inflight: Promise<number> | null = null;

/** Configure the engine with the hub's RTDB handle and load the live market
 *  overlay. Single-flight + memoised: the first call does the work, every later
 *  call returns the same resolved result without re-reading the RTDB. Resolves to
 *  the count of cells whose quote ANCHOR was promoted from a market-typed v2
 *  posterior (loadMarketBucketRates' return; the caller ignores it). Never throws —
 *  loadMarketBuckets already absorbs any fetch/parse error into a safe default, so a
 *  slow or unreachable RTDB leaves every cell on its curated band, never breaking
 *  the quote.
 *
 *  loadMarketBucketRates() is the SOLE live overlay (Move #1 trust ladder): it
 *  anchors the quote on a MARKET-TYPED posterior when corroborated, else leaves the
 *  cell on its audited CURATED band. The crude legacy overlay (loadMarketRates) is
 *  RETIRED (outlier-prone min/max/p70). Same design + safety posture as the
 *  dashboard's App.tsx init. */
export function initLiveMarket(): Promise<number> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    configureEngine({ db: getHubFirebaseDb() });
    return loadMarketBucketRates();
  })();
  return _inflight;
}

/** Test-only reset of the single-flight memo. */
export function __resetSimLive(): void {
  _inflight = null;
}
