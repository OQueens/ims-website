// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// liveCalibration.ts — RS-1 observed-caps display layer
// Pure functions. No React, no Firebase. Callers pass the live
// `jobs` array (from the same onValue subscription analytics uses)
// and receive per-HCO / per-specialty aggregate profiles.
//
// Every number in the returned profiles is a BID CEILING from
// rateRequirements.max* — NOT a market / winning rate. Consumers
// must label these as caps in the UI. Session-17 correction:
// observed OT multiplier caps run ~1.3× but actual closed OT is
// ~1.0–1.1×; caps and market rates are different quantities.
// ============================================================

const MIN_N = 5

// T15a Codex MUST 2 / N3 (2026-04-29): real EnrichedJob interface. Prior
// `Record<string, any>` opted out of all type-checking on a record that has
// well-known structure from the Partner API + webhook-slim feeds. Index
// signature `[key: string]: unknown` is preserved for genuinely dynamic
// fields (status flags, internal markers); known fields are typed.
export interface EnrichedJob {
  // Webhook-slim + Partner API canonical name fields
  organization?: string
  hcoName?: string
  // Specialty: top-level string (webhook-slim) or enriched array
  specialty?: string
  specialties?: Array<{ specialtyName?: string }>
  // Partner API rate ceiling block — every field is best-effort, may be
  // missing or arrive as a non-number on legacy rows.
  rateRequirements?: {
    maxRegular?: number
    maxOvertimeMultiplier?: number
    maxHolidayMultiplier?: number
    maxOrientation?: number
  }
  vendorCount?: number
  estimatedCredentialingTime?: number
  insuranceProvidedBy?: string
  // Enrichment freshness marker. Truthy on enriched rows; the value type is
  // not contractually guaranteed across the feed (timestamp string vs ms).
  _partnerApiEnrichedAt?: unknown
  // Index signature for dynamic fields beyond the known shape.
  [key: string]: unknown
}

export interface HcoProfile {
  n: number
  rateCapMedian: number | null
  rateCapP25: number | null
  rateCapP75: number | null
  otMultiplierMedian: number | null
  holidayMultiplierMedian: number | null
  orientationCapMedian: number | null
  insuranceProvidedBy: string | null
  avgVendorCount: number | null
  avgCredentialingDays: number | null
}

export interface SpecialtyProfile {
  n: number
  rateCapMedian: number | null
  rateCapP25: number | null
  rateCapP75: number | null
  otMultiplierMedian: number | null
  holidayMultiplierMedian: number | null
  avgVendorCount: number | null
}

// ---------- helpers ----------

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function mode(values: string[]): string | null {
  if (!values.length) return null
  const counts: Record<string, number> = {}
  for (const v of values) counts[v] = (counts[v] || 0) + 1
  let best: string | null = null
  let bestCount = 0
  for (const [k, c] of Object.entries(counts)) {
    if (c > bestCount) { best = k; bestCount = c }
  }
  return best
}

function finiteNumbers(values: unknown[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

function nonEmptyStrings(values: unknown[]): string[] {
  return values
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())
}

/**
 * Enrichment gate. Pre-enrichment records have webhook-slim fields only;
 * rateRequirements + vendorCount + organization only exist after the Partner
 * API backfill has touched a record.
 */
function isEnriched(j: EnrichedJob): boolean {
  return Boolean(j?._partnerApiEnrichedAt || j?.rateRequirements || typeof j?.vendorCount === 'number')
}

/** Minimum length for substring-match on HCO / specialty names. Short tokens
 *  ("HCA", "CHS") would otherwise match unrelated rows as substrings. Requires
 *  exact equality below this threshold. */
const MIN_TARGET_LEN = 4

/**
 * One-way loose match: does a candidate string `c` contain the target `t`?
 * Only matches in the `c.includes(t)` direction — never `t.includes(c)`, which
 * would let a short feed row poison an aggregate by subsuming a long target.
 * Below MIN_TARGET_LEN we require exact equality.
 */
function looseMatch(c: string, t: string): boolean {
  if (c === t) return true
  if (t.length < MIN_TARGET_LEN) return false
  return c.startsWith(t) || c.includes(t)
}

/**
 * HCO match across `organization` (Partner API canonical) and `hcoName`
 * (webhook-slim). Case-insensitive one-way substring match. A stricter
 * normalizer / alias table is a TODO once we see the distribution of drift.
 */
function hcoMatches(j: EnrichedJob, target: string): boolean {
  const t = target.toLowerCase().trim()
  if (!t) return false
  const candidates = [j?.organization, j?.hcoName]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map(s => s.toLowerCase().trim())
  return candidates.some(c => looseMatch(c, t))
}

function specialtyMatches(j: EnrichedJob, target: string): boolean {
  const t = target.toLowerCase().trim()
  if (!t) return false
  // Top-level string (webhook-slim) or enriched specialties[] array
  const top = typeof j?.specialty === 'string' ? j.specialty.toLowerCase().trim() : ''
  if (top && looseMatch(top, t)) return true
  const arr = Array.isArray(j?.specialties) ? j.specialties : []
  return arr.some((s: unknown) => {
    if (!s || typeof s !== 'object') return false
    const name = (s as { specialtyName?: unknown }).specialtyName
    if (typeof name !== 'string') return false
    const n = name.toLowerCase().trim()
    return looseMatch(n, t)
  })
}

/** Multiplier sanity — a ratio like 1.3×. Filters out any row that
 *  encoded the field as a percentage (e.g. 130) or garbage. */
function sensibleMultiplier(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3
}

// ---------- public API ----------

/**
 * Per-HCO cap profile. Returns `null` when fewer than MIN_N enriched jobs
 * match the given organization.
 */
export function observedHcoProfile(
  jobs: EnrichedJob[] | null | undefined,
  organization: string,
): HcoProfile | null {
  if (!Array.isArray(jobs) || !organization) return null
  const matched = jobs.filter(j => isEnriched(j) && hcoMatches(j, organization))
  if (matched.length < MIN_N) return null

  const maxRegular = finiteNumbers(matched.map(j => j?.rateRequirements?.maxRegular))
  const otMult = matched.map(j => j?.rateRequirements?.maxOvertimeMultiplier).filter(sensibleMultiplier)
  const holMult = matched.map(j => j?.rateRequirements?.maxHolidayMultiplier).filter(sensibleMultiplier)
  const orientationCap = finiteNumbers(matched.map(j => j?.rateRequirements?.maxOrientation))
  const vendorCount = finiteNumbers(matched.map(j => j?.vendorCount))
  const credDays = finiteNumbers(matched.map(j => j?.estimatedCredentialingTime))
  const insurer = nonEmptyStrings(matched.map(j => j?.insuranceProvidedBy))

  return {
    n: matched.length,
    rateCapMedian: quantile(maxRegular, 0.5),
    rateCapP25: quantile(maxRegular, 0.25),
    rateCapP75: quantile(maxRegular, 0.75),
    otMultiplierMedian: quantile(otMult, 0.5),
    holidayMultiplierMedian: quantile(holMult, 0.5),
    orientationCapMedian: quantile(orientationCap, 0.5),
    insuranceProvidedBy: mode(insurer),
    avgVendorCount: mean(vendorCount),
    avgCredentialingDays: mean(credDays),
  }
}

/**
 * Per-specialty cap profile. Returns `null` when fewer than MIN_N enriched
 * jobs match the given specialty name.
 */
export function observedSpecialtyProfile(
  jobs: EnrichedJob[] | null | undefined,
  specialty: string,
): SpecialtyProfile | null {
  if (!Array.isArray(jobs) || !specialty) return null
  const matched = jobs.filter(j => isEnriched(j) && specialtyMatches(j, specialty))
  if (matched.length < MIN_N) return null

  const maxRegular = finiteNumbers(matched.map(j => j?.rateRequirements?.maxRegular))
  const otMult = matched.map(j => j?.rateRequirements?.maxOvertimeMultiplier).filter(sensibleMultiplier)
  const holMult = matched.map(j => j?.rateRequirements?.maxHolidayMultiplier).filter(sensibleMultiplier)
  const vendorCount = finiteNumbers(matched.map(j => j?.vendorCount))

  return {
    n: matched.length,
    rateCapMedian: quantile(maxRegular, 0.5),
    rateCapP25: quantile(maxRegular, 0.25),
    rateCapP75: quantile(maxRegular, 0.75),
    otMultiplierMedian: quantile(otMult, 0.5),
    holidayMultiplierMedian: quantile(holMult, 0.5),
    avgVendorCount: mean(vendorCount),
  }
}

/** Count of enriched records in the live feed. Useful for UX coverage notes. */
export function enrichedJobCount(jobs: EnrichedJob[] | null | undefined): number {
  if (!Array.isArray(jobs)) return 0
  return jobs.reduce((n, j) => n + (isEnriched(j) ? 1 : 0), 0)
}

export const LIVE_CALIBRATION_MIN_N = MIN_N
