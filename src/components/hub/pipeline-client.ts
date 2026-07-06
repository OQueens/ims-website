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
    return `
      <article class="pipe-card" draggable="true" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.full_name)}">
        <div class="pipe-card__top">
          <span class="pipe-av">${esc(initials(p))}</span>
          <div class="pipe-card__id">
            <div class="pipe-card__name">${esc(p.full_name)}</div>
            ${spec ? `<span class="pipe-spec">${esc(spec)}</span>` : ''}
          </div>
        </div>
        ${p.state ? `<div class="pipe-card__meta">${esc(p.state)}${p.target_start_date ? ' · ' + esc(p.target_start_date) : ''}</div>` : ''}
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

  // Initial paint. All interaction handlers (Tasks 7-10) are inserted inside this
  // same IIFE, immediately ABOVE this bootstrap line, so their `let` bindings are
  // initialized before this first render runs (function declarations hoist).
  render();
})();
