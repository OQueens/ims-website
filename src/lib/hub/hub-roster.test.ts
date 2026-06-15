import { describe, it, expect } from 'vitest';
import { rosterEntry } from './hub-roster';

describe('rosterEntry', () => {
  it('returns the seeded entry for a known (exact, lowercase) key', () => {
    const e = rosterEntry('zach@confirm');
    expect(e.name).toBe('Zach');
    expect(e.initials).toBe('Z');
    expect(e.color).toMatch(/^#/);
  });
  it('degrades for an unknown email: local-part name, derived initial, deterministic color', () => {
    const a = rosterEntry('someone.new@imstaffing.ai');
    const b = rosterEntry('SOMEONE.NEW@imstaffing.ai');
    expect(a.initials).toBe('S');
    expect(a.name).toBe('someone.new');
    expect(a.color).toBe(b.color);
  });
  it('handles empty author email', () => {
    expect(rosterEntry('')).toMatchObject({ name: 'Unknown', initials: '?' });
  });
});
