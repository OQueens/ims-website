import { describe, it, expect } from 'vitest';
import { aggregateHub, type HubJobRow } from './hub-data';

const row = (o: Partial<HubJobRow>): HubJobRow => ({
  specialty_slug: 'anesthesia',
  specialty_name: 'Anesthesia',
  facility_state: 'NC',
  facility_city: 'Charlotte',
  public_facility_label: 'Regional Medical Center',
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
  it('takes the newest 5 jobs and never fabricates pay', () => {
    const a = aggregateHub(
      Array.from({ length: 8 }, (_, i) => row({ ls_last_modified: `2026-06-0${i + 1}T00:00:00Z` })),
      1_900_000_000,
    );
    expect(a.latestJobs).toHaveLength(5);
    expect(a.latestJobs.every((j) => j.pay === 'Rate on request')).toBe(true);
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
