// =============================================================================
// marketBuckets.test.ts — multi-bucket v2 reader + D-39 precedence + D-39a ladder
// (Phase 3, A.3, Plan 03-04 Task 5).
//
// Behavior coverage:
//   T1 v2 read:      given a market-rates-v2 tree, loadMarketBuckets reads it and
//                    exposes the per-bucket posteriors + selected primary.
//   T2 precedence:   advertised over scraped; actual_paid_locum outranks both.
//   T3 boundary:     agency_bill_rate is NEVER the primary; permanent_wage_proxy
//                    is not the primary (labeled-context only).
//   T4 legacy fall:  v2 absent/empty → fellBackToLegacy true, no crash.
//   T5 coverage:     null_unclassified-only → 'unclassified_only' rung labeled,
//                    never imputed; no data → 'insufficient_data', never blank.
//   T6 no double-ct: no family logic re-applied on top of server-side collapse
//                    (the reader trusts the server posterior's source_families).
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MarketBucketData } from '../rate-engine/marketRates'

// A mutable per-test RTDB snapshot keyed by the path string. The firebase `get`
// mock returns whatever `snapshots[path]` holds (exists()=false when undefined).
const rtdb = vi.hoisted(() => ({
  snapshots: {} as Record<string, unknown>,
}))

vi.mock('firebase/database', () => ({
  // ref() returns the path string verbatim so the get() mock can key on it.
  ref: vi.fn((_db: unknown, path: string) => path),
  get: vi.fn((path: string) => {
    const val = rtdb.snapshots[path]
    return Promise.resolve({
      exists: () => val !== undefined && val !== null,
      val: () => val,
    })
  }),
}))

// (hub gate-2: no config/firebase module — db handle injected via the runtime seam below)

import { loadMarketBuckets } from '../rate-engine/marketRates'
// HUB GATE-2 ADAPTATION: marketRates reads the Firebase RTDB handle via the
// ./runtime seam; firebase/database ref/get stay mocked (above). Inline mock db ({}).
import { configureEngine } from '../rate-engine/runtime'
const db = {}
configureEngine({ db: db as never })

beforeEach(() => {
  rtdb.snapshots = {}
})

const V2_PATH = 'rate-simulator/market-rates-v2'
const LEGACY_PATH = 'rate-simulator/market-rates'

function bucket(overrides: Partial<MarketBucketData> = {}): MarketBucketData {
  return {
    weighted_mean: 200,
    weighted_variance: 100,
    median: 200,
    confidence: 'multi_source',
    n_distinct: 4,
    n_raw: 6,
    source_families: ['locums', 'exa'],
    family_capped: false,
    lastUpdated: Date.now(),
    ...overrides,
  }
}

function meta(primaryRateType: string | null, coverageTier: string, lastUpdated = Date.now()) {
  return { lastUpdated, primaryRateType, coverageTier }
}

describe('loadMarketBuckets — v2 read (T1)', () => {
  it('reads the market-rates-v2 tree and exposes per-bucket posteriors + the selected primary', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        __meta__: meta('advertised_clinician_pay', 'primary'),
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
            scraped_article_estimate: bucket({ weighted_mean: 300, confidence: 'single_source' }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.fellBackToLegacy).toBe(false)
    const crna = result.specialties['crna']
    expect(crna).toBeDefined()
    expect(crna.primary).not.toBeNull()
    expect(crna.primary!.rateType).toBe('advertised_clinician_pay')
    expect(crna.primary!.data.weighted_mean).toBe(205)
    // Both buckets are exposed (not collapsed into one).
    expect(Object.keys(crna.buckets).sort()).toEqual([
      'advertised_clinician_pay',
      'scraped_article_estimate',
    ])
  })
})

describe('loadMarketBuckets — D-39 precedence (T2)', () => {
  it('selects advertised over scraped', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            scraped_article_estimate: bucket({ weighted_mean: 300 }),
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary!.rateType).toBe('advertised_clinician_pay')
  })

  it('crowd_survey outranks scraped_article_estimate but loses to advertised (full precedence chain)', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            scraped_article_estimate: bucket({ weighted_mean: 300 }),
            crowd_survey: bucket({ weighted_mean: 240 }),
          },
        },
      },
      hospitalist: {
        national: {
          buckets: {
            crowd_survey: bucket({ weighted_mean: 240 }),
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    // crowd beats scraped …
    expect(result.specialties['crna'].primary!.rateType).toBe('crowd_survey')
    // … but advertised beats crowd.
    expect(result.specialties['hospitalist'].primary!.rateType).toBe('advertised_clinician_pay')
  })

  it('actual_paid_locum outranks advertised AND scraped', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
            scraped_article_estimate: bucket({ weighted_mean: 300 }),
            actual_paid_locum: bucket({ weighted_mean: 220 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary!.rateType).toBe('actual_paid_locum')
    expect(result.specialties['crna'].primary!.data.weighted_mean).toBe(220)
  })
})

describe('loadMarketBuckets — boundary (T3)', () => {
  it('agency_bill_rate is NEVER the primary (D-12), even if it is the only finite bucket', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            agency_bill_rate: bucket({ weighted_mean: 450 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })

  it('permanent_wage_proxy is not the primary number (labeled-context only)', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            permanent_wage_proxy: bucket({ weighted_mean: 95 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })

  it('a bucket with a null weighted_mean (manual_review_bimodal) is NOT selected as primary', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({
              weighted_mean: null,
              weighted_variance: null,
              confidence: 'manual_review_bimodal',
            }),
            scraped_article_estimate: bucket({ weighted_mean: 280 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    // advertised has a null mean → falls to the next renderable bucket (scraped).
    expect(result.specialties['crna'].primary!.rateType).toBe('scraped_article_estimate')
    expect(result.specialties['crna'].primary!.data.weighted_mean).toBe(280)
  })
})

describe('loadMarketBuckets — legacy fallback (T4)', () => {
  it('falls back to legacy when market-rates-v2 is ABSENT (no crash)', async () => {
    // Only the legacy node exists.
    rtdb.snapshots[LEGACY_PATH] = { crna: { min: 190, max: 250, sources: ['locums_com', 'bls_oews'], lastUpdated: Date.now() } }
    const result = await loadMarketBuckets()
    expect(result.fellBackToLegacy).toBe(true)
    expect(result.specialties).toEqual({})
  })

  it('falls back to legacy when market-rates-v2 is EMPTY ({})', async () => {
    rtdb.snapshots[V2_PATH] = {}
    rtdb.snapshots[LEGACY_PATH] = { crna: { min: 190, max: 250, sources: ['a', 'b'], lastUpdated: Date.now() } }
    const result = await loadMarketBuckets()
    expect(result.fellBackToLegacy).toBe(true)
  })

  it('returns an empty, non-crashing result when BOTH v2 and legacy are absent', async () => {
    const result = await loadMarketBuckets()
    expect(result.specialties).toEqual({})
    // fellBackToLegacy is true (v2 absent) but there is nothing to read.
    expect(result.fellBackToLegacy).toBe(true)
  })

  it('a malformed/missing cell node does not throw — the specialty is skipped, others still read', async () => {
    rtdb.snapshots[V2_PATH] = {
      // Malformed: no `national` cell / no `buckets` node.
      broken_spec: { __meta__: meta(null, 'insufficient_data') },
      // Malformed: national present but buckets missing.
      broken_spec2: { national: {} },
      // A good neighbor that must still read despite the malformed siblings.
      crna: { national: { buckets: { advertised_clinician_pay: bucket({ weighted_mean: 205 }) } } },
    }
    const result = await loadMarketBuckets()
    expect(result.fellBackToLegacy).toBe(false)
    expect(result.specialties['broken_spec']).toBeUndefined()
    expect(result.specialties['broken_spec2']).toBeUndefined()
    expect(result.specialties['crna'].primary!.rateType).toBe('advertised_clinician_pay')
  })
})

describe('loadMarketBuckets — coverage ladder (T5)', () => {
  it('a specialty with only a null_unclassified bucket renders the bottom unclassified-evidence rung, never imputed', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            null_unclassified: bucket({ weighted_mean: 210, confidence: 'single_source' }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    const crna = result.specialties['crna']
    expect(crna.primary).toBeNull() // null bucket is never the typed primary
    expect(crna.coverageTier).toBe('unclassified_only')
    // The null bucket's number is still exposed as the labeled bottom rung
    // (the consumer renders it with an "unclassified evidence" label), but it is
    // NOT promoted to primary and is NOT imputed to a typed bucket.
    expect(crna.unclassified).not.toBeNull()
    expect(crna.unclassified!.weighted_mean).toBe(210)
  })

  it('a specialty with no renderable data renders insufficient_data, never a blank', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: null, confidence: 'manual_review_bimodal' }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })
})

describe('loadMarketBuckets — untrusted-RTDB-child hardening (Codex r2 #3)', () => {
  it('a corrupted bucket (finite mean but n_distinct=0) is NOT selected as primary — falls through', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            // Higher precedence but corrupted (n_distinct 0) → must NOT render.
            advertised_clinician_pay: bucket({ weighted_mean: 999, n_distinct: 0 }),
            // Lower precedence but valid → becomes the rendered primary.
            scraped_article_estimate: bucket({ weighted_mean: 280, n_distinct: 3 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary!.rateType).toBe('scraped_article_estimate')
    expect(result.specialties['crna'].primary!.data.weighted_mean).toBe(280)
  })

  it('a bucket with an invalid confidence string is treated as non-renderable', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: {
              ...bucket({ weighted_mean: 205 }),
              confidence: 'bogus_tier' as unknown as MarketBucketData['confidence'],
            },
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })
})

// =============================================================================
// Pre-deploy review Fix A — M2-reader: lastUpdated staleness gate (authoritative).
//
// The v2 reader had NO recency check, so a stale aged-out bucket could be
// selected as PRIMARY (rendering a stale number with a confident provenance/tier
// badge — a Core-Value violation). The legacy reader gates at 7 days; the v2
// reader MUST mirror that window. The bridge write-side prune is the other
// executor's concern; THIS is the authoritative reader gate.
// =============================================================================
const SEVEN_DAYS_MS = 7 * 86400000

describe('loadMarketBuckets — M2-reader staleness gate (7-day window)', () => {
  it('rejects a bucket whose lastUpdated is older than the 7-day window (not renderable / not selectable)', async () => {
    const stale = Date.now() - (SEVEN_DAYS_MS + 60_000) // > 7 days old
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205, lastUpdated: stale }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    // The only bucket is stale → no renderable primary; honest insufficient-data.
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })

  it('a STALE higher-precedence bucket loses to a FRESH lower-precedence bucket (stale rejected, fresh wins)', async () => {
    const stale = Date.now() - (SEVEN_DAYS_MS + 60_000)
    const fresh = Date.now()
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            // Higher precedence but STALE → must be rejected.
            actual_paid_locum: bucket({ weighted_mean: 999, lastUpdated: stale }),
            // Lower precedence but FRESH → becomes the rendered primary.
            advertised_clinician_pay: bucket({ weighted_mean: 205, lastUpdated: fresh }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary!.rateType).toBe('advertised_clinician_pay')
    expect(result.specialties['crna'].primary!.data.weighted_mean).toBe(205)
  })

  it('a bucket exactly at the 7-day boundary (just inside the window) is still renderable', async () => {
    // age === window is NOT "older than" — boundary is inclusive of fresh.
    const justInside = Date.now() - (SEVEN_DAYS_MS - 60_000)
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205, lastUpdated: justInside }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary!.rateType).toBe('advertised_clinician_pay')
  })

  it('a stale null_unclassified bucket is NOT exposed as the labeled bottom rung', async () => {
    const stale = Date.now() - (SEVEN_DAYS_MS + 60_000)
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            null_unclassified: bucket({ weighted_mean: 210, confidence: 'single_source', lastUpdated: stale }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].unclassified).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })

  it('a bucket with a missing/non-finite lastUpdated is treated as stale (rejected), not as epoch-0-fresh', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            // No lastUpdated at all → cannot prove freshness → reject.
            advertised_clinician_pay: bucket({ weighted_mean: 205, lastUpdated: undefined as unknown as number }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna'].primary).toBeNull()
    expect(result.specialties['crna'].coverageTier).toBe('insufficient_data')
  })
})

// =============================================================================
// Pre-deploy review Fix A — m6 reader-strip (defense-in-depth): the reader must
// strip rate_types absent from the renderable/precedence set (esp.
// agency_bill_rate, a D-12 bill class) so `cell.buckets` can never carry a bill
// rate to any consumer. The write-side exclusion is already done by the bridge
// executor; this is belt-and-suspenders on the read side.
// =============================================================================
describe('loadMarketBuckets — m6 reader-strip (agency_bill_rate / non-renderable rate_types)', () => {
  it('strips agency_bill_rate from cell.buckets so no consumer can ever read a bill rate', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
            agency_bill_rate: bucket({ weighted_mean: 450 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    const crna = result.specialties['crna']
    // agency_bill_rate is a D-12 bill class — NEVER carried in the consumer map.
    expect(Object.keys(crna.buckets)).not.toContain('agency_bill_rate')
    expect(Object.keys(crna.buckets)).toContain('advertised_clinician_pay')
    // Primary is unaffected — advertised wins.
    expect(crna.primary!.rateType).toBe('advertised_clinician_pay')
  })

  it('keeps null_unclassified and permanent_wage_proxy in the buckets map (they ARE renderable as labeled context), but never agency_bill_rate', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
            permanent_wage_proxy: bucket({ weighted_mean: 95 }),
            null_unclassified: bucket({ weighted_mean: 200, confidence: 'single_source' }),
            agency_bill_rate: bucket({ weighted_mean: 450 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    const keys = Object.keys(result.specialties['crna'].buckets)
    expect(keys).not.toContain('agency_bill_rate')
    expect(keys).toContain('permanent_wage_proxy')
    expect(keys).toContain('null_unclassified')
    expect(keys).toContain('advertised_clinician_pay')
  })
})

// =============================================================================
// Pre-deploy review Fix A — m4: reader hardcodes the 'national' cell, silently
// dropping any state-bearing v2 bucket. Iterate stateKeys (prefer a real state,
// fall back to 'national' per the D-39a ladder) so a state-bearing population is
// not silently dropped. 100% national today — low risk, forward-compat.
// =============================================================================
describe('loadMarketBuckets — m4 stateKey iteration (no silent state-cell drop)', () => {
  it('reads a state-bearing v2 cell when no national cell exists (does not silently drop it)', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        // No national cell — only a state cell. The old hardcoded-national reader
        // would silently drop this; the ladder must fall to the state cell.
        CA: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 230 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    expect(result.specialties['crna']).toBeDefined()
    expect(result.specialties['crna'].primary!.rateType).toBe('advertised_clinician_pay')
    expect(result.specialties['crna'].primary!.data.weighted_mean).toBe(230)
  })

  it('prefers the national cell when both national and a state cell exist (D-39a: national is the v1 canonical rung)', async () => {
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 205 }),
          },
        },
        CA: {
          buckets: {
            advertised_clinician_pay: bucket({ weighted_mean: 230 }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    // National is the canonical rung in v1 — its 205 wins over the CA 230.
    expect(result.specialties['crna'].primary!.data.weighted_mean).toBe(205)
  })
})

describe('loadMarketBuckets — no family double-count (T6)', () => {
  it('does NOT re-derive families from sources — it trusts the server posterior source_families', async () => {
    // The server already collapsed families; the reader must not re-apply a
    // uniqueFamilies>=2 gate. A single-family bucket with a finite mean is still
    // selectable as primary by precedence (the gate is server-side now).
    rtdb.snapshots[V2_PATH] = {
      crna: {
        national: {
          buckets: {
            advertised_clinician_pay: bucket({
              weighted_mean: 205,
              confidence: 'single_source',
              source_families: ['locums'], // single family — server already decided confidence
            }),
          },
        },
      },
    }
    const result = await loadMarketBuckets()
    // Selected as primary purely by D-39 precedence + finite mean — no consumer
    // family re-gate suppressing it.
    expect(result.specialties['crna'].primary!.rateType).toBe('advertised_clinician_pay')
    expect(result.specialties['crna'].primary!.data.source_families).toEqual(['locums'])
  })
})
