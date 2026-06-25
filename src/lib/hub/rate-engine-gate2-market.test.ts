import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CalibrationEntry, SpecialtyCalibration } from '../rate-engine/marketRates'
import { SPECIALTIES, type SpecialtyRate } from '../rate-engine/specialties'

// Mutable per-test feedback snapshot. Each test sets `currentSnapshot` then
// calls loadSpecialtyCalibration; vi.hoisted lets the mock factory close over
// the live binding instead of a baked-in value.
const state = vi.hoisted(() => ({
  current: {} as Record<string, Partial<CalibrationEntry>>,
}))

vi.mock('firebase/database', () => ({
  ref: vi.fn(),
  get: vi.fn(() => Promise.resolve({
    exists: () => Object.keys(state.current).length > 0,
    val: () => state.current,
  })),
}))

// (hub gate-2: no config/firebase module — db handle injected via the runtime seam below)

import {
  loadSpecialtyCalibration,
  inferLegacyRateMode,
  computeDisplayedRate,
  computeDisplayedBill,
  sourceFamily,
  loadMarketRates,
} from '../rate-engine/marketRates'
// HUB GATE-2 ADAPTATION: marketRates reads the Firebase RTDB handle via the
// ./runtime seam; firebase/database ref/get stay mocked (above). No config/firebase
// module in the hub, so inject an inline mock db ({}). This is the D-39 rate-type
// precedence + calibration layer — assertions are the dashboard suite VERBATIM.
import { configureEngine } from '../rate-engine/runtime'
const db = {}
configureEngine({ db: db as never })

function calibration(overrides: Partial<SpecialtyCalibration> = {}): SpecialtyCalibration {
  return {
    entries: [],
    avgAccuracy: 95,
    avgDelta: 0,
    sampleSize: 5,
    adjustment: 1.0,
    ...overrides,
  }
}

function entry(overrides: Partial<CalibrationEntry>): CalibrationEntry {
  return {
    specialty: 'crna',
    state: 'TX',
    simulatedRate: 200,
    acceptedRate: 210,
    accuracy: 95,
    submittedBy: 'test',
    notes: '',
    timestamp: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  state.current = {}
})

describe('inferLegacyRateMode (S3 + Codex C-3 / H-8)', () => {
  it('returns explicit rateMode when present', () => {
    expect(inferLegacyRateMode(entry({ rateMode: 'hourly', simulatedRate: 9999 }))).toBe('hourly')
    expect(inferLegacyRateMode(entry({ rateMode: 'call_daily', simulatedRate: 50 }))).toBe('call_daily')
  })

  it('classifies legacy entry below $1000 as hourly', () => {
    expect(inferLegacyRateMode(entry({ simulatedRate: 230, acceptedRate: 250 }))).toBe('hourly')
  })

  it('classifies legacy entry at the $1000 threshold as call_daily (>= boundary)', () => {
    expect(inferLegacyRateMode(entry({ simulatedRate: 1000, acceptedRate: 1100 }))).toBe('call_daily')
  })

  it('classifies legacy entry just below $1000 as hourly (boundary lock for H-8)', () => {
    // Codex H-8 raised the threshold from $500 to $1000. A $999 entry would
    // have been call_daily under v2; under v3 it correctly stays hourly.
    expect(inferLegacyRateMode(entry({ simulatedRate: 999, acceptedRate: 999 }))).toBe('hourly')
  })

  it('classifies as call_daily when EITHER simulatedRate or acceptedRate hits the floor', () => {
    // Asymmetric magnitude — sim under, accepted over: real-world scenario
    // where the call-only stipend was negotiated up after a low simulated bid.
    expect(inferLegacyRateMode(entry({ simulatedRate: 500, acceptedRate: 1500 }))).toBe('call_daily')
    expect(inferLegacyRateMode(entry({ simulatedRate: 2000, acceptedRate: 800 }))).toBe('call_daily')
  })
})

describe('loadSpecialtyCalibration rateMode filter (S3)', () => {
  it('default rateMode is hourly when not specified (backwards-compat)', async () => {
    state.current = {
      a: entry({ rateMode: 'hourly', simulatedRate: 220, timestamp: 100 }),
      b: entry({ rateMode: 'call_daily', simulatedRate: 2000, timestamp: 200 }),
    }
    const c = await loadSpecialtyCalibration('crna')
    expect(c.entries.length).toBe(1)
    expect(c.entries[0].timestamp).toBe(100)
  })

  it('hourly bucket includes explicit hourly + legacy hourly-magnitude (< $1000)', async () => {
    state.current = {
      a: entry({ rateMode: 'hourly', simulatedRate: 220, timestamp: 100 }),
      b: entry({ rateMode: 'call_daily', simulatedRate: 2000, timestamp: 200 }),
      c: entry({ simulatedRate: 230, acceptedRate: 250, timestamp: 300 }), // legacy hourly
      d: entry({ simulatedRate: 1800, acceptedRate: 2000, timestamp: 400 }), // legacy daily
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.entries.length).toBe(2)
    expect(c.entries.map(e => e.timestamp).sort()).toEqual([100, 300])
  })

  it('call_daily bucket includes explicit call_daily + legacy call_daily-magnitude (>= $1000)', async () => {
    state.current = {
      a: entry({ rateMode: 'hourly', simulatedRate: 220, timestamp: 100 }),
      b: entry({ rateMode: 'call_daily', simulatedRate: 2000, timestamp: 200 }),
      c: entry({ simulatedRate: 230, acceptedRate: 250, timestamp: 300 }),
      d: entry({ simulatedRate: 1800, acceptedRate: 2000, timestamp: 400 }),
    }
    const c = await loadSpecialtyCalibration('crna', 'call_daily')
    expect(c.entries.length).toBe(2)
    expect(c.entries.map(e => e.timestamp).sort()).toEqual([200, 400])
  })

  it('contamination guard: legacy daily-magnitude entry never appears in hourly bucket (Codex C-3)', async () => {
    state.current = {
      // All four entries are 'crna' but only the hourly-magnitude one belongs in the hourly bucket.
      legacyDaily: entry({ simulatedRate: 1800, acceptedRate: 2000, timestamp: 100 }),
      legacyHourly: entry({ simulatedRate: 230, acceptedRate: 250, timestamp: 200 }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    const dailyIntruder = c.entries.find(e => e.simulatedRate >= 1000 || e.acceptedRate >= 1000)
    expect(dailyIntruder).toBeUndefined()
    expect(c.entries.length).toBe(1)
    expect(c.entries[0].timestamp).toBe(200)
  })

  it('returns empty calibration when no entries match the requested mode', async () => {
    state.current = {
      a: entry({ rateMode: 'call_daily', simulatedRate: 2000, timestamp: 100 }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.entries.length).toBe(0)
    expect(c.sampleSize).toBe(0)
    expect(c.adjustment).toBe(1.0)
  })

  it('filters by specialty independently of rateMode', async () => {
    state.current = {
      a: entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, timestamp: 100 }),
      b: entry({ specialty: 'er', rateMode: 'hourly', simulatedRate: 350, timestamp: 200 }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.entries.length).toBe(1)
    expect(c.entries[0].specialty).toBe('crna')
  })

  // Regression test for the original S3 bug (Codex SHOULD-1 fold-in, round-2
  // NIT-tightened). Earlier draft framed this as "would hit the clamp" but
  // the chosen fixture only diverged the post-fix adjustment by ~0.2 cents,
  // which `toBeCloseTo(_, 2)` couldn't distinguish — Codex caught that the
  // assertion was actually locked by sampleSize, not adjustment. Redesigned:
  // daily entries now carry massive +100% bias (1500 → 3000). Mixed pre-fix,
  // the recentAvgRatio = avg(230/220, 3000/1500) = (1.0455 + 2.0) / 2 = 1.523,
  // dampened to 1.26, clamped to the 1.15 ceiling — wildly mis-calibrating
  // every hourly rate in the specialty. Post-fix, hourly sees only its own
  // 230/220 entries → 1.023, comfortably below the clamp. Daily (correctly)
  // hits its own clamp, but the contamination is contained to its bucket.
  it('adjustment is computed AFTER mode filtering (locks the original clamp bug)', async () => {
    state.current = {
      h1: entry({ rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100 }),
      h2: entry({ rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 200 }),
      h3: entry({ rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 300 }),
      d1: entry({ rateMode: 'call_daily', simulatedRate: 1500, acceptedRate: 3000, timestamp: 400 }),
      d2: entry({ rateMode: 'call_daily', simulatedRate: 1500, acceptedRate: 3000, timestamp: 500 }),
      d3: entry({ rateMode: 'call_daily', simulatedRate: 1500, acceptedRate: 3000, timestamp: 600 }),
    }

    const hourly = await loadSpecialtyCalibration('crna', 'hourly')
    expect(hourly.sampleSize).toBe(3)
    // 230/220 = 1.0455; dampen 50% → 1.0227.
    expect(hourly.adjustment).toBeCloseTo(1.023, 2)
    // Tight upper bound proves the clamp wasn't reached. Pre-fix, mixed
    // contamination would have pinned this exactly to 1.15.
    expect(hourly.adjustment).toBeLessThan(1.10)

    const daily = await loadSpecialtyCalibration('crna', 'call_daily')
    expect(daily.sampleSize).toBe(3)
    // 3000/1500 = 2.0; dampen 50% → 1.50; clamp → 1.15. Daily has wild bias
    // and correctly hits the clamp — but the contamination is contained;
    // the hourly bucket above never saw these numbers.
    expect(daily.adjustment).toBe(1.15)
  })
})

describe('computeDisplayedRate (S4 — page-level calibration helper)', () => {
  it('returns raw rate untouched when calibration is null', () => {
    const r = computeDisplayedRate(220, null)
    expect(r.payRate).toBe(220)
    expect(r.adjusted).toBe(false)
    expect(r.adjustmentPct).toBe(0)
    expect(r.rawPayRate).toBe(220)
  })

  it('returns raw rate when calibration has insufficient samples (adjustment === 1.0)', () => {
    // applyCalibration's threshold: sampleSize < 3 OR adjustment === 1.0 → no-op.
    const r = computeDisplayedRate(220, calibration({ sampleSize: 2, adjustment: 1.10 }))
    expect(r.payRate).toBe(220)
    expect(r.adjusted).toBe(false)
    expect(r.adjustmentPct).toBe(0)
    expect(r.rawPayRate).toBe(220)
  })

  it('returns adjusted rate + flag + pct when calibration would adjust', () => {
    const r = computeDisplayedRate(200, calibration({ sampleSize: 5, adjustment: 1.10 }))
    expect(r.payRate).toBe(220) // 200 * 1.10
    expect(r.adjusted).toBe(true)
    expect(r.adjustmentPct).toBe(10)
    expect(r.rawPayRate).toBe(200)
  })

  it('handles negative adjustment (overestimate correction)', () => {
    const r = computeDisplayedRate(220, calibration({ sampleSize: 5, adjustment: 0.92 }))
    expect(r.payRate).toBe(202) // 220 * 0.92 = 202.4 → round → 202
    expect(r.adjusted).toBe(true)
    expect(r.adjustmentPct).toBe(-8)
    expect(r.rawPayRate).toBe(220)
  })

  it('rawPayRate always preserves the input value (disclosure UI relies on this)', () => {
    // Even if calibration wildly adjusts, rawPayRate must equal the input —
    // RateResults shows "raw model says $X" alongside the calibrated hero.
    const r = computeDisplayedRate(217, calibration({ sampleSize: 5, adjustment: 1.15 }))
    expect(r.rawPayRate).toBe(217)
    expect(r.payRate).not.toBe(217)
  })

  // Accuracy audit 2026-06-01: the researched-range ceiling must ALSO bind the
  // displayed (post-calibration) value, or a positive calibration would push the
  // hero above the researched max while the UI claims it was "bounded".
  it('audit: clamps a positive calibration to the researched marketMax + reports the NET visible pct', () => {
    // 200 × 1.15 = 230, but researched max is 220 → displayed clamps to 220.
    // The badge pct must report the NET visible uplift (+10%, 200→220), NOT the
    // raw +15% calibration delta (Codex r2 — partial-clamp badge math).
    const r = computeDisplayedRate(200, calibration({ sampleSize: 5, adjustment: 1.15 }), { marketMax: 220 })
    expect(r.payRate).toBe(220)
    expect(r.marketMaxApplied).toBe(true)
    expect(r.rawPayRate).toBe(200)
    expect(r.adjusted).toBe(true)
    expect(r.adjustmentPct).toBe(10)  // net (220-200)/200, not the raw 15
  })

  it('audit: reports not-adjusted when the clamp fully swallows the uplift', () => {
    // raw already AT max (220), +15% → clamped back to 220 → no net change.
    const r = computeDisplayedRate(220, calibration({ sampleSize: 5, adjustment: 1.15 }), { marketMax: 220 })
    expect(r.payRate).toBe(220)
    expect(r.adjusted).toBe(false)
    expect(r.adjustmentPct).toBe(0)
    expect(r.marketMaxApplied).toBe(true)
  })

  it('audit: negative calibration applies freely under marketMax (no clamp)', () => {
    const r = computeDisplayedRate(220, calibration({ sampleSize: 5, adjustment: 0.92 }), { marketMax: 250 })
    expect(r.payRate).toBe(202)  // 220 × 0.92 → 202, below max
    expect(r.marketMaxApplied).toBe(false)
    expect(r.adjusted).toBe(true)
  })

  it('audit: omitting marketMax leaves behavior unchanged (backward compatible)', () => {
    const r = computeDisplayedRate(200, calibration({ sampleSize: 5, adjustment: 1.15 }))
    expect(r.payRate).toBe(230)  // unclamped
    expect(r.marketMaxApplied).toBeFalsy()
  })

  it('audit: display ceiling binds even with null calibration (defense in depth)', () => {
    const r = computeDisplayedRate(300, null, { marketMax: 250 })
    expect(r.payRate).toBe(250)
    expect(r.marketMaxApplied).toBe(true)
  })

  // Round-6 MUST: when the engine has clamped pay to a hard cap, a positive
  // calibration delta would silently push the displayed number past the cap —
  // re-leaking the margin the cap exists to prevent. Clamp upward only;
  // negative deltas still apply because they stay at or below the cap.
  it('round-6: clamps positive calibration when source rate was capped', () => {
    const r = computeDisplayedRate(
      350,
      calibration({ sampleSize: 5, adjustment: 1.15 }),
      { capped: true },
    )
    // Pre-clamp would have been 350 * 1.15 = 402.5 → 403. With opts.capped,
    // we drop the adjustment instead of breaching the engine cap.
    expect(r.payRate).toBe(350)
    expect(r.adjusted).toBe(false)
    expect(r.adjustmentPct).toBe(0)
    expect(r.rawPayRate).toBe(350)
  })

  it('round-6: negative calibration still applies when source rate was capped', () => {
    // Negative deltas keep displayed at or below the cap — safe to apply.
    // Without this, capped specialties would freeze at the cap and ignore
    // overestimation feedback, biasing the simulator high over time.
    const r = computeDisplayedRate(
      350,
      calibration({ sampleSize: 5, adjustment: 0.92 }),
      { capped: true },
    )
    expect(r.payRate).toBe(322) // 350 * 0.92 = 322
    expect(r.adjusted).toBe(true)
    expect(r.adjustmentPct).toBe(-8)
    expect(r.rawPayRate).toBe(350)
  })

  it('round-6: positive calibration applies normally when source rate was NOT capped', () => {
    // Regression guard — the cap clamp must only fire when opts.capped is
    // true. Uncapped rates with positive bias are the simulator's whole
    // calibration story and must keep working.
    const r = computeDisplayedRate(
      200,
      calibration({ sampleSize: 5, adjustment: 1.10 }),
      { capped: false },
    )
    expect(r.payRate).toBe(220) // 200 * 1.10
    expect(r.adjusted).toBe(true)
    expect(r.adjustmentPct).toBe(10)
    expect(r.rawPayRate).toBe(200)
  })
})

// Tiny test helper: build a DisplayedRate from a raw pay number. Tests below
// pass DisplayedRate (not raw number) per the Codex S4 NIT signature.
function displayed(payRate: number) {
  return { payRate, adjusted: false, adjustmentPct: 0, rawPayRate: payRate }
}

describe('computeDisplayedBill (S4 — preserves bill = roundUp5(pay/0.80) invariant)', () => {
  it('computes bill from displayed pay directly, not by ratio scaling (Codex C-2)', () => {
    // Original buggy approach: scale a pre-rounded billRate by adjustmentRatio
    // and re-round → off by 0-4 dollars per row. This helper bypasses that.
    // 220 / 0.80 = 275 → roundUp5 → 275.
    expect(computeDisplayedBill(displayed(220))).toBe(275)
  })

  it('rounds UP to nearest $5 — not nearest, not down', () => {
    // 214 / 0.80 = 267.5 → roundUp5 → 270 (NOT 265).
    expect(computeDisplayedBill(displayed(214))).toBe(270)
  })

  it('matches the simulator invariant under a calibrated input', () => {
    // computeDisplayedRate(200, +7%) → 214; computeDisplayedBill(r) → 270.
    // Verifies the helper composes cleanly with the calibration helper.
    // Pass r directly — DisplayedRate flows through both helpers without
    // unwrapping back to a raw number.
    const r = computeDisplayedRate(200, calibration({ sampleSize: 5, adjustment: 1.07 }))
    expect(r.payRate).toBe(214) // 200 * 1.07
    expect(computeDisplayedBill(r)).toBe(270) // 214 / 0.80 = 267.5 → 270
  })

  it('preserves invariant for already-aligned values (no double-rounding drift)', () => {
    // 200 / 0.80 = 250 → exact multiple of 5 → 250. Edge case where naive
    // rounding could over-round to 255.
    expect(computeDisplayedBill(displayed(200))).toBe(250)
  })
})

// T15a Codex MUST 4 round-2 (2026-04-29). When MUST 4 split payRateCapped
// from the umbrella `capped`, calibration started running on assignments
// where only breakdown rows were at-cap. The display layer multiplies each
// breakdown row by the calibration ratio — which would push at-cap rows
// over the cap. This helper re-clamps post-multiply.
describe('applyCalibrationToBreakdownPay (MUST 4 round-2 — clamp post-calibration)', () => {
  it('clamps a positive-calibration row that would breach the cap', async () => {
    const { applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    // Hero=1800 calibrated to 1980 (+10%). Weekend already at-cap=2000.
    // Naive ratio multiply: 2000*1.10 = 2200 (BREACH). Helper clamps to 2000.
    expect(applyCalibrationToBreakdownPay(2000, 1.10, 2000)).toBe(2000)
  })

  it('lets sub-cap rows scale by ratio (no spurious clamp)', async () => {
    const { applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    expect(applyCalibrationToBreakdownPay(1800, 1.10, 2000)).toBe(1980)
  })

  it('passes through unchanged when ratio = 1.0 (calibration not in effect)', async () => {
    const { applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    expect(applyCalibrationToBreakdownPay(1800, 1.0, 2000)).toBe(1800)
    expect(applyCalibrationToBreakdownPay(2000, 1.0, 2000)).toBe(2000)
  })

  it('does not clamp when payCap is null (no cap binds on this assignment)', async () => {
    const { applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    expect(applyCalibrationToBreakdownPay(2000, 1.10, null)).toBe(2200)
  })

  it('still clamps under negative calibration if value would somehow exceed cap', async () => {
    const { applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    // Pathological: ratio < 1 — clamp still safe to apply (defense-in-depth).
    // 2000 * 0.95 = 1900 → no clamp.
    expect(applyCalibrationToBreakdownPay(2000, 0.95, 2000)).toBe(1900)
  })

  it('rounds the calibrated value to whole dollars before cap-check', async () => {
    const { applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    // 1995 * 1.05 = 2094.75 → round → 2095 → above cap=2000 → clamp.
    expect(applyCalibrationToBreakdownPay(1995, 1.05, 2000)).toBe(2000)
    // 1995 * 1.0025 = 1999.99... → round → 2000 → at-cap → no breach (<=).
    expect(applyCalibrationToBreakdownPay(1995, 1.0025, 2000)).toBe(2000)
  })
})

// === T15a-followup (drift-prevention helper) ===
// RateResults.tsx and BillRateCalculator.tsx previously duplicated the EXACT
// same 4-line pattern (ratio derivation + lambda binding the cap). A future
// change to the formula in one site would silently diverge from the other —
// exactly the drift risk Codex T15a round-2 flagged. buildBreakdownPayCalibrator
// is the single source of truth; both components now delegate so the math
// can only be wrong in one place.
describe('buildBreakdownPayCalibrator (T15a-followup — eliminates RateResults/BillRateCalculator drift)', () => {
  // Local builder so each test reads top-down without setup ceremony.
  // adjustmentPct is computed for type-correctness; the helper itself ignores it.
  const dr = (payRate: number, rawPayRate: number, adjusted: boolean) => ({
    payRate,
    rawPayRate,
    adjusted,
    adjustmentPct: adjusted && rawPayRate > 0 ? Math.round((payRate / rawPayRate - 1) * 100) : 0,
  })

  it('null displayedRate → identity, but cap clamp still fires for over-cap raw', async () => {
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(null, 2000)
    expect(calPay(1500)).toBe(1500)
    expect(calPay(2200)).toBe(2000) // identity path STILL routes through clamp
  })

  it('undefined displayedRate → identity (matches optional-prop call-site behavior)', async () => {
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(undefined, 2000)
    expect(calPay(1500)).toBe(1500)
    expect(calPay(2500)).toBe(2000)
  })

  it('adjusted=false → identity (calibration not in effect)', async () => {
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(1500, 1500, false), 2000)
    expect(calPay(1500)).toBe(1500)
    expect(calPay(2200)).toBe(2000)
  })

  it('rawPayRate=0 → identity (defensive: avoids div-by-zero)', async () => {
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(0, 0, true), 2000)
    expect(calPay(1500)).toBe(1500)
  })

  it('positive ratio under cap → multiplies and rounds', async () => {
    // ratio = 2200 / 2000 = 1.10
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(2200, 2000, true), 2500)
    expect(calPay(1500)).toBe(1650)
  })

  it('positive ratio that would breach cap → clamps to cap (T15a margin-leak prevention)', async () => {
    // ratio = 1.10. Row at 2000 with cap 2000: naive multiply yields 2200,
    // helper clamps back to 2000.
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(2200, 2000, true), 2000)
    expect(calPay(2000)).toBe(2000)
  })

  it('downward calibration (ratio < 1) → multiplies, no clamp triggered', async () => {
    // ratio = 1800 / 2000 = 0.90. 2000 * 0.90 = 1800, well under cap.
    // Round-1 NIT: prior name "negative calibration ratio" was misleading —
    // the ratio is 0.90 (positive but < 1), not literally negative.
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(1800, 2000, true), 2500)
    expect(calPay(2000)).toBe(1800)
  })

  it('payCap=null → never clamps even at extreme positive ratio', async () => {
    // ratio = 4000 / 2000 = 2.0. Without a cap, math runs free.
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(4000, 2000, true), null)
    expect(calPay(3000)).toBe(6000)
  })

  it('rawPayRate < 0 → identity (defensive: corrupted upstream data)', async () => {
    // Round-2 Codex catch: this test catches guard rewrites that allow NEGATIVE
    // denominators (e.g. dropping the guard entirely, or `!== 0`). The
    // `rawPayRate=0` test above catches `>= 0` rewrites (which would div-by-
    // zero). The two together pin the `> 0` semantics from both sides.
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(1800, -100, true), 2000)
    expect(calPay(1500)).toBe(1500) // identity: ratio collapses to 1
    expect(calPay(2200)).toBe(2000) // identity path STILL clamps to cap
  })

  it('payCap=0 → clamps EVERY positive value to 0 (degenerate-but-valid cap)', async () => {
    // Round-1 Codex follow-up: payCap is `number | null`. 0 is `!== null`, so
    // the clamp gate `if (payCap !== null && v > payCap) return payCap` fires
    // for any positive v. This is intentional — a cap of 0 means "no pay
    // allowed on this row" and the helper must honor it. Locks the contract
    // against a future "if (!payCap)" rewrite that would treat 0 as null.
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const calPay = buildBreakdownPayCalibrator(dr(2200, 2000, true), 0)
    expect(calPay(1000)).toBe(0)
    expect(calPay(2000)).toBe(0)
  })

  it('reproduces pre-extraction inline math exactly (drift sentinel)', async () => {
    // Documents the equivalence contract: the helper MUST behave identically
    // to the duplicated 4-line pattern that previously lived in both
    // RateResults.tsx and BillRateCalculator.tsx. If this test fails, the
    // helper has diverged from what the components used to do — a refactor
    // regression that would re-introduce the original drift risk in a
    // different shape.
    const { buildBreakdownPayCalibrator, applyCalibrationToBreakdownPay } = await import('../rate-engine/marketRates')
    const displayedRate = dr(2200, 2000, true)
    const payCap = 2200
    const calPay = buildBreakdownPayCalibrator(displayedRate, payCap)
    const ratio = displayedRate.adjusted && displayedRate.rawPayRate > 0
      ? displayedRate.payRate / displayedRate.rawPayRate
      : 1
    expect(calPay(2000)).toBe(applyCalibrationToBreakdownPay(2000, ratio, payCap))
    expect(calPay(1500)).toBe(applyCalibrationToBreakdownPay(1500, ratio, payCap))
    expect(calPay(2500)).toBe(applyCalibrationToBreakdownPay(2500, ratio, payCap))
  })

  it('returns functionally-identical closures for repeated calls with same inputs (pure-function contract)', async () => {
    // The helper builds a fresh closure each call by design (component
    // useMemo deps need stable identity that responds to displayedRate
    // changes, not a memoised inner function). What MUST hold is output
    // equality: two builders made from the same inputs produce the same
    // numbers. Catches accidental introduction of mutable state.
    const { buildBreakdownPayCalibrator } = await import('../rate-engine/marketRates')
    const args = [dr(2200, 2000, true), 2500] as const
    const calPay1 = buildBreakdownPayCalibrator(...args)
    const calPay2 = buildBreakdownPayCalibrator(...args)
    for (const raw of [1500, 1800, 2000, 2500, 3000]) {
      expect(calPay1(raw)).toBe(calPay2(raw))
    }
  })
})

// === S7 (Task 11) — localStorage feedback merged into calibration ===
// FeedbackSection writes to BOTH Firebase and localStorage on every submit;
// the localStorage path is the only one that survives a Firebase outage.
// Pre-S7 these entries were silently ignored by loadSpecialtyCalibration —
// the UI's "saved locally" message lied to the user. These tests lock down
// that entries from localStorage now feed the calibration aggregate, that
// duplicates aren't double-counted, and that corrupted localStorage data
// can't crash the load.
describe('loadSpecialtyCalibration localStorage merge (S7 / Task 11)', () => {
  const memory: Record<string, string> = {}
  // Stub Storage in vitest's node env. Vitest uses node by default — no
  // jsdom — so localStorage is undefined. The test stub is in-memory and
  // re-created per test via beforeEach() on the parent state.current reset.
  beforeEach(() => {
    for (const k of Object.keys(memory)) delete memory[k]
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (k in memory ? memory[k] : null),
        setItem: (k: string, v: string) => { memory[k] = v },
        removeItem: (k: string) => { delete memory[k] },
        clear: () => { for (const k of Object.keys(memory)) delete memory[k] },
        key: (i: number) => Object.keys(memory)[i] ?? null,
        get length() { return Object.keys(memory).length },
      },
    })
  })

  it('happy path: localStorage-only entries feed the calibration aggregate', async () => {
    // Three matching localStorage entries, no Firebase. Pre-S7 this would
    // have returned empty (UI lies). Post-S7 the entries drive the
    // calibration just like Firebase does.
    state.current = {}
    const localEntries: CalibrationEntry[] = [
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 250, timestamp: 100 }),
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 250, timestamp: 200 }),
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 250, timestamp: 300 }),
    ]
    localStorage.setItem('rateFeedback', JSON.stringify(localEntries))

    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(3)
    // 250/220 = 1.136; dampen 50% → 1.068. Below the 1.15 clamp.
    expect(c.adjustment).toBeCloseTo(1.068, 2)
  })

  it('dedupes entries that exist in both Firebase and localStorage', async () => {
    // The dedup key is (timestamp, simulatedRate, acceptedRate). FeedbackSection
    // writes the same entry payload to both layers, so the dup signature
    // hits all three fields. Two distinct legitimate entries colliding on
    // all three at millisecond resolution doesn't happen in practice.
    const shared = entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 240, timestamp: 100 })
    state.current = { fb_a: shared }
    localStorage.setItem('rateFeedback', JSON.stringify([shared]))

    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.entries.length).toBe(1)
    expect(c.sampleSize).toBe(1)
  })

  it('corruption resilience: non-JSON / non-array / malformed entries gracefully ignored', async () => {
    // Three corruption shapes that pre-Codex H-9 could have crashed or
    // poisoned the load. None should throw; calibration still loads from
    // Firebase.
    state.current = {
      fb_only: entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100 }),
    }

    // (1) Non-JSON garbage.
    localStorage.setItem('rateFeedback', 'not valid json {[')
    let c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1) // Firebase entry survived

    // (2) JSON but not an array (object/null/string would crash .filter()).
    localStorage.setItem('rateFeedback', JSON.stringify({ specialty: 'crna' }))
    c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)

    // (3) Array of malformed entries — type guard rejects each.
    localStorage.setItem('rateFeedback', JSON.stringify([
      { specialty: 'crna' }, // missing required fields
      { specialty: 'crna', state: 'TX', simulatedRate: NaN, acceptedRate: 220, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 50 }, // NaN rate
      null,
      'not an entry',
    ]))
    c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
  })

  it('Firebase failure + localStorage success: calibration falls back to local data', async () => {
    // Simulate Firebase throw via the mocked get() rejecting. The calibration
    // load must not propagate the error — localStorage covers the gap. This
    // is the whole point of the dual-write contract in FeedbackSection.
    const firebaseDb = await import('firebase/database')
    const getMock = vi.mocked(firebaseDb.get)
    getMock.mockRejectedValueOnce(new Error('firebase down'))

    localStorage.setItem('rateFeedback', JSON.stringify([
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 240, timestamp: 100 }),
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 240, timestamp: 200 }),
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 240, timestamp: 300 }),
    ]))

    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(3)
    expect(c.adjustment).toBeGreaterThan(1.0) // localStorage entries drove the bias
  })

  it('round-1 MUST: malformed Firebase child does not crash dedup', async () => {
    // Pre-fix: Object.values(snap.val()).map(dedupKeyOf) threw TypeError on
    // null/partial children before the aggregate try/catch could catch it.
    // Post-fix: isCalibrationEntry filters Firebase children too, so a bad
    // sibling row can't poison the load.
    const good = entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100 })
    state.current = {
      ok: good,
      // The TypeScript escape hatch is intentional — production Firebase can
      // hold these shapes after a partial sync or a bad legacy write.
      bad_null: null as unknown as CalibrationEntry,
      bad_partial: { specialty: 'crna' } as unknown as CalibrationEntry,
      bad_string: 'corrupt' as unknown as CalibrationEntry,
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
    expect(c.entries[0].timestamp).toBe(100)
  })

  it('round-1 SHOULD: numeric overflow / NaN / non-positive rates are rejected by the type guard', async () => {
    // JSON.parse of '1e999' yields Infinity; bad past writes can persist
    // Infinity / NaN / 0 / negative values. None should reach aggregate math.
    state.current = {}
    localStorage.setItem('rateFeedback', JSON.stringify([
      entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100 }), // good
      { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: Infinity, acceptedRate: 230, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 200 },
      { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, accuracy: NaN, submittedBy: 'X', notes: '', timestamp: 300 },
      { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: 0, acceptedRate: 230, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 400 }, // 0 sim breaks divisor
      { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: -10, acceptedRate: 230, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 500 },
      { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 0 }, // breaks recency sort
    ]))
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
    expect(c.entries[0].timestamp).toBe(100)
    // Aggregate math is finite — no Infinity / NaN leakage.
    expect(Number.isFinite(c.adjustment)).toBe(true)
    expect(Number.isFinite(c.avgAccuracy)).toBe(true)
  })

  it('respects rateMode filter for localStorage entries (legacy magnitude classification)', async () => {
    // Legacy entries without explicit rateMode get classified by magnitude
    // via inferLegacyRateMode — same as Firebase entries. A daily-magnitude
    // localStorage entry must NOT contaminate the hourly bucket (Codex C-3
    // family — was the original S3 bug, locked here for the local layer too).
    state.current = {}
    localStorage.setItem('rateFeedback', JSON.stringify([
      entry({ specialty: 'crna', simulatedRate: 220, acceptedRate: 230, timestamp: 100 }), // legacy hourly
      entry({ specialty: 'crna', simulatedRate: 1800, acceptedRate: 2000, timestamp: 200 }), // legacy daily
    ]))

    const hourly = await loadSpecialtyCalibration('crna', 'hourly')
    expect(hourly.entries.length).toBe(1)
    expect(hourly.entries[0].timestamp).toBe(100)

    const daily = await loadSpecialtyCalibration('crna', 'call_daily')
    expect(daily.entries.length).toBe(1)
    expect(daily.entries[0].timestamp).toBe(200)
  })
})

// === Wave 2.2 (Phase 3 step 4): valueType / quoteCapBound / capBound discriminators ===
// Three additive optional fields per ARCHITECTURE.md §1.2.B / §1.2.C / §1.2.E.
// Lock the 3 contracts these tests pin:
//   1. computeDisplayedRate sets `capBound` on every return path. The flag
//      mirrors `opts.capped` for the no-calibration / success paths and is
//      forced `true` for the cap-clamp path (we DROPPED a positive uplift —
//      the displayed value is the cap by definition). Pre-Wave-2.2 the field
//      didn't exist, so consumers had to infer cap-binding from a separate
//      `rate.capped` flag, which drifted (Codex T15a MUST 4 split fixed the
//      hero-row case; this field is the explicit display-side carry).
//   2. CalibrationEntry.quoteCapBound is additive optional. The runtime guard
//      MUST accept undefined / true / false and reject anything else (e.g. a
//      stray string from a bad migration), or the downstream filter rule
//      `=== true` / `=== false` quietly miscategorises legacy data.
//   3. The FeedbackSection writer wires quoteCapBound from rate.payRateCapped
//      via the explicit ternary `payRateCapped === true ? true : payRateCapped
//      === false ? false : undefined`. The undefined branch must stay
//      reachable so a hypothetical absent payRateCapped lands as 'unknown'
//      rather than collapsing into 'not capped' via truthiness coercion.
describe('computeDisplayedRate capBound (Wave 2.2 — display-side cap discriminator)', () => {
  it('no-calibration path: capBound mirrors opts.capped when true', () => {
    const r = computeDisplayedRate(350, null, { capped: true })
    expect(r.capBound).toBe(true)
    expect(r.payRate).toBe(350) // sanity — no behavior change beyond the new field
  })

  it('no-calibration path: capBound is false when opts.capped is false', () => {
    const r = computeDisplayedRate(220, null, { capped: false })
    expect(r.capBound).toBe(false)
  })

  it('no-calibration path: capBound is false when opts is omitted (defaults to !== true)', () => {
    const r = computeDisplayedRate(220, null)
    expect(r.capBound).toBe(false)
  })

  it('cap-clamp path: capBound is forced true (positive uplift dropped — displayed = cap)', () => {
    // Pre-Wave-2.2 a consumer had to read `opts.capped` separately to know
    // the displayed value sat at the cap. Now `r.capBound === true` is the
    // direct signal regardless of how calibration would have moved the rate.
    const r = computeDisplayedRate(
      350,
      calibration({ sampleSize: 5, adjustment: 1.15 }),
      { capped: true },
    )
    expect(r.capBound).toBe(true)
    expect(r.payRate).toBe(350) // adjustment dropped per existing guard
    expect(r.adjusted).toBe(false)
  })

  it('success path: capBound mirrors opts.capped when calibration applies and stays under cap', () => {
    // Negative calibration applies even when capped (it stays at-or-below
    // the cap, per the existing C-1 guard). capBound must reflect the
    // engine's underlying clamp signal, NOT whether calibration ran.
    const r = computeDisplayedRate(
      350,
      calibration({ sampleSize: 5, adjustment: 0.92 }),
      { capped: true },
    )
    expect(r.capBound).toBe(true)
    expect(r.payRate).toBe(322) // 350 * 0.92
    expect(r.adjusted).toBe(true)
  })

  it('success path: capBound is false when calibration applies and engine did not bind', () => {
    const r = computeDisplayedRate(
      200,
      calibration({ sampleSize: 5, adjustment: 1.10 }),
      { capped: false },
    )
    expect(r.capBound).toBe(false)
    expect(r.payRate).toBe(220)
  })
})

describe('CalibrationEntry.quoteCapBound (Wave 2.2 — feedback writer contract)', () => {
  // The S7 localStorage describe stubs a global `localStorage` and seeds it
  // with prior-test fixtures that survive into THIS describe (vitest doesn't
  // delete the property between describes, only the data inside the closure).
  // Drop the key before each Wave-2.2 test so loadSpecialtyCalibration sees
  // only what state.current has, not stale legacy entries from S7's tests.
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('rateFeedback')
  })


  // The writer's explicit ternary:
  //   quoteCapBound: payRateCapped === true ? true : payRateCapped === false ? false : undefined
  // documents three reachable branches even though `payRateCapped: boolean` is
  // currently required on CalculatedRate / CalculatedCallRate. Locking the
  // expression here guards against a future refactor that swaps the ternary
  // for `Boolean(payRateCapped)` or `!!payRateCapped` — both would silently
  // collapse the `undefined` legacy branch into `false`.
  const wireQuoteCapBound = (payRateCapped: boolean | undefined): boolean | undefined =>
    payRateCapped === true ? true : payRateCapped === false ? false : undefined

  it('writer ternary maps payRateCapped=true → quoteCapBound=true', () => {
    expect(wireQuoteCapBound(true)).toBe(true)
  })

  it('writer ternary maps payRateCapped=false → quoteCapBound=false (NOT undefined)', () => {
    // Critical: a `Boolean(false) === false` collapse here would erase the
    // distinction between "we know the quote was NOT cap-bound" and "we don't
    // know". Downstream filtering on `=== false` must keep working.
    expect(wireQuoteCapBound(false)).toBe(false)
  })

  it('writer ternary maps payRateCapped=undefined → quoteCapBound=undefined (legacy "unknown")', () => {
    expect(wireQuoteCapBound(undefined)).toBeUndefined()
  })

  it('runtime guard accepts an entry with quoteCapBound=true (Firebase round-trip)', async () => {
    state.current = {
      e1: entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100, quoteCapBound: true }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
    expect(c.entries[0].quoteCapBound).toBe(true)
  })

  it('runtime guard accepts an entry with quoteCapBound=false', async () => {
    state.current = {
      e1: entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100, quoteCapBound: false }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
    expect(c.entries[0].quoteCapBound).toBe(false)
  })

  it('runtime guard accepts a legacy entry without quoteCapBound (undefined → "unknown")', async () => {
    state.current = {
      e1: entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 100 }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
    expect(c.entries[0].quoteCapBound).toBeUndefined()
  })

  it('runtime guard rejects an entry with non-boolean quoteCapBound (defensive against bad migration)', async () => {
    // A bad migration could write `quoteCapBound: 'yes'` or `quoteCapBound: 1`.
    // Both must be rejected — the downstream filter rule depends on strict
    // boolean === comparisons.
    state.current = {
      bad_string: { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 100, quoteCapBound: 'yes' } as unknown as CalibrationEntry,
      bad_number: { specialty: 'crna', state: 'TX', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, accuracy: 90, submittedBy: 'X', notes: '', timestamp: 200, quoteCapBound: 1 } as unknown as CalibrationEntry,
      good: entry({ specialty: 'crna', rateMode: 'hourly', simulatedRate: 220, acceptedRate: 230, timestamp: 300, quoteCapBound: true }),
    }
    const c = await loadSpecialtyCalibration('crna', 'hourly')
    expect(c.sampleSize).toBe(1)
    expect(c.entries[0].timestamp).toBe(300)
  })
})

// === Fix A + Fix B (2026-05-15) — single-source overlay suppression + source-family confidence ===
// Production failure: Zach reported CRNA hero showing $298 with HIGH confidence for a
// Wake Forest Baptist (NC, academic) gig where IAS was actually paying $250 due to a
// $290 bill-rate cap from Atrium/Advocate. Root cause investigation:
//   RTDB rate-simulator/market-rates/crna had:
//     { min:190, max:345, p70:298.5, sources:['tavily_research'], valueType:'market' }
//   ONE source (tavily_research, LLM-extracted prose). The legacy
//   confidence-tier rule (sourceCount >= 3 → 'high', >= 2 → 'medium', >= 1 → 'low')
//   never engaged that classifier path for 1 source — but the override DID
//   mutate spec.min/max/p70, displacing the curated $190-250 'medium' range.
//   Hero math then surfaced p70=298.5 as the displayed base before facility/geo
//   multipliers — showing ~$298 on the page.
//
// Fix A: skip the entire override block (continue) when sources.length < 2 AND
//        valueType !== 'cap'. Single source isn't corroboration; the curated
//        static range stays in effect.
// Fix B: 'high' confidence now requires uniqueFamilies >= 2 — multiple sources
//        from the SAME brand (locums_com + locums_com_2025) ≠ independent
//        corroboration. Family extracted via `sourceFamily()` (prefix before
//        first underscore, lowercased).
describe('sourceFamily (Fix B helper)', () => {
  it('returns first underscore-segment lowercased for standard source names', () => {
    expect(sourceFamily('locums_com')).toBe('locums')
    expect(sourceFamily('tavily_research')).toBe('tavily')
    expect(sourceFamily('exa_semantic')).toBe('exa')
    expect(sourceFamily('bls_oews_2024')).toBe('bls')
    expect(sourceFamily('bls_oews_2023_permanent')).toBe('bls')
  })

  it('collapses same-brand-different-vintage to one family (the core Fix B contract)', () => {
    // 5 locums_com + 1 locums_com_2025 rows = 1 family. NOT high-confidence.
    expect(sourceFamily('locums_com')).toBe(sourceFamily('locums_com_2025'))
    expect(sourceFamily('locums_com')).toBe(sourceFamily('locums_com_2025_q1'))
  })

  it('does NOT collapse independent brands', () => {
    expect(sourceFamily('locums_com')).not.toBe(sourceFamily('tavily_research'))
    expect(sourceFamily('tavily_research')).not.toBe(sourceFamily('exa_semantic'))
    expect(sourceFamily('locums_com')).not.toBe(sourceFamily('bls_oews_2024'))
  })

  it('handles edge cases gracefully (empty/whitespace/missing underscore/mixed case)', () => {
    expect(sourceFamily('')).toBe('unknown')
    expect(sourceFamily('locums')).toBe('locums')          // no underscore
    expect(sourceFamily('Locums_Com')).toBe('locums')      // mixed case → normalized
    // Codex r2 M1 fold: post-trim whitespace-only sources collapse to
    // 'unknown' (was '   ' pre-fold). Trim moved upstream of segment split
    // to make multi-segment override lookup work for whitespace-padded
    // source strings.
    expect(sourceFamily('   ')).toBe('unknown')
    expect(sourceFamily('\t\n')).toBe('unknown')           // other whitespace
  })

  it('lowercases consistently (downstream Set.size relies on this for dedup)', () => {
    // The whole point of the family-set dedup is that 'LOCUMS_COM' and 'locums_com'
    // from a bad-case migration collapse to the same family. Lock that contract.
    const families = new Set([
      sourceFamily('LOCUMS_COM'),
      sourceFamily('locums_com'),
      sourceFamily('Locums_Com'),
    ])
    expect(families.size).toBe(1)
    expect(families.has('locums')).toBe(true)
  })

  it('Codex r1 S2 fold: KNOWN_FAMILY_OVERRIDES collapses CHG corporate family to one identifier', () => {
    // Per F.1-scraper-sources.md §6.4 — CHG owns LocumStory, CompHealth,
    // Weatherby Healthcare, and Global Medical Staffing. Same editorial
    // lineage = same vote.
    expect(sourceFamily('locumstory_state_index')).toBe('chg')
    expect(sourceFamily('comphealth_pay_guide')).toBe('chg')
    expect(sourceFamily('weatherby_blog')).toBe('chg')
    // Codex r2 M1 fold: production source token for the CHG-owned brand is
    // `global_medical_*` (multi-segment), so the override key is the
    // multi-segment 'global_medical' — matched via longest-prefix lookup.
    expect(sourceFamily('global_medical_2024_rates')).toBe('chg')
    expect(sourceFamily('global_medical')).toBe('chg')
    // Set semantics — all four collapse to one family:
    const chgFamilies = new Set([
      sourceFamily('locumstory_state_index'),
      sourceFamily('comphealth_pay_guide'),
      sourceFamily('weatherby_blog'),
      sourceFamily('global_medical_2024_rates'),
    ])
    expect(chgFamilies.size).toBe(1)
    expect(chgFamilies.has('chg')).toBe(true)
  })

  it('Codex r2 M1 fold: longest-prefix lookup — multi-segment key beats single-segment fallback', () => {
    // Anti-regression: ensures `global_medical_2024` matches the multi-segment
    // 'global_medical' key, NOT the single-segment 'global' fallback. Without
    // longest-prefix scan, `split('_')[0]` would return 'global' and miss the
    // CHG collapse entirely (the production bug Codex r2 caught).
    expect(sourceFamily('global_medical_2024')).toBe('chg')
    // Single-token 'global' (not a real CHG token, but locks the fallback):
    // there's no 'global' key in the map, so falls through to prefix 'global'.
    expect(sourceFamily('global')).toBe('global')
    // 'global_health_data' (hypothetical non-CHG): falls back to 'global'
    // because 'global_health_data' / 'global_health' / 'global' are not in
    // KNOWN_FAMILY_OVERRIDES. Locks that the override doesn't over-collapse.
    expect(sourceFamily('global_health_data')).toBe('global')
  })

  it('Codex r2 M1 fold: longest-prefix preserves single-segment override matches', () => {
    // Locks that adding multi-segment scan didn't break single-segment matches.
    // 'locumstory_state_index' tries 'locumstory_state_index' → not in map →
    // 'locumstory_state' → not in map → 'locumstory' → MATCH 'chg'.
    expect(sourceFamily('locumstory_state_index')).toBe('chg')
    expect(sourceFamily('locumstory')).toBe('chg')  // bare prefix matches
    expect(sourceFamily('comphealth')).toBe('chg')
    expect(sourceFamily('weatherby')).toBe('chg')
  })

  it('Codex r2 M1 fold: trim happens before override lookup (whitespace defensive)', () => {
    // The trim in sourceFamily() must run BEFORE the override scan, otherwise
    // ' global_medical_2024 ' would scan candidates with leading whitespace
    // and never match the canonical key. Lock the trim placement.
    expect(sourceFamily('  global_medical_2024  ')).toBe('chg')
    expect(sourceFamily('GLOBAL_MEDICAL_2024')).toBe('chg')  // also lowercase before scan
  })

  it('Codex r1 S2 fold: unknown-prefix sources fall back to prefix (not in override map)', () => {
    // A source whose prefix is NOT in KNOWN_FAMILY_OVERRIDES keeps the prefix.
    // Locks the "override-first, prefix-fallback" semantics.
    expect(sourceFamily('amn_data')).toBe('amn')        // not in map (yet)
    expect(sourceFamily('aya_rates')).toBe('aya')
    expect(sourceFamily('jackson_coker_2024')).toBe('jackson')
  })

  it('Codex r1 S2 fold: independent source + CHG-family source produces 2 distinct families', () => {
    // Independence check — bls + locumstory (CHG) are distinct families.
    expect(sourceFamily('bls_oews_2024')).not.toBe(sourceFamily('locumstory_state_index'))
    expect(new Set([sourceFamily('bls_oews_2024'), sourceFamily('locumstory_state_index')]).size).toBe(2)
  })
})

describe('loadMarketRates single-source-market overlay suppression (Fix A)', () => {
  // SPECIALTIES is a module-level mutable map. loadMarketRates mutates it in
  // place per the existing contract. To avoid cross-test contamination we
  // snapshot and restore the canary specialties we touch.
  let crnaSnapshot: SpecialtyRate
  let erSnapshot: SpecialtyRate

  beforeEach(() => {
    // Clone the current spec values so we can detect mutation per-test.
    crnaSnapshot = { ...SPECIALTIES.crna }
    erSnapshot = { ...SPECIALTIES['emergency medicine'] }
  })

  afterEach(() => {
    // Restore between tests so a mutation in one test doesn't leak into the next.
    SPECIALTIES.crna = { ...crnaSnapshot }
    SPECIALTIES['emergency medicine'] = { ...erSnapshot }
  })

  it('regression: 1 source tavily_research with p70=298.5 does NOT mutate CRNA spec (the production failure)', async () => {
    // Exact RTDB shape from production 2026-05-15. This was producing the
    // $298 hero number Zach reported. Post-fix the override is skipped and
    // CRNA stays at its curated static range.
    state.current = {
      crna: {
        min: 190,
        max: 345,
        p70: 298.5,
        sources: ['tavily_research'],
        lastUpdated: Date.now(),  // fresh enough to pass the 7d gate
        valueType: 'market',
      } as unknown as CalibrationEntry,  // mock returns this regardless of shape
    }
    await loadMarketRates()
    // Spec must be unchanged from the snapshot — the static curated values prevail.
    expect(SPECIALTIES.crna.min).toBe(crnaSnapshot.min)
    expect(SPECIALTIES.crna.max).toBe(crnaSnapshot.max)
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
    expect(SPECIALTIES.crna.confidence).toBe(crnaSnapshot.confidence)
  })

  it('2 sources from different families: override applies + confidence promotes to high', async () => {
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locums_com', 'bls_oews_2024'],  // 2 distinct families
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.min).toBe(100)
    expect(SPECIALTIES.crna.max).toBe(350)
    expect(SPECIALTIES.crna.p70).toBe(280)
    // pickHigher between static baseline 'medium' (CRNA static_confidence) and
    // computed 'high' (2 families) → 'high'.
    expect(SPECIALTIES.crna.confidence).toBe('high')
  })

  it('2 sources same family: override applies but confidence stays at medium (Fix B)', async () => {
    // locums_com + locums_com_2025 = 1 family = medium, NOT high.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locums_com', 'locums_com_2025'],
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.min).toBe(100)
    expect(SPECIALTIES.crna.max).toBe(350)
    expect(SPECIALTIES.crna.p70).toBe(280)
    // 2 sources but 1 family → 'medium'. pickHigher(baseline='medium', 'medium') = 'medium'.
    expect(SPECIALTIES.crna.confidence).toBe('medium')
  })

  it('3 sources same family: override applies, still medium (3 of same brand ≠ high)', async () => {
    // Locks the contract that even MORE same-brand sources don't promote to high.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locums_com', 'locums_com_2025', 'locums_com_2024_q3'],
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.confidence).toBe('medium')
  })

  it('cap valueType overlay is SKIPPED regardless of source count (Codex r1 M1 fold)', async () => {
    // Bridge writes cap rows to a separate `rate-simulator/cap-rates` path,
    // not the `rate-simulator/market-rates` path that loadMarketRates reads.
    // Any cap row appearing here is a routing leak; defensively skip so a
    // ceiling never mutates the market base. A future loadCapRates() will
    // consume the cap path into its own state and feed `f.rateCap`.
    state.current = {
      crna: {
        min: 200,
        max: 290,
        p70: 245,
        sources: ['hco_ceiling_atrium', 'hco_ceiling_chs'],  // even 2 sources, still skipped
        lastUpdated: Date.now(),
        valueType: 'cap',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    // Spec untouched — cap rows must not override the market base.
    expect(SPECIALTIES.crna.min).toBe(crnaSnapshot.min)
    expect(SPECIALTIES.crna.max).toBe(crnaSnapshot.max)
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
    expect(SPECIALTIES.crna.confidence).toBe(crnaSnapshot.confidence)
  })

  it('empty sources array: market overlay suppressed (sources.length < 2)', async () => {
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: [],
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
  })

  it('missing sources field (legacy row): market overlay suppressed', async () => {
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        // sources field absent — pre-Wave-1 Firebase row shape
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
  })

  it('stale single-source overlay (>7d): still suppressed by both age gate AND Fix A', async () => {
    // The 7d gate already excludes this — Fix A is defense in depth. Locks
    // that the new gate doesn't accidentally LOOSEN the age constraint.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['tavily_research'],
        lastUpdated: Date.now() - (10 * 86400000),  // 10 days old
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
  })

  it('Codex r1 M2 fold: null/undefined/blank entries in sources array filtered out before counting', async () => {
    // Pre-fix: `['locums_com', null]` would count as 2 sources and 2 families
    // (sourceFamily(null) → 'unknown'), promoting CRNA to 'high'. Post-fix the
    // null is filtered out before the gate, so the row presents as 1 source
    // and is suppressed by Fix A.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locums_com', null, undefined, '', '   '] as unknown as string[],  // only locums_com valid
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    // After filter, sourceCount === 1 → Fix A suppression engages → spec untouched.
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
  })

  it('Codex r1 M2 fold: filtered source entries are trimmed before family extraction', async () => {
    // Whitespace-padded source names (e.g. ' locums_com ' from bad CSV import)
    // get trimmed before sourceFamily runs, so they collapse to the canonical
    // 'locums' family. Without trim, leading whitespace would make the prefix
    // segment empty → family 'unknown' → wrongly count as independent.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locums_com', ' locums_com_2025 '],  // 2 trimmed → both 'locums' family
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    // Override applies (2 sources after filter+trim), confidence stays 'medium'
    // (1 family). Locks that trim happens BEFORE family extraction.
    expect(SPECIALTIES.crna.p70).toBe(280)
    expect(SPECIALTIES.crna.confidence).toBe('medium')
  })

  it('Codex r1 S2 fold: CHG family collapses LocumStory + CompHealth + Weatherby + Global Medical to one vote', async () => {
    // Per docs/rate-simulator/B-research-2026-05-05/F.1-scraper-sources.md §6.4:
    // these brands publish CHG-aggregated data and shouldn't count as independent
    // corroboration. Three CHG-family sources = 1 family = NOT high confidence.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locumstory_state_index', 'comphealth_pay_guide', 'weatherby_blog'],
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.p70).toBe(280)
    expect(SPECIALTIES.crna.confidence).toBe('medium')
  })

  it('Codex r1 S2 fold: CHG family + independent source promotes to high', async () => {
    // Locks the contract: a CHG vote PLUS a genuinely independent vote
    // (e.g. BLS) IS 2 distinct families → high confidence.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['comphealth_pay_guide', 'bls_oews_2024'],
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.confidence).toBe('high')
  })

  it('Fix D (2026-05-15): live overlay flips spec.provenance from curated to live', async () => {
    // Locks the contract that loadMarketRates marks an overlaid specialty
    // with provenance='live'. Without this, the UI can't distinguish
    // analyst-curated static ranges from fresh multi-source live data.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['locums_com', 'bls_oews_2024'],  // 2 families — applies
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    // Snapshot baseline says 'curated'.
    expect(crnaSnapshot.provenance).toBe('curated')
    await loadMarketRates()
    // Post-overlay, flipped to 'live'.
    expect(SPECIALTIES.crna.provenance).toBe('live')
  })

  it('Fix D (2026-05-15): suppressed single-source overlay leaves provenance at curated', async () => {
    // Locks the contract that the provenance flip only fires when the override
    // ACTUALLY applies. Single-source-market overlay is suppressed by Fix A,
    // so spec.provenance stays at 'curated' — honest disclosure that the
    // RTDB row didn't make it through the gate.
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['tavily_research'],  // single source — Fix A skips
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.provenance).toBe('curated')
  })

  it('Fix D (2026-05-15): cap valueType overlay leaves provenance at curated (M1 fold combo)', async () => {
    // Cap rows are skipped before the override. Provenance stays curated.
    state.current = {
      crna: {
        min: 200,
        max: 290,
        p70: 245,
        sources: ['hco_ceiling_atrium', 'hco_ceiling_chs'],
        lastUpdated: Date.now(),
        valueType: 'cap',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    expect(SPECIALTIES.crna.provenance).toBe('curated')
  })

  it('multi-specialty: suppression is per-specialty, not global (one bad row doesn\'t kill the batch)', async () => {
    state.current = {
      crna: {
        min: 100,
        max: 350,
        p70: 280,
        sources: ['tavily_research'],  // single source — suppressed
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
      'emergency medicine': {
        min: 250,
        max: 400,
        p70: 350,
        sources: ['locums_com', 'bls_oews_2024'],  // 2 families — applies
        lastUpdated: Date.now(),
        valueType: 'market',
      } as unknown as CalibrationEntry,
    }
    await loadMarketRates()
    // CRNA suppressed.
    expect(SPECIALTIES.crna.p70).toBe(crnaSnapshot.p70)
    // ER applied + promoted to high.
    expect(SPECIALTIES['emergency medicine'].p70).toBe(350)
    expect(SPECIALTIES['emergency medicine'].confidence).toBe('high')
  })
})

