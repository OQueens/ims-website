// IMS Hub dashboard client — view switching, theme toggle, rate simulator, PDF
// dropzone, weekly-sync board, analytics charts. Bundled by Astro from 'self'
// (CSP-clean). Ported from design_handoff_hub/src/hub.js with the data source
// swapped from window.HUB to the typed seed module, and the Overview
// pipeline/activity + Simulator latest-list left to the server (we only wire
// their interactions here).
import {
  type BarRow,
  PDF_CHIPS,
  SYNC_SEED,
  type SyncSeed,
} from '../../lib/hub/hub-seed';

const $ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document): T | null => c.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document): T[] => Array.from(c.querySelectorAll<T>(s));
const fillClass = (f: string) => 'fill--' + f;
// Escape DB-derived strings (specialty / organization names) before any innerHTML.
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string));

// ── Theme (default dark, persisted) ───────────────────────────────────────────
const THEME_KEY = 'imsHubTheme';
function applyTheme(t: string) {
  document.documentElement.setAttribute('data-hub-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
}
(function initTheme() {
  let t = 'dark';
  try { t = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(t);
  const btn = $('#hub-theme-toggle');
  if (btn) btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-hub-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
})();

// ── View switching ────────────────────────────────────────────────────────────
const VIEW_TITLES: Record<string, string> = {
  overview: 'Overview', simulator: 'Rate Simulator', analytics: 'Analytics',
  sync: 'Weekly Sync',
};
function showView(id: string) {
  $$('.hub-view').forEach((v) => v.classList.toggle('is-active', (v as HTMLElement).dataset.view === id));
  $$('.hub-nav__item').forEach((b) => b.classList.toggle('is-active', (b as HTMLElement).dataset.view === id));
  const title = $('#top-title');
  if (title) title.textContent = VIEW_TITLES[id] || 'Overview';
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (id === 'analytics') drawAnalytics();
}
$$('.hub-nav__item').forEach((b) => b.addEventListener('click', () => showView((b as HTMLElement).dataset.view || 'overview')));
$$<HTMLElement>('[data-goto]').forEach((el) => el.addEventListener('click', () => showView(el.dataset.goto || 'overview')));

// ── Renderers (used by Analytics; Overview is server-rendered) ─────────────────
function renderBars(host: HTMLElement | null, rows: BarRow[], maxOverride?: number) {
  if (!host) return;
  const max = maxOverride || Math.max(...rows.map((r) => r.val));
  host.innerHTML = rows.map((r) => {
    const pct = Math.round((r.val / (r.max || max)) * 100);
    return `
      <div class="bar__row">
        <span class="bar__name">${esc(r.name)}</span>
        <span class="bar__track"><span class="bar__fill ${fillClass(r.fill)}" style="width:${pct}%"></span></span>
        <span class="bar__val">${esc(r.label ?? r.val)}</span>
      </div>`;
  }).join('');
}

// ── Overview: priorities checkbox toggle (server-rendered items) ───────────────
$$('#priorities .todo__check').forEach((c) => {
  const toggle = () => {
    const done = c.classList.toggle('is-done');
    c.textContent = done ? '✓' : '';
    c.setAttribute('aria-checked', done ? 'true' : 'false');
    const txt = c.nextElementSibling;
    if (txt) txt.classList.toggle('is-done', done);
  };
  c.addEventListener('click', toggle);
  c.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') { ke.preventDefault(); toggle(); }
  });
});

// ── Quick rate check (overview) ────────────────────────────────────────────────
(function quickRate() {
  const spec = $<HTMLSelectElement>('#qr-spec');
  const region = $<HTMLSelectElement>('#qr-region');
  const out = $('#qr-rate');
  if (!spec || !region || !out) return;
  const update = () => { out.textContent = '$' + Math.round(+spec.value * +region.value); };
  spec.addEventListener('change', update);
  region.addEventListener('change', update);
  update();
})();

// ── Rate Simulator ─────────────────────────────────────────────────────────────
(function simulator() {
  const specSel = $<HTMLSelectElement>('#sim-spec');
  if (!specSel) return;
  // Base is the selected specialty's curated bill rate (rate-engine), not a
  // hardcoded constant — so init matches whatever the first <option> renders.
  const sim = { base: +specSel.value || 0, region: 1, shift: 1, urg: 1, weeks: 12, margin: 22 };

  function bindSeg(wrapId: string, key: 'region' | 'shift' | 'urg', lblId: string) {
    $$('#' + wrapId + ' .seg__opt').forEach((opt) => opt.addEventListener('click', () => {
      $$('#' + wrapId + ' .seg__opt').forEach((o) => o.classList.remove('is-active'));
      opt.classList.add('is-active');
      sim[key] = +((opt as HTMLElement).dataset.mult || '1');
      const lbl = $('#' + lblId);
      if (lbl) lbl.textContent = (opt as HTMLElement).dataset.lbl || '';
      updateSim();
    }));
  }
  bindSeg('sim-region', 'region', 'sim-region-lbl');
  bindSeg('sim-shift', 'shift', 'sim-shift-lbl');
  bindSeg('sim-urg', 'urg', 'sim-urg-lbl');
  specSel.addEventListener('change', (e) => { sim.base = +(e.target as HTMLSelectElement).value; updateSim(); });
  const weeks = $<HTMLInputElement>('#sim-weeks');
  const margin = $<HTMLInputElement>('#sim-margin');
  weeks?.addEventListener('input', (e) => { sim.weeks = +(e.target as HTMLInputElement).value; const v = $('#sim-weeks-val'); if (v) v.textContent = (e.target as HTMLInputElement).value; updateSim(); });
  margin?.addEventListener('input', (e) => { sim.margin = +(e.target as HTMLInputElement).value; const v = $('#sim-margin-val'); if (v) v.textContent = (e.target as HTMLInputElement).value; updateSim(); });

  function set(id: string, text: string) { const el = $('#' + id); if (el) el.textContent = text; }
  function updateSim() {
    const lengthAdj = sim.weeks >= 26 ? 0.97 : sim.weeks <= 6 ? 1.04 : 1.0;
    const bill = sim.base * sim.region * sim.shift * sim.urg * lengthAdj;
    const pay = bill * (1 - sim.margin / 100);
    set('sim-bill', String(Math.round(bill)));
    set('sim-band', '$' + Math.round(bill * 0.95) + '–$' + Math.round(bill * 1.06));
    set('brk-base', '$' + sim.base);
    set('brk-region', '×' + sim.region.toFixed(2));
    set('brk-shift', '×' + sim.shift.toFixed(2));
    set('brk-urg', '×' + sim.urg.toFixed(2));
    set('brk-pay', '$' + Math.round(pay));
    set('brk-margin', '$' + Math.round(bill - pay) + '/hr · ' + sim.margin + '%');
  }
  updateSim();

  // Latest jobs are server-rendered; wire click/keydown to load the specialty.
  $$('#sim-latest .latest__item').forEach((el) => {
    const load = () => {
      const v = (el as HTMLElement).dataset.spec;
      if (v && [...specSel.options].some((o) => o.value === v)) {
        specSel.value = v;
        specSel.dispatchEvent(new Event('change'));
        const result = $('.sim__result');
        result?.animate(
          [{ boxShadow: '0 0 0 0 rgba(196,69,105,0.5)' }, { boxShadow: '0 0 0 8px rgba(196,69,105,0)' }],
          { duration: 600 },
        );
      }
    };
    el.addEventListener('click', load);
    el.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') { ke.preventDefault(); load(); }
    });
  });

  // PDF dropzone (prototype: reads the filename, applies suggested inputs).
  const drop = $('#sim-drop');
  const input = $<HTMLInputElement>('#sim-file');
  if (drop && input) {
    const idle = $('#sim-drop-idle');
    const loaded = $('#sim-drop-loaded');
    const nameEl = $('#sim-file-name');
    const chipsEl = $('#sim-file-chips');
    const handleFile = (file: File | undefined) => {
      if (!file || !idle || !loaded || !nameEl || !chipsEl) return;
      nameEl.textContent = file.name;
      chipsEl.innerHTML = PDF_CHIPS.map((c) =>
        `<span class="chip"><span class="chip__dot" style="background:var(--mn-cyan,#59BFE7);"></span>${c}</span>`).join('');
      (idle as HTMLElement).hidden = true;
      (loaded as HTMLElement).hidden = false;
      specSel.selectedIndex = 0;
      specSel.dispatchEvent(new Event('change'));
      const seg = (wrap: string, lbl: string) => {
        const b = $$('#' + wrap + ' .seg__opt').find((o) => (o as HTMLElement).dataset.lbl === lbl);
        if (b) (b as HTMLElement).click();
      };
      seg('sim-region', 'SE');
      seg('sim-shift', 'Nights');
    };
    $('#sim-browse')?.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
    idle?.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => handleFile((e.target as HTMLInputElement).files?.[0]));
    $('#sim-file-clear')?.addEventListener('click', () => { input.value = ''; if (loaded) (loaded as HTMLElement).hidden = true; if (idle) (idle as HTMLElement).hidden = false; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === idle) drop.classList.remove('is-drag'); }));
    drop.addEventListener('drop', (e) => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) handleFile(f); });
  }
})();

// ── Weekly sync · editable three-team board (shared via hub_weekly_sync) ───────
interface SyncIsland { weekKey: string; data: SyncSeed; persisted: Record<keyof SyncSeed, boolean>; }
(function weeklySync() {
  const board = $('#sync-board');
  if (!board) return;
  const COLS = [
    { id: 'recruiting' as const, name: 'Recruiting', color: 'var(--pop-magenta,#C44569)',
      icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'marketing' as const, name: 'Marketing / Creative', color: 'var(--pop-butter)',
      icon: '<path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
    { id: 'operations' as const, name: 'Operations', color: 'var(--mn-cyan,#59BFE7)',
      icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  ];
  const colIds = COLS.map((c) => c.id);
  // Hydrate from the server island: this week's board + per-column persisted
  // flags. A persisted column uses the server value; an un-persisted column
  // prefers the user's localStorage edits, else the seed starter template.
  let island: SyncIsland | null = null;
  const islandEl = document.getElementById('hub-sync');
  if (islandEl?.textContent) { try { island = JSON.parse(islandEl.textContent) as SyncIsland; } catch (e) { island = null; } }
  const weekKey = island?.weekKey ?? '';
  const LS_KEY = 'imsHubSync:' + weekKey;
  const seed = (): SyncSeed => JSON.parse(JSON.stringify(SYNC_SEED));
  let local: SyncSeed | null = null;
  try { local = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { local = null; }
  const base = island?.data ?? seed();
  const data: SyncSeed = { recruiting: [], marketing: [], operations: [] };
  colIds.forEach((id) => {
    if (island?.persisted?.[id]) data[id] = [...base[id]];
    else if (local && Array.isArray(local[id])) data[id] = [...local[id]];
    else data[id] = [...base[id]];
  });

  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } };
  // Persist a column: localStorage immediately (offline mirror) + a debounced
  // POST to the shared store. A failed POST is non-fatal — localStorage holds it.
  const timers: Partial<Record<keyof SyncSeed, ReturnType<typeof setTimeout>>> = {};
  function persist(col: keyof SyncSeed) {
    save();
    if (!weekKey) return;
    clearTimeout(timers[col]);
    timers[col] = setTimeout(() => {
      fetch('/hub/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ weekKey, columnKey: col, items: data[col] }),
      }).catch(() => { /* offline — localStorage holds it */ });
    }, 700);
  }

  function render() {
    board!.innerHTML = COLS.map((c) => `
      <div class="sync2-col" style="--c:${c.color}" data-col="${c.id}">
        <div class="sync2-col__head">
          <span class="sync2-col__ic" style="background:${c.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${c.icon}</svg></span>
          <div>
            <div class="sync2-col__name">${c.name}</div>
            <div class="sync2-col__count">${data[c.id].length} this week</div>
          </div>
        </div>
        <div class="sync2-col__body">
          ${data[c.id].map((t, i) => `
            <div class="sync2-item">
              <span class="sync2-item__tick"></span>
              <div class="sync2-item__txt" contenteditable="true" data-col="${c.id}" data-i="${i}">${esc(t)}</div>
              <button class="sync2-item__del" data-col="${c.id}" data-i="${i}" aria-label="Remove">×</button>
            </div>`).join('')}
          <button class="sync2-add" data-col="${c.id}"><span>+</span> Add a focus</button>
        </div>
      </div>`).join('');
    bind();
  }
  function bind() {
    $$<HTMLElement>('.sync2-item__txt', board!).forEach((el) => {
      el.addEventListener('blur', () => {
        const col = el.dataset.col as keyof SyncSeed;
        data[col][+(el.dataset.i || 0)] = (el.textContent || '').trim();
        persist(col);
      });
      el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); el.blur(); } });
    });
    $$<HTMLElement>('.sync2-item__del', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as keyof SyncSeed;
      data[col].splice(+(b.dataset.i || 0), 1); persist(col); render();
    }));
    $$<HTMLElement>('.sync2-add', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as keyof SyncSeed;
      data[col].push(''); persist(col); render();
      const colEl = $$('.sync2-col', board!).find((c) => (c as HTMLElement).dataset.col === col);
      const items = colEl ? $$('.sync2-item__txt', colEl) : [];
      const last = items[items.length - 1];
      if (last) (last as HTMLElement).focus();
    }));
  }
  $('#sync-reset')?.addEventListener('click', () => {
    const fresh = seed();
    colIds.forEach((id) => { data[id] = fresh[id]; persist(id); });
    render();
  });
  render();
})();

// ── Analytics charts — drawn on first view from the #hub-analytics data island ──
// (aggregateAnalytics over ims_jobs + ls_events). If the island is missing/empty
// we render an honest empty state — never fabricated seed numbers.
interface AnBar { name: string; val: number; fill: string; max: number; label?: string; }
interface MonthPoint { key: string; label: string; opened: number; avgDaysToClose: number | null; }
interface AnalyticsIsland {
  activeReqs: number;
  monthly: MonthPoint[];
  specialtyDonut: { name: string; val: number; color: string }[];
  topFacilities: AnBar[];
  daysToCloseBySpecialty: AnBar[];
}
function readAnalytics(): AnalyticsIsland | null {
  const el = document.getElementById('hub-analytics');
  if (!el || !el.textContent) return null;
  try { return JSON.parse(el.textContent) as AnalyticsIsland; } catch (e) { return null; }
}
function barsOrEmpty(host: HTMLElement | null, rows: AnBar[], empty: string) {
  if (!host) return;
  if (!rows.length) { host.innerHTML = `<p class="subtle">${empty}</p>`; return; }
  renderBars(host, rows);
}
let analyticsDrawn = false;
function drawAnalytics() {
  const a = readAnalytics();
  barsOrEmpty($('#an-filltime'), a?.daysToCloseBySpecialty ?? [], 'No close-time history yet.');
  barsOrEmpty($('#an-facilities'), a?.topFacilities ?? [], 'No facility data yet.');
  if (analyticsDrawn) return;
  analyticsDrawn = true;
  drawLine(a?.monthly ?? []);
  drawDonut(a?.specialtyDonut ?? [], a?.activeReqs ?? 0);
}
function drawLine(monthly: MonthPoint[]) {
  const svg = $('#line-chart');
  if (!svg) return;
  if (!monthly.length) { svg.innerHTML = ''; return; }
  const W = 600, Hh = 240, pad = 24, n = monthly.length;
  const opened = monthly.map((m, i) => ({ i, v: m.opened }));
  const days = monthly.map((m, i) => ({ i, v: m.avgDaysToClose })).filter((p): p is { i: number; v: number } => p.v !== null);
  const maxO = Math.max(1, ...opened.map((p) => p.v)) * 1.15;
  const maxD = Math.max(1, ...days.map((p) => p.v)) * 1.2;
  const x = (i: number) => pad + (n === 1 ? (W - pad * 2) / 2 : (i * (W - pad * 2)) / (n - 1));
  const yO = (v: number) => Hh - pad - (v / maxO) * (Hh - pad * 2);
  const yD = (v: number) => Hh - pad - (v / maxD) * (Hh - pad * 2);
  const line = (pts: { i: number; v: number }[], y: (v: number) => number) =>
    pts.map((p, k) => (k ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
  const area = line(opened, yO) + ` L${x(n - 1)} ${Hh - pad} L${x(0)} ${Hh - pad} Z`;
  let grid = '';
  for (let g = 0; g <= 4; g++) { const yy = pad + g * (Hh - pad * 2) / 4; grid += `<line class="lc-grid" x1="${pad}" y1="${yy}" x2="${W - pad}" y2="${yy}"/>`; }
  let labels = '';
  monthly.forEach((m, i) => { if (i % 2 === 0) labels += `<text class="lc-label" x="${x(i)}" y="${Hh - 6}" text-anchor="middle">${esc(m.label)}</text>`; });
  const dots = (pts: { i: number; v: number }[], y: (v: number) => number, color: string) =>
    pts.map((p) => `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="3" fill="${color}"/>`).join('');
  svg.innerHTML = grid +
    `<path d="${area}" fill="url(#lg)" opacity="0.18"/>` +
    `<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C44569"/><stop offset="100%" stop-color="#C44569" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${line(opened, yO)}" fill="none" stroke="#C44569" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    (days.length > 1 ? `<path d="${line(days, yD)}" fill="none" stroke="#59BFE7" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>` : '') +
    dots(opened, yO, '#C44569') + dots(days, yD, '#59BFE7') + labels;
}
function drawDonut(slices: { name: string; val: number; color: string }[], centerTotal: number) {
  const svg = $('#donut'), legend = $('#donut-legend');
  if (!svg || !legend) return;
  if (!slices.length) { svg.innerHTML = ''; legend.innerHTML = '<p class="subtle">No active reqs to chart.</p>'; return; }
  const total = slices.reduce((s, d) => s + d.val, 0) || 1;
  let offset = 25;
  const r = 15.915, c = 2 * Math.PI * r;
  svg.innerHTML = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="var(--bone)" stroke-width="6"/>` +
    slices.map((d) => {
      const len = (d.val / total) * 100;
      const seg = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${d.color}" stroke-width="6" stroke-dasharray="${(len / 100) * c} ${c}" stroke-dashoffset="${-((100 - offset) / 100) * c}" transform="rotate(-90 21 21)"/>`;
      offset += len;
      return seg;
    }).join('') +
    `<text class="donut-center" x="21" y="20" text-anchor="middle" font-size="6">${centerTotal}</text>` +
    `<text class="donut-sub" x="21" y="25" text-anchor="middle" font-size="2.6" letter-spacing="0.1">ACTIVE REQS</text>`;
  legend.innerHTML = slices.map((d) => `
    <div class="legend__row"><span class="legend__sw" style="background:${d.color}"></span><span class="legend__name">${esc(d.name)}</span><span class="legend__val">${Math.round((d.val / total) * 100)}%</span></div>`).join('');
}
