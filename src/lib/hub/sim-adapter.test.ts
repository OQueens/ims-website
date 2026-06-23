import { describe, it, expect } from 'vitest';
import { buildSimFactors, simRate, simSpecialtyOptions, simStateOptions } from './sim-adapter';

describe('sim-adapter — maps the simple hub controls onto the real engine', () => {
  it('builds valid RateFactors for a known specialty', () => {
    const f = buildSimFactors({ specialtyKey: 'crna', state: null, shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22 });
    expect(f.specialty.key).toBe('crna');
    expect(f.state.code).toBeNull(); // National → no state premium
    expect(f.shift.key).toBe('day');
    expect(f.duration.key).toBe('standard');
    expect(f.callOnly.isCallOnly).toBe(false);
  });

  it('throws (never silently zeroes) on an unknown specialty', () => {
    expect(() => buildSimFactors({ specialtyKey: 'not-a-specialty', state: null, shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22 }))
      .toThrow(/unknown specialty/);
  });

  it('hero is the hourly PAY rate; bill is derived at the target margin (pay < bill)', () => {
    const r = simRate({ specialtyKey: 'emergency medicine', state: 'CA', shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 25 });
    expect(r.payRate).toBeGreaterThan(0);
    expect(r.billRate).toBeGreaterThan(r.payRate);          // bill grosses up pay
    expect(r.marginPerHr).toBe(r.billRate - r.payRate);
    // bill = pay / (1 - margin); at 25% margin, bill = round(pay / 0.75)
    expect(r.billRate).toBe(Math.round(r.payRate / 0.75));
  });

  it('prices geography by scarcity: WY (scarce) > National > NY (dense metro)', () => {
    const base = { specialtyKey: 'hospitalist', shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22 } as const;
    const wy = simRate({ ...base, state: 'WY' });
    const nat = simRate({ ...base, state: null });
    const ny = simRate({ ...base, state: 'NY' });
    expect(wy.geoMult).toBeGreaterThan(1.0);   // hard-to-staff premium
    expect(nat.geoMult).toBe(1.0);             // no adjustment
    expect(ny.geoMult).toBeLessThan(1.0);      // dense metro discount
    expect(wy.payRate).toBeGreaterThan(ny.payRate);
  });

  it('urgency escalates the duration premium (Emergent ≥ Standard)', () => {
    const std = simRate({ specialtyKey: 'crna', state: null, shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22 });
    const emer = simRate({ specialtyKey: 'crna', state: null, shift: 'day', urgency: 'Emergent', weeks: 12, marginPct: 22 });
    expect(emer.durationMult).toBeGreaterThan(std.durationMult);
    expect(emer.payRate).toBeGreaterThanOrEqual(std.payRate);
  });

  it('night shift pays a premium over day', () => {
    const day = simRate({ specialtyKey: 'crna', state: null, shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22 });
    const night = simRate({ specialtyKey: 'crna', state: null, shift: 'night', urgency: 'Standard', weeks: 12, marginPct: 22 });
    expect(night.shiftMult).toBeGreaterThan(day.shiftMult);
    expect(night.payRate).toBeGreaterThan(day.payRate);
  });

  it('exposes the full specialty list (far more than the old 8-stub), labeled + grouped', () => {
    const opts = simSpecialtyOptions();
    expect(opts.length).toBeGreaterThan(50);
    const crna = opts.find((o) => o.key === 'crna');
    expect(crna?.label).toBe('CRNA');               // acronym preserved
    expect(crna?.category).toBe('Anesthesia');
    const em = opts.find((o) => o.key === 'emergency medicine');
    expect(em?.label).toBe('Emergency Medicine');   // title-cased
  });

  it('offers all engine-priced states grouped into 4 regions', () => {
    const groups = simStateOptions();
    expect(groups.map((g) => g.region)).toEqual(['West', 'Midwest', 'Northeast', 'South']);
    const total = groups.reduce((n, g) => n + g.states.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);                       // 50 states + DC
    expect(groups.find((g) => g.region === 'West')!.states.some((s) => s.code === 'WY')).toBe(true);
  });
});
