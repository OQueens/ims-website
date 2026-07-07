// Pure operation algebra for the pipeline. ONE op at a time, applied to a single
// PipelinePerson (or null for createPerson). Used by (a) the client for optimistic
// UI, (b) vitest as the test oracle, (c) mirrored by the hub_pipeline_apply RPC.
// Never mutates input. The `placed` stage and `chk_provider_working` are kept in
// LOCKSTEP; the other 5 checklist items are independent.
import {
  type PipelinePerson, type Stage, type ChecklistKey,
  STAGES, BOARD_STAGES, CHECKLIST_KEYS, chkCol, readPerson,
  cleanEmail, cleanDate,
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

// Cap a text field the same way readPerson would (trim → slice; no HTML-escaping
// here — single-escape-at-render, see pipeline-data.ts's cleanText comment).
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
  if (field === 'assignment_id') return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;
  const s = value.trim().slice(0, FIELD_CAP[field]);
  return s.length ? s : null;
}

export function applyOp(person: PipelinePerson | null, op: PipelineOp, ctx: ApplyCtx): PipelinePerson | null {
  // INVARIANT enforced by every stage-changing op below: chk_provider_working
  // === (stage === 'placed'). Keeps the Placed lane and the "Provider Working"
  // checkbox in lockstep no matter which op path is taken.
  if (op.type === 'createPerson') {
    const i = op.input;
    const stage = i.stage && (STAGES as readonly string[]).includes(i.stage) ? i.stage : 'warm_lead';
    return readPerson({
      id: i.id, stage, full_name: i.full_name,
      specialty_slug: i.specialty_slug, specialty_name: i.specialty_name, state: i.state,
      phone: i.phone, email: i.email, owner_email: i.owner_email,
      target_start_date: i.target_start_date, notes: i.notes,
      chk_provider_working: stage === 'placed', // invariant
      version: 0, updated_by: ctx.email, updated_at: null,
    });
  }
  if (!person) return null;
  const p = clone(person);
  switch (op.type) {
    case 'updateField': {
      const v = coerceField(op.field, op.value);
      // full_name is non-nullable — ignore an empty/whitespace update rather than nulling it.
      if (op.field === 'full_name' && (v === null || v === '')) return p;
      (p as unknown as Record<string, unknown>)[op.field] = v;
      return p;
    }
    case 'moveStage':
      p.stage = op.stage;
      p.chk_provider_working = op.stage === 'placed'; // invariant
      return p;
    case 'toggleChecklist': {
      p[chkCol(op.item)] = op.value;
      p.checklist_audit = { ...p.checklist_audit, [chkCol(op.item)]: { by: ctx.email, at: ctx.now } };
      if (op.item === 'provider_working') {
        if (op.value) p.stage = 'placed';              // working ⟹ placed (even from archived)
        else if (p.stage === 'placed') p.stage = 'needs_onboarding';
      }
      return p;
    }
    case 'archivePerson':
      p.stage = 'archived';
      p.chk_provider_working = false; // archived is not placed → invariant
      return p;
    case 'restorePerson':
      p.stage = (BOARD_STAGES as readonly string[]).includes(op.stage) ? op.stage : 'needs_onboarding';
      p.chk_provider_working = p.stage === 'placed'; // invariant
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
