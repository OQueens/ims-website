// @vitest-environment happy-dom
//
// Runtime regression suite for the Recruitment & Credentialing board client.
// Boots the REAL pipeline-client.ts IIFE in a simulated DOM against a FAITHFUL
// mock of /hub/api/pipeline (using the REAL applyOp/readPerson, so echoes are
// op-faithful + shape-correct — the prod hub_pipeline_apply RPC mirrors applyOp
// by design). SortableJS is stubbed: drag is a browser-only concern and the
// reconciliation logic is independent of it. This is the executable guard for
// the optimistic-UI + poll reconciliation state machine (F1 viewGen, F2 pending
// queue+flush, F3 create reap) that per-task/static review cannot fully cover.
//
// Per-file happy-dom env (docblock above) — the rest of the suite stays 'node'.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyOp } from '../../lib/hub/pipeline-ops';
import { readPerson } from '../../lib/hub/pipeline-data';

vi.mock('sortablejs', () => ({ default: { create: () => ({ destroy() {}, option() {} }) } }));

const ME = 'zach.young@iastaffing.com';

const FIXTURE = () => [
  { id: 'p-alpha', stage: 'warm_lead', full_name: 'Dr. Alpha Reyes', specialty_name: 'Emergency Medicine', state: 'TX', phone: '512-555-0101', email: 'a.reyes@example.test', owner_email: 'zach.young@iastaffing.com', chk_collecting_docs: true, notes: 'Prefers 7-on/7-off.', version: 3, updated_at: '2026-07-07T14:00:00.000Z' },
  { id: 'p-bravo', stage: 'warm_lead', full_name: 'Dr. Bravo Okafor', specialty_name: 'Hospitalist', state: 'OH', version: 2, updated_at: '2026-07-07T12:00:00.000Z' },
  { id: 'p-cleo', stage: 'active_bid', full_name: 'Dr. Cleo Nakamura', specialty_name: 'Psychiatry', state: 'CA', owner_email: 'donovan.hale@iastaffing.com', chk_collecting_docs: true, chk_needs_contract: true, version: 5, updated_at: '2026-07-07T13:30:00.000Z' },
  { id: 'p-devi', stage: 'accepted_bid', full_name: 'Dr. Devi Rao', specialty_name: 'Diagnostic Radiology', state: 'NY', owner_email: 'matthew.stone@iastaffing.com', chk_collecting_docs: true, chk_credentialing_started: true, version: 8, updated_at: '2026-07-07T13:00:00.000Z' },
  { id: 'p-enzo', stage: 'needs_onboarding', full_name: 'Dr. Enzo Marchetti', specialty_name: 'Anesthesiology', state: 'FL', owner_email: 'zach.young@iastaffing.com', target_start_date: '2026-08-15', chk_collecting_docs: true, chk_needs_contract: true, chk_start_dates_booked: true, chk_credentialing_started: true, version: 11, updated_at: '2026-07-07T12:45:00.000Z' },
  { id: 'p-farah', stage: 'placed', full_name: 'Dr. Farah Idris', specialty_name: 'CRNA', state: 'WA', owner_email: 'zach.young@iastaffing.com', chk_collecting_docs: true, chk_needs_contract: true, chk_start_dates_booked: true, chk_credentialing_started: true, chk_credentialing_complete: true, chk_provider_working: true, version: 14, updated_at: '2026-07-07T11:00:00.000Z' },
  { id: 'p-gus', stage: 'archived', full_name: 'Dr. Gus Lindqvist', specialty_name: 'Neurology', state: 'MN', owner_email: 'donovan.hale@iastaffing.com', notes: 'Went with a competing offer.', version: 4, updated_at: '2026-07-06T18:00:00.000Z' },
];

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const deferred = () => { let resolve: (v?: unknown) => void; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve: resolve! }; };
const resp = (status: number, obj: unknown) => ({ ok: status >= 200 && status < 300, status, type: 'default', json: async () => obj });

interface Control { failCreateStatus: number; failNextStatus: number; createReturnsNoPerson: boolean; holdCreate: ReturnType<typeof deferred> | null; holdArchivedGet: ReturnType<typeof deferred> | null; holdOp: ReturnType<typeof deferred> | null; }

function installMock(server: Map<string, any>, control: Control) {
  const sent: string[] = [];  // op types the client actually POSTed (recorded at request entry)
  const fn = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    if (!url.includes('/hub/api/pipeline')) throw new Error('unexpected fetch: ' + url);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const wantArchived = url.includes('view=archived');
      if (wantArchived && control.holdArchivedGet) await control.holdArchivedGet.promise;
      const people = [...server.values()].filter((p) => (wantArchived ? p.stage === 'archived' : p.stage !== 'archived'));
      return resp(200, { ok: true, people });
    }
    const op = JSON.parse(init.body).op;
    sent.push(op.type);
    // Hold the FIRST non-create POST's response (one-shot) so a test can prove
    // flushQueued sends queued same-row ops sequentially, not concurrently.
    if (op.type !== 'createPerson' && control.holdOp) { const h = control.holdOp; control.holdOp = null; await h.promise; }
    if (op.type === 'createPerson' && control.failCreateStatus) { const s = control.failCreateStatus; control.failCreateStatus = 0; return resp(s, { ok: false, reason: 'injected' }); }
    if (op.type === 'createPerson' && control.createReturnsNoPerson) { control.createReturnsNoPerson = false; return resp(200, { ok: true, person: null }); } // 200 but row NOT created
    if (control.failNextStatus) { const s = control.failNextStatus; control.failNextStatus = 0; return resp(s, { ok: false, reason: 'injected' }); }
    if (op.type === 'createPerson' && control.holdCreate) await control.holdCreate.promise;
    const cur = op.type === 'createPerson' ? null : (server.get(op.id) || null);
    const next = applyOp(cur, op, { email: 'server@harness.test', now: Math.floor(Date.now() / 1000) });
    if (!next) return resp(200, { ok: true, person: null });
    next.version = op.type === 'createPerson' ? 1 : ((cur?.version ?? -1) + 1);
    next.updated_at = new Date().toISOString();
    next.updated_by = 'server@harness.test';
    server.set(next.id, next);
    return resp(200, { ok: true, person: next });
  };
  (globalThis as any).fetch = fn; (window as any).fetch = fn;
  return { sent };
}

async function boot(people = FIXTURE(), me = ME) {
  vi.resetModules();
  document.body.innerHTML = `
    <div class="hub"><main class="hub-main">
      <section class="hub-view is-active" data-view="pipeline">
        <script id="hub-pipeline" type="application/json"></script>
        <div class="pipe-head"><div class="pipe-head__actions">
          <span class="pipe-status" id="pipe-status"></span>
          <button class="pipe-archive-toggle" id="pipe-archive-toggle" aria-pressed="false">Archive</button>
          <button class="pipe-add" id="pipe-add">Add</button>
        </div></div>
        <div class="pipe-board" id="pipe-board"></div>
        <div class="pipe-spot" id="pipe-spot" hidden></div>
      </section>
    </main></div>`;
  (document.getElementById('hub-pipeline') as HTMLElement).textContent = JSON.stringify({ me, people });
  (window as any).setInterval = () => 0; // neuter the 4s live poll; these flows use direct interactions + loadView
  const server = new Map<string, any>();
  people.forEach((raw) => { const p = readPerson(raw); if (p.id) server.set(p.id, p); });
  const control: Control = { failCreateStatus: 0, failNextStatus: 0, createReturnsNoPerson: false, holdCreate: null, holdArchivedGet: null, holdOp: null };
  const { sent } = installMock(server, control);
  await import('./pipeline-client');
  await flush();
  return { server, control, sent };
}

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...document.querySelectorAll(s)] as HTMLElement[];
const laneCards = (stage: string) => $$(`#pipe-board .pipe-lane[data-stage="${stage}"] .pipe-card`);
const cardById = (id: string) => $(`#pipe-board .pipe-card[data-id="${id}"]`);

afterEach(() => { document.body.innerHTML = ''; try { localStorage.clear(); } catch { /* no storage */ } });

describe('pipeline-client runtime (real IIFE in happy-dom + faithful mock backend)', () => {
  it('renders the 5 board lanes with correct labels, cards, and a 6-segment credentialing meter', async () => {
    await boot();
    expect($$('#pipe-board .pipe-lane').length).toBe(5); // archived is NOT a lane
    const heads = $$('#pipe-board .pipe-lane__pill').map((e) => e.textContent).join(' | ');
    expect(heads).toContain('Warm Leads');
    expect(heads).toContain('Placed / Working');
    expect(cardById('p-alpha')).toBeTruthy();
    expect(cardById('p-gus')).toBeNull(); // archived not on the active board
    expect(laneCards('placed').some((c) => c.getAttribute('data-id') === 'p-farah')).toBe(true);
    const farah = cardById('p-farah')!;
    expect(farah.querySelectorAll('.pipe-meter i').length).toBe(6);
    expect(farah.querySelectorAll('.pipe-meter i.on').length).toBe(6);
    expect(farah.querySelector('.pipe-cred__ct')!.textContent).toBe('6/6');
  });

  it('owner avatars render DERIVED initials from the login email (FIX R), never a hardcoded roster', async () => {
    await boot();
    const owner = cardById('p-alpha')!.querySelector('.pipe-owner')!;
    expect(owner.textContent).toBe('ZY'); // zach.young => "Zach Young" => "ZY"
    expect(owner.getAttribute('title')).toContain('Zach Young');
    expect(cardById('p-cleo')!.querySelector('.pipe-owner')!.textContent).toBe('DH'); // donovan.hale
  });

  it('card avatar shows first+last initials of the person name', async () => {
    await boot();
    expect(cardById('p-alpha')!.querySelector('.pipe-av')!.textContent).toBe('AR'); // "Dr. Alpha Reyes"
    expect(cardById('p-bravo')!.querySelector('.pipe-av')!.textContent).toBe('BO'); // "Dr. Bravo Okafor"
  });

  it('specialty pill carries its discipline color via --sc', async () => {
    await boot();
    const em = cardById('p-alpha')!.querySelector('.pipe-spec') as HTMLElement; // Emergency Medicine
    expect(em.style.getPropertyValue('--sc').trim()).toBe('#F2A03D');
    const psych = cardById('p-cleo')!.querySelector('.pipe-spec') as HTMLElement; // Psychiatry
    expect(psych.style.getPropertyValue('--sc').trim()).toBe('#A06CD8');
  });

  it('lane header wraps its label in .pipe-lane__lbl (centering hook)', async () => {
    await boot();
    const pill = $('#pipe-board .pipe-lane[data-stage="warm_lead"] .pipe-lane__pill')!;
    const lbl = pill.querySelector('.pipe-lane__lbl');
    expect(lbl).toBeTruthy();
    expect(lbl!.textContent).toBe('Warm Leads');
  });

  it('FIX R owner picker: datalist = signed-in user + distinct board owners, defaults to me, NEVER an @confirm placeholder', async () => {
    await boot();
    $('#pipe-add')!.click();
    await flush(1);
    const input = $('.pipe-modal input[name="owner_email"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe(ME);
    const opts = $$('#pipe-owner-list option').map((o) => (o as HTMLOptionElement).value);
    expect(opts).toContain('zach.young@iastaffing.com');
    expect(opts).toContain('donovan.hale@iastaffing.com');
    expect(opts).toContain('matthew.stone@iastaffing.com');
    expect(document.body.innerHTML).not.toContain('@confirm');
  });

  it('add-provider: optimistic card appears immediately and a createPerson op is POSTed with the chosen owner', async () => {
    const { sent, server } = await boot();
    const before = $$('#pipe-board .pipe-card').length;
    $('#pipe-add')!.click();
    await flush(1);
    (($('.pipe-modal input[name="full_name"]') as HTMLInputElement)).value = 'Dr. New Hire';
    (($('.pipe-modal input[name="owner_email"]') as HTMLInputElement)).value = 'donovan.hale@iastaffing.com';
    ($('.pipe-modal form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect($$('#pipe-board .pipe-card').length).toBe(before + 1);
    expect(sent).toContain('createPerson');
    const created = [...server.values()].find((p) => p.full_name === 'Dr. New Hire');
    expect(created).toBeTruthy();
    expect(created.owner_email).toBe('donovan.hale@iastaffing.com');
  });

  it('dossier: clicking a card opens the spotlight; toggling Provider Working forces stage=placed (invariant) and POSTs', async () => {
    const { sent } = await boot();
    cardById('p-cleo')!.click();
    await flush(1);
    expect($('#pipe-spot')!.hidden).toBe(false);
    const workingChip = $$('#pipe-spot .pipe-chip').find((c) => c.getAttribute('data-chk') === 'provider_working')!;
    workingChip.click();
    await flush();
    expect(laneCards('placed').some((c) => c.getAttribute('data-id') === 'p-cleo')).toBe(true);
    expect(laneCards('active_bid').some((c) => c.getAttribute('data-id') === 'p-cleo')).toBe(false);
    expect(sent).toContain('toggleChecklist');
  });

  it('archive: archiving from the dossier removes the card from the active board and POSTs archivePerson', async () => {
    const { sent } = await boot();
    cardById('p-bravo')!.click();
    await flush(1);
    ($('#pipe-spot .pipe-archive') as HTMLElement).click();
    await flush();
    expect(cardById('p-bravo')).toBeNull();
    expect(sent).toContain('archivePerson');
  });

  it('archive VIEW toggle: switching to Archive loads and shows only archived people', async () => {
    await boot();
    expect(cardById('p-gus')).toBeNull();
    $('#pipe-archive-toggle')!.click();
    await flush();
    expect($('#pipe-board .pipe-archive-list')).toBeTruthy();
    expect($(`#pipe-board .pipe-card[data-id="p-gus"]`)).toBeTruthy();
    expect($('#pipe-board .pipe-lane')).toBeNull();
  });

  // ── Hardened reconciliation paths ────────────────────────────────────────────

  it('F3 (create-failure reap): a create POST that fails terminally (400) removes the optimistic card', async () => {
    const { control } = await boot();
    const before = $$('#pipe-board .pipe-card').length;
    control.failCreateStatus = 400;
    $('#pipe-add')!.click();
    await flush(1);
    (($('.pipe-modal input[name="full_name"]') as HTMLInputElement)).value = 'Dr. Doomed Create';
    ($('.pipe-modal form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect($$('#pipe-board .pipe-card').length).toBe(before);
    expect($('#pipe-status')!.textContent).toContain('save'); // "Couldn't save…" (error), not "Saved ✓"
  });

  it('create no-person echo (Fix #2): a 200 {ok:true, person:null} create reaps the optimistic card instead of a false "Saved ✓"', async () => {
    const { control } = await boot();
    const before = $$('#pipe-board .pipe-card').length;
    control.createReturnsNoPerson = true;
    $('#pipe-add')!.click();
    await flush(1);
    (($('.pipe-modal input[name="full_name"]') as HTMLInputElement)).value = 'Dr. Ghost Create';
    ($('.pipe-modal form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect($$('#pipe-board .pipe-card').length).toBe(before); // reaped, not stranded
    expect($('#pipe-status')!.textContent).toContain('save'); // error status, not "Saved ✓"
  });

  it('F2 (pending-op queue+flush): an op on a not-yet-confirmed create is QUEUED (not POSTed), then flushed after the create echo', async () => {
    const { control, sent } = await boot();
    control.holdCreate = deferred();
    $('#pipe-add')!.click();
    await flush(1);
    (($('.pipe-modal input[name="full_name"]') as HTMLInputElement)).value = 'Dr. Pending Move';
    ($('.pipe-modal form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const newCard = $$('#pipe-board .pipe-card').find((c) => c.querySelector('.pipe-card__name')!.textContent === 'Dr. Pending Move')!;
    expect(newCard).toBeTruthy();
    newCard.click();
    await flush(1);
    $$('#pipe-spot .pipe-chip').find((c) => c.getAttribute('data-chk') === 'collecting_docs')!.click();
    await flush();
    expect(sent).toEqual(['createPerson']); // toggle was QUEUED, not sent
    control.holdCreate.resolve();
    await flush(6);
    expect(sent).toContain('toggleChecklist'); // queued toggle flushed after the create echo
    expect(sent.filter((t) => t === 'createPerson').length).toBe(1); // no duplicate create
  });

  it('F1 (viewGen guard): a stale archived-view GET that resolves AFTER toggling back does NOT wipe the active board', async () => {
    const { control } = await boot();
    control.holdArchivedGet = deferred();
    $('#pipe-archive-toggle')!.click(); // -> archive mode; loadView(archived) blocks
    await flush(1);
    $('#pipe-archive-toggle')!.click(); // -> back to board; loadView(active) resolves + repaints
    await flush();
    expect($('#pipe-board .pipe-lane')).toBeTruthy();
    expect(cardById('p-alpha')).toBeTruthy();
    control.holdArchivedGet.resolve(); // release the stale archived response
    await flush(6);
    expect($('#pipe-board .pipe-lane')).toBeTruthy();       // viewGen dropped it — still active board
    expect(cardById('p-alpha')).toBeTruthy();               // active cards NOT wiped
    expect($('#pipe-board .pipe-archive-list')).toBeNull(); // did not flip to archive render
  });

  it('flushQueued sends queued same-row ops SEQUENTIALLY, not concurrently (codex #1): op B is not POSTed until op A settles', async () => {
    const { control, sent } = await boot();
    control.holdCreate = deferred();  // keep the create in flight so follow-up edits queue
    const holdOp = deferred();        // captured: the mock nulls control.holdOp after the first use
    control.holdOp = holdOp;          // block the FIRST flushed (non-create) op's response
    $('#pipe-add')!.click();
    await flush(1);
    (($('.pipe-modal input[name="full_name"]') as HTMLInputElement)).value = 'Dr. Two Edits';
    ($('.pipe-modal form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    const card = $$('#pipe-board .pipe-card').find((c) => c.querySelector('.pipe-card__name')!.textContent === 'Dr. Two Edits')!;
    // Queue TWO checklist toggles on the not-yet-confirmed card (each re-renders the dossier).
    card.click(); await flush(1);
    $$('#pipe-spot .pipe-chip').find((c) => c.getAttribute('data-chk') === 'collecting_docs')!.click();
    $$('#pipe-spot .pipe-chip').find((c) => c.getAttribute('data-chk') === 'needs_contract')!.click();
    await flush();
    expect(sent).toEqual(['createPerson']); // both toggles queued behind the pending create, none POSTed

    control.holdCreate.resolve();          // create confirms → flushQueued starts, POSTs op A, blocks on holdOp
    await flush(6);
    expect(sent.filter((t) => t === 'toggleChecklist').length).toBe(1); // op B is WAITING on op A — sequential, not concurrent

    holdOp.resolve();                      // op A's response lands → flushQueued advances to op B
    await flush(6);
    expect(sent.filter((t) => t === 'toggleChecklist').length).toBe(2); // op B POSTed only after op A settled
    expect(sent.filter((t) => t === 'createPerson').length).toBe(1);    // still exactly one create
  });

  it('per-row send lock (codex #1b): two same-row commits serialize — op B is not POSTed until op A settles', async () => {
    // The general property that closes #1b: ANY two same-row sends (not just a
    // queued-flush batch) go out one at a time, so a commit() issued while an
    // earlier same-row op is still in flight (incl. mid-retry) cannot overtake it.
    const { control, sent } = await boot();
    const holdA = deferred();
    control.holdOp = holdA;  // hold the FIRST non-create POST's response (one-shot)
    // Two rapid toggles on an EXISTING (non-pending) card — both go via commit()->send.
    cardById('p-bravo')!.click();
    await flush(1);
    $$('#pipe-spot .pipe-chip').find((c) => c.getAttribute('data-chk') === 'collecting_docs')!.click();
    $$('#pipe-spot .pipe-chip').find((c) => c.getAttribute('data-chk') === 'needs_contract')!.click();
    await flush(4);
    expect(sent.filter((t) => t === 'toggleChecklist').length).toBe(1); // op B chained behind op A — NOT sent yet

    holdA.resolve();
    await flush(6);
    expect(sent.filter((t) => t === 'toggleChecklist').length).toBe(2); // op B POSTed only after op A settled
  });

  // ── Hard delete (test/mistyped rows) ─────────────────────────────────────────

  const openDossierDelete = async (id: string) => {
    cardById(id)!.click();
    await flush(1);
    ($('#pipe-spot .pipe-delete') as HTMLElement).click();
    await flush(1);
  };

  it('delete → custom confirm modal → confirm removes the card and POSTs deletePerson', async () => {
    const { sent } = await boot();
    await openDossierDelete('p-bravo');
    expect($('.pipe-confirm')).toBeTruthy();  // a custom modal, not window.confirm
    ($('.pipe-confirm [data-confirm]') as HTMLElement).click();
    await flush();
    expect(cardById('p-bravo')).toBeNull();
    expect(sent).toContain('deletePerson');
  });

  it('delete is cancellable — Cancel leaves the card and POSTs nothing', async () => {
    const { sent } = await boot();
    await openDossierDelete('p-bravo');
    ($('.pipe-confirm [data-cancel]') as HTMLElement).click();
    await flush();
    expect($('.pipe-confirm')).toBeNull();
    expect(cardById('p-bravo')).toBeTruthy();
    expect(sent).not.toContain('deletePerson');
  });

  it('"Don\'t ask me this again" skips the confirm on the next delete', async () => {
    const { sent } = await boot();
    await openDossierDelete('p-bravo');
    ($('.pipe-confirm [data-skip]') as HTMLInputElement).checked = true;  // opt out
    ($('.pipe-confirm [data-confirm]') as HTMLElement).click();
    await flush();
    expect(cardById('p-bravo')).toBeNull();
    // Second delete: no modal appears — it deletes immediately.
    cardById('p-cleo')!.click();
    await flush(1);
    ($('#pipe-spot .pipe-delete') as HTMLElement).click();
    await flush();
    expect($('.pipe-confirm')).toBeNull();          // prompt skipped
    expect(cardById('p-cleo')).toBeNull();           // deleted straight away
    expect(sent.filter((t) => t === 'deletePerson').length).toBe(2);
  });

  it('a hard-deleted card is NOT resurrected by a view reload that raced the server delete (tombstone)', async () => {
    const { server } = await boot();
    await openDossierDelete('p-bravo');
    ($('.pipe-confirm [data-confirm]') as HTMLElement).click();
    await flush();
    expect(cardById('p-bravo')).toBeNull();
    expect(server.has('p-bravo')).toBe(true); // mock backend still holds it — delete not yet propagated
    $('#pipe-archive-toggle')!.click(); await flush();
    $('#pipe-archive-toggle')!.click(); await flush();
    expect(cardById('p-bravo')).toBeNull();
  });

  it('a delete that fails terminally rolls back — the row reappears instead of hiding (codex)', async () => {
    const { control, server } = await boot();
    control.failNextStatus = 400;  // the deletePerson POST is rejected terminally (no retry)
    await openDossierDelete('p-bravo');
    ($('.pipe-confirm [data-confirm]') as HTMLElement).click();
    await flush(6);
    expect(server.has('p-bravo')).toBe(true);   // delete never happened server-side
    expect(cardById('p-bravo')).toBeTruthy();   // tombstone lifted + re-fetched → back on the board
  });

  it('specialty inline-autocompletes (no dropdown): "internal med" → "Internal Medicine" with the tail selected', async () => {
    await boot();
    $('#pipe-add')!.click();
    await flush(1);
    const input = $('.pipe-modal input[name="specialty_name"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.querySelector('#pipe-specialty-list')).toBeNull(); // no <datalist> menu
    input.value = 'internal med';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(input.value).toBe('Internal Medicine');
    expect(input.selectionStart).toBe('internal med'.length);
    expect(input.selectionEnd).toBe('Internal Medicine'.length);
  });
});
