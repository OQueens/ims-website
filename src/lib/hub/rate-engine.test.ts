import { describe, it, expect } from 'vitest';
import {
  quoteFromControls, quoteFromFactors, factorsFromControls, defaultControls,
  simSpecialtyOptions, simShiftOptions, simUrgencyOptions, simRegionOptions,
  simSpecialtyKeyForSlug, DEFAULT_SIM_SPECIALTY,
} from './rate-engine';
import { SPECIALTIES, calculateRate } from '../rate-engine/index';

// The façade is the hub's single Rate-Simulator import surface. It re-exports the
// sim-adapter, a faithful PORT of the dashboard simulator onto the real engine —
// these assertions prove the façade drives the live engine, not the old stub.
describe('rate-engine façade — wired to the real engine, dashboard-identical', () => {
  it('quotes the clinician PAY rate as the hero, bill grossed up at the margin', () => {
    const q = quoteFromControls(defaultControls());
    expect(q.payRate).toBeGreaterThan(0);
    expect(q.billRate).toBeGreaterThan(q.payRate);
    expect(q.marginPerHr).toBe(q.billRate - q.payRate);
  });

  it('the hub quote equals the engine calculateRate exactly (no drift from the dashboard)', () => {
    const f = factorsFromControls(defaultControls());
    expect(quoteFromFactors(f, 22).payRate).toBe(calculateRate(f).payRate);
  });

  it('exposes the full engine specialty table (far more than the old 8), with p70 + max', () => {
    const opts = simSpecialtyOptions();
    expect(opts.length).toBeGreaterThan(50);
    for (const o of opts) {
      expect(SPECIALTIES[o.key]).toBeDefined();
      expect(o.p70).toBe(SPECIALTIES[o.key].p70);
    }
  });

  it('keeps the region buttons (National + 4) and engine-aligned shift/urgency', () => {
    expect(simRegionOptions().map((r) => r.key)).toEqual(['National', 'West', 'Midwest', 'Northeast', 'South']);
    expect(simShiftOptions().map((s) => s.key)).toContain('night');
    expect(simUrgencyOptions().map((u) => u.key)).toEqual(['Standard', 'Priority', 'Emergent']);
  });

  it('default specialty + slug mapping resolve to real engine keys', () => {
    expect(SPECIALTIES[DEFAULT_SIM_SPECIALTY]).toBeDefined();
    expect(SPECIALTIES[simSpecialtyKeyForSlug('emergency-medicine')]).toBeDefined();
  });
});
