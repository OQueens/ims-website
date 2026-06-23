import { describe, it, expect } from 'vitest';
import { billCalcHTML } from './sim-render';
import { quoteFromControls, defaultControls, billLadder, billAtMargin, type SimQuote } from './sim-adapter';

const hourly = (margin = 22): SimQuote => quoteFromControls({ ...defaultControls(), marginPct: margin });
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
