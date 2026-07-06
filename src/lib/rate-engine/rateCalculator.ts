// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// rateCalculator.ts — Rate inference engine and calculation functions
// Extracted from rate-simulator/index.html
// Handles: specialty mapping, state/shift/facility/rural/duration/call inference,
// call-only detection, confidence scoring, GSA lookup, and rate calculation
// ============================================================

import { SPECIALTIES, SPECIALTY_ALIASES } from './specialties';
import { STATE_MULT, STATE_NAMES, METRO_CITIES } from './stateData';
import { SHIFT_MULT, FACILITY_MULT, DURATION_MULT } from './multipliers';
import { getCallRateEntry, GSA_STANDARD, GSA_OVERRIDES } from './callRates';
import type {
  ParsedAssignment,
  RateFactors,
  SpecialtyFactor,
  StateFactor,
  RuralFactor,
  ShiftFactor,
  FacilityFactor,
  DurationFactor,
  CallFactor,
  HolidayFactor,
  RateCapFactor,
  RateCapUnit,
  CallOnlyFactor,
  ConfidenceLevel,
  CalculatedRate,
  CalculatedCallRate,
  CallRateBand,
  CallCompModel,
  GsaRates,
} from './types';

// === HELPERS ===
export function getSectionValue(parsed: ParsedAssignment, label: string): string {
  for (const s of (parsed.sections || [])) {
    for (const item of s.items) {
      if (item.label.toLowerCase() === label.toLowerCase()) return item.value;
    }
  }
  return '';
}

export function roundUp5(v: number): number {
  return Math.ceil(v / 5) * 5;
}

export function getPercentileRate(spec: { min: number; max: number }, pctl: number): number {
  // pctl: 0-100. Linearly interpolates between min and max.
  return Math.round(spec.min + (spec.max - spec.min) * (pctl / 100));
}

// Strip "Label:" prefixes from each line of raw PDF text so structured fields
// contribute only their values to keyword regex tests. Mirrors the values-only
// treatment of parsed.sections, closing the same label-leak class through the
// raw-text channel (Codex round-3: refineSpecialtyFromContext + detectCallOnly
// still fired on `ICU Coverage Required: No` / `Call Only: No` because the
// literal label-value line survives in _rawText). Lines without a label-form
// colon pass through unchanged. Heuristic mirrors parseSection (parser.ts):
// label is alphanumeric+space+a few punct chars, ≤60 chars, single colon.
export function rawTextValuesOnly(rawText: string): string {
  if (!rawText) return '';
  return rawText.split('\n')
    .map(line => {
      const m = line.match(/^\s*[-*]?\s*([A-Za-z0-9 _\-\/&()]{1,60}):\s*(.*)$/);
      return m ? m[2] : line;
    })
    .join('\n');
}

// === SPECIALTY MAPPING ===
const _sortedAliases = Object.entries(SPECIALTY_ALIASES).sort((a, b) => b[0].length - a[0].length);
const _shortAliases = new Set(['id', 'em', 'er', 'gi', 'ir', 'aa', 'np', 'pa', 'fm', 'im', 'rad', 'ent', 'uro', 'cap', 'pmr']);

export function mapSpecialty(raw: string): SpecialtyFactor {
  if (!raw) return { key: 'internal medicine', source: 'default' };
  const lower = raw.toLowerCase().trim();
  if (SPECIALTIES[lower]) return { key: lower, source: 'pdf' };
  if (SPECIALTY_ALIASES[lower]) return { key: SPECIALTY_ALIASES[lower], source: 'pdf' };
  for (const [alias, key] of _sortedAliases) {
    if (_shortAliases.has(alias)) {
      const re = new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (re.test(lower)) return { key, source: 'inferred' };
    } else {
      if (lower.includes(alias)) return { key, source: 'inferred' };
    }
  }
  const sortedSpecs = Object.keys(SPECIALTIES).sort((a, b) => b.length - a.length);
  for (const key of sortedSpecs) {
    if (lower.includes(key)) return { key, source: 'inferred' };
  }
  return { key: 'internal medicine', source: 'default' };
}

// === CONTEXT-AWARE SPECIALTY REFINEMENT ===
// Section VALUES only AND raw-text VALUES only: a label like "ICU Coverage
// Required" with value "No" used to leak the word "icu" into allText through
// two channels — (a) section-item label+value serialization, and (b) the
// literal `Label: Value` line preserved in _rawText. Both are stripped to
// values-only so the leak is fully closed. Same label-leak class as
// inferDayType / inferShiftEnhanced (Codex round-2 + round-3 audits, deferred
// parser-debt sweep).
export function refineSpecialtyFromContext(specialty: SpecialtyFactor, parsed: ParsedAssignment): SpecialtyFactor {
  const key = specialty.key;
  const allText = (
    (parsed.notes || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.value).join(' ')).join(' ') + ' ' +
    (parsed.facilities || []).map(f => f.name || '').join(' ') + ' ' +
    rawTextValuesOnly(parsed._rawText || '').slice(0, 2000)
  ).toLowerCase();

  // Internal Medicine or FM in ICU/critical care context -> critical care
  if ((key === 'internal medicine' || key === 'family medicine') && /\b(icu|intensive care|critical care|intensivist|ccm|micu|sicu)\b/.test(allText))
    return { key: 'critical care', source: 'inferred' };
  // Internal Medicine in hospital/inpatient -> hospitalist
  if (key === 'internal medicine' && /\b(hospitalist|inpatient|hospital medicine|floor\s*(?:coverage|rounding)|rounding|admit)\b/.test(allText))
    return { key: 'hospitalist', source: 'inferred' };
  // Pediatrics in ICU -> pediatric critical care
  if (key === 'pediatrics' && /\b(picu|pediatric\s*(?:icu|intensive)|pediatric\s*critical)\b/.test(allText))
    return { key: 'pediatric critical care', source: 'inferred' };
  // Pediatrics in hospital -> pediatric hospitalist
  if (key === 'pediatrics' && /\b(hospitalist|inpatient)\b/.test(allText))
    return { key: 'pediatric hospitalist', source: 'inferred' };
  // EM nocturnist detection
  if (key === 'emergency medicine' && /\b(nocturnist|nights?\s*only|overnight\s*only)\b/.test(allText))
    return { key: 'em nocturnist', source: 'inferred' };
  // Hospitalist nocturnist
  if (key === 'hospitalist' && /\b(nocturnist|nights?\s*only|overnight)\b/.test(allText))
    return { key: 'hospitalist nocturnist', source: 'inferred' };

  return specialty;
}

// === ENHANCED STATE INFERENCE ===
export function inferStateEnhanced(parsed: ParsedAssignment): StateFactor {
  // First try facilities (handles both "City, ST" and "City (ST)" formats)
  for (const f of (parsed.facilities || [])) {
    if (f.state && STATE_MULT[f.state]) return { code: f.state, source: 'pdf' };
  }
  // Try nearest airport
  const m = (parsed.nearestAirport || '').match(/,\s*([A-Z]{2})\s*$/);
  if (m && STATE_MULT[m[1]]) return { code: m[1], source: 'inferred' };
  // Try license requirement field
  const licVal = (getSectionValue(parsed, 'What is the license requirement to bid?') || '').toUpperCase();
  const licMatch = licVal.match(/(?:IN|FOR)\s+([A-Z]{2})\s*(?:ONLY|$)/) || licVal.match(/LICENSED\s+([A-Z]{2})\b/);
  if (licMatch && STATE_MULT[licMatch[1]]) return { code: licMatch[1], source: 'inferred' };
  // Scan raw text for (ST) parenthesized state codes
  const raw = parsed._rawText || '';
  const parenMatch = raw.match(/\(([A-Z]{2})\)/);
  if (parenMatch && STATE_MULT[parenMatch[1]]) return { code: parenMatch[1], source: 'inferred' };
  // Scan raw text for state patterns — filter out LocumSmart footer
  const cleanRaw = raw.replace(/Locumsmart\s*\|[^\n]*/gi, '').replace(/PO\s*Box\s*\d+\s*\|[^\n]*/gi, '');
  const stateMatch = cleanRaw.match(/[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*([A-Z]{2})\b/);
  if (stateMatch && STATE_MULT[stateMatch[1]]) return { code: stateMatch[1], source: 'inferred' };
  // Try to find state names in text
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (cleanRaw.includes(name) && STATE_MULT[code]) return { code, source: 'inferred' };
  }
  return { code: null, source: 'default' };
}

// === RURAL INFERENCE ===
export function inferRural(parsed: ParsedAssignment): RuralFactor {
  const facilities = parsed.facilities || [];
  // Check facility cities against metro list
  for (const f of facilities) {
    if (f.city && METRO_CITIES.has(f.city.toLowerCase())) return { isRural: false, source: 'inferred' };
  }
  // Check facility cities against GSA overrides (known cities)
  for (const f of facilities) {
    if (f.city && f.state) {
      const key = f.city.toLowerCase() + ',' + f.state.toLowerCase();
      if (GSA_OVERRIDES[key]) return { isRural: false, source: 'inferred' };
    }
  }
  // Check raw text for metro city mentions BEFORE concluding rural
  // Skip ambiguous names that cause false positives
  const AMBIGUOUS_CITIES = new Set([
    'mobile', 'mesa', 'aurora', 'gilbert', 'lincoln', 'eugene', 'madison', 'providence',
    'ontario', 'columbia', 'toledo', 'joliet', 'norman', 'gary', 'sterling', 'troy',
    'jackson', 'henderson', 'irving', 'plano', 'durham',
  ]);
  // Strip airport line from raw text — airport city should not classify facility as urban
  const raw = (parsed._rawText || '').toLowerCase().replace(/nearest\s*airport[^\n]*/gi, '');
  for (const city of METRO_CITIES) {
    if (!AMBIGUOUS_CITIES.has(city) && raw.includes(city)) return { isRural: false, source: 'inferred' };
  }
  // Check nearest airport ONLY if no facility city data
  if (facilities.length === 0 || !facilities[0].city) {
    const airport = (parsed.nearestAirport || '').toLowerCase();
    for (const city of METRO_CITIES) {
      if (airport.includes(city)) return { isRural: false, source: 'inferred' };
    }
  }
  // Absence from the metro whitelist is NOT positive evidence of rural — most
  // US cities aren't in the ~140-entry list. The old default-true here fired
  // rural on ~65% of real jobs and tagged it source:'inferred', laundering a
  // guess into scoreConfidence as a supporting signal (no-fake-data violation).
  // Fail to no-premium with honest 'default' provenance, matching the
  // inferShift→day / hasCall→false / hasHoliday→false pattern. Rural now only
  // asserts true on POSITIVE evidence (metro match → false above; otherwise we
  // don't know). The rural multiplier is neutralized in calculateRate regardless;
  // this keeps the confidence label honest. (Accuracy audit 2026-06-01.)
  return { isRural: false, source: 'default' };
}

// === ENHANCED SHIFT INFERENCE ===
// Section VALUES only: a label like "Holiday Coverage" with value "None" used
// to leak the word "holiday" into the combined text and force a holiday shift
// classification (Codex round-2 BLOCK on the inferDayType label-leak class).
export function inferShiftEnhanced(parsed: ParsedAssignment): ShiftFactor {
  const allText = (
    (parsed.sections || []).map(s => s.items.map(i => i.value).join(' ')).join(' ') + ' ' +
    (parsed.notes || '')
  ).toLowerCase();
  const coverage = (getSectionValue(parsed, 'Coverage Type') || '').toLowerCase();
  const schedule = (
    getSectionValue(parsed, 'Schedule') ||
    getSectionValue(parsed, 'Shift') ||
    getSectionValue(parsed, 'Shifts') ||
    getSectionValue(parsed, 'Hours') || ''
  ).toLowerCase();
  const combined = coverage + ' ' + schedule + ' ' + allText;

  if (/\b(24[- ]?hour|24[- ]?hr|24\/7)\b/.test(combined)) return { key: 'night', source: 'inferred' };
  if (/\b(weekend.*night|night.*weekend|fri.*night|sat.*night|sun.*night)\b/.test(combined)) return { key: 'weekend_night', source: 'inferred' };
  // Plural-aware: `holidays` would otherwise miss `\b(holiday)\b` because the
  // trailing `s` is a word char. Codex round-2 audit deferred parser-debt fix.
  if (/\bholidays?\b/.test(combined)) return { key: 'holiday', source: 'inferred' };
  if (/\b(night|noc|nocturn|overnight|pm\s*shift|evening)\b/.test(combined)) return { key: 'night', source: 'inferred' };
  if (/\b(weekend|sat|sun|saturday|sunday)\b/.test(combined)) return { key: 'weekend_day', source: 'inferred' };
  if (/\b(day\s*shift|am\s*shift|7a|8a|morning|daytime)\b/.test(combined)) return { key: 'day', source: 'inferred' };
  return { key: 'day', source: 'default' };
}

// === ENHANCED FACILITY TYPE INFERENCE ===
export function inferFacilityTypeEnhanced(parsed: ParsedAssignment): FacilityFactor {
  const allText = (
    (parsed.facilities || []).map(f => (f.name || '').toLowerCase()).join(' ') + ' ' +
    (parsed.hco || '').toLowerCase() + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.value).join(' ')).join(' ') + ' ' +
    (parsed.notes || '')
  ).toLowerCase();
  const practSetting = (getSectionValue(parsed, 'Practice Setting') || '').toLowerCase();

  // Academic / Teaching
  if (allText.includes('university') || allText.includes('academic') || allText.includes('teaching') || allText.includes('research') || /level\s*[i1]\s*trauma/.test(allText))
    return { key: 'academic', source: 'inferred' };
  // Ambulatory Surgery Center (ASC) — check BEFORE community
  if (/\b(surgery center|surgical center|surgicenter|surgi-center|ambulatory surg|asc\b|outpatient surg)/.test(allText))
    return { key: 'asc', source: 'inferred' };
  if (allText.includes('united surgical partners') || allText.includes('uspi') || allText.includes('amsurg') || allText.includes('envision'))
    return { key: 'asc', source: 'inferred' };
  // Freestanding ED
  if (/\b(freestanding\s*(ed|er|emergency)|standalone\s*(ed|er|emergency)|free-standing\s*(ed|er|emergency))/.test(allText))
    return { key: 'freestanding_ed', source: 'inferred' };
  // Critical Access Hospital
  if (/critical\s*access\s*hospital/.test(allText) || /\bcah\b/.test(allText))
    return { key: 'cah', source: 'inferred' };
  // VA / Government / Military / IHS
  if (/\bva\b/.test(allText) || allText.includes('v.a.') || allText.includes('veterans') || allText.includes('government') || allText.includes('ihs') || allText.includes('indian health') || allText.includes('tribal') || allText.includes('military') || allText.includes('department of defense') || /\bdod\b/.test(allText))
    return { key: 'va', source: 'inferred' };
  // Correctional / Prison
  if (/\b(correctional|prison|jail|detention|incarcerat|penitentiary)\b/.test(allText))
    return { key: 'correctional', source: 'inferred' };
  // FQHC / Community Health Center
  if (/\b(fqhc|federally qualified|community health center|rural health clinic)\b/.test(allText))
    return { key: 'fqhc', source: 'inferred' };
  // Psychiatric / Behavioral Health
  if (/\b(psychiatric|behavioral health|mental health|psych\s*facility|substance abuse|addiction treatment)\b/.test(allText))
    return { key: 'psych', source: 'inferred' };
  // Telehealth
  if (/\b(telehealth|telemedicine|remote only|virtual)\b/.test(allText) || practSetting.includes('telehealth') || practSetting.includes('telemedicine'))
    return { key: 'telehealth', source: 'inferred' };
  // Rural Trauma
  if (allText.includes('rural') && allText.includes('trauma'))
    return { key: 'rural_trauma', source: 'inferred' };
  // Outpatient Clinic (non-surgical outpatient)
  if (practSetting === 'outpatient' && !/surg/.test(allText))
    return { key: 'outpatient', source: 'inferred' };
  if (/\b(outpatient clinic|medical office|physician office|group practice)\b/.test(allText) && !/surg/.test(allText))
    return { key: 'outpatient', source: 'inferred' };
  // Bed count heuristics
  const beds = parseInt(
    getSectionValue(parsed, 'Bed In Department') ||
    getSectionValue(parsed, 'Total Beds') ||
    getSectionValue(parsed, 'Licensed Beds') ||
    getSectionValue(parsed, 'Bed Count') ||
    getSectionValue(parsed, 'Staffed Beds') || ''
  );
  if (beds > 0 && beds <= 25) return { key: 'cah', source: 'inferred' };
  if (beds > 25) return { key: 'community', source: 'inferred' };
  // If we have facility names, likely community
  if ((parsed.facilities || []).length > 0 && (parsed.facilities[0].name || '').length > 3)
    return { key: 'community', source: 'inferred' };
  return { key: 'community', source: 'default' };
}

// === DURATION INFERENCE ===
export function inferDuration(parsed: ParsedAssignment): DurationFactor {
  const start = (parsed.startDate || '').trim();
  const end = (parsed.endDate || '').trim();
  const startLower = start.toLowerCase();
  const endLower = end.toLowerCase();
  if (endLower.includes('ongoing') || endLower.includes('tbd') || endLower.includes('to be determined'))
    return { key: 'long', source: 'inferred' };
  const startDate = startLower.includes('asap') ? new Date() : new Date(start);
  const endDate = new Date(end);
  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
    const days = (endDate.getTime() - startDate.getTime()) / 86400000;
    if (days <= 7) return { key: 'emergency', source: 'inferred' };
    if (days <= 28) return { key: 'short', source: 'inferred' };
    if (days <= 56) return { key: 'standard', source: 'inferred' };
    return { key: 'long', source: 'inferred' };
  }
  if (startLower.includes('asap')) return { key: 'emergency', source: 'inferred' };
  return { key: 'standard', source: 'default' };
}

// === CALL INFERENCE ===
export function hasCall(parsed: ParsedAssignment): CallFactor {
  const ct = getSectionValue(parsed, 'Call Type') || '';
  if (ct && ct.toLowerCase() !== 'none' && ct.toLowerCase() !== 'n/a')
    return { hasCall: true, source: 'pdf' };
  if (ct && (ct.toLowerCase() === 'none' || ct.toLowerCase() === 'n/a'))
    return { hasCall: false, source: 'pdf' };
  const all = (
    (getSectionValue(parsed, 'Coverage Type') || '') + ' ' +
    (parsed.notes || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.label + ': ' + i.value).join(' ')).join(' ')
  ).toLowerCase();
  if (/\b(on[- ]?call|call\s*required|call\s*ratio|call\s*\d+:\d+|shared\s*call|pager|beeper)\b/.test(all))
    return { hasCall: true, source: 'inferred' };
  return { hasCall: false, source: 'default' };
}

// === HOLIDAY INFERENCE ===
// S1 split (2026-04-28): "Allowed Holidays: 4" used to flip hasHoliday=true and
// stack a 1.10× multiplier on every hour worked — that field is PTO eligibility,
// not coverage obligation. HolidayFactor now carries (hasHoliday, holidayAllowed)
// and only hasHoliday triggers the multiplier in calculateRate.
//
// Detection rules:
// - "Holiday Coverage" is unambiguous when present (positive value → worked).
// - "Allowed Holidays" defaults to allowed-only; only flips to worked when the
//   cell text itself contains a phrase-level work/coverage obligation
//   (e.g. "4 with coverage required"). "Yes" / "True" / "4" / "Standard" stay
//   allowed-only (H-6 tightening).
// - Generic "Holidays" field follows the same isWorked test.
// - Inference fallback (no structured field): specific holiday names paired
//   with coverage/work verbs → worked; "holiday pay/premium/differential" →
//   worked; bare "holiday" mention → allowed (low confidence).
//
// Section VALUES only is preserved from the parser-debt sweep (adb0370e):
// a label like "Holiday Pay" with value "Standard" must NOT leak its label
// into allText. _rawText is intentionally NOT consulted here — getSectionValue
// + values-only allText covers every channel without the rawText leak class.
export function hasHoliday(parsed: ParsedAssignment): HolidayFactor {
  const allowedSection = getSectionValue(parsed, 'Allowed Holidays');
  const holidaysSection = getSectionValue(parsed, 'Holidays');
  const coverageSection = getSectionValue(parsed, 'Holiday Coverage');

  // "Allowed Holidays" / "Holidays" labels already provide the holiday context,
  // so the value-only check looks for a coverage/work signal. H-6 tightening:
  // bare "Yes" / "True" / "4" / "Standard" must NOT match. H-7 tightening:
  // "holidays on file" stays allowed because "on file" contains no coverage
  // signal. Codex MUST (2026-04-28): bare "must" / "required" matched
  // "must approve in advance" — clearly a PTO admin phrase, not coverage. Fix:
  // (a) direct coverage nouns/verbs (cover/coverage/work/working) flip alone,
  // (b) modal verbs (must/required/requires) flip ONLY when paired with a
  // coverage word within 30 chars.
  const directCoverage = /\b(?:cover|coverage|work|working)\b/i;
  // Codex round-2 MUST: removed holiday|holidays from the right-hand alternation —
  // "must approve holidays in advance" was flipping to worked because it satisfied
  // modal + holiday within 30 chars. Coverage-side words must signal coverage,
  // not just be a holiday noun.
  const modalThenCoverage = /\b(?:must|required|requires)\b.{0,30}\b(?:cover|coverage|work|working|shift)\b/i;
  const coverageThenModal = /\b(?:cover|coverage|work|working|shift)\b.{0,30}\b(?:must|required|requires)\b/i;
  const isWorkedInLabeledValue = (text: string): boolean =>
    directCoverage.test(text) || modalThenCoverage.test(text) || coverageThenModal.test(text);

  // Codex SHOULD (2026-04-28): real PDFs use "n.a." / "na" / "tbd" / "-" / "—"
  // / "--" as null placeholders. Without these, they fell into the inference
  // path and silently became allowed-only.
  const NEGATIVE = new Set(['none', 'n/a', 'na', 'n.a.', 'n.a', 'no', 'false', '0', '', 'tbd', '-', '—', '--']);

  if (coverageSection) {
    const lower = coverageSection.toLowerCase().trim();
    if (NEGATIVE.has(lower))
      return { hasHoliday: false, holidayAllowed: false, source: 'pdf' };
    return { hasHoliday: true, holidayAllowed: false, source: 'pdf' };
  }

  if (allowedSection) {
    const lower = allowedSection.toLowerCase().trim();
    if (NEGATIVE.has(lower))
      return { hasHoliday: false, holidayAllowed: false, source: 'pdf' };
    return { hasHoliday: isWorkedInLabeledValue(lower), holidayAllowed: true, source: 'pdf' };
  }

  if (holidaysSection) {
    const lower = holidaysSection.toLowerCase().trim();
    if (NEGATIVE.has(lower))
      return { hasHoliday: false, holidayAllowed: false, source: 'pdf' };
    const worked = isWorkedInLabeledValue(lower);
    return { hasHoliday: worked, holidayAllowed: !worked, source: 'pdf' };
  }

  // Inference fallback. Section VALUES only (label-leak class).
  const allText = (
    (parsed.notes || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.value).join(' ')).join(' ')
  ).toLowerCase();

  // Specific named holidays paired with coverage/work verbs → worked (high confidence).
  const namedHolidayWorked =
    /\b(?:thanksgiving|christmas|new\s*year|july\s*4(?:th)?|memorial\s*day|labor\s*day)\b.{0,30}\b(?:coverage|cover|work|required|must|need)\b/.test(allText) ||
    /\b(?:coverage|cover|work|required|must|need)\b.{0,30}\b(?:thanksgiving|christmas|new\s*year|july\s*4(?:th)?|memorial\s*day|labor\s*day)\b/.test(allText);
  if (namedHolidayWorked)
    return { hasHoliday: true, holidayAllowed: false, source: 'inferred' };

  // "holiday pay" / "holiday premium" / "holiday differential" / "holiday bonus"
  // strongly imply provider works holidays.
  if (/\bholiday\s*(?:pay|premium|differential|bonus)\b/.test(allText))
    return { hasHoliday: true, holidayAllowed: false, source: 'inferred' };

  // Generic "holiday" mention or specific holiday name without verb → allowed-only.
  if (/\b(?:holiday|thanksgiving|christmas|new\s*year|july\s*4(?:th)?|memorial\s*day|labor\s*day)\b/.test(allText))
    return { hasHoliday: false, holidayAllowed: true, source: 'inferred' };

  return { hasHoliday: false, holidayAllowed: false, source: 'default' };
}

// === DAY TYPE INFERENCE (call-only only — hourly path doesn't use dayType) ===
//
// Schedule-bearing fields are authoritative. Raw text contributes only when a
// holiday word is paired with a coverage/work verb inside the same sentence.
// A bare "holiday pay follows policy" in notes must NOT promote a weekday
// schedule to holiday (M-3 regression). Sat/Sun/weekday regexes accept plural
// forms — `\bsat(?:urday)?\b` does NOT match `saturdays` because the trailing
// `s` is a word char, so `\bsat(?:urdays?)?\b` is required.
export function inferDayType(parsed: ParsedAssignment): { key: 'weekday' | 'weekend' | 'holiday'; source: 'pdf' | 'inferred' | 'default' } {
  // Explicit "Holiday Coverage" structured short-circuit (Codex round-2 MUST).
  // Previously the holiday-adjacency regex over _rawText was firing on the
  // literal "Holiday Coverage: Yes" line, which doubled as both label-leak
  // false-positive (when value=None) and the only way the value=Yes case was
  // detected. Once rawTextValuesOnly strips the prefix, "Yes" alone wouldn't
  // match — so this short-circuit handles the structured-field case directly.
  const hc = (getSectionValue(parsed, 'Holiday Coverage') || '').toLowerCase().trim();
  const HC_NEGATIVE = new Set(['none', 'no', 'false', 'n/a', 'na', '0', '']);
  if (hc && !HC_NEGATIVE.has(hc)) {
    return { key: 'holiday', source: 'pdf' };
  }

  const schedule = (
    getSectionValue(parsed, 'Schedule') + ' ' +
    getSectionValue(parsed, 'Coverage Type') + ' ' +
    getSectionValue(parsed, 'Shift') + ' ' +
    getSectionValue(parsed, 'Holiday Coverage')
  ).toLowerCase();
  // Section VALUES only AND raw-text VALUES only — labels would inject phrases
  // like "holiday coverage:" into allText even when the value is "None", which
  // previously fired the holiday-adjacency regex via two channels: section
  // serialization (Codex round-1 BLOCK) AND _rawText preservation (Codex
  // round-2 MUST). Both are stripped to values-only here.
  const allText = (
    rawTextValuesOnly(parsed._rawText || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.value).join(' ')).join(' ') + ' ' +
    (parsed.notes || '')
  ).toLowerCase();

  // Holiday wins over weekend.
  // Schedule-side: any holiday word counts (the schedule field is explicit).
  // Raw-text side: only when a holiday word and a coverage/work verb sit in
  // the SAME sentence within ~30 chars. `[^.!?\n]` blocks cross-sentence
  // matches so "coverage every weekday. holiday pay follows policy" stays
  // weekday.
  const holidayWord = '(?:holiday|thanksgiving|christmas|new\\s*year|july\\s*4(?:th)?|memorial\\s*day|labor\\s*day)';
  const verbWord = '(?:coverage|cover|work|required|must|need)';
  const holidayInSchedule = new RegExp('\\b' + holidayWord + '\\b').test(schedule);
  const holidayWorkedInRaw =
    new RegExp('\\b' + holidayWord + '\\b[^.!?\\n]{0,30}\\b' + verbWord + '\\b').test(allText) ||
    new RegExp('\\b' + verbWord + '\\b[^.!?\\n]{0,30}\\b' + holidayWord + '\\b').test(allText);
  if (holidayInSchedule || holidayWorkedInRaw) {
    return { key: 'holiday', source: 'inferred' };
  }

  // Weekend: schedule field only — flavor-text "weekend" mention in notes
  // must not flip dayType (Codex Step-8 pressure test (a)).
  // Plural-aware: `saturdays`, `sundays`, `mondays`, `tuesdays`, etc. all match.
  const hasWeekend = /\bweekends?\b/.test(schedule);
  const hasSat = /\bsat(?:urdays?)?\b/.test(schedule);
  const hasSun = /\bsun(?:days?)?\b/.test(schedule);
  const hasWeekday = /\b(?:mon|tue|wed|thu|fri)(?:days?)?\b/.test(schedule);
  if (hasWeekend || ((hasSat || hasSun) && !hasWeekday)) {
    return { key: 'weekend', source: 'inferred' };
  }
  return { key: 'weekday', source: 'default' };
}

// === BILL RATE CAP EXTRACTION ===
export function extractBillRateCap(parsed: ParsedAssignment): RateCapFactor {
  const all = (
    (parsed.notes || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.label + ': ' + i.value).join(' ')).join(' ')
  ).toLowerCase();

  // Patterns capture both the value and (optionally) the unit hint.
  // Unit hint may follow the value ($250/hr) or be a nearby word ("per day").
  //
  // Pattern 1 + 3 connector: between "rate cap" / "max(imum)|ceiling rate"
  // and the dollar amount we accept either (a) one+ whitespace followed by
  // an optional connector word (of/at/is/set to), or (b) a `=` / `:` token
  // (whitespace optional). This blocks the prior `[^$]*` greedy match from
  // crossing sentence boundaries — e.g. "I don't think a rate cap matters
  // here, but my pay rate is $250/hr" used to false-match $250 as a cap.
  // T15a Codex MUST 3 (2026-04-29).
  const patterns: Array<RegExp> = [
    /rate\s*cap(?:\s+(?:(?:of|at|is|set\s+to)\s+)?|\s*[=:]\s*)\$\s*([\d,.]+)\s*(\/\s*(?:hr|hour|day|shift)|per\s*(?:hour|hr|day|shift))?/,
    /(?:not\s*to\s*exceed|nte)\s*\$?\s*([\d,.]+)\s*(\/\s*(?:hr|hour|day|shift)|per\s*(?:hour|hr|day|shift))?/,
    /(?:max(?:imum)?|ceiling)\s*(?:bill\s*)?rate(?:\s+(?:(?:of|at|is|set\s+to)\s+)?|\s*[=:]\s*)\$\s*([\d,.]+)\s*(\/\s*(?:hr|hour|day|shift)|per\s*(?:hour|hr|day|shift))?/,
    /cap(?:ped)?\s*at\s*\$?\s*([\d,.]+)\s*(\/\s*(?:hr|hour|day|shift)|per\s*(?:hour|hr|day|shift))?/,
  ];

  for (const p of patterns) {
    const m = all.match(p);
    if (m) {
      const cap = parseFloat(m[1].replace(/,/g, ''));
      const unitText = (m[2] || '').toLowerCase();
      const unit: RateCapUnit =
        /hour|hr/.test(unitText) ? 'hour' :
        /day/.test(unitText) ? 'day' :
        /shift/.test(unitText) ? 'shift' : 'unknown';
      return { cap, unit, source: 'pdf', hasWarning: unit === 'unknown' };
    }
  }
  if (/rate\s*cap|not\s*to\s*exceed|nte\b/.test(all))
    return { cap: null, unit: 'unknown', source: 'pdf', hasWarning: true };
  return { cap: null, unit: 'unknown', source: null, hasWarning: false };
}

/**
 * Daily pay cap from a parsed RateCapFactor when applied to call-only math.
 * Returns the dollar daily-pay ceiling (cap × 0.80, rounded), or null if the
 * cap should not be applied to call-only.
 *
 * Only 'day' and 'shift' units are applied. 'hour' is a parse mismatch on a
 * call-only assignment and is dropped (caller surfaces via hasWarning).
 * 'unknown' is dropped — the previous design treated unknown as best-effort
 * daily, which silently reproduced S2's wrong-answer class. With unknown the
 * UI MUST surface the ambiguity (Rate Cap card in FactorGrid).
 */
export function getCallOnlyPayCap(rateCap: RateCapFactor): number | null {
  if (!rateCap.cap) return null;
  if (rateCap.unit === 'day' || rateCap.unit === 'shift') {
    return Math.round(rateCap.cap * 0.80);
  }
  return null;
}

// === CALL-ONLY DETECTION ===
// Section VALUES only AND raw-text VALUES only: a label like "Call Only" with
// value "No" used to leak "call only: no" through two channels — (a) section-
// item label+value serialization, (b) the literal `Label: Value` line in
// _rawText — and falsely fire the description regex `\b(?:on[- ]?)?call\s*only\b`.
// Both are stripped to values-only. An explicit `Call Only:` section short-
// circuit handles the structured-field positive case (Yes/No), since after the
// rawText strip the value alone (`Yes`) no longer matches any regex.
// Same label-leak class as inferDayType (Codex round-2 + round-3 audits).
export function detectCallOnly(parsed: ParsedAssignment): CallOnlyFactor {
  const coverageType = (getSectionValue(parsed, 'Coverage Type') || '').toLowerCase();
  const callType = (getSectionValue(parsed, 'Call Type') || '').toLowerCase();
  const callOnlyExplicit = (getSectionValue(parsed, 'Call Only') || '').toLowerCase().trim();
  if (callOnlyExplicit === 'yes' || callOnlyExplicit === 'true')
    return { isCallOnly: true, source: 'pdf' as const, reason: 'Call Only: ' + callOnlyExplicit };
  if (callOnlyExplicit === 'no' || callOnlyExplicit === 'false' || callOnlyExplicit === 'none' || callOnlyExplicit === 'n/a' || callOnlyExplicit === 'na')
    return { isCallOnly: false, source: 'pdf' as const, reason: 'Explicit Call Only: ' + callOnlyExplicit };
  const allText = (
    rawTextValuesOnly(parsed._rawText || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.value).join(' ')).join(' ')
  ).toLowerCase();

  // Negation check
  if (/\bnot\s+(?:a\s+)?call\s*only\b/.test(allText))
    return { isCallOnly: false, source: 'default' as const, reason: 'Explicit negation of call-only' };
  // Explicit "Call Only" coverage type
  if (coverageType.includes('call only'))
    return { isCallOnly: true, source: 'pdf' as const, reason: 'Coverage Type: Call Only' };
  // Beeper/Home Call WITHOUT scheduled clinical hours
  const hasClinicalHours = /\b(?:scheduled\s+)?clinical\s*(?:hours?|shifts?|duties|plus)\b/.test(allText);
  if ((/beeper|home\s*call/.test(callType)) && !hasClinicalHours)
    return { isCallOnly: true, source: 'inferred' as const, reason: 'Call Type: ' + callType + ' (no scheduled clinical hours)' };
  // Description patterns
  if (/\b(?:on[- ]?)?call\s*only\b/.test(allText))
    return { isCallOnly: true, source: 'inferred' as const, reason: 'Description mentions "call only"' };
  // 24hr call coverage without clinical duties
  if (/\b(24\s*h(?:ou)?r?\s*call\s*coverage|call\s*coverage\s*\d+\s*(?:hr|hour))\b/.test(allText) && !hasClinicalHours)
    return { isCallOnly: true, source: 'inferred' as const, reason: '24hr call coverage without clinical duties' };

  return { isCallOnly: false, source: 'default' as const, reason: null };
}

// === DETECT INCLUDED HOURS ===
export function detectIncludedHours(parsed: ParsedAssignment): number | null {
  const allText = (
    (parsed._rawText || '') + ' ' +
    (parsed.sections || []).map(s => s.items.map(i => i.label + ': ' + i.value).join(' ')).join(' ')
  ).toLowerCase();
  // Forward: "includes up to 4 hours daily rounding", "with 4 hrs in-house"
  const m1 = allText.match(/(?:include|includes?|up\s*to|with)\s*(?:up\s*to\s*)?(\d+)\s*(?:hrs?|hours?)\s*(?:daily|of|per\s*day|rounding|active|in[- ]?house|clinical)/);
  if (m1) return parseInt(m1[1]);
  // Reversed: "rounding up to 4 hours", "active call up to 4 hrs"
  const m2 = allText.match(/(?:rounding|active\s*call|in[- ]?house|clinical)\s*(?:up\s*to|of)\s*(\d+)\s*(?:hrs?|hours?)/);
  if (m2) return parseInt(m2[1]);
  return null;
}

// === CONFIDENCE SCORING ===
export function scoreConfidence(f: RateFactors): ConfidenceLevel {
  const specKnown = f.specialty.source !== 'default';
  const stateKnown = f.state.source !== 'default';

  let supporting = 0;
  if (f.shift.source !== 'default') supporting++;
  if (f.facility.source !== 'default') supporting++;
  if (f.duration.source !== 'default') supporting++;
  if (f.call.source !== 'default') supporting++;
  if (f.holiday.source !== 'default') supporting++;
  if (f.rural.source !== 'default') supporting++;

  // HIGH: Specialty + State identified
  if (specKnown && stateKnown) return 'High';
  // MEDIUM: Specialty known
  if (specKnown && supporting >= 2) return 'Medium';
  if (specKnown) return 'Medium';
  // LOW: Couldn't identify specialty
  return 'Low';
}

// === GSA LOOKUP ===
export function lookupGsa(parsed: ParsedAssignment): GsaRates {
  const city = ((parsed.facilities && parsed.facilities[0] && parsed.facilities[0].city) || '').toLowerCase();
  const st = ((parsed.facilities && parsed.facilities[0] && parsed.facilities[0].state) || '').toLowerCase();
  if (GSA_OVERRIDES[city + ',' + st]) return GSA_OVERRIDES[city + ',' + st];
  const ap = (parsed.nearestAirport || '').match(/^([^,]+),\s*([A-Z]{2})\s*$/);
  if (ap) {
    const key = ap[1].trim().toLowerCase() + ',' + ap[2].toLowerCase();
    if (GSA_OVERRIDES[key]) return GSA_OVERRIDES[key];
  }
  return GSA_STANDARD;
}

// === RATE CALCULATION (hourly) ===
export function calculateRate(f: RateFactors): CalculatedRate {
  const spec = SPECIALTIES[f.specialty.key];
  const base = f.baseRate || spec.p70;
  const geoMult = f.state.code ? (STATE_MULT[f.state.code] || 1.0) : 1.0;
  // Rural scarcity is ALREADY priced once inside geoMult — STATE_MULT is derived
  // from physician density (0.30 weight) + demand class (0.40 weight) + COLI, all
  // of which encode rural shortage (stateData.ts deriveStateMultipliers). The old
  // flat +20% ruralMult on top double-counted the same economics (and inferRural
  // defaulted rural=true for any non-metro-list city, so it fired on ~65% of
  // jobs). Accuracy audit 2026-06-01: CRNA Kokomo IN = 232×geo1.17×rural1.20×0.95
  // = $309 vs researched max $250. Neutralized to 1.0; `rural` stays a display-only
  // context factor. Genuine frontier-rural premium is still priced via the CAH /
  // rural_trauma FACILITY_MULT when there's positive facility evidence.
  const ruralMult = 1.0;
  const shiftMult = SHIFT_MULT[f.shift.key].mult;
  const facilityMult = FACILITY_MULT[f.facility.key].mult;
  const durationMult = DURATION_MULT[f.duration.key].mult;
  const callMult = f.call.hasCall ? 1.10 : 1.0;
  // Avoid double-counting: if shift is already 'holiday' (1.35x), don't stack the toggle (1.10x)
  const holidayMult = (f.holiday.hasHoliday && f.shift.key !== 'holiday') ? 1.10 : 1.0;

  // Cap the combined multiplier at 1.75x to prevent unrealistic rates
  const combinedMult = geoMult * ruralMult * shiftMult * facilityMult * durationMult * callMult * holidayMult;
  const cappedMult = Math.min(combinedMult, 1.75);
  let payRate = base * cappedMult;
  const uncapped = Math.round(base * combinedMult);
  let capped = combinedMult > 1.75;
  // Hourly path: apply cap only when unit is 'hour' or 'unknown'.
  // 'day'/'shift' caps on an hourly assignment are a parse mismatch — drop
  // the cap and let the UI surface via hasWarning.
  // (2026-06-01 audit: computeAdjustedSpecRange no longer mirrors this cap×0.80
  // clamp — the Market Position bar now shows the unscaled researched range, so
  // this PDF-rateCap clamp lives only here, on the engine output.)
  if (f.rateCap.cap && (f.rateCap.unit === 'hour' || f.rateCap.unit === 'unknown')) {
    const capPay = f.rateCap.cap * 0.80;
    if (payRate > capPay) { payRate = capPay; capped = true; }
  }
  // === RESEARCHED-RANGE CEILING (accuracy audit 2026-06-01) ===
  // The multiplier chain is an ESTIMATE; it must never quote ABOVE the
  // specialty's researched max. The old guardrail (combinedMult ≤ 1.75) was
  // anchored to the BASE (1.75×p70 = $406 for CRNA), so it never bound a normal
  // in-range over-quote — the whole $250–$406 band shipped silently. Clamp the
  // final pay to spec.max. This uses an EXISTING curated/overlaid value (no new
  // fabricated number) and can only LOWER an over-quote toward a documented
  // bound, never raise a rate. Tracked with a DEDICATED flag (NOT payRateCapped)
  // so it does NOT trip computeDisplayedRate's positive-calibration suppression —
  // observed feedback may still legitimately adjust within ±15%.
  let marketMaxApplied = false;
  if (spec && payRate > spec.max) {
    payRate = spec.max;
    marketMaxApplied = true;
  }
  return {
    base,
    geoMult, ruralMult, shiftMult, facilityMult, durationMult, callMult, holidayMult,
    // T13/S6 H-5 (2026-04-29): expose the engine-computed chain so consumers
    // (e.g. computeAdjustedSpecRange) read it instead of recomposing — a new
    // multiplier added above auto-flows to every consumer.
    combinedMult, cappedMult,
    payRate: Math.round(payRate),
    billRate: roundUp5(payRate / 0.80),
    // Hourly path has no breakdown — hero IS the only pay row, so
    // payRateCapped tracks `capped` exactly. Field exists for type-symmetry
    // with CalculatedCallRate (Codex MUST 4 / 2026-04-29).
    capped, payRateCapped: capped, uncapped,
    // Researched-range ceiling engaged (payRate was clamped to spec.max). Kept
    // SEPARATE from capped/payRateCapped to avoid suppressing calibration.
    marketMaxApplied,
    isCallOnly: false as const,
  };
}

// === RESEARCHED MARKET RANGE (Market Position bar) ===
// Accuracy audit 2026-06-01: the bar shows the RESEARCHED market range
// [spec.min, spec.max] and positions the (range-clamped) quote within it.
//
// Previously the bounds were the spec range SCALED by the engine multiplier
// chain (cappedMult). That made sense ONLY while the quote was unbounded:
// scaling the bounds the same way kept the marker off the edges. Now that
// calculateRate clamps the quote to spec.max, scaled bounds would render a
// maxed-out quote MID-bar (marker $250 vs adjustedMax $250×1.33≈$332 → ~58%,
// a false "room to go up" signal). Plotting against the unscaled researched
// range is the honest signal: a clamped quote sits at the right edge ("top of
// the researched market"); a low-geo quote sits lower. Supersedes the S6 /
// T15a-MUST-1 scaled-bounds design.
//
// `_f` / `_rate` retained for call-site + signature compatibility (RateResults
// and existing tests call positionally) but are no longer consumed — the bounds
// are the researched range, independent of the per-assignment multiplier chain
// and of any PDF rate-cap (which constrains the MARKER via the engine, not the
// market RANGE).
export function computeAdjustedSpecRange(
  spec: { min: number; max: number },
  _f: RateFactors,
  _rate: Pick<CalculatedRate, 'cappedMult'>,
): { adjustedMin: number; adjustedMax: number } {
  return { adjustedMin: spec.min, adjustedMax: spec.max };
}

// === PER-DIEM / CALL-ONLY RATE CALCULATION ===
//
// FACTOR-05 (2026-06-03): rebuilt on the REAL observed bands in CALL_RATE_DATA
// (cite-or-suppress). The base is the researched `typical`; the per-assignment
// daily is then bounded by the researched band `max` — no quote may exceed the
// highest publicly-observed daily for the specialty/day-type (this is the
// "researched clamp" that kills the prior inflated call-only quotes, e.g. neuro
// call ~$821/hr). When the research has no band for the resolved day-type, the
// engine emits NO fabricated daily: `insufficientData` is true, numeric pays are
// 0, and the carried band/callback/adjacentHourly provenance drives the honest
// UI surface. It NEVER derives a call-only daily from an hourly rate.
export function calculateCallRate(f: RateFactors): CalculatedCallRate {
  const entry = getCallRateEntry(f.specialty.key);
  const dayKey = f.dayType.key; // weekday, weekend, or holiday
  const resolvedBand = entry[dayKey];

  // Geographic & facility modifiers — computed regardless of data sufficiency so
  // the multiplier chain is always exposed (parity with CalculatedRate + UI).
  const geoMult = f.state.code ? (STATE_MULT[f.state.code] || 1.0) : 1.0;
  // Rural double-count removed (accuracy audit 2026-06-01) — geoMult already
  // prices rural scarcity. One assignment to 1.0 neutralizes every downstream site.
  const ruralMult = 1.0;
  const facilityMult = FACILITY_MULT[f.facility.key].mult;
  const durationMult = DURATION_MULT[f.duration.key].mult;
  // Cap the combined multiplier at 1.75x (parity with the hourly path).
  const combinedMult = geoMult * ruralMult * facilityMult * durationMult;
  const cappedMult = Math.min(combinedMult, 1.75);

  // Rate cap: only daily/shift units apply on call-only. 'hour' and 'unknown'
  // are dropped (Codex C-1 silent-misapply guard).
  const callOnlyCap = getCallOnlyPayCap(f.rateCap);

  // Per-day-type pay: typical × cappedMult, clamped to that day's researched MAX
  // (the highest publicly-observed daily), then to the day/shift rate cap. A
  // null band is insufficient public data → pay 0, never fabricated.
  const dayPay = (band: CallRateBand | null) => {
    if (!band) return { pay: 0, sufficient: false, capped: false, maxApplied: false };
    let pay = band.typical * cappedMult;
    let maxApplied = false;
    if (pay > band.max) { pay = band.max; maxApplied = true; }
    let capped = maxApplied;
    if (callOnlyCap !== null && pay > callOnlyCap) { pay = callOnlyCap; capped = true; }
    return { pay: Math.round(pay), sufficient: true, capped, maxApplied };
  };

  const wk = dayPay(entry.weekday);
  const we = dayPay(entry.weekend);
  const ho = dayPay(entry.holiday);
  const resolved = dayKey === 'weekend' ? we : dayKey === 'holiday' ? ho : wk;

  const insufficientData = resolvedBand === null;
  const dailyPay = resolved.pay;
  const baseDaily = resolvedBand ? resolvedBand.typical : 0;
  // Honest $/hr divisor: the comp-model's coverage hours (24 for a beeper-call,
  // the scheduled shift for a worked-day). When the resolved day is insufficient,
  // fall back to another day's coverage (display-only; no daily is shown anyway).
  const coverageHrs = resolvedBand?.coverageHrs
    ?? entry.weekday?.coverageHrs ?? entry.weekend?.coverageHrs ?? 24;
  const compModel: CallCompModel = resolvedBand ? resolvedBand.compModel : 'unknown';

  // uncapped (pre-clamp) hero, for the "would have been" cap caption.
  const uncapped = resolvedBand ? Math.round(resolvedBand.typical * combinedMult) : 0;
  // payRateCapped: hero clamped by researched-max, rate-cap, OR the 1.75x
  // multiplier ceiling. Hero-only signal — computeDisplayedRate gates calibration
  // suppression on this, NOT on breakdown-row caps.
  const payRateCapped =
    resolved.capped || (resolvedBand !== null && combinedMult > 1.75 && uncapped > dailyPay);
  // Umbrella flag: hero OR any breakdown row clamped (drives the cap-warning UI).
  const capped = payRateCapped || wk.capped || we.capped || ho.capped;

  // Callback differential ($/hr): the researched band midpoint, or a parsed
  // per-assignment override. Suppressed (0) when no public callback $ exists.
  // FACTOR-05: NOT geo-scaled — a callback is a CITED flat contract rate, not a
  // market-varying daily; multiplying it by geo would push e.g. neuro's cited
  // $475 above the published figure and break provenance. The UI surfaces the
  // raw band (callbackBand) verbatim whenever one exists.
  const callbackBand = entry.callback;
  const callbackMid = callbackBand ? Math.round((callbackBand.min + callbackBand.max) / 2) : 0;
  const callbackRate = f.callbackRate || callbackMid;
  const includedHrs = f.includedHours || entry.gratisHrs || 0;

  return {
    isCallOnly: true as const,
    dayType: dayKey,
    insufficientData,
    coverageHrs,
    compModel,
    sources: entry.sources,
    bands: { weekday: entry.weekday, weekend: entry.weekend, holiday: entry.holiday },
    weekdaySufficient: wk.sufficient,
    weekendSufficient: we.sufficient,
    holidaySufficient: ho.sufficient,
    callbackBand: callbackBand ?? null,
    adjacentHourly: entry.adjacentHourly ?? null,
    marketMaxApplied: resolved.maxApplied,
    note: entry.note,
    baseDaily, geoMult, ruralMult, facilityMult, durationMult,
    // T13/S6 H-5: call-only stack is geo × rural × facility × duration (no
    // shift/call/holiday — those are baked into the per-day-type base rate).
    combinedMult, cappedMult,
    dailyPay,
    dailyBill: roundUp5(dailyPay / 0.80),
    callbackRate, includedHrs,
    weekdayPay: wk.pay, weekendPay: we.pay, holidayPay: ho.pay,
    weekdayBill: wk.sufficient ? roundUp5(wk.pay / 0.80) : 0,
    weekendBill: we.sufficient ? roundUp5(we.pay / 0.80) : 0,
    holidayBill: ho.sufficient ? roundUp5(ho.pay / 0.80) : 0,
    capped, payRateCapped,
    // Expose the computed daily-pay cap so the display layer can re-clamp
    // breakdown rows after applying a calibration ratio (Codex MUST 4 round-2).
    payCap: callOnlyCap,
    uncapped,
    // Compat fields so logging doesn't break
    payRate: dailyPay,
    billRate: roundUp5(dailyPay / 0.80),
    base: baseDaily,
    shiftMult: 1,
    callMult: 1,
    holidayMult: 1,
  };
}

// === INIT FACTORS ===
export function initFactors(parsed: ParsedAssignment): RateFactors {
  let specialty = mapSpecialty(parsed.specialty);
  specialty = refineSpecialtyFromContext(specialty, parsed);
  const spec = SPECIALTIES[specialty.key];
  const callOnly = detectCallOnly(parsed);
  const pdfIncludedHrs = detectIncludedHours(parsed);
  const callEntry = getCallRateEntry(specialty.key);
  // FACTOR-05: real callback band midpoint, or 0 where the research published no
  // public callback $ (never fabricated). Gratis hours default to 0 when unknown.
  const callbackDefault = callEntry.callback
    ? Math.round((callEntry.callback.min + callEntry.callback.max) / 2)
    : 0;

  return {
    specialty,
    state: inferStateEnhanced(parsed),
    rural: inferRural(parsed),
    shift: inferShiftEnhanced(parsed),
    facility: inferFacilityTypeEnhanced(parsed),
    duration: inferDuration(parsed),
    call: hasCall(parsed),
    holiday: hasHoliday(parsed),
    rateCap: extractBillRateCap(parsed),
    baseRate: spec.p70,
    callOnly,
    dayType: callOnly.isCallOnly
      ? inferDayType(parsed)
      : { key: 'weekday' as const, source: 'default' as const },
    includedHours: pdfIncludedHrs || (callEntry.gratisHrs ?? 0),
    callbackRate: callbackDefault,
  };
}
