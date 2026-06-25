// src/features/rate-simulator/engine/__tests__/blsSanityCheck.test.ts
// Phase 3 step 2 — v3 (post Codex round-3 probe-gate fold + round-4
// commit-time review fold).
//
// B.7.1 Task 8 (2026-05-08): evaluateBlsSanityCheck became async (CRNA path
// awaits the crnaCellLookup envelope). Every CRNA test in this file is
// designed to fall through to the legacy BLS+LOCUM_MULTIPLIER path — by
// default the mocked Supabase returns no `bls_oews_29_1151_2024` rows for
// CRNA, so getCrnaCellEnvelope returns MANUAL-ESCALATION and evaluateCrnaCheck
// returns null (legacy fallback). New CRNA-dispatcher tests at the bottom
// mutate the mock state to exercise the envelope-success path explicitly.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SPECIALTIES } from '../rate-engine/specialties'
import { BLS_OEWS_BASELINE } from '../rate-engine/blsOewsBaseline'

// vi.hoisted exposes a live binding the mock factory closes over so each test
// can repopulate `supabaseState.rows` without redeclaring the mock. The mock
// returns whatever rows are set at the time of the supabase fetch — empty by
// default (forces dispatcher fallback to legacy path).
interface MockRow {
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
const supabaseState = vi.hoisted(() => ({ rows: [] as MockRow[] }))

// (hub gate-2: no config/supabase module — mock injected via the runtime seam below)

import {
  evaluateBlsSanityCheck,
  SPECIALTY_TO_SOC,
  LOCUM_MULTIPLIER,
  MAX_HOURLY_CEILING,
  type SocFamily,
} from '../rate-engine/blsSanityCheck'
import { _resetCacheForTesting, RETRY_COOLDOWN_MS } from '../rate-engine/crnaCellLookup'
// HUB GATE-2 ADAPTATION: the vendored engine reads supabase via the ./runtime DI
// seam (crnaCellLookup is dispatched for CRNA). No config/supabase module exists in
// the hub, so we build the mock client inline — with vi.fn()s so the cooldown/error
// tests below can retune `supabase.from` via mockReturnValueOnce — and inject it.
// Fixtures + assertions are the dashboard suite VERBATIM = the parity proof.
import { configureEngine } from '../rate-engine/runtime'
const supabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: supabaseState.rows, error: null })),
    })),
  })),
}
configureEngine({ supabase: supabase as never })

// Reset mock state + crnaCellLookup cache between tests so the dispatcher
// always resolves through a fresh in-memory state.
beforeEach(() => {
  supabaseState.rows = []
  _resetCacheForTesting()
})

const FAMILIES: SocFamily[] = [
  'NP_PA', 'NP_PA_SPECIALTY', 'NP_PA_HIGH', 'ANESTHESIA_APP',
  'NURSE_ADVANCED',
  'PHYSICIAN_LOW', 'PHYSICIAN_HOSPITALIST', 'PHYSICIAN_CORE',
  'PHYSICIAN_SUBSPECIALTY', 'PHYSICIAN_EM_HIGH', 'PHYSICIAN_PSYCH_HIGH',
  'PHYSICIAN_HIGH', 'PHYSICIAN_HIGH_PREMIUM',
  'SURGEON_CORE', 'SURGEON_HIGH',
]

describe('blsSanityCheck', () => {
  describe('SPECIALTY_TO_SOC mapping (88 keys)', () => {
    it('SPECIALTIES has exactly 88 keys', () => {
      expect(Object.keys(SPECIALTIES).length).toBe(88)
    })

    it('SPECIALTY_TO_SOC covers every key in SPECIALTIES', () => {
      const mapped = new Set(Object.keys(SPECIALTY_TO_SOC))
      const all = Object.keys(SPECIALTIES)
      expect(all.filter((k) => !mapped.has(k))).toEqual([])
    })

    it('SPECIALTY_TO_SOC has no orphan keys not in SPECIALTIES', () => {
      const all = new Set(Object.keys(SPECIALTIES))
      const orphans = Object.keys(SPECIALTY_TO_SOC).filter((k) => !all.has(k))
      expect(orphans).toEqual([])
    })

    it('every entry resolves to a known SOC family', () => {
      const valid = new Set<SocFamily>(FAMILIES)
      for (const [key, entry] of Object.entries(SPECIALTY_TO_SOC)) {
        expect(valid.has(entry.family), `${key} family must be valid`).toBe(true)
        expect(entry.primarySOC, `${key} must have primarySOC`).toBeTruthy()
      }
    })
  })

  describe('LOCUM_MULTIPLIER (15 families, v3)', () => {
    it('exposes exactly 15 SOC families', () => {
      expect(Object.keys(LOCUM_MULTIPLIER).length).toBe(15)
      expect(FAMILIES.length).toBe(15)
    })

    it('has a multiplier per SOC family > 1.0', () => {
      for (const f of FAMILIES) {
        expect(LOCUM_MULTIPLIER[f], `${f} multiplier must be > 1.0`).toBeGreaterThan(1.0)
      }
    })

    it('multipliers monotone within physician/surgeon ladders', () => {
      expect(LOCUM_MULTIPLIER.PHYSICIAN_LOW).toBeLessThan(LOCUM_MULTIPLIER.PHYSICIAN_CORE)
      expect(LOCUM_MULTIPLIER.PHYSICIAN_CORE).toBeLessThan(LOCUM_MULTIPLIER.PHYSICIAN_HIGH)
      expect(LOCUM_MULTIPLIER.PHYSICIAN_HIGH).toBeLessThan(LOCUM_MULTIPLIER.PHYSICIAN_HIGH_PREMIUM)
      expect(LOCUM_MULTIPLIER.SURGEON_CORE).toBeLessThan(LOCUM_MULTIPLIER.SURGEON_HIGH)
    })

    it('ANESTHESIA_APP family uses 3.50× multiplier (v3 — distinct from NP_PA family)', () => {
      // Anesthesiologist Assistants are SOC 29-1071 like other NP/PAs but earn
      // a far higher locum premium per probe-driven calibration. v3 split this
      // out as its own family; v2 had no ANESTHESIA_APP family.
      expect(LOCUM_MULTIPLIER.ANESTHESIA_APP).toBe(3.50)
      expect(LOCUM_MULTIPLIER.ANESTHESIA_APP).toBeGreaterThan(LOCUM_MULTIPLIER.NP_PA_HIGH)
    })
  })

  describe('evaluateBlsSanityCheck — ANESTHESIA_APP routing (v3)', () => {
    it('anesthesiologist assistant evaluates via 29-1071 SOC + 3.50× multiplier', async () => {
      // Anesthesiologist assistant maps to detail SOC 29-1071 (NP/PA aggregate
      // host) but uses ANESTHESIA_APP family multiplier — verifies routing
      // doesn't accidentally fall back to a generic NP/PA family.
      const med = BLS_OEWS_BASELINE['CA']?.['29-1071']?.medianHourly
      expect(med, 'CA 29-1071 median must be non-null for this test').toBeTruthy()
      const expected = (med as number) * LOCUM_MULTIPLIER.ANESTHESIA_APP
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'anesthesiologist assistant', state: 'CA',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.socUsed).toBe('29-1071')
      expect(r.expectedHourly).not.toBeNull()
      // Sanity: expected is 3.50× the median, not 1.45× (NP_PA) or 2.20× (NP_PA_HIGH).
      expect(r.expectedHourly!).toBeCloseTo((med as number) * 3.50, 4)
    })
  })

  describe('evaluateBlsSanityCheck — control paths', () => {
    it('isCallOnly=true → unavailable + call-daily-mode', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'CA', displayedHourlyRate: 250, isCallOnly: true,
      })
      expect(r.verdict).toBe('unavailable')
      expect(r.reason).toBe('call-daily-mode')
    })

    it('unknown state XX → unavailable + unknown-state', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'XX', displayedHourlyRate: 250, isCallOnly: false,
      })
      expect(r.verdict).toBe('unavailable')
      expect(r.reason).toBe('unknown-state')
    })

    it('lowercase state ca → normalized to CA, evaluates normally', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'np/pa (primary care)', state: 'ca', displayedHourlyRate: 95, isCallOnly: false,
      })
      expect(r.reason).not.toBe('unknown-state')
    })

    it('unmapped specialty → unavailable + unmapped-specialty', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'not-a-real-specialty' as never,
        state: 'CA', displayedHourlyRate: 250, isCallOnly: false,
      })
      expect(r.verdict).toBe('unavailable')
      expect(r.reason).toBe('unmapped-specialty')
    })

    it('displayedHourlyRate ≤ 0 → unavailable + invalid-displayed-hourly-rate', async () => {
      for (const bad of [0, -1, -250]) {
        const r = await evaluateBlsSanityCheck({
          specialtyKey: 'crna', state: 'CA', displayedHourlyRate: bad, isCallOnly: false,
        })
        expect(r.verdict, `${bad} → unavailable`).toBe('unavailable')
        expect(r.reason).toBe('invalid-displayed-hourly-rate')
      }
    })

    it('displayedHourlyRate NaN/Infinity → unavailable + invalid-displayed-hourly-rate', async () => {
      for (const bad of [NaN, Infinity, -Infinity]) {
        const r = await evaluateBlsSanityCheck({
          specialtyKey: 'crna', state: 'CA', displayedHourlyRate: bad, isCallOnly: false,
        })
        expect(r.verdict).toBe('unavailable')
        expect(r.reason).toBe('invalid-displayed-hourly-rate')
      }
    })
  })

  describe('evaluateBlsSanityCheck — L1 hit', () => {
    it('np/pa (primary care) in CA hits L1 with non-null median + isMeanBased=false', async () => {
      const med = BLS_OEWS_BASELINE['CA']?.['29-1071']?.medianHourly
      expect(med, 'CA 29-1071 median must be non-null').toBeTruthy()
      const expected = (med as number) * LOCUM_MULTIPLIER.NP_PA
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'np/pa (primary care)', state: 'CA',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.isMeanBased).toBe(false)
      expect(r.isAggregateFallback).toBe(false)
      expect(r.socUsed).toBe('29-1071')
      expect(r.source).toMatch(/state median$/)
    })
  })

  // === GENERIC BAND / THRESHOLD / MEAN-CAP tests (NON-CRNA, ceiling-free) ===
  // These verify the specialty-AGNOSTIC verdict math (soft/hard thresholds, mean-fallback
  // cap) in evaluateBlsLegacyPath. They deliberately use a NON-CRNA specialty: CRNA now
  // carries a $250 per-specialty ceiling (OBS-03) that overrides the band for any rate
  // >$250, which would confound a pure band/threshold assertion (the deviations tested
  // here, +26%..+200% of a ~$200+ expected, all exceed $250). A specialty with NO
  // MAX_HOURLY_CEILING entry isolates the band logic. Helpers scan the baseline for the
  // required data shape so the tests self-adapt to whatever non-CRNA data exists.
  const NON_CRNA_SOC: { key: string; soc: string; family: SocFamily }[] = (() => {
    const seen = new Set<string>()
    const out: { key: string; soc: string; family: SocFamily }[] = []
    for (const [key, m] of Object.entries(SPECIALTY_TO_SOC)) {
      if (key === 'crna' || MAX_HOURLY_CEILING[key] != null) continue
      if (seen.has(m.primarySOC)) continue
      seen.add(m.primarySOC)
      out.push({ key, soc: m.primarySOC, family: m.family })
    }
    return out
  })()

  // Fixed-fallback mode: medianHourly present but p25 OR p75 null (→ FIXED_SOFT=25 /
  // FIXED_HARD=40 thresholds, no band widening).
  function findFixedMode(): { key: string; state: string; expected: number } {
    for (const { key, soc, family } of NON_CRNA_SOC) {
      for (const st of Object.keys(BLS_OEWS_BASELINE)) {
        const r = BLS_OEWS_BASELINE[st]?.[soc]
        if (r?.medianHourly != null && (r.p25Hourly == null || r.p75Hourly == null)) {
          return { key, state: st, expected: r.medianHourly * LOCUM_MULTIPLIER[family] }
        }
      }
    }
    throw new Error('No non-CRNA fixed-fallback-mode state found in baseline')
  }

  // Mean-fallback mode: medianHourly null but meanHourly present, AND fixed thresholds
  // (p25 or p75 null) so the mean-cap — not band widening — drives the verdict.
  function findMeanMode(): { key: string; state: string; expected: number } {
    for (const { key, soc, family } of NON_CRNA_SOC) {
      for (const st of Object.keys(BLS_OEWS_BASELINE)) {
        const r = BLS_OEWS_BASELINE[st]?.[soc]
        if (
          r?.medianHourly == null && r?.meanHourly != null &&
          (r.p25Hourly == null || r.p75Hourly == null)
        ) {
          return { key, state: st, expected: r.meanHourly * LOCUM_MULTIPLIER[family] }
        }
      }
    }
    throw new Error('No non-CRNA mean-fallback-mode state found in baseline')
  }

  describe('evaluateBlsSanityCheck — fixed-fallback threshold mode (non-CRNA, ceiling-free)', () => {
    it('within ±25% deviation is aligned (interior of soft band)', async () => {
      // Interior test at +20% deviation — well within the 25% soft threshold.
      const { key, state, expected } = findFixedMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: Math.round(expected * 1.20), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
    })

    it('boundary: 26% is soft', async () => {
      const { key, state, expected } = findFixedMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: Math.round(expected * 1.26), isCallOnly: false,
      })
      expect(r.verdict).toBe('soft')
    })

    it('boundary: exactly 40% is soft', async () => {
      // Unrounded expected × 1.40 hits the exact +40% boundary (≤ 40 inclusive → soft).
      const { key, state, expected } = findFixedMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: expected * 1.40, isCallOnly: false,
      })
      expect(r.verdict).toBe('soft')
    })

    it('boundary: 42% is hard (median-based, not mean-capped)', async () => {
      const { key, state, expected } = findFixedMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: Math.round(expected * 1.42), isCallOnly: false,
      })
      expect(r.isMeanBased).toBe(false)
      expect(r.verdict).toBe('hard')
    })
  })

  describe('evaluateBlsSanityCheck — mean-fallback severity cap (v3 MEAN_CAP_RATIO=1.5, non-CRNA)', () => {
    it('L2 mean-fallback caps verdict at soft when 40% < |dev| < 60% (v3)', async () => {
      // v3 cap window is |dev| < MEAN_CAP_RATIO × hardThreshold = 1.5 × 40 = 60.
      const { key, state, expected } = findMeanMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: Math.round(expected * 1.50), isCallOnly: false,
      })
      expect(r.isMeanBased).toBe(true)
      expect(r.verdict).toBe('soft')
    })

    it('L2 mean-fallback at +70% deviation is HARD under v3 (was SOFT under v2)', async () => {
      // With MEAN_CAP_RATIO=1.5 the cap window is |dev| < 60; +70% is above it → hard.
      const { key, state, expected } = findMeanMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: expected * 1.70, isCallOnly: false,
      })
      expect(r.isMeanBased).toBe(true)
      expect(r.verdict).toBe('hard')
    })

    it('L2 mean-fallback promotes to hard when |dev| is far above v3 cap window', async () => {
      const { key, state, expected } = findMeanMode()
      const r = await evaluateBlsSanityCheck({
        specialtyKey: key, state, displayedHourlyRate: Math.round(expected * 3.0), isCallOnly: false,
      })
      expect(r.isMeanBased).toBe(true)
      expect(r.verdict).toBe('hard')
    })
  })

  describe('evaluateBlsSanityCheck — band-aware thresholds (v3 BAND_HARD_GAP=25)', () => {
    function findBandWideningState(): string {
      // Need 29-1151 with median + p25 + p75 all non-null AND halfWidth > 15
      // (so v3 hardThreshold = halfWidth + 25 > 40 default and isBandAware=true
      // with hardThresholdPct widening above the fixed 40 floor).
      for (const st of Object.keys(BLS_OEWS_BASELINE)) {
        const row = BLS_OEWS_BASELINE[st]?.['29-1151']
        if (row?.medianHourly == null || row.p25Hourly == null || row.p75Hourly == null) continue
        const lowPct = ((row.medianHourly - row.p25Hourly) / row.medianHourly) * 100
        const highPct = ((row.p75Hourly - row.medianHourly) / row.medianHourly) * 100
        const halfWidth = Math.max(lowPct, highPct)
        if (halfWidth > 15) return st
      }
      throw new Error('No band-widening 29-1151 state found in baseline; band-aware test infeasible')
    }

    it('isBandAware=true and hardThresholdPct widens above 40 with high-spread p25/p75', async () => {
      const st = findBandWideningState()
      const row = BLS_OEWS_BASELINE[st]?.['29-1151']!
      const expected = (row.medianHourly as number) * LOCUM_MULTIPLIER.NURSE_ADVANCED
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: st,
        displayedHourlyRate: Math.round(expected),
        isCallOnly: false,
      })
      expect(r.isBandAware).toBe(true)
      expect(r.hardThresholdPct).not.toBeNull()
      expect(r.hardThresholdPct!).toBeGreaterThan(40)

      const lowPct = ((row.medianHourly! - row.p25Hourly!) / row.medianHourly!) * 100
      const highPct = ((row.p75Hourly! - row.medianHourly!) / row.medianHourly!) * 100
      const halfWidth = Math.max(lowPct, highPct)
      // v3 widening formula: hardThreshold = max(40, halfWidth + 25).
      const expectedWidened = Math.max(40, halfWidth + 25)
      expect(r.hardThresholdPct!).toBeCloseTo(expectedWidened, 4)
    })

    it('fixed-mode states report isBandAware=false and hardThresholdPct=40', async () => {
      // When p25 OR p75 is suppressed the engine falls back to fixed
      // FIXED_HARD=40. isBandAware must be false in this branch.
      let fixedState: string | null = null
      for (const st of Object.keys(BLS_OEWS_BASELINE)) {
        const row = BLS_OEWS_BASELINE[st]?.['29-1151']
        if (row?.medianHourly != null && (row.p25Hourly == null || row.p75Hourly == null)) {
          fixedState = st
          break
        }
      }
      expect(fixedState, 'baseline must contain at least one fixed-mode 29-1151 state').not.toBeNull()
      const expected = (BLS_OEWS_BASELINE[fixedState!]?.['29-1151']?.medianHourly as number) * LOCUM_MULTIPLIER.NURSE_ADVANCED
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: fixedState!,
        displayedHourlyRate: Math.round(expected),
        isCallOnly: false,
      })
      expect(r.isBandAware).toBe(false)
      expect(r.hardThresholdPct).toBe(40)
    })
  })

  describe('evaluateBlsSanityCheck — fallback ladder L3/L4 + suppression', () => {
    it('returns unavailable when all 4 layers are null (if any state qualifies empirically)', async () => {
      let foundState: string | null = null
      for (const st of Object.keys(BLS_OEWS_BASELINE)) {
        const detail = BLS_OEWS_BASELINE[st]?.['29-1212']
        const agg = BLS_OEWS_BASELINE[st]?.['29-1229']
        const dn = !detail || (detail.medianHourly == null && detail.meanHourly == null)
        const an = !agg || (agg.medianHourly == null && agg.meanHourly == null)
        if (dn && an) { foundState = st; break }
      }
      if (foundState) {
        const r = await evaluateBlsSanityCheck({
          specialtyKey: 'cardiology', state: foundState,
          displayedHourlyRate: 300, isCallOnly: false,
        })
        expect(r.verdict).toBe('unavailable')
        expect(r.reason).toBe('state-and-specialty-suppressed')
      }
    })
  })

  describe('post-step-1.6 sensitivity baseline', () => {
    it('CRNA TX at $262/hr documents the verdict for forensic citation', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 262, isCallOnly: false,
      })
      expect(r.verdict).toMatch(/^(aligned|soft|hard|unavailable)$/)
      console.log(`[forensic] CRNA TX $262/hr → ${r.verdict}, expected=${r.expectedHourly?.toFixed(0)}, dev=${r.deviationPct?.toFixed(1)}%, source=${r.source}`)
    })

    it('FM OH at $167/hr documents the verdict for forensic citation', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'family medicine', state: 'OH',
        displayedHourlyRate: 167, isCallOnly: false,
      })
      expect(r.verdict).toMatch(/^(aligned|soft|hard|unavailable)$/)
      console.log(`[forensic] FM OH $167/hr → ${r.verdict}, expected=${r.expectedHourly?.toFixed(0)}, dev=${r.deviationPct?.toFixed(1)}%, source=${r.source}`)
    })
  })

  // === B.7.1 v4 Task 8 — CRNA dispatcher path ===
  // These tests populate `supabaseState.rows` BEFORE the call so getCrnaCellEnvelope
  // returns a populated envelope and evaluateCrnaCheck takes over from the legacy
  // BLS+LOCUM_MULTIPLIER path. The envelope's weighted_mean is `BLS × LOCUM_MULT
  // × (1 - UHC_cut)` per crnaCellLookup step (4); these tests verify the wire-in
  // produces the expected envelope-based verdict instead of the 2.05× legacy.
  describe('evaluateBlsSanityCheck — CRNA dispatcher (envelope path, B.7.1 v4)', () => {
    // Helper: BLS spine row for a state. CRNA SOC 29-1151 with rate_median=$80/hr W2.
    const blsCrnaRow = (state: string, rateMedian: number = 80) => ({
      survey_name: 'bls_oews_29_1151_2024',
      state,
      census_division: null as string | null,
      employment_arrangement: 'w2_employee',
      rate_low: rateMedian * 0.9,
      rate_median: rateMedian,
      rate_high: rateMedian * 1.1,
      n_respondents: 500,
      ingested_at: '2026-05-08T00:00:00Z',
      uhc_cut_applies: !['AR', 'CA', 'CO', 'HI', 'MA', 'NH', 'WY'].includes(state),
    })

    it('CRNA dispatcher takes over when BLS row in cache (PUBLIC-HINT envelope, no IAS)', async () => {
      // BLS row only → no IAS evidence → PUBLIC-HINT tier with literature default
      // LOCUM_MULT (locum_w2 = 1.4). expected = 80 × 1.4 × (1 − 0.15) = $95.20/hr (TX is non-exempt).
      // Compare $95/hr displayed → ~0% deviation → aligned via envelope.
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 95, isCallOnly: false,
        arrangement: 'locum_w2',
        // Force post-cut date so TX (non-exempt) gets the 15% off applied.
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.verdict).toBe('aligned')
      // Envelope-based source label MUST contain BLS 29-1151 + tier + LOCUM_MULT readout.
      expect(r.source).toMatch(/BLS 29-1151 \+ IAS empirical/)
      expect(r.source).toMatch(/tier=PUBLIC-HINT/)
      expect(r.source).toMatch(/LOCUM_MULT=1\.40/)
      expect(r.source).toMatch(/UHC -15% applied/)
      // Envelope expectedHourly = 80 × 1.4 × 0.85 = 95.2 (NOT 80 × 2.05 = 164 legacy).
      expect(r.expectedHourly).not.toBeNull()
      expect(r.expectedHourly!).toBeCloseTo(95.2, 1)
      expect(r.socUsed).toBe('29-1151')
    })

    it('CRNA UHC-exempt state (CA) does NOT apply the 15% cut', async () => {
      // CA is in UHC_EXEMPT_STATES — envelope expectedHourly = 80 × 1.4 = $112/hr.
      // Source label MUST NOT contain "UHC -15% applied".
      supabaseState.rows = [blsCrnaRow('CA', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'CA',
        displayedHourlyRate: 112, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.verdict).toBe('aligned')
      expect(r.expectedHourly!).toBeCloseTo(112.0, 1)
      expect(r.source).not.toMatch(/UHC -15% applied/)
    })

    it('CRNA pre-2025-10-01 dateOfService disables UHC cut even in non-exempt state', async () => {
      // TX is non-exempt but pre-cut date → no cut. expected = 80 × 1.4 = $112/hr.
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 112, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2025-09-30T00:00:00Z'),
      })
      expect(r.verdict).toBe('aligned')
      expect(r.expectedHourly!).toBeCloseTo(112.0, 1)
      expect(r.source).not.toMatch(/UHC -15% applied/)
    })

    it('CRNA isCallOnly short-circuits in dispatcher BEFORE envelope lookup', async () => {
      // call-daily-mode must short-circuit in evaluateCrnaCheck without touching
      // supabase. Verify by setting rows to a poison value that would crash if read.
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 250, isCallOnly: true,
      })
      expect(r.verdict).toBe('unavailable')
      expect(r.reason).toBe('call-daily-mode')
      expect(r.socUsed).toBe('29-1151')
    })

    it('CRNA invalid displayed rate short-circuits in dispatcher (NaN/zero)', async () => {
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      for (const bad of [0, -1, NaN, Infinity]) {
        const r = await evaluateBlsSanityCheck({
          specialtyKey: 'crna', state: 'TX',
          displayedHourlyRate: bad, isCallOnly: false,
        })
        expect(r.verdict).toBe('unavailable')
        expect(r.reason).toBe('invalid-displayed-hourly-rate')
        expect(r.socUsed).toBe('29-1151')
      }
    })

    it('CRNA unknown state XX returns unavailable in dispatcher', async () => {
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'XX',
        displayedHourlyRate: 100, isCallOnly: false,
      })
      expect(r.verdict).toBe('unavailable')
      expect(r.reason).toBe('unknown-state')
    })

    it('CRNA falls through to legacy path when no BLS row in cache (MANUAL-ESCALATION)', async () => {
      // No bls_oews_29_1151_2024 row for KS → envelope returns MANUAL-ESCALATION
      // → evaluateCrnaCheck returns null → dispatcher falls through to legacy
      // BLS+LOCUM_MULTIPLIER. Source label is the legacy "BLS 29-1151 state median".
      // Use a state where the BASELINE has 29-1151 medianHourly so the legacy
      // path can produce a proper aligned verdict.
      supabaseState.rows = [] // empty — nothing in supabase cache for any specialty
      const med = BLS_OEWS_BASELINE['KS']?.['29-1151']?.medianHourly
      expect(med, 'KS 29-1151 median must be non-null for fallback test').toBeTruthy()
      const expected = (med as number) * LOCUM_MULTIPLIER.NURSE_ADVANCED
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'KS',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      // Legacy source label format
      expect(r.source).toMatch(/BLS 29-1151 state median/)
      expect(r.source).not.toMatch(/IAS empirical/)
    })

    it('CRNA bimodal triangulation routes to MANUAL-ESCALATION → legacy fallback', async () => {
      // Construct ≥4 IAS observations split bimodally → aggregateCell returns
      // confidence='manual_review_bimodal' → envelope tier=MANUAL-ESCALATION
      // → dispatcher falls through to legacy. We just check the source label
      // is the legacy BLS line, not the envelope line.
      const blsRow = blsCrnaRow('OH', 80)
      // Two clusters: low ~$70/hr, high ~$130/hr — wide enough for bimodal flag.
      const iasLow = (rate: number) => ({
        survey_name: 'ias_internal_2026',
        state: 'OH',
        census_division: null as string | null,
        employment_arrangement: 'locum_w2',
        rate_low: rate * 0.95,
        rate_median: rate,
        rate_high: rate * 1.05,
        n_respondents: 8,
        ingested_at: '2026-05-08T00:00:00Z',
        uhc_cut_applies: true,
      })
      supabaseState.rows = [
        blsRow,
        iasLow(70), iasLow(72), iasLow(73), iasLow(71),
        iasLow(130), iasLow(132), iasLow(133), iasLow(131),
      ]
      const med = BLS_OEWS_BASELINE['OH']?.['29-1151']?.medianHourly as number
      const expectedLegacy = med * LOCUM_MULTIPLIER.NURSE_ADVANCED
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'OH',
        displayedHourlyRate: Math.round(expectedLegacy), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.source).toMatch(/BLS 29-1151 state median/)
      expect(r.source).not.toMatch(/IAS empirical/)
    })

    it('CRNA envelope produces hard verdict for large overage', async () => {
      // BLS=$80, locum_w2=1.4, TX UHC-cut → expected=$95.2. Displayed $200 → +110% dev → hard.
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 200, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.verdict).toBe('hard')
      expect(r.expectedHourly!).toBeCloseTo(95.2, 1)
      expect(r.deviationPct!).toBeGreaterThan(100)
    })

    it('CRNA arrangement default is locum_w2 when arrangement omitted', async () => {
      // Verify default arrangement matches the IAS-booking convention from PLAN.md.
      // Without IAS rows → literature default 1.4 → expected ≈ $112/hr (CA exempt, no cut).
      supabaseState.rows = [blsCrnaRow('CA', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'CA',
        displayedHourlyRate: 112, isCallOnly: false,
        // arrangement omitted — must default to 'locum_w2' (1.4×)
      })
      expect(r.verdict).toBe('aligned')
      expect(r.expectedHourly!).toBeCloseTo(112.0, 1)
      expect(r.source).toMatch(/LOCUM_MULT=1\.40/)
    })

    it('CRNA 1099_independent arrangement uses 1.6× literature default', async () => {
      supabaseState.rows = [blsCrnaRow('CA', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'CA',
        displayedHourlyRate: 128, isCallOnly: false,
        arrangement: '1099_independent',
      })
      expect(r.verdict).toBe('aligned')
      // 80 × 1.6 = 128 (no UHC cut for CA)
      expect(r.expectedHourly!).toBeCloseTo(128.0, 1)
      expect(r.source).toMatch(/LOCUM_MULT=1\.60/)
    })

    it('M3 r1: band-aware halfWidth-pct is invariant under UHC scaling (UHC vs exempt at same BLS spread)', async () => {
      // M3 r1 fold (Codex 2026-05-08 Task 8 review): variance must scale by (locumMult × uhcFactor)²
      // so the post-UHC variance / post-UHC mean ratio (= halfWidth %) matches the exempt-state
      // ratio for the same underlying BLS spread. Pre-fold: variance scaled only by locumMult²
      // → post-UHC band was 1/uhcFactor (~17.6%) WIDER than the exempt-state band, under-alerting
      // overage in UHC-cut states. This test pins both states to the same hardThresholdPct.
      const blsTx = { ...blsCrnaRow('TX', 80), rate_low: 70, rate_high: 90 } // spread $20
      const blsCa = { ...blsCrnaRow('CA', 80), rate_low: 70, rate_high: 90 } // same spread
      // TX is non-exempt (UHC cut applies post-2025-10-01); CA is exempt.
      supabaseState.rows = [blsTx]
      const rTx = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 95, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      _resetCacheForTesting()
      supabaseState.rows = [blsCa]
      const rCa = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'CA',
        displayedHourlyRate: 112, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      // halfWidth-as-percent-of-expected MUST match between UHC-cut TX and exempt CA when the
      // underlying BLS spread is identical. Allow small floating-point tolerance.
      expect(rTx.isBandAware).toBe(true)
      expect(rCa.isBandAware).toBe(true)
      expect(rTx.hardThresholdPct).not.toBeNull()
      expect(rCa.hardThresholdPct).not.toBeNull()
      expect(rTx.hardThresholdPct!).toBeCloseTo(rCa.hardThresholdPct!, 4)
    })

    it('M1 r2: transient supabase failure does NOT poison cache (cooldown TTL recovers via real time advance)', async () => {
      // M1 r2 fold (Codex 2026-05-08 Task 8 round-2 review): a one-shot 503 must
      // NOT permanently downgrade every CRNA cell to legacy fallback. After the
      // RETRY_COOLDOWN_MS window elapses, a fresh fetch with healthy supabase
      // response populates the envelope cache.
      //
      // Task 9 N1 r3 hardening (2026-05-08): use vi.useFakeTimers +
      // advanceTimersByTime(RETRY_COOLDOWN_MS + ε) to drive the cooldown TTL
      // directly, instead of bypassing via _resetCacheForTesting() which masks
      // whether the timer logic actually works. This test now FAILS if anyone
      // breaks the Date.now()-based cooldown predicate (e.g., switches to a
      // counter or removes the date math).
      vi.useFakeTimers()
      try {
        const fromMock = vi.mocked(supabase.from)
        // Step 1: simulate transient 503 at fake-time T=0 → legacy fallback expected.
        // _lastFetchErrorAt stamped at Date.now() (the fake T=0).
        fromMock.mockReturnValueOnce({
          select: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({ data: null, error: new Error('simulated 503') }),
            ),
          })),
        } as never)
        const r1 = await evaluateBlsSanityCheck({
          specialtyKey: 'crna', state: 'CA',
          displayedHourlyRate: 200, isCallOnly: false,
        })
        // Legacy path source: /BLS 29-1151 state (median|mean ...)/
        // (CA 29-1151 medianHourly is null in baseline → mean fallback fires.)
        expect(r1.source).toMatch(/^BLS 29-1151 state/)
        expect(r1.source).not.toMatch(/IAS empirical/)

        // Step 2: still inside cooldown window (T = 5s) — populate healthy mock,
        // but the cooldown predicate must short-circuit and keep us on legacy.
        // This pin-tests that the cooldown actually inhibits the refetch.
        vi.advanceTimersByTime(5_000)
        supabaseState.rows = [{
          survey_name: 'bls_oews_29_1151_2024',
          state: 'CA',
          census_division: null,
          employment_arrangement: 'w2_employee',
          rate_low: 72,
          rate_median: 80,
          rate_high: 88,
          n_respondents: 500,
          ingested_at: '2026-05-08T00:00:00Z',
          uhc_cut_applies: false,
        }]
        const rMid = await evaluateBlsSanityCheck({
          specialtyKey: 'crna', state: 'CA',
          displayedHourlyRate: 112, isCallOnly: false,
          arrangement: 'locum_w2',
        })
        expect(rMid.source).toMatch(/^BLS 29-1151 state/)
        expect(rMid.source).not.toMatch(/IAS empirical/)

        // Step 3: advance past RETRY_COOLDOWN_MS (T = 5s + 30s + 1ms = 30.001s).
        // Cooldown predicate now returns false → loader refetches → success path
        // populates _cache → envelope active.
        vi.advanceTimersByTime(RETRY_COOLDOWN_MS + 1)
        const r2 = await evaluateBlsSanityCheck({
          specialtyKey: 'crna', state: 'CA',
          displayedHourlyRate: 112, isCallOnly: false,
          arrangement: 'locum_w2',
        })
        // Envelope path active again — source is the v4 BLS+IAS empirical line.
        expect(r2.source).toMatch(/BLS 29-1151 \+ IAS empirical/)
        expect(r2.expectedHourly!).toBeCloseTo(112.0, 1) // 80 × 1.4 (CA exempt)
      } finally {
        vi.useRealTimers()
      }
    })

    it('M2 r1: supabase fetch error falls through to legacy path (no thrown rejection)', async () => {
      // M2 r1 fold (Codex 2026-05-08 Task 8 review): a supabase error must NOT propagate
      // out of evaluateBlsSanityCheck. Override the mock to return an error envelope; the
      // engine should commit an empty cache, hit MANUAL-ESCALATION on the missing BLS row,
      // and fall through to the legacy BLS+LOCUM_MULTIPLIER path.
      // Find the mocked `from` function and re-tune `eq` to return an error response just
      // for this test. Cleanup: beforeEach() runs supabaseState.rows = [] AND
      // _resetCacheForTesting() so cache state doesn't leak.
      const fromMock = vi.mocked(supabase.from)
      fromMock.mockReturnValueOnce({
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({ data: null, error: new Error('simulated supabase 503') }),
          ),
        })),
      } as never)
      const med = BLS_OEWS_BASELINE['KS']?.['29-1151']?.medianHourly
      expect(med, 'KS 29-1151 median required for legacy fallback path').not.toBeNull()
      const expected = (med as number) * LOCUM_MULTIPLIER.NURSE_ADVANCED
      // Should not throw — must produce a verdict.
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'KS',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      // Source label is the legacy path's, not the envelope's.
      expect(r.source).toMatch(/BLS 29-1151 state median/)
      expect(r.source).not.toMatch(/IAS empirical/)
    })
  })

  // === B.7.1 v4 Task 9 — crnaEnvelope payload ===
  // Path B (extend BlsSanityCheckResult interface) verification. The UI
  // tier-badge consumer reads result.crnaEnvelope directly instead of
  // regex-parsing result.source. These tests pin the payload contract:
  //   • populated only when evaluateCrnaCheck produces a non-null result
  //   • undefined for legacy path (non-CRNA) AND CRNA fallback (empty cache)
  //   • undefined for early-return unavailable verdicts
  //   • tier transitions across PUBLIC-HINT / DERIVED / MULTI-SOURCE / HIGH
  //     match assignTier() invariants in crnaCellLookup.ts:313-327.
  describe('evaluateBlsSanityCheck — crnaEnvelope payload (Task 9)', () => {
    const blsCrnaRow = (state: string, rateMedian: number = 80) => ({
      survey_name: 'bls_oews_29_1151_2024',
      state,
      census_division: null as string | null,
      employment_arrangement: 'w2_employee',
      rate_low: rateMedian * 0.9,
      rate_median: rateMedian,
      rate_high: rateMedian * 1.1,
      n_respondents: 500,
      ingested_at: '2026-05-08T00:00:00Z',
      uhc_cut_applies: !['AR', 'CA', 'CO', 'HI', 'MA', 'NH', 'WY'].includes(state),
    })

    it('PUBLIC-HINT tier: BLS-only state populates crnaEnvelope with literature LOCUM_MULT and zero booking counts', async () => {
      // No IAS rows → tier defaults to PUBLIC-HINT, locumMult is the literature
      // default for locum_w2 (1.4). TX is non-exempt → uhcCutApplied=true.
      // M1 r2 fold: iasStateBookings + iasDivisionBookings both 0.
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 95, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.crnaEnvelope).toBeDefined()
      expect(r.crnaEnvelope!.tier).toBe('PUBLIC-HINT')
      expect(r.crnaEnvelope!.nSurvivors).toBe(0)
      expect(r.crnaEnvelope!.iasStateBookings).toBe(0)
      expect(r.crnaEnvelope!.iasDivisionBookings).toBe(0)
      expect(r.crnaEnvelope!.locumMult).toBeCloseTo(1.4, 4)
      expect(r.crnaEnvelope!.uhcCutApplied).toBe(true)
      expect(r.crnaEnvelope!.sourceAttribution).toContain('bls_oews_29_1151_2024')
    })

    it('DERIVED tier: BLS + division-anchored IAS rows (n>=10) populates crnaEnvelope with division bookings', async () => {
      // State-level n=0; division-level n>=10 → DERIVED per assignTier.
      // TX → WSC division. State=null + census_division='WSC' anchors row to division.
      // M1 r2 fold: iasDivisionBookings=12 (the n_respondents value), iasStateBookings=0.
      supabaseState.rows = [
        blsCrnaRow('TX', 80),
        {
          survey_name: 'ias_internal_2026',
          state: null,
          census_division: 'WSC',
          employment_arrangement: 'locum_w2',
          rate_low: 100,
          rate_median: 110,
          rate_high: 120,
          n_respondents: 12,
          ingested_at: '2026-05-08T00:00:00Z',
          uhc_cut_applies: true,
        },
      ]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 95, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.crnaEnvelope).toBeDefined()
      expect(r.crnaEnvelope!.tier).toBe('DERIVED')
      // Division-anchored observation passes rowsToObservations filter, so n_survivors=1
      // — but the booking count is 12 (the underlying n_respondents).
      expect(r.crnaEnvelope!.nSurvivors).toBe(1)
      expect(r.crnaEnvelope!.iasStateBookings).toBe(0)
      expect(r.crnaEnvelope!.iasDivisionBookings).toBe(12)
      expect(r.crnaEnvelope!.uhcCutApplied).toBe(true)
      expect(r.crnaEnvelope!.sourceAttribution).toEqual(
        expect.arrayContaining(['bls_oews_29_1151_2024', 'ias_internal_2026']),
      )
    })

    it('MULTI-SOURCE tier: BLS + state-anchored IAS row (n>=5) populates iasStateBookings>=5', async () => {
      // iasStateBookings=5, distinctSources=2 → MULTI-SOURCE per assignTier.
      // M1 r2 fold: iasStateBookings=5 (sum of n_respondents); state-anchored
      // TX row also counts toward division (TX→WSC), so iasDivisionBookings=5 too.
      supabaseState.rows = [
        blsCrnaRow('TX', 80),
        {
          survey_name: 'ias_internal_2026',
          state: 'TX',
          census_division: null,
          employment_arrangement: 'locum_w2',
          rate_low: 100,
          rate_median: 112,
          rate_high: 124,
          n_respondents: 5,
          ingested_at: '2026-05-08T00:00:00Z',
          uhc_cut_applies: true,
        },
      ]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 95, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.crnaEnvelope).toBeDefined()
      expect(r.crnaEnvelope!.tier).toBe('MULTI-SOURCE')
      expect(r.crnaEnvelope!.iasStateBookings).toBe(5)
      // State-anchored TX row also counts in division (TX→WSC) per the
      // column-anchored predicate at crnaCellLookup.ts iasDivisionRows filter.
      expect(r.crnaEnvelope!.iasDivisionBookings).toBe(5)
      // BLS + 1 IAS row in attribution
      expect(r.crnaEnvelope!.sourceAttribution).toEqual(
        expect.arrayContaining(['bls_oews_29_1151_2024', 'ias_internal_2026']),
      )
      expect(r.crnaEnvelope!.sourceAttribution.length).toBeGreaterThanOrEqual(2)
    })

    it('HIGH tier: BLS + 2 distinct state-anchored IAS sources (n>=10) populates iasStateBookings>=10', async () => {
      // iasStateBookings=12, distinctSources>=2 → HIGH per assignTier.
      // M1 r2 fold: nSurvivors=2 (rows) but iasStateBookings=12 (booking count) —
      // this test pins the semantic distinction the M1 r2 fold corrects.
      supabaseState.rows = [
        blsCrnaRow('TX', 80),
        {
          survey_name: 'ias_internal_2026',
          state: 'TX',
          census_division: null,
          employment_arrangement: 'locum_w2',
          rate_low: 100,
          rate_median: 110,
          rate_high: 120,
          n_respondents: 7,
          ingested_at: '2026-05-08T00:00:00Z',
          uhc_cut_applies: true,
        },
        {
          survey_name: 'ias_external_survey_2026',
          state: 'TX',
          census_division: null,
          employment_arrangement: 'locum_w2',
          rate_low: 105,
          rate_median: 113,
          rate_high: 121,
          n_respondents: 5,
          ingested_at: '2026-05-08T00:00:00Z',
          uhc_cut_applies: true,
        },
      ]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 95, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.crnaEnvelope).toBeDefined()
      expect(r.crnaEnvelope!.tier).toBe('HIGH')
      expect(r.crnaEnvelope!.nSurvivors).toBe(2) // 2 observation rows
      expect(r.crnaEnvelope!.iasStateBookings).toBe(12) // 7 + 5 booking-count
      expect(r.crnaEnvelope!.iasDivisionBookings).toBe(12) // same rows count via division
      expect(r.crnaEnvelope!.sourceAttribution).toEqual(
        expect.arrayContaining([
          'bls_oews_29_1151_2024',
          'ias_internal_2026',
          'ias_external_survey_2026',
        ]),
      )
    })

    it('CRNA UHC-exempt state populates crnaEnvelope with uhcCutApplied=false', async () => {
      // CA is in UHC_EXEMPT_STATES → no cut even post-2025-10-01. The envelope
      // payload's uhcCutApplied bit must reflect this so UI tooltips/audit logs
      // never claim a cut was applied when it wasn't.
      supabaseState.rows = [blsCrnaRow('CA', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'CA',
        displayedHourlyRate: 112, isCallOnly: false,
        arrangement: 'locum_w2',
        dateOfService: new Date('2026-01-01T00:00:00Z'),
      })
      expect(r.crnaEnvelope).toBeDefined()
      expect(r.crnaEnvelope!.uhcCutApplied).toBe(false)
    })

    it('legacy path (non-CRNA) leaves crnaEnvelope undefined', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'family medicine', state: 'OH',
        displayedHourlyRate: 167, isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.crnaEnvelope).toBeUndefined()
    })

    it('CRNA fallback path (empty cache → MANUAL-ESCALATION → legacy) leaves crnaEnvelope undefined', async () => {
      // No bls_oews row in supabase → envelope returns MANUAL-ESCALATION →
      // evaluateCrnaCheck returns null → dispatcher falls through to legacy.
      // Legacy path doesn't populate crnaEnvelope.
      supabaseState.rows = []
      const med = BLS_OEWS_BASELINE['KS']?.['29-1151']?.medianHourly
      expect(med, 'KS 29-1151 median required').toBeTruthy()
      const expected = (med as number) * LOCUM_MULTIPLIER.NURSE_ADVANCED
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'KS',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.crnaEnvelope).toBeUndefined()
    })

    it('CRNA early-return unavailable (call-daily-mode) leaves crnaEnvelope undefined', async () => {
      supabaseState.rows = [blsCrnaRow('TX', 80)]
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: 'TX',
        displayedHourlyRate: 250, isCallOnly: true,
      })
      expect(r.verdict).toBe('unavailable')
      expect(r.reason).toBe('call-daily-mode')
      expect(r.crnaEnvelope).toBeUndefined()
    })
  })

  // === Non-CRNA snapshot regression — verify legacy path BYTE-IDENTICAL ===
  // Ensures Task 8's dispatcher refactor doesn't accidentally change non-CRNA
  // verdicts. Spot-checks four high-traffic specialty/state combos against the
  // pre-Task-8 calculation. If LOCUM_MULTIPLIER drift, BLS_OEWS_BASELINE drift,
  // or threshold drift fires, these tests will surface it.
  describe('evaluateBlsSanityCheck — non-CRNA snapshot regression (Task 8 wire-in)', () => {
    it('family medicine + OH @ $167 lands aligned via legacy (29-1215)', async () => {
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'family medicine', state: 'OH',
        displayedHourlyRate: 167, isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.socUsed).toBe('29-1215')
      expect(r.source).toMatch(/state median$/)
    })

    it('internal medicine + CT @ aligned legacy (29-1216 / PHYSICIAN_LOW)', async () => {
      // S2 r1 fold (Codex 2026-05-08 Task 8 review): assert the BLS baseline row
      // is non-null OUTSIDE the if-guard so a future fixture suppression
      // surfaces as a test failure, not a silent skip. State chosen per
      // runtime BLS_OEWS_BASELINE scan: CT is the first state with non-null
      // 29-1216 medianHourly (CA/TX/NY/FL all suppressed for this SOC).
      // SPECIALTY_TO_SOC: 'internal medicine' → primarySOC 29-1216 + family
      // PHYSICIAN_LOW (1.35×) — see blsSanityCheck.ts:106.
      const med = BLS_OEWS_BASELINE['CT']?.['29-1216']?.medianHourly
      expect(med, 'CT 29-1216 median must be non-null for non-CRNA snapshot regression').not.toBeNull()
      const expected = (med as number) * LOCUM_MULTIPLIER.PHYSICIAN_LOW
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'internal medicine', state: 'CT',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.socUsed).toBe('29-1216')
    })

    it('emergency medicine + AK legacy path (29-1214 / PHYSICIAN_CORE)', async () => {
      // SPECIALTY_TO_SOC maps 'emergency medicine' → primarySOC 29-1214 +
      // family PHYSICIAN_CORE (NOT PHYSICIAN_EM_HIGH — that family is reserved
      // for em nocturnist + rural emergency medicine per blsSanityCheck.ts:123-125).
      // S2 r1 fold: state chosen via runtime BLS scan — AK is the first state
      // with non-null 29-1214 medianHourly (TX/FL/CA all suppressed).
      const med = BLS_OEWS_BASELINE['AK']?.['29-1214']?.medianHourly
      expect(med, 'AK 29-1214 median must be non-null for non-CRNA snapshot regression').not.toBeNull()
      const expected = (med as number) * LOCUM_MULTIPLIER.PHYSICIAN_CORE
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'emergency medicine', state: 'AK',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.socUsed).toBe('29-1214')
    })

    it('anesthesiology + NY legacy path (29-1211)', async () => {
      // S2 r1 fold: assert the BLS baseline row is non-null OUTSIDE the if-guard.
      const med = BLS_OEWS_BASELINE['NY']?.['29-1211']?.medianHourly
      expect(med, 'NY 29-1211 median must be non-null for non-CRNA snapshot regression').not.toBeNull()
      const expected = (med as number) * LOCUM_MULTIPLIER.PHYSICIAN_HIGH_PREMIUM
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'anesthesiology', state: 'NY',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned')
      expect(r.socUsed).toBe('29-1211')
    })
  })

  describe('per-specialty CRNA over-quote ceiling (OBS-03)', () => {
    it('MAX_HOURLY_CEILING.crna mirrors the Python IronDome ceiling ($250)', () => {
      expect(MAX_HOURLY_CEILING.crna).toBe(250)
    })

    // Find a CRNA state whose legacy expectedHourly sits where a >$250 rate is still
    // within the BLS band — so the 'hard' verdict can ONLY come from the ceiling, not
    // the band deviation. (CRNA runs the legacy path here: empty rows -> MANUAL-ESCALATION.)
    const NURSE = LOCUM_MULTIPLIER.NURSE_ADVANCED
    const ceilingState = Object.keys(BLS_OEWS_BASELINE).find((st) => {
      const med = BLS_OEWS_BASELINE[st]?.['29-1151']?.medianHourly
      if (med == null) return false
      const expected = med * NURSE
      return expected >= 200 && expected <= 248
    })

    it('a CRNA rate above the $250 ceiling trips hard even when the BLS band would not', async () => {
      expect(ceilingState, 'need a CRNA state with legacy expectedHourly in [200,248]').toBeDefined()
      const over = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: ceilingState!,
        displayedHourlyRate: 256, isCallOnly: false,
      })
      expect(over.verdict).toBe('hard')
      // Proof it is the CEILING, not the band: the deviation is within the hard threshold,
      // so the band verdict alone would NOT be hard.
      expect(Math.abs(over.deviationPct!)).toBeLessThanOrEqual(over.hardThresholdPct!)
    })

    it('a CRNA rate at/below the $250 ceiling is NOT escalated by the ceiling', async () => {
      expect(ceilingState).toBeDefined()
      const under = await evaluateBlsSanityCheck({
        specialtyKey: 'crna', state: ceilingState!,
        displayedHourlyRate: 242, isCallOnly: false,
      })
      expect(under.verdict).not.toBe('hard')
    })

    it('the ceiling is additive — a non-CRNA specialty has no ceiling and is unaffected', async () => {
      expect(MAX_HOURLY_CEILING.anesthesiology).toBeUndefined()
      // A high anesthesiology rate is governed by the BLS band only (no ceiling entry).
      const med = BLS_OEWS_BASELINE['NY']?.['29-1211']?.medianHourly
      const expected = (med as number) * LOCUM_MULTIPLIER.PHYSICIAN_HIGH_PREMIUM
      const r = await evaluateBlsSanityCheck({
        specialtyKey: 'anesthesiology', state: 'NY',
        displayedHourlyRate: Math.round(expected), isCallOnly: false,
      })
      expect(r.verdict).toBe('aligned') // unchanged by the ceiling addition
    })
  })
})
