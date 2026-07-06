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
    expect(created.owner_email).toBe(null); // not supplied → null (owner optional)
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

  it('createPerson into placed sets provider_working (invariant)', () => {
    const c = applyOp(null, { type: 'createPerson', input: { id: 'p8', full_name: 'Dr. X', stage: 'placed' } }, ctx)!;
    expect(c.stage).toBe('placed');
    expect(c.chk_provider_working).toBe(true);
  });

  it('restorePerson to placed sets provider_working; to a normal lane clears it', () => {
    const archived = applyOp(P({ stage: 'placed', chk_provider_working: true }), { type: 'archivePerson', id: 'p1' }, ctx)!;
    expect(archived.chk_provider_working).toBe(false); // archive clears working (invariant)
    const toPlaced = applyOp(archived, { type: 'restorePerson', id: 'p1', stage: 'placed' }, ctx)!;
    expect(toPlaced.chk_provider_working).toBe(true);
    const toLane = applyOp(archived, { type: 'restorePerson', id: 'p1', stage: 'warm_lead' }, ctx)!;
    expect(toLane.chk_provider_working).toBe(false);
  });

  it('updateField full_name ignores an empty/whitespace value (never nulls the name)', () => {
    const p = applyOp(P({ full_name: 'Dr. Real Name' }), { type: 'updateField', id: 'p1', field: 'full_name', value: '   ' }, ctx)!;
    expect(p.full_name).toBe('Dr. Real Name');
  });

  it('toggleChecklist provider_working true from archived un-archives to placed (invariant)', () => {
    const p = applyOp(P({ stage: 'archived', chk_provider_working: false }), { type: 'toggleChecklist', id: 'p1', item: 'provider_working', value: true }, ctx)!;
    expect(p.stage).toBe('placed');
    expect(p.chk_provider_working).toBe(true);
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
