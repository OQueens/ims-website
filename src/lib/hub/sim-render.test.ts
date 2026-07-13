import { describe, it, expect } from 'vitest';
import { billCalcHTML, callOnlyHTML, marketHTML, capNoteHTML } from './sim-render';
import { quoteFromControls, quoteFromFactors, factorsFromControls, defaultControls, billLadder, billAtMargin, type SimQuote } from './sim-adapter';

// Minimal call-only SimQuote stub for the call-only surface (sufficient data).
const callQuote = (over: Partial<SimQuote> = {}): SimQuote => ({
  isCallOnly: true, payRate: 300, billRate: 375, marginPct: 30, marginPerHr: 75,
  confidence: 'High', confidenceData: 'high', confidenceReason: 'test stub', category: 'Surgery', specMin: 0, specMax: 0,
  waterfall: [], marketMin: 0, marketMax: 0, marketMarker: 300, percentiles: [],
  capped: false, marketMaxApplied: false, uncapped: 300, billCap: null, billCapApplied: false,
  billCapUnit: null, billCapWarning: false, effectiveMarginPct: 20,
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
    expect(html).not.toMatch(/\bp\d+:/); // honesty: no fabricated-percentile chip notation (any pXX:, not just today's set)
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

// Sol-N1 (Tier 1, 2026-07-10 audit): when a contractual bill cap clamped the
// displayed bill, the UI must SAY so — the slider margin is unattainable, and
// the honest number is the effective margin. The bill calculator also carries
// the cap (data-billcap) so the client-side slider/custom-bill recompute stays
// clamped, and clamped ladder rows are visibly badged.
describe('sim-render — Sol-N1 contractual bill cap surfaces', () => {
  // Engine-shaped capped quote: $250/hr cap → pay 200 (0.80×cap), bill clamped
  // 260→250, effective margin 20% (slider said 22%).
  const cappedQ = (over: Partial<SimQuote> = {}): SimQuote => ({
    ...hourly(22), payRate: 200, billRate: 250, marginPerHr: 50,
    billCap: 250, billCapApplied: true, capped: true, uncapped: 287,
    billCapUnit: 'hour', billCapWarning: false, effectiveMarginPct: 20, ...over,
  });

  it('capNoteHTML discloses the bill clamp with the cap and the EFFECTIVE margin', () => {
    const note = capNoteHTML(cappedQ());
    expect(note.toLowerCase()).toContain('rate cap');
    expect(note).toContain('$250');
    expect(note).toContain('20%'); // (250-200)/250 — NOT the slider's 22%
  });

  it('capNoteHTML shows the bill-clamp disclosure even when the engine never capped pay', () => {
    // High slider margin busted the cap on its own (engine capped=false).
    const note = capNoteHTML(cappedQ({ capped: false, uncapped: 200 }));
    expect(note.toLowerCase()).toContain('rate cap');
  });

  it('capNoteHTML stays silent when a cap exists but never bound', () => {
    expect(capNoteHTML(cappedQ({ billCapApplied: false, capped: false, uncapped: 200 }))).toBe('');
  });

  it('billCalcHTML carries data-billcap, a cap note, and badges the clamped ladder rows', () => {
    const q = cappedQ();
    const html = billCalcHTML(q, billLadder(q.payRate, q.billCap), billAtMargin(q.payRate, q.marginPct, q.billCap));
    expect(html).toContain('data-billcap="250"');
    expect(html.toLowerCase()).toContain('rate cap');       // the calculator names the bound
    expect(html).toContain('sim-bc__cap-badge');            // 22%+ rows clamp at pay 200 / cap 250
    expect(html).toContain('$250');
  });

  it('billCalcHTML without a cap renders no cap plumbing (legacy markup unchanged)', () => {
    const q = hourly(22);
    const html = billCalcHTML(q, billLadder(q.payRate), billAtMargin(q.payRate, q.marginPct));
    expect(html).not.toContain('data-billcap');
    expect(html).not.toContain('sim-bc__cap-badge');
  });

  // ── Sol gate round 1 (2026-07-13) ──────────────────────────────────────────
  it('Sol-R1: a fractional cap renders EXACT ($187.50 never becomes $188)', () => {
    const q = cappedQ({ payRate: 150, billRate: 187.5, marginPerHr: 37.5, billCap: 187.5, uncapped: 200 });
    const html = billCalcHTML(q, billLadder(q.payRate, q.billCap), billAtMargin(q.payRate, q.marginPct, q.billCap));
    expect(html).toContain('$187.50');
    expect(html).not.toContain('$188');
    const note = capNoteHTML(q);
    expect(note).toContain('$187.50');
    expect(note).not.toContain('$188');
  });

  it('Sol-R1: capNoteHTML shows effective margin AND names the unattainable requested margin', () => {
    const note = capNoteHTML(cappedQ()); // pay 200 / cap 250 / slider 22
    expect(note).toContain('20%');  // effective
    expect(note).toContain('22%');  // requested, named as unattainable under the cap
  });

  it('Sol-R2: a cap mention with NO usable amount renders a manual-review warning, not a silent uncapped quote', () => {
    const q = cappedQ({ billCap: null, billCapApplied: false, billCapUnit: null, billCapWarning: true, capped: false, uncapped: 200 });
    const note = capNoteHTML(q);
    expect(note.toLowerCase()).toContain('rate cap');
    expect(note.toLowerCase()).toContain('verify');
  });

  it('Sol-R2: a sub-1% clamp shows a decimal effective margin — never "effective 22% (requested 22% unattainable)"', () => {
    // cap 499 vs raw 500 at 22%: true effective ≈21.84% — whole-% rounding would
    // print the requested number as its own contradiction.
    const q = cappedQ({ payRate: 390, billRate: 499, billCap: 499, marginPerHr: 109, effectiveMarginPct: (109 / 499) * 100 });
    const note = capNoteHTML(q);
    expect(note).toContain('21.8%');
    expect(note).not.toMatch(/effective margin 22%/);
  });

  it('Sol-R3: a USABLE unknown-unit cap that does not bind still shows a visible unit warning', () => {
    // "Rate Cap $1000" (no unit) on a $370 bill: nothing clamps, but the cap
    // might be daily/shift — the recruiter must see that outside the collapsed
    // calculator (the main cap-note area).
    const q = cappedQ({ payRate: 287, billRate: 370, billCap: 1000, billCapApplied: false, billCapUnit: 'unknown', billCapWarning: true, capped: false, uncapped: 287, marginPerHr: 83 });
    const note = capNoteHTML(q);
    expect(note.toLowerCase()).toContain('no stated unit');
    expect(note.toLowerCase()).toContain('verify');
  });

  it('Sol-R4: the unknown-unit warning must not claim the cap "does not bind" when the ENGINE capped pay under it', () => {
    // REAL adapter path (Sol R5: no hand-built fixture): radiology (p70 287)
    // with a naked $350 cap at 20% margin → engine caps pay to 280 (0.80×350),
    // bill roundUp5(280/0.80) = 350 lands EXACTLY at the cap (not >) →
    // billCapApplied false, yet the cap shaped BOTH numbers. The note may only
    // speak for the displayed BILL, and the engine's own pay-cap sentence must
    // render alongside it.
    const f = {
      ...factorsFromControls({ ...defaultControls(), specialtyKey: 'radiology', marginPct: 20 }),
      rateCap: { cap: 350, unit: 'unknown' as const, source: 'Rate Cap $350', hasWarning: true },
    };
    const q = quoteFromFactors(f, 20);
    expect(q.payRate).toBe(280);
    expect(q.billRate).toBe(350);
    expect(q.billCapApplied).toBe(false);
    const note = capNoteHTML(q);
    expect(note).toContain('Rate capped — uncapped it would be $287/hr.');
    expect(note).not.toContain('does not bind this quote');
    expect(note.toLowerCase()).toContain('does not constrain the displayed bill rate');
  });

  it('Sol-R3: effective-margin formatting is collision-safe (21.9653% never prints as the requested 22%)', () => {
    // pay 287, cap 368, requested 22%: raw roundUp5(287/0.78)=370 → clamped 368,
    // true effective 22.0109% — 1dp rounds to "22.0" = collision → must print 22.01.
    const q = cappedQ({ payRate: 287, billRate: 368, billCap: 368, marginPerHr: 81, effectiveMarginPct: (81 / 368) * 100 });
    const note = capNoteHTML(q);
    expect(note).toContain('22.01%');
    expect(note).not.toMatch(/effective margin 22% /);
  });

  it('Sol-R1: an unknown-unit cap is NOT asserted as "/hr" — the assumption is disclosed', () => {
    const q = cappedQ({ billCapUnit: 'unknown', billCapWarning: true });
    const html = billCalcHTML(q, billLadder(q.payRate, q.billCap), billAtMargin(q.payRate, q.marginPct, q.billCap));
    expect(html.toLowerCase()).toContain('assumed hourly');
    const note = capNoteHTML(q);
    expect(note.toLowerCase()).toContain('assumed hourly');
    // hour-unit caps keep the plain /hr claim
    const hr = cappedQ({ billCapUnit: 'hour' });
    expect(capNoteHTML(hr)).toContain('/hr');
    expect(capNoteHTML(hr).toLowerCase()).not.toContain('assumed hourly');
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
