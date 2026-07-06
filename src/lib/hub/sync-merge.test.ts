import { describe, it, expect } from 'vitest';
import { comparableCol, mergeAdopt } from './sync-merge';
import type { ColumnData } from './sync-data';

const mk = (html: string, by = 'a@x.io', editedBy?: string, editedAt?: number): ColumnData => ({
  v: 3, sections: [{ id: 'sec1', title: 'T', focuses: [{ id: 'f1', html, by, createdAt: 1, ...(editedBy ? { editedBy } : {}), ...(editedAt ? { editedAt } : {}) }] }],
});

describe('comparableCol', () => {
  it('differs when html changes', () => { expect(comparableCol(mk('a'))).not.toBe(comparableCol(mk('b'))); });
  it('differs when VISIBLE attribution changes (by/editedBy)', () => {
    expect(comparableCol(mk('a', 'a@x.io'))).not.toBe(comparableCol(mk('a', 'b@x.io')));
    expect(comparableCol(mk('a', 'a@x.io', 'c@x.io', 5))).not.toBe(comparableCol(mk('a', 'a@x.io', 'd@x.io', 5)));
  });
  it('ignores an editedAt-only delta (clock skew must not force a re-render)', () => {
    // editedAt is stamped by the client clock optimistically and by the Postgres
    // clock authoritatively, so the two ALWAYS differ by clock skew. It is never
    // rendered (only by/editedBy drive the avatar) and it only ever changes together
    // with html (applyOp stamps it solely on a real html change). If it gated
    // adoption, mergeAdopt keeping the caret focus local would make every 4s poll
    // see a phantom delta → a full board re-render while you type (the "bounce").
    expect(comparableCol(mk('a', 'a@x.io', 'c@x.io', 5))).toBe(comparableCol(mk('a', 'a@x.io', 'c@x.io', 9)));
  });
  it('ignores empty untitled sections (cosmetic churn)', () => {
    const withEmpty: ColumnData = { v: 3, sections: [{ id: 's', title: '', focuses: [] }] };
    expect(comparableCol(withEmpty)).toBe(comparableCol({ v: 3, sections: [] }));
  });
});

describe('mergeAdopt', () => {
  it('adopts the incoming column wholesale when no caret', () => {
    expect(mergeAdopt(mk('old'), mk('new'), null)).toEqual(mk('new'));
  });
  it('preserves the live focus the caret is in, adopts the rest', () => {
    const current: ColumnData = { v: 3, sections: [{ id: 'sec1', title: 'T', focuses: [
      { id: 'f1', html: 'MY LIVE TYPING', by: 'me@x.io', createdAt: 1 },
      { id: 'f2', html: 'old', by: 'a@x.io', createdAt: 1 },
    ] }] };
    const incoming: ColumnData = { v: 3, sections: [{ id: 'sec1', title: 'T', focuses: [
      { id: 'f1', html: 'server version', by: 'me@x.io', createdAt: 1 },
      { id: 'f2', html: 'NEW from teammate', by: 'a@x.io', createdAt: 1 },
    ] }] };
    const out = mergeAdopt(current, incoming, 'f1');
    expect(out.sections[0].focuses.find((f) => f.id === 'f1')!.html).toBe('MY LIVE TYPING');
    expect(out.sections[0].focuses.find((f) => f.id === 'f2')!.html).toBe('NEW from teammate');
  });
});
