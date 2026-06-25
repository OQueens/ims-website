// === Phase B.7.1 v4 Task 7 — crnaCellLookup tests ===
// Per PLAN.md Task 7 acceptance: ≥15 vitest cases covering tier assignment,
// UHC cut, LOCUM_MULT 4-step fallback ladder, single-flight cache semantics.
//
// Key v4 amendments locked here:
//   - 5-tier matrix: HIGH > MULTI-SOURCE > DERIVED > PUBLIC-HINT > MANUAL-ESCALATION
//     (no EXCELLENT, no FALLBACK)
//   - Literature defaults for LOCUM_MULT (W2:1.0 / 1099:1.6 / locum_w2:1.4 / locum_1099:1.7)
//     replace the v3 hardcoded NURSE_ADVANCED:2.05
//   - 7 UHC-exempt states: AR, CA, CO, HI, MA, NH, WY
//   - UHC cut effective 2025-10-01 at 15% off non-exempt
//
// TASK_2_DEVIATION 2026-05-08: IAS rows are absent in production cache (IAS RTDB
// has no actual paid CRNA rates per n=158 sample). LOCUM_MULT defers to literature
// defaults; HIGH tier currently unreachable absent IAS state n≥10.

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface RawSurveyRow {
  survey_name: string
  state: string | null
  census_division: string | null
  employment_arrangement: string
  rate_low: number | null
  rate_median: number | null
  rate_high: number | null
  n_respondents: number | null
  ingested_at: string
  uhc_cut_applies: boolean
}

// vi.hoisted lets the mock factory close over a live binding so tests can
// mutate `supabaseState.rows` per-test without redeclaring the mock.
const supabaseState = vi.hoisted(() => ({
  rows: [] as RawSurveyRow[],
  fetchCount: 0,
}))

// (hub gate-2: no config/supabase module — mock injected via the runtime seam below)

import {
  getCrnaCellEnvelope,
  applyUhcCut,
  deriveLocumMultCrna,
  censusDivisionOf,
  _resetCacheForTesting,
} from '../rate-engine/crnaCellLookup'
// HUB GATE-2 ADAPTATION: the vendored engine reads supabase via the ./runtime DI
// seam. There is no config/supabase module in the hub, so we build the mock client
// inline (same shape the dashboard's vi.mock returned) and inject it. Everything
// else — fixtures + assertions — is the dashboard suite VERBATIM = the parity proof.
import { configureEngine } from '../rate-engine/runtime'
const supabase = {
  from: (_table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: string) => { supabaseState.fetchCount++; return Promise.resolve({ data: supabaseState.rows, error: null }) },
    }),
  }),
}
configureEngine({ supabase: supabase as never })

// Helper: produce a BLS-style row for any state with a sensible $100/hr W-2 baseline.
const blsRow = (state: string, rateMedian: number = 100, rateLow = rateMedian * 0.92, rateHigh = rateMedian * 1.18): RawSurveyRow => ({
  survey_name: 'bls_oews_29_1151_2024',
  state,
  census_division: null,
  employment_arrangement: 'w2_employee',
  rate_low: rateLow,
  rate_median: rateMedian,
  rate_high: rateHigh,
  n_respondents: 500,
  ingested_at: '2026-05-08T00:00:00Z',
  uhc_cut_applies: state !== 'MA' && state !== 'CA' && state !== 'TX' ? true : (state === 'TX'),
})

const iasRow = (
  state: string,
  arrangement: string,
  rateMedian: number,
  nRespondents: number,
): RawSurveyRow => ({
  survey_name: 'ias_internal_2026',
  state,
  census_division: null,
  employment_arrangement: arrangement,
  rate_low: rateMedian * 0.9,
  rate_median: rateMedian,
  rate_high: rateMedian * 1.1,
  n_respondents: nRespondents,
  ingested_at: '2026-05-08T00:00:00Z',
  uhc_cut_applies: true,
})

const scraperRow = (
  source: string,
  state: string,
  rateMedian: number,
  arrangement: string = 'locum_general',
): RawSurveyRow => ({
  survey_name: source,
  state,
  census_division: null,
  employment_arrangement: arrangement,
  rate_low: rateMedian * 0.9,
  rate_median: rateMedian,
  rate_high: rateMedian * 1.1,
  n_respondents: null,
  ingested_at: '2026-05-08T00:00:00Z',
  uhc_cut_applies: true,
})

beforeEach(() => {
  supabaseState.rows = []
  supabaseState.fetchCount = 0
  _resetCacheForTesting()
})

describe('censusDivisionOf — 9-Division taxonomy (gate (a) coverage)', () => {
  it('51 jurisdictions cover all 9 divisions', () => {
    const all51 = [
      'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY',
      'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
      'OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
    ]
    const counts: Record<string, number> = {}
    for (const s of all51) {
      const d = censusDivisionOf(s)
      counts[d] = (counts[d] ?? 0) + 1
    }
    expect(counts).toEqual({
      NE: 6, MA: 3, ENC: 5, WNC: 7, SA: 9, ESC: 4, WSC: 4, MTN: 8, PAC: 5,
    })
  })

  it('NE/MA division codes do not collide with state codes when columns are anchored', () => {
    // The textual collision (NE division = New England; NE state = Nebraska, lives in WNC).
    expect(censusDivisionOf('NE')).toBe('WNC') // Nebraska state → WNC division
    expect(censusDivisionOf('MA')).toBe('NE')  // Massachusetts state → NE division
    // Column-anchored comparisons in production code prevent the collision from leaking.
  })
})

describe('applyUhcCut — quote-time UHC 15% cut', () => {
  it('MA exempt: pay rate unchanged post-cut date', () => {
    expect(applyUhcCut(200, 'MA', new Date('2026-05-06'))).toBe(200)
  })

  it('TX non-exempt post-cut: pay rate × 0.85', () => {
    expect(applyUhcCut(200, 'TX', new Date('2026-05-06'))).toBeCloseTo(170, 5)
  })

  it('TX pre-cut date (2025-09-30): pay rate unchanged', () => {
    expect(applyUhcCut(200, 'TX', new Date('2025-09-30'))).toBe(200)
  })

  it('TX cut-effective date (2025-10-01): cut applies', () => {
    expect(applyUhcCut(200, 'TX', new Date('2025-10-01'))).toBeCloseTo(170, 5)
  })

  it('Lowercase state input: case-insensitive', () => {
    expect(applyUhcCut(200, 'tx', new Date('2026-05-06'))).toBeCloseTo(170, 5)
  })

  it('All 7 exempt states (AR/CA/CO/HI/MA/NH/WY) bypass cut post-cut date', () => {
    const date = new Date('2026-05-06')
    for (const state of ['AR', 'CA', 'CO', 'HI', 'MA', 'NH', 'WY']) {
      expect(applyUhcCut(200, state, date)).toBe(200)
    }
  })
})

describe('getCrnaCellEnvelope — tier assignment (TASK_2_DEVIATION reality: IAS-empty)', () => {
  it('MA + locum_w2 with BLS-only cache → PUBLIC-HINT (TASK_2_DEVIATION baseline)', async () => {
    // Per TASK_2_DEVIATION: IAS rows absent in production. Cache contains only BLS.
    // Expected tier: PUBLIC-HINT (BLS-anchored single-source + literature LOCUM_MULT).
    supabaseState.rows = [blsRow('MA', 100)]

    const result = await getCrnaCellEnvelope('MA', 'locum_w2')
    expect(result.state).toBe('MA')
    expect(result.arrangement).toBe('locum_w2')
    expect(result.tier).toBe('PUBLIC-HINT')
    expect(result.weighted_mean).not.toBeNull()
    // BLS=$100 × locum_w2 default (1.4) × MA-exempt (1.0) = $140/hr
    expect(result.weighted_mean as number).toBeCloseTo(140, 1)
    expect(result.uhc_cut_applies).toBe(false) // MA exempt
    expect(result.source_attribution).toContain('bls_oews_29_1151_2024')
  })

  it('MA + locum_w2 with BLS + dense IAS state → HIGH tier reachable when 2 sources present', async () => {
    // Synthetic IAS state n=12 with arrangement-matching rows + BLS = 2 sources.
    // Per UI_IMPACT.md §2.3: HIGH iff (BLS not suppressed) AND (IAS state ≥10) AND (≥2 sources).
    supabaseState.rows = [
      blsRow('MA', 100),
      iasRow('MA', 'locum_w2', 145, 12),
    ]

    const result = await getCrnaCellEnvelope('MA', 'locum_w2')
    expect(result.tier).toBe('HIGH')
    expect(result.ias_bookings_for_state).toBe(12)
    expect(result.source_attribution).toContain('bls_oews_29_1151_2024')
    expect(result.source_attribution).toContain('ias_internal_2026')
  })

  it('TX + locum_w2 with BLS + IAS state n=7 + scraper agreement → MULTI-SOURCE (exact)', async () => {
    // n=7 IAS bookings (in [5,9] range, fails HIGH gate) + scraper agrees within ±15% → MULTI-SOURCE.
    // expectedHourly = $100 × 1.4 (locumMult from IAS state n=7 weighted-median 140/100=1.4)
    // × 0.85 (UHC cut) = $119. scraper $130 → |130-119|/119 = 9.2% ≤ 15% → scraperAgrees=true.
    // distinctSources={bls, ias, marithealth}=3. tier=MULTI-SOURCE.
    supabaseState.rows = [
      blsRow('TX', 100),
      iasRow('TX', 'locum_w2', 140, 7),
      scraperRow('marithealth_2026', 'TX', 130),
    ]

    const result = await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(result.tier).toBe('MULTI-SOURCE')
  })

  it('WY + locum_w2 with BLS only → PUBLIC-HINT (exact; no IAS bookings; literature default)', async () => {
    // WY is rural (3 IAS bookings overall per EMPIRICAL_UNIVERSE_SNAPSHOT, likely 0 CRNA).
    // Empty cache except BLS → falls through 4-step ladder to literature default 1.4.
    // distinctSources={bls}=1. iasState=0, iasDivision=0. tier=PUBLIC-HINT.
    supabaseState.rows = [blsRow('WY', 90)]

    const result = await getCrnaCellEnvelope('WY', 'locum_w2')
    expect(result.tier).toBe('PUBLIC-HINT')
    expect(result.uhc_cut_applies).toBe(false) // WY is exempt
    expect(result.weighted_mean).not.toBeNull()
  })

  it('XX (invalid state, no BLS row in cache) → MANUAL-ESCALATION', async () => {
    supabaseState.rows = [blsRow('TX', 100)] // no XX row

    const result = await getCrnaCellEnvelope('XX', 'locum_w2')
    expect(result.tier).toBe('MANUAL-ESCALATION')
    expect(result.weighted_mean).toBeNull()
    expect(result.weighted_variance).toBeNull()
    expect(result.n_survivors).toBe(0)
    expect(result.source_attribution).toEqual([])
  })

  it('lowercase state input is normalized to uppercase', async () => {
    supabaseState.rows = [blsRow('TX', 100)]

    const result = await getCrnaCellEnvelope('tx', 'locum_w2')
    expect(result.state).toBe('TX')
    expect(result.tier).not.toBe('MANUAL-ESCALATION')
  })
})

describe('getCrnaCellEnvelope — UHC cut applies/doesnt-apply', () => {
  it('MA + 1099_independent → uhc_cut_applies=false (MA exempt)', async () => {
    supabaseState.rows = [blsRow('MA', 100)]

    const result = await getCrnaCellEnvelope('MA', '1099_independent')
    expect(result.uhc_cut_applies).toBe(false)
  })

  it('TX + 1099_independent → uhc_cut_applies=true (TX non-exempt)', async () => {
    supabaseState.rows = [blsRow('TX', 100)]

    const result = await getCrnaCellEnvelope('TX', '1099_independent')
    expect(result.uhc_cut_applies).toBe(true)
    // weighted_mean = 100 × 1.6 (1099 default) × 0.85 (UHC cut) = 136
    expect(result.weighted_mean as number).toBeCloseTo(136, 1)
  })

  it('TX + locum_w2 pre-cut date → uhc_cut_applies=false (date-aware)', async () => {
    supabaseState.rows = [blsRow('TX', 100)]

    const result = await getCrnaCellEnvelope('TX', 'locum_w2', new Date('2025-09-30'))
    expect(result.uhc_cut_applies).toBe(false)
    // weighted_mean = 100 × 1.4 × 1.0 = 140 (no cut)
    expect(result.weighted_mean as number).toBeCloseTo(140, 1)
  })
})

describe('deriveLocumMultCrna — 4-step fallback ladder', () => {
  it('No BLS row for state → literature default (MAX_VARIANCE-resistant fallback)', async () => {
    supabaseState.rows = []

    expect(await deriveLocumMultCrna('XX', 'locum_w2')).toBe(1.4)
    expect(await deriveLocumMultCrna('XX', '1099_independent')).toBe(1.6)
    expect(await deriveLocumMultCrna('XX', 'w2_employee')).toBe(1.0)
    expect(await deriveLocumMultCrna('XX', 'locum_1099')).toBe(1.7)
  })

  it('BLS-only cache → literature default (no IAS to triangulate)', async () => {
    supabaseState.rows = [blsRow('CA', 110)]

    expect(await deriveLocumMultCrna('CA', 'locum_w2')).toBe(1.4)
  })

  it('IAS state n≥5 with arrangement match → IAS-derived ratio (state-level wins)', async () => {
    supabaseState.rows = [
      blsRow('MA', 100),
      iasRow('MA', 'locum_w2', 160, 8), // ratio = 160/100 = 1.6
    ]

    const mult = await deriveLocumMultCrna('MA', 'locum_w2')
    expect(mult).toBeCloseTo(1.6, 5)
  })

  it('IAS state n<5 + IAS division n≥10 → division-level ratio fires', async () => {
    // MA is in NE division. Add IAS rows from CT/RI (also NE division) summing to ≥10.
    supabaseState.rows = [
      blsRow('MA', 100),
      iasRow('MA', 'locum_w2', 150, 3), // state n=3 < 5
      iasRow('CT', 'locum_w2', 145, 6), // CT also NE division
      iasRow('RI', 'locum_w2', 155, 5), // RI also NE division
      // Division total: 3+6+5 = 14 ≥ 10
    ]

    const mult = await deriveLocumMultCrna('MA', 'locum_w2')
    // Division-weighted-median should land near 150 (or whichever the median is)
    expect(mult).toBeGreaterThan(1.4)
    expect(mult).toBeLessThan(1.6)
  })

  it('IAS division n<10 + IAS national n≥50 → national ratio fires', async () => {
    // National-level ladder step. Sparse state + division but national has 50+ samples.
    supabaseState.rows = [
      blsRow('MA', 100),
      blsRow('TX', 95),
      blsRow('CA', 120),
      // National BLS median = sorted([95, 100, 120])[1] = 100
      iasRow('TX', 'locum_w2', 130, 25),
      iasRow('CA', 'locum_w2', 165, 30),
      // National IAS total = 55 ≥ 50; weighted-median by n_respondents.
      // weights cumulate: 25 (TX@130) → 55 (CA@165). Sorted by value: TX@130 (w=25), CA@165 (w=30).
      // Total weight = 55. Cumulate: 25 < 27.5, then 25+30=55 ≥ 27.5 → median value = 165.
      // Ratio = 165 / 100 = 1.65.
    ]

    const mult = await deriveLocumMultCrna('MA', 'locum_w2')
    // MA itself has 0 IAS bookings → falls past state. Division (NE) also empty → falls past.
    // National (TX+CA combined) = 55 ≥ 50 → fires. Ratio ~1.65.
    expect(mult).toBeCloseTo(1.65, 1)
  })

  it('Insufficient evidence at all 3 IAS levels → literature default', async () => {
    supabaseState.rows = [
      blsRow('MA', 100),
      iasRow('MA', 'locum_w2', 150, 2), // n=2 < 5 → step (1) fails
      // No division coverage; no national coverage
    ]

    const mult = await deriveLocumMultCrna('MA', 'locum_w2')
    expect(mult).toBe(1.4) // literature default
  })
})

describe('getCrnaCellEnvelope — single-flight cache semantics', () => {
  it('Two sequential calls trigger ONE supabase fetch (cache hit on second)', async () => {
    supabaseState.rows = [blsRow('TX', 100)]

    await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(supabaseState.fetchCount).toBe(1)

    await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(supabaseState.fetchCount).toBe(1) // still 1 — cached
  })

  it('Two PARALLEL calls during initial cache miss → ONE supabase fetch (single-flight)', async () => {
    supabaseState.rows = [blsRow('TX', 100), blsRow('CA', 120)]

    const [r1, r2] = await Promise.all([
      getCrnaCellEnvelope('TX', 'locum_w2'),
      getCrnaCellEnvelope('CA', 'locum_w2'),
    ])
    // Single-flight: both calls share the same _cachePromise.
    expect(supabaseState.fetchCount).toBe(1)
    expect(r1.state).toBe('TX')
    expect(r2.state).toBe('CA')
  })

  it('_resetCacheForTesting clears cache; next call refetches', async () => {
    supabaseState.rows = [blsRow('TX', 100)]

    await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(supabaseState.fetchCount).toBe(1)

    _resetCacheForTesting()

    await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(supabaseState.fetchCount).toBe(2) // refetched
  })

  it('S1 r2 generation-token: reset DURING in-flight load invalidates the stale loader', async () => {
    // Hostile race: kick off a load, reset cache mid-flight, then read the result of the
    // pre-reset load. Without the generation token, the stale loader would commit pre-reset
    // data into the now-clean _cache. With the token, the stale loader detects the
    // generation mismatch and skips the commit.
    //
    // We can't perfectly simulate the timing without controlling the supabase mock's resolve,
    // but the simpler case is sufficient: after reset, the next call must REFETCH, not pick
    // up the prior in-flight result.
    supabaseState.rows = [blsRow('TX', 100)]
    const firstLoad = getCrnaCellEnvelope('TX', 'locum_w2')

    _resetCacheForTesting()
    // Even though firstLoad is awaited next, the reset happened — the generation
    // token should make the new load force a fresh fetch.
    supabaseState.rows = [blsRow('TX', 200)] // change cache content
    await firstLoad // settle the original load

    const second = await getCrnaCellEnvelope('TX', 'locum_w2')
    // The second call should see the NEW cache contents (rate_median=200) because
    // the reset invalidated whatever the first load might have committed.
    // (BLS_$200 × locum_w2 default 1.4 × UHC cut 0.85 = $238)
    expect(second.weighted_mean as number).toBeCloseTo(238, 1)
    // Two physical fetches happened (one per generation).
    expect(supabaseState.fetchCount).toBe(2)
  })
})

describe('Codex r1 M1 r1 fold — column-anchored division predicate', () => {
  // Helper: division-anchored row (r.state === null, r.census_division non-null)
  const iasDivisionRow = (
    division: string,
    arrangement: string,
    rateMedian: number,
    nRespondents: number,
  ): RawSurveyRow => ({
    survey_name: 'ias_internal_2026',
    state: null,
    census_division: division,
    employment_arrangement: arrangement,
    rate_low: rateMedian * 0.9,
    rate_median: rateMedian,
    rate_high: rateMedian * 1.1,
    n_respondents: nRespondents,
    ingested_at: '2026-05-08T00:00:00Z',
    uhc_cut_applies: true,
  })

  it('division-only row (null state, NE division) contributes to MA query (NE division)', async () => {
    // MA is in NE division. A division-anchored row tagged 'NE' should match.
    // Pre-M1-fold: `censusDivisionOf((null ?? '').toUpperCase())` → 'SA' default,
    // so the NE-tagged row would be missed. Post-fold: r.census_division read directly.
    supabaseState.rows = [
      blsRow('MA', 100),
      iasDivisionRow('NE', 'locum_w2', 145, 12), // NE division pool, n=12
    ]

    // Test deriveLocumMultCrna: division-step should fire because state n=0 < 5
    // but division n=12 ≥ 10. Without M1 fold, division row would be missed.
    const mult = await deriveLocumMultCrna('MA', 'locum_w2')
    expect(mult).toBeCloseTo(1.45, 2) // 145/100
  })

  it('division-only row (null state, SA division) does NOT contribute to MA query (NE division)', async () => {
    // SA-tagged division row should NOT match the NE-division query for MA.
    // Pre-M1-fold: NULL state coerced to 'SA' default which COULD match a NE
    // query if we expected the same buggy logic on both sides. The bug-fixed
    // code correctly excludes SA division rows from a MA (NE) query.
    supabaseState.rows = [
      blsRow('MA', 100),
      iasDivisionRow('SA', 'locum_w2', 200, 50), // SA division — should NOT match MA(NE)
    ]

    // Division step should NOT fire (no NE rows). Falls past to national. National
    // total = 50 ≥ 50 — but wait, the SA row IS in IAS national pool. So national
    // ratio fires: 200 / 100 = 2.0.
    const mult = await deriveLocumMultCrna('MA', 'locum_w2')
    expect(mult).toBeCloseTo(2.0, 2) // National-level ratio (SA row counts at national)
  })

  it('division-only row (null state, NE division) counts toward iasDivisionBookings → DERIVED (exact)', async () => {
    // Tier assignment uses iasDivisionBookings; the M1 fix must propagate here too.
    // n=14 ≥ 10 → DERIVED. distinctSources={bls, ias}=2 (the IAS division-only row
    // appears in observations because rowsToObservations matches by division too).
    // BUT: iasStateBookings=0, scraperAgrees=false → MULTI-SOURCE gate fails;
    // iasDivisionBookings=14 ≥ 10 → DERIVED fires.
    supabaseState.rows = [
      blsRow('MA', 100),
      iasDivisionRow('NE', 'locum_w2', 145, 14),
    ]

    const result = await getCrnaCellEnvelope('MA', 'locum_w2')
    expect(result.tier).toBe('DERIVED')
  })

  it('Pre-M1-fold regression: SA-tagged division row does NOT contaminate MA(NE) → PUBLIC-HINT (exact)', async () => {
    // Pre-fold bug: null-state rows always evaluated as SA division. Post-fold:
    // SA division-only row correctly excluded from MA(NE) query.
    // observations=[] (SA row excluded by both state-anchor and division-anchor).
    // distinctSources={bls}=1. iasStateBookings=0, iasDivisionBookings=0.
    // → PUBLIC-HINT.
    supabaseState.rows = [
      blsRow('MA', 100),
      iasDivisionRow('SA', 'locum_w2', 200, 100),
    ]

    const result = await getCrnaCellEnvelope('MA', 'locum_w2')
    expect(result.ias_bookings_for_state).toBe(0)
    expect(result.tier).toBe('PUBLIC-HINT')
    expect(result.source_attribution).toEqual(['bls_oews_29_1151_2024'])
  })

  it('SA-query (FL) with NE-tagged division row → NE row correctly EXCLUDED', async () => {
    // Mirror of the SA-contamination test, queried from SA side. Adds an NE-tagged
    // null-state row that should NOT contribute to a Florida (SA) query.
    supabaseState.rows = [
      blsRow('FL', 105),
      iasDivisionRow('NE', 'locum_w2', 150, 50), // NE division - should NOT contribute to FL(SA)
    ]

    const result = await getCrnaCellEnvelope('FL', 'locum_w2')
    expect(result.tier).toBe('PUBLIC-HINT')
    expect(result.source_attribution).toEqual(['bls_oews_29_1151_2024'])
  })

  it('SA-query (FL) with SA-tagged division row → SA row correctly INCLUDED → DERIVED', async () => {
    // Positive symmetry: a division-only SA row contributes to an FL (SA) query.
    supabaseState.rows = [
      blsRow('FL', 105),
      iasDivisionRow('SA', 'locum_w2', 150, 14),
    ]

    const result = await getCrnaCellEnvelope('FL', 'locum_w2')
    expect(result.tier).toBe('DERIVED')
    expect(result.source_attribution).toContain('ias_internal_2026')
  })
})

describe('Codex r1 S1 r1 fold — date-aware uhc_cut_applies in MANUAL-ESCALATION early-return', () => {
  it('Pre-cut date + non-exempt suppressed state → uhc_cut_applies=false (date-aware)', async () => {
    // No BLS row for state → MANUAL-ESCALATION early return.
    // Pre-S1-fold: uhc_cut_applies always set from exemption only, ignoring
    // dateOfService. So a 2025-09-01 query (pre-cut) would falsely report
    // uhc_cut_applies=true for non-exempt suppressed states. Post-fold: date-aware.
    supabaseState.rows = [] // empty cache → all states miss BLS

    const preCut = await getCrnaCellEnvelope('TX', 'locum_w2', new Date('2025-09-01'))
    expect(preCut.tier).toBe('MANUAL-ESCALATION')
    expect(preCut.uhc_cut_applies).toBe(false) // pre-cut date

    const postCut = await getCrnaCellEnvelope('TX', 'locum_w2', new Date('2026-05-06'))
    expect(postCut.tier).toBe('MANUAL-ESCALATION')
    expect(postCut.uhc_cut_applies).toBe(true) // post-cut date AND non-exempt
  })

  it('Exempt state in MANUAL-ESCALATION → uhc_cut_applies=false regardless of date', async () => {
    supabaseState.rows = []

    const result = await getCrnaCellEnvelope('MA', 'locum_w2', new Date('2026-05-06'))
    expect(result.tier).toBe('MANUAL-ESCALATION')
    expect(result.uhc_cut_applies).toBe(false) // MA exempt
  })
})

describe('arrangementMatches alias group — locum_general scraper rows', () => {
  it('Scraper locum_general row triangulates locum_w2 query (alias) → PUBLIC-HINT (exact)', async () => {
    // expectedHourly = $100 × 1.4 (literature default; no IAS) × 0.85 (UHC cut) = $119.
    // Scrapers at $140 / $138 → |140-119|/119 = 17.6%, |138-119|/119 = 16.0%. BOTH > 15%.
    // → scraperAgrees=false. distinctSources=3. iasStateBookings=0, iasDivisionBookings=0.
    // assignTier: distinctSources≥2 && (iasStateBookings≥5 || scraperAgrees)? false.
    // iasDivisionBookings≥10? false. → PUBLIC-HINT.
    supabaseState.rows = [
      blsRow('TX', 100),
      scraperRow('marithealth_2026', 'TX', 140, 'locum_general'),
      scraperRow('ziprecruiter_2026', 'TX', 138, 'locum_general'),
    ]

    const result = await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(result.tier).toBe('PUBLIC-HINT')
    expect(result.source_attribution.length).toBe(3)
  })

  it('Scraper agreement within ±15% of expectedHourly + 2 distinct sources → MULTI-SOURCE (exact)', async () => {
    // Tighter scraper match: $122 vs expectedHourly $119 → |122-119|/119 = 2.5% within 15%.
    // distinctSources=2 (bls + scraper). scraperAgrees=true. iasStateBookings=0.
    // → MULTI-SOURCE (gate: ≥2 sources AND (iasStateBookings≥5 OR scraperAgrees) → true).
    supabaseState.rows = [
      blsRow('TX', 100),
      scraperRow('marithealth_2026', 'TX', 122, 'locum_general'),
    ]

    const result = await getCrnaCellEnvelope('TX', 'locum_w2')
    expect(result.tier).toBe('MULTI-SOURCE')
  })

  it('Scraper locum_general row does NOT contribute to w2_employee query (no alias)', async () => {
    supabaseState.rows = [
      blsRow('TX', 100),
      scraperRow('marithealth_2026', 'TX', 140, 'locum_general'),
    ]

    const result = await getCrnaCellEnvelope('TX', 'w2_employee')
    // w2_employee query: locum_general scraper does NOT match → only BLS in source_attribution
    expect(result.source_attribution).toEqual(['bls_oews_29_1151_2024'])
    expect(result.tier).toBe('PUBLIC-HINT')
  })
})
