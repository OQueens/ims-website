// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// blsSanityCheck.ts — Phase 3 step 2 BLS OEWS sanity-check layer (v3)
// Compares displayed simulator hourly rates against BLS OEWS May 2024
// state-level wage data via per-specialty SOC mapping + 15-family locum
// multipliers + p25/p75-band-aware thresholds + mean-fallback severity cap.
//
// Engine is pure + framework-free. UI rendering lives in
// src/features/rate-simulator/components/MarketContext.tsx.
//
// Plan: docs/superpowers/plans/2026-05-01-rate-sim-phase-3-step-2-bls-sanity-check.md
// Codex review chain (committed):
//   round-1 (task-monb511w-buuejn): NEEDS-REWORK 10 findings; round-1 fold
//     delivered 88-key mapping with detail-SOC primaries, 7-family multiplier
//     lattice, p25/p75 band-aware thresholds, mean-fallback verdict cap,
//     invalid rate guard, state normalization, hidden-when-unavailable chip.
//   round-2 (task-moncc465-i0pkuz): SHOULD on stale plan prose folded.
//   round-3 (task-moncnudm-pl4bwb): probe-gate calibration — expanded
//     7→15 SOC families, widened BAND_HARD_GAP 15→25, tightened
//     MEAN_CAP_RATIO 2.0→1.5; followed by empirical nudges (anesthesia
//     family / IR / EP / neurointervention / gyn-onc → PHYSICIAN_HIGH_PREMIUM;
//     reproductive endo / urogynecology / MFM → PHYSICIAN_HIGH; geriatric
//     medicine → PHYSICIAN_CORE).
//   round-4 (task-mond43lu-mno74p): NEEDS-REWORK 3 MUST + 2 SHOULD + 1 NIT;
//     folded across two sessions (DRIFT-LOG hard-fire rationale + DRIFT-LOG
//     placeholder token in PAUSE pass; plan body v3 sweep + v3-specific tests
//     + header comments + inline note in resume pass).
// ============================================================

import { BLS_OEWS_BASELINE, type OewsPercentiles } from './blsOewsBaseline'
// Phase B.7.1 v4 Task 8: dedicated CRNA dispatch via the cell-envelope engine.
// The legacy LOCUM_MULTIPLIER[NURSE_ADVANCED]=2.05 path remains as fallback for
// CRNA cells where the envelope is MANUAL-ESCALATION or bimodal (null
// weighted_mean) — preserves existing behavior on degenerate cells while
// upgrading the happy path to the v4 BLS-spine + IAS-empirical formula.
import {
  getCrnaCellEnvelope,
  deriveLocumMultCrna,
  type CrnaArrangement,
  type CrnaTier,
} from './crnaCellLookup'

// Re-export CrnaTier so UI consumers can import tier types from one engine
// surface (avoids deep import paths in components).
export type { CrnaTier } from './crnaCellLookup'

// === SOC FAMILIES + LOCUM MULTIPLIERS ===
// v3 (Codex round-3 probe-gate fold, task-moncnudm-pl4bwb):
//   - 7 base families bumped per Codex recommendation
//   - 8 new sub-families to absorb hard-fire clusters from probe v2

export type SocFamily =
  | 'NP_PA'
  | 'NP_PA_SPECIALTY'
  | 'NP_PA_HIGH'
  | 'ANESTHESIA_APP'
  | 'NURSE_ADVANCED'
  | 'PHYSICIAN_LOW'
  | 'PHYSICIAN_HOSPITALIST'
  | 'PHYSICIAN_CORE'
  | 'PHYSICIAN_SUBSPECIALTY'
  | 'PHYSICIAN_EM_HIGH'
  | 'PHYSICIAN_PSYCH_HIGH'
  | 'PHYSICIAN_HIGH'
  | 'PHYSICIAN_HIGH_PREMIUM'
  | 'SURGEON_CORE'
  | 'SURGEON_HIGH'

/** Locum-vs-W2 multipliers per SOC family. v3 values per Codex round-3 fold.
 *  These are observation-derived midpoints, NOT primary-source-cited.
 *  See plan §"Locum-vs-W-2 Multipliers" for cluster rationale. */
export const LOCUM_MULTIPLIER: Record<SocFamily, number> = {
  NP_PA: 1.45,
  NP_PA_SPECIALTY: 1.90,
  NP_PA_HIGH: 2.20,
  ANESTHESIA_APP: 3.50,
  NURSE_ADVANCED: 2.05,
  PHYSICIAN_LOW: 1.35,
  PHYSICIAN_HOSPITALIST: 2.45,
  PHYSICIAN_CORE: 1.95,
  PHYSICIAN_SUBSPECIALTY: 2.35,
  PHYSICIAN_EM_HIGH: 2.45,
  PHYSICIAN_PSYCH_HIGH: 2.40,
  PHYSICIAN_HIGH: 2.35,
  PHYSICIAN_HIGH_PREMIUM: 3.10,
  SURGEON_CORE: 1.70,
  SURGEON_HIGH: 2.20,
} as const

// === SPECIALTY → SOC MAPPING TABLE (88 entries) ===

export interface SpecialtyToSocEntry {
  primarySOC: string
  /** null when primarySOC is itself an aggregate (29-1229 / 29-1249) and no
   *  further fallback exists. */
  aggregateSOC: string | null
  family: SocFamily
}

export const SPECIALTY_TO_SOC: Record<string, SpecialtyToSocEntry> = {
  // === NP/PA family ===
  'np/pa (primary care)': { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA' },
  'np/pa (emergency)':    { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA' },
  'np/pa (hospitalist)':  { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA' },
  'np/pa (surgery)':      { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA' },
  'np/pa (psychiatry)':   { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA' },
  'np/pa (specialty)':    { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA_SPECIALTY' },
  'np/pa (neonatology)':  { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'NP_PA_HIGH' },
  'anesthesiologist assistant': { primarySOC: '29-1071', aggregateSOC: '29-1171', family: 'ANESTHESIA_APP' },

  // === NURSE_ADVANCED family ===
  'crna': { primarySOC: '29-1151', aggregateSOC: null, family: 'NURSE_ADVANCED' },

  // === PHYSICIAN_LOW family ===
  'family medicine':                    { primarySOC: '29-1215', aggregateSOC: '29-1229', family: 'PHYSICIAN_LOW' },
  'internal medicine':                  { primarySOC: '29-1216', aggregateSOC: '29-1229', family: 'PHYSICIAN_LOW' },
  'hospitalist':                        { primarySOC: '29-1216', aggregateSOC: '29-1229', family: 'PHYSICIAN_HOSPITALIST' },
  'hospitalist nocturnist':             { primarySOC: '29-1216', aggregateSOC: '29-1229', family: 'PHYSICIAN_HOSPITALIST' },
  'urgent care':                        { primarySOC: '29-1214', aggregateSOC: '29-1229', family: 'PHYSICIAN_LOW' },
  'pediatrics':                         { primarySOC: '29-1221', aggregateSOC: '29-1229', family: 'PHYSICIAN_LOW' },
  'pediatric hospitalist':              { primarySOC: '29-1221', aggregateSOC: '29-1229', family: 'PHYSICIAN_LOW' },
  'developmental-behavioral pediatrics':{ primarySOC: '29-1221', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'geriatric medicine':                 { primarySOC: '29-1216', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'preventive medicine':                { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_LOW' },
  'occupational medicine':              { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_LOW' },
  'palliative care':                    { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'wound care':                         { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_LOW' },
  'correctional medicine':              { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'sleep medicine':                     { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'allergy/immunology':                 { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },

  // === PHYSICIAN_CORE family ===
  'emergency medicine':         { primarySOC: '29-1214', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'em nocturnist':              { primarySOC: '29-1214', aggregateSOC: '29-1229', family: 'PHYSICIAN_EM_HIGH' },
  'rural emergency medicine':   { primarySOC: '29-1214', aggregateSOC: '29-1229', family: 'PHYSICIAN_EM_HIGH' },
  'pediatric emergency medicine':{ primarySOC: '29-1214', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'ob/gyn':                     { primarySOC: '29-1218', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'maternal-fetal medicine':    { primarySOC: '29-1218', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'reproductive endocrinology': { primarySOC: '29-1218', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'gynecologic oncology':       { primarySOC: '29-1218', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'urogynecology':              { primarySOC: '29-1218', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'radiology':                  { primarySOC: '29-1224', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'pathology':                  { primarySOC: '29-1222', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'psychiatry':                 { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'child psychiatry':           { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_PSYCH_HIGH' },
  'addiction psychiatry':       { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'geriatric psychiatry':       { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'forensic psychiatry':        { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_PSYCH_HIGH' },
  'telepsychiatry':             { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'correctional psychiatry':    { primarySOC: '29-1223', aggregateSOC: '29-1229', family: 'PHYSICIAN_PSYCH_HIGH' },
  'neurology':                  { primarySOC: '29-1217', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'ophthalmology':              { primarySOC: '29-1241', aggregateSOC: '29-1229', family: 'PHYSICIAN_SUBSPECIALTY' },
  'otolaryngology':             { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_SUBSPECIALTY' },
  'dermatology':                { primarySOC: '29-1213', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },
  'physical medicine & rehab':  { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'nuclear medicine':           { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_SUBSPECIALTY' },
  'medical genetics':           { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'sports medicine':            { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'gastroenterology':           { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_SUBSPECIALTY' },
  'pulmonology':                { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_SUBSPECIALTY' },
  'nephrology':                 { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'endocrinology':              { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_SUBSPECIALTY' },
  'rheumatology':               { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'infectious disease':         { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_CORE' },
  'pediatric cardiology':       { primarySOC: '29-1212', aggregateSOC: '29-1229', family: 'PHYSICIAN_CORE' },

  // === PHYSICIAN_HIGH family ===
  'anesthesiology':         { primarySOC: '29-1211', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'cardiac anesthesiology': { primarySOC: '29-1211', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'pediatric anesthesiology':{ primarySOC: '29-1211', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'obstetric anesthesiology':{ primarySOC: '29-1211', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'pain management':        { primarySOC: '29-1211', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'cardiology':             { primarySOC: '29-1212', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'interventional cardiology':{ primarySOC: '29-1212', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'electrophysiology':      { primarySOC: '29-1212', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'medical oncology':       { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_HIGH_PREMIUM' },
  'hematology':             { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_HIGH' },
  'hematology/oncology':    { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_HIGH_PREMIUM' },
  'neurointerventional':    { primarySOC: '29-1217', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'interventional radiology':{ primarySOC: '29-1224', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH_PREMIUM' },
  'neuroradiology':         { primarySOC: '29-1224', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'pediatric critical care':{ primarySOC: '29-1221', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },
  'critical care':          { primarySOC: '29-1229', aggregateSOC: null,      family: 'PHYSICIAN_HIGH' },
  'neonatology':            { primarySOC: '29-1221', aggregateSOC: '29-1229', family: 'PHYSICIAN_HIGH' },

  // === SURGEON_CORE family ===
  'general surgery':     { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_CORE' },
  'orthopedic surgery':  { primarySOC: '29-1242', aggregateSOC: '29-1249', family: 'SURGEON_CORE' },
  'pediatric orthopedics':{ primarySOC: '29-1242', aggregateSOC: '29-1249', family: 'SURGEON_CORE' },
  'hand surgery':        { primarySOC: '29-1242', aggregateSOC: '29-1249', family: 'SURGEON_CORE' },
  'trauma surgery':      { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_CORE' },
  'colorectal surgery':  { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_CORE' },
  'urology':             { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_CORE' },

  // === SURGEON_HIGH family ===
  'neurosurgery':       { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_HIGH' },
  'thoracic surgery':   { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_HIGH' },
  'vascular surgery':   { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_HIGH' },
  'plastic surgery':    { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_HIGH' },
  'pediatric surgery':  { primarySOC: '29-1243', aggregateSOC: '29-1249', family: 'SURGEON_HIGH' },
  'surgical oncology':  { primarySOC: '29-1249', aggregateSOC: null,      family: 'SURGEON_HIGH' },
}

// === THRESHOLD CONSTANTS ===

const FIXED_SOFT = 25
const FIXED_HARD = 40
const BAND_HARD_GAP = 25      // v3: widened from 15 (Codex round-3 fold) — hardThreshold = max(40, bandHalfWidth + 25)
const MEAN_CAP_RATIO = 1.5    // v3: tightened from 2.0 (Codex round-3 fold) — mean-based verdicts capped at soft unless |dev| ≥ 1.5 × hardThreshold

// === PER-SPECIALTY HARD CEILING (Phase 4 OBS-03) ===
//
// A per-specialty HARD hourly ceiling (USD/hr). A displayed/derived rate ABOVE the
// ceiling trips a 'hard' verdict regardless of the BLS-band deviation — the over-quote
// backstop. This MIRRORS the IronDome PLAUSIBLE_RANGES `max` on the Python producer side
// (agent-sdk/core/iron_dome.py): ONE number per specialty, kept in sync. Keyed by the
// engine specialtyKey (lowercased + trimmed for lookup). Additive: applyCeiling can only
// ESCALATE a verdict to 'hard', never relax one — so it can never loosen an existing floor.
export const MAX_HOURLY_CEILING: Record<string, number> = {
  // CRNA validated public locum 1099 band tops out ~$250 (the $309 Kokomo over-quote the
  // rate-inflation fix clamped sits above). Mirror of iron_dome.py crna max = 250.
  crna: 250,
}

/** Escalate a verdict to 'hard' when the displayed rate exceeds the per-specialty
 *  ceiling. Returns the input verdict unchanged when the specialty has no ceiling or the
 *  rate is within it. NEVER relaxes a verdict (additive backstop). */
function applyCeiling(
  specialtyKey: string,
  displayedHourlyRate: number,
  verdict: BlsSanityCheckVerdict,
): BlsSanityCheckVerdict {
  const ceiling = MAX_HOURLY_CEILING[(specialtyKey ?? '').trim().toLowerCase()]
  if (ceiling != null && displayedHourlyRate > ceiling) return 'hard'
  return verdict
}

// === RESULT TYPE ===

export type BlsSanityCheckVerdict = 'aligned' | 'soft' | 'hard' | 'unavailable'

export type BlsSanityCheckUnavailableReason =
  | 'call-daily-mode'
  | 'unknown-state'
  | 'unmapped-specialty'
  | 'state-and-specialty-suppressed'
  | 'invalid-displayed-hourly-rate'

export interface BlsSanityCheckResult {
  verdict: BlsSanityCheckVerdict
  expectedHourly: number | null
  deviationPct: number | null
  source: string | null
  reason: BlsSanityCheckUnavailableReason | null
  socUsed: string | null
  isMeanBased: boolean
  isAggregateFallback: boolean
  isBandAware: boolean
  hardThresholdPct: number | null
  /** B.7.1 v4 Task 9: structured envelope payload populated ONLY by the CRNA
   *  dispatcher path (evaluateCrnaCheck). Undefined for the legacy
   *  BLS+LOCUM_MULTIPLIER path AND for early-return unavailable verdicts
   *  (call-daily-mode / unknown-state / invalid-rate). UI consumers use this
   *  to render the tier badge — the `source` string remains the canonical
   *  human-readable attribution for tooltips / log lines. Type-safe surfacing
   *  (Path B) replaces regex-parsing the source string.
   *
   *  M1 r2 fold (Codex 2026-05-08 Task 9 review): added iasStateBookings +
   *  iasDivisionBookings so UI can display the booking-count `n` that actually
   *  drove tier assignment. Previously the badge surfaced nSurvivors
   *  (observation-row count, ENGINEERING metric) which can be 1 even when the
   *  underlying booking count is 12 — misleading per the tier description's
   *  "state n≥10" cardinality claim. */
  crnaEnvelope?: {
    tier: CrnaTier
    /** Observation-row count after rowsToObservations() filtering. NOT for
     *  user display — use iasStateBookings / iasDivisionBookings instead. */
    nSurvivors: number
    /** Sum of n_respondents across state-anchored IAS rows matching the
     *  requested arrangement. Drives HIGH/MULTI-SOURCE tier assignment. */
    iasStateBookings: number
    /** Sum of n_respondents across census-division IAS rows matching the
     *  requested arrangement. Drives DERIVED tier assignment. */
    iasDivisionBookings: number
    sourceAttribution: string[]
    locumMult: number
    uhcCutApplied: boolean
  }
}

export interface BlsSanityCheckInput {
  specialtyKey: string
  state: string
  displayedHourlyRate: number
  isCallOnly: boolean
  /** B.7.1 Task 8: optional employment arrangement for CRNA-specific envelope
   *  lookup. When omitted, defaults to 'locum_w2' (IAS booking convention).
   *  Non-CRNA specialties ignore this field — legacy path behavior unchanged. */
  arrangement?: CrnaArrangement
  /** B.7.1 Task 8: optional service date for UHC-cut conditional. Defaults to
   *  NOW (live-quote semantics). M1 r1 fold (Codex 2026-05-08 review):
   *  historical-replay consumers (backtest tools, audit reports for past
   *  assignments) MUST pass the assignment's actual service date so the engine
   *  can correctly suppress the UHC -15% cut for pre-2025-10-01 dates. The
   *  live MarketContext chip omits this field by design — the user is quoting
   *  current/future work and `new Date()` is the correct semantic. Non-CRNA
   *  specialties ignore this field. */
  dateOfService?: Date
}

// === FALLBACK LADDER ===

interface BlsLookup {
  rate: number
  row: OewsPercentiles
  socUsed: string
  isMeanBased: boolean
  isAggregateFallback: boolean
}

function lookupBlsRate(
  state: string,
  primarySOC: string,
  aggregateSOC: string | null,
): BlsLookup | null {
  const stateRow = BLS_OEWS_BASELINE[state]
  if (!stateRow) return null

  const primary = stateRow[primarySOC]
  if (primary?.medianHourly != null) {
    return { rate: primary.medianHourly, row: primary, socUsed: primarySOC, isMeanBased: false, isAggregateFallback: false }
  }
  if (primary?.meanHourly != null) {
    return { rate: primary.meanHourly, row: primary, socUsed: primarySOC, isMeanBased: true, isAggregateFallback: false }
  }
  if (!aggregateSOC) return null

  const agg = stateRow[aggregateSOC]
  if (agg?.medianHourly != null) {
    return { rate: agg.medianHourly, row: agg, socUsed: aggregateSOC, isMeanBased: false, isAggregateFallback: true }
  }
  if (agg?.meanHourly != null) {
    return { rate: agg.meanHourly, row: agg, socUsed: aggregateSOC, isMeanBased: true, isAggregateFallback: true }
  }
  return null
}

function buildSourceLabel(lookup: BlsLookup): string {
  if (lookup.isMeanBased) {
    if (lookup.isAggregateFallback) {
      return `BLS ${lookup.socUsed} (aggregate) state mean (detail suppressed; aggregate median suppressed)`
    }
    return `BLS ${lookup.socUsed} state mean (detail median suppressed)`
  }
  if (lookup.isAggregateFallback) {
    return `BLS ${lookup.socUsed} (aggregate) state median (detail suppressed)`
  }
  return `BLS ${lookup.socUsed} state median`
}

// === ENTRY POINT (B.7.1 Task 8 — async dispatcher) ===
//
// Dispatcher pattern (Codex r1+r2+r3 chain Task 8):
//   - For specialtyKey === 'crna', try evaluateCrnaCheck first. The CRNA path
//     uses the v4 BLS-spine + IAS-empirical envelope from getCrnaCellEnvelope.
//     If the envelope returns MANUAL-ESCALATION or null weighted_mean (bimodal),
//     evaluateCrnaCheck returns null and control falls through to the legacy
//     BLS+LOCUM_MULTIPLIER path — preserving existing behavior on degenerate cells.
//   - For all non-CRNA specialties, the legacy path runs unchanged.
//
// All consumers must `await` (function is now async).
export async function evaluateBlsSanityCheck(
  input: BlsSanityCheckInput,
): Promise<BlsSanityCheckResult> {
  if (input.specialtyKey === 'crna') {
    const crnaResult = await evaluateCrnaCheck(input)
    if (crnaResult !== null) return crnaResult
    // Fall through to legacy when envelope unavailable / bimodal
  }
  return evaluateBlsLegacyPath(input)
}

/** CRNA-specific path via getCrnaCellEnvelope. Returns null when the envelope
 *  signals MANUAL-ESCALATION or bimodal (null weighted_mean) — caller falls
 *  back to the legacy BLS+LOCUM_MULTIPLIER path so CRNA cells without IAS
 *  data still produce a quote on the existing 2.05 multiplier. */
async function evaluateCrnaCheck(
  input: BlsSanityCheckInput,
): Promise<BlsSanityCheckResult | null> {
  const empty = (
    reason: BlsSanityCheckUnavailableReason,
    socUsed: string | null = '29-1151',
  ): BlsSanityCheckResult => ({
    verdict: 'unavailable',
    expectedHourly: null,
    deviationPct: null,
    source: null,
    reason,
    socUsed,
    isMeanBased: false,
    isAggregateFallback: false,
    isBandAware: false,
    hardThresholdPct: null,
  })

  if (input.isCallOnly) return empty('call-daily-mode')

  if (
    !Number.isFinite(input.displayedHourlyRate) ||
    input.displayedHourlyRate <= 0
  ) {
    return empty('invalid-displayed-hourly-rate')
  }

  const state = (input.state ?? '').trim().toUpperCase()
  if (!state || state.length !== 2) return empty('unknown-state')

  const arrangement = input.arrangement ?? 'locum_w2'
  const dateOfService = input.dateOfService ?? new Date()
  const envelope = await getCrnaCellEnvelope(state, arrangement, dateOfService)

  // Bimodal / MANUAL-ESCALATION: signal caller to fall back to legacy BLS path.
  if (envelope.tier === 'MANUAL-ESCALATION' || envelope.weighted_mean === null) {
    return null
  }

  // PLAN-bug fold (Codex 2026-05-08): PLAN said `applyUhcCut(envelope.weighted_mean, ...)`
  // here, but envelope.weighted_mean ALREADY includes the UHC cut from
  // getCrnaCellEnvelope step (4): `expectedHourly = blsSpine * locumMult * uhcFactor`.
  // Applying it again would double-cut. Use envelope.weighted_mean as-is.
  const expectedHourly = envelope.weighted_mean
  const deviationPct =
    ((input.displayedHourlyRate - expectedHourly) / expectedHourly) * 100
  const absDev = Math.abs(deviationPct)

  let softThreshold = FIXED_SOFT
  let hardThreshold = FIXED_HARD
  let isBandAware = false
  if (envelope.weighted_variance !== null && envelope.weighted_variance > 0) {
    const sd = Math.sqrt(envelope.weighted_variance)
    const halfWidthPct = ((1.5 * sd) / expectedHourly) * 100 // 1.5 SD as half-band
    softThreshold = Math.max(FIXED_SOFT, halfWidthPct)
    hardThreshold = Math.max(FIXED_HARD, halfWidthPct + BAND_HARD_GAP)
    isBandAware = true
  }

  let verdict: BlsSanityCheckVerdict
  if (absDev <= softThreshold) verdict = 'aligned'
  else if (absDev <= hardThreshold) verdict = 'soft'
  else verdict = 'hard'

  // Per-specialty over-quote ceiling (OBS-03): a CRNA rate >$250 trips hard even when the
  // envelope band would not. Applied AFTER the band verdict so it can only escalate.
  verdict = applyCeiling(input.specialtyKey, input.displayedHourlyRate, verdict)

  // Source label — v4 amendment: no "AANA" anchor, only BLS + IAS empirical + scrapers.
  // B1 r3 fold (Codex 2026-05-08 Task 9 review): renamed leading `n=` to
  // `rows=` and added booking counts. Pre-fold: `n=${envelope.n_survivors}` was
  // the observation-row count (engineering metric) but read like a booking
  // count, conflicting with the tier badge's `n=${iasStateBookings}` display.
  // Post-fold: `state_n` + `division_n` (the assignTier-driving booking counts)
  // are first; `rows` (observation count) is last and explicitly labeled.
  const locumMult = await deriveLocumMultCrna(state, arrangement)
  const uhcTag = envelope.uhc_cut_applies ? ', UHC -15% applied' : ''
  const source =
    `BLS 29-1151 + IAS empirical (state_n=${envelope.ias_state_bookings}, ` +
    `division_n=${envelope.ias_division_bookings}, ` +
    `sources=[${envelope.source_attribution.join(',')}], tier=${envelope.tier}` +
    `${uhcTag}, LOCUM_MULT=${locumMult.toFixed(2)}, rows=${envelope.n_survivors})`

  return {
    verdict,
    expectedHourly,
    deviationPct,
    source,
    reason: null,
    socUsed: '29-1151',
    isMeanBased: false, // BLS spine is median-by-design; IAS rows are MAD+IVW medians per Task 6
    isAggregateFallback: false, // CRNA SOC 29-1151 is detail-level, no aggregate
    isBandAware,
    hardThresholdPct: hardThreshold,
    // Task 9: structured envelope for UI tier-badge rendering. Source string above
    // remains the human-readable attribution; this is the type-safe surface for
    // components that need to render tier/n/locumMult chips without regex-parsing.
    // M1 r2 fold (Codex 2026-05-08 Task 9 review): also pass through the
    // booking-count fields so the UI can display the n that actually drove tier
    // assignment, not the observation-row count.
    crnaEnvelope: {
      tier: envelope.tier,
      nSurvivors: envelope.n_survivors,
      iasStateBookings: envelope.ias_state_bookings,
      iasDivisionBookings: envelope.ias_division_bookings,
      sourceAttribution: envelope.source_attribution,
      locumMult,
      uhcCutApplied: envelope.uhc_cut_applies,
    },
  }
}

/** Legacy synchronous BLS path — body byte-identical to the pre-Task-8
 *  evaluateBlsSanityCheck function. Runs for all non-CRNA specialties AND
 *  for CRNA cells when evaluateCrnaCheck returns null (envelope unavailable
 *  or bimodal). Preserves Phase 3 step 2 v3 behavior. */
function evaluateBlsLegacyPath(input: BlsSanityCheckInput): BlsSanityCheckResult {
  const empty = (
    reason: BlsSanityCheckUnavailableReason,
    socUsed: string | null = null,
  ): BlsSanityCheckResult => ({
    verdict: 'unavailable',
    expectedHourly: null,
    deviationPct: null,
    source: null,
    reason,
    socUsed,
    isMeanBased: false,
    isAggregateFallback: false,
    isBandAware: false,
    hardThresholdPct: null,
  })

  if (input.isCallOnly) return empty('call-daily-mode')

  if (
    !Number.isFinite(input.displayedHourlyRate) ||
    input.displayedHourlyRate <= 0
  ) {
    return empty('invalid-displayed-hourly-rate')
  }

  const mapping = SPECIALTY_TO_SOC[input.specialtyKey]
  if (!mapping) return empty('unmapped-specialty')

  const state = (input.state ?? '').trim().toUpperCase()
  if (!BLS_OEWS_BASELINE[state]) return empty('unknown-state')

  const lookup = lookupBlsRate(state, mapping.primarySOC, mapping.aggregateSOC)
  if (!lookup) return empty('state-and-specialty-suppressed', mapping.primarySOC)

  const multiplier = LOCUM_MULTIPLIER[mapping.family]
  const expectedHourly = lookup.rate * multiplier
  const deviationPct = ((input.displayedHourlyRate - expectedHourly) / expectedHourly) * 100
  const absDev = Math.abs(deviationPct)

  let softThreshold = FIXED_SOFT
  let hardThreshold = FIXED_HARD
  let isBandAware = false
  if (lookup.row.p25Hourly != null && lookup.row.p75Hourly != null) {
    const expectedLow = lookup.row.p25Hourly * multiplier
    const expectedHigh = lookup.row.p75Hourly * multiplier
    const lowPct = ((expectedHourly - expectedLow) / expectedHourly) * 100
    const highPct = ((expectedHigh - expectedHourly) / expectedHourly) * 100
    const halfWidth = Math.max(lowPct, highPct)
    softThreshold = Math.max(FIXED_SOFT, halfWidth)
    hardThreshold = Math.max(FIXED_HARD, halfWidth + BAND_HARD_GAP)
    isBandAware = true
  }

  let verdict: BlsSanityCheckVerdict
  if (absDev <= softThreshold) verdict = 'aligned'
  else if (absDev <= hardThreshold) verdict = 'soft'
  else verdict = 'hard'

  if (lookup.isMeanBased && verdict === 'hard' && absDev < MEAN_CAP_RATIO * hardThreshold) {
    verdict = 'soft'
  }

  // Per-specialty over-quote ceiling (OBS-03): applied LAST so the mean-cap above can never
  // demote a ceiling-tripped 'hard'. A CRNA rate >$250 trips hard regardless of BLS band.
  verdict = applyCeiling(input.specialtyKey, input.displayedHourlyRate, verdict)

  return {
    verdict,
    expectedHourly,
    deviationPct,
    source: buildSourceLabel(lookup),
    reason: null,
    socUsed: lookup.socUsed,
    isMeanBased: lookup.isMeanBased,
    isAggregateFallback: lookup.isAggregateFallback,
    isBandAware,
    hardThresholdPct: hardThreshold,
  }
}
