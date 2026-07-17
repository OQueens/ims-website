// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// === SPECIALTY RATE TABLE (2025-2026 Locum Tenens Market Data) ===
// Verified Sources: LocumStory 2025 (CHG), OnCall Solutions 2024, TheLocumGuy,
// ResidencyAdvisor 2025, FastRVU 2026. Cross-referenced per RATE_RESEARCH.md
// Confidence tiers (DATA-SOURCE-AUDIT.md §3.1.2):
//   high     — 3+ live multi-source confirmations (fresh < 7d, market-typed)
//   medium   — 2 live confirmations (fresh < 7d)
//   low      — 1 live confirmation (fresh < 7d) — typically BLS-only
//   modeled  — research-derived static value with no live multi-source signal
//   The static analyst-set values below use high/medium/low per the curator's
//   own assessment of underlying research; specialties without an explicit
//   confidence default to 'modeled' (research-derived, no live confirmation).
//   marketRates.ts:loadMarketRates() upgrades the tier at runtime when live
//   Firebase signal warrants — never downgrades analyst curation.
// All rates are HOURLY PAY rates for locum tenens assignments (not permanent employment)

export type Confidence = 'high' | 'medium' | 'low' | 'modeled';

/** Data-provenance discriminator (Fix D, 2026-05-15). Surfaces in the UI as
 *  a small tagline under the "Range" stat block so the user knows whether
 *  the displayed range is:
 *    'curated' — analyst-curated from the named industry sources in this
 *                file's header comment (LocumStory 2025, OnCall Solutions
 *                2024, TheLocumGuy, ResidencyAdvisor 2025, FastRVU 2026,
 *                cross-referenced per RATE_RESEARCH.md). These are publicly
 *                self-published sources and several are CHG-correlated;
 *                they're a starting estimate, not observed paid rates.
 *    'live'    — `loadMarketRates()` overlay was applied on top of the
 *                curated baseline from a fresh (<7d) multi-source RTDB row.
 *                Post-Fix-A (2026-05-15) this only fires with sources.length
 *                ≥ 2 AND valueType !== 'cap'. The displayed min/max/p70 are
 *                whatever the overlay wrote.
 *  All entries default to 'curated' at build time; loadMarketRates flips
 *  to 'live' per-specialty when the overlay applies. */
export type Provenance = 'curated' | 'live';

export interface SpecialtyRate {
  min: number;
  max: number;
  p70: number;
  confidence: Confidence;
  category: string;
  /** See `Provenance` type docstring. Always set post-build to 'curated';
   *  `loadMarketRates()` may flip individual entries to 'live'. */
  provenance: Provenance;
}

interface SpecialtyRateInput {
  min: number;
  max: number;
  confidence?: 'high' | 'medium' | 'low';
  category: string;
}

const _SPECIALTIES_RAW: Record<string, SpecialtyRateInput> = {
  // --- Anesthesia ---
  'anesthesiology': { min: 300, max: 400, confidence: 'medium', category: 'Anesthesia' },
  'crna': { min: 190, max: 250, confidence: 'medium', category: 'Anesthesia' },
  'anesthesiologist assistant': { min: 180, max: 240, category: 'Anesthesia' },
  'cardiac anesthesiology': { min: 350, max: 450, category: 'Anesthesia' },
  'pediatric anesthesiology': { min: 320, max: 420, category: 'Anesthesia' },
  'obstetric anesthesiology': { min: 300, max: 400, category: 'Anesthesia' },
  'pain management': { min: 250, max: 341, category: 'Anesthesia' },

  // --- Emergency ---
  'emergency medicine': { min: 200, max: 300, confidence: 'medium', category: 'Emergency' },
  'em nocturnist': { min: 240, max: 340, category: 'Emergency' },
  'rural emergency medicine': { min: 250, max: 350, category: 'Emergency' },
  'pediatric emergency medicine': { min: 210, max: 300, category: 'Emergency' },
  'urgent care': { min: 115, max: 155, confidence: 'medium', category: 'Emergency' },

  // --- Hospital Medicine ---
  'hospitalist': { min: 145, max: 240, confidence: 'medium', category: 'Hospital Medicine' },
  'hospitalist nocturnist': { min: 179, max: 260, category: 'Hospital Medicine' },
  'internal medicine': { min: 130, max: 200, confidence: 'medium', category: 'Hospital Medicine' },
  'family medicine': { min: 120, max: 175, confidence: 'medium', category: 'Hospital Medicine' },
  'critical care': { min: 190, max: 300, confidence: 'medium', category: 'Hospital Medicine' },

  // --- Surgery ---
  'general surgery': { min: 200, max: 310, confidence: 'low', category: 'Surgery' },
  'orthopedic surgery': { min: 210, max: 340, confidence: 'medium', category: 'Surgery' },
  'neurosurgery': { min: 330, max: 480, category: 'Surgery' },
  'thoracic surgery': { min: 280, max: 400, category: 'Surgery' },
  'vascular surgery': { min: 250, max: 360, category: 'Surgery' },
  'trauma surgery': { min: 194, max: 328, category: 'Surgery' },
  'plastic surgery': { min: 220, max: 340, category: 'Surgery' },
  'pediatric surgery': { min: 230, max: 335, category: 'Surgery' },
  'colorectal surgery': { min: 220, max: 310, category: 'Surgery' },
  'surgical oncology': { min: 250, max: 360, category: 'Surgery' },
  'hand surgery': { min: 200, max: 290, category: 'Surgery' },

  // --- Medical Specialties ---
  'cardiology': { min: 250, max: 360, confidence: 'medium', category: 'Medical Specialties' },
  'interventional cardiology': { min: 320, max: 460, category: 'Medical Specialties' },
  'electrophysiology': { min: 300, max: 420, category: 'Medical Specialties' },
  'neurology': { min: 180, max: 275, confidence: 'medium', category: 'Medical Specialties' },
  'neurointerventional': { min: 320, max: 470, category: 'Medical Specialties' },
  'gastroenterology': { min: 185, max: 310, confidence: 'medium', category: 'Medical Specialties' },
  'pulmonology': { min: 200, max: 290, category: 'Medical Specialties' },
  'nephrology': { min: 165, max: 250, confidence: 'low', category: 'Medical Specialties' },
  'endocrinology': { min: 200, max: 275, category: 'Medical Specialties' },
  'rheumatology': { min: 170, max: 245, confidence: 'low', category: 'Medical Specialties' },
  'infectious disease': { min: 185, max: 250, category: 'Medical Specialties' },
  'medical oncology': { min: 350, max: 500, confidence: 'medium', category: 'Medical Specialties' },
  'hematology': { min: 200, max: 300, category: 'Medical Specialties' },
  'hematology/oncology': { min: 300, max: 450, category: 'Medical Specialties' },
  'sleep medicine': { min: 150, max: 220, category: 'Medical Specialties' },
  'allergy/immunology': { min: 150, max: 215, category: 'Medical Specialties' },
  'medical genetics': { min: 180, max: 260, category: 'Medical Specialties' },
  'nuclear medicine': { min: 200, max: 280, category: 'Medical Specialties' },

  // --- OB/GYN ---
  'ob/gyn': { min: 160, max: 275, confidence: 'medium', category: 'OB/GYN' },
  'maternal-fetal medicine': { min: 200, max: 310, category: 'OB/GYN' },
  'reproductive endocrinology': { min: 230, max: 340, category: 'OB/GYN' },
  'gynecologic oncology': { min: 260, max: 370, category: 'OB/GYN' },
  'urogynecology': { min: 200, max: 290, category: 'OB/GYN' },

  // --- Psychiatry ---
  'psychiatry': { min: 180, max: 255, confidence: 'medium', category: 'Psychiatry' },
  'child psychiatry': { min: 200, max: 280, category: 'Psychiatry' },
  'addiction psychiatry': { min: 185, max: 250, category: 'Psychiatry' },
  'geriatric psychiatry': { min: 185, max: 240, category: 'Psychiatry' },
  'forensic psychiatry': { min: 200, max: 280, category: 'Psychiatry' },
  'telepsychiatry': { min: 185, max: 240, category: 'Psychiatry' },
  'correctional psychiatry': { min: 200, max: 270, category: 'Psychiatry' },

  // --- Radiology ---
  'radiology': { min: 185, max: 330, confidence: 'medium', category: 'Radiology' },
  'interventional radiology': { min: 350, max: 460, category: 'Radiology' },
  'neuroradiology': { min: 250, max: 350, category: 'Radiology' },

  // --- Pediatrics ---
  'pediatrics': { min: 110, max: 160, confidence: 'medium', category: 'Pediatrics' },
  'neonatology': { min: 175, max: 260, confidence: 'low', category: 'Pediatrics' },
  'pediatric critical care': { min: 180, max: 260, category: 'Pediatrics' },
  'pediatric cardiology': { min: 210, max: 310, category: 'Pediatrics' },
  'pediatric hospitalist': { min: 130, max: 185, category: 'Pediatrics' },
  'developmental-behavioral pediatrics': { min: 140, max: 200, category: 'Pediatrics' },
  'pediatric orthopedics': { min: 210, max: 300, category: 'Pediatrics' },

  // --- Other Specialties ---
  'urology': { min: 220, max: 330, confidence: 'medium', category: 'Other Specialties' },
  'dermatology': { min: 200, max: 300, confidence: 'low', category: 'Other Specialties' },
  'physical medicine & rehab': { min: 150, max: 200, category: 'Other Specialties' },
  'pathology': { min: 120, max: 200, category: 'Other Specialties' },
  'ophthalmology': { min: 210, max: 310, category: 'Other Specialties' },
  'otolaryngology': { min: 210, max: 300, category: 'Other Specialties' },
  'sports medicine': { min: 150, max: 220, category: 'Other Specialties' },
  'palliative care': { min: 150, max: 215, category: 'Other Specialties' },
  'geriatric medicine': { min: 130, max: 180, category: 'Other Specialties' },
  'occupational medicine': { min: 130, max: 190, category: 'Other Specialties' },
  'correctional medicine': { min: 150, max: 230, category: 'Other Specialties' },
  'preventive medicine': { min: 130, max: 185, category: 'Other Specialties' },
  'wound care': { min: 130, max: 185, category: 'Other Specialties' },

  // --- NP/PA ---
  'np/pa (primary care)': { min: 70, max: 95, category: 'NP/PA' },
  'np/pa (emergency)': { min: 85, max: 120, category: 'NP/PA' },
  'np/pa (hospitalist)': { min: 80, max: 110, category: 'NP/PA' },
  'np/pa (surgery)': { min: 85, max: 120, category: 'NP/PA' },
  'np/pa (psychiatry)': { min: 85, max: 120, category: 'NP/PA' },
  'np/pa (specialty)': { min: 95, max: 130, category: 'NP/PA' },
  'np/pa (neonatology)': { min: 87, max: 168, category: 'NP/PA' },
};

// Compute p70 and default confidence for each specialty. Provenance defaults
// to 'curated' at build time per Fix D 2026-05-15 — the static range came from
// the cross-referenced industry sources in this file's header comment, NOT
// from observed paid rates. `loadMarketRates()` may flip individual entries
// to 'live' at runtime when a fresh multi-source overlay applies.
function buildSpecialties(raw: Record<string, SpecialtyRateInput>): Record<string, SpecialtyRate> {
  const result: Record<string, SpecialtyRate> = {};
  for (const [key, val] of Object.entries(raw)) {
    result[key] = {
      min: val.min,
      max: val.max,
      p70: Math.round(val.min + (val.max - val.min) * 0.70),
      confidence: val.confidence ?? 'modeled',
      category: val.category,
      provenance: 'curated',
    };
  }
  return result;
}

export const SPECIALTIES: Record<string, SpecialtyRate> = buildSpecialties(_SPECIALTIES_RAW);

// Static curator-assigned confidence baseline. Captured at module load and
// NEVER mutated, so loadMarketRates() can recompute the live-signal upgrade
// against the original tier on every call instead of against any previously-
// upgraded value (Codex SHOULD: prevents an upward ratchet if loadMarketRates
// is ever called more than once per session).
export const STATIC_CONFIDENCE: Record<string, Confidence> = Object.fromEntries(
  (Object.entries(_SPECIALTIES_RAW) as Array<[string, SpecialtyRateInput]>)
    .map(([key, val]): [string, Confidence] => [key, val.confidence ?? 'modeled']),
);

/** A specialty's curated [min, max, p70] band, with no confidence/category/
 *  provenance. The shape STATIC_SPECIALTY_RANGES freezes. */
export interface SpecialtyRange {
  min: number;
  max: number;
  p70: number;
}

// Static curator-set RANGE baseline. Captured from the freshly-built SPECIALTIES
// at module load — BEFORE any runtime overlay mutates it — and deep-frozen so it
// can NEVER be mutated. Mirrors STATIC_CONFIDENCE.
//
// Consumed by the v2-posterior overlay (marketRates.ts applyMarketBucketsOverlay,
// RESEARCH §2 #1): when a posterior bucket is promoted to the quote anchor, the
// displayed RANGE reverts to THIS researched curated band rather than inheriting
// whatever loadMarketRates() last wrote. The posterior REPLACES the legacy scrape
// signal for that cell, so pairing the robust anchor with the legacy
// outlier-driven ceiling (e.g. a $450 max set by a single source) would be
// incoherent. loadMarketRates is unaffected — it never reads this snapshot.
export const STATIC_SPECIALTY_RANGES: Record<string, SpecialtyRange> = Object.freeze(
  Object.fromEntries(
    Object.entries(SPECIALTIES).map(([key, s]): [string, SpecialtyRange] => [
      key,
      Object.freeze({ min: s.min, max: s.max, p70: s.p70 }),
    ]),
  ),
) as Record<string, SpecialtyRange>;

// Display label for the confidence tier. The 'modeled' literal is internally
// honest (research-derived static fallback) but opaque to a clinician end-user;
// the UI surfaces 'research-derived' instead. Other tiers display verbatim.
const CONFIDENCE_DISPLAY: Record<Confidence, string> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
  modeled: 'research-derived',
};

export function confidenceLabel(c: Confidence): string {
  return CONFIDENCE_DISPLAY[c];
}

// === SPECIALTY ALIASES ===
export const SPECIALTY_ALIASES: Record<string, string> = {
  'nurse anesthetist': 'crna',
  'nurse anesthetist (crna)': 'crna',
  'certified registered nurse anesthetist': 'crna',
  'crna - cardiac': 'cardiac anesthesiology',
  'anesthesiologist': 'anesthesiology',
  'anesthesia': 'anesthesiology',
  'aa': 'anesthesiologist assistant',
  'em': 'emergency medicine',
  'er': 'emergency medicine',
  'emergency': 'emergency medicine',
  'emergency room': 'emergency medicine',
  'nocturnist em': 'em nocturnist',
  'im': 'internal medicine',
  'fm': 'family medicine',
  'family practice': 'family medicine',
  'general practice': 'family medicine',
  'primary care': 'family medicine',
  'hospitalist - nocturnist': 'hospitalist nocturnist',
  'nocturnist': 'hospitalist nocturnist',
  'icu': 'critical care',
  'intensivist': 'critical care',
  'pulm/crit care': 'critical care',
  'micu': 'critical care',
  'sicu': 'critical care',
  'medical icu': 'critical care',
  'surgical icu': 'critical care',
  'medical/surgical icu': 'critical care',
  'ortho': 'orthopedic surgery',
  'orthopedics': 'orthopedic surgery',
  'pediatric orthopedic surgery': 'pediatric orthopedics',
  'neuro': 'neurology',
  // Neurosurgery plain-language phrasings (FACTOR-04 fix, 2026-06-03). Without
  // these, mapSpecialty's exact-alias miss falls through to the length-sorted
  // substring scan where bare 'neuro' (5 chars) matches inside "neurological
  // surgery"/"neuro surgery" and resolves to neurology ($180-275) instead of
  // neurosurgery ($330-480) — an indefensible wrong-specialty quote. These exact
  // aliases win at the exact-match step; being longer than 'neuro' they also win
  // the substring scan, so both resolution paths are correct.
  'neurosurgeon': 'neurosurgery',
  'neurological surgery': 'neurosurgery',
  'neurological surgeon': 'neurosurgery',
  'neuro surgery': 'neurosurgery',
  'gi': 'gastroenterology',
  'pulm': 'pulmonology',
  'nephro': 'nephrology',
  'endo': 'endocrinology',
  'rheum': 'rheumatology',
  'id': 'infectious disease',
  'hem/onc': 'hematology/oncology',
  'heme/onc': 'hematology/oncology',
  'oncology': 'medical oncology',
  'obgyn': 'ob/gyn',
  'obstetrics': 'ob/gyn',
  'gynecology': 'ob/gyn',
  'mfm': 'maternal-fetal medicine',
  'perinatology': 'maternal-fetal medicine',
  'gyn onc': 'gynecologic oncology',
  'psych': 'psychiatry',
  'behavioral health': 'psychiatry',
  'telepsych': 'telepsychiatry',
  'tele-psychiatry': 'telepsychiatry',
  'virtual psychiatry': 'telepsychiatry',
  'correctional medicine': 'correctional medicine',
  'corrections medicine': 'correctional medicine',
  'corrections psychiatry': 'correctional psychiatry',
  'jail psychiatry': 'correctional psychiatry',
  'prison psychiatry': 'correctional psychiatry',
  'child psych': 'child psychiatry',
  'cap': 'child psychiatry',
  'rad': 'radiology',
  'ir': 'interventional radiology',
  'peds': 'pediatrics',
  'nicu': 'neonatology',
  'picu': 'pediatric critical care',
  'uro': 'urology',
  'derm': 'dermatology',
  'pm&r': 'physical medicine & rehab',
  'pmr': 'physical medicine & rehab',
  'rehab': 'physical medicine & rehab',
  'path': 'pathology',
  'ent': 'otolaryngology',
  'pain': 'pain management',
  'pain medicine': 'pain management',
  'sports med': 'sports medicine',
  'palliative': 'palliative care',
  'hospice': 'palliative care',
  'geriatrics': 'geriatric medicine',
  'occ med': 'occupational medicine',
  'np': 'np/pa (primary care)',
  'pa': 'np/pa (primary care)',
  'nurse practitioner': 'np/pa (primary care)',
  'physician assistant': 'np/pa (primary care)',
  'advanced practice': 'np/pa (primary care)',
  // NP credential shorthands — reachable from BOTH the field and freetext
  // paths (freetext otherwise priced 'pmhnp psychiatry' as a physician).
  'aprn': 'np/pa (primary care)',
  'fnp': 'np/pa (primary care)',
  'pmhnp': 'np/pa (psychiatry)',
  'nnp': 'np/pa (neonatology)',
  'acnp': 'np/pa (specialty)',
  'agacnp': 'np/pa (specialty)',
  'whnp': 'np/pa (specialty)',
  'neonatal np': 'np/pa (neonatology)',
  'nicu np': 'np/pa (neonatology)',
  'caa': 'anesthesiologist assistant',
  'certified anesthesiologist assistant': 'anesthesiologist assistant',
  'physiatrist': 'physical medicine & rehab',
  'physical medicine and rehabilitation': 'physical medicine & rehab',
  'tele-em': 'emergency medicine',
  'tele-emergency': 'emergency medicine',
  'tele-icu': 'critical care',
  'telecritical care': 'critical care',
  'telestroke': 'neurology',
  'tele-neurology': 'neurology',
  'teleradiology': 'radiology',
  'tele-radiology': 'radiology',
  'cath lab': 'interventional cardiology',
  'cardiac electrophysiology': 'electrophysiology',
  'breast surgery': 'general surgery',
  'internal medicine - critical care': 'critical care',
  'medicine - critical care': 'critical care',
  'im - critical care': 'critical care',
  'im/cc': 'critical care',
  'im/icu': 'critical care',
  'internal medicine - hospitalist': 'hospitalist',
  'medicine - hospitalist': 'hospitalist',
  'im - hospitalist': 'hospitalist',
  'internal medicine - pulmonary/critical care': 'critical care',
  'pulmonary critical care': 'critical care',
  'pulmonary/critical care': 'critical care',
  'pulmonary critical care medicine': 'critical care',
  'rei': 'reproductive endocrinology',
  'pediatrics - critical care': 'pediatric critical care',
  'pediatrics - hospitalist': 'pediatric hospitalist',
  'peds hospitalist': 'pediatric hospitalist',
  'emergency medicine - nocturnist': 'em nocturnist',
  'em/nocturnist': 'em nocturnist',
  'surgery - general': 'general surgery',
  'surgery - orthopedic': 'orthopedic surgery',
  'surgery - neuro': 'neurosurgery',
  'surgery - vascular': 'vascular surgery',
  'surgery - thoracic': 'thoracic surgery',
  'surgery - trauma': 'trauma surgery',
  'surgery - plastic': 'plastic surgery',
  'surgery - colorectal': 'colorectal surgery',
  'medicine - cardiology': 'cardiology',
  'medicine - gastroenterology': 'gastroenterology',
  'medicine - neurology': 'neurology',
  'medicine - pulmonology': 'pulmonology',
  'medicine - nephrology': 'nephrology',
  'medicine - endocrinology': 'endocrinology',
  'medicine - rheumatology': 'rheumatology',
  'medicine - infectious disease': 'infectious disease',
  'medicine - oncology': 'medical oncology',
  'medicine - hematology/oncology': 'hematology/oncology',
};
