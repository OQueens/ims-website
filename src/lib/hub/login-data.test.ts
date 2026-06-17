import { describe, it, expect } from 'vitest';
import { countActiveReqs } from './login-data';

// The login aside shows ONE honest, live, non-sensitive number: the active
// requisition count, counted the SAME way the dashboard counts it
// (aggregateHub().activeReqs === rows.length of the status='active' select). The
// login uses a capped row-select (NOT a { count:'exact', head:true } head read,
// which returns count:null in the Cloudflare Workers runtime). This helper turns
// that Supabase row result into an honest number-or-null: it must NEVER fabricate
// a number on error/missing data (CLAUDE.md no-fake-data) — null means "hide the
// figure", not "show a placeholder".
describe('countActiveReqs', () => {
  it('returns the row count for a valid non-empty array with no error', () => {
    const rows = Array.from({ length: 127 }, (_, i) => ({ id: String(i) }));
    expect(countActiveReqs({ data: rows, error: null })).toBe(127);
  });

  it('returns 0 for an empty array (honest empty state, not null)', () => {
    expect(countActiveReqs({ data: [], error: null })).toBe(0);
  });

  it('returns null when the query errored (never fabricate a number)', () => {
    expect(countActiveReqs({ data: [{ id: '1' }], error: { message: 'boom' } })).toBeNull();
  });

  it('returns null when data is null (missing/unknown)', () => {
    expect(countActiveReqs({ data: null, error: null })).toBeNull();
  });

  it('returns null when data is not an array (unexpected shape)', () => {
    // @ts-expect-error — deliberately wrong shape to prove the runtime guard.
    expect(countActiveReqs({ data: { length: 5 }, error: null })).toBeNull();
  });

  it('returns null for null/undefined input (resilient to a crashed query)', () => {
    expect(countActiveReqs(null)).toBeNull();
    expect(countActiveReqs(undefined)).toBeNull();
  });
});
