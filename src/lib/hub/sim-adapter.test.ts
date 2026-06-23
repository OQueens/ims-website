import { describe, it, expect } from 'vitest';
import {
  factorsFromControls, quoteFromControls, quoteFromFactors,
  simParseAssignment, simParseFreetext, defaultControls,
  simSpecialtyOptions, simShiftOptions, simUrgencyOptions, simRegionOptions,
  simSpecialtyKeyForSlug, DEFAULT_SIM_SPECIALTY, type SimControls,
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
    const r = simParseAssignment(SAMPLE)!;
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
    const r = simParseAssignment(SAMPLE)!;
    const q = quoteFromFactors(r.factors, 22);
    expect(q.payRate).toBe(calculateRate(r.factors).payRate); // identical to the dashboard
    expect(q.payRate).toBeGreaterThan(0);
  });

  it('freetext path mirrors the dashboard ("CRNA nights in Houston, TX")', () => {
    const r = simParseFreetext('CRNA nights in Houston, TX')!;
    expect(r).not.toBeNull();
    expect(r.factors.specialty.key).toBe('crna');
    expect(r.factors.state.code).toBe('TX');
    expect(r.factors.shift.key).toBe('night');
  });

  it('returns null when no specialty was resolved (never asserts a default)', () => {
    expect(simParseAssignment('')).toBeNull();
    expect(simParseAssignment('unrelated prose, no fields here')).toBeNull();
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
    const r = simParseAssignment(CALL_PDF)!;
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
    ].join('\n'))!;
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
    const r = simParseAssignment(PDF)!;
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
