import { describe, it, expect } from 'vitest';
import { billCalcHTML, callOnlyHTML, marketHTML } from './sim-render';
import { quoteFromControls, defaultControls, billLadder, billAtMargin, type SimQuote } from './sim-adapter';

// Minimal call-only SimQuote stub for the call-only surface (sufficient data).
const callQuote = (over: Partial<SimQuote> = {}): SimQuote => ({
  isCallOnly: true, payRate: 300, billRate: 375, marginPct: 30, marginPerHr: 75,
  confidence: 'High', confidenceData: 'high', confidenceReason: 'test stub', category: 'Surgery', specMin: 0, specMax: 0,
  waterfall: [], marketMin: 0, marketMax: 0, marketMarker: 300, percentiles: [],
  capped: false, marketMaxApplied: false, uncapped: 300,
  callOnly: { insufficientData: false, dayType: 'weekday', dailyPay: 2400, compModel: '24hr-beeper-call', coverageHrs: 24, sources: 2 },
  ...over,
});

const hourly = (margin = 22): SimQuote => quoteFromControls({ ...defaultControls(), marginPct: margin });

describe('marketHTML — premium tier overlay (median + premium marker)', () => {
  const q = quoteFromControls({ ...defaultControls(), specialtyKey: 'crna', region: 'Northeast', stateCode: 'PA' });
  const html = marketHTML(q);
  it('renders the recommended (median) marker + a distinct premium marker, zone, and legend', () => {
    expect(html).toContain('sim-mkt__marker--premium');
    expect(html).toContain('sim-mkt__premium');
    expect(html).toContain('Premium tier');
    expect(html).toContain('Recommended');
    expect(html).not.toContain('market median'); // honesty: it is an anchor, not an observed median
    expect(html).not.toMatch(/\bp(25|50|70|75|90):/); // honesty: no fabricated-percentile chip notation
    expect(html).toContain('% of range'); // chips honestly describe band position, not observed percentiles
  });
  it('places the premium value (p90) above the recommended marker', () => {
    const p90 = q.percentiles.find((p) => p.p === 90);
    expect(p90).toBeTruthy();
    expect(p90!.value).toBeGreaterThan(q.marketMarker); // premium tier sits above the median
  });
});
// sim-render is engine-free by design (it ships in the main hub bundle), so the
// caller passes the precomputed ladder + slider result from the (lazy) adapter.
const render = (q: SimQuote) => billCalcHTML(q, billLadder(q.payRate), billAtMargin(q.payRate, q.marginPct));

describe('sim-render — billCalcHTML (BillRateCalculator port)', () => {
  it('renders nothing for a call-only quote (hourly path only)', () => {
    const q = { ...hourly(), isCallOnly: true };
    expect(billCalcHTML(q, billLadder(q.payRate), billAtMargin(q.payRate, q.marginPct))).toBe('');
  });

  it('is a default-collapsed disclosure (keeps the simple hero UX)', () => {
    const html = render(hourly());
    expect(html).toMatch(/<details\b/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/); // closed by default
    expect(html).toMatch(/<summary/);
    expect(html.toLowerCase()).toContain('bill rate calculator');
  });

  it('renders the full 11-row markup ladder with REC band (25-32) highlighted', () => {
    const q = hourly();
    const html = render(q);
    const rows = billLadder(q.payRate);
    expect(rows).toHaveLength(11);
    for (const r of rows) {
      expect(html).toContain(`${r.markup}%`);
      expect(html).toContain('$' + Math.round(r.billRate).toLocaleString('en-US'));
    }
    // REC class appears at least once per recommended row (25,27,28,30,32 = 5 rows)
    expect((html.match(/sim-bc__rec/g) || []).length).toBeGreaterThanOrEqual(rows.filter((r) => r.rec).length);
  });

  it('seeds the margin slider at the quote margin, clamped to the 15-45 band', () => {
    const html = render(hourly(22));
    expect(html).toMatch(/type="range"[^>]*min="15"[^>]*max="45"/);
    expect(html).toMatch(/value="22"/);
    // a quote margin below the band clamps up to 15
    expect(render(hourly(5))).toMatch(/value="15"/);
  });

  it('shows the slider profit projections (bill, profit/hr, annual) from billAtMargin', () => {
    const q = hourly(25);
    const m = billAtMargin(q.payRate, 25);
    const html = render(q);
    expect(html).toContain('$' + m.billRate.toLocaleString('en-US'));
    expect(html).toContain('$' + m.annualProfit.toLocaleString('en-US'));
  });

  it('carries data-pay for client recompute and a custom-bill input (empty initial)', () => {
    const q = hourly();
    const html = render(q);
    expect(html).toContain(`data-pay="${Math.round(q.payRate)}"`);
    expect(html).toMatch(/sim-bc__custom/);
  });
});

describe('sim-render — callOnlyHTML (call-only honesty)', () => {
  it('bills call-only at the fixed 20% margin label, NOT the hourly slider %', () => {
    const html = callOnlyHTML(callQuote({ marginPct: 30 }), 'OB/GYN');
    expect(html).toContain('20% margin');     // fixed call-only margin
    expect(html).not.toContain('30% margin'); // never the hourly slider value
    expect(html).toContain('/day stipend');
  });

  it('surfaces the researched-max clamp disclosure when marketMaxApplied', () => {
    expect(callOnlyHTML(callQuote({ marketMaxApplied: true }), 'OB/GYN'))
      .toContain('highest publicly-observed daily');
    expect(callOnlyHTML(callQuote({ marketMaxApplied: false }), 'OB/GYN'))
      .not.toContain('highest publicly-observed daily');
  });

  it('surfaces the rate-cap disclosure when capped above the shown rate', () => {
    expect(callOnlyHTML(callQuote({ capped: true, uncapped: 360, payRate: 300 }), 'OB/GYN'))
      .toMatch(/Rate capped — uncapped it would be \$360\/hr/);
  });

  it('shows the honest no-data surface (never a fabricated $0) when insufficient', () => {
    const html = callOnlyHTML(callQuote({ payRate: 0, billRate: 0, callOnly: { insufficientData: true, dayType: 'weekend', dailyPay: 0, compModel: 'unknown', coverageHrs: 24, sources: 0 } }), 'OB/GYN');
    expect(html).toContain('Insufficient public data');
    expect(html).not.toContain('$0');
  });
});
