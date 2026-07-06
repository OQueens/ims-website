// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// =============================================================================
// firebaseKeyCodec.ts — Reversible Firebase RTDB key codec for SPECIALTIES.
//
// Firebase RTDB treats `/` as a path separator, so SPECIALTIES keys that
// contain literal slashes (`ob/gyn`, `hematology/oncology`, the seven
// `np/pa (...)` variants) cannot be used as raw path segments — a write to
// `rate-simulator/market-rates/ob/gyn` would create nested data at
// `rate-simulator/market-rates/ob/gyn` (3 levels deep), which the reader's
// `Object.entries(data)` flat-key contract cannot resolve.
//
// Encoding: percent-encode `%` first (so `%`-bearing inputs round-trip),
// then percent-encode `/`. Decoding sweeps both escape sequences in a
// single regex pass so `%252F` (an encoded literal `%2F`) decodes back to
// `%2F` rather than collapsing into `%/`.
//
// No current SPECIALTIES key contains `%`, so under today's data the safe
// key for a slash-free input is the identity. The `%` escape is defensive
// against future names; the round-trip is preserved either way.
//
// Module is dependency-free so it can be imported by both the client app
// (marketRates.ts reader) and the Node-side bridge (bridge-rate-
// intelligence.ts writer) without dragging in firebase or firebase-admin.
// =============================================================================

/** Encode a SPECIALTIES key for use as a Firebase RTDB path segment. */
export function firebaseSafeKey(specialty: string): string {
  return specialty.replace(/%/g, '%25').replace(/\//g, '%2F')
}

/** Decode a Firebase RTDB path segment back to its SPECIALTIES key. */
export function firebaseUnsafeKey(safeKey: string): string {
  return safeKey.replace(/%2F|%25/g, (m) => (m === '%2F' ? '/' : '%'))
}
