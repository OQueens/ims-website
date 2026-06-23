import { describe, it, expect } from 'vitest';
import { aggregateHub, type HubJobRow } from './hub-data';
import { SPECIALTIES } from '../rate-engine/index';

const row = (o: Partial<HubJobRow>): HubJobRow => ({
  specialty_slug: 'anesthesia',
  specialty_name: 'Anesthesia',
  facility_state: 'NC',
  facility_city: 'Charlotte',
  public_facility_label: 'Regional Medical Center',
  organization: null,
  organization_id: null,
  length_category: 'long',
  call_type: null,
  coverage_type: null,
  ls_last_modified: '2026-06-01T00:00:00Z',
  ...o,
});

describe('aggregateHub', () => {
  it('counts active reqs and distinct facilities', () => {
    const a = aggregateHub([row({}), row({ public_facility_label: 'Other' }), row({})], 1_900_000_000);
    expect(a.activeReqs).toBe(3);
    expect(a.facilityCount).toBe(2);
  });
  it('groups pipeline by state, top 5, sorted desc', () => {
    const rows = [row({ facility_state: 'NC' }), row({ facility_state: 'NC' }), row({ facility_state: 'TX' })];
    const a = aggregateHub(rows, 1_900_000_000);
    expect(a.pipelineStates[0]).toMatchObject({ name: 'NC', val: 2 });
    expect(a.pipelineStates[1]).toMatchObject({ name: 'TX', val: 1 });
  });
  it('latest-job specVal always resolves to a real engine specialty key (loadable <option>)', () => {
    const a = aggregateHub(
      [row({ specialty_slug: 'crna' }), row({ specialty_slug: 'general-surgery' }), row({ specialty_slug: 'pediatrics' })],
      1_900_000_000,
    );
    // specVal is now the engine specialty KEY (not a bill base) so a latest-job
    // click loads that specialty into the simulator <select>. Known slugs resolve
    // exactly; unknown slugs fall back to a real default key — never an invalid value.
    expect(a.latestJobs.map((j) => j.specVal)).toContain('crna');
    expect(a.latestJobs.map((j) => j.specVal)).toContain('general surgery');
    expect(a.latestJobs.every((j) => SPECIALTIES[j.specVal] !== undefined)).toBe(true);
  });
  it('latest-job carries the job state + its region for a geo pre-fill on click', () => {
    const a = aggregateHub([row({ facility_state: 'TX' }), row({ facility_state: null }), row({ facility_state: 'zz' })], 1_900_000_000);
    expect(a.latestJobs[0]).toMatchObject({ state: 'TX', region: 'South' });
    expect(a.latestJobs[1]).toMatchObject({ state: null, region: 'National' }); // no state → National
    expect(a.latestJobs[2]).toMatchObject({ state: null, region: 'National' }); // unknown code → not emitted
  });
  it('takes the newest 5 jobs and never fabricates pay', () => {
    const a = aggregateHub(
      Array.from({ length: 8 }, (_, i) => row({ ls_last_modified: `2026-06-0${i + 1}T00:00:00Z` })),
      1_900_000_000,
    );
    expect(a.latestJobs).toHaveLength(5);
    expect(a.latestJobs.every((j) => j.pay === 'Rate on request')).toBe(true);
  });
  it('escapes DB-derived text in the activity HTML snippet', () => {
    const a = aggregateHub([row({ specialty_name: '<img src=x onerror=alert(1)>', facility_city: 'A&B', facility_state: null, public_facility_label: null })], 1_900_000_000);
    expect(a.activity[0].txt).not.toContain('<img');
    expect(a.activity[0].txt).toContain('&lt;img');
    expect(a.activity[0].txt).toContain('A&amp;B');
    // The only real tags are the wrapping <b>…</b>.
    expect(a.activity[0].txt.startsWith('<b>')).toBe(true);
  });

  it('handles an empty feed', () => {
    const a = aggregateHub([], 1_900_000_000);
    expect(a).toMatchObject({
      activeReqs: 0,
      facilityCount: 0,
      pipelineStates: [],
      pipelineSpecs: [],
      latestJobs: [],
      activity: [],
    });
  });
});
