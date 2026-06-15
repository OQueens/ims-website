import { describe, it, expect } from 'vitest';
import { applyOp, validateOp, type SyncOp } from './sync-ops';
import { emptyColumn, type ColumnData } from './sync-data';

const ctx = { email: 'zach@iastaffing.com', now: 1000 };
const withSection = (): ColumnData => ({ v: 3, sections: [{ id: 'sec1', title: '', focuses: [] }] });

describe('applyOp', () => {
  it('upsertFocus creates a focus stamped with author + createdAt, no editedBy', () => {
    const out = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'hi' } }, ctx);
    expect(out.sections[0].focuses[0]).toMatchObject({ id: 'f1', html: 'hi', by: 'zach@iastaffing.com', createdAt: 1000 });
    expect(out.sections[0].focuses[0].editedBy).toBeUndefined();
  });
  it('re-applying an IDENTICAL create op is a true no-op (idempotent, retry-safe)', () => {
    const op: SyncOp = { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } };
    const once = applyOp(withSection(), op, ctx);
    const twice = applyOp(once, op, { email: 'matt@iastaffing.com', now: 9999 });
    expect(twice).toEqual(once);
  });
  it('upsertFocus with DIFFERENT html stamps editedBy/editedAt, keeps original by/createdAt', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'a' } }, ctx);
    col = applyOp(col, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'b' } }, { email: 'matt@iastaffing.com', now: 2000 });
    expect(col.sections[0].focuses[0]).toMatchObject({ html: 'b', by: 'zach@iastaffing.com', createdAt: 1000, editedBy: 'matt@iastaffing.com', editedAt: 2000 });
  });
  it('deleteFocus removes by id; no-op when absent', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    col = applyOp(col, { type: 'deleteFocus', sectionId: 'sec1', focusId: 'f1' }, ctx);
    expect(col.sections[0].focuses).toHaveLength(0);
    expect(applyOp(col, { type: 'deleteFocus', sectionId: 'sec1', focusId: 'f1' }, ctx)).toEqual(col);
  });
  it('setSectionTitle sets by id', () => {
    expect(applyOp(withSection(), { type: 'setSectionTitle', sectionId: 'sec1', title: 'Recruiting' }, ctx).sections[0].title).toBe('Recruiting');
  });
  it('addSection appends stamped section; idempotent by id; no-title allowed', () => {
    let col = applyOp(emptyColumn(), { type: 'addSection', section: { id: 's2' } }, ctx);
    expect(col.sections[0]).toMatchObject({ id: 's2', title: '', by: 'zach@iastaffing.com' });
    col = applyOp(col, { type: 'addSection', section: { id: 's2', title: 'Ops' } }, ctx);
    expect(col.sections).toHaveLength(1);
  });
  it('deleteSection removes by id', () => {
    expect(applyOp(withSection(), { type: 'deleteSection', sectionId: 'sec1' }, ctx).sections).toHaveLength(0);
  });
  it('clearColumn empties all sections', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    expect(applyOp(col, { type: 'clearColumn' }, ctx)).toEqual({ v: 3, sections: [] });
  });
  it('respects MAX_FOCUSES and MAX_SECTIONS caps', () => {
    let col = withSection();
    for (let i = 0; i < 60; i++) col = applyOp(col, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f' + i, html: 'x' } }, ctx);
    expect(col.sections[0].focuses.length).toBe(50);
    let c2: ColumnData = emptyColumn();
    for (let i = 0; i < 20; i++) c2 = applyOp(c2, { type: 'addSection', section: { id: 's' + i } }, ctx);
    expect(c2.sections.length).toBe(16);
  });
  it('does not mutate its input', () => {
    const input = withSection(); const snap = JSON.stringify(input);
    applyOp(input, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    expect(JSON.stringify(input)).toBe(snap);
  });

  // Auto-create: the FIRST focus/title of a blank week targets the client's
  // auto-ensured (never-addSection'd) section — applyOp + the RPC must create it
  // rather than silently drop the edit.
  it('upsertFocus into a NON-EXISTENT section auto-creates the section (stamped) + adds the focus', () => {
    const out = applyOp(emptyColumn(), { type: 'upsertFocus', sectionId: 'secNEW', focus: { id: 'fNEW', html: 'hi' } }, ctx);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]).toMatchObject({ id: 'secNEW', title: '', by: 'zach@iastaffing.com' });
    expect(out.sections[0].focuses[0]).toMatchObject({ id: 'fNEW', html: 'hi', by: 'zach@iastaffing.com', createdAt: 1000 });
  });
  it('auto-create on upsertFocus is idempotent (identical re-apply is a no-op)', () => {
    const op = { type: 'upsertFocus', sectionId: 'secNEW', focus: { id: 'fNEW', html: 'hi' } } as const;
    const once = applyOp(emptyColumn(), op, ctx);
    const twice = applyOp(once, op, { email: 'matt@iastaffing.com', now: 9999 });
    expect(twice).toEqual(once); // no second section, no editedBy
  });
  it('setSectionTitle into a NON-EXISTENT section auto-creates it with the title', () => {
    const out = applyOp(emptyColumn(), { type: 'setSectionTitle', sectionId: 'secT', title: 'Recruiting' }, ctx);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]).toMatchObject({ id: 'secT', title: 'Recruiting', by: 'zach@iastaffing.com' });
  });
  it('deleteFocus into a non-existent section does NOT auto-create (stays a no-op)', () => {
    const out = applyOp(emptyColumn(), { type: 'deleteFocus', sectionId: 'secX', focusId: 'fX' }, ctx);
    expect(out.sections).toHaveLength(0);
  });
  it('auto-create respects MAX_SECTIONS (upsert into a 17th section is dropped)', () => {
    let col: ColumnData = emptyColumn();
    for (let i = 0; i < 16; i++) col = applyOp(col, { type: 'addSection', section: { id: 'sec' + i } }, ctx);
    expect(col.sections.length).toBe(16);
    const out = applyOp(col, { type: 'upsertFocus', sectionId: 'sec99', focus: { id: 'f', html: 'x' } }, ctx);
    expect(out.sections.length).toBe(16); // no 17th section created
  });
  it('trims section-title whitespace (matches readColumn on read)', () => {
    expect(applyOp(withSection(), { type: 'setSectionTitle', sectionId: 'sec1', title: '  Ops  ' }, ctx).sections[0].title).toBe('Ops');
    expect(applyOp(emptyColumn(), { type: 'addSection', section: { id: 'secW', title: '  Mktg ' } }, ctx).sections[0].title).toBe('Mktg');
  });
});

describe('validateOp', () => {
  it('accepts a well-formed upsertFocus', () => {
    expect(validateOp({ type: 'upsertFocus', sectionId: 'sec1xx', focus: { id: 'f1xxx', html: 'x' } }).ok).toBe(true);
  });
  it('accepts clearColumn (no fields)', () => { expect(validateOp({ type: 'clearColumn' }).ok).toBe(true); });
  it('accepts addSection without a title', () => {
    const r = validateOp({ type: 'addSection', section: { id: 'secNoT' } });
    expect(r.ok && (r.op as any).section.title).toBeUndefined();
  });
  it('rejects unknown op + missing fields', () => {
    expect(validateOp({ type: 'nope' }).ok).toBe(false);
    expect(validateOp({ type: 'deleteFocus', sectionId: 'sec1xx' }).ok).toBe(false);
  });
});
