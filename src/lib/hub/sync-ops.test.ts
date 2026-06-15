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
