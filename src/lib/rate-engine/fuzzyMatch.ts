// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// fuzzyMatch.ts — Levenshtein distance and fuzzy matching functions
// Extracted from rate-simulator/index.html
// Used for free-text input parsing to match specialties, states, cities
// ============================================================

import { SPECIALTIES, SPECIALTY_ALIASES } from './specialties';
import { STATE_MULT, STATE_NAMES, METRO_CITIES } from './stateData';
import { GSA_OVERRIDES } from './callRates';
import type { FuzzySpecialtyMatch, FuzzyStateMatch, FuzzyCityMatch } from './types';

/** Filler words stripped during free-text parsing */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
  'locum', 'tenens', 'locums', 'a', 'the', 'in', 'at', 'for', 'with',
  'an', 'and', 'as', 'to', 'of', 'on', 'is', 'are', 'need', 'needed', 'looking',
]);

/**
 * Levenshtein distance between two strings.
 * Used for fuzzy matching of user input against known values.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[] = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = m[0];
    m[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = m[i];
      m[i] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, m[i], m[i - 1]) + 1;
      prev = tmp;
    }
  }
  return m[a.length];
}

/** Minimum length for one-way substring match. Below this, require exact equality. */
const MIN_TARGET_LEN = 4;

/**
 * One-way loose match: does a candidate string contain the target token?
 * Only matches in the `candidate.includes(token)` direction — never
 * `token.includes(candidate)`, which would let a long user phrase subsume a
 * short specialty key by surrounding noise.
 * Below MIN_TARGET_LEN we require exact equality.
 *
 * Mirrors liveCalibration.ts:103 — keep these in sync.
 */
function looseMatch(candidate: string, token: string): boolean {
  if (candidate === token) return true;
  if (token.length < MIN_TARGET_LEN) return false;
  return candidate.includes(token);
}

/**
 * Fuzzy match a token against specialty names and aliases.
 * Exact equality wins. Otherwise one-way substring (token contained in
 * candidate key) with a 4-char floor on the token. Returns the SHORTEST
 * matching key when multiple candidates qualify (most specific wins —
 * "anesth" → "anesthesiology" rather than "general anesthesiology").
 *
 * `matchKind` discriminates exact vs substring — callers that need to know
 * whether the user typed the canonical form (vs. abbreviated) must read
 * `matchKind`, not `distance` (which is always 0 since Levenshtein is gone).
 */
export function fuzzyMatchSpecialty(token: string): FuzzySpecialtyMatch | null {
  if (!token) return null;
  if (SPECIALTIES[token]) return { key: token, distance: 0, matchKind: 'exact' };
  if (SPECIALTY_ALIASES[token]) return { key: SPECIALTY_ALIASES[token], distance: 0, matchKind: 'exact' };
  if (token.length < MIN_TARGET_LEN) return null;

  let best: string | null = null;
  let bestLen = Infinity;
  const allKeys = [...Object.keys(SPECIALTIES), ...Object.keys(SPECIALTY_ALIASES)];
  for (const c of allKeys) {
    if (looseMatch(c, token) && c.length < bestLen) {
      bestLen = c.length;
      best = SPECIALTIES[c] ? c : SPECIALTY_ALIASES[c];
    }
  }
  return best ? { key: best, distance: 0, matchKind: 'substring' } : null;
}

/**
 * Fuzzy match a token against state codes and names.
 * State matching is exact-or-nothing — a 2-letter code typo is indistinguishable
 * from a different state, and a misspelled state name should not silently route
 * to the closest one. `matchKind` is always `'exact'` here for the same reason.
 */
export function fuzzyMatchState(token: string): FuzzyStateMatch | null {
  if (!token) return null;
  const upper = token.toUpperCase();
  if (STATE_MULT[upper]) return { code: upper, distance: 0, matchKind: 'exact' };
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (name.toLowerCase() === token.toLowerCase()) return { code, distance: 0, matchKind: 'exact' };
  }
  return null;
}

/** Lazy-initialized set of all known cities (metro + GSA override keys) */
let _allCities: Set<string> | null = null;

export function getAllCities(): Set<string> {
  if (!_allCities) {
    _allCities = new Set([
      ...METRO_CITIES,
      ...Object.keys(GSA_OVERRIDES).map(k => k.split(',')[0]),
    ]);
  }
  return _allCities;
}

/**
 * Fuzzy match a token against known city names.
 * Same rule as specialty: exact equality, or one-way substring with a 4-char
 * floor on the token. Cities are dense — a misspelled "bostom" should not
 * silently route to "boston".
 */
export function fuzzyMatchCity(token: string): FuzzyCityMatch | null {
  if (!token) return null;
  const ALL_CITIES = getAllCities();
  if (ALL_CITIES.has(token)) return { city: token, distance: 0, matchKind: 'exact' };
  if (token.length < MIN_TARGET_LEN) return null;

  let best: string | null = null;
  let bestLen = Infinity;
  for (const city of ALL_CITIES) {
    if (looseMatch(city, token) && city.length < bestLen) {
      bestLen = city.length;
      best = city;
    }
  }
  return best ? { city: best, distance: 0, matchKind: 'substring' } : null;
}
