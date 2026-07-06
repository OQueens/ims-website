// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// engine/index.phase2.ts — Phase-2 live-overlay surface.
// Re-exports the full Phase-1 API PLUS the backend-backed functions that require
// configureEngine({ db, supabase }) to have been called. Importing THIS barrel
// pulls marketRates.ts → `firebase/database` (a value import), so any consumer of
// index.phase2 must have the `firebase` package installed. The IMS hub adopts
// this only when it wires Phase 2 (Firebase weekly-sync-451e2 + Supabase
// gbakzhibzotugfyktcrt). Phase-1 consumers import ./index instead.
export * from './index'

// Firebase RTDB market overlays + calibration (need configureEngine({ db })).
export { computeDisplayedRate, computeDisplayedBill, loadMarketRates, loadMarketBuckets, loadMarketBucketRates, applyMarketBucketsOverlay, DEFAULT_ANCHORABLE_RATE_TYPES, loadSpecialtyCalibration } from './marketRates'
export type { BucketOverlayOptions } from './marketRates'

// Supabase CRNA cell envelope (needs configureEngine({ supabase })).
export { getCrnaCellEnvelope, deriveLocumMultCrna } from './crnaCellLookup'
