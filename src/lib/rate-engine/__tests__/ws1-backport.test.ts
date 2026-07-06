import { describe, it, expect } from 'vitest';
import { sourceFamily, KNOWN_FAMILY_OVERRIDES } from '../sourceFamily';

// WS1 (2026-07-01) back-port: the 7 forward-looking Scrapling posting-source
// families must resolve to their canonical family so independence counting stays
// correct once the aggregators go live. These do NOT fire on today's universe, so
// no quote number changes; this only proves the mapping is present in the LIVE copy.
//
// Two layers of guard, because sourceFamily()'s prefix fallback makes some behavioral
// assertions pass even with the override deleted: sourceFamily('tandym_health') falls
// back to its own first segment 'tandym' regardless, and the self-named keys (trackfive,
// communitybrands) resolve to themselves via the fallback too. So layer (1) is a direct
// KNOWN_FAMILY_OVERRIDES membership check that FAILS if any WS1 entry is removed, and
// layer (2) keeps the behavioral sourceFamily() assertions to document resolution intent.
describe('WS1 back-port — posting-source family mappings present in the live engine', () => {
  // (1) Presence guard, load-bearing for EVERY WS1 key, including the self-named ones the
  // prefix fallback would otherwise mask. Deleting any of these override lines fails here.
  it('registers all 7 WS1 override entries in KNOWN_FAMILY_OVERRIDES', () => {
    expect(KNOWN_FAMILY_OVERRIDES.trackfive).toBe('trackfive');
    expect(KNOWN_FAMILY_OVERRIDES.locumjobsonline).toBe('trackfive');
    expect(KNOWN_FAMILY_OVERRIDES.tandym).toBe('tandym');
    expect(KNOWN_FAMILY_OVERRIDES.tandym_health).toBe('tandym');
    expect(KNOWN_FAMILY_OVERRIDES.communitybrands).toBe('communitybrands');
    expect(KNOWN_FAMILY_OVERRIDES.jama).toBe('communitybrands');
    expect(KNOWN_FAMILY_OVERRIDES.acr).toBe('communitybrands');
  });
  // (2) Behavioral assertions: resolution through sourceFamily(). The cross-key collapses
  // (locumjobsonline->trackfive, jama/acr->communitybrands) are independently load-bearing;
  // the self-named keys are guarded by the membership check above.
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
