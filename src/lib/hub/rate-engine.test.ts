import { describe, it, expect } from 'vitest';
import { p70, billFromPay, SIM_SPECIALTIES, SIM_SHIFTS, SIM_REGIONS, SIM_URGENCY } from './rate-engine';

describe('rate-engine derivations', () => {
  it('p70 is the 70th percentile of the pay range, rounded', () => {
    expect(p70(300, 400)).toBe(370);
    expect(p70(190, 250)).toBe(232); // 190 + 60*0.7 = 232
    expect(p70(200, 200)).toBe(200);
  });

  it('billFromPay grosses pay up to a bill at the standard 20% margin', () => {
    expect(billFromPay(370)).toBe(463); // 370 / 0.80 = 462.5 → 463
    expect(billFromPay(232)).toBe(290); // 232 / 0.80 = 290
  });

  it('every sim specialty derives a real curated bill base above its p70 pay', () => {
    expect(SIM_SPECIALTIES.length).toBeGreaterThanOrEqual(8);
    for (const s of SIM_SPECIALTIES) {
      expect(s.payP70).toBe(p70(s.pay[0], s.pay[1]));
      expect(s.billBase).toBe(billFromPay(s.payP70));
      expect(s.billBase).toBeGreaterThan(s.payP70); // a margin always lifts bill above pay
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it('anesthesiology resolves to the curated $300–400 pay band', () => {
    const anes = SIM_SPECIALTIES.find((s) => s.label.startsWith('Anesthesiology'));
    expect(anes?.pay).toEqual([300, 400]);
    expect(anes?.payP70).toBe(370);
    expect(anes?.billBase).toBe(463);
  });

  it('the neutral option of every control set is exactly 1.00', () => {
    expect(SIM_SHIFTS.find((o) => o.label === 'Day')?.mult).toBe(1.0);
    expect(SIM_REGIONS.find((o) => o.label === 'National')?.mult).toBe(1.0);
    expect(SIM_URGENCY.find((o) => o.label === 'Standard')?.mult).toBe(1.0);
  });

  it('multipliers are sane premiums/discounts within the IAS range', () => {
    for (const o of [...SIM_SHIFTS, ...SIM_REGIONS, ...SIM_URGENCY]) {
      expect(o.mult).toBeGreaterThanOrEqual(0.85);
      expect(o.mult).toBeLessThanOrEqual(1.4);
    }
  });
});
