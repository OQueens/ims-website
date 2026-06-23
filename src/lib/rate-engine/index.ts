// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// engine/index.ts — public API barrel for @ias/rate-engine.
// Single import surface for both the IAS SPA and the IMS hub. Re-exports only;
// no logic lives here. Types use `export type` (verbatimModuleSyntax).
//
// Phase 1 (pure, zero backend): calculate / parse / specialty / multipliers /
// geo / sanity (non-CRNA) / call rates / fuzzy / family / codec / liveCalibration.
// Phase 2 (needs injected clients via configureEngine): marketRates (Firebase),
// crnaCellLookup live fetch (Supabase) — exported here but only reached when called.

// DI seam
export { configureEngine, getDb, getSupabase } from './runtime'

// Calculate
export { calculateRate, calculateCallRate, initFactors, getPercentileRate, roundUp5, extractBillRateCap } from './rateCalculator'

// Parse
export { parseFreetextInput, buildParsedFromFreetext, parseLocumsmartAssignment } from './parser'

// Specialty data / multipliers / geography
export { SPECIALTIES, SPECIALTY_ALIASES, confidenceLabel } from './specialties'
export { SHIFT_MULT, FACILITY_MULT, DURATION_MULT } from './multipliers'
export { STATE_MULT, STATE_NAMES, STATE_DEMAND_CLASS, METRO_CITIES, STATE_COLI, NATIONAL_AVG_DENSITY } from './stateData'

// Sanity layer (CRNA dispatch needs Supabase in Phase 2; non-CRNA is pure)
export { evaluateBlsSanityCheck } from './blsSanityCheck'

// Call rates
export { CALL_RATE_DATA, getCallRateEntry, GSA_STANDARD } from './callRates'

// Fuzzy / family / codec / live (Phase-1 pure)
export { fuzzyMatchSpecialty, fuzzyMatchState, fuzzyMatchCity } from './fuzzyMatch'
export { sourceFamily, KNOWN_FAMILY_OVERRIDES } from './sourceFamily'
export { firebaseSafeKey, firebaseUnsafeKey } from './firebaseKeyCodec'
export { observedHcoProfile, observedSpecialtyProfile, enrichedJobCount } from './liveCalibration'
export { buildParsedFromJob } from './recentJobsBridge'

// Live overlays (Phase 2) live in ./index.phase2 — deliberately kept OUT of this
// Phase-1 barrel. marketRates.ts does `import { ref, get } from 'firebase/database'`
// (a VALUE import), the engine's ONLY hard dependency on the `firebase` package.
// Excluding it here keeps index.ts's import closure free of firebase, so the IMS
// hub builds Phase 1 with NO firebase install (only @supabase/supabase-js, which
// is type-only/erased here). blsSanityCheck transitively imports crnaCellLookup,
// but post-seam that pulls no backend value package — only ./runtime (type-only).

// Types
export type {
  RateFactors, CalculatedRate, CalculatedCallRate, CallRateBand, CallCompModel,
  CallRateEntry, ParsedAssignment, FreetextParseResult, RateCapFactor, RateCapUnit,
  FactorSource, ConfidenceLevel, GsaRates, RateSourceEntry, FuzzyMatchKind,
} from './types'
export type { SpecialtyRate } from './specialties'
export type { FirebaseJob } from './recentJobsBridge'
