// Maps the hub's simple Rate Simulator controls (specialty · state · shift ·
// urgency · assignment length · target margin) onto the REAL engine's RateFactors,
// then returns a clinician-PAY-first result (bill derived at the target margin).
//
// No rate math lives here — it only translates UI choices into engine inputs and
// reads engine outputs. All numbers come from `calculateRate`.
//
// Geography is PER STATE: the engine prices by clinical scarcity, so hard-to-staff
// states (WY ~1.36) pay a premium while physician-dense metros (NY ~0.88) pay less.
// A 5-region bucket can't carry that spread, so the control is a state dropdown
// grouped by region (simple feel, honest numbers). "National" = no geo adjustment.
import {
  SPECIALTIES, STATE_NAMES, STATE_MULT, calculateRate,
  type RateFactors, type CalculatedRate, type SpecialtyRate,
} from '../rate-engine/index';

export interface SimInput {
  specialtyKey: string;
  state: string | null;  // engine state code (e.g. 'TX'), or null for National
  shift: string;         // engine SHIFT_MULT key: day | night | weekend_day | weekend_night | holiday
  urgency: string;       // 'Standard' | 'Priority' | 'Emergent'
  weeks: number;         // assignment length
  marginPct: number;
}

export interface SimResult {
  payRate: number;      // HERO — the hourly going clinician (locum) rate
  billRate: number;     // grossed up from pay at the target margin
  marginPerHr: number;
  base: number;         // curated p70 pay base for the specialty
  geoMult: number;
  shiftMult: number;
  durationMult: number;
  capped: boolean;          // a rate cap clamped the pay
  marketMaxApplied: boolean; // the researched-range ceiling clamped the pay
  payLow: number;
  payHigh: number;
}

// Urgency escalates the engine's DURATION premium (the engine prices ASAP/urgent
// as the 'emergency' duration). Standard urgency falls back to the assignment
// length: long contracts discount slightly, short ones carry a small premium.
function durationKey(urgency: string, weeks: number): string {
  if (urgency === 'Emergent') return 'emergency';
  if (urgency === 'Priority') return 'short';
  if (weeks >= 26) return 'long';
  if (weeks <= 6) return 'short';
  return 'standard';
}

export function buildSimFactors(i: SimInput): RateFactors {
  const spec: SpecialtyRate | undefined = SPECIALTIES[i.specialtyKey];
  if (!spec) throw new Error(`sim-adapter: unknown specialty "${i.specialtyKey}"`);
  return {
    specialty: { key: i.specialtyKey, source: 'manual' },
    state: { code: i.state, source: 'manual' },
    rural: { isRural: false, source: 'manual' },
    shift: { key: i.shift, source: 'manual' },
    facility: { key: 'community', source: 'manual' },
    duration: { key: durationKey(i.urgency, i.weeks), source: 'manual' },
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

export function simRate(i: SimInput): SimResult {
  const r = calculateRate(buildSimFactors(i)) as CalculatedRate;
  const margin = Math.min(Math.max(i.marginPct, 0), 95) / 100;
  const billRate = Math.round(r.payRate / (1 - margin));
  return {
    payRate: r.payRate,
    billRate,
    marginPerHr: billRate - r.payRate,
    base: r.base,
    geoMult: r.geoMult,
    shiftMult: r.shiftMult,
    durationMult: r.durationMult,
    capped: r.capped,
    marketMaxApplied: !!r.marketMaxApplied,
    payLow: Math.round(r.payRate * 0.95),
    payHigh: Math.round(r.payRate * 1.06),
  };
}

// Common medical acronyms that should NOT be title-cased away.
const ACRONYMS: Record<string, string> = {
  crna: 'CRNA', 'em nocturnist': 'EM Nocturnist', 'ob-gyn': 'OB-GYN', obgyn: 'OB-GYN',
  'np/pa': 'NP/PA', np: 'NP', pa: 'PA', icu: 'ICU', ent: 'ENT', er: 'ER',
};
function labelFor(key: string): string {
  if (ACRONYMS[key]) return ACRONYMS[key];
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SimSpecialtyOption { key: string; label: string; category: string; }

// Every specialty the real engine knows (88+), labeled + grouped by category —
// the headline upgrade over the old curated 8-specialty stub.
export function simSpecialtyOptions(): SimSpecialtyOption[] {
  return Object.entries(SPECIALTIES)
    .map(([key, v]) => ({ key, label: labelFor(key), category: v.category }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
}

// US Census regions — used only to GROUP the state dropdown (presentational).
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

export interface SimStateGroup { region: string; states: Array<{ code: string; name: string }>; }

// State options the engine actually prices, grouped by region for a clean dropdown.
export function simStateOptions(): SimStateGroup[] {
  const order = ['West', 'Midwest', 'Northeast', 'South'];
  const byRegion = new Map<string, Array<{ code: string; name: string }>>();
  for (const code of Object.keys(STATE_MULT)) {
    const region = STATE_REGION[code] ?? 'South';
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push({ code, name: STATE_NAMES[code] ?? code });
  }
  return order
    .filter((r) => byRegion.has(r))
    .map((region) => ({ region, states: byRegion.get(region)!.sort((a, b) => a.name.localeCompare(b.name)) }));
}
