// src/components/hub/pipeline-client.ts
// Client controller for the Recruitment & Credentialing board. Renders lanes from
// the SSR island, keeps an id-keyed people map, and (Tasks 7-10) persists ops
// optimistically + polls for live updates. Mirrors the Weekly Sync client spine.
import {
  readPerson, groupByStage, checklistCount, personInitials,
  BOARD_STAGES, STAGE_LABELS, CHECKLIST_KEYS, CHECKLIST_LABELS, chkCol, SPECIALTY_SUGGESTIONS,
  type PipelinePerson, type BoardStage,
} from '../../lib/hub/pipeline-data';
import { rosterEntry } from '../../lib/hub/hub-roster';
import { applyOp, type PipelineOp } from '../../lib/hub/pipeline-ops';
import Sortable from 'sortablejs';

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

  const spot = document.getElementById('pipe-spot')!;
  // Backdrop click closes. Bound ONCE here (closeSpot hoists) — openSpot only
  // (re)binds the freshly-rendered inner controls, never this persistent element,
  // so re-opening the dossier never stacks duplicate backdrop listeners.
  spot.addEventListener('click', (e) => { if (e.target === spot) closeSpot(); });

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
          <span class="pipe-av">${esc(personInitials(p.full_name))}</span>
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
    // Archive mode is a separate, sortable-free render path: a flat grid of
    // archived people (read + restore via the dossier). Short-circuit before the
    // `dragging` guard below, which only matters for the lane board.
    if (archiveMode) {
      const list = [...people.values()].filter((p) => p.stage === 'archived');
      board!.innerHTML = `<div class="pipe-archive-list">${list.map(cardHtml).join('') || '<div class="pipe-empty">Archive is empty</div>'}</div>`;
      return; // no sortables in archive mode
    }
    // A drag gesture is in progress (between onStart/onEnd): rebuilding board.innerHTML
    // now would run mountSortables() and destroy() the actively-dragging Sortable
    // instance mid-gesture, which SortableJS forbids (codex-flagged: the poll/adopt
    // path can call render() at any time, independent of the onEnd rAF deferral this
    // file already uses for its own commit). Skip; onEnd clears `dragging` and its
    // own render()/commit() call afterward will pick up whatever changed meanwhile.
    if (dragging) return;
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
    mountSortables();
  }

  const genId = () => (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
  const nowS = () => Math.floor(Date.now() / 1000);
  const ctx = () => ({ email: me, now: nowS() });

  // Per-row version guard: drop any echo/poll older than what we've adopted.
  const version = new Map<string, number>();
  const pending = new Set<string>();  // createPerson ids awaiting first server confirmation
  const queued = new Map<string, PipelineOp[]>();
  const suppressed = new Set<string>();  // ids the active-view poll dropped; block stale echoes from resurrecting them until a poll re-includes them
  const deleted = new Set<string>();  // HARD-deleted ids (tombstone); adopt() never resurrects them, even if a poll GET still returns the row before the server delete lands

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
    if (deleted.has(row.id)) return;  // hard-deleted — never resurrect, even from a poll GET that raced the server delete
    if (suppressed.has(row.id)) return;  // poll says this row left the active view; ignore stale in-flight echoes until a poll re-includes it (restore)
    if ((version.get(row.id) ?? -1) > row.version) return;
    version.set(row.id, row.version);
    const wasPending = pending.delete(row.id);  // server-confirmed → clear the optimistic-create guard
    if (row.stage === 'archived' && !archiveMode) { people.delete(row.id); version.delete(row.id); }
    else people.set(row.id, row);
    render();
    if (wasPending) flushQueued(row.id);
  }

  // Optimistic single-op persistence. applyOp already updated `people` at the call
  // site; sendOp POSTs the op and adopts the server's authoritative echo.
  const MAX_RETRIES = 5;
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // Persist one op, retrying transient 5xx / network failures with backoff.
  // Resolves only AFTER the op finally settles (success, sign-out, rejection, or
  // retries exhausted) so enqueueSend can chain same-row ops on it. NEVER rejects.
  async function sendOp(op: PipelineOp) {
    setStatus('saving');
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch('/hub/api/pipeline', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', redirect: 'manual', body: JSON.stringify({ op }),
        });
        if (res.type === 'opaqueredirect' || res.status === 401) { setStatus('signedout'); return; }
        if (res.ok) {
          const b = await res.json();
          if (b?.ok && b.person) { setStatus('saved'); adopt(readPerson(b.person)); }
          else if (op.type === 'createPerson') { setStatus('error'); failCreate(op); }  // 200 without a person → the row was NOT created; reap it rather than strand it in `pending` behind a false "Saved ✓"
          else setStatus('saved');  // non-create no-op (missing/archived id) — legitimate; nothing to adopt
          return;
        }
        if (res.status >= 500 && attempt < MAX_RETRIES) { setStatus('error'); await delay(3000); continue; }  // transient server error — bounded retry
        setStatus('error'); failCreate(op); failDelete(op); return;  // 4xx (rejected op) or retries exhausted — do not loop forever
      } catch {
        setStatus('error');  // network error — transient
        if (attempt < MAX_RETRIES) { await delay(3000); continue; }
        failCreate(op); failDelete(op); return;
      }
    }
  }

  // Per-row send serialization. Every op for a row id is chained behind that row's
  // previous still-in-flight op, so the RPC receives a row's ops in the user's
  // action order. This closes the same-row races a bare fire-and-forget sendOp
  // leaves open: two quick same-row edits, a queued-flush batch, and (the subtle
  // one) a commit() issued AFTER a create confirms while an earlier flush op is
  // still mid-retry. Different rows stay fully parallel; sendOp never rejects so
  // the chain never rejects and needs no error link.
  const sendChain = new Map<string, Promise<void>>();
  function enqueueSend(op: PipelineOp): Promise<void> {
    const id = op.type === 'createPerson' ? op.input.id : op.id;
    const prev = sendChain.get(id) ?? Promise.resolve();
    const next = prev.then(() => sendOp(op));
    sendChain.set(id, next);
    void next.finally(() => { if (sendChain.get(id) === next) sendChain.delete(id); });
    return next;
  }

  // Apply an op locally (optimistic) then persist. For createPerson the id is
  // client-generated so the card appears instantly and the server agrees.
  function commit(op: PipelineOp) {
    if (op.type === 'createPerson') {
      const created = applyOp(null, op, ctx());
      if (created) { people.set(created.id, created); pending.add(created.id); }
      render();
      enqueueSend(op);
      return;
    }
    if (op.type === 'deletePerson') {
      // HARD delete: tombstone the id (adopt() won't resurrect it), drop it from
      // every reconciliation collection, then persist (endpoint removes it server-side).
      deleted.add(op.id);
      people.delete(op.id); version.delete(op.id); pending.delete(op.id);
      queued.delete(op.id); suppressed.delete(op.id);
      render();
      enqueueSend(op);
      return;
    }
    suppressed.delete(op.id);  // local user is authoritatively acting on this row — don't let a stale suppression block their own echo (e.g. restorePerson)
    const cur = people.get(op.id);
    const next = applyOp(cur ?? null, op, ctx());
    if (next) { if (next.stage === 'archived' && !archiveMode) { people.delete(next.id); version.delete(next.id); } else people.set(next.id, next); }
    render();
    if (pending.has(op.id)) {
      const q = queued.get(op.id) ?? []; q.push(op); queued.set(op.id, q);
      setStatus('saving'); // will POST once the create confirms
    } else {
      enqueueSend(op);
    }
  }

  function flushQueued(id: string) {
    const q = queued.get(id); if (!q || !q.length) return;
    queued.delete(id);
    // Apply every queued op optimistically and paint once, immediately.
    for (const op of q) {
      const cur = people.get(id);
      const next = applyOp(cur ?? null, op, ctx());
      if (next) { if (next.stage === 'archived' && !archiveMode) { people.delete(next.id); version.delete(next.id); } else people.set(next.id, next); }
    }
    render();
    // Persist in the user's original order. enqueueSend chains them onto this row's
    // send queue (behind the create's own send), so they go out one at a time and
    // never race a later commit() on the same row (codex-flagged #1/#1b).
    for (const op of q) enqueueSend(op);
  }

  function failCreate(op: PipelineOp) {
    if (op.type !== 'createPerson') return;
    const id = op.input.id;
    people.delete(id); pending.delete(id); queued.delete(id);
    render(); setStatus('error');
  }

  function failDelete(op: PipelineOp) {
    if (op.type !== 'deletePerson') return;
    // The hard delete failed terminally but the row still exists server-side. Roll
    // back the optimistic removal: lift the tombstone and re-fetch the current view
    // so the row reappears instead of staying invisibly hidden in this tab.
    deleted.delete(op.id);
    poll();
  }

  // Inline autocomplete: as the user types, complete the input with the first
  // matching suggestion and SELECT the added tail so it reads as ghost text —
  // Tab / → / End accept it, typing replaces it. No dropdown menu. Skips while
  // deleting so backspace works normally.
  function wireInlineAutocomplete(input: HTMLInputElement | null, suggestions: readonly string[]) {
    if (!input) return;
    let deleting = false;
    input.addEventListener('keydown', (e) => { deleting = e.key === 'Backspace' || e.key === 'Delete'; });
    input.addEventListener('input', () => {
      if (deleting) return;
      const val = input.value;
      if (!val) return;
      const low = val.toLowerCase();
      const match = suggestions.find((s) => s.toLowerCase().startsWith(low));
      if (match && match.length > val.length) {
        input.value = match;  // adopt the suggestion's proper casing ("internal med" → "Internal Medicine")
        input.setSelectionRange(val.length, match.length);  // highlight the completion tail
      }
    });
  }

  // ── Add-provider form ─────────────────────────────────────────────────────────
  function openAddForm(stage: BoardStage) {
    // Owner options come from REAL sources — the signed-in user (default) and the
    // distinct owners already on the board — never a hardcoded roster. The field is
    // free-text (a <datalist> just suggests); server-side readPerson/cleanEmail
    // normalizes whatever is typed. No fake @confirm addresses can be stored.
    const ownerEmails = new Set<string>();
    if (me) ownerEmails.add(me);
    for (const p of people.values()) if (p.owner_email) ownerEmails.add(p.owner_email);
    const ownerSuggestions = [...ownerEmails].map((email) => ({ email, name: rosterEntry(email).name }));
    const wrap = document.createElement('div');
    wrap.className = 'pipe-modal';
    wrap.innerHTML = `
      <form class="pipe-form" autocomplete="off">
        <h3 class="pipe-form__h">Add provider · ${esc(STAGE_LABELS[stage])}</h3>
        <label class="pipe-f"><span>Name *</span><input name="full_name" required maxlength="120" /></label>
        <label class="pipe-f"><span>Specialty</span><input name="specialty_name" data-autocomplete maxlength="80" placeholder="Start typing…" autocomplete="off" /></label>
        <div class="pipe-f2">
          <label class="pipe-f"><span>State</span><input name="state" maxlength="40" /></label>
          <label class="pipe-f"><span>Target start</span><input name="target_start_date" type="date" /></label>
        </div>
        <div class="pipe-f2">
          <label class="pipe-f"><span>Phone</span><input name="phone" maxlength="40" /></label>
          <label class="pipe-f"><span>Email</span><input name="email" type="email" maxlength="120" /></label>
        </div>
        <label class="pipe-f"><span>Owner</span><input name="owner_email" type="email" list="pipe-owner-list" maxlength="120" value="${esc(me)}" placeholder="owner@…" autocomplete="off" /></label>
        <datalist id="pipe-owner-list">${ownerSuggestions.map((o) => `<option value="${esc(o.email)}">${esc(o.name)}</option>`).join('')}</datalist>
        <label class="pipe-f"><span>Notes</span><textarea name="notes" rows="2" maxlength="2000"></textarea></label>
        <div class="pipe-form__actions"><button type="button" class="pipe-btn" data-cancel>Cancel</button><button type="submit" class="pipe-btn pipe-btn--primary">Add</button></div>
      </form>`;
    document.body.appendChild(wrap);
    const form = wrap.querySelector('form')!;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-cancel]')!.addEventListener('click', close);
    (form.querySelector('input[name="full_name"]') as HTMLInputElement)?.focus();
    wireInlineAutocomplete(form.querySelector('input[data-autocomplete]'), SPECIALTY_SUGGESTIONS);
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

  // ── Focus-spotlight dossier ───────────────────────────────────────────────────
  const svgPhone = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>';
  const svgMail = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
  const svgText = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function closeSpot() { spot.hidden = true; spot.innerHTML = ''; }

  // Delete confirmation. A custom modal (not window.confirm) so it can carry a
  // "Don't ask me this again" opt-out, remembered per-browser in localStorage.
  const SKIP_DELETE_KEY = 'hub-pipe-skip-delete-confirm';
  const skipDeleteConfirm = () => { try { return localStorage.getItem(SKIP_DELETE_KEY) === '1'; } catch { return false; } };
  function doDelete(id: string) { commit({ type: 'deletePerson', id }); closeSpot(); }
  function requestDelete(id: string, name: string) {
    if (skipDeleteConfirm()) { doDelete(id); return; }  // user opted out of the prompt
    const wrap = document.createElement('div');
    wrap.className = 'pipe-modal pipe-modal--top';  // above the open dossier (.pipe-spot), which it launches from
    wrap.innerHTML = `
      <div class="pipe-form pipe-confirm">
        <h3 class="pipe-form__h">Delete provider?</h3>
        <p class="pipe-confirm__msg">Delete <b>${esc(name)}</b> permanently? This cannot be reversed — use Archive if you might want them back.</p>
        <label class="pipe-confirm__skip"><input type="checkbox" data-skip /><span>Don't ask me this again</span></label>
        <div class="pipe-form__actions">
          <button type="button" class="pipe-btn" data-cancel>Cancel</button>
          <button type="button" class="pipe-btn pipe-confirm__go" data-confirm>Delete permanently</button>
        </div>
      </div>`;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-cancel]')!.addEventListener('click', close);
    wrap.querySelector('[data-confirm]')!.addEventListener('click', () => {
      if ((wrap.querySelector('[data-skip]') as HTMLInputElement | null)?.checked) {
        try { localStorage.setItem(SKIP_DELETE_KEY, '1'); } catch { /* storage unavailable — just skip persisting */ }
      }
      close();
      doDelete(id);
    });
    document.body.appendChild(wrap);
    (wrap.querySelector('[data-cancel]') as HTMLElement | null)?.focus();
  }

  function openSpot(id: string) {
    const p = people.get(id);
    if (!p) return;
    const done = checklistCount(p);
    const chips = CHECKLIST_KEYS.map((k) => `<button class="pipe-chip ${p[chkCol(k)] ? 'on' : ''}" data-chk="${k}"><span class="pipe-chip__bx"></span>${esc(CHECKLIST_LABELS[k])}</button>`).join('');
    const owner = rosterEntry(p.owner_email || '');
    const qa = (href: string, label: string, icon: string, on: boolean) => on ? `<a class="pipe-qa" href="${href}">${icon}${label}</a>` : `<span class="pipe-qa is-off">${icon}${label}</span>`;
    spot.innerHTML = `
      <div class="pipe-spot__card" role="document">
        <button class="pipe-spot__x" aria-label="Close">✕</button>
        <div class="pipe-spot__head">
          <span class="pipe-av">${esc(personInitials(p.full_name))}</span>
          <div><div class="pipe-spot__name">${esc(p.full_name)}</div>
            <div class="pipe-spot__sub">${esc(p.specialty_name || p.specialty_slug || '')}${p.state ? ' · ' + esc(p.state) : ''} · ${esc(STAGE_LABELS[p.stage])} · owner ${esc(owner.name)}</div></div>
        </div>
        <div class="pipe-qa-row">
          ${qa('tel:' + esc(p.phone || ''), 'Call', svgPhone, !!p.phone)}
          ${qa('mailto:' + esc(p.email || ''), 'Email', svgMail, !!p.email)}
          ${qa('sms:' + esc(p.phone || ''), 'Text', svgText, !!p.phone)}
        </div>
        <div class="pipe-spot__grid">
          <div>
            <div class="pipe-spot__lbl">Contact</div>
            <div class="pipe-kv">${svgPhone}<b>${esc(p.phone || '—')}</b></div>
            <div class="pipe-kv">${svgMail}<b>${esc(p.email || '—')}</b></div>
            <div class="pipe-spot__lbl">Notes</div>
            <textarea class="pipe-notes" data-field="notes" rows="4" maxlength="2000" placeholder="Add notes…">${esc(p.notes || '')}</textarea>
          </div>
          <div>
            <div class="pipe-spot__lbl">Credentialing · ${done} of 6</div>
            <div class="pipe-chips">${chips}</div>
          </div>
        </div>
        <div class="pipe-spot__foot">
          <button class="pipe-btn pipe-delete">Delete permanently</button>
          <button class="pipe-btn pipe-archive">${p.stage === 'archived' ? 'Restore to Needs Onboarding' : 'Archive provider'}</button>
        </div>
      </div>`;
    spot.hidden = false;

    spot.querySelector('.pipe-spot__x')!.addEventListener('click', closeSpot);
    spot.querySelectorAll<HTMLElement>('.pipe-chip').forEach((chip) => chip.addEventListener('click', () => {
      // Guard mirrors the notes-blur guard below: the live poll can delete this row out
      // from under an open dossier (e.g. another user archived it) between render and
      // click — re-check presence rather than trusting the non-null `!` the id was opened
      // with (codex-flagged: an unguarded `people.get(id)!` here would throw on a stale dossier).
      const cur = people.get(id); if (!cur) { closeSpot(); return; }
      const item = chip.dataset.chk as (typeof CHECKLIST_KEYS)[number];
      const value = !cur[chkCol(item)];
      commit({ type: 'toggleChecklist', id, item, value });
      openSpot(id); // re-render dossier with the coupling reflected
    }));
    const notes = spot.querySelector<HTMLTextAreaElement>('.pipe-notes')!;
    notes.addEventListener('blur', () => {
      const cur = people.get(id); if (!cur) return;
      const val = notes.value.trim();
      if ((cur.notes || '') !== val) commit({ type: 'updateField', id, field: 'notes', value: val || null });
    });
    spot.querySelector('.pipe-archive')!.addEventListener('click', () => {
      const cur = people.get(id); if (!cur) { closeSpot(); return; }  // same stale-dossier guard as the chip handler above
      if (cur.stage === 'archived') commit({ type: 'restorePerson', id, stage: 'needs_onboarding' });
      else commit({ type: 'archivePerson', id });
      closeSpot();
    });
    spot.querySelector('.pipe-delete')!.addEventListener('click', () => {
      const cur = people.get(id); if (!cur) { closeSpot(); return; }
      requestDelete(id, cur.full_name || 'this provider');  // custom confirm (with a "don't ask again" opt-out)
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !spot.hidden) {
      spot.querySelector<HTMLTextAreaElement>('.pipe-notes')?.blur(); // flush unsaved notes (blur handler commits) before removing the DOM
      closeSpot();
    }
  });

  let archiveMode = false;
  let viewGen = 0;

  // ── Delegated board actions ───────────────────────────────────────────────────
  board.addEventListener('click', (e) => {
    const add = (e.target as HTMLElement).closest<HTMLElement>('.pipe-lane__add');
    if (add) { openAddForm(add.dataset.stage as BoardStage); return; }
    const card = (e.target as HTMLElement).closest<HTMLElement>('.pipe-card');
    if (card) { openSpot(card.dataset.id!); return; }
  });
  board.addEventListener('keydown', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.pipe-card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSpot(card.dataset.id!); }
  });
  document.getElementById('pipe-add')?.addEventListener('click', () => openAddForm('warm_lead'));

  // ── Live poll (~4s), guarded + version-monotonic ──────────────────────────────
  async function poll() {
    const myGen = viewGen;
    try {
      const res = await fetch('/hub/api/pipeline?view=' + (archiveMode ? 'archived' : 'active'), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      const b = await res.json();
      if (!b?.ok || !Array.isArray(b.people)) return;
      if (viewGen !== myGen) return;
      const seen = new Set<string>();
      for (const raw of b.people) { const p = readPerson(raw); if (!p.id) continue; seen.add(p.id); suppressed.delete(p.id); adopt(p); }
      // Drop rows that left this view (archived elsewhere) — only in active mode.
      if (!archiveMode) { let changed = false; for (const id of [...people.keys()]) if (!seen.has(id) && !pending.has(id)) { people.delete(id); version.delete(id); suppressed.add(id); changed = true; } if (changed) render(); }
    } catch { /* ignore; next tick retries */ }
  }
  window.setInterval(poll, 4000);

  // ── Archive view toggle ───────────────────────────────────────────────────────
  // Full authoritative reload for a view switch: every client-side reconciliation
  // artifact (people/version/suppressed/pending) must reset, or a stale entry from
  // the old view (e.g. a `suppressed` archived id, or an in-flight `pending` create)
  // leaks across the toggle and can wrongly block a legitimate adopt() in the new
  // view — and since the row never reappears in the other view's poll, it would
  // never get cleared on its own.
  async function loadView() {
    const myGen = viewGen;
    const wantArchived = archiveMode;  // capture intended mode: a newer toggle must supersede this fetch
    try {
      const res = await fetch('/hub/api/pipeline?view=' + (wantArchived ? 'archived' : 'active'), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      const b = await res.json();
      if (!b?.ok || !Array.isArray(b.people)) return;
      if (viewGen !== myGen) return;  // user toggled again before this resolved — drop the stale response
      people.clear(); version.clear(); suppressed.clear(); pending.clear(); queued.clear();
      // Keep `deleted` — a hard-deleted id must not resurrect via a reload that
      // raced the server delete (this repopulation bypasses adopt's tombstone guard).
      for (const raw of b.people) { const p = readPerson(raw); if (p.id && !deleted.has(p.id)) { people.set(p.id, p); version.set(p.id, p.version); } }
      render();
    } catch { /* ignore */ }
  }

  const archiveToggle = document.getElementById('pipe-archive-toggle');
  archiveToggle?.addEventListener('click', () => {
    archiveMode = !archiveMode;
    viewGen++;
    archiveToggle.setAttribute('aria-pressed', String(archiveMode));
    archiveToggle.textContent = archiveMode ? 'Back to board' : 'Archive';
    board!.classList.toggle('is-archive', archiveMode);
    const addBtn = document.getElementById('pipe-add');
    if (addBtn) addBtn.style.display = archiveMode ? 'none' : '';
    loadView();
  });

  // ── Drag-and-drop between lanes (moveStage) ───────────────────────────────────
  let sortables: Sortable[] = [];
  // True for the span between a drag starting and SortableJS finishing its own
  // internal cleanup for that drag (see render()'s guard above, codex-flagged).
  let dragging = false;
  function mountSortables() {
    sortables.forEach((s) => s.destroy());
    sortables = BOARD_STAGES.map((stage) => {
      const el = board!.querySelector<HTMLElement>(`.pipe-lane__body[data-stage="${stage}"]`)!;
      return Sortable.create(el, {
        group: 'pipe', animation: 170, easing: 'cubic-bezier(0.2,0.7,0.2,1)',
        draggable: '.pipe-card', ghostClass: 'is-dragging', filter: '.pipe-lane__add, .pipe-empty',
        onStart: () => { dragging = true; board!.querySelectorAll('.pipe-lane__body').forEach((b) => b.classList.add('is-dropzone')); },
        onEnd: (evt) => {
          dragging = false; // SortableJS's own drag-end handling for this gesture is done; safe to render() again
          board!.querySelectorAll('.pipe-lane__body').forEach((b) => b.classList.remove('is-dropzone', 'is-dragover'));
          const id = evt.item.getAttribute('data-id');
          const toStage = (evt.to as HTMLElement).dataset.stage as BoardStage | undefined;
          const fromStage = (evt.from as HTMLElement).dataset.stage as BoardStage | undefined;
          // Defer out of SortableJS's drag-end stack: render() rebuilds board.innerHTML and
          // mountSortables() destroys every Sortable (incl. this firing one). Doing that
          // synchronously inside onEnd tears the instance down mid-drop. rAF lets SortableJS finish.
          requestAnimationFrame(() => {
            if (!id || !toStage || toStage === fromStage) { render(); return; } // same lane → re-render (no in-lane order persistence in v1)
            commit({ type: 'moveStage', id, stage: toStage });
          });
        },
        // Clear every lane's dragover highlight before marking the current target so only
        // one lane glows at a time (codex-flagged: previously only ever added, never cleared
        // mid-drag, so a card dragged across several lanes left them all highlighted).
        onMove: (evt) => {
          board!.querySelectorAll('.pipe-lane__body').forEach((b) => b.classList.remove('is-dragover'));
          (evt.to as HTMLElement).classList.add('is-dragover');
          return true;
        },
      });
    });
  }

  // Initial paint. All interaction handlers (Tasks 7-10) are inserted inside this
  // same IIFE, immediately ABOVE this bootstrap line, so their `let` bindings are
  // initialized before this first render runs (function declarations hoist).
  render();
})();
