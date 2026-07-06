# Recruitment & Credentialing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new IMS-hub section that tracks each provider on a drag-and-drop recruitment board (Warm Leads → Active Bids → Accepted Bids → Needs Onboarding → Placed/Working) with a 6-item multi-select credentialing checklist baked onto every card, plus a focus-spotlight detail dossier and an off-board Archive.

**Architecture:** A faithful clone of the existing Weekly Sync collaboration spine — a Supabase `hub_pipeline_people` table + an atomic `hub_pipeline_apply` Postgres RPC, edited through single-intent ops with optimistic client UI and ~4s polling for multi-recruiter sync. Storage granularity is row-per-person (typed columns), not one jsonb blob. All writes go through the service-role endpoint under `/hub`; the browser never touches the DB.

**Tech Stack:** Astro (SSR, `prerender=false`, Cloudflare adapter), vanilla TypeScript (no framework in the hub), Supabase (Postgres + service-role), Vitest, SortableJS (drag-and-drop).

## Global Constraints

- **Colors:** use only the locked dark Magenta-Noir tokens from `src/styles/hub.css` / `src/styles/colors_and_type.css` (`--surface`, `--rule`, `--ink`, `--ink-soft`, `--ink-mute`, `--bone`, `--pop-magenta` #C44569/#D14B6E, `--mn-cyan` #59BFE7, `--pop-butter` #F2C84B/#E8C465, `--peri`/periwinkle where present, `--space-4/5/6`). **No new colors.**
- **No fabrication:** the board starts EMPTY. Never seed cards from `ims_jobs`/`ls_events`. Recruitment stages are manual only.
- **Store:** Supabase service-role only, RLS-on with NO public policy; the RPC is `SECURITY DEFINER SET search_path=''` and `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`. Real Postgres functions stay `pg_catalog.`-qualified; `coalesce`/`case` are bare keywords.
- **Endpoint lives under `/hub`** so the `Path=/hub` session cookie + middleware guard apply. Client `fetch` MUST use `credentials:'same-origin'` + `redirect:'manual'` and treat 401/`opaqueredirect` as sign-in lapse.
- **Degrade gracefully:** a missing `hub_pipeline_people` table (pre-migration) yields an empty board, never a crash.
- **Attribution is server-authoritative:** the writer's email is re-derived from the cookie in the endpoint and stamped by the RPC. Never trust a client-supplied author.
- **Deploy discipline:** branch `redesign/v5-reskin` → NO auto-deploy. SHOW-BEFORE-DEPLOY + explicit deploy authorization before anything reaches `origin/main`. The migration is applied to prod out-of-band by Zach.
- **Codex peer review** on the non-trivial modules (ops, RPC, endpoint, client) per the standing in-band review loop.
- TDD, DRY, YAGNI, frequent commits.

---

## File structure

**Create:**
- `src/lib/hub/pipeline-data.ts` — types, constants (STAGES, CHECKLIST_KEYS), field caps, sanitize/normalize, pure render helpers.
- `src/lib/hub/pipeline-data.test.ts`
- `src/lib/hub/pipeline-ops.ts` — the pure op algebra `applyOp` + `validateOp` (incl. stage⟷working coupling).
- `src/lib/hub/pipeline-ops.test.ts`
- `migrations/20260705_hub_pipeline.sql` — table + `hub_pipeline_apply` RPC.
- `src/lib/hub/pipeline-rpc.integration.test.ts` — TS-oracle ⇄ RPC parity (skips without a live DB).
- `src/pages/hub/api/pipeline.ts` — GET (list) + POST (one op) endpoint.
- `src/pages/hub/api/pipeline.test.ts` — endpoint auth/validation branches.
- `src/components/hub/PipelineView.astro` — SSR section + hydration island + empty board container.
- `src/components/hub/pipeline-client.ts` — client IIFE: render, add, drag, spotlight, poll/adopt.

**Modify:**
- `src/components/hub/HubSidebar.astro` — nav button.
- `src/pages/hub/index.astro` — import + SSR read + render + pass `me` + import client.
- `src/components/hub/hub-client.ts` — one line in `VIEW_TITLES`.
- `src/styles/hub.css` — append a `.pipe-*` block.

---

## Task 1: Pipeline data module (types, constants, sanitize, pure helpers)

**Files:**
- Create: `src/lib/hub/pipeline-data.ts`
- Test: `src/lib/hub/pipeline-data.test.ts`

**Interfaces:**
- Produces: `Stage`, `BOARD_STAGES`, `STAGES`, `ChecklistKey`, `CHECKLIST_KEYS`, `CHECKLIST_LABELS`, `STAGE_LABELS`, `PipelinePerson`, `PipelinePersonInput`, caps (`MAX_*`), `escapeText` (re-exported from sync-data), `cleanEmail`, `cleanDate`, `readPerson(row): PipelinePerson`, `checklistCount(p): number`, `groupByStage(people): Record<BoardStage, PipelinePerson[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/hub/pipeline-data.test.ts
import { describe, it, expect } from 'vitest';
import {
  STAGES, BOARD_STAGES, CHECKLIST_KEYS, checklistCount, groupByStage,
  readPerson, cleanDate, type PipelinePerson,
} from './pipeline-data';

const base = (over: Partial<PipelinePerson> = {}): PipelinePerson => readPerson({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Dr. Ana Duarte', stage: 'needs_onboarding',
  chk_collecting_docs: true, chk_needs_contract: true, chk_start_dates_booked: true,
  chk_credentialing_started: true, version: 3, updated_at: '2026-07-05T00:00:00Z', ...over,
});

describe('pipeline-data', () => {
  it('exposes 6 board stages (no archived) and 6 checklist keys', () => {
    expect(STAGES).toContain('archived');
    expect(BOARD_STAGES).toEqual(['warm_lead','active_bid','accepted_bid','needs_onboarding','placed']);
    expect(CHECKLIST_KEYS).toHaveLength(6);
  });

  it('readPerson coerces missing fields to safe defaults', () => {
    const p = readPerson({ id: 'x', full_name: '<b>Ana</b>' });
    expect(p.stage).toBe('warm_lead');
    expect(p.chk_provider_working).toBe(false);
    expect(p.checklist_audit).toEqual({});
    expect(p.full_name).toBe('&lt;b&gt;Ana&lt;/b&gt;'); // escaped, not interpreted
    expect(p.version).toBe(0);
  });

  it('checklistCount counts true flags', () => {
    expect(checklistCount(base())).toBe(4);
    expect(checklistCount(base({ chk_collecting_docs: false }))).toBe(3);
  });

  it('groupByStage buckets by lane and excludes archived, sorted by updated_at desc', () => {
    const a = base({ id: 'a', stage: 'warm_lead', updated_at: '2026-07-01T00:00:00Z' });
    const b = base({ id: 'b', stage: 'warm_lead', updated_at: '2026-07-05T00:00:00Z' });
    const c = base({ id: 'c', stage: 'archived' });
    const g = groupByStage([a, b, c]);
    expect(g.warm_lead.map((p) => p.id)).toEqual(['b', 'a']);
    expect(g.placed).toEqual([]);
    expect(JSON.stringify(g)).not.toContain('"c"');
  });

  it('cleanDate accepts ISO dates and rejects junk', () => {
    expect(cleanDate('2026-07-05')).toBe('2026-07-05');
    expect(cleanDate('nope')).toBeNull();
    expect(cleanDate('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts`
Expected: FAIL — cannot find module `./pipeline-data`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/hub/pipeline-data.ts
// Pure helpers for the Recruitment & Credentialing pipeline (hub_pipeline_people
// table). No I/O — the endpoint (/hub/api/pipeline) and the client both validate
// through here. Row-per-person: recruitment is ONE `stage`; credentialing is 6
// independent boolean flags that run in parallel. Sanitize-on-read/write posture
// mirrors Weekly Sync (sync-data.ts). No fabrication: absent → honest defaults.
import { escapeText, MAX_EMAIL_LEN } from './sync-data';

export { escapeText };

// Recruitment track. 'placed' is the terminal working lane; 'archived' is
// off-board (lost/inactive). BOARD_STAGES are the visible lanes, left→right.
export const BOARD_STAGES = ['warm_lead', 'active_bid', 'accepted_bid', 'needs_onboarding', 'placed'] as const;
export const STAGES = [...BOARD_STAGES, 'archived'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  warm_lead: 'Warm Leads', active_bid: 'Active Bids', accepted_bid: 'Accepted Bids',
  needs_onboarding: 'Needs Onboarding', placed: 'Placed / Working', archived: 'Archived',
};

// Credentialing track — 6 independent multi-select statuses, DB column = 'chk_'+key.
export const CHECKLIST_KEYS = [
  'collecting_docs', 'needs_contract', 'start_dates_booked',
  'credentialing_started', 'credentialing_complete', 'provider_working',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  collecting_docs: 'Collecting Documents', needs_contract: 'Needs Contract',
  start_dates_booked: 'Start Dates Booked', credentialing_started: 'Credentialing Started',
  credentialing_complete: 'Credentialing Complete', provider_working: 'Provider Working',
};
export const chkCol = (k: ChecklistKey) => ('chk_' + k) as `chk_${ChecklistKey}`;

// Field caps so a malformed/hostile POST can't bloat a row.
export const MAX_NAME_LEN = 120;
export const MAX_SPECIALTY_LEN = 80;
export const MAX_STATE_LEN = 40;
export const MAX_PHONE_LEN = 40;
export const MAX_NOTES_LEN = 2000;
export const MAX_LABEL_LEN = 160;
export { MAX_EMAIL_LEN };

export interface ChecklistAuditEntry { by: string; at: number; }
export interface PipelinePerson {
  id: string;
  stage: Stage;
  full_name: string;
  specialty_slug: string | null;
  specialty_name: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  owner_email: string | null;
  target_start_date: string | null;
  assignment_id: string | null;
  assignment_number: string | null;
  assignment_label: string | null;
  chk_collecting_docs: boolean;
  chk_needs_contract: boolean;
  chk_start_dates_booked: boolean;
  chk_credentialing_started: boolean;
  chk_credentialing_complete: boolean;
  chk_provider_working: boolean;
  checklist_audit: Record<string, ChecklistAuditEntry>;
  notes: string | null;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
}

export function cleanEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().slice(0, MAX_EMAIL_LEN);
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s : '';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function cleanDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) return null;
  return s;
}

// Escape a free-text field to inert text, trim, cap. null when empty.
function cleanText(raw: unknown, cap: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = escapeText(raw.trim()).slice(0, cap);
  return s.length ? s : null;
}

const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);
const isBool = (v: unknown): boolean => v === true;

function cleanAudit(raw: unknown): Record<string, ChecklistAuditEntry> {
  const out: Record<string, ChecklistAuditEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of CHECKLIST_KEYS) {
    const e = (raw as Record<string, unknown>)[chkCol(k)];
    if (e && typeof e === 'object') {
      const by = cleanEmail((e as Record<string, unknown>).by);
      const at = (e as Record<string, unknown>).at;
      if (by && typeof at === 'number' && Number.isFinite(at)) out[chkCol(k)] = { by, at: Math.floor(at) };
    }
  }
  return out;
}

/** Shape a raw DB row (or partial/hostile object) into a canonical PipelinePerson.
 *  Never throws; fills every field with a safe default. */
export function readPerson(row: unknown): PipelinePerson {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    stage: isStage(r.stage) ? r.stage : 'warm_lead',
    full_name: cleanText(r.full_name, MAX_NAME_LEN) ?? '',
    specialty_slug: cleanText(r.specialty_slug, MAX_SPECIALTY_LEN),
    specialty_name: cleanText(r.specialty_name, MAX_SPECIALTY_LEN),
    state: cleanText(r.state, MAX_STATE_LEN),
    phone: cleanText(r.phone, MAX_PHONE_LEN),
    email: cleanEmail(r.email) || null,
    owner_email: cleanEmail(r.owner_email) || null,
    target_start_date: cleanDate(r.target_start_date),
    assignment_id: typeof r.assignment_id === 'string' ? r.assignment_id : null,
    assignment_number: cleanText(r.assignment_number, MAX_LABEL_LEN),
    assignment_label: cleanText(r.assignment_label, MAX_LABEL_LEN),
    chk_collecting_docs: isBool(r.chk_collecting_docs),
    chk_needs_contract: isBool(r.chk_needs_contract),
    chk_start_dates_booked: isBool(r.chk_start_dates_booked),
    chk_credentialing_started: isBool(r.chk_credentialing_started),
    chk_credentialing_complete: isBool(r.chk_credentialing_complete),
    chk_provider_working: isBool(r.chk_provider_working),
    checklist_audit: cleanAudit(r.checklist_audit),
    notes: cleanText(r.notes, MAX_NOTES_LEN),
    version: typeof r.version === 'number' && Number.isFinite(r.version) ? Math.floor(r.version) : 0,
    updated_by: cleanEmail(r.updated_by) || null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

export function checklistCount(p: PipelinePerson): number {
  return CHECKLIST_KEYS.reduce((n, k) => n + (p[chkCol(k)] ? 1 : 0), 0);
}

/** Bucket people by board lane (archived excluded), each lane newest-updated first. */
export function groupByStage(people: PipelinePerson[]): Record<BoardStage, PipelinePerson[]> {
  const out = Object.fromEntries(BOARD_STAGES.map((s) => [s, [] as PipelinePerson[]])) as Record<BoardStage, PipelinePerson[]>;
  for (const p of people) {
    if ((BOARD_STAGES as readonly string[]).includes(p.stage)) out[p.stage as BoardStage].push(p);
  }
  const ts = (p: PipelinePerson) => (p.updated_at ? Date.parse(p.updated_at) || 0 : 0);
  for (const s of BOARD_STAGES) out[s].sort((a, b) => ts(b) - ts(a));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/pipeline-data.ts src/lib/hub/pipeline-data.test.ts
git commit -m "feat(hub): pipeline data model — types, constants, sanitize, helpers"
```

---

## Task 2: Pipeline op algebra (applyOp + validateOp + stage⟷working coupling)

**Files:**
- Create: `src/lib/hub/pipeline-ops.ts`
- Test: `src/lib/hub/pipeline-ops.test.ts`

**Interfaces:**
- Consumes: `PipelinePerson`, `Stage`, `ChecklistKey`, `readPerson`, caps, `escapeText`, `cleanEmail`, `cleanDate` from `pipeline-data`.
- Produces: `PipelineOp`, `CreatePersonInput`, `UPDATABLE_FIELDS`, `ApplyCtx`, `applyOp(person: PipelinePerson | null, op: PipelineOp, ctx: ApplyCtx): PipelinePerson | null`, `validateOp(raw): { ok: true; op: PipelineOp } | { ok: false; reason: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/hub/pipeline-ops.test.ts
import { describe, it, expect } from 'vitest';
import { applyOp, validateOp, type PipelineOp } from './pipeline-ops';
import { readPerson, type PipelinePerson } from './pipeline-data';

const ctx = { email: 'zach@iastaffing.com', now: 1_700_000_000 };
const P = (over: Partial<PipelinePerson> = {}): PipelinePerson =>
  readPerson({ id: 'p1', full_name: 'Dr. Ana Duarte', stage: 'needs_onboarding', ...over });

describe('applyOp', () => {
  it('createPerson builds a person with defaults + author', () => {
    const created = applyOp(null, { type: 'createPerson', input: { id: 'p9', full_name: 'Dr. Maya Chen', stage: 'warm_lead' } }, ctx)!;
    expect(created.id).toBe('p9');
    expect(created.stage).toBe('warm_lead');
    expect(created.chk_provider_working).toBe(false);
    expect(created.owner_email).toBe(''); // not supplied → empty (owner optional)
  });

  it('updateField sanitizes text and sets the field', () => {
    const p = applyOp(P(), { type: 'updateField', id: 'p1', field: 'notes', value: '<script>x</script>ok' }, ctx)!;
    expect(p.notes).toBe('&lt;script&gt;x&lt;/script&gt;ok');
  });

  it('moveStage to placed checks provider_working; moving out unchecks it', () => {
    const placed = applyOp(P(), { type: 'moveStage', id: 'p1', stage: 'placed' }, ctx)!;
    expect(placed.stage).toBe('placed');
    expect(placed.chk_provider_working).toBe(true);
    const back = applyOp(placed, { type: 'moveStage', id: 'p1', stage: 'accepted_bid' }, ctx)!;
    expect(back.stage).toBe('accepted_bid');
    expect(back.chk_provider_working).toBe(false);
  });

  it('toggleChecklist provider_working=true forces stage=placed and stamps audit', () => {
    const p = applyOp(P({ stage: 'active_bid' }), { type: 'toggleChecklist', id: 'p1', item: 'provider_working', value: true }, ctx)!;
    expect(p.stage).toBe('placed');
    expect(p.chk_provider_working).toBe(true);
    expect(p.checklist_audit.chk_provider_working).toEqual({ by: ctx.email, at: ctx.now });
  });

  it('toggleChecklist provider_working=false from placed drops to needs_onboarding', () => {
    const placed = P({ stage: 'placed', chk_provider_working: true });
    const p = applyOp(placed, { type: 'toggleChecklist', id: 'p1', item: 'provider_working', value: false }, ctx)!;
    expect(p.stage).toBe('needs_onboarding');
    expect(p.chk_provider_working).toBe(false);
  });

  it('toggleChecklist of a non-working item does not move stage', () => {
    const p = applyOp(P({ stage: 'warm_lead' }), { type: 'toggleChecklist', id: 'p1', item: 'collecting_docs', value: true }, ctx)!;
    expect(p.stage).toBe('warm_lead');
    expect(p.chk_collecting_docs).toBe(true);
  });

  it('archivePerson sets archived; restorePerson returns to a board stage', () => {
    const a = applyOp(P(), { type: 'archivePerson', id: 'p1' }, ctx)!;
    expect(a.stage).toBe('archived');
    const r = applyOp(a, { type: 'restorePerson', id: 'p1', stage: 'warm_lead' }, ctx)!;
    expect(r.stage).toBe('warm_lead');
  });

  it('does not mutate its input', () => {
    const p = P();
    applyOp(p, { type: 'moveStage', id: 'p1', stage: 'placed' }, ctx);
    expect(p.stage).toBe('needs_onboarding');
    expect(p.chk_provider_working).toBe(false);
  });
});

describe('validateOp', () => {
  it('accepts a well-formed toggleChecklist', () => {
    const r = validateOp({ type: 'toggleChecklist', id: 'p1', item: 'needs_contract', value: true });
    expect(r.ok).toBe(true);
  });
  it('rejects an unknown checklist item', () => {
    const r = validateOp({ type: 'toggleChecklist', id: 'p1', item: 'bogus', value: true });
    expect(r.ok).toBe(false);
  });
  it('rejects moveStage to a non-stage', () => {
    expect(validateOp({ type: 'moveStage', id: 'p1', stage: 'nope' }).ok).toBe(false);
  });
  it('rejects updateField on a non-whitelisted field', () => {
    expect(validateOp({ type: 'updateField', id: 'p1', field: 'version', value: '9' }).ok).toBe(false);
  });
  it('rejects createPerson without a full_name', () => {
    expect(validateOp({ type: 'createPerson', input: { id: 'p9' } }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/pipeline-ops.test.ts`
Expected: FAIL — cannot find module `./pipeline-ops`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/hub/pipeline-ops.ts
// Pure operation algebra for the pipeline. ONE op at a time, applied to a single
// PipelinePerson (or null for createPerson). Used by (a) the client for optimistic
// UI, (b) vitest as the test oracle, (c) mirrored by the hub_pipeline_apply RPC.
// Never mutates input. The `placed` stage and `chk_provider_working` are kept in
// LOCKSTEP; the other 5 checklist items are independent.
import {
  type PipelinePerson, type Stage, type ChecklistKey,
  STAGES, BOARD_STAGES, CHECKLIST_KEYS, chkCol, readPerson,
  escapeText, cleanEmail, cleanDate,
  MAX_NAME_LEN, MAX_SPECIALTY_LEN, MAX_STATE_LEN, MAX_PHONE_LEN, MAX_NOTES_LEN, MAX_LABEL_LEN,
} from './pipeline-data';

export interface CreatePersonInput {
  id: string; full_name: string; stage?: Stage;
  specialty_slug?: string; specialty_name?: string; state?: string;
  phone?: string; email?: string; owner_email?: string; target_start_date?: string; notes?: string;
}

// Whitelisted single-value fields for updateField (value is string | null).
export const UPDATABLE_FIELDS = [
  'full_name', 'specialty_slug', 'specialty_name', 'state', 'phone', 'email',
  'owner_email', 'target_start_date', 'notes', 'assignment_id', 'assignment_number', 'assignment_label',
] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

export type PipelineOp =
  | { type: 'createPerson'; input: CreatePersonInput }
  | { type: 'updateField'; id: string; field: UpdatableField; value: string | null }
  | { type: 'moveStage'; id: string; stage: Stage }
  | { type: 'toggleChecklist'; id: string; item: ChecklistKey; value: boolean }
  | { type: 'archivePerson'; id: string }
  | { type: 'restorePerson'; id: string; stage: Stage };

export interface ApplyCtx { email: string; now: number; }

const clone = (p: PipelinePerson): PipelinePerson => ({ ...p, checklist_audit: { ...p.checklist_audit } });

// Cap a text field the same way readPerson would (escape → trim → slice).
const FIELD_CAP: Record<UpdatableField, number> = {
  full_name: MAX_NAME_LEN, specialty_slug: MAX_SPECIALTY_LEN, specialty_name: MAX_SPECIALTY_LEN,
  state: MAX_STATE_LEN, phone: MAX_PHONE_LEN, email: 0, owner_email: 0,
  target_start_date: 0, notes: MAX_NOTES_LEN, assignment_id: 0,
  assignment_number: MAX_LABEL_LEN, assignment_label: MAX_LABEL_LEN,
};

function coerceField(field: UpdatableField, value: string | null): string | null {
  if (value == null) return null;
  if (field === 'email' || field === 'owner_email') return cleanEmail(value) || null;
  if (field === 'target_start_date') return cleanDate(value);
  if (field === 'assignment_id') return typeof value === 'string' && value ? value : null;
  const s = escapeText(value.trim()).slice(0, FIELD_CAP[field]);
  return s.length ? s : null;
}

export function applyOp(person: PipelinePerson | null, op: PipelineOp, ctx: ApplyCtx): PipelinePerson | null {
  if (op.type === 'createPerson') {
    const i = op.input;
    return readPerson({
      id: i.id,
      stage: i.stage && (STAGES as readonly string[]).includes(i.stage) ? i.stage : 'warm_lead',
      full_name: i.full_name,
      specialty_slug: i.specialty_slug, specialty_name: i.specialty_name, state: i.state,
      phone: i.phone, email: i.email, owner_email: i.owner_email,
      target_start_date: i.target_start_date, notes: i.notes,
      version: 0, updated_by: ctx.email, updated_at: null,
    });
  }
  if (!person) return null;
  const p = clone(person);
  switch (op.type) {
    case 'updateField':
      (p as Record<string, unknown>)[op.field] = coerceField(op.field, op.value);
      return p;
    case 'moveStage':
      p.stage = op.stage;
      if (op.stage === 'placed') p.chk_provider_working = true;
      else if (p.chk_provider_working) p.chk_provider_working = false;
      return p;
    case 'toggleChecklist': {
      p[chkCol(op.item)] = op.value;
      p.checklist_audit = { ...p.checklist_audit, [chkCol(op.item)]: { by: ctx.email, at: ctx.now } };
      if (op.item === 'provider_working') {
        if (op.value && p.stage !== 'placed' && p.stage !== 'archived') p.stage = 'placed';
        else if (!op.value && p.stage === 'placed') p.stage = 'needs_onboarding';
      }
      return p;
    }
    case 'archivePerson':
      p.stage = 'archived';
      return p;
    case 'restorePerson':
      p.stage = (BOARD_STAGES as readonly string[]).includes(op.stage) ? op.stage : 'needs_onboarding';
      return p;
    default:
      return p;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 64;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 4000;
const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);
const isBoardStage = (v: unknown): v is Stage => typeof v === 'string' && (BOARD_STAGES as readonly string[]).includes(v);
const isChkKey = (v: unknown): v is ChecklistKey => typeof v === 'string' && (CHECKLIST_KEYS as readonly string[]).includes(v);
const isField = (v: unknown): v is UpdatableField => typeof v === 'string' && (UPDATABLE_FIELDS as readonly string[]).includes(v);

export function validateOp(raw: unknown): { ok: true; op: PipelineOp } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'op-not-object' };
  const o = raw as Record<string, unknown>;
  switch (o.type) {
    case 'createPerson': {
      const i = o.input as Record<string, unknown> | undefined;
      if (!i || !isId(i.id) || typeof i.full_name !== 'string' || i.full_name.trim().length === 0) return { ok: false, reason: 'bad-createPerson' };
      if (i.stage !== undefined && !isStage(i.stage)) return { ok: false, reason: 'bad-stage' };
      return { ok: true, op: { type: 'createPerson', input: i as unknown as CreatePersonInput } };
    }
    case 'updateField':
      if (!isId(o.id) || !isField(o.field) || (o.value !== null && !isStr(o.value))) return { ok: false, reason: 'bad-updateField' };
      return { ok: true, op: { type: 'updateField', id: o.id, field: o.field, value: (o.value as string | null) } };
    case 'moveStage':
      if (!isId(o.id) || !isStage(o.stage)) return { ok: false, reason: 'bad-moveStage' };
      return { ok: true, op: { type: 'moveStage', id: o.id, stage: o.stage } };
    case 'toggleChecklist':
      if (!isId(o.id) || !isChkKey(o.item) || typeof o.value !== 'boolean') return { ok: false, reason: 'bad-toggleChecklist' };
      return { ok: true, op: { type: 'toggleChecklist', id: o.id, item: o.item, value: o.value } };
    case 'archivePerson':
      if (!isId(o.id)) return { ok: false, reason: 'bad-archivePerson' };
      return { ok: true, op: { type: 'archivePerson', id: o.id } };
    case 'restorePerson':
      if (!isId(o.id) || !isBoardStage(o.stage)) return { ok: false, reason: 'bad-restorePerson' };
      return { ok: true, op: { type: 'restorePerson', id: o.id, stage: o.stage } };
    default:
      return { ok: false, reason: 'unknown-op-type' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/pipeline-ops.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/pipeline-ops.ts src/lib/hub/pipeline-ops.test.ts
git commit -m "feat(hub): pipeline op algebra with stage/provider-working coupling"
```

---

## Task 3: Migration — table + atomic `hub_pipeline_apply` RPC

**Files:**
- Create: `migrations/20260705_hub_pipeline.sql`
- Test: `src/lib/hub/pipeline-rpc.integration.test.ts` (parity; skips without a live DB)

**Interfaces:**
- Consumes: op JSON shapes from `pipeline-ops.ts` (mirrors `applyOp`).
- Produces: table `public.hub_pipeline_people`; function `public.hub_pipeline_apply(p_op jsonb, p_email text) RETURNS SETOF public.hub_pipeline_people`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/20260705_hub_pipeline.sql
-- IMS Hub — Recruitment & Credentialing pipeline — 2026-07-05
-- Row-per-person board. Recruitment = one `stage`; credentialing = 6 independent
-- boolean flags (parallel). Optimistic-concurrency `version` + an atomic op-based
-- apply so concurrent recruiter edits cannot silently overwrite each other. The
-- browser NEVER calls the RPC; only the service-role /hub/api/pipeline endpoint.
-- Mirrors src/lib/hub/pipeline-ops.ts applyOp. Text fields are stored raw here and
-- escaped on READ by readPerson (pipeline-data.ts), matching the hub's
-- sanitize-on-read posture — the RPC contains no sanitizer.
-- NOTE: coalesce/case are SQL keyword constructs — write them BARE; real functions
-- stay pg_catalog-qualified for search_path='' safety.

CREATE TABLE IF NOT EXISTS public.hub_pipeline_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage         text NOT NULL DEFAULT 'warm_lead' CHECK (stage IN (
                  'warm_lead','active_bid','accepted_bid','needs_onboarding','placed','archived')),
  full_name         text NOT NULL,
  specialty_slug    text,
  specialty_name    text,
  state             text,
  phone             text,
  email             text,
  owner_email       text,
  target_start_date date,
  assignment_id     uuid,
  assignment_number text,
  assignment_label  text,
  chk_collecting_docs        boolean NOT NULL DEFAULT false,
  chk_needs_contract         boolean NOT NULL DEFAULT false,
  chk_start_dates_booked     boolean NOT NULL DEFAULT false,
  chk_credentialing_started  boolean NOT NULL DEFAULT false,
  chk_credentialing_complete boolean NOT NULL DEFAULT false,
  chk_provider_working       boolean NOT NULL DEFAULT false,
  checklist_audit   jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes             text,
  version     int NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_pipeline_stage_idx   ON public.hub_pipeline_people (stage) WHERE stage <> 'archived';
CREATE INDEX IF NOT EXISTS hub_pipeline_updated_idx ON public.hub_pipeline_people (updated_at DESC);

ALTER TABLE public.hub_pipeline_people ENABLE ROW LEVEL SECURITY;  -- no public policy: service-role only

-- Apply ONE op atomically. createPerson INSERTs (client-provided id); every other
-- op locks the row by id, mutates, bumps version. Returns the resulting row.
CREATE OR REPLACE FUNCTION public.hub_pipeline_apply(p_op jsonb, p_email text)
RETURNS SETOF public.hub_pipeline_people
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_type text := p_op->>'type';
  v_id   uuid;
  v_lock bigint;
  v_now  timestamptz := pg_catalog.now();
  v_at   bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
  v_item text;
  v_val  boolean;
  v_field text;
  v_value text;
BEGIN
  IF p_email IS NULL THEN RAISE EXCEPTION 'missing-email'; END IF;

  IF v_type = 'createPerson' THEN
    INSERT INTO public.hub_pipeline_people (
      id, stage, full_name, specialty_slug, specialty_name, state, phone, email,
      owner_email, target_start_date, notes, created_by, updated_by)
    VALUES (
      (p_op->'input'->>'id')::uuid,
      coalesce(p_op->'input'->>'stage','warm_lead'),
      p_op->'input'->>'full_name',
      p_op->'input'->>'specialty_slug', p_op->'input'->>'specialty_name', p_op->'input'->>'state',
      p_op->'input'->>'phone', p_op->'input'->>'email', p_op->'input'->>'owner_email',
      nullif(p_op->'input'->>'target_start_date','')::date,
      p_op->'input'->>'notes', p_email, p_email)
    ON CONFLICT (id) DO NOTHING;
    RETURN QUERY SELECT * FROM public.hub_pipeline_people WHERE id = (p_op->'input'->>'id')::uuid;
    RETURN;
  END IF;

  v_id := (p_op->>'id')::uuid;
  v_lock := pg_catalog.hashtextextended(v_id::text, 0);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock);

  IF v_type = 'moveStage' THEN
    UPDATE public.hub_pipeline_people SET
      stage = p_op->>'stage',
      chk_provider_working = CASE WHEN p_op->>'stage' = 'placed' THEN true
                                  WHEN p_op->>'stage' <> 'placed' THEN false
                                  ELSE chk_provider_working END,
      version = version + 1, updated_by = p_email, updated_at = v_now
    WHERE id = v_id;

  ELSIF v_type = 'toggleChecklist' THEN
    v_item := p_op->>'item';
    v_val  := (p_op->>'value')::boolean;
    UPDATE public.hub_pipeline_people SET
      chk_collecting_docs        = CASE WHEN v_item='collecting_docs'        THEN v_val ELSE chk_collecting_docs END,
      chk_needs_contract         = CASE WHEN v_item='needs_contract'         THEN v_val ELSE chk_needs_contract END,
      chk_start_dates_booked     = CASE WHEN v_item='start_dates_booked'     THEN v_val ELSE chk_start_dates_booked END,
      chk_credentialing_started  = CASE WHEN v_item='credentialing_started'  THEN v_val ELSE chk_credentialing_started END,
      chk_credentialing_complete = CASE WHEN v_item='credentialing_complete' THEN v_val ELSE chk_credentialing_complete END,
      chk_provider_working       = CASE WHEN v_item='provider_working'       THEN v_val ELSE chk_provider_working END,
      stage = CASE WHEN v_item='provider_working' AND v_val AND stage NOT IN ('placed','archived') THEN 'placed'
                   WHEN v_item='provider_working' AND NOT v_val AND stage='placed' THEN 'needs_onboarding'
                   ELSE stage END,
      checklist_audit = checklist_audit || pg_catalog.jsonb_build_object('chk_'||v_item, pg_catalog.jsonb_build_object('by', p_email, 'at', v_at)),
      version = version + 1, updated_by = p_email, updated_at = v_now
    WHERE id = v_id;

  ELSIF v_type = 'updateField' THEN
    v_field := p_op->>'field';
    v_value := p_op->>'value';  -- null when JSON value is null
    UPDATE public.hub_pipeline_people SET
      full_name         = CASE WHEN v_field='full_name'         THEN coalesce(v_value, full_name) ELSE full_name END,
      specialty_slug    = CASE WHEN v_field='specialty_slug'    THEN v_value ELSE specialty_slug END,
      specialty_name    = CASE WHEN v_field='specialty_name'    THEN v_value ELSE specialty_name END,
      state             = CASE WHEN v_field='state'             THEN v_value ELSE state END,
      phone             = CASE WHEN v_field='phone'             THEN v_value ELSE phone END,
      email             = CASE WHEN v_field='email'             THEN v_value ELSE email END,
      owner_email       = CASE WHEN v_field='owner_email'       THEN v_value ELSE owner_email END,
      target_start_date = CASE WHEN v_field='target_start_date' THEN nullif(v_value,'')::date ELSE target_start_date END,
      notes             = CASE WHEN v_field='notes'             THEN v_value ELSE notes END,
      assignment_id     = CASE WHEN v_field='assignment_id'     THEN nullif(v_value,'')::uuid ELSE assignment_id END,
      assignment_number = CASE WHEN v_field='assignment_number' THEN v_value ELSE assignment_number END,
      assignment_label  = CASE WHEN v_field='assignment_label'  THEN v_value ELSE assignment_label END,
      version = version + 1, updated_by = p_email, updated_at = v_now
    WHERE id = v_id;

  ELSIF v_type = 'archivePerson' THEN
    UPDATE public.hub_pipeline_people SET stage='archived', version=version+1, updated_by=p_email, updated_at=v_now WHERE id = v_id;

  ELSIF v_type = 'restorePerson' THEN
    UPDATE public.hub_pipeline_people SET
      stage = CASE WHEN p_op->>'stage' IN ('warm_lead','active_bid','accepted_bid','needs_onboarding','placed') THEN p_op->>'stage' ELSE 'needs_onboarding' END,
      version=version+1, updated_by=p_email, updated_at=v_now
    WHERE id = v_id;

  ELSE
    RAISE EXCEPTION 'unknown-op-type: %', v_type;
  END IF;

  RETURN QUERY SELECT * FROM public.hub_pipeline_people WHERE id = v_id;
END;
$$;

-- Seal: only service_role executes (browser/anon/authenticated never reach the DB).
REVOKE EXECUTE ON FUNCTION public.hub_pipeline_apply(jsonb, text) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Write the parity integration test (skips without a live DB)**

```ts
// src/lib/hub/pipeline-rpc.integration.test.ts
// Parity: the SQL RPC must agree with the TS oracle applyOp on the row fields.
// Runs ONLY when SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_ROLE_KEY are set
// against a database that already has the 20260705 migration applied; otherwise
// it is skipped (the migration is applied to prod out-of-band by Zach).
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { applyOp, type PipelineOp } from './pipeline-ops';
import { readPerson } from './pipeline-data';

const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const run = URL && KEY ? describe : describe.skip;
const EMAIL = 'test@iastaffing.com';

run('hub_pipeline_apply parity', () => {
  const db = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const compare = (a: unknown, b: unknown) => {
    const strip = (r: Record<string, unknown>) => { const { version, updated_at, updated_by, created_at, ...rest } = r; return rest; };
    expect(strip(readPerson(a) as unknown as Record<string, unknown>)).toEqual(strip(readPerson(b) as unknown as Record<string, unknown>));
  };
  const rpc = async (op: PipelineOp) => {
    const { data, error } = await db.rpc('hub_pipeline_apply', { p_op: op, p_email: EMAIL });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data[0] : data;
  };

  it('create → toggle provider_working → parity with oracle', async () => {
    const id = crypto.randomUUID();
    const created = await rpc({ type: 'createPerson', input: { id, full_name: 'Parity Test', stage: 'active_bid' } });
    let oracle = applyOp(null, { type: 'createPerson', input: { id, full_name: 'Parity Test', stage: 'active_bid' } }, { email: EMAIL, now: 0 })!;
    compare(created, oracle);

    const toggled = await rpc({ type: 'toggleChecklist', id, item: 'provider_working', value: true });
    oracle = applyOp(oracle, { type: 'toggleChecklist', id, item: 'provider_working', value: true }, { email: EMAIL, now: 0 })!;
    compare(toggled, oracle);
    expect(readPerson(toggled).stage).toBe('placed');

    await db.from('hub_pipeline_people').delete().eq('id', id);
  });
});
```

- [ ] **Step 3: Run the parity test (skips locally)**

Run: `npx vitest run src/lib/hub/pipeline-rpc.integration.test.ts`
Expected: `1 skipped` locally (no `SUPABASE_TEST_URL`). When Zach runs it against a migrated DB, it PASSES.

- [ ] **Step 4: Commit**

```bash
git add migrations/20260705_hub_pipeline.sql src/lib/hub/pipeline-rpc.integration.test.ts
git commit -m "feat(hub): pipeline migration + atomic hub_pipeline_apply RPC (parity test)"
```

> **Codex review checkpoint:** hand the migration + `pipeline-ops.ts` to Codex; confirm the RPC's coupling/CASE logic matches `applyOp` before proceeding.

---

## Task 4: API endpoint `/hub/api/pipeline`

**Files:**
- Create: `src/pages/hub/api/pipeline.ts`
- Test: `src/pages/hub/api/pipeline.test.ts`

**Interfaces:**
- Consumes: `readHubEnv`, `getCookie`, `verifySession`, `SESSION_COOKIE`, `getHubSupabase`, `validateOp`, `readPerson`, `BOARD_STAGES`.
- Produces: `GET /hub/api/pipeline?view=active|archived` → `{ ok, people }`; `POST /hub/api/pipeline` (body = one op) → `{ ok, person, version }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/pages/hub/api/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { POST, GET } from './pipeline';

// No cookie / no session secret → unauthorized on both verbs (no DB needed).
const locals = {} as App.Locals;
const req = (body?: unknown, url = 'https://x/hub/api/pipeline') =>
  new Request(url, { method: body !== undefined ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

describe('/hub/api/pipeline', () => {
  it('POST without a session → 401', async () => {
    const res = await POST({ request: req({ op: { type: 'archivePerson', id: 'p1' } }), locals } as any);
    expect(res.status).toBe(401);
  });
  it('GET without a session → 401', async () => {
    const res = await GET({ request: req(undefined), locals } as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/hub/api/pipeline.test.ts`
Expected: FAIL — cannot find module `./pipeline`.

- [ ] **Step 3: Write the endpoint**

```ts
// src/pages/hub/api/pipeline.ts
import type { APIRoute } from 'astro';
import { readHubEnv } from '../../../lib/hub/hub-env';
import { getCookie } from '../../../lib/hub/cookies';
import { verifySession, SESSION_COOKIE } from '../../../lib/hub/session';
import { getHubSupabase } from '../../../lib/hub/hub-supabase';
import { readPerson, BOARD_STAGES } from '../../../lib/hub/pipeline-data';
import { validateOp } from '../../../lib/hub/pipeline-ops';

// Recruitment & Credentialing pipeline read/write endpoint. UNDER /hub so the
// Path=/hub session cookie is sent AND the middleware guard applies (401 JSON).
//   POST                → apply ONE op atomically via hub_pipeline_apply.
//   GET ?view=active    → all non-archived people (board). ?view=archived → archive.
export const prerender = false;

const SELECT = 'id, stage, full_name, specialty_slug, specialty_name, state, phone, email, owner_email, target_start_date, assignment_id, assignment_number, assignment_label, chk_collecting_docs, chk_needs_contract, chk_start_dates_booked, chk_credentialing_started, chk_credentialing_complete, chk_provider_working, checklist_audit, notes, version, updated_by, updated_at';

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function authedEmail(request: Request, env: ReturnType<typeof readHubEnv>): Promise<string | null> {
  const token = getCookie(request.headers.get('cookie'), SESSION_COOKIE);
  const now = Math.floor(Date.now() / 1000);
  const session = token && env.HUB_SESSION_SECRET
    ? await verifySession(token, env.HUB_SESSION_SECRET, now, env.HUB_SESSION_GENERATION)
    : null;
  return session ? session.email : null;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = readHubEnv(locals);
  const email = await authedEmail(request, env);
  if (!email) return json(401, { ok: false, error: 'unauthorized' });

  let raw: unknown;
  try { raw = await request.json(); } catch { return json(400, { ok: false, error: 'invalid-json' }); }
  const parsed = validateOp((raw as { op?: unknown })?.op);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.reason });

  const supabase = getHubSupabase(env);
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });
  const { data, error } = await supabase.rpc('hub_pipeline_apply', { p_op: parsed.op, p_email: email });
  if (error) {
    console.error('[/hub/api/pipeline POST] rpc failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return json(200, { ok: true, person: null, version: 0 });
  const person = readPerson(row);
  return json(200, { ok: true, person, version: person.version });
};

export const GET: APIRoute = async ({ request, locals }) => {
  const env = readHubEnv(locals);
  const email = await authedEmail(request, env);
  if (!email) return json(401, { ok: false, error: 'unauthorized' });

  const url = new URL(request.url);
  const archived = url.searchParams.get('view') === 'archived';
  const supabase = getHubSupabase(env);
  if (!supabase) return json(200, { ok: true, people: [] }); // graceful: no storage → empty board

  let q = supabase.from('hub_pipeline_people').select(SELECT).order('updated_at', { ascending: false, nullsFirst: false });
  q = archived ? q.eq('stage', 'archived') : q.in('stage', BOARD_STAGES as unknown as string[]);
  const { data, error } = await q;
  if (error) {
    // A missing table (pre-migration) degrades to an empty board, never a 5xx.
    console.error('[/hub/api/pipeline GET] read failed:', error.message);
    return json(200, { ok: true, people: [] });
  }
  return json(200, { ok: true, people: (data ?? []).map(readPerson) });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/hub/api/pipeline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/hub/api/pipeline.ts src/pages/hub/api/pipeline.test.ts
git commit -m "feat(hub): /hub/api/pipeline endpoint (one-op POST + view GET)"
```

---

## Task 5: Wire the section shell (nav + SSR view + island + title)

**Files:**
- Create: `src/components/hub/PipelineView.astro`
- Modify: `src/components/hub/HubSidebar.astro` (after line 30, inside `<nav>`)
- Modify: `src/pages/hub/index.astro` (imports, SSR read, render, `<script>`)
- Modify: `src/components/hub/hub-client.ts` (`VIEW_TITLES`, lines 51-54)

**Interfaces:**
- Consumes: `PipelinePerson`, `readPerson`, `BOARD_STAGES` from `pipeline-data`.
- Produces: a `<section class="hub-view" data-view="pipeline">` with `#hub-pipeline` JSON island `{ people, me }` and an empty `#pipe-board` container for the client to fill.

- [ ] **Step 1: Create PipelineView.astro**

```astro
---
/* Recruitment & Credentialing — a live, drag-and-drop provider board. Each person
   is one row in hub_pipeline_people: recruitment = a single stage lane; credentialing
   = 6 parallel multi-select statuses baked onto the card. Clicking a card opens the
   focus-spotlight dossier. pipeline-client.ts hydrates from #hub-pipeline, renders,
   and persists each op (optimistic POST) + polls the guarded GET for live updates. */
import type { PipelinePerson } from '../../lib/hub/pipeline-data';
interface Props { people: PipelinePerson[]; me: string; }
const { people, me } = Astro.props;
// '<' escaped so a field can never break out of the data script island.
const islandJson = JSON.stringify({ people, me }).replace(/</g, '\\u003c');
---
<section class="hub-view" data-view="pipeline">
  <script id="hub-pipeline" type="application/json" is:inline set:html={islandJson}></script>
  <div class="pipe-head">
    <div>
      <div class="pipe-eyebrow">Recruitment &amp; Credentialing</div>
      <h2 class="pipe-title">Provider pipeline</h2>
    </div>
    <div class="pipe-head__actions">
      <span class="pipe-status" id="pipe-status" role="status" aria-live="polite"></span>
      <button class="pipe-archive-toggle" id="pipe-archive-toggle" aria-pressed="false">Archive</button>
      <button class="pipe-add" id="pipe-add"><span>+</span> Add provider</button>
    </div>
  </div>

  <div class="pipe-board" id="pipe-board"><!-- lanes rendered by pipeline-client.ts --></div>

  <!-- Focus-spotlight dossier overlay (filled + toggled by pipeline-client.ts). -->
  <div class="pipe-spot" id="pipe-spot" hidden aria-modal="true" role="dialog"></div>
</section>
```

- [ ] **Step 2: Add the nav button in HubSidebar.astro**

Insert after the Weekly Sync button (after line 30, before `</nav>`):

```astro
    <button class="hub-nav__item" data-view="pipeline">
      <svg class="hub-nav__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Pipeline
    </button>
```

- [ ] **Step 3: Add the VIEW_TITLES entry in hub-client.ts**

Modify the `VIEW_TITLES` object (lines 51-54) to add the pipeline title:

```ts
const VIEW_TITLES: Record<string, string> = {
  overview: 'Overview',
  simulator: 'Rate Simulator',
  analytics: 'Analytics',
  sync: 'Weekly Sync',
  pipeline: 'Recruitment & Credentialing',
};
```

- [ ] **Step 4: Wire index.astro — import, SSR read, render, client script**

Add imports near line 15/22:

```ts
import PipelineView from '../../components/hub/PipelineView.astro';
import { readPerson, BOARD_STAGES, type PipelinePerson } from '../../lib/hub/pipeline-data';
```

Add a `let` near line 49 and a query + result handling. Add `pipelineQ` to the `Promise.all` (extend the array + destructure), tolerant of a missing table:

```ts
let pipelinePeople: PipelinePerson[] = [];
// ...inside `if (supabase) {`, add to the parallel reads:
const pipelineQ = supabase
  .from('hub_pipeline_people')
  .select('id, stage, full_name, specialty_slug, specialty_name, state, phone, email, owner_email, target_start_date, assignment_id, assignment_number, assignment_label, chk_collecting_docs, chk_needs_contract, chk_start_dates_booked, chk_credentialing_started, chk_credentialing_complete, chk_provider_working, checklist_audit, notes, version, updated_by, updated_at')
  .neq('stage', 'archived')
  .order('updated_at', { ascending: false, nullsFirst: false })
  .limit(1000);
// change the Promise.all line to include pipelineQ and destructure pipeRes:
const [jobsRes, eventsRes, syncRes, syncWeeksRes, lsRes, pipeRes] =
  await Promise.all([jobsQ, eventsQ, syncQ, syncWeeksQ, lsQ, pipelineQ]);
// after the existing result handling:
if (pipeRes.error) console.error('[/hub] hub_pipeline_people read failed:', pipeRes.error.message);
else if (pipeRes.data) pipelinePeople = (pipeRes.data as unknown[]).map(readPerson);
```

Render the view inside `<main>` after `<SyncView … />` (after line 150):

```astro
      <PipelineView people={pipelinePeople} me={me} />
```

Add the client import in the bottom `<script>` (after line 156):

```astro
<script>
  import '../../components/hub/hub-client';
  import '../../components/hub/pipeline-client';
</script>
```

- [ ] **Step 5: Create a minimal pipeline-client.ts stub so the import resolves**

```ts
// src/components/hub/pipeline-client.ts
// Client controller for the Recruitment & Credentialing board. Self-invokes;
// bails out when its root isn't present (any other hub view). Filled in Task 6+.
(function pipeline() {
  const root = document.querySelector<HTMLElement>('[data-view="pipeline"]');
  if (!root) return;
  // rendering wired in Task 6
})();
```

- [ ] **Step 6: Typecheck + build**

Run: `npx astro check`
Expected: no new type errors from the pipeline files.

- [ ] **Step 7: Commit**

```bash
git add src/components/hub/PipelineView.astro src/components/hub/pipeline-client.ts src/components/hub/HubSidebar.astro src/components/hub/hub-client.ts src/pages/hub/index.astro
git commit -m "feat(hub): wire pipeline section shell (nav, SSR view, island, title)"
```

---

## Task 6: Render the board (lanes + cards + credentialing meter) + CSS

**Files:**
- Modify: `src/components/hub/pipeline-client.ts`
- Modify: `src/styles/hub.css` (append `.pipe-*` block)

**Interfaces:**
- Consumes: `#hub-pipeline` island `{ people, me }`; `readPerson`, `groupByStage`, `checklistCount`, `BOARD_STAGES`, `STAGE_LABELS`, `CHECKLIST_KEYS`, `chkCol`, `type PipelinePerson` from `pipeline-data`; `rosterEntry` from `hub-roster`.
- Produces: a rendered board in `#pipe-board`; internal `state.people` map + `render()`.

- [ ] **Step 1: Replace pipeline-client.ts with the render implementation**

```ts
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
```

- [ ] **Step 2: Append the `.pipe-*` CSS block to src/styles/hub.css**

Append at the end of the file (uses only existing tokens; `.pipe-lane--*` accents reuse the palette — periwinkle falls back to `#7C84E8`):

```css
/* ── Recruitment & Credentialing pipeline ─────────────────────────────────────── */
.pipe-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-5); }
.pipe-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; color: var(--ink-mute); }
.pipe-title { font-family: var(--font-display); font-weight: 900; font-size: 22px; letter-spacing: -0.02em; color: var(--ink); margin: 3px 0 0; }
.pipe-head__actions { display: flex; align-items: center; gap: 10px; }
.pipe-status { font-family: var(--font-mono); font-size: 11px; color: var(--ink-mute); min-width: 60px; }
.pipe-status.is-saving { color: var(--pop-butter); } .pipe-status.is-saved { color: var(--mn-cyan, #59BFE7); } .pipe-status.is-error { color: var(--pop-magenta, #C44569); }
.pipe-add, .pipe-archive-toggle { border: 1px solid var(--rule-strong); background: var(--surface); color: var(--ink); border-radius: 12px; padding: 9px 15px; font-family: var(--font-body); font-weight: 700; font-size: 13px; cursor: pointer; transition: border-color 140ms, color 140ms; }
.pipe-add:hover, .pipe-archive-toggle:hover { border-color: var(--pop-magenta, #C44569); color: var(--pop-magenta, #C44569); }
.pipe-archive-toggle[aria-pressed="true"] { background: var(--pop-magenta, #C44569); color: var(--cream-soft); border-color: var(--pop-magenta, #C44569); }

.pipe-board { display: flex; gap: 13px; overflow-x: auto; padding-bottom: var(--space-4); align-items: flex-start; }
.pipe-lane { min-width: 236px; width: 236px; flex-shrink: 0; }
.pipe-lane__head { padding: 2px 4px 12px; }
.pipe-lane__pill { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 5px 11px 5px 9px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700; }
.pipe-lane__n { background: rgba(0,0,0,0.28); border-radius: 999px; padding: 0 6px; font-size: 9.5px; }
.pipe-lane--warm .pipe-lane__pill { background: color-mix(in srgb, var(--pop-butter) 16%, transparent); color: var(--pop-butter); }
.pipe-lane--bid .pipe-lane__pill { background: color-mix(in srgb, var(--pop-magenta,#C44569) 18%, transparent); color: var(--pop-magenta, #C44569); }
.pipe-lane--acc .pipe-lane__pill { background: color-mix(in srgb, #7C84E8 20%, transparent); color: #a9adf2; }
.pipe-lane--onb .pipe-lane__pill { background: color-mix(in srgb, var(--mn-cyan,#59BFE7) 16%, transparent); color: var(--mn-cyan, #59BFE7); }
.pipe-lane--placed .pipe-lane__pill { background: color-mix(in srgb, var(--mn-cyan,#59BFE7) 24%, transparent); color: var(--mn-cyan, #59BFE7); }
.pipe-lane__body { display: flex; flex-direction: column; gap: 10px; min-height: 60px; border-radius: 14px; padding: 4px; transition: background 160ms, box-shadow 160ms; }
.pipe-lane__body.is-dragover { background: color-mix(in srgb, var(--mn-cyan,#59BFE7) 8%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--mn-cyan,#59BFE7) 45%, transparent); }
.pipe-lane--placed .pipe-lane__body.is-dragover { box-shadow: inset 0 0 0 1.5px var(--mn-cyan, #59BFE7); }

.pipe-card { background: var(--surface); border: 1px solid var(--rule); border-radius: 15px; padding: 13px; cursor: grab; transition: transform 150ms, box-shadow 150ms, border-color 150ms; }
.pipe-card:hover { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(0,0,0,0.35); }
.pipe-card:focus-visible { outline: 2px solid var(--pop-magenta, #C44569); outline-offset: 2px; }
.pipe-card.is-dragging { opacity: 0.5; }
.pipe-card__top { display: flex; gap: 10px; align-items: flex-start; }
.pipe-av { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0; display: grid; place-items: center; font-family: var(--font-display); font-weight: 900; font-size: 13px; color: var(--cream-soft); background: linear-gradient(140deg, var(--pop-magenta,#C44569), #7a2e45); }
.pipe-card__name { font-family: var(--font-display); font-weight: 900; font-size: 15px; letter-spacing: -0.01em; line-height: 1.1; color: var(--ink); }
.pipe-spec { display: inline-block; margin-top: 4px; font-size: 10.5px; font-weight: 600; color: var(--pop-magenta, #C44569); background: color-mix(in srgb, var(--pop-magenta,#C44569) 13%, transparent); border: 1px solid color-mix(in srgb, var(--pop-magenta,#C44569) 22%, transparent); border-radius: 999px; padding: 2px 8px; }
.pipe-card__meta { font-size: 11px; color: var(--ink-mute); margin-top: 10px; }
.pipe-cred { margin-top: 11px; padding-top: 10px; border-top: 1px dashed var(--rule-strong); }
.pipe-cred__lbl { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 7px; }
.pipe-cred__ct { color: var(--mn-cyan, #59BFE7); font-weight: 700; float: right; }
.pipe-meter { display: flex; gap: 3px; }
.pipe-meter i { flex: 1; height: 5px; border-radius: 999px; background: var(--bone); transition: background 200ms; }
.pipe-meter i.on { background: var(--mn-cyan, #59BFE7); }
.pipe-card__foot { display: flex; justify-content: flex-end; margin-top: 12px; }
.pipe-owner { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-family: var(--font-mono); font-size: 9px; font-weight: 700; color: var(--cream-soft); background: var(--av, #8A8A8A); }
.pipe-empty { font-size: 12px; color: var(--ink-mute); text-align: center; padding: 14px 6px; }
.pipe-lane__add { border: 1px dashed var(--rule-strong); background: none; color: var(--ink-mute); border-radius: 12px; padding: 9px; font-family: var(--font-body); font-weight: 600; font-size: 12px; cursor: pointer; transition: color 140ms, border-color 140ms; }
.pipe-lane__add:hover { color: var(--pop-magenta, #C44569); border-color: var(--pop-magenta, #C44569); }

@media (prefers-reduced-motion: reduce) { .pipe-card, .pipe-meter i, .pipe-lane__body { transition: none; } }
```

- [ ] **Step 2b: Verify the render in the app**

Run the dev server and open `/hub` (signed in), click the **Pipeline** nav.
Run: `npm run dev`
Expected: five empty lanes render with correct labels + "Add" buttons; no console errors. (Board is empty until Task 7 adds a provider.)

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/pipeline-client.ts src/styles/hub.css
git commit -m "feat(hub): render pipeline board — lanes, cards, credentialing meter"
```

---

## Task 7: Add provider + optimistic op persistence + live poll

**Files:**
- Modify: `src/components/hub/pipeline-client.ts`

**Interfaces:**
- Consumes: `applyOp`, `validateOp`, `type PipelineOp` from `pipeline-ops`; `rosterPickerList` from `hub-roster`; the endpoint `/hub/api/pipeline`.
- Produces: `sendOp(op)`, `adopt(person, version)`, `poll()`, an add-provider form; `createPerson` on submit.

- [ ] **Step 1: Add persistence + poll + add-form to pipeline-client.ts**

Add these imports at the top:

```ts
import { applyOp, type PipelineOp } from '../../lib/hub/pipeline-ops';
import { rosterPickerList } from '../../lib/hub/hub-roster';
```

Inside the IIFE, immediately before the final `render();` bootstrap line, add:

```ts
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
```

- [ ] **Step 2: Add the modal/form CSS to hub.css**

Append:

```css
.pipe-modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(6,6,10,0.6); backdrop-filter: blur(3px); padding: 20px; }
.pipe-form { width: 420px; max-width: 100%; background: var(--surface); border: 1px solid var(--rule-strong); border-radius: 18px; padding: 20px; box-shadow: 0 30px 70px rgba(0,0,0,0.5); }
.pipe-form__h { font-family: var(--font-display); font-weight: 900; font-size: 17px; color: var(--ink); margin: 0 0 14px; }
.pipe-f { display: flex; flex-direction: column; gap: 4px; margin-bottom: 11px; }
.pipe-f > span { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); }
.pipe-f input, .pipe-f select, .pipe-f textarea { border: 1px solid var(--rule); border-radius: 10px; padding: 9px 11px; font-family: var(--font-body); font-size: 13px; background: var(--bone); color: var(--ink); }
.pipe-f input:focus, .pipe-f select:focus, .pipe-f textarea:focus { outline: none; border-color: var(--pop-magenta, #C44569); }
.pipe-f2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pipe-form__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
.pipe-btn { border: 1px solid var(--rule-strong); background: none; color: var(--ink-soft); border-radius: 10px; padding: 9px 16px; font-family: var(--font-body); font-weight: 700; font-size: 13px; cursor: pointer; }
.pipe-btn--primary { background: var(--pop-magenta, #C44569); border-color: var(--pop-magenta, #C44569); color: var(--cream-soft); }
```

- [ ] **Step 3: Verify in the app**

Run: `npm run dev` → `/hub` → Pipeline → **Add provider** → fill name + submit.
Expected: card appears instantly in the target lane; status shows "Saving…" then "Saved ✓"; the card persists on reload (once the migration is applied to your dev DB) or at least stays for the session. Open a second tab and confirm the new card appears within ~4s.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/pipeline-client.ts src/styles/hub.css
git commit -m "feat(hub): add-provider form, optimistic op persistence, live poll"
```

---

## Task 8: Drag-and-drop between lanes (moveStage) with motion

**Files:**
- Modify: `src/components/hub/pipeline-client.ts`
- Modify: `package.json` (add sortablejs)

**Interfaces:**
- Consumes: `commit`, `moveStage` op; SortableJS.
- Produces: draggable lanes; dropping a card fires `moveStage`; Placed-lane drop glow.

- [ ] **Step 1: Install SortableJS**

Run:
```bash
npm install sortablejs@1 && npm install -D @types/sortablejs
```
Expected: both packages added to `package.json`.

- [ ] **Step 2: Wire Sortable in pipeline-client.ts**

Add the import at the top:

```ts
import Sortable from 'sortablejs';
```

Insert the `let sortables` + `mountSortables` block inside the IIFE, immediately before the final `render();` bootstrap line (so `sortables` is initialized before the first render calls `mountSortables`). It re-arms every lane after each re-render:

```ts
  let sortables: Sortable[] = [];
  function mountSortables() {
    sortables.forEach((s) => s.destroy());
    sortables = BOARD_STAGES.map((stage) => {
      const el = board!.querySelector<HTMLElement>(`.pipe-lane__body[data-stage="${stage}"]`)!;
      return Sortable.create(el, {
        group: 'pipe', animation: 170, easing: 'cubic-bezier(0.2,0.7,0.2,1)',
        draggable: '.pipe-card', ghostClass: 'is-dragging', filter: '.pipe-lane__add, .pipe-empty',
        onStart: () => board!.querySelectorAll('.pipe-lane__body').forEach((b) => b.classList.add('is-dropzone')),
        onEnd: (evt) => {
          board!.querySelectorAll('.pipe-lane__body').forEach((b) => b.classList.remove('is-dropzone', 'is-dragover'));
          const id = evt.item.getAttribute('data-id');
          const toStage = (evt.to as HTMLElement).dataset.stage as BoardStage | undefined;
          const fromStage = (evt.from as HTMLElement).dataset.stage as BoardStage | undefined;
          if (!id || !toStage || toStage === fromStage) { render(); return; } // same lane → re-render (no in-lane order persistence in v1)
          commit({ type: 'moveStage', id, stage: toStage });
        },
        onMove: (evt) => { (evt.to as HTMLElement).classList.add('is-dragover'); return true; },
      });
    });
  }
```

At the very end of `render()` (after `board!.innerHTML = …`), add:

```ts
    mountSortables();
```

- [ ] **Step 3: Verify drag in the app**

Run: `npm run dev` → drag a card from Warm Leads to Placed.
Expected: smooth animated move; card lands in Placed; reopening its dossier (Task 9) or reload shows `Provider Working` checked (coupling). Dragging back to an earlier lane unchecks it. Status shows Saving→Saved.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/pipeline-client.ts package.json package-lock.json
git commit -m "feat(hub): drag-and-drop lane moves via SortableJS (moveStage)"
```

---

## Task 9: Focus-spotlight dossier (contact, quick actions, checklist, notes, archive)

**Files:**
- Modify: `src/components/hub/pipeline-client.ts`
- Modify: `src/styles/hub.css`

**Interfaces:**
- Consumes: `commit`, `toggleChecklist`, `updateField`, `archivePerson` ops; `CHECKLIST_KEYS`, `CHECKLIST_LABELS`, `chkCol`, `checklistCount`, `rosterEntry`.
- Produces: click/Enter a card → `#pipe-spot` overlay opens with the dossier; edits fire ops.

- [ ] **Step 1: Add the dossier to pipeline-client.ts**

Add near the top of the IIFE:

```ts
  const spot = document.getElementById('pipe-spot')!;
  // Backdrop click closes. Bound ONCE here (closeSpot hoists) — openSpot only
  // (re)binds the freshly-rendered inner controls, never this persistent element,
  // so re-opening the dossier never stacks duplicate backdrop listeners.
  spot.addEventListener('click', (e) => { if (e.target === spot) closeSpot(); });
```

Add these functions after `openAddForm`:

```ts
  const svgPhone = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>';
  const svgMail = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
  const svgText = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function closeSpot() { spot.hidden = true; spot.innerHTML = ''; }

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
          <span class="pipe-av">${esc(initials(p))}</span>
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
            <button class="pipe-btn pipe-archive" style="margin-top:16px">${p.stage === 'archived' ? 'Restore to Needs Onboarding' : 'Archive provider'}</button>
          </div>
        </div>
      </div>`;
    spot.hidden = false;

    spot.querySelector('.pipe-spot__x')!.addEventListener('click', closeSpot);
    spot.querySelectorAll<HTMLElement>('.pipe-chip').forEach((chip) => chip.addEventListener('click', () => {
      const item = chip.dataset.chk as (typeof CHECKLIST_KEYS)[number];
      const value = !people.get(id)![chkCol(item)];
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
      const cur = people.get(id)!;
      if (cur.stage === 'archived') commit({ type: 'restorePerson', id, stage: 'needs_onboarding' });
      else commit({ type: 'archivePerson', id });
      closeSpot();
    });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !spot.hidden) closeSpot(); });
```

Extend the delegated board click handler (from Task 7) to open the dossier on a card click (add before the `.pipe-lane__add` handling returns, i.e. inside the same listener):

```ts
    const card = (e.target as HTMLElement).closest<HTMLElement>('.pipe-card');
    if (card) { openSpot(card.dataset.id!); return; }
```

Also open on keyboard Enter/Space for the focused card:

```ts
  board.addEventListener('keydown', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.pipe-card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSpot(card.dataset.id!); }
  });
```

- [ ] **Step 2: Add dossier CSS to hub.css**

Append:

```css
.pipe-spot { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; background: rgba(6,6,10,0.6); backdrop-filter: blur(4px); padding: 24px; animation: pipeSpotIn 260ms ease; }
.pipe-spot[hidden] { display: none; }
@keyframes pipeSpotIn { from { opacity: 0; } to { opacity: 1; } }
.pipe-spot__card { width: 560px; max-width: 100%; background: var(--surface); border: 1px solid var(--rule-strong); border-radius: 20px; padding: 22px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); position: relative; animation: pipeCardIn 300ms cubic-bezier(0.2,0.7,0.2,1); }
@keyframes pipeCardIn { from { transform: scale(0.92) translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
.pipe-spot__x { position: absolute; top: 14px; right: 16px; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--rule-strong); background: none; color: var(--ink-soft); cursor: pointer; }
.pipe-spot__x:hover { border-color: var(--pop-magenta, #C44569); color: var(--ink); }
.pipe-spot__head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.pipe-spot__name { font-family: var(--font-display); font-weight: 900; font-size: 20px; color: var(--ink); }
.pipe-spot__sub { font-size: 11px; color: var(--ink-mute); margin-top: 2px; }
.pipe-qa-row { display: flex; gap: 8px; margin: 16px 0; }
.pipe-qa { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--rule-strong); border-radius: 10px; padding: 9px; font-size: 12px; font-weight: 700; color: var(--ink-soft); text-decoration: none; }
.pipe-qa:hover { border-color: var(--mn-cyan, #59BFE7); color: var(--mn-cyan, #59BFE7); }
.pipe-qa.is-off { opacity: 0.4; pointer-events: none; }
.pipe-qa svg { width: 13px; height: 13px; }
.pipe-spot__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.pipe-spot__lbl { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-mute); margin: 14px 0 8px; }
.pipe-spot__grid > div > .pipe-spot__lbl:first-child { margin-top: 0; }
.pipe-kv { display: flex; align-items: center; gap: 9px; padding: 6px 0; font-size: 12.5px; color: var(--ink); }
.pipe-kv svg { width: 14px; height: 14px; color: var(--mn-cyan, #59BFE7); }
.pipe-notes { width: 100%; border: 1px solid var(--rule); border-radius: 10px; padding: 9px 11px; font-family: var(--font-body); font-size: 12.5px; background: var(--bone); color: var(--ink); resize: vertical; }
.pipe-notes:focus { outline: none; border-color: var(--pop-magenta, #C44569); }
.pipe-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.pipe-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 600; color: var(--ink-soft); background: var(--bone); border: 1px solid var(--rule); border-radius: 999px; padding: 7px 12px 7px 9px; cursor: pointer; transition: 150ms; }
.pipe-chip__bx { width: 14px; height: 14px; border-radius: 5px; border: 2px solid var(--rule-strong); display: grid; place-items: center; }
.pipe-chip.on { background: color-mix(in srgb, var(--mn-cyan,#59BFE7) 13%, transparent); border-color: color-mix(in srgb, var(--mn-cyan,#59BFE7) 45%, transparent); color: var(--ink); }
.pipe-chip.on .pipe-chip__bx { background: var(--mn-cyan, #59BFE7); border-color: var(--mn-cyan, #59BFE7); }
@media (max-width: 560px) { .pipe-spot__grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .pipe-spot, .pipe-spot__card { animation: none; } }
```

- [ ] **Step 3: Verify in the app**

Run: `npm run dev` → click a card.
Expected: board dims/blurs, dossier scales up; ticking a chip fills the meter and updates the count; ticking "Provider Working" moves the card to Placed on close; editing notes + blur persists; Archive removes it from the board; Esc/✕/click-out closes.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/pipeline-client.ts src/styles/hub.css
git commit -m "feat(hub): focus-spotlight dossier — contact, checklist, notes, archive"
```

---

## Task 10: Archive view toggle + final polish

**Files:**
- Modify: `src/components/hub/pipeline-client.ts`
- Modify: `src/styles/hub.css`

**Interfaces:**
- Consumes: `#pipe-archive-toggle`; the GET `?view=archived`.
- Produces: an archive mode that lists archived people (read + restore); reduced-motion + empty-state polish.

- [ ] **Step 1: Add archive-mode toggle to pipeline-client.ts**

After the poll setup, add:

```ts
  async function loadView() {
    try {
      const res = await fetch('/hub/api/pipeline?view=' + (archiveMode ? 'archived' : 'active'), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      const b = await res.json();
      if (!b?.ok || !Array.isArray(b.people)) return;
      people.clear(); version.clear();
      for (const raw of b.people) { const p = readPerson(raw); if (p.id) { people.set(p.id, p); version.set(p.id, p.version); } }
      render();
    } catch { /* ignore */ }
  }

  const archiveToggle = document.getElementById('pipe-archive-toggle');
  archiveToggle?.addEventListener('click', () => {
    archiveMode = !archiveMode;
    archiveToggle.setAttribute('aria-pressed', String(archiveMode));
    archiveToggle.textContent = archiveMode ? 'Back to board' : 'Archive';
    board!.classList.toggle('is-archive', archiveMode);
    document.getElementById('pipe-add')!.style.display = archiveMode ? 'none' : '';
    loadView();
  });
```

In `render()`, when `archiveMode` is true, render a single flat list instead of lanes. Guard the top of `render()`:

```ts
    if (archiveMode) {
      const list = [...people.values()].filter((p) => p.stage === 'archived');
      board!.innerHTML = `<div class="pipe-archive-list">${list.map(cardHtml).join('') || '<div class="pipe-empty">Archive is empty</div>'}</div>`;
      return; // no sortables in archive mode
    }
```

- [ ] **Step 2: Add archive-list CSS to hub.css**

Append:

```css
.pipe-archive-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(236px, 1fr)); gap: 12px; }
.pipe-board.is-archive { display: block; }
```

- [ ] **Step 3: Verify in the app**

Run: `npm run dev` → archive a provider (dossier) → click **Archive** toggle.
Expected: the board switches to a grid of archived people; opening one shows a "Restore" action that returns it to Needs Onboarding on the board; toggling back shows the lanes.

- [ ] **Step 4: Commit**

```bash
git add src/components/hub/pipeline-client.ts src/styles/hub.css
git commit -m "feat(hub): archive view toggle + restore + polish"
```

---

## Task 11: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run src/lib/hub/pipeline-data.test.ts src/lib/hub/pipeline-ops.test.ts src/pages/hub/api/pipeline.test.ts`
Expected: all PASS.

- [ ] **Step 2: Confirm no regressions in the existing hub suite**

Run: `npx vitest run src/lib/hub`
Expected: existing Weekly Sync / rate-engine tests still PASS (no shared-file breakage).

- [ ] **Step 3: Typecheck the whole project**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 4: Manual end-to-end smoke (signed in, dev DB with migration applied)**

Walk the flow and confirm each:
- Add a provider to Warm Leads → card appears + Saved ✓.
- Drag it across all lanes → smooth motion, persists.
- Drag to Placed → dossier shows Provider Working checked; drag back → unchecked.
- Open dossier → tick several statuses (meter fills), edit notes, use Call/Email/Text links.
- Archive → leaves board; Archive toggle lists it; Restore → back on board.
- Second browser tab → new/changed cards appear within ~4s.
- Reduced-motion OS setting → no card/spotlight animations.

- [ ] **Step 5: Codex review of the client module**

Hand `src/components/hub/pipeline-client.ts` to Codex; address anything flagged; re-run steps 1-3.

- [ ] **Step 6: Final commit (if review produced fixes)**

```bash
git add -A
git commit -m "chore(hub): pipeline verification + codex review fixes"
```

> **Deploy is out of scope for this plan.** The feature is complete locally on `redesign/v5-reskin`. Deploying requires (a) Zach applying `migrations/20260705_hub_pipeline.sql` to prod, (b) SHOW-BEFORE-DEPLOY, and (c) explicit deploy authorization.

---

## Post-plan build-time notes (from the spec)

- Populate real `@iastaffing.com` emails in `src/lib/hub/hub-roster.ts` so owner avatars render names/colors.
- Copy the canonical specialty slug set from the `ims_jobs` migration if you later constrain `specialty_slug` (v1 leaves it free text).
- The optional LocumSmart job link (`assignment_*` fields + `estimated_credentialing_time` context) is deferred; the columns exist and `updateField` supports them when the UI is added.
