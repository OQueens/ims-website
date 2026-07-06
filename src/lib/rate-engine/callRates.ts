// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// === CALL-ONLY / PER-DIEM DAILY RATES ===
// Source: docs/rate-simulator/call-rate-research-2026-06-03-deep-research.pdf
//   "Locum Tenens Call and Per-Diem Coverage Rates for Physicians and CRNAs"
//   (public 2024–2026 locum/1099 job postings, agency boards, public rate sheets;
//    28 source citations; extracted text committed alongside the PDF as .txt).
//
// FACTOR-05 (2026-06-03): replaced the prior FABRICATED single-point estimates
// with REAL observed bands. Cite-or-suppress — a day-type carries a real
// {min,max,typical} band traced to the research, OR it is `null` ("insufficient
// public data"). The engine NEVER fabricates a daily and NEVER derives a
// call-only daily from an hourly rate (the research is explicit that 24-hr
// hourly postings are not contract-equivalent to a day stipend, and that mixing
// unlike comp models — beeper-call vs worked clinical day vs callback — is the
// single biggest quality risk in this niche).
//
// Each band carries its comp-model + coverageHrs (24 for a beeper-call, the
// scheduled shift for a worked-day) so the display layer converts daily→$/hr
// against the honest denominator. `typical` is the multiplier base; `max` is the
// researched ceiling the engine clamps to.

import { SPECIALTIES } from './specialties';
import type { CallRateEntry, GsaRates, RateSourceEntry } from './types';

export type { CallRateEntry };

// Day-type band shorthand keeps the table readable: b(min,max,typical,model,hrs).
const beeper = (min: number, max: number, typical: number) =>
  ({ min, max, typical, compModel: '24hr-beeper-call' as const, coverageHrs: 24 });
const worked = (min: number, max: number, typical: number, coverageHrs: number) =>
  ({ min, max, typical, compModel: 'worked-day-clinic' as const, coverageHrs });

export const CALL_RATE_DATA: Record<string, CallRateEntry> = {
  // ===== Procedural and surgical specialties =====

  // OB/GYN — weekday is a WORKED-DAY clinic figure (2026 agency salary guide);
  // weekend is a 24-hr BEEPER-CALL posting. Different comp models — not comparable.
  'ob/gyn': {
    weekday: worked(3900, 4200, 4050, 12),
    weekend: beeper(1500, 1800, 1650),
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 2,
    category: 'OB/GYN',
    note: 'Weekday = worked-day clinic (2026 agency salary guide); weekend = 24-hr beeper-call. Weekend posting: no gratis, 4–8 callback hrs/shift.',
  },
  'maternal-fetal medicine': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'OB/GYN',
    note: 'No public 2024–2026 numeric day/callback disclosure found.',
  },

  'general surgery': {
    weekday: beeper(1500, 2500, 1850),
    weekend: beeper(1500, 2500, 1850),
    holiday: null,
    callback: { min: 325, max: 350 },
    gratisHrs: null,
    sources: 4,
    category: 'Surgery',
    note: 'Mostly 24-hr surgery-coverage postings; 2–4 gratis hrs before callback.',
  },
  'orthopedic surgery': {
    weekday: null, weekend: null, holiday: null,
    callback: { min: 450, max: 450 },
    gratisHrs: null,
    sources: 1,
    category: 'Surgery',
    note: 'Only a public agency callback differential ($450/hr) surfaced; no clean public day rate.',
  },
  'neurosurgery': {
    weekday: beeper(4200, 4800, 4500),
    weekend: beeper(4200, 4800, 4500),
    holiday: null,
    callback: { min: 475, max: 475 },
    gratisHrs: 4,
    sources: 2,
    category: 'Surgery',
    note: '24-hr beeper-call: Lancesoft $4,200 (OH) + Ascend $4,800 (AR) locum_1099 postings (DocCafe, 2026-06 audit, adversarially verified) bracket the prior single-point $4,000; 4 gratis hrs then callback applies.',
  },
  'vascular surgery': {
    weekday: beeper(2700, 3000, 2850),
    weekend: beeper(2700, 3000, 2850),
    holiday: null,
    callback: null,
    gratisHrs: 2,
    sources: 4,
    category: 'Surgery',
    note: 'Flat 24-hr coverage; ~2 gratis + ~2 callback hrs/day, but no public callback $.',
  },
  'trauma surgery': {
    weekday: beeper(2500, 2500, 2500),
    weekend: beeper(2500, 2500, 2500),
    holiday: null,
    callback: { min: 350, max: 350 },
    gratisHrs: 4,
    sources: 1,
    category: 'Surgery',
    note: 'Single-point 24-hr locum trauma-surgery post; 4 gratis hrs.',
  },
  'thoracic surgery': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Surgery',
    note: 'No public 2024–2026 numeric day/callback disclosure found.',
  },
  'colorectal surgery': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Surgery',
    note: 'No public 2024–2026 numeric day/callback disclosure found.',
  },
  'plastic surgery': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Surgery',
    note: 'No public 2024–2026 numeric day/callback disclosure found.',
  },
  'pediatric surgery': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Surgery',
    note: 'Schedules surfaced, but no usable public numeric day/callback amounts.',
  },
  'surgical oncology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Surgery',
    note: 'No public 2024–2026 numeric day/callback disclosure found.',
  },

  // ===== Emergency =====
  'emergency medicine': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Emergency',
    note: 'Public EM locum pay is usually posted hourly; no daily call/per-diem disclosure found.',
  },

  // ===== Anesthesia =====
  'anesthesiology': {
    weekday: worked(2675, 3900, 3300, 12),
    weekend: null,
    holiday: null,
    callback: { min: 400, max: 500 },
    gratisHrs: null,
    sources: 3,
    category: 'Anesthesia',
    note: 'Worked-day 12-hr band, all cited: Aya $2,675 (floor), Bright Line $3,300/12h (modal), AnesthesiaOnCall $300-325/hr (~$3,900 ceiling) — 2026-06 audit, adversarially verified; conservatively preserves the Aya floor rather than dropping it. locums.one $4,800-5,400 excluded as marketing. Public holiday $450/hr is an hourly premium, not a daily stipend.',
  },
  'crna': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 2, category: 'Anesthesia',
    adjacentHourly: { min: 200, max: 325 },
    note: 'Public 1099 CRNA rate sheets at $200–325/hr; no clean public day-level call/callback structure published.',
  },
  'cardiac anesthesiology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 1, category: 'Anesthesia',
    note: 'Public 2026 salary guide: cardiac anesthesia with call pushes above $450/hr; no daily call/per-diem breakdown published.',
  },
  'obstetric anesthesiology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 1, category: 'Anesthesia',
    note: 'Public 2026 salary guide: OB anesthesia with call pushes above $450/hr; no daily breakdown published.',
  },
  'pediatric anesthesiology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Anesthesia',
    note: 'No public 2024–2026 day/callback amounts found.',
  },

  // ===== Primary Care / hospital-based =====
  'internal medicine': {
    weekday: worked(1380, 1560, 1470, 12),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 1,
    category: 'Primary Care',
    note: 'Derived from explicit hourly pay + fixed 12-hr schedule; single-point.',
  },
  'hospitalist': {
    weekday: worked(2040, 2400, 2370, 12),
    weekend: worked(2340, 2400, 2370, 12),
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 1,
    category: 'Primary Care',
    note: 'Derived from Aya hourly + fixed 12-hr shifts; weekend from a 7×12 all-week schedule (no separate weekend premium).',
  },
  'family medicine': {
    weekday: worked(920, 1650, 1285, 9),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 2,
    category: 'Primary Care',
    note: 'Derived from explicit hourly + fixed 8/10-hr clinic schedules; no robust modal quote.',
  },

  // ===== Critical Care =====
  'critical care': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Critical Care',
    note: 'Combined pulmonary/critical-care hourly examples surfaced, but no clean stand-alone critical-care daily/callback breakdown.',
  },

  // ===== Medical Specialties =====
  'pulmonology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Medical Specialties',
    note: 'Public numeric examples were largely pulmonary/critical-care combined, not clean pulmonology-only.',
  },
  // Cardiology — research mixed a worked-day inpatient quote ($3,200/day) and a
  // call-only beeper quote ($2,500/day + $350 callback). DIFFERENT comp models:
  // the call-only engine uses ONLY the beeper figure ($2,500), so the band max is
  // $2,500 — NOT $3,200 (that worked-day figure would price a beeper $/hr off a
  // worked-day daily, the exact comp-model mixing the research warns against). The
  // $3,200 worked-day is preserved in the note as context, never as a quote ceiling.
  'cardiology': {
    weekday: beeper(2500, 2500, 2500),
    weekend: beeper(2500, 2500, 2500),
    holiday: null,
    callback: { min: 350, max: 350 },
    gratisHrs: null,
    sources: 2,
    category: 'Medical Specialties',
    note: 'Call-only beeper $2,500/day + $350 callback (~20% callback average, Scranton posting). A separate worked-day inpatient quote of $3,200/day exists but is a different comp model — not applied to call-only.',
  },
  'interventional cardiology': {
    weekday: beeper(3000, 3000, 3000),
    weekend: beeper(3000, 3000, 3000),
    holiday: null,
    callback: null,
    gratisHrs: 10,
    sources: 3,
    category: 'Medical Specialties',
    note: 'Single-point public call rate; one posting reported 10 gratis hrs/24-hr shift.',
  },
  'gastroenterology': {
    weekday: beeper(3500, 3700, 3500),
    weekend: beeper(3500, 3700, 3700),
    holiday: null,
    callback: { min: 375, max: 375 },
    gratisHrs: 4,
    sources: 2,
    category: 'Medical Specialties',
    note: 'Strongest public GI call data in the set; 4 gratis hrs on 24-hr call.',
  },
  'nephrology': {
    weekday: worked(1320, 1440, 1380, 12),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 2,
    category: 'Medical Specialties',
    note: 'Exact public day-rate posting (PA); clinic+call, but callback/activation $ not published.',
  },
  'neurology': {
    weekday: worked(1800, 3500, 2750, 10),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 3,
    category: 'Medical Specialties',
    note: 'Worked-day clinical band: TheLocumGuy $2,500-3,000/day, Barton ~$250/hr x10h, SDN inpatient $2,500-3,500/shift (2026-06 audit, 3 independent families, adversarially verified); $1,800 outpatient floor retained.',
  },
  'otolaryngology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Medical Specialties',
    note: 'Public call-volume postings surfaced, but no usable public day-rate or callback-dollar disclosures.',
  },

  // ===== Other Specialties =====
  'urology': {
    weekday: beeper(2500, 3500, 3150),
    weekend: beeper(2500, 3000, 3000),
    holiday: null,
    callback: { min: 350, max: 450 },
    gratisHrs: 4,
    sources: 5,
    category: 'Other Specialties',
    note: 'Best-supported public urology call market in the set; 4 gratis hrs before callback.',
  },
  'psychiatry': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 2, category: 'Psychiatry',
    adjacentHourly: { min: 200, max: 260 },
    note: 'Public psychiatry locum hourly ~$200–260/hr; no clean day/callback breakdown without assumptions.',
  },
  'pathology': {
    weekday: worked(1480, 1720, 1600, 8),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 2,
    category: 'Other Specialties',
    note: 'Derived from explicit hourly + fixed 8-hr day schedules; no robust modal quote.',
  },

  // ===== Pediatrics =====
  'pediatrics': {
    weekday: worked(1080, 2400, 1740, 12),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 1,
    category: 'Pediatrics',
    note: 'Two single-point exact Aya daily postings; no weekend differential or callback $ posted.',
  },
  'neonatology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 1, category: 'Pediatrics',
    adjacentHourly: { min: 200, max: 220 },
    note: 'Public $200–220/hr on 24-hr shifts; not converted to daily (24-hr contracts blend active + call).',
  },
  'pediatric critical care': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Pediatrics',
    note: 'No clean public 2024–2026 specialty-specific numeric day/callback disclosure found.',
  },
  'pediatric cardiology': {
    weekday: null, weekend: null, holiday: null, callback: null, gratisHrs: null,
    sources: 0, category: 'Pediatrics',
    note: 'No clean public 2024–2026 specialty-specific numeric day/callback disclosure found.',
  },

  // ===== Radiology =====
  'radiology': {
    weekday: worked(1300, 3200, 1400, 10),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 4,
    category: 'Radiology',
    note: 'Exact Aya diagnostic-radiology day-rates; weekend-specific differentials not public.',
  },
  'interventional radiology': {
    weekday: worked(3900, 4000, 3950, 10),
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 2,
    category: 'Radiology',
    note: 'Exact public daily IR posting (Augusta, GA); $525–550/hr fixed 8-hr shifts excluded to avoid mixing exact day rates with derived equivalents.',
  },
};

/**
 * Return the real call-rate entry for a specialty, or an all-insufficient entry
 * when the specialty has no public call data. NEVER derives a call-only daily
 * from an hourly rate (cite-or-suppress) — the prior hourly→daily fallback
 * fabricated stipends the research explicitly says cannot be derived that way.
 */
export function getCallRateEntry(specKey: string): CallRateEntry {
  const entry = CALL_RATE_DATA[specKey];
  if (entry) return entry;
  const spec = SPECIALTIES[specKey];
  return {
    weekday: null,
    weekend: null,
    holiday: null,
    callback: null,
    gratisHrs: null,
    sources: 0,
    category: spec?.category || 'Other',
    adjacentHourly: null,
    note: 'No public call-only rate data for this specialty.',
  };
}

// === GSA PER DIEM (FY2026) ===
export const GSA_STANDARD: GsaRates = { lodging: 110, mie: 68, total: 178 };

export const GSA_OVERRIDES: Record<string, GsaRates> = {
'tucson,az':{lodging:171,mie:80,total:251},'phoenix,az':{lodging:229,mie:86,total:315},'scottsdale,az':{lodging:229,mie:86,total:315},'sedona,az':{lodging:274,mie:92,total:366},'flagstaff,az':{lodging:144,mie:80,total:224},'sahuarita,az':{lodging:171,mie:80,total:251},
'san francisco,ca':{lodging:272,mie:92,total:364},'los angeles,ca':{lodging:191,mie:86,total:277},'san diego,ca':{lodging:237,mie:86,total:323},'san jose,ca':{lodging:192,mie:92,total:284},'sacramento,ca':{lodging:150,mie:86,total:236},'santa monica,ca':{lodging:273,mie:92,total:365},
'santa barbara,ca':{lodging:262,mie:92,total:354},'monterey,ca':{lodging:279,mie:92,total:371},'napa,ca':{lodging:246,mie:92,total:338},'oakland,ca':{lodging:145,mie:92,total:237},'palm springs,ca':{lodging:186,mie:86,total:272},'fresno,ca':{lodging:129,mie:86,total:215},
'bakersfield,ca':{lodging:132,mie:74,total:206},'santa cruz,ca':{lodging:176,mie:86,total:262},'denver,co':{lodging:215,mie:92,total:307},'colorado springs,co':{lodging:168,mie:86,total:254},'boulder,co':{lodging:173,mie:80,total:253},'fort collins,co':{lodging:140,mie:80,total:220},
'aspen,co':{lodging:407,mie:92,total:499},'hartford,ct':{lodging:138,mie:80,total:218},'new haven,ct':{lodging:130,mie:80,total:210},'bridgeport,ct':{lodging:146,mie:86,total:232},'washington,dc':{lodging:276,mie:92,total:368},
'miami,fl':{lodging:180,mie:74,total:254},'orlando,fl':{lodging:169,mie:80,total:249},'tampa,fl':{lodging:200,mie:80,total:280},'fort lauderdale,fl':{lodging:224,mie:86,total:310},'key west,fl':{lodging:436,mie:86,total:522},'naples,fl':{lodging:314,mie:80,total:394},
'sarasota,fl':{lodging:205,mie:86,total:291},'jacksonville,fl':{lodging:131,mie:74,total:205},'tallahassee,fl':{lodging:138,mie:80,total:218},'fort myers,fl':{lodging:216,mie:80,total:296},'daytona beach,fl':{lodging:157,mie:80,total:237},'pensacola,fl':{lodging:190,mie:74,total:264},
'atlanta,ga':{lodging:197,mie:86,total:283},'savannah,ga':{lodging:176,mie:80,total:256},'augusta,ga':{lodging:125,mie:74,total:199},'honolulu,hi':{lodging:210,mie:79,total:289},'boise,id':{lodging:114,mie:68,total:182},'chicago,il':{lodging:234,mie:92,total:326},
'indianapolis,in':{lodging:133,mie:80,total:213},'des moines,ia':{lodging:110,mie:68,total:178},'louisville,ky':{lodging:113,mie:68,total:181},'new orleans,la':{lodging:179,mie:80,total:259},'baton rouge,la':{lodging:110,mie:68,total:178},
'baltimore,md':{lodging:150,mie:86,total:236},'annapolis,md':{lodging:161,mie:80,total:241},'boston,ma':{lodging:349,mie:92,total:441},'worcester,ma':{lodging:135,mie:80,total:215},'detroit,mi':{lodging:152,mie:74,total:226},'ann arbor,mi':{lodging:146,mie:80,total:226},
'grand rapids,mi':{lodging:119,mie:80,total:199},'minneapolis,mn':{lodging:148,mie:92,total:240},'rochester,mn':{lodging:127,mie:80,total:207},'duluth,mn':{lodging:220,mie:86,total:306},'jackson,ms':{lodging:110,mie:68,total:178},
'st louis,mo':{lodging:150,mie:86,total:236},'kansas city,mo':{lodging:135,mie:80,total:215},'omaha,ne':{lodging:110,mie:68,total:178},'las vegas,nv':{lodging:159,mie:86,total:245},'reno,nv':{lodging:184,mie:80,total:264},'newark,nj':{lodging:156,mie:86,total:242},
'albuquerque,nm':{lodging:110,mie:68,total:178},'new york,ny':{lodging:342,mie:92,total:434},'manhattan,ny':{lodging:342,mie:92,total:434},'albany,ny':{lodging:117,mie:86,total:203},'buffalo,ny':{lodging:139,mie:80,total:219},'rochester,ny':{lodging:132,mie:80,total:212},'syracuse,ny':{lodging:122,mie:80,total:202},
'charlotte,nc':{lodging:131,mie:80,total:211},'raleigh,nc':{lodging:131,mie:74,total:205},'durham,nc':{lodging:121,mie:74,total:195},'asheville,nc':{lodging:141,mie:80,total:221},'wilmington,nc':{lodging:147,mie:74,total:221},
'columbus,oh':{lodging:131,mie:80,total:211},'cleveland,oh':{lodging:159,mie:80,total:239},'cincinnati,oh':{lodging:163,mie:86,total:249},'dayton,oh':{lodging:115,mie:74,total:189},
'oklahoma city,ok':{lodging:110,mie:68,total:178},'tulsa,ok':{lodging:110,mie:68,total:178},'portland,or':{lodging:155,mie:86,total:241},'eugene,or':{lodging:192,mie:80,total:272},'bend,or':{lodging:192,mie:86,total:278},
'philadelphia,pa':{lodging:218,mie:92,total:310},'pittsburgh,pa':{lodging:138,mie:80,total:218},'harrisburg,pa':{lodging:124,mie:74,total:198},'providence,ri':{lodging:154,mie:80,total:234},
'charleston,sc':{lodging:288,mie:92,total:380},'columbia,sc':{lodging:115,mie:74,total:189},'hilton head,sc':{lodging:215,mie:80,total:295},
'nashville,tn':{lodging:248,mie:86,total:334},'memphis,tn':{lodging:129,mie:74,total:203},'knoxville,tn':{lodging:119,mie:74,total:193},'chattanooga,tn':{lodging:117,mie:74,total:191},
'dallas,tx':{lodging:191,mie:80,total:271},'houston,tx':{lodging:128,mie:80,total:208},'austin,tx':{lodging:187,mie:80,total:267},'san antonio,tx':{lodging:161,mie:74,total:235},'fort worth,tx':{lodging:181,mie:80,total:261},'el paso,tx':{lodging:110,mie:68,total:178},
'salt lake city,ut':{lodging:142,mie:80,total:222},'park city,ut':{lodging:483,mie:92,total:575},'richmond,va':{lodging:157,mie:80,total:237},'norfolk,va':{lodging:113,mie:68,total:181},'virginia beach,va':{lodging:210,mie:74,total:284},'charlottesville,va':{lodging:136,mie:80,total:216},
'seattle,wa':{lodging:248,mie:92,total:340},'spokane,wa':{lodging:126,mie:86,total:212},'milwaukee,wi':{lodging:140,mie:80,total:220},'madison,wi':{lodging:138,mie:80,total:218},'anchorage,ak':{lodging:136,mie:69,total:205},'birmingham,al':{lodging:110,mie:68,total:178},'little rock,ar':{lodging:110,mie:68,total:178},
};

// === RATE DATA SOURCE REGISTRY ===
// Used by Rate Intelligence panel to show data provenance
export const RATE_SOURCES: Record<string, RateSourceEntry> = {
  specialty: { name: 'Specialty Base Rates', sources: ['LocumStory 2025', 'AMN Healthcare', 'Barton Associates', 'CompHealth', 'Weatherby Healthcare', 'Sermo', 'Doximity 2025', 'Medscape 2025', 'CHG Healthcare', 'ZipRecruiter'], year: '2025-2026', count: 30 },
  state: { name: 'State Multipliers', sources: ['BEA Regional Price Parities 2022', 'AAMC Physician Workforce 2022', 'HRSA HPSA Data 2024'], year: '2022-2024', count: 3 },
  shift: { name: 'Shift Differentials', sources: ['CompHealth', 'Weatherby Healthcare', 'Nocturnist salary surveys'], year: '2024-2025', count: 5 },
  facility: { name: 'Facility Type Adjustments', sources: ['CMS ASC vs HOPD payment data', 'CMS Critical Access designation', 'VA pay scales', 'AMN Healthcare placement data', 'Academic medical center surveys', 'HFMA ASC reimbursement analysis'], year: '2024-2026', count: 12 },
  gsa: { name: 'Travel Stipends', sources: ['GSA Per Diem Rates FY2026'], year: 'FY2026', count: 1 },
};
