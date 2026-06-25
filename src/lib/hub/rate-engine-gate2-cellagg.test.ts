// === Phase 3 (A.3) Plan 03-03 Task 2 — cellAggregation scraped-distribution risk matrix ===
// AGG-04 statistics-correctness coverage (D-41 5th Codex lens / SC4 false-positive guard).
//
// WHY THIS FILE EXISTS (distinct from crnaAggregation.test.ts):
//   crnaAggregation.test.ts (39 cases, GREEN through the re-export shim) proves ZERO MATH
//   DRIFT during the D-33 extraction — but it was tuned on BLS-survey shapes (dense, n≥dozens,
//   real source_variance). The bridge (03-02) feeds aggregateCell SCRAPED distributions that
//   differ structurally (RESEARCH §3 / Pitfall 5): many n=1 / n=2 cells, frequent zero-spread
//   (multiple sources quoting the same round number), and heavy-tailed stale-page reads — all
//   with `source_variance: null` (the empirical-variance floor path does all the work).
//   crnaAggregation green is NECESSARY but NOT SUFFICIENT (03-VALIDATION SC4): this file proves
//   the SAME math survives the scraped shapes — finite posteriors, no throws, correct routing.
//
// SCRAPED-INPUT CONVENTION: cell_id is a free-form bridge label like
// "emergency medicine|national|advertised_clinician_pay" (aggregateCell is specialty-agnostic);
// source_variance is null on every scraped row (only BLS rows expose variance), forcing the
// empirical-variance floor `max(mad², (rate_mid*0.05)², MIN_VARIANCE)` — the branch the
// generalization relies on (03-PATTERNS "empirical-variance floor", lines 53-60).
//
// §1.7 PRESERVATION (ALGORITHMS.md §1.7, crnaAggregation.ts header lines 8-19): a lone outlier
// mixed with ≥50% identical values is SWALLOWED into the zero_spread aggregate, NOT rejected —
// a property of MAD's 50% breakdown point, not a bug. The dedicated `it` below asserts the
// swallow to LOCK it against a future "fix" (threat T-03.03-04).

import { describe, it, expect } from 'vitest'
import { aggregateCell, MIN_VARIANCE, MAX_RATE_MID, type Observation } from '../rate-engine/cellAggregation'

// Bridge-style scraped cell label (free-form; aggregateCell never branches on it).
const SCRAPED_CELL = 'emergency medicine|national|scraped_article_estimate'

// obs() factory mirroring the analog's (crnaAggregation.test.ts:26) but with the
// SCRAPED convention: source_variance: null so the empirical-floor path is exercised.
const obs = (overrides: Partial<Observation> = {}): Observation => ({
  cell_id: SCRAPED_CELL,
  source_id: 'scraped_default',
  rate_low: 100,
  rate_high: 110,
  rate_mid: 105,
  observed_at: 1730000000000,
  source_variance: null, // scraped rows never expose variance → empirical floor
  evidence_weight: 1,
  ...overrides,
})

describe('cellAggregation — scraped-distribution risk matrix (RESEARCH §3)', () => {
  // ── n=1 ────────────────────────────────────────────────────────────────────
  // Live evidence: `internal medicine national scraped_article_estimate` (n=1).
  it('n=1 scraped cell → single_source, weighted_mean = rate_mid, finite variance, no throw', () => {
    let result!: ReturnType<typeof aggregateCell>
    expect(() => {
      result = aggregateCell([obs({ source_id: 'serpapi_google', rate_mid: 215 })])
    }).not.toThrow()
    expect(result.confidence).toBe('single_source')
    expect(result.weighted_mean).toBe(215)
    // Codex r1 (c) non-vacuity lock: a scraped n=1 row has source_variance=null, so the
    // EMPIRICAL floor path runs: variance = max((rate_mid*0.05)^2, MIN_VARIANCE)
    // = max((215*0.05)^2, 1e-4) = max(115.5625, 1e-4) = 115.5625. Asserting the EXACT value
    // proves the null-variance empirical-floor branch fired (not the source_variance branch,
    // not just ">= MIN_VARIANCE" which would be vacuous).
    expect(result.weighted_variance).not.toBeNull()
    expect(result.weighted_variance as number).toBeCloseTo((215 * 0.05) ** 2, 10)
    expect(result.weighted_variance as number).toBeGreaterThanOrEqual(MIN_VARIANCE)
    expect(result.median).toBe(215)
    expect(result.n_survivors_after_mad).toBe(1)
    expect(result.outliers_rejected).toEqual([])
  })

  // ── n=2 ────────────────────────────────────────────────────────────────────
  // Live evidence: `internal medicine - cardiology national advertised_clinician_pay` (n=2).
  // With n=2 + distinct values, the MAD of [0, diff] is 0 (lower-element median), so the
  // cell resolves to zero_spread — and the bimodal detector NEVER fires (n<6 floor).
  it('n=2 scraped cell → zero_spread (bimodal NOT fired, n<6 floor), finite posterior', () => {
    let result!: ReturnType<typeof aggregateCell>
    expect(() => {
      result = aggregateCell([
        obs({ source_id: 'exa_semantic', rate_mid: 200 }),
        obs({ source_id: 'serpapi_google', rate_mid: 240 }),
      ])
    }).not.toThrow()
    // n=2 distinct → mad===0 → zeroSpreadAggregate (NOT manual_review_bimodal).
    expect(result.confidence).toBe('zero_spread')
    expect(['multi_source', 'zero_spread']).toContain(result.confidence) // RESEARCH §3 allowed set
    expect(result.confidence).not.toBe('manual_review_bimodal')
    expect(result.weighted_mean).not.toBeNull()
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
  })

  // ── zero-spread (≥50% identical) ─────────────────────────────────────────────
  // Live evidence: multiple scraped sources quoting the same round number.
  it('zero-spread ≥50% identical → mad===0 → zero_spread, weighted_variance===0, weighted_mean===median', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 200 }),
      obs({ source_id: 'd', rate_mid: 220 }),
    ])
    expect(result.confidence).toBe('zero_spread')
    expect(result.weighted_variance).toBe(0)
    expect(result.weighted_mean).toBe(result.median)
    expect(result.median).toBe(200)
  })

  // ── heavy-tail outlier ───────────────────────────────────────────────────────
  // Live evidence: a stale page reading ~2× the cluster.
  it('heavy-tail outlier (one obs ~2× cluster) → rejected as mad_outlier (|z|>3.5), finite posterior', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 205 }),
      obs({ source_id: 'c', rate_mid: 210 }),
      obs({ source_id: 'd', rate_mid: 215 }),
      obs({ source_id: 'e', rate_mid: 220 }),
      obs({ source_id: 'stale_page', rate_mid: 430 }), // ~2× the cluster
    ])
    // The single heavy-tail outlier is MAD-rejected; survivors form a finite multi_source posterior.
    // (A single outlier does NOT trigger modal-escape — that requires ≥3 one-sided outliers.)
    const rejectedIds = result.outliers_rejected.map(o => o.source_id)
    expect(rejectedIds).toContain('stale_page')
    expect(result.confidence).toBe('multi_source')
    expect(Number.isFinite(result.weighted_mean as number)).toBe(true)
    expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
  })

  // ── heavy-tail as a separated mode (modal-escape) ────────────────────────────
  // When the heavy tail is a TIGHT one-sided cluster (≥3 obs) rather than a lone reading,
  // modal-escape flags the cell bimodal — the bridge must route this to "insufficient data".
  it('heavy-tail one-sided tight cluster (≥3 outliers) → manual_review_bimodal via modal-escape', () => {
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
  })

  // ── all-rejected / pathological ──────────────────────────────────────────────
  // RESEARCH §3 "all-rejected pathological → falls through to zeroSpreadAggregate(median)".
  // NOTE: the literal `survivors.length === 0` branch is effectively UNREACHABLE through
  // standard MAD math (the median observation always has |z|=0, so it never rejects itself).
  // The production-reachable pathological scraped shape is a heavily-clustered cell with a
  // wide tail; the contract that MATTERS for the bridge is: no throw + finite output on every
  // pathological case. We assert that here on a wide 3-obs scraped cell.
  it('pathological wide-spread scraped cell → no throw, finite output (zeroSpread/multi fallthrough)', () => {
    let result!: ReturnType<typeof aggregateCell>
    expect(() => {
      result = aggregateCell([
        obs({ source_id: 'a', rate_mid: 100 }),
        obs({ source_id: 'b', rate_mid: 300 }),
        obs({ source_id: 'c', rate_mid: 500 }),
      ])
    }).not.toThrow()
    expect(Number.isFinite(result.median)).toBe(true)
    expect(Number.isFinite(result.mad_threshold)).toBe(true)
    if (result.weighted_mean !== null) {
      expect(Number.isFinite(result.weighted_mean)).toBe(true)
      expect(Number.isFinite(result.weighted_variance as number)).toBe(true)
    }
  })

  // ── genuinely bimodal (defense-in-depth) ─────────────────────────────────────
  // AGG-02's rate_type split SHOULD prevent locum-vs-perm leaking into one bucket, but
  // aggregateCell defends regardless: n≥6 with var_high > 4×var_low → manual_review_bimodal
  // AND weighted_mean === null. The bridge MUST route null → "insufficient data" rung,
  // NEVER render a number (threat T-03.03-03). Construction reused from the proven
  // crnaAggregation.test.ts n=10 bimodal case (tight low + spread high).
  it('genuinely bimodal (n≥6, var_high>4×var_low) → manual_review_bimodal, weighted_mean===null', () => {
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
    expect(result.weighted_mean).toBeNull() // bridge routes null → insufficient-data rung
    expect(result.weighted_variance).toBeNull()
    expect(result.median).toBeGreaterThan(0)
  })
})

describe('cellAggregation — sparse two-cluster below the bimodal floor (LOCKED false-negative)', () => {
  // Codex r2 (c) coverage caveat: the bridge (03-02) can feed a sparse "2 low + 2 high"
  // (n=4) scraped cell. Such a cell does NOT route to manual_review_bimodal because the two
  // guards both have minimum-population floors: `detectBimodal` requires survivors ≥6 (S1 r1
  // fold — n=4/n=5 splits are statistically noisy) and `detectModalEscape` requires ≥3
  // one-sided outliers (a 2-outlier pair is scatter, not a mode). With median in the low
  // cluster, MAD rejects the 2 high values, leaving a multi_source posterior on the LOW mode.
  //
  // This is an INTENTIONAL false-negative (same trade-off the regression suite's "S2 r3
  // modal-escape false-negative" case locks): at small n, false-positives create excessive
  // manual-escalation noise; resolution improves as n grows. AGG-02's rate_type split is the
  // first line of defense against locum-vs-perm leakage; this lock documents the residual.
  // Locked here so a future change to the n≥6 / ≥3-outlier floors surfaces explicitly.
  it('n=4 "2 low + 2 high" → multi_source on the LOW mode (NOT manual_review_bimodal — floors not met)', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 202 }),
      obs({ source_id: 'c', rate_mid: 300 }),
      obs({ source_id: 'd', rate_mid: 302 }),
    ])
    expect(result.confidence).toBe('multi_source') // NOT manual_review_bimodal — floors not met
    expect(result.weighted_mean).not.toBeNull()
    expect(result.outliers_rejected).toHaveLength(2) // the 2 high values MAD-rejected
    expect(result.n_survivors_after_mad).toBe(2)     // 2 low survivors anchor the posterior
    // Posterior anchors to the LOW mode (~201), NOT a midpoint of the two clusters.
    expect(result.weighted_mean as number).toBeGreaterThan(195)
    expect(result.weighted_mean as number).toBeLessThan(210)
  })
})

describe('cellAggregation — §1.7 MAD 50%-breakdown swallow (LOCKED property, do NOT "fix")', () => {
  // ALGORITHMS.md §1.7 + crnaAggregation.ts header lines 8-19: a lone outlier mixed with
  // ≥50% identical values is SWALLOWED into the zero_spread aggregate (NOT rejected). This is
  // a mathematical property of MAD's 50% breakdown point. Upstream dedup is responsible for
  // ensuring this shape doesn't reach aggregateCell in production. This `it` LOCKS the swallow
  // so a future refactor cannot silently "fix" it into rejecting the outlier (threat T-03.03-04).
  it('lone outlier + ≥50% identical → SWALLOWED into zero_spread (NOT rejected)', () => {
    const result = aggregateCell([
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 200 }),
      obs({ source_id: 'c', rate_mid: 200 }),
      obs({ source_id: 'spam', rate_mid: 9999 }), // lone outlier — SWALLOWED, not rejected
    ])
    expect(result.confidence).toBe('zero_spread')
    expect(result.outliers_rejected).toEqual([]) // the lone outlier is NOT rejected (the locked property)
    expect(result.n_survivors_after_mad).toBe(4) // all 4 obs "survive" into the zero_spread aggregate
    expect(result.weighted_mean).toBe(200)
    expect(result.weighted_variance).toBe(0)
  })
})

describe('cellAggregation — scraped input-validation hardening (finite/no-throw contract)', () => {
  // The bridge feeds aggregateCell rows that survived DATA-03 but may still carry corrupt
  // values. These cases confirm the extracted module's input guards behave identically on
  // scraped inputs (the same R2-preempt / M5 cap folds the regression suite proves for BLS).
  it('empty scraped cell → throws (bridge must never call with zero observations)', () => {
    expect(() => aggregateCell([])).toThrow(/zero observations/)
  })

  it('rate_mid above MAX_RATE_MID (corrupt scrape) → filtered; surviving rows produce finite posterior', () => {
    const result = aggregateCell([
      obs({ source_id: 'corrupt', rate_mid: MAX_RATE_MID + 1 }),
      obs({ source_id: 'a', rate_mid: 200 }),
      obs({ source_id: 'b', rate_mid: 205 }),
      obs({ source_id: 'c', rate_mid: 210 }),
    ])
    // The corrupt row is filtered at input; the 3 valid scraped rows aggregate finitely.
    expect(result.n_total_observations).toBe(3)
    expect(Number.isFinite(result.median)).toBe(true)
    if (result.weighted_mean !== null) {
      expect(Number.isFinite(result.weighted_mean)).toBe(true)
    }
  })
})
