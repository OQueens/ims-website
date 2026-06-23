// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// === Phase B.7.1 — MAD outlier rejection + IVW aggregation ===
// Pure function per ALGORITHMS.md §1 (lines 100-162 verbatim).
// No framework imports. Consumed by crnaCellLookup.ts (Task 7).
//
// Phase 3 (A.3, AGG-04, D-33) — EXTRACTED VERBATIM from crnaAggregation.ts into this
// shared module so BOTH the bridge (scripts/data-refresh/) and the CRNA path
// (crnaCellLookup.ts) consume ONE implementation — no copy-paste fork. The math,
// comments, and Codex r1–r5 fold history below are byte-identical to the original
// crnaAggregation.ts body (ZERO math change is the locked D-33 invariant, proven by
// crnaAggregation.test.ts staying green through the re-export shim). crnaAggregation.ts
// is now `export * from './cellAggregation'`. The cell label `cell_id` is a free-form
// string (e.g. "crna|TX|locum_1099" for the CRNA path, or "emergency medicine|national|
// advertised_clinician_pay" for the bridge) — the function is specialty-agnostic.
//
// Spec source: docs/rate-simulator/audit-2026-05-05/ALGORITHMS.md §1
// PLAN source : docs/rate-simulator/phases/B.7.1-competitive-crna-rates/PLAN.md Task 6
//
// Special cases (per ALGORITHMS.md §1.7 + PLAN MUST/SHOULD r1 folds):
//   - empty obs              → throw
//   - n=1                    → confidence='single_source'
//   - mad=0 (≥50% identical) → confidence='zero_spread', weighted_variance=0
//     (per §1.7 row "All sources collapse to identical value (mad=0) ... return
//     zero-spread aggregate"). M1 r1 decision (Codex 2026-05-08): a lone outlier
//     mixed with ≥50% identical values is SWALLOWED into the zero_spread aggregate,
//     not rejected — this is a property of MAD's 50% breakdown point, not a bug.
//     PLAN.md:1315's narrative ("outlier rejected; mad=0 ... shouldn't fire because
//     dedup is upstream") is internally inconsistent with §1.7; we resolve in favor
//     of §1.7 because §1.7 is the canonical algorithm spec. Upstream dedup is
//     responsible for ensuring this shape doesn't reach aggregateCell in production.
//   - all rejected as outliers → fall through to zero_spread on the median
//   - bimodal (var_high > 4 × var_low across split halves) → confidence='manual_review_bimodal'
//     AND weighted_mean === null AND weighted_variance === null per MUST-3 r1
//     (consumers route to MANUAL-ESCALATION; do NOT collapse a bimodal cell).
//     S1 r1 deviation (Codex 2026-05-08): survivors floor raised from PLAN's ≥4 to ≥6
//     because n=4 / n=5 splits ([2,2] / [2,3]) produce statistically noisy variance
//     estimates that yield false positives on otherwise-normal symmetric data
//     (verified empirically: [195,198,202,205,210] triggers varHigh=10.9 / varLow=2.25,
//     ratio 4.84 > 4). The minimum statistically-meaningful split is [3,3] at n=6.
//   - bimodal-mode-escape (M2 r2 fold, Codex 2026-05-08): MAD's 50% breakdown can
//     wholly eject one mode of a bimodal distribution as "outliers" before
//     `detectBimodal` sees the survivors — leaving the other mode as 'multi_source'
//     when the cell is genuinely bimodal. `detectModalEscape` catches this by
//     checking if rejected outliers form a tight one-sided cluster (≥3 outliers,
//     all on same side, gap > 4 × outlier sd). Either bimodal signal routes to
//     manual_review_bimodal.
//   - source_variance ≤ 0 / NaN / Infinity → fall through to empirical variance floor
//     per SHOULD-4 r1; never produces divide-by-zero or non-finite weighted_mean.
//   - rate_mid / evidence_weight non-finite or non-positive → R2-preempt fold
//     (Codex 2026-05-08): observations are filtered out before processing to prevent
//     NaN/Infinity propagation through median / MAD / IVW math. If all observations
//     fail validation, aggregateCell throws (treated as effective empty input).
//   - denormal/tiny source_variance or evidence_weight (M3 r3 fold, Codex 2026-05-08):
//     numerical floors MIN_VARIANCE (1e-4) and MIN_WEIGHT (1e-6) prevent overflow of
//     IVW weight w = evidence_weight / variance to Infinity / underflow to 0. Plus
//     per-iteration `Number.isFinite(w) && w > 0` skip and post-loop `sumW` sanity
//     check with zero_spread fallback when the math degenerates despite all guards.
//   - huge finite source_variance (M4 r4 fold, Codex 2026-05-08): even with sumW + sumWX
//     individually finite, an extremely large variance can yield sumW finite-but-tiny,
//     making weighted_variance = 1 / sumW non-finite (Infinity). Final-value validation
//     before return; fallback to zero_spread if weighted_mean OR weighted_variance is
//     non-finite. Also, singleSourceAggregate now applies MIN_VARIANCE consistent with
//     the IVW path (S3 r4 fold).
//   - huge rate_mid (M5 r5 fold, Codex 2026-05-08): MAX_RATE_MID = 1e6 input cap kills
//     all (rate_mid * 0.05)² and mad×mad overflow paths at source. Defense-in-depth:
//     singleSourceAggregate validates final variance is finite + falls back to
//     MIN_VARIANCE if not; mad_threshold is finite-checked before bimodal/multi_source
//     return + falls back to zero_spread if not (S5 r5 fold).

export interface Observation {
  cell_id: string                     // e.g. "crna|TX|locum_1099"
  source_id: string                   // e.g. 'aana_2025' | 'ias_internal_2026' | 'bls_oews_29_1151_2024' | 'oncall_2025'
  rate_low: number
  rate_high: number
  rate_mid: number                    // (rate_low + rate_high) / 2
  observed_at: number                 // ms epoch
  source_variance: number | null      // BLS rows expose this; others NULL → empirical
  evidence_weight: number             // post-dedup; usually 1.0 unless multi-day-confirmed
}

export interface OutlierRejection {
  source_id: string
  rate_mid: number
  reason: 'mad_outlier'
  z: number
}

export type AggregateConfidence =
  | 'multi_source'
  | 'single_source'
  | 'zero_spread'
  | 'manual_review_bimodal'

export interface CellAggregate {
  cell_id: string
  n_total_observations: number
  n_after_dedup: number               // = n_total_observations for now (dedup is upstream)
  n_survivors_after_mad: number
  // MUST-3 r1 fix: weighted_mean is NULL when bimodal (ALGORITHMS.md §1.7 says manual review,
  // do NOT collapse). Quote-time consumers must check confidence before using weighted_mean.
  weighted_mean: number | null
  weighted_variance: number | null
  median: number
  mad_threshold: number               // computed cutoff (3.5/0.6745 × MAD)
  outliers_rejected: OutlierRejection[]
  per_source_survivors: Record<string, number>
  confidence: AggregateConfidence
  computed_at: number
}

// M3 r3 fold (Codex 2026-05-08): denormal numerical floors. Without these:
//   - source_variance ≤ MIN_VARIANCE ⇒ w = evidence_weight / variance overflows to Infinity
//     ⇒ sumW = Infinity ⇒ sumWX/sumW = NaN
//   - evidence_weight ≤ MIN_WEIGHT (denormal positive) ⇒ w underflows to 0 ⇒ no contribution
//     to sumW, but in extreme combinations produces non-finite weighted_mean.
// MIN_VARIANCE corresponds to sd ≈ $0.01 (impossible for any real CRNA rate distribution).
// MIN_WEIGHT is dimensionless; production weights are 1.0 typical, multi-day-confirmed up to ~3.0.
// Hoisted to top of module so all helpers reference a single source of truth (S3 r4 fold).
// Exported for boundary-condition tests.
export const MIN_VARIANCE = 1e-4
export const MIN_WEIGHT = 1e-6
// M5 r5 fold (Codex 2026-05-08): rate_mid upper cap to prevent overflow paths.
// (rate_mid * 0.05)² overflows to Infinity when rate_mid ≥ ~3.4e154; mad×mad
// overflows for mad ≥ same. Real CRNA hourly rates are bounded by economics:
// even premium-locum cardiac anesthesia caps near $700/hr and any value above
// $1M/hr is corrupted data, not a legitimate observation. Filtering at input
// kills the overflow class entirely; downstream math is unconditionally finite.
export const MAX_RATE_MID = 1e6

function quickselect(arr: number[], p: number): number {
  if (arr.length === 0) return NaN
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.max(0, Math.min(Math.ceil(p * sorted.length) - 1, sorted.length - 1))
  return sorted[idx]
}

function countBySource(obs: Observation[]): Record<string, number> {
  return obs.reduce((acc, o) => {
    acc[o.source_id] = (acc[o.source_id] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
}

function zeroSpreadAggregate(median: number, obs: Observation[]): CellAggregate {
  return {
    cell_id: obs[0].cell_id,
    n_total_observations: obs.length,
    n_after_dedup: obs.length,
    n_survivors_after_mad: obs.length,
    weighted_mean: median,
    weighted_variance: 0,
    median,
    mad_threshold: 0,
    outliers_rejected: [],
    per_source_survivors: countBySource(obs),
    confidence: 'zero_spread',
    computed_at: Date.now(),
  }
}

function singleSourceAggregate(obs: Observation[]): CellAggregate {
  const o = obs[0]
  // SHOULD-4 r1 fix + S3 r4 fold (Codex 2026-05-08): guard against source_variance
  // ≤ 0 / non-finite AND apply the MIN_VARIANCE floor consistent with the IVW path.
  // Previously this branch used `candidate > 0` which let denormal-tiny variance
  // through, bypassing the M3 r3 contract.
  const candidate = o.source_variance
  let variance = (candidate !== null && Number.isFinite(candidate) && candidate >= MIN_VARIANCE)
    ? candidate
    : Math.max((o.rate_mid * 0.05) ** 2, MIN_VARIANCE)
  // M5 r5 fold defense-in-depth (Codex 2026-05-08): even with the MAX_RATE_MID
  // input cap, an unfiltered call site (e.g., a future internal helper that
  // bypasses isValidObservation) could pass rate_mid that overflows (rate*0.05)².
  // Force finite — fall back to MIN_VARIANCE if computed variance is non-finite.
  if (!Number.isFinite(variance) || variance <= 0) {
    variance = MIN_VARIANCE
  }
  return {
    cell_id: o.cell_id,
    n_total_observations: 1,
    n_after_dedup: 1,
    n_survivors_after_mad: 1,
    weighted_mean: o.rate_mid,
    weighted_variance: variance,
    median: o.rate_mid,
    mad_threshold: 0,
    outliers_rejected: [],
    per_source_survivors: { [o.source_id]: 1 },
    confidence: 'single_source',
    computed_at: Date.now(),
  }
}

function detectBimodal(survivors: Observation[]): boolean {
  // Per ALGORITHMS.md §1.7: if var_high > 4 × var_low for the two halves
  // (locum vs perm rates mixed in one cell), flag for manual review.
  //
  // S1 r1 deviation (Codex 2026-05-08): floor raised from PLAN's ≥4 to ≥6.
  // Splits [2,2] (n=4) and [2,3] (n=5) produce statistically noisy variance
  // estimates that false-positive on otherwise-normal symmetric data. n=6
  // splits [3,3] which is the smallest meaningful split. PLAN's ≥4 floor was
  // pre-empirically chosen; raising to ≥6 reflects observed behavior on real
  // small-cell distributions. See test docstring at crnaAggregation.test.ts
  // for the empirical false-positive case ([195,198,202,205,210]).
  if (survivors.length < 6) return false
  const sorted = [...survivors].sort((a, b) => a.rate_mid - b.rate_mid)
  const half = Math.floor(sorted.length / 2)
  const lowHalf = sorted.slice(0, half).map(o => o.rate_mid)
  const highHalf = sorted.slice(half).map(o => o.rate_mid)
  const meanLow = lowHalf.reduce((a, b) => a + b, 0) / lowHalf.length
  const meanHigh = highHalf.reduce((a, b) => a + b, 0) / highHalf.length
  const varLow = lowHalf.reduce((a, b) => a + (b - meanLow) ** 2, 0) / lowHalf.length
  const varHigh = highHalf.reduce((a, b) => a + (b - meanHigh) ** 2, 0) / highHalf.length
  return varLow > 0 && varHigh > 4 * varLow
}

/** M2 r2 fold (Codex 2026-05-08): post-MAD secondary bimodal-mode escape detection.
 *  MAD's 50% breakdown point lets a coherent upper-mode cluster get ejected as
 *  "outliers" before `detectBimodal` ever sees survivors — leaving the lower mode
 *  as 'multi_source' when the cell is genuinely bimodal (locum-vs-perm mix).
 *
 *  This check examines whether rejected outliers form a tight cluster on one side
 *  of the survivors, indicating a separated mode rather than scattered noise.
 *  Triggers iff:
 *    1. ≥3 outliers (pair or single = noise, not a mode)
 *    2. ALL outliers on the same side (allHigh OR allLow); scatter = noise
 *    3. Outlier-cluster MAD is small relative to gap from survivors
 *       (gap > 4 × max(outlier_sd, 1)) — i.e., the cluster is tight, the gap is wide
 *
 *  When triggered, the caller routes to manual_review_bimodal exactly as
 *  `detectBimodal` does. Single outliers + 2-outlier scatters fall through
 *  unchanged (returning multi_source as expected). */
function detectModalEscape(
  survivors: Observation[],
  outliers: OutlierRejection[],
): boolean {
  if (outliers.length < 3) return false
  if (survivors.length === 0) return false

  const outlierRates = outliers.map(o => o.rate_mid)
  const survivorRates = survivors.map(s => s.rate_mid)
  const minOutlier = Math.min(...outlierRates)
  const maxOutlier = Math.max(...outlierRates)
  const minSurvivor = Math.min(...survivorRates)
  const maxSurvivor = Math.max(...survivorRates)

  const allHigh = minOutlier > maxSurvivor
  const allLow = maxOutlier < minSurvivor
  if (!allHigh && !allLow) return false

  const outlierMedian = quickselect(outlierRates, 0.5)
  const outlierMad = quickselect(
    outlierRates.map(r => Math.abs(r - outlierMedian)),
    0.5,
  )
  const gap = allHigh ? minOutlier - maxSurvivor : minSurvivor - maxOutlier

  // sd ≈ MAD × 1.4826 (Iglewicz-Hoaglin scale). Require gap > 4× max(sd, 1)
  // so genuine separated clusters trigger but extreme single-outliers don't
  // accidentally inflate via a coincidental small intra-cluster MAD.
  return gap > 4 * Math.max(outlierMad * 1.4826, 1)
}

/** R2-preempt fold (Codex r1) + M3 r3 floor + M5 r5 cap (Codex 2026-05-08):
 *  non-finite, denormal, OR overflow-producing rate_mid / evidence_weight would
 *  propagate NaN/Infinity through median / MAD / IVW math and emit non-finite
 *  results. Filter at input.
 *
 *  - rate_mid in (0, MAX_RATE_MID]: positive-finite + bounded so (rate_mid*0.05)²
 *    and mad×mad cannot overflow. MAX_RATE_MID is generous ($1M/hr) — any value
 *    above is corrupted data, not a legitimate locum-rate observation.
 *  - evidence_weight in [MIN_WEIGHT, ∞): finite + above the denormal-tiny floor
 *    so w = evidence_weight / variance has well-defined IEEE-754 magnitude.
 *
 *  Production observations arriving here are post-dedup from a typed scrape
 *  pipeline that SHOULD have validated, but defensive filtering catches upstream
 *  regressions. */
function isValidObservation(o: Observation): boolean {
  return (
    Number.isFinite(o.rate_mid) && o.rate_mid > 0 && o.rate_mid <= MAX_RATE_MID &&
    Number.isFinite(o.evidence_weight) && o.evidence_weight >= MIN_WEIGHT
  )
}

export function aggregateCell(obs: Observation[]): CellAggregate {
  if (obs.length === 0) {
    throw new Error('aggregateCell called with zero observations')
  }
  // R2-preempt fold: filter non-finite/non-positive rate_mid + evidence_weight
  // before any math runs. If every observation is invalid, treat as effective-empty.
  const validObs = obs.filter(isValidObservation)
  if (validObs.length === 0) {
    throw new Error('aggregateCell: all observations have non-finite or non-positive rate_mid / evidence_weight')
  }
  if (validObs.length === 1) return singleSourceAggregate(validObs)
  // From here on, work with validObs. n_total_observations on the result reflects
  // the post-validation count; if upstream callers need a pre-filter count for
  // telemetry they should track that themselves.
  const obsForAgg = validObs

  const values = obsForAgg.map(o => o.rate_mid)
  const median = quickselect(values, 0.5)
  const deviations = values.map(v => Math.abs(v - median))
  const mad = quickselect(deviations, 0.5)

  if (mad === 0) {
    return zeroSpreadAggregate(median, obsForAgg)
  }

  const survivors: Observation[] = []
  const outliers: OutlierRejection[] = []
  for (const o of obsForAgg) {
    const z = 0.6745 * (o.rate_mid - median) / mad
    if (Math.abs(z) > 3.5) {
      outliers.push({ source_id: o.source_id, rate_mid: o.rate_mid, reason: 'mad_outlier', z })
    } else {
      survivors.push(o)
    }
  }

  if (survivors.length === 0) {
    // Pathological: every observation was rejected. Return median-only aggregate.
    return zeroSpreadAggregate(median, obsForAgg)
  }

  // IVW per ALGORITHMS.md §1.4 step 6.
  // SHOULD-4 r1 fix: guard against source_variance ≤ 0 / NaN / Infinity from upstream.
  // M3 r3 fold (Codex 2026-05-08): apply MIN_VARIANCE floor to prevent denormal-positive
  // source_variance from overflowing the IVW weight, AND skip any iteration where the
  // computed weight is non-finite as defense-in-depth, AND fall back to zero_spread on
  // the median if sumW collapses to 0/Infinity/NaN despite all guards.
  let sumW = 0
  let sumWX = 0
  for (const s of survivors) {
    const empiricalVar = Math.max(mad * mad, (s.rate_mid * 0.05) ** 2, MIN_VARIANCE)
    const candidate = s.source_variance
    const variance = (candidate !== null && Number.isFinite(candidate) && candidate >= MIN_VARIANCE)
      ? candidate
      : empiricalVar
    const w = s.evidence_weight / variance
    if (!Number.isFinite(w) || w <= 0) continue
    sumW += w
    sumWX += w * s.rate_mid
  }
  // Post-loop sanity: even with floors + per-iteration guards, sumW could be 0
  // (all observations skipped) or non-finite from accumulator overflow on extreme
  // input mixtures. Fall back to zero_spread on the median when math degrades.
  if (!Number.isFinite(sumW) || sumW <= 0 || !Number.isFinite(sumWX)) {
    return zeroSpreadAggregate(median, obsForAgg)
  }

  // M4 r4 fold (Codex 2026-05-08): even when sumW + sumWX are individually finite,
  // huge finite source_variance can produce sumW that is finite-but-tiny — making
  // weighted_variance = 1 / sumW non-finite (Infinity). Validate FINAL values
  // before return; fallback to zero_spread when either is non-finite.
  const finalWeightedMean = sumWX / sumW
  const finalWeightedVariance = 1 / sumW
  if (!Number.isFinite(finalWeightedMean) || !Number.isFinite(finalWeightedVariance)) {
    return zeroSpreadAggregate(median, obsForAgg)
  }

  // S5 r5 fold (Codex 2026-05-08): mad_threshold = 3.5 * mad / 0.6745; for huge
  // mad (only reachable if MAX_RATE_MID input cap is bypassed) this can overflow.
  // Defense-in-depth: validate finite. With current MAX_RATE_MID=1e6, mad_threshold
  // ≤ 5.2e6 — finite — so this guard is hot only under future regression.
  const finalMadThreshold = 3.5 * mad / 0.6745
  if (!Number.isFinite(finalMadThreshold)) {
    return zeroSpreadAggregate(median, obsForAgg)
  }

  const bimodal = detectBimodal(survivors)
  // M2 r2 fold: post-MAD modal-escape catches bimodal cells whose upper/lower mode
  // was wholly ejected by MAD. Either bimodal flag routes to manual_review_bimodal.
  const modalEscape = detectModalEscape(survivors, outliers)

  // MUST-3 r1: bimodal cells must NOT be collapsed into a single weighted_mean per
  // ALGORITHMS.md §1.7. Return null weighted_mean + manual_review_bimodal flag so quote-time
  // consumers (getCrnaCellEnvelope) can route to MANUAL-ESCALATION tier.
  if (bimodal || modalEscape) {
    return {
      cell_id: obsForAgg[0].cell_id,
      n_total_observations: obsForAgg.length,
      n_after_dedup: obsForAgg.length,
      n_survivors_after_mad: survivors.length,
      weighted_mean: null,
      weighted_variance: null,
      median,
      mad_threshold: finalMadThreshold,
      outliers_rejected: outliers,
      per_source_survivors: countBySource(survivors),
      confidence: 'manual_review_bimodal',
      computed_at: Date.now(),
    }
  }

  return {
    cell_id: obsForAgg[0].cell_id,
    n_total_observations: obsForAgg.length,
    n_after_dedup: obsForAgg.length,
    n_survivors_after_mad: survivors.length,
    weighted_mean: finalWeightedMean,
    weighted_variance: finalWeightedVariance,
    median,
    mad_threshold: finalMadThreshold,
    outliers_rejected: outliers,
    per_source_survivors: countBySource(survivors),
    confidence: 'multi_source',
    computed_at: Date.now(),
  }
}
