// =============================================================================
// marketBucketsOverlay.test.ts — DIRECT unit coverage for applyMarketBucketsOverlay
// (Move #1, the trust-ladder quote anchor). Ported from the reference suite so the
// PURE overlay's defensive branches are pinned here, not only reached indirectly
// through sim-live.test.ts (which exercises the wired loadMarketBucketRates path).
//
// applyMarketBucketsOverlay mutates SPECIALTIES[key] in place: for a cell whose
// D-39 primary is a MARKET-TYPED rate (actual_paid_locum / advertised_clinician_pay)
// that clears the corroboration gate (n_distinct>=4 integer, >=2 non-blank families,
// finite positive weighted_mean), it sets p70 = round(weighted_mean) and re-levels
// the displayed band from the FROZEN static curated range. Everything else stays on
// the audited curated prior.
//
// Branches covered: O1 promote · fractional round · O2 thin (n<4) · O3 single-family
// · O3b blank/dup families · O3c non-integer n · O3d scraped-indirect · O3e crowd ·
// O3f aggregator_estimate · O4 non-primary tier · O5 bimodal null-mean · O6 band
// containment (in-range keeps the audited ceiling; hot anchor >= ceiling rescales the
// researched geometry so premiums survive; low anchor drops the floor) · O7 options ·
// O8 idempotent · O9 absent key · O10 confidence ceilings · O12 default set.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  MarketBucketData,
  SpecialtyBuckets,
  MarketBucketsResult,
  CoverageTier,
} from '../marketRates'

// The overlay under test is PURE (no RTDB read), but importing ../marketRates pulls
// in firebase/database at module load — mock it so the import resolves without a real
// firebase. The wired read (loadMarketBucketRates) is covered in sim-live.test.ts.
vi.mock('firebase/database', () => ({ ref: vi.fn(), get: vi.fn() }))

import { applyMarketBucketsOverlay, DEFAULT_ANCHORABLE_RATE_TYPES, isFreshBucket } from '../marketRates'
import { SPECIALTIES, STATIC_SPECIALTY_RANGES } from '../specialties'

// A market-typed (anchorable) rate type for the promote cases.
const MKT = 'advertised_clinician_pay'

function bucket(overrides: Partial<MarketBucketData> = {}): MarketBucketData {
  return {
    weighted_mean: 260,
    weighted_variance: 0,
    median: 260,
    confidence: 'zero_spread',
    n_distinct: 4,
    n_raw: 6,
    source_families: ['serpapi', 'exa'],
    family_capped: false,
    lastUpdated: Date.now(),
    ...overrides,
  } as MarketBucketData
}

function cell(
  primaryRateType: string | null,
  data: MarketBucketData | null,
  coverageTier: CoverageTier = 'primary',
): SpecialtyBuckets {
  const buckets: Record<string, MarketBucketData> = {}
  if (primaryRateType && data) buckets[primaryRateType] = data
  return {
    primary: primaryRateType && data ? { rateType: primaryRateType, data } : null,
    coverageTier,
    unclassified: null,
    buckets,
  } as SpecialtyBuckets
}

function result(specialties: Record<string, SpecialtyBuckets>): MarketBucketsResult {
  return { specialties, fellBackToLegacy: false }
}

// SPECIALTIES is a mutated singleton — snapshot every key these tests touch and
// restore after each so cross-test state never leaks (mirrors sim-live.test.ts).
const TOUCHED = ['radiology', 'psychiatry', 'hospitalist', 'anesthesiology', 'urology']
let orig: Record<string, Record<string, unknown>> = {}
beforeEach(() => {
  orig = {}
  for (const k of TOUCHED) orig[k] = { ...(SPECIALTIES[k] as unknown as Record<string, unknown>) }
})
afterEach(() => {
  for (const k of TOUCHED) {
    Object.assign(SPECIALTIES[k], orig[k])
    if (!('provenance' in orig[k])) delete (SPECIALTIES[k] as unknown as Record<string, unknown>).provenance
  }
})

describe('applyMarketBucketsOverlay — promote (O1)', () => {
  it('sets p70 to round(weighted_mean), band from the static curated range, provenance live, confidence high', () => {
    const sr = STATIC_SPECIALTY_RANGES['radiology']
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 260, median: 260 })) }),
    )
    expect(n).toBe(1)
    expect(SPECIALTIES.radiology.p70).toBe(260)
    // Anchor 260 sits INSIDE the researched band → floor stays curated, ceiling stays
    // the audited max (the researched-range clamp invariant is unchanged).
    expect(SPECIALTIES.radiology.min).toBe(Math.min(sr.min, 260))
    expect(SPECIALTIES.radiology.max).toBe(sr.max)
    expect(SPECIALTIES.radiology.provenance).toBe('live')
    expect(SPECIALTIES.radiology.confidence).toBe('high')
  })

  it('rounds a fractional weighted_mean', () => {
    applyMarketBucketsOverlay(
      result({ psychiatry: cell(MKT, bucket({ weighted_mean: 184.6, median: 185, source_families: ['exa', 'serpapi'] })) }),
    )
    expect(SPECIALTIES.psychiatry.p70).toBe(185)
  })
})

describe('applyMarketBucketsOverlay — gates', () => {
  it('O2: does NOT promote a thin primary (n_distinct < 4)', () => {
    const before = { ...SPECIALTIES.anesthesiology }
    const n = applyMarketBucketsOverlay(
      result({ anesthesiology: cell(MKT, bucket({ n_distinct: 2, weighted_mean: 280, median: 280 })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.anesthesiology.p70).toBe(before.p70)
    expect(SPECIALTIES.anesthesiology.max).toBe(before.max)
  })

  it('O3: does NOT promote with < 2 independent source families', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: ['exa'] })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O3b: blank/duplicate family entries do not count toward corroboration', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      // ['exa','','exa'] → 1 distinct non-blank family → below the floor of 2.
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: ['exa', '', 'exa'] })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O3b2: whitespace/case variants of ONE family collapse (no corroboration faking)', () => {
    // Codex review: [' exa ', 'EXA', 'exa'] is ONE family, not three — the Set
    // normalizes (trim + lowercase) so a whitespace/case variant of a single source
    // can't fake the >=2-family gate and anchor a single-source cell.
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: [' exa ', 'EXA', 'exa'] })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O3c: does NOT promote when n_distinct is non-integer (corrupted node)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 4.5 })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O3d: does NOT promote an INDIRECT rate type (scraped article) even at n>=4 + 2 families', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell('scraped_article_estimate', bucket({ n_distinct: 9, weighted_mean: 260, median: 260 })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
    expect(SPECIALTIES.radiology.provenance).toBe(before.provenance)
  })

  it('O3e: does NOT promote a crowd_survey primary (also priors-only)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell('crowd_survey', bucket({ n_distinct: 8, weighted_mean: 260, median: 260 })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O3f: does NOT promote an aggregator_estimate primary even at n>=4 + 2 families (WS1)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell('aggregator_estimate', bucket({ n_distinct: 9, weighted_mean: 260, median: 260 })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
    expect(DEFAULT_ANCHORABLE_RATE_TYPES.has('aggregator_estimate')).toBe(false)
  })

  it('O4: does NOT promote when coverageTier is not "primary"', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(null, null, 'insufficient_data') }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O5: does NOT promote a bimodal/null-mean primary even if median is finite', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({
        radiology: cell(MKT, bucket({
          weighted_mean: null as unknown as number, median: 250, confidence: 'manual_review_bimodal', n_distinct: 6,
        })),
      }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })
})

describe('applyMarketBucketsOverlay — band containment (O6)', () => {
  it('HOT anchor at/above the curated max rescales the researched geometry (ceiling stays ABOVE p70 — premiums survive)', () => {
    const sr = STATIC_SPECIALTY_RANGES['radiology'] // {185, p70 287, 330}
    const anchor = 360 // > curated max 330
    applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: anchor, median: anchor })) }),
    )
    expect(SPECIALTIES.radiology.p70).toBe(anchor)
    // NOT collapsed onto the anchor (that flattened premiums); rescaled from max/p70.
    const expectedMax = Math.round(anchor * (sr.max / sr.p70))
    expect(SPECIALTIES.radiology.max).toBe(expectedMax)
    expect(SPECIALTIES.radiology.max).toBeGreaterThan(SPECIALTIES.radiology.p70)
    expect(SPECIALTIES.radiology.min).toBe(sr.min)
  })

  it('drops the floor to contain an anchor below the static floor (ceiling stays the audited max)', () => {
    const sr = STATIC_SPECIALTY_RANGES['radiology'] // min 185, max 330
    applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 150, median: 150 })) }),
    )
    expect(SPECIALTIES.radiology.p70).toBe(150)
    expect(SPECIALTIES.radiology.min).toBe(150)
    expect(SPECIALTIES.radiology.max).toBe(sr.max)
  })
})

describe('applyMarketBucketsOverlay — options (O7)', () => {
  it('honors a relaxed minDistinct so a 2-obs market-typed cell promotes', () => {
    const n = applyMarketBucketsOverlay(
      result({ anesthesiology: cell(MKT, bucket({ n_distinct: 2, weighted_mean: 280, median: 280, source_families: ['exa', 'serpapi'] })) }),
      { minDistinct: 2 },
    )
    expect(n).toBe(1)
    expect(SPECIALTIES.anesthesiology.p70).toBe(280)
  })

  it('honors a stricter minFamilies so a 2-family cell is rejected', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket()) }),
      { minFamilies: 3 },
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('honors a widened anchorableRateTypes so a scraped cell can be force-anchored', () => {
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell('scraped_article_estimate', bucket({ weighted_mean: 260, median: 260 })) }),
      { anchorableRateTypes: new Set(['scraped_article_estimate']) },
    )
    expect(n).toBe(1)
    expect(SPECIALTIES.radiology.p70).toBe(260)
  })
})

describe('applyMarketBucketsOverlay — robustness', () => {
  it('O8: is idempotent', () => {
    const r = result({ radiology: cell(MKT, bucket({ weighted_mean: 360, median: 360 })) }) // hot anchor exercises the rescale path
    applyMarketBucketsOverlay(r)
    const after1 = { ...SPECIALTIES.radiology }
    applyMarketBucketsOverlay(r)
    expect({ ...SPECIALTIES.radiology }).toEqual(after1)
  })

  it('O9: skips a specialty key absent from SPECIALTIES (no throw)', () => {
    const n = applyMarketBucketsOverlay(
      result({ 'not-a-real-specialty': cell(MKT, bucket()) }),
    )
    expect(n).toBe(0)
  })

  it('O10: an INDIRECT type force-anchored reads "medium"; never overstated as high', () => {
    applyMarketBucketsOverlay(
      result({ psychiatry: cell('scraped_article_estimate', bucket({ weighted_mean: 185, median: 185, source_families: ['exa', 'serpapi'] })) }),
      { anchorableRateTypes: new Set(['scraped_article_estimate']) },
    )
    expect(SPECIALTIES.psychiatry.confidence).toBe('medium')
  })

  it('O10b: a market-typed bucket (advertised_clinician_pay) reads "high"', () => {
    applyMarketBucketsOverlay(
      result({ urology: cell(MKT, bucket({ weighted_mean: 300, median: 300, source_families: ['exa', 'serpapi'] })) }),
    )
    expect(SPECIALTIES.urology.confidence).toBe('high')
  })

  it('O12: DEFAULT_ANCHORABLE_RATE_TYPES is exactly the two market-typed rates', () => {
    expect([...DEFAULT_ANCHORABLE_RATE_TYPES].sort()).toEqual(['actual_paid_locum', 'advertised_clinician_pay'])
  })
})

// =============================================================================
// TIER 0 (2026-07-10 accuracy audit — Claude+Sol) — promotion ROBUSTNESS gates.
// These make promotion STRICTER only (never looser), so they are quote-neutral on
// today's (dark) overlay but are the prerequisite that makes un-darking via the
// WS1 fleet SAFE: a wrong/gamed/implausible posterior must NOT move a real quote.
//   O13/O14  plausibility band  — anchor implausibly far from the researched range
//                                 (C9 upper / Sol-N4 lower) keeps the audited prior.
//   O15      sentinel families  — 'unknown'/'unattributed' are NOT independent
//                                 corroboration (C11).
//   O16      confidence gate    — a bridge-labeled single_source bucket cannot
//                                 anchor even if its family array looks corroborated
//                                 (Sol-N5, corrupt/contradictory node).
// =============================================================================
describe('applyMarketBucketsOverlay — Tier 0 promotion robustness', () => {
  it('O13: does NOT promote an anchor implausibly far ABOVE the researched max (C9)', () => {
    const before = { ...SPECIALTIES.radiology } // curated max ~330
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 900, median: 900, confidence: 'multi_source' })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
    expect(SPECIALTIES.radiology.provenance).toBe(before.provenance)
  })

  it('O14: does NOT promote an anchor implausibly far BELOW the researched min (Sol-N4)', () => {
    const before = { ...SPECIALTIES.radiology } // curated min ~185
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 50, median: 50, confidence: 'multi_source' })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O13b: STILL promotes a hot-but-plausible anchor inside the plausibility band', () => {
    // 400 is above the curated max (~330) but within 1.5x — legitimate hot market,
    // must still anchor (the bound rejects only the implausible tail).
    applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 400, median: 400, confidence: 'multi_source' })) }),
    )
    expect(SPECIALTIES.radiology.p70).toBe(400)
    expect(SPECIALTIES.radiology.provenance).toBe('live')
  })

  it('O13c: honors a configurable maxAnchorFactor (opts)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 400, median: 400, confidence: 'multi_source' })) }),
      { maxAnchorFactor: 1.1 }, // 400 > 1.1*330 = 363 → rejected under a tighter bound
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O15: does NOT count "unattributed" as an independent family (C11)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: ['amn', 'unattributed'], confidence: 'multi_source' })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O15b: does NOT count "unknown" as an independent family (C11)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: ['amn', 'UNKNOWN '], confidence: 'multi_source' })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O16: does NOT promote a bucket the bridge labeled single_source (Sol-N5)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: ['amn', 'exa'], confidence: 'single_source' })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  // Codex gate (2026-07-10): a corrupted manual_review_bimodal node with a FINITE
  // mean must NOT anchor — deny-listing only single_source left this hole. The gate
  // is an ALLOW-list of the two corroborated tiers (multi_source, zero_spread).
  it('O16b: does NOT promote a finite-mean manual_review_bimodal bucket (Codex gate)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 5, source_families: ['amn', 'exa'], confidence: 'manual_review_bimodal', weighted_mean: 260, median: 260 })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O16c: promotes multi_source AND zero_spread explicitly (allow-list positive controls)', () => {
    applyMarketBucketsOverlay(result({ radiology: cell(MKT, bucket({ confidence: 'multi_source', weighted_mean: 300, median: 300 })) }))
    expect(SPECIALTIES.radiology.p70).toBe(300)
    applyMarketBucketsOverlay(result({ urology: cell(MKT, bucket({ confidence: 'zero_spread', weighted_mean: 300, median: 300 })) }))
    expect(SPECIALTIES.urology.p70).toBe(300)
  })

  it('O13d: an invalid maxAnchorFactor (NaN) does NOT fail open — the default bound still rejects an implausible anchor (Codex gate)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 900, median: 900, confidence: 'multi_source' })) }),
      { maxAnchorFactor: NaN },
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O14b: an invalid minAnchorFactor (0) does NOT fail open — the default lower bound still rejects a below-band anchor (Codex gate)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 50, median: 50, confidence: 'multi_source' })) }),
      { minAnchorFactor: 0 },
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O14c: a configurable (valid) minAnchorFactor tightens the lower bound', () => {
    const before = { ...SPECIALTIES.radiology } // min ~185
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 170, median: 170, confidence: 'multi_source' })) }),
      { minAnchorFactor: 0.95 }, // 170 < 0.95*185 = 175.75 → rejected
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O15c: two REAL families plus a sentinel STILL promotes (sentinel ignored, not disqualifying)', () => {
    applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 6, source_families: ['amn', 'exa', 'unattributed'], confidence: 'multi_source', weighted_mean: 300, median: 300 })) }),
    )
    expect(SPECIALTIES.radiology.p70).toBe(300)
  })

  it('O15d: an all-sentinel family array does NOT promote', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ n_distinct: 6, source_families: ['unknown', 'unattributed'], confidence: 'multi_source' })) }),
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  // Codex R2: factor validation must enforce SEMANTIC bounds, not just finite+positive.
  it('O13e: an absurd maxAnchorFactor (MAX_VALUE) does NOT overflow the gate open (Codex R2)', () => {
    const before = { ...SPECIALTIES.radiology }
    const n = applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 900, median: 900, confidence: 'multi_source' })) }),
      { maxAnchorFactor: Number.MAX_VALUE }, // overflow → must fall back to default 1.5, still reject 900
    )
    expect(n).toBe(0)
    expect(SPECIALTIES.radiology.p70).toBe(before.p70)
  })

  it('O13f: a backwards maxAnchorFactor (<1) falls back to default, NOT rejecting an in-band anchor (Codex R2)', () => {
    applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 300, median: 300, confidence: 'multi_source' })) }),
      { maxAnchorFactor: 0.5 }, // < 1 is invalid → default 1.5 → 300 is in-band → promotes
    )
    expect(SPECIALTIES.radiology.p70).toBe(300)
    expect(SPECIALTIES.radiology.provenance).toBe('live')
  })

  it('O14d: a backwards minAnchorFactor (>1) falls back to default, NOT rejecting an in-band anchor (Codex R2)', () => {
    applyMarketBucketsOverlay(
      result({ radiology: cell(MKT, bucket({ weighted_mean: 300, median: 300, confidence: 'multi_source' })) }),
      { minAnchorFactor: 2 }, // > 1 is invalid → default 0.5 → 300 is in-band → promotes
    )
    expect(SPECIALTIES.radiology.p70).toBe(300)
  })
})

// isFreshBucket future-skew bound (Sol-N6): a far-future lastUpdated is a
// corrupted/mis-stamped write, NOT eternal freshness — reject it, else `now -
// lastUpdated` goes negative and passes the ≤7-day window forever.
describe('isFreshBucket — future-skew bound (Sol-N6)', () => {
  const now = 1_700_000_000_000
  const DAY = 86400000
  it('REJECTS a far-future timestamp (would otherwise stay fresh indefinitely)', () => {
    expect(isFreshBucket(now + 365 * DAY, now)).toBe(false)
  })
  it('accepts a fresh recent timestamp (1 day old)', () => {
    expect(isFreshBucket(now - DAY, now)).toBe(true)
  })
  it('rejects a stale timestamp (>7 days old)', () => {
    expect(isFreshBucket(now - 8 * DAY, now)).toBe(false)
  })
  it('tolerates minor clock skew (a minute ahead is still fresh)', () => {
    expect(isFreshBucket(now + 60000, now)).toBe(true)
  })
  it('accepts exactly the 7-day-old boundary', () => {
    expect(isFreshBucket(now - 7 * DAY, now)).toBe(true)
  })
  it('accepts exactly the 5-minute future-skew boundary', () => {
    expect(isFreshBucket(now + 5 * 60 * 1000, now)).toBe(true)
  })
  it('rejects just past the 5-minute future-skew boundary', () => {
    expect(isFreshBucket(now + 5 * 60 * 1000 + 1, now)).toBe(false)
  })
  it('rejects a non-finite / zero / non-number / Infinity lastUpdated', () => {
    expect(isFreshBucket(0, now)).toBe(false)
    expect(isFreshBucket(NaN, now)).toBe(false)
    expect(isFreshBucket(Infinity, now)).toBe(false)
    expect(isFreshBucket('x' as unknown, now)).toBe(false)
  })
})
