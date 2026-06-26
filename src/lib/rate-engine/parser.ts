// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// parser.ts — PDF and free-text parsing functions
// Extracted from rate-simulator/index.html
// Handles LocumSmart PDF extraction, free-text input parsing,
// and building ParsedAssignment objects from various sources
// ============================================================

import { STATE_MULT } from './stateData';
import { fuzzyMatchSpecialty, fuzzyMatchState, fuzzyMatchCity, FILLER_WORDS } from './fuzzyMatch';
import type {
  ParsedAssignment,
  Facility,
  Contact,
  ParsedSection,
  FreetextParseResult,
  DurationPattern,
} from './types';

// === FACILITY KEYWORDS (for free-text parsing) ===
export const FACILITY_KEYWORDS: Record<string, string> = {
  'level 1 trauma': 'academic', 'level i trauma': 'academic', 'level 1': 'academic',
  'level 2 trauma': 'community', 'level ii trauma': 'community', 'level 3 trauma': 'community', 'level iii trauma': 'community',
  'trauma center': 'community', 'academic': 'academic', 'teaching': 'academic', 'university': 'academic', 'research': 'academic',
  'va ': 'va', 'veterans': 'va', 'veteran': 'va',
  'cah': 'cah', 'critical access': 'cah',
  'asc': 'asc', 'ambulatory surgery': 'asc', 'surgery center': 'asc',
  'fqhc': 'fqhc', 'community health center': 'fqhc', 'rural health clinic': 'fqhc',
  'outpatient': 'outpatient', 'clinic': 'outpatient',
  'correctional': 'correctional', 'prison': 'correctional', 'jail': 'correctional',
  'psych facility': 'psych', 'telehealth': 'telehealth', 'telemedicine': 'telehealth', 'virtual': 'telehealth',
  'freestanding ed': 'freestanding_ed', 'standalone ed': 'freestanding_ed', 'free-standing ed': 'freestanding_ed',
  'rural trauma': 'rural_trauma',
};

// Whole-word/phrase match against an already-lowercased input. Anchors the
// (trimmed) keyword with \b at both ends so a key never fires on a substring of
// an unrelated word — e.g. 'asc' must not match "vascular"/"cardiovascular"/
// "ascension", 'clinic' not "clinical", 'cah' not "cahokia", 'va' not
// "Pennsylvania"/"Nevada". Keys may be multi-word; \b anchors the phrase ends.
export function matchesKeyword(text: string, keyword: string): boolean {
  const k = keyword.trim();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`).test(text);
}

export const SHIFT_KEYWORDS: Record<string, string> = {
  'nights': 'night', 'night': 'night', 'nocturnist': 'night', 'overnight': 'night', 'night shift': 'night',
  'weekend': 'weekend_day', 'weekends': 'weekend_day', 'weekend day': 'weekend_day',
  'weekend night': 'weekend_night', 'weekend nights': 'weekend_night',
  'swing': 'evening', 'evening': 'evening',
  'holiday': 'holiday', 'holidays': 'holiday',
};

/**
 * SHIFT_KEYWORDS sorted by key length descending so compound matches
 * ("weekend night") are tried before their substrings ("night"). Without
 * this, `Object.entries` iteration order would let "night" win on input
 * "crna weekend night in tx" and produce shift='night' instead of
 * 'weekend_night'.
 */
const SHIFT_KEYWORDS_BY_LENGTH: ReadonlyArray<readonly [string, string]> =
  Object.entries(SHIFT_KEYWORDS).sort((a, b) => b[0].length - a[0].length);

export const CALL_KEYWORDS_YES: readonly string[] = [
  'with call', 'on call', 'call required', 'call coverage', 'shared call', 'beeper call', 'pager call',
];

export const CALL_KEYWORDS_NO: readonly string[] = [
  'no call', 'without call',
];

export const DURATION_PATTERNS: DurationPattern[] = [
  { regex: /(\d+)\s*weeks?/i, fn: (m) => { const w = parseInt(m[1]); return w <= 1 ? 'emergency' : w <= 4 ? 'short' : w <= 8 ? 'standard' : 'long'; } },
  { regex: /(\d+)\s*months?/i, fn: (m) => { const mo = parseInt(m[1]); return mo <= 1 ? 'short' : mo <= 2 ? 'standard' : 'long'; } },
  { regex: /short\s*term/i, fn: () => 'short' },
  { regex: /long\s*term/i, fn: () => 'long' },
  { regex: /\basap\b/i, fn: () => 'emergency' },
  { regex: /\burgent\b/i, fn: () => 'emergency' },
];

// === HELPERS ===
export function normalizeText(input: string): string {
  return input
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2022\u25cf]/g, '-')
    .split('\n')
    .map(l => l.trim().replace(/\s+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// === PDF PARSER HELPERS ===
export function extractValue(text: string, label: string): string {
  const m = text.match(new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'mi'));
  return m ? m[1].trim() : '';
}

export function extractBlock(text: string, heading: string, nextHeadings: string[]): string {
  const lines = text.split('\n');
  // Try exact match first, then case-insensitive, then partial match
  let start = lines.findIndex(l => l === heading + ':');
  if (start === -1) start = lines.findIndex(l => l.toLowerCase() === heading.toLowerCase() + ':');
  if (start === -1) start = lines.findIndex(l => l.toLowerCase().startsWith(heading.toLowerCase()));
  if (start === -1) return '';
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (nextHeadings.some(h => line === h + ':' || line.toLowerCase() === h.toLowerCase() + ':' || line.toLowerCase().startsWith(h.toLowerCase()))) break;
    block.push(line);
  }
  return block.join('\n').trim();
}

export function parseFacilities(block: string): Facility[] {
  return block.split('\n').filter(Boolean).map(l => l.replace(/^\d+\.\s*/, '')).map(l => {
    // Try standard format: "FacilityName - City, ST"
    let m = l.match(/^(.*?)\s+-\s+([^,]+),\s*([A-Z]{2})$/);
    if (m) return { name: m[1].trim(), city: m[2].trim(), state: m[3].trim() };
    // Try LocumSmart format: "FacilityName - City (ST)" — state in parentheses
    m = l.match(/^(.*?)\s+-\s+([^(]+?)\s*\(([A-Z]{2})\)\s*$/);
    if (m && STATE_MULT[m[3]]) return { name: m[1].trim(), city: m[2].trim(), state: m[3].trim() };
    // Try: "FacilityName, City, ST"
    m = l.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})$/);
    if (m) return { name: m[1].trim(), city: m[2].trim(), state: m[3].trim() };
    // Try: "FacilityName (ST)" — state in parentheses, no city
    m = l.match(/^(.*?)\s*\(([A-Z]{2})\)\s*$/);
    if (m && STATE_MULT[m[2]]) return { name: m[1].trim(), city: '', state: m[2].trim() };
    // Try: "City, ST" (no facility name)
    m = l.match(/^([^,]+),\s*([A-Z]{2})$/);
    if (m) return { name: '', city: m[1].trim(), state: m[2].trim() };
    // Try: anything with a 2-letter state code at end
    m = l.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s*([A-Z]{2})\s*$/);
    if (m && STATE_MULT[m[2]]) return { name: l.replace(m[0], '').replace(/[-,]\s*$/, '').trim(), city: m[1].trim(), state: m[2].trim() };
    return { name: l.trim(), city: '', state: '' };
  });
}

export function parseContacts(block: string): Contact[] {
  return block.split('\n').filter(Boolean).map(l => l.replace(/^[-*]\s*/, '')).map(l => {
    const parts = l.split(',').map(p => p.trim()).filter(Boolean);
    return { name: parts[0] || '', role: parts[1] || '', facility: parts[2] || '' };
  });
}

export function parseSection(text: string, title: string, nextHeadings: string[]): ParsedSection {
  const block = extractBlock(text, title, nextHeadings);
  return {
    title,
    items: block.split('\n').filter(Boolean)
      .map(l => l.replace(/^[-*]\s*/, ''))
      .filter(l => l.includes(':'))
      .map(l => {
        const i = l.indexOf(':');
        return { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
      })
      .filter(item => item.label && item.value),
  };
}

// === MAIN PDF PARSER ===
export function parseLocumsmartAssignment(text: string): ParsedAssignment {
  text = normalizeText(text);
  const allH = ['Facilities', 'Facility', 'Representative Contacts', 'Assignment Details', 'Requirements', 'Call & Travel', 'Notes'];
  // Try "Facilities:" block first, then fall back to singular "Facility:" field
  let facilities = parseFacilities(extractBlock(text, 'Facilities', allH));
  if (facilities.length === 0 || facilities.every(f => !f.state)) {
    const facVal = extractValue(text, 'Facility');
    if (facVal) {
      const parsed = parseFacilities(facVal);
      if (parsed.length > 0 && (parsed[0].state || parsed[0].name)) facilities = parsed;
    }
  }
  return {
    assignmentNumber: extractValue(text, 'Assignment Number') || extractValue(text, 'Assignment Request #'),
    status: extractValue(text, 'Status'),
    hco: extractValue(text, 'HCO'),
    specialty: extractValue(text, 'Specialty') || extractValue(text, 'Specialties'),
    providersRequested: extractValue(text, 'Providers Requested'),
    startDate: extractValue(text, 'Start Date'),
    endDate: extractValue(text, 'End Date'),
    nearestAirport: extractValue(text, 'Nearest Airport'),
    facilities,
    contacts: parseContacts(extractBlock(text, 'Representative Contacts', allH)),
    sections: [
      parseSection(text, 'Assignment Details', allH),
      parseSection(text, 'Requirements', allH),
      parseSection(text, 'Call & Travel', allH),
    ].filter(s => s.items.length > 0),
    notes: extractBlock(text, 'Notes', [])
      .split('\n').filter(Boolean)
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean).join(' '),
    _rawText: text,
  };
}

export function regexFallbackExtract(text: string): ParsedAssignment {
  const rx = (p: RegExp): string => { const m = text.match(p); return m ? m[1].trim() : ''; };
  const facLine = rx(/Facilit(?:y|ies):?\s*([^\n]+)/i);
  const facilities = facLine ? parseFacilities(facLine) : [];
  return {
    assignmentNumber: rx(/Assignment\s*(?:Request\s*)?#?:?\s*([A-Z0-9-]+)/i),
    status: rx(/Status:?\s*(\w+)/i),
    hco: rx(/HCO:?\s*([^\n]+)/i),
    specialty: rx(/Specialt(?:y|ies):?\s*([^\n]+)/i) || rx(/Provider\s*Title:?\s*([^\n]+)/i),
    providersRequested: rx(/Providers?\s*Requested:?\s*(\d+)/i),
    startDate: rx(/Start\s*Date:?\s*([^\n]+)/i),
    endDate: rx(/End\s*Date:?\s*([^\n]+)/i),
    nearestAirport: rx(/Nearest\s*Airport:?\s*([^\n]+)/i),
    facilities,
    contacts: [],
    sections: [],
    notes: '',
    _rawText: text,
  };
}

// === FREE-TEXT PARSER ===
export function parseFreetextInput(raw: string): FreetextParseResult {
  const input = raw.toLowerCase().trim();
  const result: FreetextParseResult = {
    specialty: null, state: null, city: null, facility: null,
    shift: null, call: null, duration: null, holiday: false, corrections: [],
  };

  // State code match (e.g., ", TX" or ", tx")
  const stateCodeMatch = input.match(/,\s*([a-z]{2})(?:\s|$|,|\.|-)/);
  if (stateCodeMatch) {
    const sm = fuzzyMatchState(stateCodeMatch[1]);
    if (sm) {
      result.state = sm;
    }
  }

  // Duration patterns
  for (const { regex, fn } of DURATION_PATTERNS) {
    const dm = input.match(regex);
    if (dm) { result.duration = fn(dm); break; }
  }

  // Call keywords (no-call checked first)
  for (const kw of CALL_KEYWORDS_NO) {
    if (input.includes(kw)) { result.call = false; break; }
  }
  if (result.call === null) {
    for (const kw of CALL_KEYWORDS_YES) {
      if (input.includes(kw)) { result.call = true; break; }
    }
  }

  // Facility keywords
  for (const [kw, ftype] of Object.entries(FACILITY_KEYWORDS)) {
    // Word-boundary match (matchesKeyword) so a key never fires on a substring of
    // an unrelated word — 'asc'∌"vascular"/"cardiovascular"/"ascension",
    // 'clinic'∌"clinical", 'cah'∌"cahokia", 'va'∌"Pennsylvania"/"Nevada".
    if (matchesKeyword(input, kw)) { result.facility = ftype; break; }
  }

  // Shift keywords — iterate longest-key-first so compound phrases ("weekend night")
  // win over their substrings ("night") regardless of declaration order.
  for (const [kw, stype] of SHIFT_KEYWORDS_BY_LENGTH) {
    if (input.includes(kw)) { result.shift = stype; break; }
  }

  // Holiday
  if (/\bholiday\b/.test(input)) result.holiday = true;

  // Clean input for token-based matching
  const cleaned = input
    .replace(/,\s*[a-z]{2}(?:\s|$)/g, ' ')
    .replace(/\d+\s*(?:weeks?|months?)/gi, '')
    .replace(/[^a-z0-9\s/]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(t => t && !FILLER_WORDS.has(t));

  // Multi-word specialty match (3-word then 2-word phrases)
  for (let len = 3; len >= 2; len--) {
    for (let i = 0; i <= tokens.length - len; i++) {
      const phrase = tokens.slice(i, i + len).join(' ');
      const sm = fuzzyMatchSpecialty(phrase);
      if (sm) {
        result.specialty = sm;
        if (sm.matchKind === 'substring') result.corrections.push({ field: 'specialty', from: phrase, to: sm.key });
        tokens.splice(i, len);
        break;
      }
    }
    if (result.specialty) break;
  }

  // Single-word specialty match
  if (!result.specialty) {
    for (let i = 0; i < tokens.length; i++) {
      const sm = fuzzyMatchSpecialty(tokens[i]);
      if (sm) {
        result.specialty = sm;
        if (sm.matchKind === 'substring') result.corrections.push({ field: 'specialty', from: tokens[i], to: sm.key });
        tokens.splice(i, 1);
        break;
      }
    }
  }

  // State matching (two-word then single-word)
  if (!result.state) {
    for (let i = 0; i < tokens.length - 1; i++) {
      const phrase = tokens[i] + ' ' + tokens[i + 1];
      const sm = fuzzyMatchState(phrase);
      if (sm) {
        result.state = sm;
        tokens.splice(i, 2);
        break;
      }
    }
    if (!result.state) {
      for (let i = 0; i < tokens.length; i++) {
        const sm = fuzzyMatchState(tokens[i]);
        if (sm) {
          result.state = sm;
          tokens.splice(i, 1);
          break;
        }
      }
    }
  }

  // City matching (two-word then single-word)
  for (let i = 0; i < tokens.length - 1; i++) {
    const phrase = tokens[i] + ' ' + tokens[i + 1];
    const cm = fuzzyMatchCity(phrase);
    if (cm) {
      result.city = cm;
      if (cm.matchKind === 'substring') result.corrections.push({ field: 'city', from: phrase, to: cm.city });
      tokens.splice(i, 2);
      break;
    }
  }
  if (!result.city) {
    for (let i = 0; i < tokens.length; i++) {
      const cm = fuzzyMatchCity(tokens[i]);
      if (cm) {
        result.city = cm;
        if (cm.matchKind === 'substring') result.corrections.push({ field: 'city', from: tokens[i], to: cm.city });
        tokens.splice(i, 1);
        break;
      }
    }
  }

  return result;
}

// === BRIDGE: freetext parsed result to initFactors-compatible object ===
export function buildParsedFromFreetext(raw: string): ParsedAssignment | null {
  const parsed = parseFreetextInput(raw);
  if (!parsed.specialty) return null;
  const stateCode = parsed.state ? parsed.state.code : '';
  const cityName = parsed.city ? parsed.city.city : '';
  const items: Array<{ label: string; value: string }> = [];

  // Bridge every parsed shift kind into a Schedule line so inferShiftEnhanced
  // sees a value to match. The Schedule label is preferred over Coverage Type
  // because Coverage Type is consumed for call-only detection. Strings end in
  // " shift" (or " coverage") so the trailing word boundary lets
  // inferShiftEnhanced's `\bnight\b` / `\bweekend.*night\b` regexes match —
  // "Nights" / "Weekend nights" would fail those patterns due to the trailing
  // 's' (word→word, no boundary).
  if (parsed.shift) {
    const scheduleValue: Record<string, string> = {
      night: 'Night shift',
      weekend_day: 'Weekend day shift',
      weekend_night: 'Weekend night shift',
      evening: 'Evening shift',
      holiday: 'Holiday coverage',
      day: 'Day shift',
    };
    const v = scheduleValue[parsed.shift] ?? parsed.shift;
    items.push({ label: 'Schedule', value: v });
  }

  if (parsed.call === true) items.push({ label: 'Call Type', value: 'On Call' });
  if (parsed.call === false) items.push({ label: 'Call Type', value: 'None' });
  if (parsed.holiday) items.push({ label: 'Holidays', value: 'Holiday coverage' });

  const facilityKeyword = parsed.facility || '';
  return {
    assignmentNumber: '',
    specialty: parsed.specialty.key,
    status: '',
    hco: '',
    startDate: '',
    endDate: '',
    facilities: [{ name: facilityKeyword, state: stateCode, city: cityName }],
    sections: items.length ? [{ title: 'Details', items }] : [],
    notes: raw,
    _rawText: raw,
    _source: 'freetext',
    _freetextParsed: parsed,
  };
}
