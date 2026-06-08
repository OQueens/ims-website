import { describe, it, expect } from 'vitest';
import { getWeekKey, validateSyncPayload, COLUMN_KEYS, MAX_ITEMS, MAX_ITEM_LEN } from './sync-data';

describe('getWeekKey (ISO week, UTC, deterministic)', () => {
  it('formats as YYYY-Wxx and pads single-digit weeks', () => {
    // Jan 4 is always in ISO week 1.
    expect(getWeekKey(new Date('2026-01-04T00:00:00Z'))).toBe('2026-W01');
  });
  it('computes a mid-year week correctly', () => {
    // Mon 2026-06-08 → ISO week 24.
    expect(getWeekKey(new Date('2026-06-08T12:00:00Z'))).toBe('2026-W24');
  });
  it('rolls the ISO year on the boundary (2025-12-29 is 2026-W01)', () => {
    expect(getWeekKey(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('validateSyncPayload', () => {
  it('accepts a well-formed payload', () => {
    const r = validateSyncPayload({ weekKey: '2026-W24', columnKey: 'recruiting', items: ['Close Austin', 'Source CRNAs'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual(['Close Austin', 'Source CRNAs']);
  });

  it('exposes the three valid columns', () => {
    expect([...COLUMN_KEYS]).toEqual(['recruiting', 'marketing', 'operations']);
  });

  it('rejects a non-object', () => {
    expect(validateSyncPayload(null).ok).toBe(false);
    expect(validateSyncPayload('x').ok).toBe(false);
  });

  it('rejects an unknown column', () => {
    expect(validateSyncPayload({ weekKey: '2026-W24', columnKey: 'finance', items: [] }).ok).toBe(false);
  });

  it('rejects a malformed week key', () => {
    expect(validateSyncPayload({ weekKey: '2026-24', columnKey: 'recruiting', items: [] }).ok).toBe(false);
    expect(validateSyncPayload({ weekKey: 'now', columnKey: 'recruiting', items: [] }).ok).toBe(false);
  });

  it('rejects non-array items and non-string elements', () => {
    expect(validateSyncPayload({ weekKey: '2026-W24', columnKey: 'recruiting', items: 'x' }).ok).toBe(false);
    expect(validateSyncPayload({ weekKey: '2026-W24', columnKey: 'recruiting', items: [1, 2] }).ok).toBe(false);
  });

  it('trims items and caps count + per-item length', () => {
    const many = Array.from({ length: MAX_ITEMS + 50 }, () => '  ' + 'x'.repeat(MAX_ITEM_LEN + 100) + '  ');
    const r = validateSyncPayload({ weekKey: '2026-W24', columnKey: 'operations', items: many });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.items.length).toBe(MAX_ITEMS);
      expect(r.value.items[0].length).toBe(MAX_ITEM_LEN);
      expect(r.value.items[0].startsWith('x')).toBe(true); // trimmed
    }
  });

  it('allows an empty items array (cleared column)', () => {
    const r = validateSyncPayload({ weekKey: '2026-W24', columnKey: 'marketing', items: [] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.items).toEqual([]);
  });
});
