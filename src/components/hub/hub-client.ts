// IMS Hub dashboard client — view switching, theme toggle, rate simulator, PDF
// dropzone, weekly-sync board, analytics/costs charts. Bundled by Astro from
// 'self' (CSP-clean). Ported from design_handoff_hub/src/hub.js with the data
// source swapped from window.HUB to the typed seed module, and the Overview
// pipeline/activity + Simulator latest-list left to the server (we only wire
// their interactions here).
import {
  type BarRow,
  type FeedItem,
  DONUT,
  LINE_MONTHS,
  LINE_PLACEMENTS,
  LINE_FILL_DAYS,
  FILLTIME,
  FACILITIES,
  COST_ROWS,
  COST_CATS,
  COST_TOOLS,
  PDF_CHIPS,
  SYNC_SEED,
  type SyncSeed,
} from '../../lib/hub/hub-seed';

const $ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document): T | null => c.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document): T[] => Array.from(c.querySelectorAll<T>(s));
const fillClass = (f: string) => 'fill--' + f;

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
  sync: 'Weekly Sync', costs: 'Costs',
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

// ── Renderers (used by Analytics + Costs; Overview is server-rendered) ─────────
function renderBars(host: HTMLElement | null, rows: BarRow[], maxOverride?: number) {
  if (!host) return;
  const max = maxOverride || Math.max(...rows.map((r) => r.val));
  host.innerHTML = rows.map((r) => {
    const pct = Math.round((r.val / (r.max || max)) * 100);
    return `
      <div class="bar__row">
        <span class="bar__name">${r.name}</span>
        <span class="bar__track"><span class="bar__fill ${fillClass(r.fill)}" style="width:${pct}%"></span></span>
        <span class="bar__val">${r.label || r.val}</span>
      </div>`;
  }).join('');
}
function renderFeed(host: HTMLElement | null, items: FeedItem[]) {
  if (!host) return;
  host.innerHTML = items.map((i) => `
    <div class="feed__item">
      <span class="feed__dot" style="background:${i.color};${i.txtColor ? 'color:' + i.txtColor + ';' : ''}">${i.who}</span>
      <span class="feed__txt">${i.txt}</span>
      <span class="feed__time">${i.time}</span>
    </div>`).join('');
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
  const sim = { base: 260, region: 1, shift: 1, urg: 1, weeks: 12, margin: 22 };
  const specSel = $<HTMLSelectElement>('#sim-spec');
  if (!specSel) return;

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
      specSel.value = '260';
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

// ── Weekly sync · editable three-team board ────────────────────────────────────
(function weeklySync() {
  const board = $('#sync-board');
  if (!board) return;
  const KEY = 'imsHubSync';
  const COLS = [
    { id: 'recruiting' as const, name: 'Recruiting', color: 'var(--pop-magenta,#C44569)',
      icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'marketing' as const, name: 'Marketing / Creative', color: 'var(--pop-butter)',
      icon: '<path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
    { id: 'operations' as const, name: 'Operations', color: 'var(--mn-cyan,#59BFE7)',
      icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  ];
  let data: SyncSeed;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null') || JSON.parse(JSON.stringify(SYNC_SEED)); }
  catch (e) { data = JSON.parse(JSON.stringify(SYNC_SEED)); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } };
  const escapeHtml = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));

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
              <div class="sync2-item__txt" contenteditable="true" data-col="${c.id}" data-i="${i}">${escapeHtml(t)}</div>
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
        save();
      });
      el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); el.blur(); } });
    });
    $$<HTMLElement>('.sync2-item__del', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as keyof SyncSeed;
      data[col].splice(+(b.dataset.i || 0), 1); save(); render();
    }));
    $$<HTMLElement>('.sync2-add', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as keyof SyncSeed;
      data[col].push(''); save(); render();
      const colEl = $$('.sync2-col', board!).find((c) => (c as HTMLElement).dataset.col === col);
      const items = colEl ? $$('.sync2-item__txt', colEl) : [];
      const last = items[items.length - 1];
      if (last) (last as HTMLElement).focus();
    }));
  }
  $('#sync-reset')?.addEventListener('click', () => { data = JSON.parse(JSON.stringify(SYNC_SEED)); save(); render(); });
  render();
})();

// ── Costs ──────────────────────────────────────────────────────────────────────
(function costs() {
  const rows = $('#cost-rows');
  if (rows) rows.innerHTML = COST_ROWS.map((r) => `    <tr>
      <td><span class="cost-agent"><span class="cost-agent__av" style="background:${r.color}">${r.av}</span><span class="cost-agent__name">${r.name}</span></span></td>
      <td>${r.reqs}</td>
      <td>${r.placements}</td>
      <td><span class="cost-bar"><span class="cost-bar__fill" style="width:${r.share}%"></span></span></td>
      <td class="num">${r.spend}</td>
    </tr>`).join('');
  renderBars($('#cost-cats'), COST_CATS);
  renderFeed($('#cost-tools'), COST_TOOLS);
})();

// ── Analytics charts (drawn on first view) ─────────────────────────────────────
let analyticsDrawn = false;
function drawAnalytics() {
  renderBars($('#an-filltime'), FILLTIME);
  renderBars($('#an-facilities'), FACILITIES);
  if (analyticsDrawn) return;
  analyticsDrawn = true;
  drawLine();
  drawDonut();
}
function drawLine() {
  const svg = $('#line-chart');
  if (!svg) return;
  const W = 600, Hh = 240, pad = 24;
  const months = LINE_MONTHS, p = LINE_PLACEMENTS, f = LINE_FILL_DAYS;
  const maxP = Math.max(...p) * 1.15, maxF = Math.max(...f) * 1.2;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (months.length - 1);
  const yP = (v: number) => Hh - pad - (v / maxP) * (Hh - pad * 2);
  const yF = (v: number) => Hh - pad - (v / maxF) * (Hh - pad * 2);
  const path = (arr: number[], y: (v: number) => number) => arr.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = path(p, yP) + ` L${x(p.length - 1)} ${Hh - pad} L${x(0)} ${Hh - pad} Z`;
  let grid = '';
  for (let g = 0; g <= 4; g++) { const yy = pad + g * (Hh - pad * 2) / 4; grid += `<line class="lc-grid" x1="${pad}" y1="${yy}" x2="${W - pad}" y2="${yy}"/>`; }
  let labels = '';
  months.forEach((m, i) => { if (i % 2 === 0) labels += `<text class="lc-label" x="${x(i)}" y="${Hh - 6}" text-anchor="middle">${m}</text>`; });
  const dots = (arr: number[], y: (v: number) => number, color: string) => arr.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${color}"/>`).join('');
  svg.innerHTML = grid +
    `<path d="${area}" fill="url(#lg)" opacity="0.18"/>` +
    `<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C44569"/><stop offset="100%" stop-color="#C44569" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${path(p, yP)}" fill="none" stroke="#C44569" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${path(f, yF)}" fill="none" stroke="#59BFE7" stroke-width="2.5" stroke-dasharray="5 5" stroke-linecap="round"/>` +
    dots(p, yP, '#C44569') + dots(f, yF, '#59BFE7') + labels;
}
function drawDonut() {
  const svg = $('#donut'), legend = $('#donut-legend');
  if (!svg || !legend) return;
  const total = DONUT.reduce((s, d) => s + d.val, 0);
  let offset = 25;
  const r = 15.915, c = 2 * Math.PI * r;
  svg.innerHTML = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="var(--bone)" stroke-width="6"/>` +
    DONUT.map((d) => {
      const len = (d.val / total) * 100;
      const seg = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${d.color}" stroke-width="6" stroke-dasharray="${(len / 100) * c} ${c}" stroke-dashoffset="${-((100 - offset) / 100) * c}" transform="rotate(-90 21 21)"/>`;
      offset += len;
      return seg;
    }).join('') +
    `<text class="donut-center" x="21" y="20" text-anchor="middle" font-size="6">214</text>` +
    `<text class="donut-sub" x="21" y="25" text-anchor="middle" font-size="2.6" letter-spacing="0.1">PLACEMENTS</text>`;
  legend.innerHTML = DONUT.map((d) => `
    <div class="legend__row"><span class="legend__sw" style="background:${d.color}"></span><span class="legend__name">${d.name}</span><span class="legend__val">${d.val}%</span></div>`).join('');
}
