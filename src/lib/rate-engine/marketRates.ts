// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// marketRates.ts — Dynamic market rate loading from Firebase
// Loads scraped rate data and merges with static specialty ranges.
// Also handles per-specialty calibration feedback.
// ============================================================

import { ref, get } from 'firebase/database'
import { getDb } from './runtime'
import { SPECIALTIES, STATIC_CONFIDENCE, STATIC_SPECIALTY_RANGES } from './specialties'
import type { Confidence, SpecialtyRate } from './specialties'
import { roundUp5 } from './rateCalculator'
import { firebaseUnsafeKey } from './firebaseKeyCodec'

// Confidence ordering. Higher index = stronger signal. `modeled` is weakest
// (research-derived static fallback, no live confirmation); `high` is strongest
// (2+ INDEPENDENT source families on market-typed data — single-source-market
// overlays are suppressed entirely per Fix A 2026-05-15; same-brand-different-
// vintage scrapes collapse to one family per Fix B `sourceFamily()`). The
// pre-2026-05-15 rule was `3+ live multi-source confirmations` which over-
// credited same-source repeats; see commit deps(ias-dashboard) for context.
const CONFIDENCE_RANK: Record<Confidence, number> = {
  modeled: 0,
  low: 1,
  medium: 2,
  high: 3,
}

/** Return whichever confidence tier ranks higher. Used so loadMarketRates()
 *  never DOWNGRADES analyst curation — we only upgrade when live signal is
 *  stronger than the static curated value. */
function pickHigher(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_RANK[a] >= CONFIDENCE_RANK[b] ? a : b
}

// Corporate-family registry + `sourceFamily()` were PROMOTED into the shared
// `./sourceFamily` module (Phase 3, A.3, Plan 03-02 / D-37) so BOTH this engine
// file (the loadMarketRates confidence gate below) AND the bridge
// (aggregateBridge family collapse-then-cap) consume ONE implementation — single
// source of truth. The CHG collapse semantics are byte-preserved; the registry
// was EXTENDED with AMN / jackson / cross_country / aya.
//
// Import locally so the `loadMarketRates` uniqueFamilies gate (line ~255) keeps a
// real in-scope binding, AND re-export so the existing public consumer site + the
// marketRates.test.ts sourceFamily describe block resolve unchanged. A bare
// `export { sourceFamily } from './sourceFamily'` would NOT create a local binding
// — it would leave the internal `sources.map(sourceFamily)` reference unresolved.
import { sourceFamily, KNOWN_FAMILY_OVERRIDES } from './sourceFamily'
export { sourceFamily, KNOWN_FAMILY_OVERRIDES }

// === MARKET RATE TYPES ===
export interface MarketRateData {
  min: number
  max: number
  p70?: number
  sources: string[]
  lastUpdated: number // timestamp
  /** Discriminator for observed-paid ('market') vs ceiling/billed ('cap') data
   *  per ARCHITECTURE.md §1.2.B. Additive optional field — absent on legacy
   *  Firebase rows written before the bridge wrote the column explicitly.
   *  Legacy semantics: absent → treat as 'market'. The Wave-3 bridge writes
   *  this field on EVERY new row so a hypothetical future cap pipeline never
   *  crosses streams with the market aggregate. */
  valueType?: 'market' | 'cap'
}

/** Per-`(specialty, state, rate_type)` bucket posterior produced by the Phase-3
 *  bridge (AGG-02/03/04, Plan 03-02). Distinct from `MarketRateData` ON PURPOSE
 *  (RESEARCH §1 interface decision): `min/max/p70` is the wrong shape for a
 *  statistical posterior, so the legacy `MarketRateData` keeps serving the legacy
 *  RTDB path while THIS interface carries the `aggregateCell` MAD+IVW output for
 *  the versioned multi-bucket path (D-39b).
 *
 *  `weighted_mean === null` ⇔ `confidence === 'manual_review_bimodal'` — the
 *  consumer (and the bridge) MUST check confidence before using the mean; a null
 *  mean routes to the coverage-ladder "insufficient data / manual review" rung,
 *  NEVER a fabricated number (RESEARCH §3 / Pitfall 5; no-fake-data Core Value).
 *
 *  `n_distinct` is the post-dedup distinct-observation count (AGG-01) that drives
 *  the math; `n_raw` is the pre-dedup raw count carried for transparency.
 *  `family_capped` is the SC3 evidence flag — true iff the ≤60% corporate-family
 *  weight cap fired on this bucket (D-37). */
export interface MarketBucketData {
  weighted_mean: number | null
  weighted_variance: number | null
  median: number
  confidence: 'multi_source' | 'single_source' | 'zero_spread' | 'manual_review_bimodal'
  n_distinct: number
  n_raw: number
  source_families: string[]
  family_capped: boolean
  lastUpdated: number
}

// =============================================================================
// Phase 3 (A.3, Plan 03-04 Task 5) — versioned multi-bucket v2 READER + D-39
// precedence + D-39a coverage ladder.
//
// Reads the bridge's `rate-simulator/market-rates-v2` tree (written in 03-04
// Task 4) and selects the SINGLE primary bucket per (specialty, state) cell by
// D-39 precedence, plus an honest coverage tier. Falls back to legacy when v2 is
// absent/empty so a fresh deploy reading an un-rebuilt tree (or a stale bridge)
// never crashes (D-39b/D-40 cutover safety).
//
// The reader is a PURE consumer of the server-computed posteriors — it does NOT
// re-aggregate, and it does NOT re-apply the legacy `uniqueFamilies>=2` family
// gate (that logic moved SERVER-SIDE in 03-02's collapse-then-cap; re-applying it
// here would double-count — RESEARCH "State of the Art"). It trusts the bucket's
// `confidence` + `source_families` verbatim.
// =============================================================================

/** D-39 primary-bucket precedence, most→least defensible AS A LOCUM PAY RATE.
 *  ONLY these four rate_types are selectable as the primary number; mirrors the
 *  bridge's RATE_TYPE_PRECEDENCE (Task 4) so producer + consumer agree.
 *  permanent_wage_proxy (labeled context only), agency_bill_rate (D-12 — never a
 *  locum number), and null_unclassified (bottom rung) are DELIBERATELY ABSENT so
 *  they can never be selected as primary. */
const BUCKET_PRECEDENCE: Record<string, number> = {
  actual_paid_locum: 4,
  advertised_clinician_pay: 3,
  crowd_survey: 2,
  scraped_article_estimate: 1,
  // WS1 (2026-07-01): aggregator_estimate is the LOWEST rung (0) — an aggregator's
  // self-"estimated" range (LJO/TrackFive) for a hidden-pay posting. Renderable as
  // labeled context when it's the only signal, but NEVER anchorable (absent from
  // DEFAULT_ANCHORABLE_RATE_TYPES), so it can never drive the quote off the curated band.
  aggregator_estimate: 0,
}

/** RTDB-safe literal for a NULL rate_type bucket (the bottom rung of the ladder). */
const NULL_BUCKET_KEY = 'null_unclassified'

/** Recency window for a v2 bucket to be RENDERABLE — the SAME 7-day window the
 *  legacy reader gates on (`loadMarketRates` age check ~line 406). Mirrors the
 *  legacy posture so an aged-out v2 bucket is never selected as PRIMARY with a
 *  confident provenance/tier badge (pre-deploy review M2-reader; Core-Value: no
 *  stale/defensibly-inaccurate number renders as the current market rate). The
 *  bridge write-side prune is a defense-in-depth sibling fix (other executor);
 *  THIS reader gate is the authoritative half. */
const RATE_READ_WINDOW_MS = 7 * 86400000

/** The set of rate_types the consumer may ever carry in `cell.buckets` — the four
 *  D-39-selectable locum types PLUS the two labeled-context rungs (permanent_wage_proxy
 *  as context, null_unclassified as the bottom rung). agency_bill_rate (a D-12 bill
 *  class) and any unknown rate_type are DELIBERATELY ABSENT so the reader strips them
 *  and a bill rate can never reach a consumer (pre-deploy review m6, reader-strip
 *  defense-in-depth; the bridge write-side exclusion is the other half). */
const RENDERABLE_RATE_TYPES = new Set<string>([
  ...Object.keys(BUCKET_PRECEDENCE),
  'permanent_wage_proxy',
  NULL_BUCKET_KEY,
])

/** True iff `lastUpdated` is a finite, in-window timestamp (≤ 7 days old). A
 *  missing/non-finite/0 `lastUpdated` CANNOT prove freshness → treated as stale
 *  (rejected), never as epoch-0-fresh. Injectable `now` for tests; defaults to
 *  Date.now(). */
function isFreshBucket(lastUpdated: unknown, now: number): boolean {
  if (typeof lastUpdated !== 'number' || !Number.isFinite(lastUpdated) || lastUpdated <= 0) {
    return false
  }
  return now - lastUpdated <= RATE_READ_WINDOW_MS
}

/** The D-39a coverage tier the consumer renders. 'primary' when a renderable
 *  typed locum bucket was selected; 'unclassified_only' when only the
 *  null_unclassified bucket has a finite number (the labeled bottom rung — never
 *  imputed); 'insufficient_data' when no bucket has a renderable number. */
export type CoverageTier = 'primary' | 'unclassified_only' | 'insufficient_data'

/** The selected primary bucket for a cell: the rate_type + its posterior. */
export interface PrimaryBucket {
  rateType: string
  data: MarketBucketData
}

/** Per-specialty (currently national-only) multi-bucket read result. */
export interface SpecialtyBuckets {
  /** The D-39-selected primary bucket, or null when none is renderable. */
  primary: PrimaryBucket | null
  /** The D-39a coverage tier label the consumer renders. */
  coverageTier: CoverageTier
  /** The null_unclassified bucket's posterior IF it has a finite number — the
   *  labeled bottom rung; null otherwise. NEVER promoted to primary, never imputed. */
  unclassified: MarketBucketData | null
  /** Every bucket in the cell, keyed by rate_type (exposed for context display;
   *  the consumer renders ONLY the primary as the headline number). */
  buckets: Record<string, MarketBucketData>
}

export interface MarketBucketsResult {
  /** Per-specialty buckets (decoded specialty key → cell). Empty when v2 absent. */
  specialties: Record<string, SpecialtyBuckets>
  /** True when the v2 tree was absent/empty and the consumer should read legacy
   *  (the legacy SPECIALTIES overlay via loadMarketRates remains the fallback). */
  fellBackToLegacy: boolean
}

/** The four confidence tiers aggregateCell emits — used to validate untrusted
 *  RTDB children (a corrupted node must not be rendered as a number). */
const VALID_BUCKET_CONFIDENCE = new Set([
  'multi_source',
  'single_source',
  'zero_spread',
  'manual_review_bimodal',
])

/** True iff `b` is a shaped MarketBucketData with a finite, renderable mean AND a
 *  trustworthy posterior shape. A null weighted_mean (manual_review_bimodal) is
 *  NOT renderable — the consumer must fall to the next rung, never fabricate a
 *  number (Pitfall 5 / Core Value).
 *
 *  Firebase children are UNTRUSTED (a bad past write / partial sync can leave a
 *  malformed node — the same posture as isCalibrationEntry in this file; Codex
 *  r2 #3). So renderability also requires a valid `confidence` tier and a
 *  positive `n_distinct` (a bucket built from ≥1 observation by the bridge). A
 *  finite mean with n_distinct≤0 is a corrupted node and must NOT render a
 *  number — fall to the next rung.
 *
 *  STALENESS GATE (pre-deploy review M2-reader): renderability ALSO requires a
 *  fresh `lastUpdated` (≤ 7 days, the legacy window). An aged-out bucket must NOT
 *  render — it would surface a stale number with a confident provenance/tier
 *  badge. `now` is injected (defaults to Date.now()) so tests can pin the clock. */
function isRenderableBucket(b: unknown, now: number = Date.now()): b is MarketBucketData {
  if (typeof b !== 'object' || b === null) return false
  const d = b as Record<string, unknown>
  if (typeof d.weighted_mean !== 'number' || !Number.isFinite(d.weighted_mean)) return false
  if (typeof d.n_distinct !== 'number' || !Number.isFinite(d.n_distinct) || d.n_distinct <= 0) {
    return false
  }
  if (typeof d.confidence !== 'string' || !VALID_BUCKET_CONFIDENCE.has(d.confidence)) return false
  if (!isFreshBucket(d.lastUpdated, now)) return false
  return true
}

/** Select the primary bucket from a cell's buckets by D-39 precedence, considering
 *  ONLY renderable buckets (finite mean) whose rate_type is in BUCKET_PRECEDENCE.
 *  Returns the highest-precedence match, or null. A bucket whose mean is null
 *  (bimodal) is skipped → the selector falls to the next renderable rung. */
function selectPrimary(
  buckets: Record<string, MarketBucketData>,
  now: number = Date.now(),
): PrimaryBucket | null {
  let best: { rateType: string; data: MarketBucketData; rank: number } | null = null
  for (const [rateType, data] of Object.entries(buckets)) {
    if (!isRenderableBucket(data, now)) continue
    const rank = BUCKET_PRECEDENCE[rateType]
    if (rank === undefined) continue // proxy / agency_bill_rate / null — never primary
    if (best === null || rank > best.rank) best = { rateType, data, rank }
  }
  return best ? { rateType: best.rateType, data: best.data } : null
}

/** Pull a single cell's `buckets` node from a v2 spec node by stateKey. Returns
 *  null for a malformed/absent cell. */
function cellBucketsNode(specNode: Record<string, unknown>, stateKey: string): Record<string, unknown> | null {
  const cell = specNode[stateKey]
  if (typeof cell !== 'object' || cell === null) return null
  const bucketsNode = (cell as Record<string, unknown>).buckets
  if (typeof bucketsNode !== 'object' || bucketsNode === null) return null
  return bucketsNode as Record<string, unknown>
}

/** Extract the buckets map for one specialty cell from the raw v2 node, with the
 *  D-39a state ladder + the m6 reader-strip.
 *
 *  The v2 shape is `{ __meta__, {stateKey}: { buckets: { {rateType}: MarketBucketData } } }`.
 *  m4 (state ladder): v1 is 100% national, so we PREFER the 'national' cell, but if
 *  no national cell exists we fall to the first available state cell rather than
 *  silently dropping a state-bearing population. (`__meta__` is never a state key.)
 *
 *  m6 (reader-strip, defense-in-depth): only rate_types in RENDERABLE_RATE_TYPES
 *  survive into the returned map — agency_bill_rate (a D-12 bill class) and any
 *  unknown rate_type are STRIPPED so `cell.buckets` can never carry a bill rate to
 *  a consumer, even if a future write-side regression persists one. Returns {} for
 *  a malformed/absent cell.
 *
 *  `cellFound` distinguishes "a cell+buckets node existed (even if everything in
 *  it was stripped/non-renderable)" from "no cell at all". The caller registers an
 *  honest `insufficient_data` specialty for the former (so a cell carrying ONLY a
 *  bill rate still surfaces a labeled rung, never silently vanishes) and skips the
 *  latter. */
function readCellBuckets(specNode: unknown): {
  buckets: Record<string, MarketBucketData>
  cellFound: boolean
} {
  if (typeof specNode !== 'object' || specNode === null) return { buckets: {}, cellFound: false }
  const node = specNode as Record<string, unknown>

  // D-39a ladder: prefer national; else fall to the first real state cell with a
  // buckets node. `__meta__` is metadata, never a cell.
  let bucketsNode = cellBucketsNode(node, 'national')
  if (bucketsNode === null) {
    for (const key of Object.keys(node)) {
      if (key === '__meta__' || key === 'national') continue
      const candidate = cellBucketsNode(node, key)
      if (candidate !== null) {
        bucketsNode = candidate
        break
      }
    }
  }
  if (bucketsNode === null) return { buckets: {}, cellFound: false }

  // m6 reader-strip: drop any rate_type not in the renderable/precedence set so a
  // bill rate (or any unknown type) can never reach a consumer via cell.buckets.
  const stripped: Record<string, MarketBucketData> = {}
  for (const [rateType, data] of Object.entries(bucketsNode)) {
    if (!RENDERABLE_RATE_TYPES.has(rateType)) continue
    stripped[rateType] = data as MarketBucketData
  }
  return { buckets: stripped, cellFound: true }
}

/** Read the versioned multi-bucket v2 tree and select the primary bucket + coverage
 *  tier per specialty (national cell). Falls back (flag) to legacy when v2 is
 *  absent/empty. Silent-no-op on any fetch error (returns fellBackToLegacy=true
 *  with empty specialties) — mirrors loadMarketRates's try/catch → safe default so
 *  the static Layer A values keep serving. PURE consumer (no re-aggregation, no
 *  family re-gate — D-37 moved that server-side; re-applying = double-count). */
export async function loadMarketBuckets(): Promise<MarketBucketsResult> {
  try {
    const snap = await get(ref(getDb(), 'rate-simulator/market-rates-v2'))
    const v2 = snap.exists() ? (snap.val() as Record<string, unknown>) : null
    if (v2 === null || typeof v2 !== 'object' || Object.keys(v2).length === 0) {
      // v2 absent/empty → the consumer reads the legacy overlay (loadMarketRates).
      return { specialties: {}, fellBackToLegacy: true }
    }

    // Pin a single `now` across the whole read so every staleness comparison in
    // this pass uses the same clock (no skew between buckets selected within one
    // run — pre-deploy review M2-reader).
    const now = Date.now()

    const specialties: Record<string, SpecialtyBuckets> = {}
    for (const [encodedKey, specNode] of Object.entries(v2)) {
      const key = firebaseUnsafeKey(encodedKey)
      // D-39a ladder + m4 state-cell read + m6 reader-strip live inside
      // readCellBuckets (prefer national, fall to a real state cell, strip
      // non-renderable rate_types incl. agency_bill_rate).
      const { buckets, cellFound } = readCellBuckets(specNode)
      // No cell/buckets node at all → skip the specialty entirely (nothing to
      // render). A cell that existed but is now empty after the m6 strip (e.g. it
      // carried ONLY agency_bill_rate) is NOT skipped — it registers below as an
      // honest insufficient_data rung so the bill rate's existence never makes a
      // typed specialty silently vanish.
      if (!cellFound) continue

      const primary = selectPrimary(buckets, now)
      const nullBucket = buckets[NULL_BUCKET_KEY]
      // Staleness gate also applies to the labeled bottom rung: an aged-out null
      // bucket is NOT exposed as the unclassified-evidence number.
      const unclassified = isRenderableBucket(nullBucket, now) ? nullBucket : null

      let coverageTier: CoverageTier
      if (primary !== null) {
        coverageTier = 'primary'
      } else if (unclassified !== null) {
        // No typed/labeled primary, but the null bucket has a finite number → the
        // bottom "unclassified evidence" rung (labeled, never imputed, never
        // promoted to a typed bucket — Pitfall 4).
        coverageTier = 'unclassified_only'
      } else {
        // Nothing renderable (e.g. only a bimodal/null-mean bucket, or only
        // agency_bill_rate / permanent_wage_proxy with no locum number) → honest
        // insufficient-data; the consumer renders a labeled rung, NEVER a blank,
        // NEVER a fabricated number.
        coverageTier = 'insufficient_data'
      }

      specialties[key] = { primary, coverageTier, unclassified, buckets }
    }

    return { specialties, fellBackToLegacy: false }
  } catch {
    // Any fetch/parse failure → safe default; the legacy overlay still serves.
    return { specialties: {}, fellBackToLegacy: true }
  }
}

// =============================================================================
// Move #1 (RESEARCH §1+§2 #1) — the TRUST-LADDER quote anchor.
//
// loadMarketBuckets() READS the bridge's variance-weighted, MAD/median-robust
// posterior (aggregateCell → market-rates-v2) but is display-only. This overlay
// makes a posterior ANCHOR the quote — but ONLY when the signal is trustworthy
// enough to beat the analyst-researched curated band. The trust ladder for a
// LOCUM-PAY anchor (RESEARCH §1 verdict + §6 source tiers):
//   1. actual_paid_locum / advertised_clinician_pay posterior, corroborated  → ANCHOR
//   2. curated researched band (cross-referenced, audited)                   → the prior
//   3. crowd_survey / scraped_article_estimate posterior                     → context only
//   4. crude legacy min/max/p70 overlay (loadMarketRates)                    → RETIRED
//
// WHY market-typed ONLY (anchorableRateTypes): RESEARCH §6 classifies scraped
// articles + crowd surveys as PRIORS, never the live anchor — they are indirect
// (often permanent- or employed-pay prose), so even a well-corroborated scraped
// posterior must not override a researched curated band. Only DIRECT locum-pay
// signals (actual paid / advertised pay) earn the anchor. On a corroboration gate
// of n_distinct ≥ 4 (integer) AND ≥ 2 independent families — robustness is
// mathematically unavailable below n=4 (Rousseeuw & Verboven 2002), and ≥2
// families guards the single-source-sets-the-price failure (Fix A/B, 2026-05-15).
//
// WHY the crude legacy overlay is RETIRED (the §1 verdict, "the crude min/max/p70
// band should lose"): raw extrema have a breakdown point of zero — one outlier
// sets the floor/ceiling. The init no longer calls loadMarketRates(); a cell with
// no anchorable posterior simply keeps its CURATED band (the audited prior), which
// the robust v2 posteriors corroborate better than the crude overlay did. The
// loadMarketRates function is retained (tested, available) but unwired.
//
// WHY the band uses the static curated range: a promoted cell re-levels p70 to the
// robust central and takes [min,max] from STATIC_SPECIALTY_RANGES (widened only to
// contain the anchor). We do NOT derive the band from `weighted_variance`: that is
// the estimator's standard error (1/ΣW), not population spread — it is 0 for
// zero_spread cells, so a mean±k·SE band would collapse. Honest confidence-encoding
// intervals + hierarchical shrinkage for thin cells are Moves #2/#3.
// =============================================================================

/** Rate types whose posterior may ANCHOR the quote — ONLY market-typed locum
 *  signals (directly-observed paid rates + advertised clinician pay). Indirect
 *  signals (crowd_survey, scraped_article_estimate) are priors-only (RESEARCH §6):
 *  they inform display context but never drive the quote, so a scraped-article
 *  estimate can never override the analyst-researched curated band. */
export const DEFAULT_ANCHORABLE_RATE_TYPES: ReadonlySet<string> = new Set([
  'actual_paid_locum',
  'advertised_clinician_pay',
])

export interface BucketOverlayOptions {
  /** Minimum distinct post-dedup observations for a primary bucket to anchor the
   *  quote. Default 4 — the robust-spread floor (Rousseeuw & Verboven 2002); below
   *  it, prefer the prior (Move #3 shrinkage will let thin cells contribute). */
  minDistinct?: number
  /** Minimum independent source families. Default 2 — corroboration; mirrors the
   *  legacy single-source-market suppression (Fix A/B). Four scrapes of ONE brand
   *  are not four independent votes. */
  minFamilies?: number
  /** Rate types allowed to anchor the quote. Default = market-typed only
   *  (DEFAULT_ANCHORABLE_RATE_TYPES). Indirect rate types are excluded so the
   *  curated prior wins over article/survey prose. */
  anchorableRateTypes?: ReadonlySet<string>
}

/** Confidence tier a promoted bucket may display, by D-39 rate type. The displayed
 *  number is now the LIVE posterior, so its confidence must reflect the bucket's
 *  data type — NOT the curator's tier for a different (curated) number. Market-typed
 *  pay signals (directly-observed paid locum / advertised clinician pay) may read
 *  'high' once the corroboration gate is met (matches the existing 'high' =
 *  "market-typed, 2+ independent families" definition); indirect signals (crowd
 *  survey, scraped-article prose) cap at 'medium' even when corroborated — labeling
 *  article-derived estimates 'high' would overstate confidence (no-fake-confidence
 *  Core Value). Full confidence-chip semantics are Move #6; this is the honest floor. */
function bucketConfidenceCeiling(rateType: string): Confidence {
  switch (rateType) {
    case 'actual_paid_locum':
    case 'advertised_clinician_pay':
      return 'high'
    default: // crowd_survey, scraped_article_estimate, or anything unexpected
      return 'medium'
  }
}

/** Mutate SPECIALTIES in place: for every cell in `result` whose D-39 primary
 *  bucket is a MARKET-TYPED rate (anchorableRateTypes) AND clears the corroboration
 *  gate, set p70 to the posterior's robust central estimate (round(weighted_mean))
 *  and take the displayed band from the static curated range (widened only to
 *  contain the anchor). Returns the count promoted.
 *
 *  Pure w.r.t. Firebase (no I/O) → unit-testable without a db mock;
 *  loadMarketBucketRates() is the async wrapper that fetches then applies. It is the
 *  SOLE live overlay (loadMarketRates is retired/unwired): a cell with no anchorable
 *  posterior is simply left on its CURATED band — the audited researched prior, which
 *  the robust posteriors corroborate better than the crude legacy overlay did. */
export function applyMarketBucketsOverlay(
  result: MarketBucketsResult,
  opts: BucketOverlayOptions = {},
): number {
  const minDistinct = opts.minDistinct ?? 4
  const minFamilies = opts.minFamilies ?? 2
  const anchorable = opts.anchorableRateTypes ?? DEFAULT_ANCHORABLE_RATE_TYPES
  let promoted = 0

  for (const [key, specBuckets] of Object.entries(result.specialties)) {
    const spec = SPECIALTIES[key]
    if (!spec) continue // result may carry a specialty the static table doesn't have
    if (specBuckets.coverageTier !== 'primary' || specBuckets.primary === null) continue

    // Trust-ladder gate: only MARKET-TYPED locum signals may anchor the quote.
    // Indirect rate types (crowd_survey, scraped_article_estimate) are priors-only
    // (RESEARCH §6) — they never override the curated band, even when corroborated.
    if (!anchorable.has(specBuckets.primary.rateType)) continue

    const b = specBuckets.primary.data
    // A null weighted_mean is the manual_review_bimodal sentinel — NEVER anchor a
    // bimodal cell on a collapsed mean (nor its median). Skip to the prior.
    if (typeof b.weighted_mean !== 'number' || !Number.isFinite(b.weighted_mean) || b.weighted_mean <= 0) {
      continue
    }
    // Corroboration gate: robust spread needs n≥4; ≥2 independent families guards
    // the single-source-sets-the-price failure. n_distinct must be a positive
    // INTEGER (a fractional value is a corrupted RTDB node — the bridge always
    // writes integers; Number.isInteger also rejects NaN/Infinity/non-number).
    if (!Number.isInteger(b.n_distinct) || b.n_distinct < minDistinct) continue
    // Count DISTINCT, NON-BLANK families (not array length) so a duplicated or empty
    // entry can't fake corroboration — same posture as loadMarketRates's
    // `sources.filter(s => s.trim().length > 0).map(sourceFamily)` then Set.size.
    const families = Array.isArray(b.source_families)
      ? new Set(b.source_families.filter((s) => typeof s === 'string' && s.trim().length > 0)).size
      : 0
    if (families < minFamilies) continue

    const anchor = Math.round(b.weighted_mean)
    // Band base = frozen static curated range (never the legacy-overlaid band).
    // Widen only to contain the anchor; never fabricate a spread from the
    // (degenerate) estimator variance. STATIC_SPECIALTY_RANGES is built from every
    // SPECIALTIES key, so this is non-null for any cell that passed the `!spec`
    // guard; skip rather than fall back to the (already-mutated) live spec, which
    // would defeat the whole point of the frozen snapshot.
    const range = STATIC_SPECIALTY_RANGES[key]
    if (!range) continue
    spec.p70 = anchor
    spec.min = Math.min(range.min, anchor)
    spec.max = Math.max(range.max, anchor)
    // The displayed range now reflects a live posterior, not the curated baseline.
    spec.provenance = 'live'
    // Confidence reflects the LIVE bucket's rate type, not the curator's tier for a
    // now-superseded curated number — article/survey signals cap at 'medium' even
    // when corroborated, so we never display article-derived data as 'high'.
    spec.confidence = bucketConfidenceCeiling(specBuckets.primary.rateType)
    promoted++
  }

  return promoted
}

/** Async wrapper: read the v2 posterior tree (loadMarketBuckets) then apply the
 *  overlay. Mirrors loadMarketRates's return (count of cells changed). Safe by
 *  construction — loadMarketBuckets already swallows fetch errors and gates
 *  freshness, so this never throws and a stale/absent tree promotes nothing. */
export async function loadMarketBucketRates(opts?: BucketOverlayOptions): Promise<number> {
  const result = await loadMarketBuckets()
  return applyMarketBucketsOverlay(result, opts)
}

export type RateMode = 'hourly' | 'call_daily'

export interface CalibrationEntry {
  specialty: string
  state: string
  /** 'hourly' for $/hr regular shifts, 'call_daily' for call-only $/day stipends.
   *  Older entries (pre-2026-04-29) lack this field — inferLegacyRateMode
   *  classifies them by magnitude. See Codex C-3 / H-8. */
  rateMode?: RateMode
  simulatedRate: number
  acceptedRate: number
  accuracy: number
  submittedBy: string
  notes: string
  timestamp: number
  /** True iff the QUOTE was constrained by the engine cap at the moment of
   *  feedback submission. Distinguishes "closed at the cap" from "closed in
   *  open-market range." Used downstream for filtering, NOT for math — the
   *  existing margin-leak guard at computeDisplayedRate still drops positive
   *  calibration when capped, regardless of this flag. Absent on legacy
   *  entries (pre-Wave-2.2); treat absent as 'unknown' (NOT 'market').
   *
   *  Filter rule per ARCHITECTURE.md §1.2.C: downstream code must filter on
   *  `quoteCapBound === true` and `quoteCapBound === false` explicitly.
   *  NEVER rely on truthiness — `if (entry.quoteCapBound)` collapses 'unknown'
   *  into 'not capped', erasing the legacy distinction. */
  quoteCapBound?: boolean
}

// Floor below which a value is too small to be a daily call stipend, so we
// classify it as hourly. Real locum hourly rates top out around $400-$425/hr
// (per Locumstory 2025 / CompHealth public data); daily call stipends start
// ~$1000 and reach $5000+. The $1000 floor leaves a clean ~$575 dead zone
// between the two distributions. Codex H-8 raised this from $500 in plan
// review; an audit/backfill of legacy Firebase rows lacking rateMode is the
// right paired ops step before claiming zero migration risk.
const LEGACY_CALL_DAILY_FLOOR = 1000

/** Infer rate mode for a CalibrationEntry that lacks an explicit rateMode field.
 *  If EITHER simulatedRate or acceptedRate hits the daily-magnitude floor, treat
 *  as call_daily — guards against pre-fix call-only entries polluting the hourly
 *  recentAvgRatio (which would slam the dampening clamp). Codex C-3 + H-8. */
export function inferLegacyRateMode(e: CalibrationEntry): RateMode {
  if (e.rateMode) return e.rateMode
  if (e.simulatedRate >= LEGACY_CALL_DAILY_FLOOR) return 'call_daily'
  if (e.acceptedRate >= LEGACY_CALL_DAILY_FLOOR) return 'call_daily'
  return 'hourly'
}

/** Runtime type guard for entries pulled from EITHER Firebase or localStorage.
 *  Both layers ultimately surface untrusted shaped data — Firebase children
 *  can be null / partial / type-shifted by a bad write, localStorage can hold
 *  anything a buggy build wrote there. A corrupted entry must not throw at
 *  dedup or pollute the aggregate math (Codex H-9 + T11/S7 round-1 MUST).
 *
 *  Numeric fields require Number.isFinite (rejects NaN / Infinity from JSON
 *  overflow), and rate / timestamp must be positive — a 0 or negative timestamp
 *  would break the recency sort, and a 0 rate breaks the divisor in
 *  recentAvgRatio. */
function isCalibrationEntry(v: unknown): v is CalibrationEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.specialty === 'string' && e.specialty.length > 0 &&
    typeof e.state === 'string' &&
    typeof e.simulatedRate === 'number' && Number.isFinite(e.simulatedRate) && e.simulatedRate > 0 &&
    typeof e.acceptedRate === 'number' && Number.isFinite(e.acceptedRate) && e.acceptedRate > 0 &&
    typeof e.accuracy === 'number' && Number.isFinite(e.accuracy) &&
    typeof e.submittedBy === 'string' &&
    typeof e.notes === 'string' &&
    typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) && e.timestamp > 0 &&
    (e.rateMode === undefined || e.rateMode === 'hourly' || e.rateMode === 'call_daily') &&
    // Wave 2.2: quoteCapBound is additive optional. Reject any non-boolean
    // non-undefined value (e.g. a stray string from a bad migration) so the
    // downstream `=== true` / `=== false` filter rule holds.
    (e.quoteCapBound === undefined || e.quoteCapBound === true || e.quoteCapBound === false)
  )
}

/** Dedup key includes specialty + inferred rateMode so a same-millisecond
 *  collision in a DIFFERENT bucket can't suppress a legit local entry in this
 *  one (Codex T11/S7 round-1 SHOULD-2). The original (timestamp,sim,accept)
 *  was sufficient for the dual-write contract within one bucket but would
 *  cross-bucket false-dedup at scale. */
const dedupKeyOf = (e: CalibrationEntry) =>
  `${e.specialty}|${inferLegacyRateMode(e)}|${e.timestamp}|${e.simulatedRate}|${e.acceptedRate}`

/** Read the localStorage feedback backup, defensively. Returns [] in any
 *  failure mode — non-browser env, missing key, corrupted JSON, non-array
 *  payload, type-guard rejection. Pure read, no side effects. */
function readLocalFeedback(): CalibrationEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem('rateFeedback')
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isCalibrationEntry)
  } catch {
    return []
  }
}

export interface SpecialtyCalibration {
  entries: CalibrationEntry[]
  avgAccuracy: number
  avgDelta: number    // positive = we're underestimating, negative = overestimating
  sampleSize: number
  adjustment: number  // multiplier to apply (e.g., 1.05 = raise rates 5%)
}

// === LOAD MARKET RATES FROM FIREBASE ===
// Reads scraped rate data and merges into SPECIALTIES in place.
// Static values serve as fallback when no scraped data exists.
export async function loadMarketRates(): Promise<number> {
  try {
    const snap = await get(ref(getDb(), 'rate-simulator/market-rates'))
    if (!snap.exists()) return 0

    const data = snap.val() as Record<string, MarketRateData>
    let updated = 0

    // Decode RTDB-safe keys back to canonical SPECIALTIES keys (e.g. `ob%2Fgyn`
    // → `ob/gyn`). The bridge writer encodes via firebaseSafeKey because
    // Firebase treats `/` as a path separator — see firebaseKeyCodec.ts.
    for (const [encodedKey, market] of Object.entries(data)) {
      const key = firebaseUnsafeKey(encodedKey)
      if (!SPECIALTIES[key]) continue
      // Only use scraped data if it's less than 7 days old
      const age = Date.now() - (market.lastUpdated || 0)
      if (age > 7 * 86400000) continue

      const spec = SPECIALTIES[key]

      // Cap-typed overlay routing skip (Codex r1 M1 fold, 2026-05-15) — the
      // bridge writes market rows to `rate-simulator/market-rates` and cap
      // rows to a separate `rate-simulator/cap-rates` path. `loadMarketRates`
      // reads ONLY the market path, so a `valueType: 'cap'` row appearing here
      // is a routing leak; either way it must NOT mutate the market spec
      // base because a ceiling is structurally not a rate observation. A
      // future `loadCapRates()` will read the cap path into its own state
      // (and feed `f.rateCap` for facility-specific caps); until then we
      // defensively skip cap rows here.
      if (market.valueType === 'cap') continue

      // Source normalization (Codex r1 M2 fold, 2026-05-15) — filter
      // `market.sources` to non-empty strings before counting. Without this,
      // a bad upstream write like `sources: ['locums_com', null]` would count
      // as 2 sources and 2 families (`sourceFamily(null) === 'unknown'`),
      // wrongly promoting to 'high' confidence. Fix A/B should measure
      // valid source identities, not array slots.
      const sources: string[] = Array.isArray(market.sources)
        ? market.sources.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map(s => s.trim())
        : []
      const sourceCount = sources.length

      // Single-source-market overlay suppression (Fix A, 2026-05-15) —
      // production trigger: `rate-simulator/market-rates/crna` had
      // `{p70: 298.5, sources: ['tavily_research']}` (one LLM-extracted prose
      // scrape) which overrode the curated CRNA static range $190-250 for 7
      // days and surfaced as ~$298 on the hero block. A single source is
      // signal, not corroboration; the curated static range is analyst-tuned
      // and shouldn't be displaced without multi-source evidence.
      if (sourceCount < 2) continue

      // Merge: use scraped values, recalculate p70, and upgrade confidence if
      // the live signal is stronger than the curated default.
      if (market.min > 0 && market.max > market.min) {
        spec.min = market.min
        spec.max = market.max
        spec.p70 = market.p70 || Math.round(market.min + (market.max - market.min) * 0.70)
        // Fix D (2026-05-15): mark this specialty's provenance 'live' so the
        // UI can disclose that the displayed min/max/p70 came from the multi-
        // source RTDB overlay, not the curated static range. Only reached
        // when Fix A guard (sourceCount >= 2) passes — single-source-market
        // overlays never set this flag.
        spec.provenance = 'live'

        // Compute live-signal confidence. Outer guards above already ensure:
        //  (a) age <= 7d (freshness gate),
        //  (b) valueType !== 'cap' (cap routing handled separately per M1),
        //  (c) sourceCount >= 2 (Fix A single-source-market suppression).
        // So any row reaching here is a fresh multi-source market overlay.
        //
        // Confidence tightening (Fix B, 2026-05-15) — 'high' now requires
        // multiple INDEPENDENT source families, not just multiple scrapes
        // from the same brand. Five `locums_com` rows + one `locums_com_2025`
        // row = 1 family (locums) = NOT high. One `locums_com` row + one
        // `bls_oews_2024` row = 2 families = high. Pure source-COUNT can be
        // gamed by the same scraper firing repeatedly into the same bucket,
        // which the legacy `sourceCount >= 3 → high` rule conflated with
        // independent corroboration. CHG-correlated brands (LocumStory,
        // CompHealth, Weatherby, Global Medical) collapse to one family
        // via `KNOWN_FAMILY_OVERRIDES` (Codex r1 S2 fold).
        const uniqueFamilies = new Set(sources.map(sourceFamily)).size
        let computed: Confidence = 'modeled'
        if (uniqueFamilies >= 2) computed = 'high'
        else computed = 'medium'  // sourceCount >= 2 guaranteed by upstream guard

        // Compare against the STATIC baseline (not the possibly-already-
        // mutated `spec.confidence`) so a re-run of loadMarketRates() with
        // weaker live signal can correctly recalibrate down to the static
        // tier instead of being permanently ratcheted up by a prior call
        // (Codex SHOULD round-1). pickHigher still prevents downgrading
        // analyst curation: a specialty the curator tagged 'high' stays
        // 'high' even if today's bridge ran with only 1 source.
        const baseline = STATIC_CONFIDENCE[key] ?? 'modeled'
        spec.confidence = pickHigher(baseline, computed)
        updated++
      }
    }

    return updated
  } catch {
    return 0
  }
}

// === LOAD CALIBRATION DATA PER SPECIALTY ===
// Returns feedback entries for a given specialty filtered by rateMode, plus
// aggregate stats. Legacy entries without rateMode are classified by magnitude
// (see inferLegacyRateMode + Codex C-3 / H-8).
export async function loadSpecialtyCalibration(
  specialty: string,
  rateMode: RateMode = 'hourly',
): Promise<SpecialtyCalibration> {
  const empty: SpecialtyCalibration = {
    entries: [], avgAccuracy: 0, avgDelta: 0, sampleSize: 0, adjustment: 1.0,
  }

  // S7: merge Firebase + localStorage so feedback the user submitted while
  // Firebase was unreachable still teaches the calibration. Each layer is
  // resilient on its own — Firebase failure falls through to localStorage,
  // localStorage corruption falls through to firebase-only.
  //
  // Both layers run through isCalibrationEntry — Firebase children are no
  // more trusted than localStorage (a bad past write or partial sync can
  // leave nulls / partial objects in the snapshot). Without this guard, the
  // dedup .map(dedupKeyOf) below would throw on a malformed child before
  // the aggregate try/catch could catch it (Codex T11/S7 round-1 MUST).
  let firebaseEntries: CalibrationEntry[] = []
  try {
    const snap = await get(ref(getDb(), 'rate-simulator/feedback'))
    if (snap.exists()) {
      const all = snap.val() as unknown
      if (all && typeof all === 'object') {
        firebaseEntries = Object.values(all as Record<string, unknown>).filter(isCalibrationEntry)
      }
    }
  } catch {
    // Firebase unavailable — drop through; localStorage may still have data.
  }

  // localStorage backup: dedup against Firebase by (timestamp,sim,accept).
  // FeedbackSection writes both Firebase AND localStorage on the happy path,
  // so the same entry typically appears in both layers — collision on all
  // three fields is the signature of a duplicate write, not two distinct
  // legitimate entries (millisecond timestamps don't collide naturally).
  const localEntries = readLocalFeedback()
  const seen = new Set(firebaseEntries.map(dedupKeyOf))
  const localOnly = localEntries.filter(e => !seen.has(dedupKeyOf(e)))

  const allEntries = [...firebaseEntries, ...localOnly]
  if (allEntries.length === 0) return empty

  try {
    const entries = allEntries
      .filter(e => e.specialty === specialty && inferLegacyRateMode(e) === rateMode)
      .sort((a, b) => b.timestamp - a.timestamp)

    if (entries.length === 0) return empty

    // Aggregate stats
    const totalAccuracy = entries.reduce((s, e) => s + e.accuracy, 0)
    const totalDelta = entries.reduce((s, e) => s + (e.acceptedRate - e.simulatedRate), 0)
    const avgAccuracy = Math.round(totalAccuracy / entries.length)
    const avgDelta = Math.round(totalDelta / entries.length)

    // Calculate adjustment factor from recent entries (last 10)
    const recent = entries.slice(0, 10)
    const recentAvgRatio = recent.reduce((s, e) =>
      s + (e.simulatedRate > 0 ? e.acceptedRate / e.simulatedRate : 1), 0
    ) / recent.length

    // Only apply adjustment if we have enough data and the bias is consistent
    // Minimum 3 entries, and ratio must be meaningfully different from 1.0
    let adjustment = 1.0
    if (recent.length >= 3 && Math.abs(recentAvgRatio - 1.0) > 0.03) {
      // Dampen the adjustment — apply 50% of the observed bias
      adjustment = 1.0 + (recentAvgRatio - 1.0) * 0.5
      // Clamp to reasonable range
      adjustment = Math.min(Math.max(adjustment, 0.85), 1.15)
    }

    return {
      entries,
      avgAccuracy,
      avgDelta,
      sampleSize: entries.length,
      adjustment,
    }
  } catch {
    return empty
  }
}

// === APPLY CALIBRATION TO RATE ===
// Given a calculated rate and specialty calibration data, return adjusted rate
export function applyCalibration(rate: number, calibration: SpecialtyCalibration): {
  adjustedRate: number
  wasAdjusted: boolean
  adjustmentPct: number
} {
  if (calibration.sampleSize < 3 || calibration.adjustment === 1.0) {
    return { adjustedRate: rate, wasAdjusted: false, adjustmentPct: 0 }
  }

  const adjusted = Math.round(rate * calibration.adjustment)
  return {
    adjustedRate: adjusted,
    wasAdjusted: true,
    adjustmentPct: Math.round((calibration.adjustment - 1) * 100),
  }
}

// === DISPLAYED RATE (S4 — page-level calibration) ===
// One source of truth for what the user sees. RateSimulatorPage computes this
// once and threads it through RateResults, BillRateCalculator, FeedbackSection,
// and MarketContext so hero, bill, feedback baseline, and cap warning all
// agree. Closes Codex C-1 (consumer drift), C-2 (bill rounding invariant),
// and C-4 (cap warning compared to wrong rate).
export interface DisplayedRate {
  /** Rate the user actually sees — calibrated if applicable, raw otherwise. */
  payRate: number
  /** True iff calibration was strong enough to take effect (sampleSize >= 3
   *  AND adjustment !== 1.0). UI uses this to gate the "Calibrated" badge. */
  adjusted: boolean
  /** Calibration delta in percent — e.g. +5 / -8. Zero when not adjusted. */
  adjustmentPct: number
  /** The raw model value before calibration. Disclosure UI shows this so the
   *  user can see what the model said vs what calibration shifted it to. */
  rawPayRate: number
  /** Wave 2.2: True iff the engine cap bound the displayed rate. Wired from
   *  computeDisplayedRate's `opts.capped` argument. Additive optional —
   *  consumers that don't read the field are unaffected. UI consumer (cap
   *  badge) deferred to a Sisense-paired plan per ARCHITECTURE.md §1.2.E. */
  capBound?: boolean
  /** Accuracy audit 2026-06-01: true iff the researched-range ceiling clamped
   *  the DISPLAYED pay to spec.max. The engine already clamps the model, but
   *  calibration (observed feedback) runs AFTER the engine and a positive
   *  adjustment could otherwise push the displayed value back above the
   *  researched max — which would make the "bounded to researched max" UI lie.
   *  Calibration may pull DOWN freely; it may not push the displayed pay ABOVE
   *  the researched max. Set only on the hourly path (callers pass `marketMax`). */
  marketMaxApplied?: boolean
}

/** Apply calibration (if any) to a raw pay rate. Pure function — no Firebase
 *  side effects. Used by RateSimulatorPage to derive one displayed value that
 *  every consumer reads. Calibration === null bypasses cleanly (e.g. while the
 *  Firebase load is still in flight).
 *
 *  `opts.capped` is a HERO-ROW signal. After T15a MUST 4 (2026-04-29) the
 *  engine returns `payRateCapped` (hero alone) separate from the umbrella
 *  `capped` (hero OR breakdown). Callers MUST pass `payRateCapped` here —
 *  otherwise a weekday hero below the daily cap loses its positive
 *  calibration just because weekend/holiday breakdown rows hit the cap.
 *  When the hero IS at-cap, a positive calibration delta would push the
 *  displayed value past it (margin-leak via the back door); we drop the
 *  adjustment. Negative deltas still apply when capped because they keep
 *  the displayed rate at or below the cap, which is safe.
 *  See feedback_never_reveal_margin.md, Codex S4 round-6 + MUST 4 round-2. */
export function computeDisplayedRate(
  rawPayRate: number,
  calibration: SpecialtyCalibration | null,
  opts?: { capped?: boolean; marketMax?: number },
): DisplayedRate {
  // Researched-range ceiling on the DISPLAYED value (accuracy audit 2026-06-01).
  // The engine clamps the MODEL to spec.max, but calibration runs here, AFTER
  // it; a positive adjustment must not push the displayed pay above the
  // researched max (else the "bounded to researched max" disclosure lies and we
  // surface a number above the documented range). Negative calibration still
  // applies freely. `marketMax` is hourly spec.max; callers omit it on the
  // call-only path (dailyPay has no hourly researched ceiling).
  const clampToMax = (pay: number): { pay: number; applied: boolean } =>
    opts?.marketMax != null && pay > opts.marketMax
      ? { pay: opts.marketMax, applied: true }
      : { pay, applied: false }

  if (!calibration) {
    const c = clampToMax(rawPayRate)
    return { payRate: c.pay, adjusted: false, adjustmentPct: 0, rawPayRate, capBound: opts?.capped === true, marketMaxApplied: c.applied }
  }
  const r = applyCalibration(rawPayRate, calibration)
  if (opts?.capped && r.adjustedRate > rawPayRate) {
    // Cap clamp: positive calibration would breach engine cap. Drop the
    // adjustment entirely so the displayed badge doesn't lie about an uplift
    // that didn't survive. The cap warning still fires because rate.capped
    // is true and MarketContext compares displayedRate.payRate (= cap) to it.
    const c = clampToMax(rawPayRate)
    return { payRate: c.pay, adjusted: false, adjustmentPct: 0, rawPayRate, capBound: true, marketMaxApplied: c.applied }
  }
  const c = clampToMax(r.adjustedRate)
  // Report the adjustment from the FINAL displayed pay so the "+N%" badge can
  // never claim more uplift than the user actually sees. When the researched-max
  // clamp truncates a positive calibration (e.g. raw 200, +15% → 230 clamped to
  // 220), the net visible uplift is +10%, not +15%; when the clamp swallows it
  // entirely (final === raw) it reports not-adjusted. Unclamped cases keep the
  // engine's pct exactly (parity with prior behavior).
  const adjusted = c.pay !== rawPayRate
  const adjustmentPct = !adjusted
    ? 0
    : c.applied
      ? Math.round(((c.pay - rawPayRate) / rawPayRate) * 100)
      : r.adjustmentPct
  return {
    payRate: c.pay,
    adjusted,
    adjustmentPct,
    rawPayRate,
    capBound: opts?.capped === true,
    marketMaxApplied: c.applied,
  }
}

/** Bill rate from a DisplayedRate. Preserves the simulator's
 *  bill = roundUp5(pay / 0.80) invariant. NEVER scale a pre-rounded bill by
 *  an adjustment ratio — that violates the rounding contract by 0-4 dollars
 *  per row (Codex C-2). Always recompute from the displayed pay.
 *  Takes DisplayedRate (not raw number) so callers can't accidentally pass
 *  rate.payRate when displayedRate.payRate was intended (Codex S4 NIT). */
export function computeDisplayedBill(displayedRate: DisplayedRate): number {
  return roundUp5(displayedRate.payRate / 0.80)
}

/**
 * Apply a calibration ratio to a raw breakdown pay row, re-clamping to the
 * engine's daily-pay cap if one binds.
 *
 * Even when computeDisplayedRate has BLESSED a positive calibration (because
 * the hero is below cap, MUST 4 split), individual breakdown rows that were
 * already AT the daily cap pre-calibration must NOT be allowed to breach
 * that cap when multiplied. Without this clamp, a CRNA call-only assignment
 * with `capDay=2500` (cap=2000) and a +10% calibration would render
 * weekend/holiday rows as $2200 — over the cap that just clamped them.
 *
 * `payCap` is the engine's cap field (null when no rate cap binds). Result
 * is rounded to a whole dollar, matching the engine's rounding contract.
 *
 * Codex MUST 4 round-2 (2026-04-29).
 */
export function applyCalibrationToBreakdownPay(
  rawPay: number,
  ratio: number,
  payCap: number | null,
): number {
  const v = Math.round(rawPay * ratio)
  if (payCap !== null && v > payCap) return payCap
  return v
}

/**
 * Single source of truth for the per-row breakdown calibrator used by call-only
 * assignments in RateResults's Daily Rate Breakdown and BillRateCalculator's
 * markup table. Derives the calibration ratio from `displayedRate` and returns
 * a row-by-row calibrator that delegates to applyCalibrationToBreakdownPay.
 *
 * Why this exists: both call sites previously duplicated the exact same
 * 4-line pattern (ratio derivation + lambda binding the cap). A future change
 * to one would silently diverge from the other — exactly the drift risk Codex
 * T15a round-2 flagged. Centralising removes the divergence path.
 *
 * Returns the identity-with-cap-clamp closure when:
 *   - displayedRate is null/undefined (component prop is optional)
 *   - displayedRate.adjusted is false (calibration not in effect)
 *   - displayedRate.rawPayRate is not positive (defensive: rejects 0 to avoid
 *     div-by-zero, AND negative/NaN values from corrupted upstream data)
 *
 * Even on the identity path the closure routes through
 * applyCalibrationToBreakdownPay so the cap clamp still fires for an above-cap
 * raw input — matches pre-extraction behavior.
 */
export function buildBreakdownPayCalibrator(
  displayedRate: DisplayedRate | null | undefined,
  payCap: number | null,
): (rawPay: number) => number {
  const ratio =
    displayedRate && displayedRate.adjusted && displayedRate.rawPayRate > 0
      ? displayedRate.payRate / displayedRate.rawPayRate
      : 1
  return (rawPay: number) => applyCalibrationToBreakdownPay(rawPay, ratio, payCap)
}

// === GET SPECIALTY RATE WITH MARKET OVERRIDE ===
// Returns the current rate data for a specialty, preferring market data if loaded
export function getSpecialtyRate(key: string): SpecialtyRate | null {
  return SPECIALTIES[key] || null
}
