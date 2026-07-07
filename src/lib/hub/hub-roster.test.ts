import { describe, it, expect } from 'vitest';
import { rosterEntry } from './hub-roster';

describe('rosterEntry', () => {
  it('derives a Title-Cased name + initials from a dotted local-part', () => {
    const e = rosterEntry('zach.young@iastaffing.com');
    expect(e.name).toBe('Zach Young');
    expect(e.initials).toBe('ZY');
    expect(e.color).toMatch(/^#/);
  });
  it('derives from a single-word local-part', () => {
    const e = rosterEntry('zach@confirm');
    expect(e.name).toBe('Zach');
    expect(e.initials).toBe('Z');
  });
  it('handles _ and - separators, case-insensitively and deterministically', () => {
    const a = rosterEntry('someone.new@imstaffing.ai');
    const b = rosterEntry('SOMEONE.NEW@imstaffing.ai');
    expect(a.name).toBe('Someone New');
    expect(a.initials).toBe('SN');
    expect(a.color).toBe(b.color);
  });
  it('handles empty author email', () => {
    expect(rosterEntry('')).toMatchObject({ name: 'Unknown', initials: '?' });
  });
});
