// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// === Phase B.7.1 v4 — CRNA cell lookup + UHC cut + LOCUM_MULT derivation ===
// Engine glue between external_specialty_surveys and blsSanityCheck.ts.
// Cache populated at app boot; in-memory thereafter (single supabase fetch).
//
// PLAN source: docs/rate-simulator/phases/B.7.1-competitive-crna-rates/PLAN.md Task 7
// Spec source: docs/rate-simulator/audit-2026-05-05/UI_IMPACT.md §2.3 (tier matrix)
//             + docs/rate-simulator/phases/B.7.1-competitive-crna-rates/SOURCING_AUDIT_v4.md §4.3
//             + docs/rate-simulator/phases/B.7.1-competitive-crna-rates/TASK_2_DEVIATION.md
//
// v4 architectural pivot (post-AANA-rejection 2026-05-07):
//   rate(state, arrangement, date) = BLS_state_p50_or_mean × LOCUM_MULT_CRNA(state, arrangement)
//                                    × (1 - UHC_cut_factor(state, date))
//
// CrnaTier collapsed to 5-tier (no EXCELLENT, no FALLBACK):
//   HIGH > MULTI-SOURCE > DERIVED > PUBLIC-HINT > MANUAL-ESCALATION
//
// Per TASK_2_DEVIATION 2026-05-08: IAS RTDB has no actual paid CRNA rates
// (0/158 with payRate/bidRate/hourlyRate). LOCUM_MULT defers to literature
// defaults; HIGH tier currently unreachable absent IAS state n≥10. Per-cell
// tier across 46 BLS-spine states defaults to PUBLIC-HINT until state-aware
// scrapers (Task 3+5) promote to MULTI-SOURCE.

import { getSupabase } from './runtime'
import { aggregateCell, type Observation, MAX_RATE_MID, MIN_WEIGHT } from './crnaAggregation'

const UHC_CUT_EFFECTIVE_DATE = new Date('2025-10-01T00:00:00Z')
const UHC_CUT_PCT = 0.15
const UHC_EXEMPT_STATES = new Set(['AR', 'CA', 'CO', 'HI', 'MA', 'NH', 'WY'])

// v4 Codex r2 MUST-1 fold (2026-05-07): CrnaTier collapsed to v4's 5-tier model.
// EXCELLENT removed (was AANA-anchored, unreachable in v4 per SOURCING_AUDIT_v4.md §4.3).
// FALLBACK removed (was IronDome-envelope-only; v4 collapses into PUBLIC-HINT for honesty —
// "BLS-anchored single-source" IS the lowest-tier-with-evidence, no separate FALLBACK rung).
// HIGH/MULTI-SOURCE/DERIVED/PUBLIC-HINT/MANUAL-ESCALATION exactly match SOURCING_AUDIT_v4.md §4.3.
export type CrnaTier =
  | 'HIGH'             // BLS not suppressed AND IAS state n≥10 AND ≥2 distinct sources
  | 'MULTI-SOURCE'     // BLS not suppressed AND ≥2 distinct sources AND (IAS state n∈[5,9] OR scraper agrees within ±15%)
  | 'DERIVED'          // BLS not suppressed AND IAS census-division aggregated (state-level n<5)
  | 'PUBLIC-HINT'      // BLS not suppressed AND fallback to national IAS ratio OR literature default
  // v4 Codex r3 SHOULD-1 fold: MANUAL-ESCALATION reasons are exactly two — BLS p50 AND mean both
  // suppressed (4 jurisdictions; row not in cache), OR triangulation evidence is bimodal per
  // aggregateCell.manual_review_bimodal flag. Per Codex r2 MUST-6 fold, non-locum queries with
  // only locum_general IAS evidence do NOT route here — they fall through to PUBLIC-HINT.
  | 'MANUAL-ESCALATION'

export type CrnaArrangement =
  | 'w2_employee'
  | '1099_independent'
  | 'locum_w2'
  | 'locum_1099'

export interface CrnaEnvelope {
  state: string
  arrangement: CrnaArrangement
  tier: CrnaTier
  weighted_mean: number | null
  weighted_variance: number | null
  /** Count of fully-rated rows (rate_low+median+high all non-null) that survived
   *  rowsToObservations() filtering and could feed aggregateCell triangulation.
   *  ENGINEERING METRIC, not user-facing — observation-row count is NOT the same
   *  as IAS booking count (one row can carry n_respondents=12). UI consumers
   *  should use ias_state_bookings / ias_division_bookings for displayed `n`. */
  n_survivors: number
  source_attribution: string[]
  uhc_cut_applies: boolean
  /** Sum of n_respondents across IAS state-anchored rows matching the requested
   *  arrangement (with locum_general alias). This is the value assignTier()
   *  gates on for HIGH/MULTI-SOURCE. M1 r2 fold (Codex 2026-05-08 Task 9
   *  review): surfaced explicitly so UI can display the booking-count `n` that
   *  actually drove the tier rather than observation-row count. */
  ias_state_bookings: number
  /** Sum of n_respondents across IAS rows in the same census-division as the
   *  query state, matching the requested arrangement. assignTier() gates DERIVED
   *  on this. M1 r2 fold rationale matches ias_state_bookings. */
  ias_division_bookings: number
  /** Sum of n_respondents across ALL IAS rows for the state regardless of
   *  arrangement — used by the daily drift-monitor (Task 11) to detect cells
   *  where booking telemetry exists but doesn't match the requested arrangement. */
  ias_bookings_for_state: number
  computed_at: number
}

// N1 r2 fold (Codex 2026-05-08): narrow employment_arrangement to the documented
// DB-CHECK-constrained value set so typo'd raw arrangements surface at TS time
// rather than silently slipping through arrangementMatches as no-match.
// Source: supabase/migrations/20260507000000_external_specialty_surveys.sql line 32:
//   'w2_employee' | '1099_independent' | 'locum_w2' | 'locum_1099' | 'locum_general'
//   | 'partnership' | 'group_owner'
// (DB doesn't enforce a CHECK on this column today; runtime guards via
// arrangementMatches still safely default to no-match for unrecognized strings,
// but TS-level documentation prevents fixture-construction typos.)
type RawArrangement =
  | CrnaArrangement
  | 'locum_general'
  | 'partnership'
  | 'group_owner'

interface RawSurveyRow {
  survey_name: string
  state: string | null
  census_division: string | null
  employment_arrangement: RawArrangement
  rate_low: number | null
  rate_median: number | null
  rate_high: number | null
  n_respondents: number | null
  ingested_at: string
  uhc_cut_applies: boolean
}

// SHOULD-2 r1 fix: single-flight cache load. Without this, React Strict Mode (effects fire twice
// in dev) or two parallel quote computations during initial cache miss can both fire supabase
// fetches. We share the in-flight promise so only one network round-trip happens.
//
// S1 r2 fold (Codex 2026-05-08): cache generation token. Without it, a `_resetCacheForTesting()`
// call WHILE a load is in-flight would let the stale loader complete and overwrite `_cache` with
// pre-reset data — masking a downstream test that depends on the reset taking effect. Each load
// captures the generation at start; only commits to `_cache` if the generation still matches.
// Reset increments the generation, invalidating any in-flight load.
let _cache: RawSurveyRow[] | null = null
let _cachePromise: Promise<void> | null = null
let _cacheGeneration = 0
// M1 r2 fold (Codex 2026-05-08 Task 8 round-2 review): TTL cooldown for fetch
// failures. Pre-fold: a transient supabase 503 wrote `_cache = []`, and the
// top-of-loader guard `if (_cache !== null) return _cache` poisoned the cache
// for the entire process lifetime — every CRNA quote downgraded to legacy.
// Post-fold: on error we leave _cache=null and stamp _lastFetchErrorAt; the
// loader short-circuits to an empty array (legacy fallback) for the next 30s
// (RETRY_COOLDOWN_MS), then the next call after the cooldown attempts a fresh
// fetch. A successful fetch clears _lastFetchErrorAt. This prevents both
// (a) permanent poisoning AND (b) thundering-herd retry storms during outages.
//
// TTL value rationale (Task 9, 2026-05-08):
//   30s sits in the middle of a 10-60s viable range, chosen on engineering
//   judgement (no telemetry yet). Too low (≤10s) re-hits an unhealthy supabase
//   before transient outages settle, risking thundering-herd even with single-
//   flight (each tab/process retries independently). Too high (≥60s) makes UX
//   recovery slow — a recruiter who quotes during a transient blip keeps seeing
//   the legacy fallback for an awkwardly long time even after Supabase has
//   recovered. 30s is a reasonable cooldown that gives backend recovery a buffer
//   while not stranding the user on stale verdicts. N1 r1 fold (Codex
//   2026-05-08 Task 9 review): prior comment claimed "Supabase status incidents
//   2025" as evidence — that citation was uncited, removed per the no-fake-data
//   standard. Once Task 11 drift-monitor lands and we have real cache-miss-rate
//   telemetry, calibrate this value against observed outage durations.
export const RETRY_COOLDOWN_MS = 30_000
let _lastFetchErrorAt: number | null = null

// S1 r2 fold (refactored): loadEnvelopeCache returns the live cache rows directly.
// Previously the function returned void and callers read `_cache!`, which would
// crash with a null-deref when a `_resetCacheForTesting()` mid-flight invalidated
// the in-flight loader (loader skipped commit due to generation mismatch, but
// caller still tried to read `_cache`). Returning the data lets the function
// retry-on-stale-generation transparently — callers never see null.
async function loadEnvelopeCache(): Promise<RawSurveyRow[]> {
  if (_cache !== null) return _cache
  // M1 r2 fold: cooldown short-circuit. If the last fetch failed within
  // RETRY_COOLDOWN_MS, return empty (legacy fallback) without re-attempting
  // the fetch. Prevents thundering herd against an unhealthy supabase.
  if (
    _lastFetchErrorAt !== null &&
    Date.now() - _lastFetchErrorAt < RETRY_COOLDOWN_MS
  ) {
    return []
  }
  if (_cachePromise !== null) {
    await _cachePromise
    if (_cache !== null) return _cache
    // Generation mismatch during the in-flight load left _cache null. Retry.
    return loadEnvelopeCache()
  }
  const loadGeneration = _cacheGeneration
  _cachePromise = (async () => {
    try {
      // M2 r1 fold (Codex 2026-05-08 Task 8 review): supabase fetch errors must NOT throw out
      // of getCrnaCellEnvelope. The dispatcher in blsSanityCheck.ts relies on a degenerate
      // envelope (no bls_oews_29_1151_2024 row → MANUAL-ESCALATION early-return) to fall
      // through to the legacy BLS+LOCUM_MULTIPLIER path. Throwing here propagates an unhandled
      // rejection that React effects/quote handlers must catch — fragile. Instead, on error we
      // stamp `_lastFetchErrorAt` and leave `_cache = null`; the next call within the cooldown
      // window short-circuits to an empty cache (legacy fallback). After cooldown elapses, a
      // fresh fetch is attempted.
      const { data, error } = await getSupabase()
        .from('external_specialty_surveys')
        .select('survey_name,state,census_division,employment_arrangement,rate_low,rate_median,rate_high,n_respondents,ingested_at,uhc_cut_applies')
        .eq('specialty', 'crna')
      if (error) {
        console.warn('[crnaCellLookup] supabase fetch failed; falling through to legacy path:', error.message)
        // M1 r2 fold: stamp error timestamp; do NOT poison _cache permanently.
        if (_cacheGeneration === loadGeneration) {
          _lastFetchErrorAt = Date.now()
        }
        return
      }
      // S1 r2: only commit if the generation still matches. If `_resetCacheForTesting()` was
      // called during the load, `_cacheGeneration` advanced past `loadGeneration`, and this
      // result is stale.
      if (_cacheGeneration === loadGeneration) {
        _cache = (data ?? []) as RawSurveyRow[]
        // M1 r2 fold: clear error stamp on successful fetch — the next failure
        // starts a fresh cooldown window.
        _lastFetchErrorAt = null
      }
    } catch (err) {
      // M2 r1 fold: catch network/transport errors for the same fall-through reason.
      console.warn(
        '[crnaCellLookup] supabase fetch threw; falling through to legacy path:',
        err instanceof Error ? err.message : String(err),
      )
      // M1 r2 fold: stamp error timestamp; do NOT poison _cache permanently.
      if (_cacheGeneration === loadGeneration) {
        _lastFetchErrorAt = Date.now()
      }
    } finally {
      // Clear promise on settle so a future cache invalidation can refetch.
      // SHOULD-1 r1 note: if a Task 5 ingest's DELETE-INSERT race fires DURING initial cache load,
      // we may cache empty/partial rows. This is acceptable for B.7.1 because (a) Task 5 runs only
      // during scheduled ingest windows, NOT during user quote sessions; (b) cache is per-process;
      // (c) the daily 04:30 UTC routine (Task 11) detects empty caches as missing-state warnings.
      // For B.7.2: consider transactional swap (CREATE TABLE NEW; INSERT; ALTER RENAME).
      // S1 r2: only clear the promise if it's still the one we set; otherwise a concurrent load
      // for a newer generation may have replaced it.
      if (_cacheGeneration === loadGeneration) {
        _cachePromise = null
      }
    }
  })()
  await _cachePromise
  if (_cache !== null) return _cache
  // M1 r2 fold: if the load failed (stamped _lastFetchErrorAt), return empty
  // for legacy fallback rather than recurse infinitely. The cooldown short-
  // circuit at the top of this function catches subsequent calls within the
  // RETRY_COOLDOWN_MS window.
  if (_lastFetchErrorAt !== null) return []
  // Generation mismatch during this load — retry recursively. Each retry has a fresh generation,
  // so progress is guaranteed unless reset is called continuously (acceptable for testing only).
  return loadEnvelopeCache()
}

// US Census Bureau 9-Division taxonomy (50 states + DC = 51).
// Source: https://www.census.gov/programs-surveys/economic-census/guidance-geographies/levels.html
// Per Task 0 receipt 02b39b4e Exec Summary §12 TOC, AANA reports along these 9 divisions.
//
// CAVEAT: division codes 'NE' (New England) and 'MA' (Middle Atlantic) collide TEXTUALLY with
// state codes 'NE' (Nebraska, lives in WNC) and 'MA' (Massachusetts, lives in NE).
// Logically unambiguous because state-vs-division values live in DIFFERENT columns, but
// any code path that compares this function's return against state-code sets is BUGGED.
// Consumers MUST treat the return as a division-code only.
//
// Returns the 9-Division code for any 2-letter state (or 'DC'). Falls back to 'SA' (South Atlantic,
// where DC lives) for an unrecognized input — should not happen for a validated 2-letter state code.
//
// Coverage check (51 = 50 states + DC):
//   NE  6: CT,ME,MA,NH,RI,VT
//   MA  3: NJ,NY,PA
//   ENC 5: IL,IN,MI,OH,WI
//   WNC 7: IA,KS,MN,MO,NE,ND,SD
//   SA  9: DE,DC,FL,GA,MD,NC,SC,VA,WV
//   ESC 4: AL,KY,MS,TN
//   WSC 4: AR,LA,OK,TX
//   MTN 8: AZ,CO,ID,MT,NV,NM,UT,WY
//   PAC 5: AK,CA,HI,OR,WA
//   total = 6+3+5+7+9+4+4+8+5 = 51 ✓
export function censusDivisionOf(state: string): string {
  const NEW_ENGLAND = new Set(['CT', 'ME', 'MA', 'NH', 'RI', 'VT'])
  const MIDDLE_ATLANTIC = new Set(['NJ', 'NY', 'PA'])
  const EAST_NORTH_CENTRAL = new Set(['IL', 'IN', 'MI', 'OH', 'WI'])
  const WEST_NORTH_CENTRAL = new Set(['IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'])
  const SOUTH_ATLANTIC = new Set(['DE', 'DC', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'WV'])
  const EAST_SOUTH_CENTRAL = new Set(['AL', 'KY', 'MS', 'TN'])
  const WEST_SOUTH_CENTRAL = new Set(['AR', 'LA', 'OK', 'TX'])
  const MOUNTAIN = new Set(['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY'])
  const PACIFIC = new Set(['AK', 'CA', 'HI', 'OR', 'WA'])
  if (NEW_ENGLAND.has(state)) return 'NE'
  if (MIDDLE_ATLANTIC.has(state)) return 'MA'
  if (EAST_NORTH_CENTRAL.has(state)) return 'ENC'
  if (WEST_NORTH_CENTRAL.has(state)) return 'WNC'
  if (SOUTH_ATLANTIC.has(state)) return 'SA'
  if (EAST_SOUTH_CENTRAL.has(state)) return 'ESC'
  if (WEST_SOUTH_CENTRAL.has(state)) return 'WSC'
  if (MOUNTAIN.has(state)) return 'MTN'
  if (PACIFIC.has(state)) return 'PAC'
  return 'SA' // fallback (should not happen for valid 2-letter state; SA is where DC lives)
}

// Codex r1 NIT-2 fold (v4): scraper rows are tagged 'locum_general' because public locum
// salary pages do not disambiguate W-2-locum from 1099-locum pay treatment. When the engine
// queries 'locum_w2' or 'locum_1099', 'locum_general' rows count as agreement-evidence for
// EITHER locum arrangement (alias group). Non-locum arrangements (w2_employee, 1099_independent)
// require exact match. This is honest about the scraper-data ambiguity while still letting
// the rows triangulate against IAS-derived state evidence.
function arrangementMatches(rowArrangement: string, queryArrangement: string): boolean {
  if (rowArrangement === queryArrangement) return true
  if (
    rowArrangement === 'locum_general' &&
    (queryArrangement === 'locum_w2' || queryArrangement === 'locum_1099')
  ) {
    return true
  }
  return false
}

function rowsToObservations(
  rows: RawSurveyRow[],
  state: string,
  arrangement: string,
): Observation[] {
  return rows
    .filter(r => arrangementMatches(r.employment_arrangement, arrangement))
    .filter(r => {
      if (r.state === state) return true
      if (r.state === null && r.census_division === censusDivisionOf(state)) return true
      return false
    })
    .filter(r => r.rate_median !== null && r.rate_low !== null && r.rate_high !== null)
    .map(r => ({
      cell_id: `crna|${state}|${arrangement}`,
      source_id: r.survey_name,
      rate_low: r.rate_low!,
      rate_high: r.rate_high!,
      rate_mid: (r.rate_low! + r.rate_high!) / 2,
      observed_at: new Date(r.ingested_at).getTime(),
      source_variance: r.survey_name.startsWith('bls_')
        ? Math.pow((r.rate_high! - r.rate_low!) / 4, 2)
        : null,
      evidence_weight: 1.0,
    }))
    // Task 6 r5 fold: filter rows that would fail aggregateCell's input validation
    // (non-finite or above MAX_RATE_MID rate_mid). Without this, downstream
    // aggregateCell would silently filter and we'd lose telemetry of which row
    // was bad. Filter here so the source attribution stays accurate.
    .filter(o =>
      Number.isFinite(o.rate_mid) &&
      o.rate_mid > 0 &&
      o.rate_mid <= MAX_RATE_MID &&
      Number.isFinite(o.evidence_weight) &&
      o.evidence_weight >= MIN_WEIGHT,
    )
}

// v4 Codex r2 MUST-1 + MUST-2 fold (2026-05-07): assignTier rewritten to match v4 5-tier matrix
// exactly (no AANA-anchor; no EXCELLENT/FALLBACK). Inputs are derived from v4's BLS-spine formula
// (BLS not suppressed; IAS state n; distinct sources; scraper-agreement) — NOT from a generic
// aggregateCell over all matching rows.
function assignTier(input: {
  blsSuppressed: boolean
  iasStateBookings: number
  iasDivisionBookings: number
  distinctSources: number
  scraperAgrees: boolean
}): CrnaTier {
  if (input.blsSuppressed) return 'MANUAL-ESCALATION'
  if (input.iasStateBookings >= 10 && input.distinctSources >= 2) return 'HIGH'
  if (input.distinctSources >= 2 && (input.iasStateBookings >= 5 || input.scraperAgrees)) {
    return 'MULTI-SOURCE'
  }
  if (input.iasDivisionBookings >= 10) return 'DERIVED'
  return 'PUBLIC-HINT'
}

// v4 Codex r2 MUST-2 fold: getCrnaCellEnvelope implements the v4 BLS-spine formula explicitly.
// expectedHourly = BLS_state_p50_or_mean × LOCUM_MULT_CRNA(state, arrangement) × (1 - UHC_cut(state, date)).
// aggregateCell is used ONLY for triangulation evidence (bimodal flag) against IAS+scraper rows
// (with locum_general alias matching), NOT to produce the headline rate.
export async function getCrnaCellEnvelope(
  state: string,
  arrangement: CrnaArrangement,
  dateOfService: Date = new Date(),
): Promise<CrnaEnvelope> {
  const cache = await loadEnvelopeCache()
  const stateUpper = state.toUpperCase()

  // (1) BLS spine — must be present for v4 architecture. The "BLS_state_p50_or_mean" contract
  //     is enforced at INGEST time, not at READ time: Task 5 BLS ingest substitutes mean for null
  //     median (`rate_median: crna.medianHourly ?? crna.meanHourly`) and SKIPS the row entirely
  //     when BOTH are suppressed. Therefore: if a row exists in cache with non-null rate_median,
  //     the BLS spine is well-defined (either p50 or mean fallback). If no row matches, the cell
  //     is in the 4-jurisdiction fully-suppressed set → MANUAL-ESCALATION.
  //     v4 Codex r3 MUST-1 fold: this read-site comment makes the upstream contract auditable.
  const blsRow = cache.find(
    r =>
      r.state === stateUpper &&
      r.survey_name === 'bls_oews_29_1151_2024' &&
      r.rate_median !== null &&
      r.rate_median > 0,
  )
  if (!blsRow) {
    // S1 r1 fold (Codex 2026-05-08): uhc_cut_applies must be DATE-AWARE here too,
    // not just exemption-aware. Pre-2025-10-01 non-exempt suppressed cells were
    // mislabeled as cut-applying. Compute the same predicate as the happy path.
    const uhcAppliesEarly =
      !UHC_EXEMPT_STATES.has(stateUpper) && dateOfService >= UHC_CUT_EFFECTIVE_DATE
    return {
      state: stateUpper,
      arrangement,
      tier: 'MANUAL-ESCALATION',
      weighted_mean: null,
      weighted_variance: null,
      n_survivors: 0,
      source_attribution: [],
      uhc_cut_applies: uhcAppliesEarly,
      ias_state_bookings: 0,
      ias_division_bookings: 0,
      ias_bookings_for_state: 0,
      computed_at: Date.now(),
    }
  }
  const blsSpine = blsRow.rate_median!

  // (2) LOCUM_MULT for this (state, arrangement) — uses arrangementMatches() internally for
  //     locum_general fallback. Returns literature default when no IAS evidence.
  const locumMult = await deriveLocumMultCrna(stateUpper, arrangement)

  // (3) UHC quote-time cut
  const uhcApplies =
    !UHC_EXEMPT_STATES.has(stateUpper) && dateOfService >= UHC_CUT_EFFECTIVE_DATE
  const uhcFactor = uhcApplies ? 1 - UHC_CUT_PCT : 1.0

  // (4) v4 cell rate
  const expectedHourly = blsSpine * locumMult * uhcFactor

  // (5) Triangulation evidence — pulls IAS-arrangement rows (with alias) + state-aware scraper
  //     rows for distinct-source counting and ±15% scraper-agreement detection.
  const observations = rowsToObservations(cache, stateUpper, arrangement)
  const sourcesPresent = new Set<string>()
  sourcesPresent.add(blsRow.survey_name) // BLS always present in source attribution post-(1)
  let scraperAgrees = false
  for (const o of observations) {
    sourcesPresent.add(o.source_id)
    if (o.source_id !== blsRow.survey_name && !o.source_id.startsWith('ias_')) {
      const scraperMid = o.rate_mid
      if (Math.abs(scraperMid - expectedHourly) / expectedHourly <= 0.15) {
        scraperAgrees = true
      }
    }
  }

  // (6) Bimodal-detection over the triangulation evidence — uses the existing aggregateCell math
  //     for distinct purpose: "are the IAS+scraper observations split bimodal vs the BLS spine?"
  //     If yes, route to MANUAL-ESCALATION because the cell has internal disagreement signal.
  if (observations.length >= 4) {
    const agg = aggregateCell(observations)
    if (agg.confidence === 'manual_review_bimodal') {
      return {
        state: stateUpper,
        arrangement,
        tier: 'MANUAL-ESCALATION',
        weighted_mean: null,
        weighted_variance: null,
        n_survivors: agg.n_survivors_after_mad,
        source_attribution: [...sourcesPresent],
        uhc_cut_applies: uhcApplies,
        ias_state_bookings: 0,
        ias_division_bookings: 0,
        ias_bookings_for_state: 0,
        computed_at: Date.now(),
      }
    }
  }

  // (7) IAS evidence sums for tier-assignment
  const iasStateRows = cache.filter(
    r =>
      r.state === stateUpper &&
      r.survey_name.startsWith('ias_') &&
      arrangementMatches(r.employment_arrangement, arrangement),
  )
  const iasStateBookings = iasStateRows.reduce((s, r) => s + (r.n_respondents ?? 0), 0)
  // M1 r1 fold (Codex 2026-05-08): column-anchored division predicate (mirror of
  // deriveLocumMultCrna step (2) fix). State-anchored rows compute division from
  // r.state; division-anchored rows (r.state === null) read r.census_division.
  const queryDivision = censusDivisionOf(stateUpper)
  const iasDivisionRows = cache.filter(
    r =>
      ((r.state !== null && censusDivisionOf(r.state.toUpperCase()) === queryDivision) ||
        (r.state === null && r.census_division === queryDivision)) &&
      r.survey_name.startsWith('ias_') &&
      arrangementMatches(r.employment_arrangement, arrangement),
  )
  const iasDivisionBookings = iasDivisionRows.reduce(
    (s, r) => s + (r.n_respondents ?? 0),
    0,
  )
  const allIasRowsForState = cache.filter(
    r => r.state === stateUpper && r.survey_name.startsWith('ias_'),
  )
  const iasBookingsAnyArrangement = allIasRowsForState.reduce(
    (s, r) => s + (r.n_respondents ?? 0),
    0,
  )

  // (8) Tier assignment. v4 Codex r2 MUST-6 fold: removed the arrangementGated MANUAL-ESCALATION
  // path. Non-locum queries (w2_employee, 1099_independent) with only locum_general IAS evidence
  // still produce a quote — BLS spine + literature-default multiplier yields PUBLIC-HINT tier.
  const tier = assignTier({
    blsSuppressed: false, // covered by step (1) early-return
    iasStateBookings,
    iasDivisionBookings,
    distinctSources: sourcesPresent.size,
    scraperAgrees,
  })

  return {
    state: stateUpper,
    arrangement,
    tier,
    weighted_mean: expectedHourly, // v4: BLS × LOCUM_MULT × (1 - UHC_cut)
    // M3 r1 fold (Codex 2026-05-08 Task 8 review): weighted_variance MUST scale by
    // (locumMult × uhcFactor)², not just locumMult². Pre-fold: variance scaled by locumMult²
    // alone while expected scaled by locumMult × uhcFactor → band-aware halfWidthPct =
    // (1.5×sd) / expected effectively widened by 1/uhcFactor in UHC-cut states. Post-fold:
    // band-as-percent-of-expected is invariant under UHC scaling (correct), so a 15%-cut state
    // gets the SAME percentage band as an exempt state for the same underlying BLS spread.
    weighted_variance:
      blsRow.rate_high !== null && blsRow.rate_low !== null
        ? Math.pow((blsRow.rate_high - blsRow.rate_low) / 4, 2) *
          locumMult *
          locumMult *
          uhcFactor *
          uhcFactor
        : null,
    n_survivors: observations.length,
    source_attribution: [...sourcesPresent],
    uhc_cut_applies: uhcApplies,
    ias_state_bookings: iasStateBookings,
    ias_division_bookings: iasDivisionBookings,
    ias_bookings_for_state: iasBookingsAnyArrangement,
    computed_at: Date.now(),
  }
}

export function applyUhcCut(rate: number, state: string, dateOfService: Date): number {
  const stateUpper = state.toUpperCase()
  if (dateOfService < UHC_CUT_EFFECTIVE_DATE) return rate
  if (UHC_EXEMPT_STATES.has(stateUpper)) return rate
  return rate * (1 - UHC_CUT_PCT)
}

// v4 AMENDMENT 2026-05-07: deriveLocumMultCrna is IAS-only. AANA was the v3 spine for the
// 1099/W2 ratio; with AANA REJECTED, v4 derives the multiplier empirically from IAS Firebase RTDB
// rows (survey_name='ias_internal_2026') with a four-step fallback ladder. Literature defaults at
// the bottom of the ladder come from SOURCING_AUDIT_v4.md §4.2.
//
// IMPORTANT: arrangement-aware. v3 returned a single multiplier (1099/W2 ratio). v4 returns a
// multiplier WHERE arrangement is the requested numerator over BLS-state-p50 (or mean) as denom.
export async function deriveLocumMultCrna(
  state: string,
  arrangement: CrnaArrangement = 'locum_w2',
): Promise<number> {
  const cache = await loadEnvelopeCache()
  const stateUpper = state.toUpperCase()
  const division = censusDivisionOf(stateUpper)

  // BLS state baseline (denominator). Task 5 ingest substitutes mean for null median; rows with
  // both BLS percentiles suppressed are not inserted at all. So a non-null rate_median here is
  // well-defined (either BLS state median or mean fallback) and a missing row is the 4-jurisdiction
  // fully-suppressed signal that correctly routes to literature default.
  const blsRow = cache.find(
    r =>
      r.state === stateUpper &&
      r.survey_name === 'bls_oews_29_1151_2024' &&
      r.rate_median !== null &&
      r.rate_median > 0,
  )
  if (!blsRow) return LITERATURE_DEFAULT_LOCUM_MULT[arrangement]

  // Helper: weighted-median-of-rate_median across IAS rows. Codex r1 SHOULD-1 fold + r2 SHOULD-1
  // fold: median is robust against single extreme rows; weighting by n_respondents prevents a
  // tiny snapshot row from counting equally with a large bucket.
  function weightedMedianOfRateMedian(rows: RawSurveyRow[]): number | null {
    const entries = rows
      .filter(
        r => r.rate_median !== null && Number.isFinite(r.rate_median) && r.rate_median > 0,
      )
      .map(r => ({ value: r.rate_median!, weight: Math.max(1, r.n_respondents ?? 1) }))
      .sort((a, b) => a.value - b.value)
    if (entries.length === 0) return null
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0)
    let cum = 0
    for (const e of entries) {
      cum += e.weight
      if (cum >= totalWeight / 2) return e.value
    }
    return entries[entries.length - 1].value // safety: last entry if rounding misses
  }

  // (1) IAS state-level ratio. Codex r2 MUST-3 fold: use arrangementMatches() so locum_general
  //     IAS rows (Task 2 Step 0 (b)/(c) coarse-schema branch) contribute to locum_w2 / locum_1099
  //     multiplier derivation. For non-locum queries (w2_employee, 1099_independent), only exact
  //     arrangement matches contribute.
  const iasState = cache.filter(
    r =>
      r.state === stateUpper &&
      r.survey_name.startsWith('ias_') &&
      arrangementMatches(r.employment_arrangement, arrangement) &&
      r.rate_median !== null &&
      r.rate_median > 0,
  )
  const totalNState = iasState.reduce((s, r) => s + (r.n_respondents ?? 0), 0)
  if (iasState.length > 0 && totalNState >= 5) {
    const medianIas = weightedMedianOfRateMedian(iasState)
    if (medianIas !== null) return medianIas / blsRow.rate_median!
  }

  // (2) IAS Census-Division ratio (gate (a) 9-Division survives unchanged)
  // M1 r1 fold (Codex 2026-05-08): division predicate must be COLUMN-ANCHORED.
  // Pre-fold: `censusDivisionOf((r.state ?? '').toUpperCase())` collapsed all
  // null-state rows to 'SA' (the default for empty input), contaminating the
  // South Atlantic division and missing all NE/MA/etc division-anchored rows.
  // Post-fold: state-anchored rows compute their division from r.state;
  // division-anchored rows read r.census_division directly.
  const iasDivision = cache.filter(
    r =>
      ((r.state !== null && censusDivisionOf(r.state.toUpperCase()) === division) ||
        (r.state === null && r.census_division === division)) &&
      r.survey_name.startsWith('ias_') &&
      arrangementMatches(r.employment_arrangement, arrangement) &&
      r.rate_median !== null &&
      r.rate_median > 0,
  )
  const totalNDivision = iasDivision.reduce((s, r) => s + (r.n_respondents ?? 0), 0)
  if (iasDivision.length > 0 && totalNDivision >= 10) {
    const medianIasDiv = weightedMedianOfRateMedian(iasDivision)
    if (medianIasDiv !== null) return medianIasDiv / blsRow.rate_median!
  }

  // (3) IAS national ratio
  const iasNational = cache.filter(
    r =>
      r.survey_name.startsWith('ias_') &&
      arrangementMatches(r.employment_arrangement, arrangement) &&
      r.rate_median !== null &&
      r.rate_median > 0,
  )
  const totalNNational = iasNational.reduce((s, r) => s + (r.n_respondents ?? 0), 0)
  if (iasNational.length > 0 && totalNNational >= 50) {
    const medianIasNat = weightedMedianOfRateMedian(iasNational)
    const blsNationalMedian = computeBlsNationalMedianFromCache(cache)
    if (medianIasNat !== null && blsNationalMedian > 0) {
      return medianIasNat / blsNationalMedian
    }
  }

  // (4) Literature default fallback (lokumapp 2025 + oncallsolutions 2024)
  // Codex r1 SHOULD-2 fold: these are LOW-CONFIDENCE PRIORS, not strong defaults.
  // The engine's tier-assignment logic surfaces them as PUBLIC-HINT (not HIGH/MULTI-SOURCE).
  return LITERATURE_DEFAULT_LOCUM_MULT[arrangement]
}

const LITERATURE_DEFAULT_LOCUM_MULT: Record<CrnaArrangement, number> = {
  w2_employee: 1.0, // BLS p50 itself
  '1099_independent': 1.6, // lokumapp 1099 $190-$250 / W-2 $81-$204 = ~1.6 hourly mid-band ratio
  locum_w2: 1.4, // mid-band per B.7-AANA.md §5.2; sits between W2 and 1099
  // Codex r1 NIT-2 + SHOULD-2: locum_1099 differs from 1099_independent by agency-margin overhead +
  // urgent-shift premium typical of locum 1099 postings. Set 1.7 as a slight uplift over the 1.6
  // generic 1099 default. Surface as low-confidence prior; should fire only when IAS national n < 50.
  locum_1099: 1.7,
}

function computeBlsNationalMedianFromCache(cache: RawSurveyRow[]): number {
  const blsRows = cache.filter(
    r =>
      r.survey_name === 'bls_oews_29_1151_2024' &&
      r.rate_median !== null &&
      r.rate_median > 0,
  )
  if (blsRows.length === 0) return 0
  const sorted = blsRows.map(r => r.rate_median!).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Exposed for testing only — clear in-memory cache between vitest cases.
// SHOULD-2 r1 fix: also clear in-flight promise to avoid stale resolution.
// S1 r2 fold (Codex 2026-05-08): increment generation token to invalidate any in-flight
// loader so it can't commit stale data into a freshly-reset cache.
export function _resetCacheForTesting(): void {
  _cache = null
  _cachePromise = null
  _cacheGeneration++
  // M1 r2 fold: also clear the cooldown timestamp so cache-failure tests
  // don't poison the next test's fetch attempt.
  _lastFetchErrorAt = null
}
