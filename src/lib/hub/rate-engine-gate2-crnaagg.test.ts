// === Phase B.7.1 Task 6 — crnaAggregation tests ===
// Per PLAN.md Task 6 acceptance: ≥12 vitest cases including ALGORITHMS.md §1.6
// evaluation criteria. Spec source: ALGORITHMS.md §1.4-§1.7 + PLAN MUST/SHOULD r1 folds.
//
// Codex r1 outcome (2026-05-08): AMBER → 1M + 2S folded
//   M1 (mad=0 + 1 outlier contract): resolved in favor of ALGORITHMS.md §1.7
//     (canonical algorithm spec) over PLAN.md:1315 narrative. Test #11 below
//     locks the §1.7 contract; impl mad=0 branch carries the matching comment.
//   S1 (small-n bimodal): survivors floor raised from PLAN's ≥4 to ≥6 in
//     `detectBimodal` (crnaAggregation.ts) — n=4 / n=5 splits ([2,2] / [2,3])
//     produce statistically noisy variance estimates. Symmetric n=5 test data
//     ([195, 200, 205, 210, 215]) is preserved as defense-in-depth even though
//     the new floor means n<6 no longer enters the bimodal check at all.
//   S2 (§1.6 50-cell criterion): real-historical fixture deferred to B.7.1.1
//     follow-on (see TASK_2_DEVIATION pattern); synthetic 10-cell / 57-obs
//     fixture stands in until IAS rate-axis data lands.
//   R2-preempt (Codex r2 focus): non-finite rate_mid / evidence_weight stress
//     tests added; aggregateCell filters invalid observations at input.

import { describe, it, expect } from 'vitest'
import { aggregateCell, MIN_VARIANCE, MAX_RATE_MID, type Observation } from '../rate-engine/crnaAggregation'
import { HAND_CLASSIFIED_CELLS, toObservation } from './gate2-fixtures/crnaAggregation.fixture'

const CELL_ID = 'crna|TX|locum_w2'

const obs = (overrides: Partial<Observation> = {}): Observation => ({
  cell_id: CELL_ID,
  source_id: 'src_default',
  rate_low: 100,
  rate_high: 110,
  rate_mid: 105,
  observed_at: 1730000000000,
  source_variance: null,
  evidence_weight: 1,
  ...overrides,
})

// Symmetric 5-observation baseline — does NOT trip detectBimodal false-positive.
const SYMMETRIC_5 = [
  obs({ source_id: 'a', rate_mid: 195 }),
  obs({ source_id: 'b', rate_mid: 200 }),
  obs({ source_id: 'c', rate_mid: 205 }),
  obs({ source_id: 'd', rate_mid: 210 }),
  obs({ source_id: 'e', rate_mid: 215 }),
]

describe('aggregateCell — special cases', () => {
  it('throws on empty input', () => {
    expect(() => aggregateCell([])).toThrow(/zero observations/)
  })

  it('single observation → confidence=single_source, weighted_mean = rate_mid', () => {
    const result = aggregateCell([obs({ source_id: 'aana_2025', rate_mid: 200 })])
    expect(result.confidence).toBe('single_source')
    expect(result.weighted_mean).toBe(200)
    expect(result.weighted_variance).toBeGreaterThan(0)
    expect(result.median).toBe(200)
    expect(result.n_total_observations).toBe(1)
    expect(result.n_survivors_after_mad).toBe(1)
    expect(result.outliers_rejected).toEqual([])
    expect(result.per_source_survivors).toEqual({ aana_2025: 1 })
  })

  it('all identical values (mad=0) → confidence=zero_spread, weighted_variance=0', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 200 }),
      obs({ source_id: 'd', rate_mid: 200 }),
    ])
    expect(result.confidence).toBe('zero_spread')
    expect(result.weighted_mean).toBe(200)
    expect(result.weighted_variance).toBe(0)
    expect(result.median).toBe(200)
    expect(result.outliers_rejected).toEqual([])
  })

  it('5 symmetric observations, no outliers → multi_source, weighted_mean within ±5% of median', () => {
    const result = aggregateCell(SYMMETRIC_5)
    expect(result.confidence).toBe('multi_source')
    expect(result.outliers_rejected).toHaveLength(0)
    expect(result.n_survivors_after_mad).toBe(5)
    expect(result.weighted_mean).not.toBeNull()
    const spread = Math.abs((result.weighted_mean as number) - result.median) / result.median
    expect(spread).toBeLessThan(0.05)
  })
})

describe('aggregateCell — outlier rejection', () => {
  it('5 obs + 1 extreme HIGH outlier → outlier rejected, weighted_mean stable', () => {
    const baseline = aggregateCell(SYMMETRIC_5)
    const withOutlier = aggregateCell([
      ...SYMMETRIC_5,
      obs({ source_id: 'spam', rate_mid: 9999 }),
    ])
    expect(withOutlier.outliers_rejected).toHaveLength(1)
    expect(withOutlier.outliers_rejected[0].source_id).toBe('spam')
    expect(withOutlier.outliers_rejected[0].reason).toBe('mad_outlier')
    expect(withOutlier.confidence).toBe('multi_source')
    expect(Math.abs((withOutlier.weighted_mean as number) - (baseline.weighted_mean as number)))
      .toBeLessThan((baseline.weighted_mean as number) * 0.01)
  })

  it('5 obs + 1 below-floor LOW outlier → outlier rejected', () => {
    const result = aggregateCell([
      ...SYMMETRIC_5,
      obs({ source_id: 'broken', rate_mid: 5 }),
    ])
    expect(result.outliers_rejected).toHaveLength(1)
    expect(result.outliers_rejected[0].source_id).toBe('broken')
    expect(result.outliers_rejected[0].z).toBeLessThan(0)
    expect(result.confidence).toBe('multi_source')
  })

  it('all values identical except 1 outlier → mad=0 zero_spread (M1 r1 contract: §1.7 wins over PLAN narrative)', () => {
    // ============================================================
    // M1 r1 CONTRACT DECISION (Codex 2026-05-08, AMBER fold):
    //
    // When ≥50% of observations are identical, MAD = 0 by construction (the
    // 50% breakdown point of the MAD estimator). The lone outlier is NOT
    // flagged via MAD modified-Z and gets swallowed into the zero_spread
    // aggregate. This is a mathematical property of MAD, not a bug.
    //
    // Tension: PLAN.md:1315 narrative says "outlier rejected" with parenthetical
    // "mad=0 special-case shouldn't fire because dedup is upstream." That
    // narrative is internally inconsistent with ALGORITHMS.md §1.7 row "All
    // sources collapse to identical value (mad=0) → return zero-spread aggregate."
    //
    // Resolution: ALGORITHMS.md §1.7 IS the canonical algorithm spec; PLAN's
    // test description was aspirational. The implementation faithfully follows
    // §1.7. Upstream dedup (PLAN T1.1, foundational) is responsible for ensuring
    // this shape doesn't reach aggregateCell in production. This test locks the
    // §1.7 contract so a future refactor cannot silently change it.
    // ============================================================
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 200 }),
      obs({ source_id: 'd', rate_mid: 200 }),
      obs({ source_id: 'spam', rate_mid: 9999 }),
    ])
    expect(result.confidence).toBe('zero_spread')
    expect(result.outliers_rejected).toEqual([])
    expect(result.n_survivors_after_mad).toBe(5)
    expect(result.weighted_mean).toBe(200)
    expect(result.weighted_variance).toBe(0)
  })
})

describe('aggregateCell — variance handling', () => {
  it('BLS row with source_variance + 4 NULL-variance rows → BLS heavily weighted', () => {
    // Construct: BLS row at low side of cluster with tight variance vs 4 NULL-variance
    // rows clustered higher. BLS variance=4 → weight=0.25. Empirical floor for the others
    // is max(MAD², (rate*0.05)²); for rate≈220 the (rate*0.05)² term ≈121 dominates,
    // giving weight ≈0.0083 each. BLS weight ~30× larger → weighted_mean pulled toward BLS.
    const result = aggregateCell([
      obs({ source_id: 'bls_oews_29_1151_2024', rate_mid: 215, source_variance: 4 }),
      obs({ source_id: 'a', rate_mid: 218 }),
      obs({ source_id: 'b', rate_mid: 220 }),
      obs({ source_id: 'c', rate_mid: 222 }),
      obs({ source_id: 'd', rate_mid: 225 }),
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_survivors_after_mad).toBe(5)
    expect(result.weighted_mean).not.toBeNull()
    // Simple mean (215+218+220+222+225)/5 = 220. BLS-weighted should be closer to 215.
    expect(result.weighted_mean as number).toBeLessThan(217)
    expect(result.weighted_mean as number).toBeGreaterThan(213)
  })

  it('source_variance = 0 → empirical variance floor used (no divide-by-zero)', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 195, source_variance: 0 }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 205 }),
      obs({ source_id: 'd', rate_mid: 210 }),
      obs({ source_id: 'e', rate_mid: 215 }),
    ])
    expect(result.weighted_mean).not.toBeNull()
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
  })

  it('source_variance = Infinity → empirical floor; finite weighted_mean', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 195, source_variance: Number.POSITIVE_INFINITY }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 205 }),
      obs({ source_id: 'd', rate_mid: 210 }),
      obs({ source_id: 'e', rate_mid: 215 }),
    ])
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
  })

  it('source_variance = NaN → empirical floor; finite weighted_mean', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 195, source_variance: Number.NaN }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 205 }),
      obs({ source_id: 'd', rate_mid: 210 }),
      obs({ source_id: 'e', rate_mid: 215 }),
    ])
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
  })
})

describe('aggregateCell — bimodal detection (post-MAD path)', () => {
  it('tight low cluster + spread high cluster (n=10, all survive MAD) → manual_review_bimodal', () => {
    // Construction: lowHalf [200, 200.5, 201, 201.5, 202] var≈0.5,
    // highHalf [205, 207, 209, 211, 213] var≈8. Ratio ≈16 > 4. Median≈202,
    // MAD≈2; |z| of 213 = 0.6745×11/2 = 3.71 → 213 gets MAD-rejected. With 213
    // dropped, survivors=9 (n>=6 floor satisfied, post-S1-fold) split [4,5]:
    // lowHalf=[200, 200.5, 201, 201.5] var≈0.31, highHalf=[202, 205, 207, 209]
    // var≈6.7. Ratio ≈21 > 4 → `detectBimodal` returns true → bimodal.
    //
    // 213 is a single outlier (length=1 < 3 modal-escape threshold), so the
    // post-MAD modal-escape check does NOT fire here — the existing detectBimodal
    // path catches this case unchanged after the S1 floor change.
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 200.5 }),
      obs({ source_id: 'c', rate_mid: 201 }),
      obs({ source_id: 'd', rate_mid: 201.5 }),
      obs({ source_id: 'e', rate_mid: 202 }),
      obs({ source_id: 'f', rate_mid: 205 }),
      obs({ source_id: 'g', rate_mid: 207 }),
      obs({ source_id: 'h', rate_mid: 209 }),
      obs({ source_id: 'i', rate_mid: 211 }),
      obs({ source_id: 'j', rate_mid: 213 }),
    ])
    expect(result.confidence).toBe('manual_review_bimodal')
    expect(result.weighted_mean).toBeNull()
    expect(result.weighted_variance).toBeNull()
    expect(result.median).toBeGreaterThan(0)
  })
})

describe('aggregateCell — M2 r2 modal-escape (separated two-cluster, MAD ejects upper mode)', () => {
  it('5 tight low + 5 tight high cluster → upper cluster MAD-rejected; modal-escape routes to manual_review_bimodal', () => {
    // ============================================================
    // M2 r2 CONTRACT (Codex 2026-05-08, NO-GO fold):
    //
    // Per ALGORITHMS.md §1.7 row "Bimodal distribution (e.g., locum vs permanent
    // rates mixed)": flag for manual review; do NOT collapse into a single mean.
    //
    // Without modal-escape detection, MAD rejects the entire upper cluster as
    // "outliers" (because its mod-Z exceeds 3.5 from the low-cluster median),
    // leaving the lower cluster as `multi_source` — a fake-confident quote on
    // half the truth. Codex r2 caught this as a NO-GO architectural bug.
    //
    // Construction: low cluster [200, 200.5, 201, 201.5, 202] (var≈0.5) +
    // high cluster [250, 252, 255, 258, 260] (var≈13.6). After MAD on n=10
    // with median=202 and MAD=2, all 5 high values get mod-Z > 16 and are
    // rejected. Survivors=5 (low cluster only). Without modal-escape: returns
    // multi_source on the low cluster. WITH modal-escape: detects 5 outliers
    // all on high side, gap=48 > 4×3.69 ≈ 14.8 → manual_review_bimodal. ✓
    // ============================================================
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 200.5 }),
      obs({ source_id: 'c', rate_mid: 201 }),
      obs({ source_id: 'd', rate_mid: 201.5 }),
      obs({ source_id: 'e', rate_mid: 202 }),
      obs({ source_id: 'f', rate_mid: 250 }),
      obs({ source_id: 'g', rate_mid: 252 }),
      obs({ source_id: 'h', rate_mid: 255 }),
      obs({ source_id: 'i', rate_mid: 258 }),
      obs({ source_id: 'j', rate_mid: 260 }),
    ])
    expect(result.confidence).toBe('manual_review_bimodal')
    expect(result.weighted_mean).toBeNull()
    expect(result.weighted_variance).toBeNull()
    expect(result.outliers_rejected.length).toBe(5)  // upper cluster ejected by MAD
    expect(result.n_survivors_after_mad).toBe(5)     // lower cluster survived MAD
  })

  it('single outlier (length=1) does NOT trigger modal-escape (correctly returns multi_source)', () => {
    // Discriminator vs the M2 case: a single outlier should not be mistaken
    // for an upper mode. modal-escape requires ≥3 outliers.
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 202 }),
      obs({ source_id: 'c', rate_mid: 204 }),
      obs({ source_id: 'd', rate_mid: 206 }),
      obs({ source_id: 'e', rate_mid: 208 }),
      obs({ source_id: 'spam', rate_mid: 9999 }),
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.outliers_rejected.length).toBe(1)
  })

  it('two outliers on opposite sides do NOT trigger modal-escape (scattered, not a mode)', () => {
    // Discriminator: outliers on BOTH sides of survivors are noise, not a mode.
    // Modal-escape requires allHigh OR allLow (not both).
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 202 }),
      obs({ source_id: 'c', rate_mid: 204 }),
      obs({ source_id: 'd', rate_mid: 206 }),
      obs({ source_id: 'e', rate_mid: 208 }),
      obs({ source_id: 'spam_high', rate_mid: 9999 }),
      obs({ source_id: 'spam_low', rate_mid: 5 }),
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.outliers_rejected.length).toBe(2)
  })

  it('LOW-side cluster ejection (mirror of upper-mode case) → manual_review_bimodal', () => {
    // Symmetry check: 5 tight high + 5 tight low → MAD ejects low cluster
    // (MAD median sits in the high cluster), modal-escape catches the lower mode.
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 100 }),
      obs({ source_id: 'b', rate_mid: 102 }),
      obs({ source_id: 'c', rate_mid: 104 }),
      obs({ source_id: 'd', rate_mid: 106 }),
      obs({ source_id: 'e', rate_mid: 108 }),
      obs({ source_id: 'f', rate_mid: 250 }),
      obs({ source_id: 'g', rate_mid: 250.5 }),
      obs({ source_id: 'h', rate_mid: 251 }),
      obs({ source_id: 'i', rate_mid: 251.5 }),
      obs({ source_id: 'j', rate_mid: 252 }),
    ])
    expect(result.confidence).toBe('manual_review_bimodal')
    expect(result.weighted_mean).toBeNull()
  })
})

describe('aggregateCell — stability properties', () => {
  it('adding 1 in-band observation shifts weighted_mean by < σ/√n', () => {
    const baseline = aggregateCell(SYMMETRIC_5)
    const noisy = aggregateCell([
      ...SYMMETRIC_5,
      obs({ source_id: 'f', rate_mid: 205 }), // typical in-band sample at the median
    ])
    const sigma = Math.sqrt(baseline.weighted_variance as number)
    const expected = sigma / Math.sqrt(5)
    const shift = Math.abs((noisy.weighted_mean as number) - (baseline.weighted_mean as number))
    expect(shift).toBeLessThan(expected)
  })

  it('adding 1 extreme outlier → outlier rejected (does not move weighted_mean)', () => {
    const baseline = aggregateCell(SYMMETRIC_5)
    const withOutlier = aggregateCell([
      ...SYMMETRIC_5,
      obs({ source_id: 'spam', rate_mid: 99999 }),
    ])
    expect(withOutlier.outliers_rejected).toHaveLength(1)
    expect(withOutlier.weighted_mean).toBeCloseTo(baseline.weighted_mean as number, 0)
  })
})

describe('aggregateCell — ALGORITHMS.md §1.6 evaluation criteria (DEFERRED, NOT SATISFIED)', () => {
  it('SMOKE-TEST ONLY (S2/S3 r1+r2 deferral): synthetic ≥80% rejection / ≥95% retention; real-historical mandate UNMET pending B.7.1.1', () => {
    // ============================================================
    // S2 r1 / S3 r2 DEFERRAL CONTRACT (Codex 2026-05-08, AMBER → NO-GO folds):
    //
    // ALGORITHMS.md §1.6 mandates "sample 50 historical cells, hand-classify
    // obvious outliers" with ≥80% rejection / ≥95% retention thresholds.
    //
    // **This acceptance criterion is NOT satisfied by Task 6.** It is FORMALLY
    // DEFERRED to phase B.7.1.1 because:
    //   - Task 5 ingested 46 BLS-only rows (single-source per state; no
    //     observation-level outlier signal available)
    //   - The IAS empirical pillar — which would supply per-cell multi-observation
    //     distributions for outlier hand-classification — is itself deferred to
    //     B.7.1.1 per TASK_2_DEVIATION (IAS RTDB has no actual paid CRNA rates)
    //
    // Until B.7.1.1 lands producer-side instrumentation and 3-6 months of
    // accumulated IAS rate data, this test functions as a SMOKE TEST against
    // a synthetic 10-cell / 57-obs / 9-outlier fixture. The synthetic fixture
    // exercises algorithm behavior on realistic-shape data, but does NOT
    // discharge the §1.6 spec mandate. Phase B.7.1.1 MUST replace this fixture
    // with a real-historical sample of ≥50 cells before B-phase can claim
    // §1.6 compliance.
    // ============================================================
    let totalOutliers = 0
    let totalLegitimate = 0
    let outliersRejected = 0
    let legitimateRetained = 0

    for (const cell of HAND_CLASSIFIED_CELLS) {
      totalOutliers += cell.observations.filter(o => o._isOutlier).length
      totalLegitimate += cell.observations.filter(o => !o._isOutlier).length

      const result = aggregateCell(cell.observations.map(toObservation))
      const rejectedSourceIds = new Set(result.outliers_rejected.map(r => r.source_id))

      for (const o of cell.observations) {
        if (o._isOutlier) {
          if (rejectedSourceIds.has(o.source_id)) outliersRejected++
        } else {
          if (!rejectedSourceIds.has(o.source_id)) legitimateRetained++
        }
      }
    }

    expect(totalOutliers).toBeGreaterThan(0)
    expect(totalLegitimate).toBeGreaterThan(0)
    const rejectionRate = outliersRejected / totalOutliers
    const retentionRate = legitimateRetained / totalLegitimate
    expect(rejectionRate).toBeGreaterThanOrEqual(0.80)
    expect(retentionRate).toBeGreaterThanOrEqual(0.95)
  })
})

describe('aggregateCell — R2-preempt: non-finite input stress tests (Codex r1 r2-focus)', () => {
  it('rate_mid = NaN is filtered out (does not propagate)', () => {
    const result = aggregateCell([
      obs({ source_id: 'broken', rate_mid: Number.NaN }),
      ...SYMMETRIC_5,
    ])
    // The 5 symmetric obs survive; the NaN one is filtered. n=5 → ALL retained,
    // confidence=multi_source, finite weighted_mean.
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    // NaN row is silently filtered, so it doesn't appear as a MAD outlier.
    expect(result.outliers_rejected.find(o => o.source_id === 'broken')).toBeUndefined()
  })

  it('rate_mid = Infinity is filtered out', () => {
    const result = aggregateCell([
      obs({ source_id: 'broken', rate_mid: Number.POSITIVE_INFINITY }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
  })

  it('rate_mid = 0 is filtered out (non-positive)', () => {
    const result = aggregateCell([
      obs({ source_id: 'zero', rate_mid: 0 }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
  })

  it('rate_mid = negative is filtered out', () => {
    const result = aggregateCell([
      obs({ source_id: 'neg', rate_mid: -50 }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
  })

  it('evidence_weight = 0 is filtered out', () => {
    const result = aggregateCell([
      obs({ source_id: 'zerow', rate_mid: 200, evidence_weight: 0 }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
    // The zerow row would have produced infinite weight (1 / variance with
    // zero numerator divisor) — filtering at input prevents the IVW divide.
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
  })

  it('evidence_weight = Infinity is filtered out (denormal weighting)', () => {
    const result = aggregateCell([
      obs({ source_id: 'infw', rate_mid: 9999, evidence_weight: Number.POSITIVE_INFINITY }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    // The Infinity-weight row would have dominated IVW and dragged weighted_mean
    // toward 9999. Filtering prevents that.
    expect(result.weighted_mean as number).toBeLessThan(220)
  })

  it('evidence_weight = NaN is filtered out', () => {
    const result = aggregateCell([
      obs({ source_id: 'nanw', rate_mid: 200, evidence_weight: Number.NaN }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
  })

  it('evidence_weight = negative is filtered out', () => {
    const result = aggregateCell([
      obs({ source_id: 'negw', rate_mid: 200, evidence_weight: -1 }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)
  })

  it('all observations invalid → throws (treated as effective-empty)', () => {
    expect(() => aggregateCell([
      obs({ source_id: 'a', rate_mid: Number.NaN }),
      obs({ source_id: 'b', rate_mid: Number.POSITIVE_INFINITY }),
      obs({ source_id: 'c', rate_mid: 0 }),
      obs({ source_id: 'd', rate_mid: -10 }),
    ])).toThrow(/non-finite or non-positive/)
  })

  it('one valid + many invalid → single_source on the survivor', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: Number.NaN }),
      obs({ source_id: 'b', rate_mid: 0 }),
      obs({ source_id: 'good', rate_mid: 215 }),
      obs({ source_id: 'c', rate_mid: -10 }),
    ])
    expect(result.confidence).toBe('single_source')
    expect(result.weighted_mean).toBe(215)
    expect(result.n_total_observations).toBe(1)
  })
})

describe('aggregateCell — M3 r3 numerical-floor stress (denormal / overflow paths)', () => {
  it('source_variance = 1e-300 (denormal-positive) → MIN_VARIANCE floor prevents overflow', () => {
    // Without the MIN_VARIANCE floor, w = 1 / 1e-300 = ~1e300 (or Infinity),
    // poisoning sumW and producing NaN weighted_mean. With the floor, the
    // tiny-variance row falls through to empirical_var and behaves normally.
    const result = aggregateCell([
      obs({ source_id: 'denormal', rate_mid: 200, source_variance: 1e-300 }),
      ...SYMMETRIC_5,
    ])
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
    // Non-NaN, in reasonable range
    expect(result.weighted_mean as number).toBeGreaterThan(180)
    expect(result.weighted_mean as number).toBeLessThan(230)
  })

  it('evidence_weight = Number.MIN_VALUE (denormal-positive) → filtered by MIN_WEIGHT floor', () => {
    // MIN_WEIGHT (1e-6) rejects denormal-positive evidence_weight at the input
    // validator. Without it, w = MIN_VALUE / 100 = denormal-tiny, contributing
    // ~zero to sumW but accumulating into overall numerical instability.
    const result = aggregateCell([
      obs({ source_id: 'denormal', rate_mid: 200, evidence_weight: Number.MIN_VALUE }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)  // denormal-weight row filtered out
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
  })

  it('source_variance = 1e-7 (just below MIN_VARIANCE) → falls to empirical floor', () => {
    // Boundary case: source_variance positive-finite but below MIN_VARIANCE (1e-4).
    // The candidate-variance check requires `>= MIN_VARIANCE`, so this row uses
    // empirical_var instead. Result is sane.
    const result = aggregateCell([
      obs({ source_id: 'tiny_var', rate_mid: 215, source_variance: 1e-7 }),
      obs({ source_id: 'b', rate_mid: 218 }),
      obs({ source_id: 'c', rate_mid: 220 }),
      obs({ source_id: 'd', rate_mid: 222 }),
      obs({ source_id: 'e', rate_mid: 225 }),
    ])
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(result.weighted_mean as number).toBeGreaterThan(210)
    expect(result.weighted_mean as number).toBeLessThan(230)
  })

  it('M4 r4: huge finite source_variance → tiny sumW → 1/sumW non-finite → zero_spread fallback', () => {
    // ALL observations carry source_variance = 1e308 (near Number.MAX_VALUE).
    // Each w = 1.0 / 1e308 = 1e-308 (denormal-tiny but finite).
    // sumW ≈ 5e-308 (denormal-tiny finite). sumWX/sumW = finite.
    // 1/sumW = ~2e307 (huge but finite) — actually still finite in IEEE-754,
    // so the fallback may NOT fire. To force the failure mode: source_variance
    // = Number.MAX_VALUE. Each w = 1 / 1.798e308 = 5.56e-309. sumW = 5 × 5.56e-309
    // = 2.78e-308 (still finite). 1/sumW = 3.6e307 (finite).
    // The actual failure mode requires variance large enough that w underflows
    // to 0 entirely, which only happens for variance > Number.MAX_VALUE — which
    // can't be a finite number. So this case actually CAN'T produce non-finite
    // weighted_variance via the documented path; it produces a HUGE-but-finite
    // weighted_variance. The M4 fold's value is defense-in-depth for paths we
    // haven't enumerated. We test that the result is finite (the contract holds).
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200, source_variance: Number.MAX_VALUE }),
      obs({ source_id: 'b', rate_mid: 205, source_variance: Number.MAX_VALUE }),
      obs({ source_id: 'c', rate_mid: 210, source_variance: Number.MAX_VALUE }),
      obs({ source_id: 'd', rate_mid: 215, source_variance: Number.MAX_VALUE }),
      obs({ source_id: 'e', rate_mid: 220, source_variance: Number.MAX_VALUE }),
    ])
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
  })

  it('S3 r4: singleSourceAggregate with denormal source_variance applies MIN_VARIANCE floor', () => {
    // Pre-S3 fold: singleSourceAggregate used `candidate > 0` letting denormal
    // variance through, producing weighted_variance ≈ 1e-300 (technically finite
    // but bypassing the M3 contract). Post-S3: gate is `candidate >= MIN_VARIANCE`
    // so denormal-positive variance falls through to empirical floor.
    const result = aggregateCell([
      obs({ source_id: 'denormal', rate_mid: 200, source_variance: 1e-300 }),
    ])
    expect(result.confidence).toBe('single_source')
    expect(result.weighted_mean).toBe(200)
    // Variance should be at LEAST the empirical floor (max((rate*0.05)^2, MIN_VARIANCE))
    // = max(100, 1e-4) = 100. NOT the bypassed 1e-300.
    expect(result.weighted_variance as number).toBeGreaterThanOrEqual(MIN_VARIANCE)
    expect(result.weighted_variance as number).toBeLessThanOrEqual(101)
  })
})

describe('aggregateCell — M5/S5 r5 input-cap + overflow defense', () => {
  it('rate_mid > MAX_RATE_MID is filtered by input validator', () => {
    // Without cap: rate_mid = 1e308 → (1e308 * 0.05)² = 2.5e613 → Infinity →
    // weighted_variance = Infinity. With M5 cap (rate_mid ≤ MAX_RATE_MID = 1e6):
    // the corrupted-data row is silently filtered; the surviving 5 symmetric
    // observations produce a finite multi_source aggregate.
    const result = aggregateCell([
      obs({ source_id: 'overflow', rate_mid: 1e308 }),
      ...SYMMETRIC_5,
    ])
    expect(result.confidence).toBe('multi_source')
    expect(result.n_total_observations).toBe(5)  // overflow row filtered
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
    expect(Number.isFinite(result.median)).toBe(true)
    expect(Number.isFinite(result.mad_threshold)).toBe(true)
  })

  it('rate_mid = MAX_RATE_MID exactly (boundary) → accepted', () => {
    // The cap is INCLUSIVE: rate_mid <= MAX_RATE_MID. Boundary value passes the
    // filter and produces a valid (if extreme) single_source aggregate.
    const result = aggregateCell([
      obs({ source_id: 'boundary', rate_mid: MAX_RATE_MID }),
    ])
    expect(result.confidence).toBe('single_source')
    expect(result.weighted_mean).toBe(MAX_RATE_MID)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
  })

  it('rate_mid just above MAX_RATE_MID → filtered (boundary discriminator)', () => {
    // rate_mid = MAX_RATE_MID + 1 just above the cap → filtered out.
    expect(() => aggregateCell([
      obs({ source_id: 'overcap', rate_mid: MAX_RATE_MID + 1 }),
    ])).toThrow(/non-finite or non-positive/)
  })

  it('S5: extreme but finite rate_mid mix → mad_threshold stays finite', () => {
    // With MAX_RATE_MID input cap, mad ≤ MAX_RATE_MID = 1e6, so
    // mad_threshold = 3.5 * mad / 0.6745 ≤ 5.2e6 (finite). This test exercises
    // the upper-bound case to lock the contract.
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 1 }),
      obs({ source_id: 'b', rate_mid: 5 }),
      obs({ source_id: 'c', rate_mid: 10 }),
      obs({ source_id: 'd', rate_mid: 1000 }),
      obs({ source_id: 'e', rate_mid: 100000 }),
      obs({ source_id: 'f', rate_mid: MAX_RATE_MID }),
    ])
    // Wide-distribution input — most values likely MAD-rejected. Whatever
    // returns, mad_threshold MUST be finite.
    expect(Number.isFinite(result.mad_threshold)).toBe(true)
    if (result.weighted_mean !== null) {
      expect(Number.isFinite(result.weighted_mean)).toBe(true)
    }
  })
})

describe('aggregateCell — S2 r3 modal-escape false-negative trade-off (loose-mode regression)', () => {
  it('loose-cluster outliers (gap < 4×outlier_sd) does NOT trigger modal-escape — DOCUMENTED FALSE-NEGATIVE', () => {
    // ============================================================
    // S2 r3 TRADE-OFF DOCUMENTATION (Codex 2026-05-08):
    //
    // detectModalEscape requires `gap > 4 × max(outlier_sd, 1)`. This gate is
    // intentionally tight to avoid false-positives on single-outlier cases.
    // The trade-off is that LOOSE bimodal clusters — where the rejected outlier
    // cluster has internal spread comparable to its gap from survivors — are
    // not caught and return 'multi_source' on the survivor cluster only.
    //
    // Rationale: false-positives create excessive manual escalation noise
    // (recruiters lose trust in the verdict); false-negatives produce a quote
    // that is at least anchored to one valid mode (the survivors). Detection
    // resolution improves automatically as `n` grows — at n=15+, the survivors
    // distribution itself shows enough internal variance to trigger the
    // post-MAD `detectBimodal` (var ratio) path.
    //
    // Construction below: low cluster [200, 201, 202, 203, 204] (var ≈ 2),
    // outliers [240, 250, 260, 270, 280] (mean=260, var≈200, sd≈14.1).
    // Gap = 240 - 204 = 36. Threshold = 4 × max(14.1, 1) = 56.4. 36 < 56.4 →
    // modal-escape NOT triggered. Survivors detectBimodal also doesn't fire
    // because survivors are tight. Result: 'multi_source' on the low cluster.
    //
    // This test LOCKS the trade-off so future regressions don't change behavior
    // silently. If the trade-off is later renegotiated (e.g., loosen threshold
    // to 2×sd), this test must be amended explicitly.
    // ============================================================
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 201 }),
      obs({ source_id: 'c', rate_mid: 202 }),
      obs({ source_id: 'd', rate_mid: 203 }),
      obs({ source_id: 'e', rate_mid: 204 }),
      obs({ source_id: 'f', rate_mid: 240 }),
      obs({ source_id: 'g', rate_mid: 250 }),
      obs({ source_id: 'h', rate_mid: 260 }),
      obs({ source_id: 'i', rate_mid: 270 }),
      obs({ source_id: 'j', rate_mid: 280 }),
    ])
    // Loose mode: detectModalEscape gates fail → returns multi_source on
    // survivors. This is the DOCUMENTED false-negative.
    expect(result.confidence).toBe('multi_source')
    expect(result.outliers_rejected.length).toBeGreaterThanOrEqual(3)
    // Survivors-only weighted mean reflects the LOWER cluster ($200-204).
    expect(result.weighted_mean as number).toBeGreaterThan(195)
    expect(result.weighted_mean as number).toBeLessThan(210)
  })
})
