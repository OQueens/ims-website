// Pure HTML-string builders for the Rate Simulator result panel, shared by the
// server (SimulatorView.astro first paint) and the client (hub-client.ts
// re-render on interaction) so both produce byte-identical markup. No engine
// here — these only format a SimQuote. All string fields are escaped (the
// numbers are engine-derived, but defense-in-depth).
import type { SimQuote, BillLadderRow, BillMarginResult } from './sim-adapter';

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string));

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
// Exact-currency variant for CAP-DERIVED values (Sol gate R1, 2026-07-13): a
// fractional contractual cap ($187.50) must never round UP to a displayed
// number above the contract ($188). Whole dollars render identically to usd().
const usdExact = (n: number) =>
  Number.isInteger(n)
    ? usd(n)
    : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (m: number) => (m === 1 ? '—' : `${m > 1 ? '+' : ''}${Math.round((m - 1) * 100)}%`);
// Cap phrasing: only an explicit hour-unit cap may claim "/hr"; an unknown-unit
// cap discloses the engine's hourly assumption instead of asserting it (Sol R1).
const capPhrase = (cap: number, unit: SimQuote['billCapUnit']): string =>
  unit === 'hour' ? `${usdExact(cap)}/hr` : `${usdExact(cap)} (unit not stated — assumed hourly; verify the contract)`;
// Effective-margin precision (Sol R2+R3): collision-safe — raise precision until
// the printed effective % differs from the requested %, so a sub-1% clamp never
// prints "effective margin 22% (the requested 22% isn't attainable)". If they
// are genuinely equal at 3dp, printing the same number IS the honest display.
const effPctVs = (eff: number, requested: number): string => {
  for (const dp of [1, 2, 3]) {
    const s = eff.toFixed(dp);
    if (parseFloat(s) !== requested) return s.replace(/\.?0+$/, '');
  }
  return String(requested);
};

// Context pills: category · specialty · state · confidence (+ Call-Only).
export function pillsHTML(q: SimQuote, specialtyLabel: string, stateName: string | null): string {
  const pills: Array<{ t: string; cls: string; title?: string }> = [
    { t: q.category, cls: 'sim-pill--cat' },
    { t: specialtyLabel, cls: 'sim-pill--spec' },
  ];
  if (stateName) pills.push({ t: stateName, cls: 'sim-pill--geo' });
  if (q.isCallOnly) pills.push({ t: 'Call-Only', cls: 'sim-pill--call' });
  pills.push({ t: q.confidence + ' confidence', cls: 'sim-pill--conf-' + q.confidence.toLowerCase(), title: q.confidenceReason });
  return pills.map((p) =>
    `<span class="sim-pill ${p.cls}"${p.title ? ` title="${esc(p.title)}"` : ''}>${esc(p.t)}</span>`,
  ).join('');
}

// Rate waterfall: base → each adjustment factor (dashboard's buildWaterfall).
export function waterfallHTML(q: SimQuote): string {
  if (!q.waterfall.length) return '';
  const max = Math.max(...q.waterfall.map((w) => w.value), 1);
  return q.waterfall.map((w) => {
    const type = w.label === 'Base' ? 'base' : w.mult > 1 ? 'up' : w.mult < 1 ? 'down' : 'flat';
    const width = Math.max((w.value / max) * 100, 16);
    return `<div class="sim-wf__row">
      <span class="sim-wf__label">${esc(w.label)}</span>
      <span class="sim-wf__track"><span class="sim-wf__fill sim-wf__fill--${type}" style="width:${width.toFixed(1)}%">${usd(w.value)}</span></span>
      <span class="sim-wf__mult sim-wf__mult--${type}">${esc(pct(w.mult))}</span>
    </div>`;
  }).join('');
}

// Market-position bar: where the quote sits in the researched range, with the
// percentile chips (p70 highlighted, as in the dashboard). On top of the
// recommended (≈market-median) marker we overlay a PREMIUM TIER: the upper band
// (p75 → top of the researched range) is shaded and marked at p90 — that's where
// premium agencies and urgent / subspecialty assignments land. This makes the
// real upper-market rate visible without inflating the headline recommendation
// (the IMS "median + premium marker" positioning).
export function marketHTML(q: SimQuote): string {
  if (q.isCallOnly || q.marketMax <= q.marketMin) return '';
  const span = q.marketMax - q.marketMin;
  const pos = (v: number) => Math.min(Math.max(span > 0 ? ((v - q.marketMin) / span) * 100 : 50, 2), 98);
  const marker = pos(q.marketMarker);
  const pctVal = (p: number) => { const f = q.percentiles.find((x) => x.p === p); return f ? f.value : null; };
  const p75 = pctVal(75), p90 = pctVal(90);
  const chips = q.percentiles.map((p) =>
    `<span class="sim-mkt__chip${p.p === 70 ? ' is-p70' : ''}">${p.p}% of range: ${usd(p.value)}</span>`,
  ).join('');

  let premiumZone = '', premiumMarker = '', legend = '';
  if (p75 != null && p90 != null && p90 > q.marketMarker) {
    const z0 = pos(p75);
    premiumZone = `<span class="sim-mkt__premium" style="left:${z0.toFixed(1)}%;width:${Math.max(98 - z0, 0).toFixed(1)}%"></span>`;
    premiumMarker = `<span class="sim-mkt__marker sim-mkt__marker--premium" style="left:${pos(p90).toFixed(1)}%"></span>`;
    legend = `<div class="sim-mkt__legend">
      <span class="sim-mkt__leg"><i class="sim-mkt__key sim-mkt__key--rec"></i>Recommended ${usd(q.marketMarker)}</span>
      <span class="sim-mkt__leg"><i class="sim-mkt__key sim-mkt__key--prem"></i>Premium tier ${usd(p90)}</span>
    </div>`;
  }

  return `<div class="sim-mkt__bar"><span class="sim-mkt__fill"></span>${premiumZone}<span class="sim-mkt__marker" style="left:${marker.toFixed(1)}%"></span>${premiumMarker}</div>
    <div class="sim-mkt__scale"><span>${usd(q.marketMin)}</span><span class="sim-mkt__here">${usd(q.marketMarker)}</span><span>${usd(q.marketMax)}</span></div>
    ${legend}
    <div class="sim-mkt__chips">${chips}</div>`;
}

// The honest caption when the engine clamped the quote to the researched max.
export function maxNoteHTML(q: SimQuote): string {
  if (q.isCallOnly || !q.marketMaxApplied) return '';
  return `Bounded to the top of the researched market range (${usd(q.specMax)}/hr) — the adjustment factors estimated higher than the researched max.`;
}

// The honest caption when the 1.75× multiplier ceiling clamped the hero pay
// (distinct from the researched-max clamp above). Mirrors the dashboard chip.
// Sol-N1 (2026-07-10 audit): also discloses when the DISPLAYED BILL was clamped
// to the contractual rate cap — the slider margin is then unattainable, so the
// note names the cap and the EFFECTIVE margin ((bill−pay)/bill).
export function capNoteHTML(q: SimQuote): string {
  if (q.isCallOnly) return '';
  const parts: string[] = [];
  if (q.capped && q.uncapped > q.payRate) {
    parts.push(`Rate capped — uncapped it would be ${usd(q.uncapped)}/hr.`);
  }
  if (q.billCapApplied && q.billCap !== null && q.billRate > 0) {
    parts.push(
      `Bill clamped to the contractual rate cap (${capPhrase(q.billCap, q.billCapUnit)}) — ` +
      `effective margin ${effPctVs(q.effectiveMarginPct, q.marginPct)}% (the requested ${q.marginPct}% isn't attainable under the cap).`,
    );
  }
  // Sol R3: a USABLE cap with an unknown unit that did not clamp the bill — the
  // number may actually be daily/shift, so the assumption must be visible on the
  // main panel, not only inside the collapsed calculator. Sol R4: speak ONLY for
  // the displayed bill — the ENGINE may still have capped pay at 0.80×cap (bill
  // landing exactly AT the cap), so "does not bind this quote" would be false.
  if (q.billCap !== null && !q.billCapApplied && q.billCapWarning) {
    parts.push(
      `The assignment mentions a rate cap of ${usdExact(q.billCap)} with no stated unit — assumed hourly ` +
      `(does not constrain the displayed bill rate); verify the contract.`,
    );
  }
  // Sol R2: the contract MENTIONED a rate cap but no usable amount parsed
  // (extractBillRateCap {cap:null, hasWarning:true}) — a manual-review
  // condition, never a silent ordinary-looking uncapped quote.
  if (q.billCap === null && q.billCapWarning) {
    parts.push('The contract mentions a rate cap, but no usable amount could be parsed — verify the contract before quoting.');
  }
  return parts.join(' ');
}

const COMP_MODEL: Record<string, string> = {
  'worked-day-clinic': 'worked-day clinic',
  '24hr-beeper-call': '24-hr beeper call',
  'mixed': 'mixed comp model',
  'unknown': 'call',
};

// Call-only / per-diem surface (the dashboard's CallInsufficientCard + daily
// hero). When the research has no defensible daily band the engine emits NO
// number — we show the honest "insufficient public data, quote manually" state,
// never a fabricated $0. When sufficient, we show the daily stipend basis, the
// comp-model + coverage hours, the derived $/hr, and the bill at the margin.
export function callOnlyHTML(q: SimQuote, specialtyLabel: string): string {
  const co = q.callOnly;
  if (!q.isCallOnly || !co) return '';
  const provenance = `${co.sources} public source${co.sources === 1 ? '' : 's'}${co.note ? ' · ' + esc(co.note) : ''}`;
  if (co.insufficientData) {
    return `<div class="sim__co">
      <div class="sim__co-h">Insufficient public data</div>
      <div class="sim__co-sub">No defensible public call-only ${esc(co.dayType)} rate for ${esc(specialtyLabel)}. Per the no-fabrication rule the simulator will not invent one — quote this assignment manually.</div>
      <div class="sim__co-prov">${provenance}</div>
    </div>`;
  }
  // Honest clamp disclosures the dashboard shows (RateResults): the researched-max
  // bound and the 1.75x ceiling. q carries marketMaxApplied/capped/uncapped (already
  // converted to $/hr in the adapter for the call-only path).
  const maxNote = q.marketMaxApplied
    ? `<div class="sim__co-note">Bounded to the highest publicly-observed daily for this specialty and day-type.</div>` : '';
  const capNote = q.capped && q.uncapped > q.payRate
    ? `<div class="sim__co-note">Rate capped — uncapped it would be ${usd(q.uncapped)}/hr.</div>` : '';
  return `<div class="sim__co">
    <div class="sim__result-label">Call-only rate · ${esc(co.dayType)}</div>
    <div class="sim__result-rate">$<span>${Math.round(q.payRate).toLocaleString('en-US')}</span><small>/hr</small></div>
    <div class="sim__result-sub">≈ ${usd(co.dailyPay)}/day stipend ÷ ${co.coverageHrs}-hr coverage · ${esc(COMP_MODEL[co.compModel] || 'call')}</div>
    ${maxNote}${capNote}
    <div class="sim__co-bill">Bill to facility (20% margin) <b>${usd(q.billRate)}</b>/hr</div>
    <div class="sim__co-prov">${provenance}</div>
  </div>`;
}

// Bill Rate Calculator (faithful port of the dashboard BillRateCalculator),
// rendered as a DEFAULT-COLLAPSED disclosure under the hero so the simple
// pay-first UX is untouched until a recruiter opens it. Hourly path only;
// returns '' for call-only (which keeps its own honest surface above).
//
// This stays a pure formatter — the ladder + slider numbers are precomputed by
// the caller via the (engine-backed, lazy-loaded) adapter and passed in, so
// sim-render never pulls the engine into the main hub bundle. The client rewires
// the slider + custom-bill inputs after each render (sim-bc__* hooks; data-pay
// is the recompute base). All dynamic numbers are engine/math-derived; esc() is
// defense-in-depth on the few text fields.
export function billCalcHTML(q: SimQuote, ladder: BillLadderRow[], init: BillMarginResult): string {
  if (q.isCallOnly) return '';
  const pay = Math.round(q.payRate);
  // Sol-N1: thread the contractual bill cap through the calculator — clamped
  // ladder rows are badged, the cap is named in the note, and data-billcap lets
  // the client-side slider/custom-bill recompute stay clamped after re-renders.
  const cap = q.billCap;
  const rows = ladder.map((r) => `<tr class="sim-bc__row${r.rec ? ' sim-bc__rec' : ''}">
        <td class="sim-bc__mk">${r.markup}%${r.rec ? '<span class="sim-bc__badge">REC</span>' : ''}${r.capped ? '<span class="sim-bc__cap-badge">CAP</span>' : ''}</td>
        <td class="sim-bc__bill-c">${usdExact(r.billRate)}</td>
        <td class="sim-bc__prof-c">${usdExact(r.profit)}</td>
      </tr>`).join('');
  const capNote = cap !== null
    ? ` This assignment carries a contractual rate cap of <b>${capPhrase(cap, q.billCapUnit)}</b> — bill rates are clamped to the cap.`
    : '';
  const marginLabel = init.capped
    ? `Margin: ${init.marginPct}% → ${effPctVs(init.effectiveMarginPct, init.marginPct)}% effective (cap)`
    : `Margin: ${init.marginPct}%`;
  return `<details class="sim-billcalc" data-pay="${pay}"${cap !== null ? ` data-billcap="${cap}"` : ''}>
    <summary class="sim-bc__summary">Bill rate calculator<span class="sim-bc__hint">markup ladder · margins · custom bill</span></summary>
    <div class="sim-bc__body">
      <p class="sim-bc__note">Margin analysis for client billing — clinician pay is <b>${usd(pay)}</b>/hr. Bill rates round up to the nearest $5.${capNote}</p>
      <table class="sim-bc__table">
        <thead><tr><th>Markup %</th><th>Bill rate</th><th>Profit/hr</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sim-bc__slider-wrap">
        <div class="sim-bc__slider-head"><span>${15}%</span><span class="sim-bc__margin">${marginLabel}</span><span>${45}%</span></div>
        <input class="sim-bc__slider" type="range" min="15" max="45" step="1" value="${init.marginPct}" aria-label="Bill margin percent">
        <div class="sim-bc__tiles">
          <div class="sim-bc__tile is-bill"><span class="sim-bc__tile-l">Bill rate</span><span class="sim-bc__bill">${usdExact(init.billRate)}</span></div>
          <div class="sim-bc__tile"><span class="sim-bc__tile-l">Profit/hr</span><span class="sim-bc__profit">${usdExact(init.profitPerHr)}</span><span class="sim-bc__daily">${usdExact(init.dailyProfit)}/day (10hr)</span></div>
          <div class="sim-bc__tile"><span class="sim-bc__tile-l">Annual</span><span class="sim-bc__annual">${usdExact(init.annualProfit)}</span><span class="sim-bc__unit">2,080 hrs</span></div>
        </div>
        <div class="sim-bc__foot"><span>Pay: ${usd(pay)}/hr</span><span class="sim-bc__mult">${init.multiplier.toFixed(3)}x</span></div>
      </div>
      <div class="sim-bc__custom">
        <label class="sim-bc__custom-lbl">Custom bill rate ($)<input class="sim-bc__custom-in" type="number" inputmode="decimal" min="0" placeholder="e.g. ${usdExact(init.billRate).replace('$', '')}"></label>
        <div class="sim-bc__custom-res">Margin <b class="sim-bc__custom-out">—</b></div>
      </div>
    </div>
  </details>`;
}
