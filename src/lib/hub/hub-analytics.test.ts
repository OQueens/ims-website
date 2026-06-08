import { describe, it, expect } from 'vitest';
import { aggregateAnalytics, activityFromEvents, type HubEventRow } from './hub-analytics';
import type { HubJobRow } from './hub-data';

// Fixed reference clock: 2026-06-15T00:00:00Z, expressed in unix SECONDS
// (matching aggregateHub's `now` contract).
const NOW = Math.floor(Date.UTC(2026, 5, 15) / 1000);

function job(partial: Partial<HubJobRow>): HubJobRow {
  return {
    specialty_slug: 'anesthesiology',
    specialty_name: 'Anesthesiology',
    facility_state: 'TX',
    facility_city: 'Austin',
    public_facility_label: 'Community Hospital',
    organization: 'Mercy Health',
    organization_id: 'org-1',
    length_category: 'long',
    call_type: null,
    coverage_type: null,
    ls_last_modified: '2026-06-10T00:00:00Z',
    ...partial,
  };
}

function evt(partial: Partial<HubEventRow>): HubEventRow {
  return {
    occurred_at: '2026-06-01T00:00:00Z',
    event_type: 'Receive',
    assignment_id: 'a-1',
    status_after: 'active',
    specialty_slug: 'anesthesiology',
    specialty_name: 'Anesthesiology',
    facility_state: 'TX',
    facility_city: 'Austin',
    organization: 'Mercy Health',
    ...partial,
  };
}

describe('aggregateAnalytics', () => {
  it('active reqs = number of current active jobs', () => {
    const a = aggregateAnalytics([job({}), job({}), job({})], [], NOW);
    expect(a.activeReqs).toBe(3);
  });

  it('empty inputs degrade honestly (no fabricated numbers)', () => {
    const a = aggregateAnalytics([], [], NOW);
    expect(a.activeReqs).toBe(0);
    expect(a.reqsOpened12mo).toBe(0);
    expect(a.daysToClose).toEqual({ avg: null, sample: 0 });
    expect(a.specialtyDonut).toEqual([]);
    expect(a.topFacilities).toEqual([]);
    expect(a.daysToCloseBySpecialty).toEqual([]);
    // 12-month skeleton still present so the chart axis renders.
    expect(a.monthly).toHaveLength(12);
    expect(a.monthly.every((m) => m.opened === 0 && m.avgDaysToClose === null)).toBe(true);
  });

  it('specialty donut counts active jobs by specialty with a stable color', () => {
    const jobs = [
      job({ specialty_slug: 'anesthesiology', specialty_name: 'Anesthesiology' }),
      job({ specialty_slug: 'anesthesiology', specialty_name: 'Anesthesiology' }),
      job({ specialty_slug: 'crna', specialty_name: 'CRNA' }),
    ];
    const a = aggregateAnalytics(jobs, [], NOW);
    expect(a.specialtyDonut[0]).toMatchObject({ name: 'Anesthesiology', val: 2 });
    expect(a.specialtyDonut[1]).toMatchObject({ name: 'CRNA', val: 1 });
    expect(a.specialtyDonut[0].color).toMatch(/^#/);
    // Donut total equals active reqs (center label source).
    expect(a.specialtyDonut.reduce((s, d) => s + d.val, 0)).toBe(3);
  });

  it('collapses the long tail of specialties into "Other"', () => {
    const slugs = ['anesthesiology', 'crna', 'hospitalist', 'emergency-medicine', 'radiology', 'psychiatry', 'cardiology'];
    const jobs = slugs.map((s) => job({ specialty_slug: s, specialty_name: s }));
    const a = aggregateAnalytics(jobs, [], NOW);
    expect(a.specialtyDonut.length).toBeLessThanOrEqual(6);
    expect(a.specialtyDonut.some((d) => d.name === 'Other')).toBe(true);
    expect(a.specialtyDonut.reduce((s, d) => s + d.val, 0)).toBe(7);
  });

  it('top facilities counts active jobs by organization (top 5)', () => {
    const jobs = [
      job({ organization: 'Mercy Health' }),
      job({ organization: 'Mercy Health' }),
      job({ organization: "St. Luke's" }),
    ];
    const a = aggregateAnalytics(jobs, [], NOW);
    expect(a.topFacilities[0]).toMatchObject({ name: 'Mercy Health', val: 2 });
    expect(a.topFacilities[1]).toMatchObject({ name: "St. Luke's", val: 1 });
    expect(a.topFacilities[0].max).toBe(2);
  });

  it('falls back to a generic label when organization is null', () => {
    const a = aggregateAnalytics([job({ organization: null, public_facility_label: 'Trauma Center' })], [], NOW);
    expect(a.topFacilities[0].name).toBe('Trauma Center');
  });

  it('counts reqs opened per month from the FIRST active event per assignment', () => {
    const events = [
      // assignment a-1: first seen 2026-05, plus an Update in 2026-06 (must not double-count)
      evt({ assignment_id: 'a-1', occurred_at: '2026-05-03T00:00:00Z', event_type: 'Receive', status_after: 'active' }),
      evt({ assignment_id: 'a-1', occurred_at: '2026-06-04T00:00:00Z', event_type: 'Update', status_after: 'active' }),
      // assignment a-2: opened 2026-06
      evt({ assignment_id: 'a-2', occurred_at: '2026-06-09T00:00:00Z', event_type: 'Receive', status_after: 'active' }),
    ];
    const a = aggregateAnalytics([], events, NOW);
    const may = a.monthly.find((m) => m.key === '2026-05');
    const jun = a.monthly.find((m) => m.key === '2026-06');
    expect(may?.opened).toBe(1);
    expect(jun?.opened).toBe(1);
    expect(a.reqsOpened12mo).toBe(2);
  });

  it('ignores events with no assignment_id for opened counts', () => {
    const events = [evt({ assignment_id: null, event_type: 'Bid', status_after: 'active' })];
    const a = aggregateAnalytics([], events, NOW);
    expect(a.reqsOpened12mo).toBe(0);
  });

  it('days-to-close = first archived − first active, in whole days, only valid pairs', () => {
    const events = [
      // a-1: opened 2026-06-01, archived 2026-06-11 → 10 days
      evt({ assignment_id: 'a-1', occurred_at: '2026-06-01T00:00:00Z', status_after: 'active' }),
      evt({ assignment_id: 'a-1', occurred_at: '2026-06-11T00:00:00Z', event_type: 'Cancel', status_after: 'archived' }),
      // a-2: opened 2026-06-02, archived 2026-06-08 → 6 days
      evt({ assignment_id: 'a-2', occurred_at: '2026-06-02T00:00:00Z', status_after: 'active' }),
      evt({ assignment_id: 'a-2', occurred_at: '2026-06-08T00:00:00Z', event_type: 'Archive', status_after: 'archived' }),
      // a-3: archived only, no active in log → excluded (no valid pair)
      evt({ assignment_id: 'a-3', occurred_at: '2026-06-05T00:00:00Z', event_type: 'Cancel', status_after: 'archived' }),
    ];
    const a = aggregateAnalytics([], events, NOW);
    expect(a.daysToClose.sample).toBe(2);
    expect(a.daysToClose.avg).toBe(8); // (10 + 6) / 2
  });

  it('excludes negative durations (archive before open) from the proxy', () => {
    const events = [
      evt({ assignment_id: 'a-1', occurred_at: '2026-06-11T00:00:00Z', status_after: 'active' }),
      evt({ assignment_id: 'a-1', occurred_at: '2026-06-01T00:00:00Z', event_type: 'Cancel', status_after: 'archived' }),
    ];
    const a = aggregateAnalytics([], events, NOW);
    expect(a.daysToClose.sample).toBe(0);
    expect(a.daysToClose.avg).toBeNull();
  });

  it('days-to-close by specialty, only specialties with enough samples', () => {
    const mk = (id: string, slug: string, openDay: number, closeDay: number) => [
      evt({ assignment_id: id, specialty_slug: slug, specialty_name: slug, occurred_at: `2026-06-${String(openDay).padStart(2, '0')}T00:00:00Z`, status_after: 'active' }),
      evt({ assignment_id: id, specialty_slug: slug, specialty_name: slug, occurred_at: `2026-06-${String(closeDay).padStart(2, '0')}T00:00:00Z`, event_type: 'Cancel', status_after: 'archived' }),
    ];
    const events = [
      ...mk('a', 'crna', 1, 11), // 10
      ...mk('b', 'crna', 1, 9),  // 8
      ...mk('c', 'radiology', 1, 21), // 20 — single sample, below threshold
    ];
    const a = aggregateAnalytics([], events, NOW);
    const crna = a.daysToCloseBySpecialty.find((r) => r.name === 'CRNA' || r.name === 'crna');
    expect(crna?.val).toBe(9); // (10+8)/2
    expect(a.daysToCloseBySpecialty.some((r) => /radiology/i.test(r.name))).toBe(false);
  });

  it('reqs trend compares the last 3 months vs the prior 3 (up when growing)', () => {
    // Build opens: months -5..-3 have 1 each (prev avg 1), months -2..0 have 3 each (recent avg 3) → up.
    const monthsBack = (n: number) => {
      const d = new Date(Date.UTC(2026, 5, 15));
      d.setUTCMonth(d.getUTCMonth() - n);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-05T00:00:00Z`;
    };
    let id = 0;
    const events: HubEventRow[] = [];
    const add = (when: string, count: number) => {
      for (let i = 0; i < count; i++) events.push(evt({ assignment_id: `x${id++}`, occurred_at: when, status_after: 'active' }));
    };
    add(monthsBack(5), 1); add(monthsBack(4), 1); add(monthsBack(3), 1);
    add(monthsBack(2), 3); add(monthsBack(1), 3); add(monthsBack(0), 3);
    const a = aggregateAnalytics([], events, NOW);
    expect(a.reqsTrend.direction).toBe('up');
    expect(a.reqsTrend.pct).toBeGreaterThan(5);
  });

  it('escapes nothing itself but never throws on malformed dates/nulls', () => {
    const events = [
      evt({ occurred_at: null }),
      evt({ occurred_at: 'not-a-date', status_after: 'archived', event_type: 'Cancel' }),
      evt({ specialty_name: null, specialty_slug: null }),
    ];
    expect(() => aggregateAnalytics([job({})], events, NOW)).not.toThrow();
  });
});

describe('activityFromEvents', () => {
  it('narrates each event with an honest verb, newest first, capped', () => {
    const events = [
      evt({ occurred_at: '2026-06-14T00:00:00Z', event_type: 'Receive', status_after: 'active', specialty_name: 'OB-GYN', facility_city: 'Austin', facility_state: 'TX' }),
      evt({ occurred_at: '2026-06-13T00:00:00Z', event_type: 'Cancel', status_after: 'archived', specialty_name: 'CRNA', facility_city: 'Charlotte', facility_state: 'NC' }),
      evt({ occurred_at: '2026-06-12T00:00:00Z', event_type: 'Update', status_after: 'active', specialty_name: 'Hospitalist', facility_city: null, facility_state: 'MT' }),
      evt({ occurred_at: '2026-06-11T00:00:00Z', event_type: 'Reject', status_after: 'active', specialty_name: 'Radiology', facility_city: 'Reno', facility_state: 'NV' }),
    ];
    const feed = activityFromEvents(events, NOW, 3);
    expect(feed).toHaveLength(3);
    expect(feed[0].txt).toContain('<b>OB-GYN</b>');
    expect(feed[0].txt).toContain('Austin, TX');
    expect(feed[0].txt).toContain('new req');
    expect(feed[1].txt).toContain('req cancelled');
    expect(feed[2].txt).toContain('req updated');
    expect(feed[0].time).toMatch(/ago|recently/);
    expect(feed[0].who).toBe('OB');
  });

  it('escapes DB-derived specialty + location in the activity HTML', () => {
    const feed = activityFromEvents(
      [evt({ specialty_name: '<img src=x onerror=alert(1)>', facility_city: 'A&B', facility_state: null })],
      NOW,
    );
    expect(feed[0].txt).not.toContain('<img');
    expect(feed[0].txt).toContain('&lt;img');
    expect(feed[0].txt).toContain('A&amp;B');
    expect(feed[0].txt.startsWith('<b>')).toBe(true);
  });

  it('returns an empty feed for no events', () => {
    expect(activityFromEvents([], NOW)).toEqual([]);
  });

  it('sorts by occurred_at descending even when the input is unsorted', () => {
    const feed = activityFromEvents(
      [
        evt({ occurred_at: '2026-06-01T00:00:00Z', specialty_name: 'Old' }),
        evt({ occurred_at: '2026-06-10T00:00:00Z', specialty_name: 'New' }),
      ],
      NOW,
    );
    expect(feed[0].txt).toContain('New');
    expect(feed[1].txt).toContain('Old');
  });
});
