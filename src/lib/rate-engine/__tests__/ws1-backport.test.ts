import { describe, it, expect } from 'vitest';
import { sourceFamily } from '../sourceFamily';

// WS1 (2026-07-01) back-port: the 7 forward-looking Scrapling posting-source
// families must resolve to their canonical family so independence counting stays
// correct once the aggregators go live. These do NOT fire on today's universe, so
// no quote number changes — this only proves the mapping is present in the LIVE copy.
describe('WS1 back-port — posting-source family mappings present in the live engine', () => {
  it('maps TrackFive / LocumJobsOnline to one family', () => {
    expect(sourceFamily('trackfive')).toBe('trackfive');
    expect(sourceFamily('locumjobsonline')).toBe('trackfive');
    expect(sourceFamily('trackfive')).toBe(sourceFamily('locumjobsonline'));
  });
  it('maps Tandym / Tandym Health to one family', () => {
    expect(sourceFamily('tandym')).toBe('tandym');
    expect(sourceFamily('tandym_health')).toBe('tandym');
    expect(sourceFamily('tandym')).toBe(sourceFamily('tandym_health'));
  });
  it('collapses JAMA + ACR into the shared Community Brands platform family', () => {
    expect(sourceFamily('communitybrands')).toBe('communitybrands');
    expect(sourceFamily('jama')).toBe('communitybrands');
    expect(sourceFamily('acr')).toBe('communitybrands');
    // independence: two postings of one platform must not fake two families
    expect(sourceFamily('jama')).toBe(sourceFamily('acr'));
  });
});
