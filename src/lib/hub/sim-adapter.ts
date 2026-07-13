// Faithful bridge between the hub's Rate Simulator UI and the REAL vendored
// rate engine (src/lib/rate-engine/, ported read-only from the IAS dashboard).
//
// This is a PORT, not a reinvention: every quote goes through the SAME path the
// dashboard uses — `initFactors(parsed)` for a LocumSmart PDF / freetext, or a
// control-built RateFactors for a manual quote, then `calculateRate` (hourly) or
// `calculateCallRate` (call-only). No rate math lives here; the numbers are
// byte-for-byte what the dashboard produces for the same factors (golden-master
// parity-locked). The hero is the clinician hourly PAY rate ("recommended
// provider pay" — exactly the dashboard's hero); the agency BILL is derived
// below it at the chosen margin (roundUp5(pay/(1-margin)), the engine invariant).
//
// Live market-overlay + observed-feedback calibration (Firebase/Supabase) is the
// Phase-2 layer; the dashboard falls back to the raw engine rate when it's
// absent, so this pure port is faithful today and the overlay slots in later.
import {
  SPECIALTIES, SPECIALTY_ALIASES, STATE_NAMES, STATE_MULT, SHIFT_MULT,
  calculateRate, calculateCallRate, initFactors,
  parseLocumsmartAssignment, buildParsedFromFreetext, fuzzyMatchSpecialty, roundUp5,
  confidenceLabel,
  type RateFactors, type CalculatedRate, type CalculatedCallRate,
  type ParsedAssignment, type ConfidenceLevel, type CallCompModel,
} from '../rate-engine/index';
// scoreConfidence + computeAdjustedSpecRange are pure engine functions that the
// Phase-1 barrel doesn't re-export; import them straight from the (vendored,
// backend-free) calculator module. They pull only specialty/state/multiplier
// data — no Firebase, no Supabase.
import { scoreConfidence, computeAdjustedSpecRange } from '../rate-engine/rateCalculator';

// Default specialty for the simulator's first paint + the job-slug fallback.
export const DEFAULT_SIM_SPECIALTY = 'anesthesiology';

// ── Control model ───────────────────────────────────────────────────────────
// The hub's existing controls (specialty · region · shift · urgency · length ·
// margin). `stateCode` is the EXACT state when a PDF supplied one (full engine
// fidelity); it overrides the coarse region for geography until the user picks a
// region button again.
export interface SimControls {
  specialtyKey: string;
  region: string;            // 'National' | 'West' | 'Midwest' | 'Northeast' | 'South'
  stateCode: string | null;  // exact engine state code (from a PDF); null → use region
  shift: string;             // engine SHIFT_MULT key
  urgency: string;           // 'Standard' | 'Priority' | 'Emergent'
  weeks: number;
  marginPct: number;
}

export function defaultControls(): SimControls {
  return { specialtyKey: DEFAULT_SIM_SPECIALTY, region: 'National', stateCode: null, shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22 };
}

// ── Geography: region buttons over a per-state engine ─────────────────────────
// The engine prices geography PER STATE. The hub keeps region buttons, so each
// region maps to the state nearest that region's average multiplier — a real
// per-state engine value (not a fabricated regional number). A PDF supplies the
// exact state, which is always preferred over the region approximation.
const STATE_REGION: Record<string, 'West' | 'Midwest' | 'Northeast' | 'South'> = {
  AK: 'West', AZ: 'West', CA: 'West', CO: 'West', HI: 'West', ID: 'West', MT: 'West',
  NV: 'West', NM: 'West', OR: 'West', UT: 'West', WA: 'West', WY: 'West',
  IA: 'Midwest', IL: 'Midwest', IN: 'Midwest', KS: 'Midwest', MI: 'Midwest', MN: 'Midwest',
  MO: 'Midwest', ND: 'Midwest', NE: 'Midwest', OH: 'Midwest', SD: 'Midwest', WI: 'Midwest',
  CT: 'Northeast', MA: 'Northeast', ME: 'Northeast', NH: 'Northeast', NJ: 'Northeast',
  NY: 'Northeast', PA: 'Northeast', RI: 'Northeast', VT: 'Northeast',
  AL: 'South', AR: 'South', DC: 'South', DE: 'South', FL: 'South', GA: 'South', KY: 'South',
  LA: 'South', MD: 'South', MS: 'South', NC: 'South', OK: 'South', SC: 'South', TN: 'South',
  TX: 'South', VA: 'South', WV: 'South',
};
const REGION_ORDER = ['National', 'West', 'Midwest', 'Northeast', 'South'] as const;

function regionStates(region: string): string[] {
  return Object.keys(STATE_MULT).filter((s) => (STATE_REGION[s] ?? 'South') === region);
}
// The state whose multiplier is closest to the region mean — the honest
// "representative" of that region for the per-state engine.
function representativeState(region: string): string | null {
  if (region === 'National') return null;
  const states = regionStates(region);
  if (!states.length) return null;
  const mean = states.reduce((a, s) => a + STATE_MULT[s], 0) / states.length;
  return states.reduce((best, s) => (Math.abs(STATE_MULT[s] - mean) < Math.abs(STATE_MULT[best] - mean) ? s : best));
}

export interface SimRegionOption { key: string; label: string; mult: number; repState: string | null; }
const REGION_LABELS: Record<string, string> = { National: 'National', West: 'West', Midwest: 'Midwest', Northeast: 'Northeast', South: 'South' };
// Region buttons with the multiplier their representative state carries (so the
// UI can show the geo effect without recomputing). National = no adjustment.
export function simRegionOptions(): SimRegionOption[] {
  return REGION_ORDER.map((region) => {
    const rep = representativeState(region);
    return { key: region, label: REGION_LABELS[region], mult: rep ? STATE_MULT[rep] : 1.0, repState: rep };
  });
}

// The engine state code a control set resolves to: an exact PDF state wins;
// otherwise the region's representative state (null = National, no geo).
function geoStateCode(c: SimControls): string | null {
  if (c.stateCode && STATE_MULT[c.stateCode]) return c.stateCode;
  return representativeState(c.region);
}

// ── Urgency ⇄ duration ────────────────────────────────────────────────────────
// Urgency escalates the engine's DURATION premium. Standard falls back to the
// assignment length. The inverse (durationToUrgencyWeeks) round-trips exactly.
function durationKey(urgency: string, weeks: number): string {
  if (urgency === 'Emergent') return 'emergency';
  if (urgency === 'Priority') return 'short';
  if (weeks >= 26) return 'long';
  if (weeks <= 6) return 'short';
  return 'standard';
}
function durationToUrgencyWeeks(key: string): { urgency: string; weeks: number } {
  switch (key) {
    case 'emergency': return { urgency: 'Emergent', weeks: 1 };
    case 'short':     return { urgency: 'Standard', weeks: 4 };
    case 'long':      return { urgency: 'Standard', weeks: 26 };
    default:          return { urgency: 'Standard', weeks: 8 };
  }
}
export function regionForState(code: string | null): string {
  return code && STATE_MULT[code] ? (STATE_REGION[code] ?? 'South') : 'National';
}

// ── Factors ───────────────────────────────────────────────────────────────────
// A manual quote: the controls set specialty/state/shift/duration; facility,
// call, holiday and rate-cap take the engine's neutral defaults (community / no
// call / no holiday) — identical to a dashboard manual quote with those factors.
export function factorsFromControls(c: SimControls): RateFactors {
  const spec = SPECIALTIES[c.specialtyKey];
  if (!spec) throw new Error(`sim-adapter: unknown specialty "${c.specialtyKey}"`);
  const stateCode = geoStateCode(c);
  return {
    specialty: { key: c.specialtyKey, source: 'manual' },
    // Honesty: only claim the geography is "known" when one was actually resolved.
    // A National quote (no state) must score Medium, not High — scoreConfidence keys
    // off state.source, and the dashboard never shows High without a state.
    state: { code: stateCode, source: stateCode ? 'manual' : 'default' },
    rural: { isRural: false, source: 'manual' },
    shift: { key: SHIFT_MULT[c.shift] ? c.shift : 'day', source: 'manual' },
    facility: { key: 'community', source: 'manual' },
    duration: { key: durationKey(c.urgency, c.weeks), source: 'manual' },
    call: { hasCall: false, source: 'manual' },
    holiday: { hasHoliday: false, holidayAllowed: false, source: 'manual' },
    rateCap: { cap: null, unit: 'unknown', source: null, hasWarning: false },
    baseRate: spec.p70,
    callOnly: { isCallOnly: false, source: 'default', reason: null },
    dayType: { key: 'weekday', source: 'default' },
    includedHours: 0,
    callbackRate: 0,
  };
}

export interface SimParseResult {
  factors: RateFactors;   // FULL engine factors (geo/shift/facility/duration/call/holiday) — dashboard-identical
  controls: SimControls;  // what the visible controls should reflect
  parsed: ParsedAssignment;
  specialtyLabel: string;
  stateName: string | null;
  assignmentNumber: string;
  source: 'pdf' | 'freetext';
  // True when the engine classified this as a call-only / per-diem assignment.
  // The hub quotes it from `factors` (call-only path) and renders the honest
  // call-only surface — it must NOT be silently re-quoted as an hourly assignment.
  isCallOnly: boolean;
}

// Build the visible controls from the engine's inferred factors (so the UI
// reflects a parsed assignment). Geo shows the parsed state's region; the exact
// state is retained in controls.stateCode so the quote stays full-fidelity.
function controlsFromFactors(f: RateFactors, marginPct: number): SimControls {
  const { urgency, weeks } = durationToUrgencyWeeks(f.duration.key);
  return {
    specialtyKey: f.specialty.key,
    region: regionForState(f.state.code),
    stateCode: f.state.code,
    shift: SHIFT_MULT[f.shift.key] ? f.shift.key : 'day',
    urgency,
    weeks,
    marginPct,
  };
}

// Parse LocumSmart PDF text → full factors + control reflection. Returns null
// when no real specialty was resolved (the engine's unrecognized fallback) so
// the UI can say "couldn't read it" instead of asserting a default specialty.
export function simParseAssignment(text: string, marginPct = 22): SimParseResult | null {
  const parsed = parseLocumsmartAssignment(text);
  const f = initFactors(parsed);
  if (f.specialty.source === 'default') return null;
  return {
    factors: f,
    controls: controlsFromFactors(f, marginPct),
    parsed,
    specialtyLabel: labelFor(f.specialty.key),
    stateName: f.state.code ? (STATE_NAMES[f.state.code] ?? f.state.code) : null,
    assignmentNumber: parsed.assignmentNumber || '',
    source: 'pdf',
    isCallOnly: f.callOnly.isCallOnly,
  };
}

// Freetext path ("CRNA nights in Houston, TX") — mirrors the dashboard's
// freetext entry. Returns null when no specialty is recognized.
export function simParseFreetext(text: string, marginPct = 22): SimParseResult | null {
  const parsed = buildParsedFromFreetext(text);
  if (!parsed) return null;
  const f = initFactors(parsed);
  if (f.specialty.source === 'default') return null;
  return {
    factors: f,
    controls: controlsFromFactors(f, marginPct),
    parsed,
    specialtyLabel: labelFor(f.specialty.key),
    stateName: f.state.code ? (STATE_NAMES[f.state.code] ?? f.state.code) : null,
    assignmentNumber: parsed.assignmentNumber || '',
    source: 'freetext',
    isCallOnly: f.callOnly.isCallOnly,
  };
}

// ── Quote (mirrors the dashboard's RateResults) ───────────────────────────────
export interface WaterfallStep { label: string; value: number; mult: number; }
export interface SimQuote {
  isCallOnly: boolean;
  payRate: number;        // HERO — clinician hourly pay ("recommended provider pay")
  billRate: number;       // agency bill at the chosen margin (roundUp5)
  marginPct: number;
  marginPerHr: number;
  confidence: ConfidenceLevel;
  confidenceData: string; // researched data tier label (e.g. "high", "research-derived")
  confidenceReason: string; // honest one-liner naming the limiting factor
  category: string;
  specMin: number;
  specMax: number;
  waterfall: WaterfallStep[];     // base → geo → shift → facility → duration → call → holiday
  marketMin: number;              // researched range for the market-position bar
  marketMax: number;
  marketMarker: number;
  percentiles: Array<{ p: number; value: number }>;
  capped: boolean;
  marketMaxApplied: boolean;
  uncapped: number;
  // Call-only extras (insufficientData true → show the honest no-fabrication surface)
  callOnly?: {
    insufficientData: boolean;
    dayType: string;
    dailyPay: number;
    compModel: CallCompModel;
    coverageHrs: number;
    sources: number;
    note?: string;
  };
}

const WF_PERCENTILES = [25, 50, 70, 75, 90];

// ── Confidence honesty ────────────────────────────────────────────────────────
// The displayed confidence must reflect how trustworthy the DOLLAR figure is, not
// just whether we identified the inputs. scoreConfidence (engine) is identification
// confidence (specialty + geography → High). We blend it with the specialty's DATA
// tier (spec.confidence: how well-researched its rate band is) and show the WEAKER
// of the two — so a well-identified CRNA quote reads Medium (its band is only
// 'medium'-researched), never "High" over an uncalibrated static estimate.
const CONF_RANK: Record<ConfidenceLevel, number> = { Low: 0, Medium: 1, High: 2 };
const RANK_CONF: ConfidenceLevel[] = ['Low', 'Medium', 'High'];
function dataTierConfidence(tier: string | undefined): ConfidenceLevel {
  return tier === 'high' ? 'High' : tier === 'medium' ? 'Medium' : 'Low';
}
function weakerConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return RANK_CONF[Math.min(CONF_RANK[a], CONF_RANK[b])];
}
// Names the LIMITING factor honestly (geography missing vs lightly-researched band).
function confidenceReasonFor(factors: RateFactors, tier: string | undefined): string {
  if (factors.specialty.source === 'default') return 'Specialty not recognized — quote manually.';
  if (factors.state.source === 'default') return 'Geography not specified — national estimate.';
  if (tier === 'medium') return 'Geography identified; the rate band for this specialty is moderately researched — treat as an estimate.';
  if (tier !== 'high') return 'Geography identified, but the rate band for this specialty is lightly researched — treat as a rough estimate.';
  return 'Specialty and geography identified; well-researched rate band.';
}

// Hourly waterfall — the dashboard's buildWaterfall (hourly branch): each row is
// the running product through one multiplier; rows with mult 1.0 are dropped
// (except Base).
function hourlyWaterfall(r: CalculatedRate): WaterfallStep[] {
  const b = r.base;
  const rows: WaterfallStep[] = [
    { label: 'Base', value: b, mult: 1.0 },
    { label: 'Geography', value: Math.round(b * r.geoMult), mult: r.geoMult },
    { label: 'Rural', value: Math.round(b * r.geoMult * r.ruralMult), mult: r.ruralMult },
    { label: 'Shift', value: Math.round(b * r.geoMult * r.ruralMult * r.shiftMult), mult: r.shiftMult },
    { label: 'Facility', value: Math.round(b * r.geoMult * r.ruralMult * r.shiftMult * r.facilityMult), mult: r.facilityMult },
    { label: 'Duration', value: Math.round(b * r.geoMult * r.ruralMult * r.shiftMult * r.facilityMult * r.durationMult), mult: r.durationMult },
    { label: 'Call', value: Math.round(b * r.geoMult * r.ruralMult * r.shiftMult * r.facilityMult * r.durationMult * r.callMult), mult: r.callMult },
    { label: 'Holiday', value: r.payRate, mult: r.holidayMult },
  ];
  return rows.filter((row) => row.label === 'Base' || row.mult !== 1.0);
}

function bill(pay: number, marginPct: number): number {
  const m = Math.min(Math.max(marginPct, 0), 95) / 100;
  return roundUp5(pay / (1 - m));  // engine invariant (BillRateCalculator), not Math.round
}

// THE quote. `calculateRate`/`calculateCallRate` are the engine — this only
// shapes their output for the hub panel. Identical numbers to the dashboard.
export function quoteFromFactors(factors: RateFactors, marginPct: number): SimQuote {
  const spec = SPECIALTIES[factors.specialty.key];
  // C6 (2026-07-10 accuracy audit): re-derive baseRate from the CURRENT spec.p70.
  // Every factor-construction site (rateCalculator initFactors:901, factorsFromControls:144)
  // FREEZES baseRate = spec.p70 at build time. When the async market overlay promotes
  // a cell AFTER a parsed assignment's factors were frozen, a re-quote off the frozen
  // base would move only the ceiling (calculateRate reads spec.max fresh) and leave the
  // hero anchored to the stale base — the observed anchor never reaches the quote base.
  // Refreshing ONLY baseRate lets the live anchor drive the hero while the parsed
  // assignment's other factors (shift/facility/call/duration) stay correctly frozen.
  // No-op when spec.p70 is unchanged (byte-identical to prior behavior). `spec` is a
  // DEFINED invariant on this path — factorsFromControls throws on an unknown
  // specialty and the parse paths resolve canonical keys — and the rest of the hourly
  // math already dereferences it directly and unconditionally (computeAdjustedSpecRange,
  // rateCalculator.ts:752), so a spec-undefined guard here would be inconsistent
  // false-safety (Codex gate 2026-07-10).
  const f = { ...factors, baseRate: spec.p70 };
  // HONEST confidence (see helpers above): weaker of identification vs data tier.
  const confidence = weakerConfidence(scoreConfidence(factors), dataTierConfidence(spec?.confidence));
  const confidenceData = confidenceLabel(spec?.confidence ?? 'modeled');
  const confidenceReason = confidenceReasonFor(factors, spec?.confidence);

  if (factors.callOnly.isCallOnly) {
    const cr = calculateCallRate(f) as CalculatedCallRate;
    // Honest $/hr conversion of the daily stipend (dashboard: daily ÷ coverageHrs).
    const div = cr.coverageHrs > 0 ? cr.coverageHrs : 1;
    const payRate = cr.insufficientData ? 0 : Math.round(cr.dailyPay / div);
    // Call-only bill = the dashboard's FIXED 20% margin (RateResults.tsx:236,
    // roundUp5(heroPay/0.80)) — NOT the hourly Target-margin slider. Per-diem
    // economics use call markup bands, never the 15-45% hourly slider, so we never
    // emit a bill the dashboard wouldn't (or one below the 20% call floor).
    const callBill = payRate > 0 ? roundUp5(payRate / 0.80) : 0;
    return {
      isCallOnly: true,
      payRate,
      billRate: callBill,
      marginPct,
      marginPerHr: callBill - payRate,
      confidence,
      confidenceData,
      confidenceReason,
      category: spec?.category ?? 'Unknown',
      specMin: spec?.min ?? 0,
      specMax: spec?.max ?? 0,
      waterfall: [],
      marketMin: spec?.min ?? 0,
      marketMax: spec?.max ?? 0,
      marketMarker: payRate,
      percentiles: [],
      capped: cr.capped,
      marketMaxApplied: cr.marketMaxApplied,
      uncapped: cr.coverageHrs > 0 ? Math.round(cr.uncapped / div) : cr.uncapped,
      callOnly: {
        insufficientData: cr.insufficientData,
        dayType: cr.dayType,
        dailyPay: cr.dailyPay,
        compModel: cr.compModel,
        coverageHrs: cr.coverageHrs,
        sources: cr.sources,
        note: cr.note,
      },
    };
  }

  const r = calculateRate(f) as CalculatedRate;
  const { adjustedMin, adjustedMax } = computeAdjustedSpecRange(spec, f, r);
  return {
    isCallOnly: false,
    payRate: r.payRate,
    billRate: bill(r.payRate, marginPct),
    marginPct,
    marginPerHr: bill(r.payRate, marginPct) - r.payRate,
    confidence,
    confidenceData,
    confidenceReason,
    category: spec?.category ?? 'Unknown',
    specMin: spec?.min ?? 0,
    specMax: spec?.max ?? 0,
    waterfall: hourlyWaterfall(r),
    marketMin: adjustedMin,
    marketMax: adjustedMax,
    marketMarker: r.payRate,
    percentiles: WF_PERCENTILES.map((p) => ({ p, value: Math.round(adjustedMin + (adjustedMax - adjustedMin) * (p / 100)) })),
    capped: r.capped,
    marketMaxApplied: r.marketMaxApplied === true,
    uncapped: r.uncapped,
  };
}

// Convenience: quote straight from controls (manual path).
export function quoteFromControls(c: SimControls): SimQuote {
  return quoteFromFactors(factorsFromControls(c), c.marginPct);
}

// ── Bill Rate Calculator (faithful port of the dashboard BillRateCalculator) ───
// Pure margin math on the hero hourly PAY rate. Every bill = roundUp5(pay/(1-m))
// — the engine invariant, recomputed fresh each row (Codex C-2: never scale a
// pre-rounded value). Hourly path only; call-only keeps its own honest surface
// (the dashboard's per-day-type picker + calibration is Phase-2 marketRates work).
export const BILL_HOURLY_MARKUPS = [20, 22, 24, 25, 27, 28, 30, 32, 35, 38, 40];
export const BILL_REC_MIN = 25;
export const BILL_REC_MAX = 32;
export const BILL_SLIDER_MIN = 15;
export const BILL_SLIDER_MAX = 45;

export interface BillLadderRow { markup: number; billRate: number; profit: number; rec: boolean; }
// The dashboard markup table: each row grosses pay up at that markup, REC band
// (25-32%) highlighted. profit = bill - pay (per hour).
export function billLadder(payRate: number): BillLadderRow[] {
  return BILL_HOURLY_MARKUPS.map((markup) => {
    const billRate = roundUp5(payRate / (1 - markup / 100));
    return { markup, billRate, profit: billRate - payRate, rec: markup >= BILL_REC_MIN && markup <= BILL_REC_MAX };
  });
}

export interface BillMarginResult { marginPct: number; billRate: number; profitPerHr: number; dailyProfit: number; annualProfit: number; multiplier: number; }
// The slider: gross up at the chosen margin (clamped to the slider band) + the
// dashboard's profit projections (10-hr day, 2,080-hr year).
export function billAtMargin(payRate: number, marginPct: number): BillMarginResult {
  const m = Math.min(Math.max(marginPct, BILL_SLIDER_MIN), BILL_SLIDER_MAX);
  const billRate = roundUp5(payRate / (1 - m / 100));
  const profitPerHr = billRate - payRate;
  return { marginPct: m, billRate, profitPerHr, dailyProfit: profitPerHr * 10, annualProfit: profitPerHr * 2080, multiplier: 1 / (1 - m / 100) };
}

export interface CustomBillResult { valid: boolean; marginPct: number; profit: number; }
// Reverse calc: type a bill rate → its margin (as % of the bill, the dashboard's
// formula) + profit/hr. Invalid (renders "--") for any non-positive bill.
export function marginFromCustomBill(payRate: number, customBill: number): CustomBillResult {
  if (!(customBill > 0)) return { valid: false, marginPct: 0, profit: 0 };
  return { valid: true, marginPct: ((customBill - payRate) / customBill) * 100, profit: customBill - payRate };
}

// ── UI option lists ────────────────────────────────────────────────────────────
const ACRONYMS: Record<string, string> = {
  crna: 'CRNA', 'em nocturnist': 'EM Nocturnist', 'ob/gyn': 'OB/GYN', obgyn: 'OB/GYN',
  'np/pa': 'NP/PA', np: 'NP', pa: 'PA', icu: 'ICU', ent: 'ENT', er: 'ER',
};
function labelFor(key: string): string {
  if (ACRONYMS[key]) return ACRONYMS[key];
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SimSpecialtyOption { key: string; label: string; category: string; p70: number; max: number; }
// Every specialty the real engine knows (88+), labeled + grouped by category.
// p70 + max ride along so the Overview quick-check can ballpark without the engine.
export function simSpecialtyOptions(): SimSpecialtyOption[] {
  return Object.entries(SPECIALTIES)
    .map(([key, v]) => ({ key, label: labelFor(key), category: v.category, p70: v.p70, max: v.max }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

export interface SimOption { key: string; label: string; }
// Shift options ARE the engine SHIFT_MULT keys (ascending premium), so the
// control maps 1:1 onto what the engine prices.
const SHIFT_ORDER = ['day', 'night', 'weekend_day', 'weekend_night', 'holiday'];
const SHIFT_LABELS: Record<string, string> = {
  day: 'Day', night: 'Night', weekend_day: 'Weekend day', weekend_night: 'Weekend night', holiday: 'Holiday',
};
export function simShiftOptions(): SimOption[] {
  return SHIFT_ORDER.filter((k) => SHIFT_MULT[k]).map((key) => ({ key, label: SHIFT_LABELS[key] ?? key }));
}
export function shiftLabel(key: string): string { return SHIFT_LABELS[key] ?? key; }

export function simUrgencyOptions(): SimOption[] {
  return [
    { key: 'Standard', label: 'Standard' },
    { key: 'Priority', label: 'Priority' },
    { key: 'Emergent', label: 'Emergent' },
  ];
}

// Maps an ims_jobs specialty slug onto a REAL engine specialty key (never an
// invalid <option>): verbatim, hyphen→space, hyphen→slash, alias, fuzzy, default.
export function simSpecialtyKeyForSlug(slug: string): string {
  if (!slug) return DEFAULT_SIM_SPECIALTY;
  const norm = slug.toLowerCase().trim();
  const candidates = [norm, norm.replace(/-/g, ' '), norm.replace(/-/g, '/')];
  for (const cand of candidates) {
    if (SPECIALTIES[cand]) return cand;
    const alias = SPECIALTY_ALIASES[cand];
    if (alias && SPECIALTIES[alias]) return alias;
  }
  for (const cand of candidates) {
    const fz = fuzzyMatchSpecialty(cand);
    if (fz && SPECIALTIES[fz.key]) return fz.key;
  }
  return DEFAULT_SIM_SPECIALTY;
}
