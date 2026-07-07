import { describe, it, expect } from 'vitest';
import {
  STAGES, BOARD_STAGES, CHECKLIST_KEYS, checklistCount, groupByStage,
  readPerson, cleanDate, personInitials, SPECIALTY_SUGGESTIONS,
  DISCIPLINE_COLORS, disciplineForSpecialty, disciplineColorFor, type PipelinePerson,
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
    expect(p.full_name).toBe('<b>Ana</b>'); // stored raw; XSS is prevented by esc() at render, not here (single-escape-at-render model)
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

  it('readPerson never throws on non-object input', () => {
    for (const bad of [null, undefined, 42, 'str', [] as unknown]) {
      const p = readPerson(bad);
      expect(p.id).toBe('');
      expect(p.stage).toBe('warm_lead');
      expect(p.version).toBe(0);
      expect(p.checklist_audit).toEqual({});
    }
  });

  it('caps long text, rejects bad email, floors negative version', () => {
    const p = readPerson({ id: 'x', full_name: 'a'.repeat(500), email: 'not-an-email', version: -5 });
    expect(p.full_name.length).toBe(120);
    expect(p.email).toBeNull();
    expect(p.version).toBe(0);
  });

  it('reads a populated checklist_audit entry', () => {
    const p = readPerson({ id: 'x', full_name: 'A', checklist_audit: { chk_needs_contract: { by: 'z@iastaffing.com', at: 1700 }, chk_bogus: { by: 'z@iastaffing.com', at: 1 } } });
    expect(p.checklist_audit.chk_needs_contract).toEqual({ by: 'z@iastaffing.com', at: 1700 });
    expect(p.checklist_audit.chk_bogus).toBeUndefined();
  });
});

describe('personInitials', () => {
  it('returns first+last initials, stripping a leading Dr.', () => {
    expect(personInitials('Dr. Marcus Bell')).toBe('MB');
    expect(personInitials('Priya Nair')).toBe('PN');
  });
  it('uses first+last for 3+ word names', () => {
    expect(personInitials('Mary Jane Watson')).toBe('MW');
  });
  it('returns one letter for a single-word name', () => {
    expect(personInitials('Cher')).toBe('C');
    expect(personInitials('Dr. House')).toBe('H');
  });
  it('returns ? for an empty/blank name', () => {
    expect(personInitials('')).toBe('?');
    expect(personInitials('   ')).toBe('?');
  });
});

describe('discipline colors', () => {
  it('maps a representative specialty in each discipline', () => {
    expect(disciplineForSpecialty('Emergency Medicine')).toBe('Emergency & Critical Care');
    expect(disciplineForSpecialty('General Surgery')).toBe('Surgery');
    expect(disciplineForSpecialty('Psychiatry')).toBe('Psychiatry & Behavioral');
    expect(disciplineForSpecialty('CRNA')).toBe('Anesthesia');
    expect(disciplineForSpecialty('OB/GYN')).toBe("Women's Health");
    expect(disciplineForSpecialty('Nurse Practitioner')).toBe('Advanced Practice');
    expect(disciplineForSpecialty('Radiology (Diagnostic)')).toBe('Radiology & Pathology');
  });
  it('is case-insensitive and trims', () => {
    expect(disciplineForSpecialty('  emergency medicine ')).toBe('Emergency & Critical Care');
  });
  it('falls back to Other for null / empty / unknown free-text', () => {
    expect(disciplineForSpecialty(null)).toBe('Other');
    expect(disciplineForSpecialty('')).toBe('Other');
    expect(disciplineForSpecialty('Underwater Basket Weaving')).toBe('Other');
    expect(disciplineColorFor('Underwater Basket Weaving')).toBe('#8A93A0');
  });
  it('returns the discipline hex color', () => {
    expect(disciplineColorFor('Emergency Medicine')).toBe('#F2A03D');
    expect(DISCIPLINE_COLORS.Surgery).toBe('#F26A5B');
  });
  it('every curated specialty resolves to a real discipline (no Other drift)', () => {
    for (const s of SPECIALTY_SUGGESTIONS) {
      expect(disciplineForSpecialty(s), s).not.toBe('Other');
    }
  });
});
