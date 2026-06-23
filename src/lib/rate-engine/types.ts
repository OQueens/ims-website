// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// types.ts — TypeScript interfaces for the Rate Simulator engine
// Extracted from rate-simulator/index.html (monolithic source)
// ============================================================

// Re-export SpecialtyRate from specialties.ts for convenience
export type { SpecialtyRate } from './specialties';

/**
 * Discriminates how a fuzzy match was reached.
 * - `exact`: input equals the canonical key (or an alias entry maps directly)
 * - `substring`: input is a strict substring of a longer canonical key
 *   (one-way `candidate.includes(token)` with MIN_TARGET_LEN floor)
 *
 * Replaces the old Levenshtein `distance` semantics: under Levenshtein,
 * `distance === 0` meant exact and `> 0` meant fuzzy. Under the substring rule
 * `distance` is always 0, so any caller checking `distance` for the exact-vs-fuzzy
 * split must read `matchKind` instead. See feedback_contract_change_call_site_sweep.md.
 */
export type FuzzyMatchKind = 'exact' | 'substring';

/** Result of fuzzy-matching a specialty */
export interface FuzzySpecialtyMatch {
  key: string;
  distance: number;
  matchKind: FuzzyMatchKind;
}

/** Result of fuzzy-matching a state */
export interface FuzzyStateMatch {
  code: string;
  distance: number;
  matchKind: FuzzyMatchKind;
}

/** Result of fuzzy-matching a city */
export interface FuzzyCityMatch {
  city: string;
  distance: number;
  matchKind: FuzzyMatchKind;
}

/** Correction applied during free-text parsing */
export interface ParseCorrection {
  field: 'specialty' | 'state' | 'city';
  from: string;
  to: string;
}

/** Output of parseFreetextInput() */
export interface FreetextParseResult {
  specialty: FuzzySpecialtyMatch | null;
  state: FuzzyStateMatch | null;
  city: FuzzyCityMatch | null;
  facility: string | null;
  shift: string | null;
  call: boolean | null;
  duration: string | null;
  holiday: boolean;
  corrections: ParseCorrection[];
}

/** A facility extracted from a PDF or freetext */
export interface Facility {
  name: string;
  city: string;
  state: string;
}

/** A contact extracted from a PDF */
export interface Contact {
  name: string;
  role: string;
  facility: string;
}

/** A section item (label: value pair) */
export interface SectionItem {
  label: string;
  value: string;
}

/** A parsed section from a PDF */
export interface ParsedSection {
  title: string;
  items: SectionItem[];
}

/** Full parsed assignment — from PDF, freetext, or Firebase */
export interface ParsedAssignment {
  assignmentNumber: string;
  specialty: string;
  status: string;
  hco: string;
  startDate: string;
  endDate: string;
  providersRequested?: string;
  nearestAirport?: string;
  facilities: Facility[];
  contacts?: Contact[];
  sections: ParsedSection[];
  notes?: string;
  _rawText?: string;
  _source?: 'pdf' | 'freetext' | 'firebase';
  _freetextParsed?: FreetextParseResult;
}

/** Source tag for a factor (how was it determined) */
export type FactorSource = 'pdf' | 'inferred' | 'default' | 'manual' | 'typed';

/** A factor with its value and source */
export interface SpecialtyFactor {
  key: string;
  source: FactorSource;
}

export interface StateFactor {
  code: string | null;
  source: FactorSource;
}

export interface RuralFactor {
  isRural: boolean;
  source: FactorSource;
}

export interface ShiftFactor {
  key: string;
  source: FactorSource;
}

export interface FacilityFactor {
  key: string;
  source: FactorSource;
}

export interface DurationFactor {
  key: string;
  source: FactorSource;
}

export interface CallFactor {
  hasCall: boolean;
  source: FactorSource;
}

export interface HolidayFactor {
  /** True when the assignment requires the provider to work on a holiday — adds 1.10× hourly multiplier. */
  hasHoliday: boolean;
  /** True when the PDF mentions holiday eligibility (e.g. "Allowed Holidays: 4")
   *  but does NOT require coverage. Surfaces in UX as a small note; does NOT add the multiplier. */
  holidayAllowed: boolean;
  source: FactorSource;
}

/**
 * Unit hint extracted alongside the dollar cap value. Determines which
 * calculation path applies the cap. `unknown` means the source mentioned
 * a cap but no unit hint (e.g. naked "not to exceed $200") — UI must
 * surface the ambiguity (`hasWarning`) and the math should NOT silently
 * apply the cap on call-only (per Codex C-1: applying unknown as daily
 * reproduces the same wrong-answer class S2 was meant to remove).
 */
export type RateCapUnit = 'hour' | 'day' | 'shift' | 'unknown';

export interface RateCapFactor {
  cap: number | null;
  unit: RateCapUnit;
  source: string | null;
  hasWarning: boolean;
}

export interface CallOnlyFactor {
  isCallOnly: boolean;
  source: FactorSource;
  reason: string | null;
}

export interface DayTypeFactor {
  key: 'weekday' | 'weekend' | 'holiday';
  source: FactorSource;
}

/** All rate factors used for calculation */
export interface RateFactors {
  specialty: SpecialtyFactor;
  state: StateFactor;
  rural: RuralFactor;
  shift: ShiftFactor;
  facility: FacilityFactor;
  duration: DurationFactor;
  call: CallFactor;
  holiday: HolidayFactor;
  rateCap: RateCapFactor;
  baseRate: number;
  callOnly: CallOnlyFactor;
  dayType: DayTypeFactor;
  includedHours: number;
  callbackRate: number;
}

/** Shift multiplier entry */
export interface ShiftMultEntry {
  mult: number;
  label: string;
}

/** Facility multiplier entry */
export interface FacilityMultEntry {
  mult: number;
  label: string;
}

/** Duration multiplier entry */
export interface DurationMultEntry {
  mult: number;
  label: string;
}

/**
 * Compensation model a call-only daily rate is observed under. The public
 * research (docs/rate-simulator/call-rate-research-2026-06-03-deep-research.pdf)
 * is emphatic that these are NOT interchangeable — a 24-hr beeper-call stipend,
 * a worked clinical day, and a callback hour price differently and must never be
 * mixed. The model drives the $/hr coverage divisor and is surfaced to the user.
 */
export type CallCompModel =
  | 'worked-day-clinic'    // a scheduled clinical day (8/10/12-hr shift)
  | '24hr-beeper-call'     // a 24-hour beeper/availability call stipend
  | 'mixed'                // source blended worked-day + call (e.g. cardiology)
  | 'unknown';

/**
 * A real, observed daily-rate band for one day-type. `min`/`max` are the full
 * observed public band ($/day); `typical` is the central estimate used as the
 * multiplier base; `max` is the researched ceiling the engine clamps to (no
 * quote may exceed the highest publicly-observed daily). `coverageHrs` is the
 * comp-model's coverage hours — the honest denominator for the hero $/hr
 * conversion (24 for beeper-call, the scheduled shift for a worked-day).
 * Every field traces to the cited research; none is fabricated.
 */
export interface CallRateBand {
  min: number;
  max: number;
  typical: number;
  compModel: CallCompModel;
  coverageHrs: number;
}

/** Observed public callback differential band ($/hr). */
export interface CallbackBand {
  min: number;
  max: number;
}

/**
 * Call-only / per-diem rate entry — real observed bands per day-type, or `null`
 * where the public research found insufficient data (cite-or-suppress; never a
 * fabricated single-point number). Carries provenance: # of public sources, the
 * callback band, the gratis-hour threshold, and — for specialties whose daily is
 * insufficient but whose hourly IS public (e.g. CRNA) — a real adjacent hourly
 * signal so the UI can inform without inventing a daily stipend.
 */
export interface CallRateEntry {
  weekday: CallRateBand | null;
  weekend: CallRateBand | null;
  holiday: CallRateBand | null;
  callback: CallbackBand | null;
  /** Gratis/included hours before callback applies; null where not published. */
  gratisHrs: number | null;
  /** Count of distinct public 2024–2026 sources behind this specialty's data. */
  sources: number;
  category: string;
  /**
   * Real public hourly signal ($/hr) for specialties whose call-only DAILY is
   * insufficient but whose hourly locum rate IS publicly posted (CRNA $200–325,
   * psychiatry $200–260, neonatology $200–220). Surfaced as context only — the
   * research explicitly refuses to convert a 24-hr hourly posting into a day
   * stipend, so this NEVER becomes a daily number.
   */
  adjacentHourly?: CallbackBand | null;
  /** Short provenance/comp-model note transcribed from the research. */
  note?: string;
}

/** Calculated hourly rate result */
export interface CalculatedRate {
  base: number;
  geoMult: number;
  ruralMult: number;
  shiftMult: number;
  facilityMult: number;
  durationMult: number;
  callMult: number;
  holidayMult: number;
  /** T13/S6 H-5 (2026-04-29): geo × rural × shift × facility × duration × call ×
   *  holiday — the engine-computed product of the per-factor multipliers exposed
   *  above. Pre-cap. Used by `computeAdjustedSpecRange` and any future UI
   *  consumer that needs the effective combined multiplier so they don't
   *  recompose the chain (drift risk: a new multiplier added to `calculateRate`
   *  would otherwise have to be added to every consumer). Read this, don't
   *  recompose it. */
  combinedMult: number;
  /** T13/S6 H-5 (2026-04-29): `Math.min(combinedMult, 1.75)` — the same 1.75x
   *  ceiling `calculateRate` applies before multiplying base. Read this, don't
   *  recompute. The ceiling itself is intentionally not exposed as a constant
   *  because it is one number that lives in `calculateRate`. */
  cappedMult: number;
  payRate: number;
  billRate: number;
  capped: boolean;
  /** T15a Codex MUST 4 (2026-04-29): hourly path has no breakdown, so the
   *  hero pay is the only thing that can be capped. `payRateCapped` mirrors
   *  `capped` here, exposed for symmetric consumption with CalculatedCallRate
   *  so callers don't need an isCallOnly branch. Used by computeDisplayedRate
   *  to gate calibration suppression on a hero-row clamp specifically. */
  payRateCapped: boolean;
  uncapped: number;
  /** Accuracy audit 2026-06-01: true iff the researched-range ceiling clamped
   *  payRate to spec.max (the multiplier estimate exceeded the specialty's
   *  researched max). DELIBERATELY separate from `capped`/`payRateCapped` so it
   *  does NOT trip computeDisplayedRate's positive-calibration suppression —
   *  observed feedback may still adjust within ±15%. Optional/additive so
   *  consumers (and CalculatedCallRate) that don't set/read it are unaffected. */
  marketMaxApplied?: boolean;
  isCallOnly: false;
}

/** Calculated call-only (per-diem) rate result */
export interface CalculatedCallRate {
  isCallOnly: true;
  dayType: string;
  /**
   * FACTOR-05 (2026-06-03): the public research found no defensible call-only
   * daily band for the RESOLVED day-type of this specialty (most specialties,
   * incl. CRNA/ER/psychiatry). When true, the engine emits NO fabricated daily
   * — numeric pay fields are 0 sentinels and the UI must render the honest
   * "insufficient public data" surface instead of a dollar hero, using the
   * carried band/callback/adjacentHourly provenance.
   */
  insufficientData: boolean;
  /**
   * Comp-model coverage hours for the resolved day-type — the honest $/hr
   * divisor (24 for a 24-hr beeper-call, the scheduled shift for a worked-day).
   * Replaces the old gratis-hour divisor that overstated beeper-call $/hr.
   */
  coverageHrs: number;
  /** Comp-model of the resolved day-type (drives the coverage divisor + label). */
  compModel: CallCompModel;
  /** Count of distinct public sources behind this specialty's call data. */
  sources: number;
  /** Researched daily bands per day-type (null = insufficient public data). */
  bands: {
    weekday: CallRateBand | null;
    weekend: CallRateBand | null;
    holiday: CallRateBand | null;
  };
  /** Per-day-type sufficiency — false where that day's band is insufficient. */
  weekdaySufficient: boolean;
  weekendSufficient: boolean;
  holidaySufficient: boolean;
  /** Observed callback differential band ($/hr); null where not published. */
  callbackBand: CallbackBand | null;
  /** Real public hourly signal for insufficient-daily specialties (CRNA etc.). */
  adjacentHourly: CallbackBand | null;
  /**
   * The researched band `max` clamped the per-assignment daily (no quote may
   * exceed the highest publicly-observed daily for this specialty/day-type).
   * Mirrors CalculatedRate.marketMaxApplied so the UI caption is symmetric.
   */
  marketMaxApplied: boolean;
  /** Short provenance/comp-model note from the research. */
  note?: string;
  baseDaily: number;
  geoMult: number;
  ruralMult: number;
  facilityMult: number;
  durationMult: number;
  /** T13/S6 H-5 (2026-04-29): geo × rural × facility × duration. Call-only does
   *  NOT stack shift/call/holiday multipliers — those are baked into the
   *  per-day-type base rate (weekday/weekend/holiday). Pre-cap. Exposed for
   *  parity with CalculatedRate so any consumer can read the effective combined
   *  multiplier without branching on isCallOnly. The Market Position bar is
   *  hourly-only today, but exposing the field on both shapes prevents future
   *  divergence and lets a `CalculatedRate | CalculatedCallRate` consumer
   *  read the field uniformly. */
  combinedMult: number;
  /** T13/S6 H-5 (2026-04-29): `Math.min(combinedMult, 1.75)` — same ceiling as
   *  the hourly path. Read this, don't recompute. */
  cappedMult: number;
  dailyPay: number;
  dailyBill: number;
  callbackRate: number;
  includedHrs: number;
  weekdayPay: number;
  weekendPay: number;
  holidayPay: number;
  weekdayBill: number;
  weekendBill: number;
  holidayBill: number;
  capped: boolean;
  /** T15a Codex MUST 4 (2026-04-29): the hero `dailyPay` was clamped by
   *  the rate cap. `capped` is the umbrella OR — true when EITHER the hero
   *  was clamped OR a breakdown row was clamped — and remains the field
   *  the UI cap-warning badge reads (any clamp is user-relevant). But
   *  `computeDisplayedRate` must only suppress positive calibration when
   *  the hero ITSELF is at-cap; otherwise a weekday hero below the cap
   *  loses calibration just because weekend/holiday rows in the breakdown
   *  were clamped. Use `payRateCapped` for that gate. */
  payRateCapped: boolean;
  /** T15a Codex MUST 4 round-2 (2026-04-29): the daily-pay cap (cap × 0.80
   *  for day/shift units) that calculateCallRate applied to the hero and
   *  breakdown rows. Null when no rate cap binds on this assignment.
   *  Display-layer calibration applies a ratio to the engine's already-
   *  clamped breakdown rows, which would breach this cap; the helper
   *  `applyCalibrationToBreakdownPay` re-clamps post-multiply using this
   *  field. */
  payCap: number | null;
  uncapped: number;
  // Compat fields so logging doesn't break
  payRate: number;
  billRate: number;
  base: number;
  shiftMult: number;
  callMult: number;
  holidayMult: number;
}

/** GSA per diem rates */
export interface GsaRates {
  lodging: number;
  mie: number;
  total: number;
}

/** Confidence level */
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

/** Duration pattern used in freetext parsing */
export interface DurationPattern {
  regex: RegExp;
  fn: (m: RegExpMatchArray) => string;
}

/** Rate data source entry */
export interface RateSourceEntry {
  name: string;
  sources: string[];
  year: string;
  count: number;
}
