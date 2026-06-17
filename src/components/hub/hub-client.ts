// IMS Hub dashboard client — view switching, theme toggle, rate simulator, PDF
// dropzone, weekly-sync board, analytics charts. Bundled by Astro from 'self'
// (CSP-clean). Ported from design_handoff_hub/src/hub.js with the data source
// swapped from window.HUB to the typed seed module, and the Overview
// pipeline/activity + Simulator latest-list left to the server (we only wire
// their interactions here).
import {
  type BarRow,
} from '../../lib/hub/hub-seed';
import { haystackMatchesQuery } from '../../lib/job-search';
import {
  sanitizeHtml,
  escapeText,
  MAX_TITLE_LEN,
  type ColumnData,
  type ColumnKey,
} from '../../lib/hub/sync-data';
import { applyOp, type SyncOp } from '../../lib/hub/sync-ops';
import { comparableCol, mergeAdopt } from '../../lib/hub/sync-merge';
import { rosterEntry } from '../../lib/hub/hub-roster';

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

// ── Topbar search — live filter over the Overview's reqs + clinician activity ──
// Reuses the SAME typo-tolerant matcher /jobs + the homepage use (job-search.ts)
// so hub search behaves like the public job search. Filters the recent-activity
// feed (reqs + clinician names) and the active-pipeline rows (states +
// specialties); clearing (or Escape) restores everything. Searching from another
// view jumps to Overview so the matches are visible.
(function hubSearch() {
  const input = $<HTMLInputElement>('#hub-search');
  if (!input) return;
  const groups = ([
    { host: $('#activity-feed'), rowSel: '.feed__item' },
    { host: $('#pipeline-states'), rowSel: '.bar__row' },
    { host: $('#pipeline-specs'), rowSel: '.bar__row' },
  ].filter((g) => g.host) as { host: HTMLElement; rowSel: string }[]);
  if (!groups.length) return;

  // One injected "No matches." line per group, shown only when a non-empty query
  // hides every row in that group.
  const emptyEls = new Map<HTMLElement, HTMLElement>();
  groups.forEach((g) => {
    const p = document.createElement('p');
    p.className = 'subtle hub-search-empty';
    p.hidden = true;
    p.textContent = 'No matches.';
    g.host.appendChild(p);
    emptyEls.set(g.host, p);
  });

  const overview = $$('.hub-view').find((v) => (v as HTMLElement).dataset.view === 'overview') as HTMLElement | undefined;
  const apply = () => {
    const q = input.value.trim();
    if (q && overview && !overview.classList.contains('is-active')) showView('overview');
    groups.forEach((g) => {
      const rows = $$<HTMLElement>(g.rowSel, g.host);
      let shown = 0;
      rows.forEach((r) => {
        const hit = !q || haystackMatchesQuery(r.textContent || '', q);
        r.hidden = !hit;
        if (hit) shown++;
      });
      const empty = emptyEls.get(g.host);
      if (empty) empty.hidden = !(q !== '' && rows.length > 0 && shown === 0);
    });
  };
  input.addEventListener('input', apply);
  input.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') { input.value = ''; apply(); }
  });
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
})();

// ── Weekly Sync · live, shared standup board (v2: sections + rich-text focuses) ─
// Rebuilt 2026-06-15: blank-new-week, named sections, rich text, live polling,
// past-week history, confirm-Reset. Hydrates from #hub-sync, persists each
// changed column (debounced POST) + a localStorage mirror, and polls the viewed
// week to surface teammates' edits without clobbering what you are editing.
type Columns = Record<ColumnKey, ColumnData>;
interface SyncIsland { weekKey: string; columns: Columns; weeks: string[]; me: string; }
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
  const genId = (p: string) => p + '_' + (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).replace(/-/g, '').slice(0, 16);

  // ── State (hydrate from the SSR island: { weekKey, columns, weeks }) ──────────
  let island: SyncIsland | null = null;
  const islandEl = document.getElementById('hub-sync');
  if (islandEl?.textContent) { try { island = JSON.parse(islandEl.textContent) as SyncIsland; } catch (e) { island = null; } }
  const currentWeek = island?.weekKey ?? '';
  let viewedWeek = currentWeek;
  const me: string = island?.me ?? '';
  const nowS = () => Math.floor(Date.now() / 1000);

  const blankCols = (): Columns => ({ recruiting: { v: 3, sections: [] }, marketing: { v: 3, sections: [] }, operations: { v: 3, sections: [] } });
  // Ids land in data-* attributes + querySelector strings. Clean every incoming
  // id to the same [A-Za-z0-9_-] allowlist the server uses — a poll/island
  // response is never trusted raw (defense-in-depth vs a polluted DB row). html
  // and title are neutralized later (sanitizeHtml / escapeText at render time).
  const safeId = (raw: unknown, p: string) =>
    (typeof raw === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(raw)) ? raw : genId(p);
  function shape(input: Partial<Columns> | undefined): Columns {
    const out = blankCols();
    if (!input) return out;
    colIds.forEach((id) => {
      const c = input[id];
      if (!c || !Array.isArray(c.sections)) return;
      out[id] = {
        v: 3,
        sections: c.sections.map((s) => ({
          id: safeId(s && s.id, 's'),
          title: s && typeof s.title === 'string' ? s.title : '',
          by: s && typeof s.by === 'string' ? s.by : undefined,
          focuses: s && Array.isArray(s.focuses)
            ? s.focuses.map((f) => ({
                id: safeId(f && f.id, 'f'),
                html: f && typeof f.html === 'string' ? f.html : '',
                by: f && typeof f.by === 'string' ? f.by : '',
                createdAt: f && typeof f.createdAt === 'number' ? f.createdAt : 0,
                editedBy: f && typeof f.editedBy === 'string' ? f.editedBy : undefined,
                editedAt: f && typeof f.editedAt === 'number' ? f.editedAt : undefined,
              }))
            : [],
        })),
      };
    });
    return out;
  }
  let cols: Columns = shape(island?.columns);
  let epoch = 0; // bumped on reset / week-switch so stale in-flight writes + polls are ignored

  // Every column keeps >= 1 section so "Add a focus" is always available; a
  // brand-new (blank) week has zero sections server-side until the first edit.
  function ensureSection(c: ColumnData) { if (c.sections.length === 0) c.sections.push({ id: genId('s'), title: '', focuses: [] }); }
  function ensureAll() { colIds.forEach((id) => ensureSection(cols[id])); }

  // comparableCol + mergeAdopt are imported from sync-merge (unit-tested
  // independently of the DOM): comparableCol gives a stable content key that
  // includes attribution, so the poll/response adopts only on real change.

  // localStorage mirror (resilience if a POST fails), keyed by the viewed week.
  const lsKey = (week: string) => 'imsHubSyncV2:' + week;
  function saveLocal() { try { localStorage.setItem(lsKey(viewedWeek), JSON.stringify(cols)); } catch (e) { /* ignore */ } }
  function recoverFromLocal() {
    try {
      const raw = localStorage.getItem(lsKey(viewedWeek));
      if (!raw) return;
      const local = JSON.parse(raw) as Columns;
      colIds.forEach((id) => {
        const serverEmpty = !cols[id].sections.some((s) => s.focuses.length || s.title.trim());
        const localHas = local?.[id]?.sections?.some((s) => s.focuses.length || s.title.trim());
        if (serverEmpty && localHas) cols[id] = { v: 3, sections: local[id].sections };
      });
    } catch (e) { /* ignore */ }
  }

  // ── Visible save status ───────────────────────────────────────────────────────
  const statusEl = document.getElementById('sync-status');
  let statusClear: ReturnType<typeof setTimeout> | undefined;
  type SaveState = 'saving' | 'saved' | 'signedout' | 'error';
  function setStatus(state: SaveState) {
    if (!statusEl) return;
    clearTimeout(statusClear);
    const map: Record<SaveState, { txt: string; cls: string }> = {
      saving: { txt: 'Saving…', cls: 'is-saving' },
      saved: { txt: 'Saved ✓', cls: 'is-saved' },
      signedout: { txt: 'Sign-in expired — refresh to save', cls: 'is-error' },
      error: { txt: 'Couldn’t save — will retry', cls: 'is-error' },
    };
    const s = map[state];
    statusEl.textContent = s.txt;
    statusEl.className = 'sync2-status ' + s.cls;
    if (state === 'saved') statusClear = setTimeout(() => {
      if (statusEl.classList.contains('is-saved')) { statusEl.textContent = ''; statusEl.className = 'sync2-status'; }
    }, 2200);
  }

  // ── Persistence (per-op, optimistic) ─────────────────────────────────────────
  // Each edit is a single intent op (applyOp already mutated `cols` optimistically
  // at the call site). `sendOp` POSTs that ONE op; the server applies it
  // atomically via the RPC and echoes the authoritative column back, which we
  // `adopt` (mergeAdopt keeps the focus under the live caret). `redirect:'manual'`
  // so an auth 302 is NOT followed to the login HTML (the old silent-save bug); an
  // opaque redirect / 401 surfaces as a sign-in lapse. A reset / week-switch bumps
  // `epoch`, voiding any in-flight or queued op so it can't clobber the new view.
  //
  // Per-column version monotonicity: the server stamps each column with a version;
  // `adopt` drops a response/poll older than what we've already adopted. Per-focus
  // sequence (latestSeqByFocus): a retry only fires if no NEWER op for that focus
  // has since been sent — a stale retry can never resurrect superseded text.
  // NOTE: version is per-(week,column), so this map MUST be reset on a week switch
  // (and on reset) — otherwise after editing the current week to a high version,
  // switching to a lower-versioned past week would make every poll's adopt fail
  // the monotonicity guard and the past week would stop receiving live updates.
  let colVersion: Partial<Record<ColumnKey, number>> = {};
  let opSeq = 0;
  const latestSeqByFocus = new Map<string, number>();

  // The editable the caret is in right now — a focus OR a section title, in ANY
  // column. The board commits to `cols` only on blur, so during active typing the
  // live DOM is the SOLE holder of the uncommitted text + caret. adopt() snapshots
  // this before it re-renders and restores it after, so a teammate's edit landing
  // mid-typing never wipes your keystrokes or jumps your caret (the headline
  // collaboration guarantee). mergeAdopt protects the model slot; this protects
  // the on-screen DOM, which mergeAdopt alone cannot (cols is behind the DOM).
  type ActiveEdit = { el: HTMLElement; col: ColumnKey; sec: string; foc: string | null; kind: 'focus' | 'title' };
  function activeEdit(): ActiveEdit | null {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !board!.contains(a)) return null;
    const col = a.dataset?.col as ColumnKey | undefined;
    const sec = a.dataset?.sec;
    if (!col || !sec || !cols[col]) return null;
    if (a.classList.contains('sync2-item__txt') && a.dataset.foc) return { el: a, col, sec, foc: a.dataset.foc, kind: 'focus' };
    if (a.classList.contains('sync2-sec__title')) return { el: a, col, sec, foc: null, kind: 'title' };
    return null;
  }
  // Caret position as a character offset into the editable's textContent. Counting
  // by visible chars (not DOM nodes) makes it survive the sanitize/re-render
  // round-trip even across <b>/<mark> formatting. -1 → put the caret at the end.
  function caretOffset(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return -1;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.endContainer)) return -1;
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }
  function restoreCaret(el: HTMLElement, offset: number) {
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    if (offset < 0) { r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); return; }
    let remaining = offset;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    let target: Node | null = null; let pos = 0;
    while (node) {
      const len = node.textContent ? node.textContent.length : 0;
      if (remaining <= len) { target = node; pos = remaining; break; }
      remaining -= len; target = node; pos = len;
      node = walker.nextNode();
    }
    if (target) r.setStart(target, Math.min(pos, target.textContent ? target.textContent.length : 0));
    else { r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); return; }
    r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  }
  function findEditable(ed: ActiveEdit): HTMLElement | null {
    const q = ed.kind === 'focus'
      ? `.sync2-item__txt[data-foc="${ed.foc}"]`
      : `.sync2-sec__title[data-sec="${ed.sec}"]`;
    return board!.querySelector(q) as HTMLElement | null;
  }
  function adopt(col: ColumnKey, incoming: ColumnData, version?: number) {
    if (typeof version === 'number') {
      if ((colVersion[col] ?? -1) > version) return;
      colVersion[col] = version;
    }
    const shaped = shape({ [col]: incoming } as Partial<Columns>)[col];
    // Short-circuit on the COMMITTED state: if nothing the team committed changed,
    // don't touch the DOM (so our own in-progress typing never triggers a render).
    if (comparableCol(shaped) === comparableCol(cols[col])) return;
    // Something real changed → snapshot whatever editable the caret is in (any
    // column — render() rebuilds the whole board), merge + render, then restore
    // that editable's live content + caret verbatim on top of the fresh DOM.
    const ed = activeEdit();
    // Snapshot the live editable as its SANITIZED value (what a blur-commit would
    // store) so the restore below sets sanitized innerHTML — never raw, possibly
    // pasted, markup. No trim, so a just-typed trailing space isn't dropped.
    const snap = ed
      ? {
          ed,
          html: ed.kind === 'focus'
            ? readFocusHtml(ed.el, false)
            // slice the RAW text to the cap THEN escape, so a near-cap title can't
            // be cut mid-entity (e.g. "&am") — visible chars, not entity chars.
            : escapeText((ed.el.textContent || '').slice(0, MAX_TITLE_LEN)),
          off: caretOffset(ed.el),
        }
      : null;
    const keepFocus = ed && ed.col === col && ed.kind === 'focus' ? ed.foc : null;
    cols[col] = mergeAdopt(cols[col], shaped, keepFocus);
    ensureSection(cols[col]); saveLocal(); render();
    if (snap) {
      const el2 = findEditable(snap.ed);
      if (el2) { el2.innerHTML = snap.html; restoreCaret(el2, snap.off); }
    }
  }
  function scheduleRetry(col: ColumnKey, op: SyncOp, focusKey: string | undefined, mySeq: number) {
    setStatus('error');
    setTimeout(() => {
      if (focusKey && latestSeqByFocus.get(col + ':' + focusKey) !== mySeq) return;
      sendOp(col, op, focusKey);
    }, 3000);
  }
  function sendOp(col: ColumnKey, op: SyncOp, focusKey?: string) {
    saveLocal();
    if (!viewedWeek) return;
    const myEpoch = epoch, myWeek = viewedWeek, mySeq = ++opSeq;
    if (focusKey) latestSeqByFocus.set(col + ':' + focusKey, mySeq);
    setStatus('saving');
    (async () => {
      try {
        const res = await fetch('/hub/api/sync', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', redirect: 'manual',
          body: JSON.stringify({ weekKey: myWeek, columnKey: col, op }),
        });
        if (epoch !== myEpoch || viewedWeek !== myWeek) return;
        if (res.type === 'opaqueredirect' || res.status === 401) { setStatus('signedout'); return; }
        if (res.ok) {
          const b = await res.json();
          setStatus('saved');
          if (b && b.ok && b.column && epoch === myEpoch && viewedWeek === myWeek) adopt(col, b.column, b.version);
        } else { scheduleRetry(col, op, focusKey, mySeq); }
      } catch (e) {
        if (epoch !== myEpoch || viewedWeek !== myWeek) return;
        scheduleRetry(col, op, focusKey, mySeq);
      }
    })();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const findSec = (col?: string, sec?: string) => (col && cols[col as ColumnKey] ? cols[col as ColumnKey].sections.find((s) => s.id === sec) : undefined) || null;
  // contenteditable can wrap lines in block tags (Enter/paste) — flatten them.
  // Closers become <br>, NOT a space: a <br> contributes 0 chars to textContent
  // (so caretOffset, which counts visible chars on the LIVE DOM, round-trips when
  // the snapshot is restored — a space would shift the caret one char per block
  // boundary) and it's an allowed tag, so the user's line break survives. Drop the
  // trailing <br> the final closer leaves. `trim` is true for a commit (drop edge
  // whitespace); false for a live snapshot (keep an in-flight trailing space).
  function readFocusHtml(el: HTMLElement, trim = true): string {
    const h = el.innerHTML.replace(/<\/(div|p)>/gi, '<br>').replace(/<(div|p)[^>]*>/gi, '').replace(/&nbsp;/gi, ' ');
    const s = sanitizeHtml(h).replace(/(?:<br>)+$/gi, '');
    return trim ? s.trim() : s;
  }

  // Attribution chip: the colored initials of the author (and, on hover, the
  // editor if different). Author/editor never fabricated — an empty `by` shows a
  // neutral "Author unknown" avatar. esc() guards every roster string.
  function avatarHtml(f: { by?: string; editedBy?: string }): string {
    const who = f.by || '';
    const e = rosterEntry(who);
    const title = who
      ? `Added by ${esc(e.name)}${f.editedBy && f.editedBy !== who ? ' · edited by ' + esc(rosterEntry(f.editedBy).name) : ''}`
      : 'Author unknown';
    return `<span class="sync2-item__avatar" style="--av:${e.color}" title="${title}" aria-label="${title}">${esc(e.initials)}</span>`;
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render() {
    board!.innerHTML = COLS.map((c) => {
      const col = cols[c.id];
      const count = col.sections.reduce((n, s) => n + s.focuses.length, 0);
      const showTitles = col.sections.length > 1 || col.sections.some((s) => s.title.trim() !== '');
      const sections = col.sections.map((sec) => `
        <div class="sync2-sec" data-col="${c.id}" data-sec="${sec.id}">
          ${showTitles ? `
          <div class="sync2-sec__head">
            <div class="sync2-sec__title" contenteditable="true" role="textbox" aria-label="Section name" data-ph="Name this section" data-col="${c.id}" data-sec="${sec.id}">${escapeText(sec.title)}</div>
            <button class="sync2-sec__del" data-col="${c.id}" data-sec="${sec.id}" aria-label="Remove section" title="Remove section">×</button>
          </div>` : ''}
          <div class="sync2-sec__items">
            ${sec.focuses.map((f) => `
            <div class="sync2-item" data-col="${c.id}" data-sec="${sec.id}" data-foc="${f.id}">
              <span class="sync2-item__tick"></span>
              <div class="sync2-item__txt" contenteditable="true" role="textbox" aria-label="Focus" data-ph="Add a focus…" data-col="${c.id}" data-sec="${sec.id}" data-foc="${f.id}">${sanitizeHtml(f.html)}</div>
              ${avatarHtml(f)}
              <button class="sync2-item__del" data-col="${c.id}" data-sec="${sec.id}" data-foc="${f.id}" aria-label="Remove focus">×</button>
            </div>`).join('')}
            <button class="sync2-add" data-col="${c.id}" data-sec="${sec.id}"><span>+</span> Add a focus</button>
          </div>
        </div>`).join('');
      return `
      <div class="sync2-col" style="--c:${c.color}" data-col="${c.id}">
        <div class="sync2-col__head">
          <span class="sync2-col__ic" style="background:${c.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${c.icon}</svg></span>
          <div>
            <div class="sync2-col__name">${c.name}</div>
            <div class="sync2-col__count">${count} ${count === 1 ? 'focus' : 'focuses'}${col.sections.length > 1 ? ' · ' + col.sections.length + ' sections' : ''}</div>
          </div>
        </div>
        <div class="sync2-col__body">
          ${sections}
          <button class="sync2-addsec" data-col="${c.id}"><span>+</span> Add section</button>
        </div>
      </div>`;
    }).join('');
    bind();
  }

  function focusEnd(el: HTMLElement) {
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sel = window.getSelection(); if (sel) { sel.removeAllRanges(); sel.addRange(r); }
  }

  function updateCount(col: ColumnKey) {
    const colEl = $$('.sync2-col', board!).find((c) => (c as HTMLElement).dataset.col === col);
    const countEl = colEl ? colEl.querySelector('.sync2-col__count') : null;
    if (!countEl) return;
    const c = cols[col];
    const n = c.sections.reduce((acc, s) => acc + s.focuses.length, 0);
    countEl.textContent = `${n} ${n === 1 ? 'focus' : 'focuses'}` + (c.sections.length > 1 ? ' · ' + c.sections.length + ' sections' : '');
  }

  function bind() {
    // Focus (rich-text) edits → upsertFocus op (idempotent; only stamps editedBy
    // when html actually changes — applyOp enforces that).
    $$<HTMLElement>('.sync2-item__txt', board!).forEach((el) => {
      el.addEventListener('blur', () => {
        // A blur fired because an adopt-driven render() detached this node is NOT
        // a real commit — the live text is restored separately. Ignore it so a
        // half-typed op never leaks out (and stale cols isn't written back).
        if (!el.isConnected) return;
        const col = el.dataset.col as ColumnKey;
        const s = findSec(el.dataset.col, el.dataset.sec);
        const f = s ? s.focuses.find((x) => x.id === el.dataset.foc) : undefined;
        hideRt();
        if (!f) return;
        const html = readFocusHtml(el);
        if (html === f.html) return;
        const op = { type: 'upsertFocus', sectionId: el.dataset.sec!, focus: { id: el.dataset.foc!, html } } as const;
        cols[col] = applyOp(cols[col], op, { email: me, now: nowS() });
        // Reflect the authoritative sanitized result back into the editable.
        const updated = cols[col].sections.find((x) => x.id === el.dataset.sec)?.focuses.find((x) => x.id === el.dataset.foc);
        el.innerHTML = updated ? updated.html : html;
        updateCount(col);
        sendOp(col, op, el.dataset.foc!);
      });
      el.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' && !ke.shiftKey) { e.preventDefault(); el.blur(); }
      });
    });
    // Section title edits → setSectionTitle op.
    $$<HTMLElement>('.sync2-sec__title', board!).forEach((el) => {
      el.addEventListener('blur', () => {
        if (!el.isConnected) return; // detached by an adopt-driven re-render — not a real commit
        const col = el.dataset.col as ColumnKey;
        const s = findSec(el.dataset.col, el.dataset.sec); if (!s) return;
        // slice the RAW text to the cap THEN escape (matches the adopt() snapshot
        // path), so a near-cap title can't be cut mid-entity into "&am".
        const title = escapeText((el.textContent || '').trim().slice(0, MAX_TITLE_LEN));
        if (title === s.title) return;
        const op = { type: 'setSectionTitle', sectionId: el.dataset.sec!, title } as const;
        cols[col] = applyOp(cols[col], op, { email: me, now: nowS() });
        // Reflect the canonical title (applyOp escapes + caps it).
        const updated = cols[col].sections.find((x) => x.id === el.dataset.sec);
        el.innerHTML = updated ? updated.title : title;
        sendOp(col, op);
      });
      el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); el.blur(); } });
    });
    // Delete a focus → deleteFocus op.
    $$<HTMLElement>('.sync2-item__del', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as ColumnKey;
      const s = findSec(b.dataset.col, b.dataset.sec); if (!s) return;
      const op = { type: 'deleteFocus', sectionId: b.dataset.sec!, focusId: b.dataset.foc! } as const;
      cols[col] = applyOp(cols[col], op, { email: me, now: nowS() });
      sendOp(col, op); render();
    }));
    // Delete a section (confirm if it holds anything) → deleteSection op.
    $$<HTMLElement>('.sync2-sec__del', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as ColumnKey;
      const c = cols[col]; if (!c) return;
      const sec = c.sections.find((s) => s.id === b.dataset.sec);
      if (sec && (sec.focuses.length || sec.title.trim()) && !confirm('Remove this section and its focuses?')) return;
      const op = { type: 'deleteSection', sectionId: b.dataset.sec! } as const;
      cols[col] = applyOp(cols[col], op, { email: me, now: nowS() });
      ensureSection(c); // keep >= 1 section for the UI (matches prior behavior)
      sendOp(col, op); render();
    }));
    // Add a focus (to this section) → upsertFocus op (blank html; caret moves in).
    $$<HTMLElement>('.sync2-add', board!).forEach((b) => b.addEventListener('click', () => {
      const s = findSec(b.dataset.col, b.dataset.sec); if (!s) return;
      const col = b.dataset.col as ColumnKey;
      const f = { id: genId('f'), html: '' };
      const op = { type: 'upsertFocus', sectionId: s.id, focus: f } as const;
      cols[col] = applyOp(cols[col], op, { email: me, now: nowS() });
      render();
      const el = board!.querySelector(`.sync2-item__txt[data-foc="${f.id}"]`) as HTMLElement | null;
      if (el) focusEnd(el);
      sendOp(col, op, f.id);
    }));
    // Add a section (to this column) → addSection op.
    $$<HTMLElement>('.sync2-addsec', board!).forEach((b) => b.addEventListener('click', () => {
      const col = b.dataset.col as ColumnKey;
      const c = cols[col]; if (!c) return;
      const sec = { id: genId('s'), title: '' };
      const op = { type: 'addSection', section: sec } as const;
      cols[col] = applyOp(cols[col], op, { email: me, now: nowS() });
      render();
      const el = board!.querySelector(`.sync2-sec__title[data-sec="${sec.id}"]`) as HTMLElement | null;
      if (el) el.focus();
      sendOp(col, op);
    }));
  }

  // ── Rich-text toolbar (floating; Bold / Italic / Highlight) ─────────────────────
  const rt = document.getElementById('sync-rt');
  try { document.execCommand('styleWithCSS', false, 'false'); } catch (e) { /* emit <b>/<i>, not spans */ }
  function hideRt() { if (rt) rt.hidden = true; }
  function showRtForSelection() {
    if (!rt) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideRt(); return; }
    const node = sel.anchorNode;
    const host = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
    const focusEl = host ? (host.closest('.sync2-item__txt') as HTMLElement | null) : null;
    if (!focusEl || !board!.contains(focusEl)) { hideRt(); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { hideRt(); return; }
    rt.hidden = false;
    const top = window.scrollY + rect.top - rt.offsetHeight - 8;
    const left = window.scrollX + rect.left + rect.width / 2 - rt.offsetWidth / 2;
    rt.style.top = Math.max(window.scrollY + 8, top) + 'px';
    rt.style.left = Math.max(8, left) + 'px';
  }
  document.addEventListener('selectionchange', showRtForSelection);
  function toggleMark() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    let anc: Node | null = range.commonAncestorContainer;
    let markEl: HTMLElement | null = null;
    while (anc && anc !== board) { if (anc.nodeType === 1 && (anc as HTMLElement).tagName === 'MARK') { markEl = anc as HTMLElement; break; } anc = anc.parentNode; }
    if (markEl) {
      const parent = markEl.parentNode; if (!parent) return;
      while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
      parent.removeChild(markEl);
    } else {
      try { const m = document.createElement('mark'); range.surroundContents(m); }
      catch (e) { document.execCommand('insertHTML', false, '<mark>' + escapeText(sel.toString()) + '</mark>'); }
    }
  }
  rt?.querySelectorAll<HTMLElement>('[data-rt]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the editable's selection + focus
      const cmd = btn.dataset.rt;
      if (cmd === 'bold') document.execCommand('bold');
      else if (cmd === 'italic') document.execCommand('italic');
      else if (cmd === 'mark') toggleMark();
    });
  });

  // ── Week picker (past-week history) ─────────────────────────────────────────────
  const weekSel = document.getElementById('sync-week') as HTMLSelectElement | null;
  function updateHeader() {
    const label = document.getElementById('sync-week-label'); if (label) label.textContent = viewedWeek;
    const title = document.getElementById('sync-title');
    const eyebrow = document.getElementById('sync-eyebrow');
    const isCurrent = viewedWeek === currentWeek;
    if (title) title.textContent = isCurrent ? 'This week, by team' : 'Earlier week, by team';
    if (eyebrow) eyebrow.textContent = isCurrent ? 'Monday standup' : 'Past standup';
  }
  weekSel?.addEventListener('change', async () => {
    viewedWeek = weekSel.value || currentWeek;
    const myEpoch = ++epoch; // void in-flight writes/polls for the previous view
    colVersion = {}; // version is per-(week,column); the new week starts its own timeline
    const myWeek = viewedWeek;
    updateHeader();
    if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.className = 'sync2-status is-saving'; }
    try {
      const res = await fetch('/hub/api/sync?week=' + encodeURIComponent(myWeek), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (myEpoch !== epoch || myWeek !== viewedWeek) return; // switched again mid-load
      if (res.type === 'opaqueredirect' || res.status === 401) { setStatus('signedout'); return; }
      if (res.ok) { const b = await res.json(); if (myEpoch !== epoch || myWeek !== viewedWeek) return; cols = b && b.ok && b.columns ? shape(b.columns) : blankCols(); }
      else cols = blankCols();
    } catch (e) { if (myEpoch !== epoch || myWeek !== viewedWeek) return; cols = blankCols(); }
    if (viewedWeek === currentWeek) recoverFromLocal(); // only the live week recovers local drafts
    ensureAll();
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'sync2-status'; }
    render();
  });

  // ── Reset (shared + destructive → confirm) ─────────────────────────────────────
  $('#sync-reset')?.addEventListener('click', () => {
    const which = viewedWeek === currentWeek ? "this week's" : `the ${viewedWeek}`;
    if (!confirm(`Clear ${which} board for the whole team? This can't be undone.`)) return;
    epoch++; // void any in-flight pre-reset op so it can't resurrect cleared content
    colVersion = {}; // re-baseline the version guard for the cleared board
    colIds.forEach((id) => { cols[id] = { v: 3, sections: [] }; ensureSection(cols[id]); sendOp(id, { type: 'clearColumn' }); });
    render();
  });

  // ── Live polling (merge teammates' edits; never clobber active editing) ─────────
  // Per-focus adoption is delegated to adopt()/mergeAdopt: it keeps the focus
  // currently under the caret as the LIVE local copy and adopts everything else,
  // and the per-column version guard drops a stale snapshot. `epoch`/`viewedWeek`
  // guards drop a response that arrives after a reset or week-switch.
  async function poll() {
    if (!viewedWeek) return;
    const myWeek = viewedWeek, myEpoch = epoch;
    try {
      const res = await fetch('/hub/api/sync?week=' + encodeURIComponent(myWeek), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      if (myWeek !== viewedWeek || myEpoch !== epoch) return;
      const b = await res.json();
      if (!b || !b.ok || !b.columns || myWeek !== viewedWeek || myEpoch !== epoch) return;
      colIds.forEach((id) => { if (b.columns[id]) adopt(id, b.columns[id], b.columns[id].version); });
    } catch (e) { /* offline; keep local */ }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  recoverFromLocal();
  ensureAll();
  updateHeader();
  render();
  window.setInterval(poll, 4000);
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
