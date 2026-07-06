// src/components/hub/pipeline-client.ts
// Client controller for the Recruitment & Credentialing board. Renders lanes from
// the SSR island, keeps an id-keyed people map, and (Tasks 7-10) persists ops
// optimistically + polls for live updates. Mirrors the Weekly Sync client spine.
import {
  readPerson, groupByStage, checklistCount,
  BOARD_STAGES, STAGE_LABELS, CHECKLIST_KEYS, CHECKLIST_LABELS, chkCol,
  type PipelinePerson, type BoardStage,
} from '../../lib/hub/pipeline-data';
import { rosterEntry } from '../../lib/hub/hub-roster';
import { applyOp, type PipelineOp } from '../../lib/hub/pipeline-ops';
import { rosterPickerList } from '../../lib/hub/hub-roster';

(function pipeline() {
  const board = document.getElementById('pipe-board');
  const root = document.querySelector<HTMLElement>('[data-view="pipeline"]');
  if (!board || !root) return;

  // Lane accent classes map to tokens in hub.css (.pipe-lane--<stage>).
  const LANE_META: Record<BoardStage, { cls: string }> = {
    warm_lead: { cls: 'warm' }, active_bid: { cls: 'bid' }, accepted_bid: { cls: 'acc' },
    needs_onboarding: { cls: 'onb' }, placed: { cls: 'placed' },
  };

  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

  // ── State (hydrate from the #hub-pipeline island) ─────────────────────────────
  let me = '';
  const people = new Map<string, PipelinePerson>();
  const islandEl = document.getElementById('hub-pipeline');
  if (islandEl?.textContent) {
    try {
      const island = JSON.parse(islandEl.textContent) as { people?: unknown[]; me?: string };
      me = typeof island.me === 'string' ? island.me : '';
      (island.people ?? []).forEach((raw) => { const p = readPerson(raw); if (p.id) people.set(p.id, p); });
    } catch { /* empty board */ }
  }

  const initials = (p: PipelinePerson) => (p.full_name.replace(/^dr\.?\s*/i, '').trim()[0] || '?').toUpperCase();
  function ownerAvatar(p: PipelinePerson): string {
    const e = rosterEntry(p.owner_email || '');
    const title = p.owner_email ? `Owner · ${esc(e.name)}` : 'No owner';
    return `<span class="pipe-owner" style="--av:${e.color}" title="${title}">${esc(e.initials)}</span>`;
  }

  function cardHtml(p: PipelinePerson): string {
    const done = checklistCount(p);
    const meter = CHECKLIST_KEYS.map((k) => `<i class="${p[chkCol(k)] ? 'on' : ''}"></i>`).join('');
    const spec = p.specialty_name || p.specialty_slug;
    const metaBits = [p.state, p.target_start_date].filter(Boolean).map((x) => esc(x as string)).join(' · ');
    return `
      <article class="pipe-card" draggable="true" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.full_name)}">
        <div class="pipe-card__top">
          <span class="pipe-av">${esc(initials(p))}</span>
          <div class="pipe-card__id">
            <div class="pipe-card__name">${esc(p.full_name)}</div>
            ${spec ? `<span class="pipe-spec">${esc(spec)}</span>` : ''}
          </div>
        </div>
        ${metaBits ? `<div class="pipe-card__meta">${metaBits}</div>` : ''}
        <div class="pipe-cred" aria-label="Credentialing ${done} of 6">
          <div class="pipe-cred__lbl">Credentialing <span class="pipe-cred__ct">${done}/6</span></div>
          <div class="pipe-meter">${meter}</div>
        </div>
        <div class="pipe-card__foot">${ownerAvatar(p)}</div>
      </article>`;
  }

  function render() {
    const lanes = groupByStage([...people.values()]);
    board!.innerHTML = BOARD_STAGES.map((stage) => {
      const list = lanes[stage];
      return `
        <div class="pipe-lane pipe-lane--${LANE_META[stage].cls}" data-stage="${stage}">
          <div class="pipe-lane__head">
            <span class="pipe-lane__pill">${esc(STAGE_LABELS[stage])}<span class="pipe-lane__n">${list.length}</span></span>
          </div>
          <div class="pipe-lane__body" data-stage="${stage}">
            ${list.map(cardHtml).join('') || `<div class="pipe-empty">No providers yet</div>`}
            <button class="pipe-lane__add" data-stage="${stage}"><span>+</span> Add</button>
          </div>
        </div>`;
    }).join('');
  }

  const genId = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
  const nowS = () => Math.floor(Date.now() / 1000);
  const ctx = () => ({ email: me, now: nowS() });

  // Per-row version guard: drop any echo/poll older than what we've adopted.
  const version = new Map<string, number>();

  const statusEl = document.getElementById('pipe-status');
  let statusClear: ReturnType<typeof setTimeout> | undefined;
  function setStatus(state: 'saving' | 'saved' | 'signedout' | 'error') {
    if (!statusEl) return;
    clearTimeout(statusClear);
    const map = { saving: ['Saving…', 'is-saving'], saved: ['Saved ✓', 'is-saved'], signedout: ['Sign-in expired — refresh', 'is-error'], error: ['Couldn’t save — retrying', 'is-error'] } as const;
    const [txt, cls] = map[state];
    statusEl.textContent = txt; statusEl.className = 'pipe-status ' + cls;
    if (state === 'saved') statusClear = setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'pipe-status'; }, 2000);
  }

  // Adopt an authoritative person row from a POST echo or a poll, guarded by
  // per-row version monotonicity. A removed-from-board (archived) row is dropped.
  function adopt(row: PipelinePerson | null) {
    if (!row || !row.id) return;
    if ((version.get(row.id) ?? -1) > row.version) return;
    version.set(row.id, row.version);
    if (row.stage === 'archived' && !archiveMode) people.delete(row.id);
    else people.set(row.id, row);
    render();
  }

  // Optimistic single-op persistence. applyOp already updated `people` at the call
  // site; sendOp POSTs the op and adopts the server's authoritative echo.
  function sendOp(op: PipelineOp) {
    setStatus('saving');
    (async () => {
      try {
        const res = await fetch('/hub/api/pipeline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', redirect: 'manual', body: JSON.stringify({ op }),
        });
        if (res.type === 'opaqueredirect' || res.status === 401) { setStatus('signedout'); return; }
        if (res.ok) {
          const b = await res.json();
          setStatus('saved');
          if (b?.ok && b.person) adopt(readPerson(b.person));
        } else { setStatus('error'); setTimeout(() => sendOp(op), 3000); }
      } catch { setStatus('error'); setTimeout(() => sendOp(op), 3000); }
    })();
  }

  // Apply an op locally (optimistic) then persist. For createPerson the id is
  // client-generated so the card appears instantly and the server agrees.
  function commit(op: PipelineOp) {
    if (op.type === 'createPerson') {
      const created = applyOp(null, op, ctx());
      if (created) people.set(created.id, created);
    } else {
      const cur = people.get(op.id);
      const next = applyOp(cur ?? null, op, ctx());
      if (next) { if (next.stage === 'archived' && !archiveMode) people.delete(next.id); else people.set(next.id, next); }
    }
    render();
    sendOp(op);
  }

  // ── Add-provider form ─────────────────────────────────────────────────────────
  function openAddForm(stage: BoardStage) {
    const owners = rosterPickerList();
    const wrap = document.createElement('div');
    wrap.className = 'pipe-modal';
    wrap.innerHTML = `
      <form class="pipe-form" autocomplete="off">
        <h3 class="pipe-form__h">Add provider · ${esc(STAGE_LABELS[stage])}</h3>
        <label class="pipe-f"><span>Name *</span><input name="full_name" required maxlength="120" /></label>
        <label class="pipe-f"><span>Specialty</span><input name="specialty_name" maxlength="80" /></label>
        <div class="pipe-f2">
          <label class="pipe-f"><span>State</span><input name="state" maxlength="40" /></label>
          <label class="pipe-f"><span>Target start</span><input name="target_start_date" type="date" /></label>
        </div>
        <div class="pipe-f2">
          <label class="pipe-f"><span>Phone</span><input name="phone" maxlength="40" /></label>
          <label class="pipe-f"><span>Email</span><input name="email" type="email" maxlength="120" /></label>
        </div>
        <label class="pipe-f"><span>Owner</span><select name="owner_email"><option value="">— none —</option>${owners.map((o) => `<option value="${esc(o.email)}"${o.email === me ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
        <label class="pipe-f"><span>Notes</span><textarea name="notes" rows="2" maxlength="2000"></textarea></label>
        <div class="pipe-form__actions"><button type="button" class="pipe-btn" data-cancel>Cancel</button><button type="submit" class="pipe-btn pipe-btn--primary">Add</button></div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form')!;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-cancel]')!.addEventListener('click', close);
    (form.querySelector('input[name="full_name"]') as HTMLInputElement)?.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const full_name = String(fd.get('full_name') || '').trim();
      if (!full_name) return;
      const str = (k: string) => { const v = String(fd.get(k) || '').trim(); return v || undefined; };
      commit({ type: 'createPerson', input: { id: genId(), full_name, stage, specialty_name: str('specialty_name'), state: str('state'), target_start_date: str('target_start_date'), phone: str('phone'), email: str('email'), owner_email: str('owner_email'), notes: str('notes') } });
      close();
    });
  }

  let archiveMode = false;

  // ── Delegated board actions ───────────────────────────────────────────────────
  board.addEventListener('click', (e) => {
    const add = (e.target as HTMLElement).closest<HTMLElement>('.pipe-lane__add');
    if (add) { openAddForm(add.dataset.stage as BoardStage); return; }
  });
  document.getElementById('pipe-add')?.addEventListener('click', () => openAddForm('warm_lead'));

  // ── Live poll (~4s), guarded + version-monotonic ──────────────────────────────
  async function poll() {
    try {
      const res = await fetch('/hub/api/pipeline?view=' + (archiveMode ? 'archived' : 'active'), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      const b = await res.json();
      if (!b?.ok || !Array.isArray(b.people)) return;
      const seen = new Set<string>();
      for (const raw of b.people) { const p = readPerson(raw); if (!p.id) continue; seen.add(p.id); adopt(p); }
      // Drop rows that left this view (archived elsewhere) — only in active mode.
      if (!archiveMode) { let changed = false; for (const id of [...people.keys()]) if (!seen.has(id)) { people.delete(id); version.delete(id); changed = true; } if (changed) render(); }
    } catch { /* ignore; next tick retries */ }
  }
  window.setInterval(poll, 4000);

  // Initial paint. All interaction handlers (Tasks 7-10) are inserted inside this
  // same IIFE, immediately ABOVE this bootstrap line, so their `let` bindings are
  // initialized before this first render runs (function declarations hoist).
  render();
})();
