import { describe, it, expect } from 'vitest';
import {
  STAGES, BOARD_STAGES, CHECKLIST_KEYS, checklistCount, groupByStage,
  readPerson, cleanDate, type PipelinePerson,
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
    expect(p.full_name).toBe('&lt;b&gt;Ana&lt;/b&gt;'); // escaped, not interpreted
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
});
