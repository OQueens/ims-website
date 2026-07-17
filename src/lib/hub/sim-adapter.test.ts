import { describe, it, expect } from 'vitest';
import {
  factorsFromControls, quoteFromControls, quoteFromFactors,
  simParseAssignment, simParseFreetext, defaultControls,
  simSpecialtyOptions, simShiftOptions, simUrgencyOptions, simRegionOptions,
  simSpecialtyKeyForSlug, DEFAULT_SIM_SPECIALTY, type SimControls, type SimParseResult,
  billLadder, billAtMargin, marginFromCustomBill,
} from './sim-adapter';
import { SPECIALTIES, STATE_MULT, calculateRate, roundUp5 } from '../rate-engine/index';

const base = (o: Partial<SimControls> = {}): SimControls => ({ ...defaultControls(), ...o });

describe('sim-adapter — faithful bridge to the real engine', () => {
  it('builds full RateFactors from the hub controls (engine-neutral defaults)', () => {
    const f = factorsFromControls(base({ specialtyKey: 'crna', shift: 'night', urgency: 'Standard', weeks: 12 }));
    expect(f.specialty.key).toBe('crna');
    expect(f.shift.key).toBe('night');
    expect(f.facility.key).toBe('community'); // manual quotes default community / no-call / no-holiday
    expect(f.call.hasCall).toBe(false);
    expect(f.duration.key).toBe('standard');
  });

  it('throws (never silently zeroes) on an unknown specialty', () => {
    expect(() => factorsFromControls(base({ specialtyKey: 'not-a-specialty' }))).toThrow(/unknown specialty/);
  });

  it('the quote IS the engine output — payRate equals calculateRate(factors).payRate exactly', () => {
    // This is the whole point of the port: same engine, same path, same numbers
    // as the dashboard. No lossy re-derivation.
    const f = factorsFromControls(base({ specialtyKey: 'emergency medicine', region: 'South', shift: 'day' }));
    const q = quoteFromFactors(f, 25);
    expect(q.payRate).toBe(calculateRate(f).payRate);
    expect(q.isCallOnly).toBe(false);
  });

  it('C6: a frozen factor set re-quotes off the CURRENT spec.p70 after a live-market promotion (not the stale base)', () => {
    // Mirrors a parsed assignment whose baseRate was frozen (rateCalculator.ts:901 /
    // sim-adapter.ts:144 both freeze baseRate=spec.p70 at build time), BEFORE the
    // async market overlay promoted the cell. A re-quote must move the HERO (base),
    // not just the ceiling — the observed anchor is the whole point of the overlay.
    const key = 'radiology';
    const orig = { ...SPECIALTIES[key] };
    try {
      const f = factorsFromControls(base({ specialtyKey: key, region: 'National', shift: 'day', urgency: 'Standard' }));
      const before = quoteFromFactors(f, 22).payRate;
      // Overlay promotes the cell AFTER the factors were frozen (raise p70 + ceiling).
      SPECIALTIES[key].p70 = orig.p70 + 60;
      SPECIALTIES[key].max = Math.max(orig.max, SPECIALTIES[key].p70);
      const after = quoteFromFactors(f, 22).payRate;
      expect(after).toBeGreaterThan(before);
    } finally {
      Object.assign(SPECIALTIES[key], orig);
    }
  });

  it('C6 no-op guard: with spec.p70 unchanged, the refreshed quote is byte-identical to calculateRate(factors)', () => {
    // The refresh must not perturb the normal path — same value in, same value out.
    const f = factorsFromControls(base({ specialtyKey: 'psychiatry', region: 'National', shift: 'day' }));
    expect(quoteFromFactors(f, 22).payRate).toBe(calculateRate(f).payRate);
  });

  it('hero is the clinician PAY rate; bill is grossed up at the margin (roundUp5 invariant)', () => {
    const q = quoteFromControls(base({ specialtyKey: 'hospitalist', marginPct: 22 }));
    expect(q.payRate).toBeGreaterThan(0);
    expect(q.billRate).toBeGreaterThan(q.payRate);
    expect(q.marginPerHr).toBe(q.billRate - q.payRate);
    expect(q.billRate % 5).toBe(0);                       // roundUp5, like the dashboard BillRateCalculator
  });

  it('prices geography per-state via the region representative (West premium > Northeast discount)', () => {
    const west = quoteFromControls(base({ specialtyKey: 'hospitalist', region: 'West' }));
    const ne = quoteFromControls(base({ specialtyKey: 'hospitalist', region: 'Northeast' }));
    const nat = quoteFromControls(base({ specialtyKey: 'hospitalist', region: 'National' }));
    expect(west.payRate).toBeGreaterThanOrEqual(nat.payRate);
    expect(ne.payRate).toBeLessThan(west.payRate);
  });

  it('an exact state code (from a PDF) overrides the coarse region for geography', () => {
    const f = factorsFromControls(base({ specialtyKey: 'hospitalist', region: 'Northeast', stateCode: 'WY' }));
    expect(f.state.code).toBe('WY');                      // exact PDF state wins
  });

  it('builds a market-position bar + waterfall for the hourly path', () => {
    const q = quoteFromControls(base({ specialtyKey: 'anesthesiology', region: 'West', shift: 'night' }));
    expect(q.waterfall[0].label).toBe('Base');
    expect(q.waterfall.some((w) => w.label === 'Geography')).toBe(true);
    expect(q.marketMin).toBe(SPECIALTIES.anesthesiology.min);
    expect(q.marketMax).toBe(SPECIALTIES.anesthesiology.max);
    expect(q.percentiles.find((p) => p.p === 70)).toBeTruthy();
    expect(['High', 'Medium', 'Low']).toContain(q.confidence);
  });
});

describe('sim-adapter — LocumSmart PDF / freetext → full factors (dashboard-identical)', () => {
  const SAMPLE = [
    'Assignment Number: A-10293',
    'Specialty: Anesthesiology',
    'Status: Open',
    'HCO: Mountain Health',
    'Start Date: 01/06/2026',
    'End Date: 01/27/2026',
    'Facilities:',
    'Memorial Hospital - Casper (WY)',
    'Assignment Details:',
    'Schedule: Night shift',
  ].join('\n');

  it('parses specialty, exact state, shift + reflects them in the controls', () => {
    const r = simParseAssignment(SAMPLE) as SimParseResult;
    expect(r).not.toBeNull();
    expect(r.factors.specialty.key).toBe('anesthesiology');
    expect(r.factors.state.code).toBe('WY');
    expect(r.factors.shift.key).toBe('night');
    expect(r.controls.stateCode).toBe('WY');             // exact state retained for full-fidelity quote
    expect(r.controls.region).toBe('West');              // WY's region reflected on the button
    expect(r.controls.shift).toBe('night');
    expect(r.assignmentNumber).toBe('A-10293');
    expect(r.stateName).toBe('Wyoming');
  });

  it('the parsed factors quote through the engine (full fidelity, incl. the exact state geo)', () => {
    const r = simParseAssignment(SAMPLE) as SimParseResult;
    const q = quoteFromFactors(r.factors, 22);
    expect(q.payRate).toBe(calculateRate(r.factors).payRate); // identical to the dashboard
    expect(q.payRate).toBeGreaterThan(0);
  });

  it('freetext path mirrors the dashboard ("CRNA nights in Houston, TX")', () => {
    const r = simParseFreetext('CRNA nights in Houston, TX') as SimParseResult;
    expect(r).not.toBeNull();
    expect(r.factors.specialty.key).toBe('crna');
    expect(r.factors.state.code).toBe('TX');
    expect(r.factors.shift.key).toBe('night');
  });

  it('never asserts a default specialty: unresolved PDFs escalate (typed), unresolved freetext stays null', () => {
    // Contract change with resolver v2 (2026-07-13): the PDF path returns a
    // typed SimParseEscalation instead of null so the UI can name the phrase;
    // a quote is still never produced from the default sentinel.
    expect(simParseAssignment('')).toEqual({ escalated: true, unresolvedSpecialty: null });
    expect(simParseAssignment('unrelated prose, no fields here')).toEqual({ escalated: true, unresolvedSpecialty: null });
    expect(simParseFreetext('hello there')).toBeNull();
  });
});

describe('sim-adapter — call-only path stays honest', () => {
  it('surfaces insufficient public data instead of a fabricated number (CRNA call-only)', () => {
    // CRNA call-only daily is "insufficient public data" in the research — the
    // engine emits no fabricated daily; the quote must reflect that.
    const f = factorsFromControls(base({ specialtyKey: 'crna' }));
    f.callOnly = { isCallOnly: true, source: 'manual', reason: 'test' };
    f.dayType = { key: 'weekday', source: 'manual' };
    const q = quoteFromFactors(f, 22);
    expect(q.isCallOnly).toBe(true);
    expect(q.callOnly?.dayType).toBe('weekday'); // day-type carried for the honest surface
    if (q.callOnly?.insufficientData) {
      expect(q.payRate).toBe(0); // no fabricated stipend
    } else {
      expect(q.payRate).toBeGreaterThan(0);
    }
  });

  it('a parsed call-only assignment is flagged on SimParseResult so the UI never re-quotes it as hourly', () => {
    // Coverage Type: Call Only → engine detectCallOnly → isCallOnly must surface
    // so the hub renders the honest call-only surface, not a silent hourly quote.
    const CALL_PDF = [
      'Specialty: Cardiology',
      'Facilities:',
      'Regional Heart - Boise (ID)',
      'Assignment Details:',
      'Coverage Type: Call Only',
    ].join('\n');
    const r = simParseAssignment(CALL_PDF) as SimParseResult;
    expect(r).not.toBeNull();
    expect(r.isCallOnly).toBe(true);
    expect(r.factors.callOnly.isCallOnly).toBe(true);
  });

  it('a normal hourly assignment is NOT flagged call-only', () => {
    const r = simParseAssignment([
      'Specialty: Anesthesiology',
      'Facilities:',
      'Memorial - Casper (WY)',
      'Assignment Details:',
      'Schedule: Day shift',
    ].join('\n')) as SimParseResult;
    expect(r.isCallOnly).toBe(false);
  });

  it('FIDELITY: a parsed PDF must be quoted from its FULL factors, not the coarse controls', () => {
    // The PDF carries an academic facility (0.85) + on-call (1.10) that the coarse
    // region/shift/urgency controls CANNOT represent. Quoting from r.factors (the
    // engine path, dashboard-identical) MUST differ from quoting the lossy control
    // rebuild — proving the hub UI must render r.factors, not re-derive from controls.
    // (No state + general surgery keeps the result clear of the researched-max clamp
    // that would otherwise collapse both to spec.max and mask the difference.)
    const PDF = [
      'Specialty: General Surgery',
      'HCO: University Health',
      'Assignment Details:',
      'Practice Setting: Academic teaching hospital',
      'Call Type: On Call',
    ].join('\n');
    const r = simParseAssignment(PDF) as SimParseResult;
    expect(r.factors.facility.key).toBe('academic');
    expect(r.factors.call.hasCall).toBe(true);
    const full = quoteFromFactors(r.factors, 22).payRate;          // faithful (dashboard-identical)
    const lossy = quoteFromControls(r.controls).payRate;            // coarse-controls rebuild (drops academic+call)
    expect(full).not.toBe(lossy);                                   // proves the UI must quote from r.factors
    expect(full).toBeLessThan(lossy);                              // academic discount dominates the call premium here
  });
});

describe('sim-adapter — UI option metadata', () => {
  it('specialty options carry engine p70 + max', () => {
    for (const o of simSpecialtyOptions()) {
      expect(SPECIALTIES[o.key]).toBeDefined();
      expect(o.p70).toBe(SPECIALTIES[o.key].p70);
      expect(o.max).toBe(SPECIALTIES[o.key].max);
    }
  });

  it('region options carry the representative-state multiplier (National neutral, West premium)', () => {
    const regs = simRegionOptions();
    expect(regs.map((r) => r.key)).toEqual(['National', 'West', 'Midwest', 'Northeast', 'South']);
    expect(regs.find((r) => r.key === 'National')!.mult).toBe(1.0);
    const west = regs.find((r) => r.key === 'West')!;
    expect(west.repState).toBeTruthy();
    expect(west.mult).toBe(STATE_MULT[west.repState!]);
  });

  it('shift options ARE the engine SHIFT_MULT keys; urgency is the 3 sim levels', () => {
    expect(simShiftOptions().map((s) => s.key)).toEqual(['day', 'night', 'weekend_day', 'weekend_night', 'holiday']);
    expect(simUrgencyOptions().map((u) => u.key)).toEqual(['Standard', 'Priority', 'Emergent']);
  });

  it('defaultControls is calculable and pay-first', () => {
    const q = quoteFromControls(defaultControls());
    expect(SPECIALTIES[DEFAULT_SIM_SPECIALTY]).toBeDefined();
    expect(q.payRate).toBeGreaterThan(0);
    expect(q.billRate).toBeGreaterThan(q.payRate);
  });

  it('does NOT overstate confidence as High — curated bands cap at Medium post honesty-downgrade', () => {
    // Default first paint = anesthesiology / National (no state) → Medium (specialty
    // known, geography not). After the honesty downgrade (5d6ce34) no curated band is
    // 'high', so even WITH an identified state anesthesiology caps at Medium — static
    // 'High' is retired; only a corroborated live market posterior (the overlay) earns it.
    expect(quoteFromControls(defaultControls()).confidence).toBe('Medium');
    expect(quoteFromControls(base({ region: 'South' })).confidence).toBe('Medium'); // geo identified, data tier caps it
    expect(quoteFromControls(base({ stateCode: 'TX' })).confidence).toBe('Medium');
  });

  it('call-only bill is the dashboard fixed 20% margin, NOT the hourly slider', () => {
    // RateResults.tsx:236 — call-only heroBill = roundUp5(heroPay / 0.80), independent
    // of any hourly margin. Build a call-only quote for a specialty with researched bands.
    const f = factorsFromControls(base({ specialtyKey: 'ob/gyn' }));
    f.callOnly = { isCallOnly: true, source: 'manual', reason: null };
    f.dayType = { key: 'weekday', source: 'manual' };
    const at15 = quoteFromFactors(f, 15);
    const at45 = quoteFromFactors(f, 45);
    expect(at15.isCallOnly).toBe(true);
    expect(at15.payRate).toBeGreaterThan(0);                 // ob/gyn weekday is researched-sufficient
    expect(at15.billRate).toBe(roundUp5(at15.payRate / 0.80)); // fixed 20%, not 15%
    expect(at45.billRate).toBe(at15.billRate);               // hourly slider does NOT move the call-only bill
  });

  it('maps ims_jobs slugs onto real engine keys (never an invalid <option>)', () => {
    expect(simSpecialtyKeyForSlug('emergency-medicine')).toBe('emergency medicine');
    expect(simSpecialtyKeyForSlug('crna')).toBe('crna');
    expect(simSpecialtyKeyForSlug('general-surgery')).toBe('general surgery');
    expect(simSpecialtyKeyForSlug('ob-gyn')).toBe('ob/gyn');
    expect(simSpecialtyKeyForSlug('anesthesia')).toBe('anesthesiology');
    expect(simSpecialtyKeyForSlug('not-a-real-slug')).toBe(DEFAULT_SIM_SPECIALTY);
    for (const slug of ['emergency-medicine', 'crna', 'ob-gyn', 'radiology', 'hospitalist', 'zzz']) {
      expect(SPECIALTIES[simSpecialtyKeyForSlug(slug)]).toBeDefined();
    }
  });
});

// Faithful port of the dashboard's BillRateCalculator margin math (S4). Pure:
// roundUp5(pay/(1-markup)) — the engine invariant, never scale a pre-rounded
// value. Hourly path only (call-only keeps its own honest surface).
describe('sim-adapter — bill rate calculator (BillRateCalculator port)', () => {
  it('billLadder mirrors the dashboard markup ladder (11 hourly rows, REC 25-32)', () => {
    const rows = billLadder(400);
    expect(rows.map((r) => r.markup)).toEqual([20, 22, 24, 25, 27, 28, 30, 32, 35, 38, 40]);
    // billRate = roundUp5(pay/(1-markup/100)); profit = bill - pay
    expect(rows[0]).toMatchObject({ markup: 20, billRate: 500, profit: 100, rec: false }); // 400/.8=500
    expect(rows.find((r) => r.markup === 25)).toMatchObject({ billRate: 535, profit: 135, rec: true }); // 533.3→535
    expect(rows.find((r) => r.markup === 32)).toMatchObject({ rec: true });
    expect(rows.find((r) => r.markup === 40)).toMatchObject({ billRate: 670, rec: false }); // 666.6→670
    for (const r of rows) {
      expect(r.billRate % 5).toBe(0);
      expect(r.billRate).toBe(roundUp5(400 / (1 - r.markup / 100)));
      expect(r.rec).toBe(r.markup >= 25 && r.markup <= 32);
    }
  });

  it('billLadder rounds UP to $5 on a non-round pay (roundUp5 fires)', () => {
    // pay=387 is not a multiple of 5; every grossed-up bill must still land on a $5 step.
    const rows = billLadder(387);
    expect(rows.find((r) => r.markup === 25)).toMatchObject({ billRate: 520, profit: 133 }); // 387/.75=516→520
    expect(rows.find((r) => r.markup === 20)).toMatchObject({ billRate: 485 });               // 387/.8=483.75→485
    for (const r of rows) expect(r.billRate % 5).toBe(0);
  });

  it('billAtMargin grosses up + projects daily(10hr)/annual(2080hr), clamps to the slider band 15-45', () => {
    const m = billAtMargin(400, 25);
    expect(m.billRate).toBe(535);              // roundUp5(400/.75)
    expect(m.profitPerHr).toBe(135);
    expect(m.dailyProfit).toBe(1350);          // ×10hr shift
    expect(m.annualProfit).toBe(280800);       // ×2080hr
    expect(m.multiplier).toBeCloseTo(1 / 0.75, 5);
    expect(billAtMargin(400, 5).marginPct).toBe(15);   // clamp low
    expect(billAtMargin(400, 99).marginPct).toBe(45);  // clamp high
  });

  it('marginFromCustomBill reverses a typed bill rate to its margin (% of bill), invalid for <=0', () => {
    const c = marginFromCustomBill(400, 500);
    expect(c.valid).toBe(true);
    expect(c.marginPct).toBeCloseTo(20, 5);    // (500-400)/500*100
    expect(c.profit).toBe(100);
    expect(marginFromCustomBill(400, 0)).toMatchObject({ valid: false });
    expect(marginFromCustomBill(400, -50)).toMatchObject({ valid: false });
    expect(marginFromCustomBill(400, NaN)).toMatchObject({ valid: false });
  });
});

// =============================================================================
// Sol-N1 (Tier 1, 2026-07-10 accuracy audit): the DISPLAYED bill must never
// exceed a contractual hourly rate cap. The engine caps PAY at 0.80×cap
// (rateCalculator.ts hourly clamp), but the hub re-margins that pay at the
// slider margin — roundUp5(200/0.78)=$260 displayed against a $250 cap. The
// cap is a BILL cap (extractBillRateCap): every computed bill surface (main
// quote, markup ladder, margin slider, custom bill) must respect it. Pay stays
// EXACTLY the engine's output (parity invariant) — only the bill is clamped,
// and the clamp is surfaced (billCapApplied) so the UI can show the effective
// margin honestly.
// =============================================================================
describe('sim-adapter — Sol-N1 contractual bill cap', () => {
  // A parsed assignment carrying an hourly rate cap. Manual controls can't set
  // a cap (C3/C12) — the cap only ever arrives via PDF/freetext factors.
  const cappedFactors = (cap: number, unit: 'hour' | 'unknown' | 'day' | 'shift' = 'hour') => ({
    ...factorsFromControls(base({ specialtyKey: 'radiology', region: 'National', shift: 'day', urgency: 'Standard' })),
    rateCap: { cap, unit, source: `Rate Cap $${cap}`, hasWarning: false },
  });

  it('N1: displayed bill never exceeds the cap when the engine capped pay ($250 cap can NOT display $260)', () => {
    const f = cappedFactors(250);
    const q = quoteFromFactors(f, 22);
    // Premise: radiology's researched band sits above the cap → engine clamps pay to 0.80×250.
    expect(q.payRate).toBe(200);
    expect(q.payRate).toBe(calculateRate({ ...f, baseRate: SPECIALTIES.radiology.p70 }).payRate); // pay parity holds
    // The defect: bill was roundUp5(200/0.78)=$260 — above the contractual cap.
    expect(q.billRate).toBe(250);
    expect(q.billRate).toBeLessThanOrEqual(250);
    expect(q.billCapApplied).toBe(true);
    expect(q.billCap).toBe(250);
    expect(q.marginPerHr).toBe(50); // 250-200 — the honest (effective 20%) margin, not the slider's 22%
  });

  it('N1: cap clamps the bill even when the engine did NOT cap pay (high margin over-bills a sub-cap pay)', () => {
    const f = cappedFactors(400); // capPay 320 > radiology pay → engine pay untouched
    const q = quoteFromFactors(f, 35);
    expect(q.capped).toBe(false);               // engine never fired…
    expect(q.payRate).toBeGreaterThan(260);     // …but 35% margin on this pay busts the cap (pay/0.65 > 400)
    expect(q.payRate).toBeLessThan(320);
    expect(q.billRate).toBe(400);
    expect(q.billCapApplied).toBe(true);
  });

  it('N1: a margin that fits under the cap is untouched (clamp binds only past the cap)', () => {
    const f = cappedFactors(400);
    const q = quoteFromFactors(f, 20);
    expect(q.billRate).toBe(roundUp5(q.payRate / 0.80)); // ~360 < 400 → unclamped math
    expect(q.billRate).toBeLessThan(400);
    expect(q.billCapApplied).toBe(false);
    expect(q.billCap).toBe(400); // cap still surfaced for the ladder/slider tools
  });

  it('N1: the contractual number beats roundUp5 (a non-multiple-of-5 cap stays exact)', () => {
    const f = cappedFactors(248); // capPay 198.4 → engine pay 198; roundUp5(198/0.8)=250 > 248
    const q = quoteFromFactors(f, 20);
    expect(q.payRate).toBe(198);
    expect(q.billRate).toBe(248); // the cap itself — NOT rounded up past the contract
    expect(q.billCapApplied).toBe(true);
  });

  it('N1: no cap → behavior identical to before (billCap null, unclamped roundUp5 math)', () => {
    const q = quoteFromControls(base({ specialtyKey: 'radiology', marginPct: 22 }));
    expect(q.billCap).toBe(null);
    expect(q.billCapApplied).toBe(false);
    expect(q.billRate).toBe(roundUp5(q.payRate / 0.78));
  });

  it('N1: a day/shift-unit cap does NOT clamp the hourly bill (parity with the engine unit gate)', () => {
    // The engine only applies hour/unknown-unit caps on the hourly path; a daily
    // cap number is NOT an hourly bill bound (Tier 2 N7 owns unit honesty).
    const q = quoteFromFactors(cappedFactors(2000, 'day'), 22);
    expect(q.billCap).toBe(null);
    expect(q.billCapApplied).toBe(false);
    expect(q.billRate).toBe(roundUp5(q.payRate / 0.78));
  });

  it('N1: billLadder clamps every row to the cap and flags the clamped ones', () => {
    const rows = billLadder(400, 520);
    for (const r of rows) {
      expect(r.billRate).toBeLessThanOrEqual(520);
      expect(r.profit).toBe(r.billRate - 400);
    }
    expect(rows.find((r) => r.markup === 20)).toMatchObject({ billRate: 500, capped: false }); // under cap → untouched
    expect(rows.find((r) => r.markup === 25)).toMatchObject({ billRate: 520, capped: true });  // 535 → clamped
    expect(rows.find((r) => r.markup === 40)).toMatchObject({ billRate: 520, capped: true });  // 670 → clamped
  });

  it('N1: billLadder without a cap keeps the exact legacy rows (capped false everywhere)', () => {
    for (const r of billLadder(400)) {
      expect(r.billRate).toBe(roundUp5(400 / (1 - r.markup / 100)));
      expect(r.capped).toBe(false);
    }
  });

  it('N1: billAtMargin clamps to the cap and reports the EFFECTIVE multiplier', () => {
    const m = billAtMargin(400, 40, 520);
    expect(m.billRate).toBe(520);              // roundUp5(400/0.6)=670 → clamped
    expect(m.capped).toBe(true);
    expect(m.profitPerHr).toBe(120);
    expect(m.dailyProfit).toBe(1200);
    expect(m.annualProfit).toBe(249600);
    expect(m.multiplier).toBeCloseTo(1.3, 5);  // 520/400 — the effective markup, not 1/(1-0.40)
    const under = billAtMargin(400, 20, 520);
    expect(under).toMatchObject({ billRate: 500, capped: false });
    expect(under.multiplier).toBeCloseTo(1.25, 5);
  });

  it('N1: marginFromCustomBill flags a typed bill above the cap (overCap)', () => {
    expect(marginFromCustomBill(400, 600, 520)).toMatchObject({ valid: true, overCap: true });
    expect(marginFromCustomBill(400, 500, 520)).toMatchObject({ valid: true, overCap: false });
    expect(marginFromCustomBill(400, 600)).toMatchObject({ valid: true, overCap: false }); // no cap → never flags
  });

  it('N1: call-only quotes carry billCap null (per-diem cap honesty is Tier 2/N7 scope)', () => {
    const f = factorsFromControls(base({ specialtyKey: 'ob/gyn' }));
    f.callOnly = { isCallOnly: true, source: 'manual', reason: null };
    f.dayType = { key: 'weekday', source: 'manual' };
    const q = quoteFromFactors(f, 22);
    expect(q.isCallOnly).toBe(true);
    expect(q.billCap).toBe(null);
    expect(q.billCapApplied).toBe(false);
  });

  // ── Sol gate round 1 (2026-07-13) ──────────────────────────────────────────
  it('Sol-R1: a FRACTIONAL cap clamps to its exact value — never a rounded-up number above the contract', () => {
    // extractBillRateCap parseFloats "$187.50"-style caps; the clamped bill must
    // BE 187.50, not 188 (Math.round would display a forbidden number).
    const f = cappedFactors(187.5);
    const q = quoteFromFactors(f, 22);
    expect(q.payRate).toBe(150); // 0.80×187.5, engine Math.round
    expect(q.billRate).toBe(187.5); // exact — not 188, not 190
    expect(q.billCapApplied).toBe(true);
  });

  it('Sol-R1: the quote carries the cap UNIT and parse-warning state for honest rendering', () => {
    const hour = quoteFromFactors(cappedFactors(250, 'hour'), 22);
    expect(hour.billCapUnit).toBe('hour');
    expect(hour.billCapWarning).toBe(false);
    const unk = quoteFromFactors({
      ...cappedFactors(250, 'unknown'),
      rateCap: { cap: 250, unit: 'unknown', source: 'Rate Cap $250', hasWarning: true },
    }, 22);
    expect(unk.billCapUnit).toBe('unknown'); // engine treats unknown as hourly; UI must NOT assert "/hr"
    expect(unk.billCapWarning).toBe(true);
    const none = quoteFromControls(base({ specialtyKey: 'radiology' }));
    expect(none.billCapUnit).toBe(null);
    expect(none.billCapWarning).toBe(false);
  });

  it('Sol-R1: effectiveMarginPct is the TRUE (bill−pay)/bill margin, capped or not', () => {
    const capped = quoteFromFactors(cappedFactors(250), 22);
    expect(capped.effectiveMarginPct).toBeCloseTo(20, 5); // (250−200)/250 — not the slider 22
    const free = quoteFromControls(base({ specialtyKey: 'radiology', marginPct: 22 }));
    expect(free.effectiveMarginPct).toBeCloseTo(((free.billRate - free.payRate) / free.billRate) * 100, 5);
  });

  it('Sol-R1: billAtMargin exposes effectiveMarginPct (requested stays in marginPct)', () => {
    const m = billAtMargin(400, 40, 520);
    expect(m.marginPct).toBe(40);                       // requested (slider position)
    expect(m.effectiveMarginPct).toBeCloseTo((120 / 520) * 100, 5); // truth
    const u = billAtMargin(400, 25);
    expect(u.effectiveMarginPct).toBeCloseTo(((u.billRate - 400) / u.billRate) * 100, 5);
  });

  it('Sol-R1: a parsed $0 cap stays engine-parity IGNORED (falsy gate) — documented, full manual-review is N7 scope', () => {
    const f = { ...cappedFactors(250), rateCap: { cap: 0, unit: 'hour' as const, source: 'Rate Cap $0', hasWarning: false } };
    const q = quoteFromFactors(f, 22);
    expect(q.billCap).toBe(null); // engine rateCalculator.ts:689 `if (f.rateCap.cap && …)` ignores 0 the same way
    expect(q.billCapApplied).toBe(false);
  });

  it('Sol-R2: a cap MENTION with no usable amount keeps its warning (cap:null + hasWarning must reach the quote)', () => {
    // extractBillRateCap: "rate cap" text present but unparseable → {cap:null, unit:'unknown', hasWarning:true}.
    const f = { ...cappedFactors(250), rateCap: { cap: null, unit: 'unknown' as const, source: 'pdf', hasWarning: true } };
    const q = quoteFromFactors(f, 22);
    expect(q.billCap).toBe(null);            // nothing to clamp with…
    expect(q.billCapWarning).toBe(true);     // …but the ambiguity must not be erased (round-1 defect class)
  });
});

describe('escalation names the unrecognized phrase (resolver v2, Zach §6 2026-07-13)', () => {
  it('PDF path returns a typed escalation carrying the phrase the sheet named', () => {
    const text = ['Assignment Number: B-77120', 'Specialty: Radiation Oncology'].join('\n');
    expect(simParseAssignment(text)).toEqual({ escalated: true, unresolvedSpecialty: 'Radiation Oncology' });
  });

  it('PDF path escalates WITHOUT a phrase when the sheet named none', () => {
    expect(simParseAssignment('completely unstructured junk')).toEqual({ escalated: true, unresolvedSpecialty: null });
  });

  it('freetext with no recognizable specialty still returns null (structural failure, phrase already echoed by the UI)', () => {
    expect(simParseFreetext('oncology - radiation therapy in denver')).toBeNull();
  });
});
