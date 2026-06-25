// src/features/rate-simulator/engine/__tests__/blsSanityProbe.test.ts
// Phase 3 step 2 — calibration probe.
// Walks all (specialty × state) tuples and dumps verdict distribution.
// Output: /c/temp/bls-oews-vs-simulator-rates-step-2-probe.json
//
// This is NOT a regression test — it always passes. The pass-criteria check
// is in the plan; this test produces the data the plan references.
//
// B.7.1 Task 8 (2026-05-08): evaluateBlsSanityCheck became async. The mock
// supabase below returns empty rows so CRNA cells fall through to the legacy
// BLS+LOCUM_MULTIPLIER path — keeping the probe distribution comparable to
// pre-Task-8 forensic output for cross-version diff.

import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// (hub gate-2: no config/supabase module — mock injected via the runtime seam below)

import { SPECIALTIES } from '../rate-engine/specialties'
import { BLS_OEWS_BASELINE } from '../rate-engine/blsOewsBaseline'
import { evaluateBlsSanityCheck, SPECIALTY_TO_SOC } from '../rate-engine/blsSanityCheck'
// HUB GATE-2 ADAPTATION: vendored engine reads supabase via the ./runtime seam
// (CRNA probe rows dispatch through crnaCellLookup). Inline empty-data mock →
// legacy fallback. Assertions are the dashboard suite VERBATIM = the parity proof.
import { configureEngine } from '../rate-engine/runtime'
const supabase = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }
configureEngine({ supabase: supabase as never })

describe('blsSanityProbe', () => {
  it('dumps verdict distribution across all (specialty × state) tuples', async () => {
    const outPath = '/c/temp/bls-oews-vs-simulator-rates-step-2-probe.json'
    const counts = { aligned: 0, soft: 0, hard: 0, unavailable: 0 }
    const unavailableReasons: Record<string, number> = {}
    const samples: Array<Record<string, unknown>> = []
    const hardSamples: Array<Record<string, unknown>> = []
    const softSamples: Array<Record<string, unknown>> = []

    const states = Object.keys(BLS_OEWS_BASELINE)
    const specialties = Object.keys(SPECIALTIES)

    for (const specialtyKey of specialties) {
      const specRate = SPECIALTIES[specialtyKey]
      if (!SPECIALTY_TO_SOC[specialtyKey]) continue
      for (const state of states) {
        const r = await evaluateBlsSanityCheck({
          specialtyKey,
          state,
          displayedHourlyRate: specRate.p70,
          isCallOnly: false,
        })
        counts[r.verdict] += 1
        if (r.verdict === 'unavailable' && r.reason) {
          unavailableReasons[r.reason] = (unavailableReasons[r.reason] ?? 0) + 1
        }
        // Capture a small sample of each verdict type for forensic log.
        if (samples.length < 50 && (samples.filter((s) => s.verdict === r.verdict).length < 5)) {
          samples.push({
            specialtyKey,
            state,
            displayedHourlyRate: specRate.p70,
            verdict: r.verdict,
            expectedHourly: r.expectedHourly,
            deviationPct: r.deviationPct,
            socUsed: r.socUsed,
            source: r.source,
            reason: r.reason,
            isMeanBased: r.isMeanBased,
            isAggregateFallback: r.isAggregateFallback,
            isBandAware: r.isBandAware,
          })
        }
        // Capture all hard fires + first 30 soft fires for review.
        if (r.verdict === 'hard') {
          hardSamples.push({
            specialtyKey,
            state,
            displayedHourlyRate: specRate.p70,
            expectedHourly: r.expectedHourly,
            deviationPct: r.deviationPct,
            socUsed: r.socUsed,
            isMeanBased: r.isMeanBased,
            source: r.source,
          })
        } else if (r.verdict === 'soft' && softSamples.length < 30) {
          softSamples.push({
            specialtyKey,
            state,
            displayedHourlyRate: specRate.p70,
            expectedHourly: r.expectedHourly,
            deviationPct: r.deviationPct,
            socUsed: r.socUsed,
            isMeanBased: r.isMeanBased,
            source: r.source,
          })
        }
      }
    }

    const total = counts.aligned + counts.soft + counts.hard + counts.unavailable
    const totalWithBls = counts.aligned + counts.soft + counts.hard
    const summary = {
      totalTuples: total,
      tuplesWithBlsData: totalWithBls,
      counts,
      pcts: {
        alignedOfWithBls: totalWithBls > 0 ? (counts.aligned / totalWithBls) * 100 : 0,
        softOfWithBls: totalWithBls > 0 ? (counts.soft / totalWithBls) * 100 : 0,
        hardOfWithBls: totalWithBls > 0 ? (counts.hard / totalWithBls) * 100 : 0,
        unavailableOfTotal: total > 0 ? (counts.unavailable / total) * 100 : 0,
      },
      unavailableReasons,
      hardSamples,
      softSamples,
      samples,
      generatedAt: new Date().toISOString(),
    }

    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(summary, null, 2))

    // Always-pass forensic; assert summary structure only so a broken probe surfaces.
    expect(total).toBeGreaterThan(0)
    expect(totalWithBls).toBeGreaterThan(0)

    console.log(`[probe] ${total} tuples, ${totalWithBls} with BLS data`)
    console.log(`[probe] aligned=${summary.pcts.alignedOfWithBls.toFixed(1)}% soft=${summary.pcts.softOfWithBls.toFixed(1)}% hard=${summary.pcts.hardOfWithBls.toFixed(1)}% unavailable=${summary.pcts.unavailableOfTotal.toFixed(1)}%`)
    console.log(`[probe] dump: ${outPath}`)
  })
})
