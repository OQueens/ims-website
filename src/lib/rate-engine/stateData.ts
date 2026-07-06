// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// === STATE MULTIPLIERS ===
// Data-derived geographic adjustment factors for locum tenens rates.
// Computed from three inputs: cost of living (inverse), physician shortage, and demand classification.
// Higher values = more shortage/rural = higher pay premiums.
// Formula: clamp( (avgCOLI/stateCOLI)^0.30 * (avgDensity/stateDensity)^0.30 * demandWeight^0.40, 0.88, 1.38 )
// Recalculated at build time from STATE_COLI, STATE_PHYS_DENSITY, and STATE_DEMAND_CLASS below.

// Derived at module load — see deriveStateMultipliers() at bottom of file
export let STATE_MULT: Record<string, number> = {};

// === STATE NAMES ===
export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

// === Bureau of Economic Analysis — Regional Price Parities (2024, latest annual release) ===
// Measures relative price levels across states. US average = 100.
// Source: bea.gov/data/prices-inflation/regional-price-parities-state-and-metro-area
// Release: BEA SARPP table, RPP All Items (LineCode 1), state level, 2024 column.
//          Inner CSV file-stamp 2026-02-11 (BEA renamed inner file from SARPP.csv to
//          SARPP_STATE_2008_2024.csv vs Phase 3 step 1 plan §2a.1 expectation).
// Raw artifact: scripts/data-refresh/raw/bea-rpp-2024.csv
export const STATE_COLI: Record<string, number> = {
  AL: 88.823, AK: 102.359, AZ: 100.677, AR: 86.937, CA: 110.72, CO: 103.052, CT: 103.61, DE: 99.808,
  DC: 109.901, FL: 103.414, GA: 96.293, HI: 109.951, ID: 95.494, IL: 99.958, IN: 93.329, IA: 87.762,
  KS: 90.068, KY: 90.159, LA: 88.207, ME: 97.05, MD: 104.959, MA: 105.757, MI: 96.217, MN: 98.621,
  MS: 86.953, MO: 90.817, MT: 94.645, NE: 90.103, NV: 99.979, NH: 104.165, NJ: 108.805, NM: 92.212,
  NY: 107.921, NC: 94.326, ND: 88.959, OH: 92.774, OK: 87.843, OR: 103.361, PA: 97.572, RI: 102.28,
  SC: 93.749, SD: 88.586, TN: 91.87, TX: 97.057, UT: 98.864, VT: 97.958, VA: 101.104, WA: 107.013,
  WV: 89.497, WI: 94.095, WY: 92.691,
};

// === HRSA Area Health Resources File — State-Level Physician Density (2024-2025 release) ===
// Physician/SOC-occupation estimate per 100K population, state level
// (per HRSA AHRF state-level layer methodology — ACS 5-Year PUMS, NOT AMA PPD's
// "active patient care" filter).
// Lower density = greater shortage = higher locum demand premium.
// Source: data.hrsa.gov/topics/health-workforce/ahrf
// Release: AHRF 2024-2025 State + National Data extract; data-as-of 2026-01-29
//          (topic-page update); inner CSV file-stamp 2025-09-24.
// Underlying data source: ACS 5-Year Public Use Microdata Sample (PUMS),
//                         U.S. Census Bureau (state-level layer).
//                         ACS PUMS rolling window: 2019-2023 pooled estimate
//                         (the "2023 release" label means the latest year in
//                         the pooled window, NOT a single-year 2023 sample).
// Workforce filter: individuals aged 16+ who worked within the previous five years
//                   in a SOC physician occupation (2018 SOC system).
// Raw artifact:   scripts/data-refresh/raw/AHRF_SN_2024-2025_CSV.zip (SHA-256 in DRIFT-LOG)
// Tech docs ZIP:  scripts/data-refresh/raw/AHRF_SN_USER_TECH_2024-2025.zip
//                 (User Guide.docx + Technical Documentation.xlsx + Crosswalk.xlsx + Whats-New.pdf)
// Definitions PDF: https://data.hrsa.gov/Content/Documents/topics/AHRF Definition.pdf
//                  (separate file from tech-docs ZIP; methodology source)
//
// Methodology shift (Phase 3 step 1.6, 2026-05-01): AMA PPD via AAMC 2022
// (roster, "active patient care" filter) → ACS 5-Year PUMS via HRSA AHRF
// state-level (survey, broader 16+/past-5-yr SOC filter). See ADR
// docs/rate-simulator/ADR-PHASE-3-STEP-1.5-AAMC-SOURCE-MIGRATION.md and
// DRIFT-LOG Commit 4 (docs/rate-simulator/PHASE-3-STEP-1-DRIFT-LOG.md) for
// the 3-axis drift attribution (methodology / vintage / workforce-definition).
// Note: AMA PPD still feeds HRSA AHRF county-level data, but the simulator
// consumes state-level only — so this migration is a real methodology shift.
// Locum rate quotes from before/after step 1.6 are NOT directly comparable as
// a time series — the underlying metric definition changed.
export const STATE_PHYS_DENSITY: Record<string, number> = {
  AL: 246, AK: 294, AZ: 251, AR: 214, CA: 294, CO: 323, CT: 395, DE: 336, DC: 958,
  FL: 294, GA: 254, HI: 397, ID: 201, IL: 307, IN: 235, IA: 266, KS: 221, KY: 226,
  LA: 264, ME: 312, MD: 365, MA: 479, MI: 311, MN: 298, MS: 201, MO: 286, MT: 295,
  NE: 273, NV: 191, NH: 320, NJ: 321, NM: 258, NY: 445, NC: 291, ND: 288, OH: 338,
  OK: 263, OR: 359, PA: 363, RI: 395, SC: 278, SD: 313, TN: 291, TX: 249, UT: 266,
  VT: 365, VA: 291, WA: 317, WV: 303, WI: 262, WY: 166,
};

// US average physicians per 100K — population-weighted national density:
// sum(per-state count) / sum(per-state population) * 100_000
// = 1,010,166 / 332,387,543 * 100_000 = 304.
// Population-weighted, NOT unweighted 51-state mean (which would be 308) — matches
// the AAMC 2022 baseline value of 263 which was also population-weighted. Unweighted
// would distort every STATE_MULT via the densityRatio = NATIONAL_AVG_DENSITY / density
// term in deriveStateMultipliers().
export const NATIONAL_AVG_DENSITY = 304;

// === Locum Demand Classification by State ===
// Derived from: HRSA HPSA designations, rural hospital density, physician age demographics
// Categories: critical (severe shortage), high, moderate, adequate, surplus
// This is the PRIMARY driver of state multipliers — shortage states pay locum premiums
export type DemandClass = 'critical' | 'high' | 'moderate' | 'adequate' | 'surplus';

export const STATE_DEMAND_CLASS: Record<string, DemandClass> = {
  AL: 'high', AK: 'critical', AZ: 'moderate', AR: 'critical', CA: 'adequate', CO: 'moderate',
  CT: 'adequate', DE: 'moderate', DC: 'surplus', FL: 'moderate', GA: 'high', HI: 'moderate',
  ID: 'critical', IL: 'moderate', IN: 'high', IA: 'high', KS: 'high', KY: 'high',
  LA: 'high', ME: 'moderate', MD: 'adequate', MA: 'surplus', MI: 'high', MN: 'moderate',
  MS: 'critical', MO: 'high', MT: 'high', NE: 'moderate', NV: 'high', NH: 'moderate',
  NJ: 'adequate', NM: 'high', NY: 'adequate', NC: 'moderate', ND: 'moderate', OH: 'high',
  OK: 'high', OR: 'moderate', PA: 'moderate', RI: 'adequate', SC: 'high', SD: 'high',
  TN: 'high', TX: 'high', UT: 'high', VT: 'moderate', VA: 'moderate', WA: 'moderate',
  WV: 'critical', WI: 'moderate', WY: 'critical',
};

export const DEMAND_WEIGHTS: Record<DemandClass, number> = {
  critical: 1.30,
  high: 1.15,
  moderate: 1.05,
  adequate: 0.95,
  surplus: 0.90,
};

// === METRO CITIES ===
export const METRO_CITIES: ReadonlySet<string> = new Set([
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio',
  'san diego', 'dallas', 'san jose', 'austin', 'jacksonville', 'fort worth', 'columbus',
  'charlotte', 'indianapolis', 'san francisco', 'seattle', 'denver', 'washington', 'nashville',
  'oklahoma city', 'el paso', 'boston', 'portland', 'las vegas', 'memphis', 'louisville',
  'baltimore', 'milwaukee', 'albuquerque', 'tucson', 'fresno', 'mesa', 'sacramento', 'atlanta',
  'kansas city', 'colorado springs', 'omaha', 'raleigh', 'virginia beach', 'long beach', 'miami',
  'oakland', 'minneapolis', 'tulsa', 'tampa', 'arlington', 'new orleans', 'wichita', 'cleveland',
  'bakersfield', 'aurora', 'anaheim', 'honolulu', 'santa ana', 'riverside', 'corpus christi',
  'lexington', 'stockton', 'st louis', 'pittsburgh', 'anchorage', 'cincinnati', 'henderson',
  'greensboro', 'plano', 'newark', 'lincoln', 'orlando', 'irvine', 'toledo', 'jersey city',
  'chula vista', 'durham', 'laredo', 'madison', 'gilbert', 'lubbock', 'st petersburg', 'norfolk',
  'reno', 'winston-salem', 'glendale', 'hialeah', 'garland', 'scottsdale', 'irving', 'chesapeake',
  'north las vegas', 'fremont', 'baton rouge', 'richmond', 'boise', 'san bernardino', 'birmingham',
  'spokane', 'rochester', 'des moines', 'montgomery', 'modesto', 'fayetteville', 'tacoma',
  'shreveport', 'fontana', 'moreno valley', 'akron', 'yonkers', 'worcester', 'salt lake city',
  'little rock', 'huntsville', 'grand rapids', 'amarillo', 'tallahassee', 'oxnard', 'knoxville',
  'tempe', 'bridgeport', 'chattanooga', 'dayton', 'fort lauderdale', 'savannah', 'sioux falls',
  'charleston', 'fort wayne', 'mobile', 'columbia', 'eugene', 'mcallen', 'joliet', 'providence',
  'palm bay', 'detroit', 'pasadena', 'pomona', 'ontario', 'murfreesboro',
]);

// === DERIVE STATE MULTIPLIERS FROM DATA ===
// Uses COLI (inverse — cheap states get premium), physician density (inverse — shortage = premium),
// and demand classification (direct) to compute a single geographic multiplier per state.
// Exponents control sensitivity: higher = more weight on that factor.
const AVG_COLI = 100; // National baseline

function deriveStateMultipliers(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const code of Object.keys(STATE_COLI)) {
    const coli = STATE_COLI[code];
    const density = STATE_PHYS_DENSITY[code];
    const demandClass = STATE_DEMAND_CLASS[code];
    if (!coli || !density || !demandClass) continue;

    const demandWeight = DEMAND_WEIGHTS[demandClass];

    // Each factor: ratio > 1 means state needs higher locum premium
    const coliRatio = AVG_COLI / coli;                    // Low cost → high ratio → premium
    const densityRatio = NATIONAL_AVG_DENSITY / density;   // Low density → high ratio → premium

    // Geometric mean with exponent weighting
    // COLI: 0.30 weight — cost of living matters but isn't dominant
    // Density: 0.30 weight — physician shortage is equally important
    // Demand: 0.40 weight — actual demand classification is most predictive
    const raw = Math.pow(coliRatio, 0.30) * Math.pow(densityRatio, 0.30) * Math.pow(demandWeight, 0.40);

    // Clamp to realistic range: 0.88 (surplus metro) to 1.38 (critical shortage rural)
    result[code] = Math.round(Math.min(Math.max(raw, 0.88), 1.38) * 100) / 100;
  }
  return result;
}

// Initialize on module load
STATE_MULT = deriveStateMultipliers();
