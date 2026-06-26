// Hub-owned regression test (survives engine re-sync; the sync script only wipes
// src/lib/rate-engine/, not src/lib/hub/). Guards a real freetext-parser bug:
// the facility-keyword matcher trimmed the deliberate trailing space off the 'va '
// keyword, so 'Pennsylvania'/'Nevada' substring-matched "va" and were misclassified
// as VA/Govt facilities (−15% facilityMult), dropping e.g. PA CRNA from ~$225 to
// ~$191. Fix lives in the canonical engine (parser.ts: input.includes(kw), not
// kw.trim()). These assertions must hold against the vendored engine.
import { describe, it, expect } from 'vitest';
import { buildParsedFromFreetext, initFactors, calculateRate } from '../rate-engine/index';
import type { ParsedAssignment, RateFactors, CalculatedRate } from '../rate-engine/index';

function facilityFor(text: string): { key: string; mult: number; pay: number; state: string | null } {
  const parsed = buildParsedFromFreetext(text) as ParsedAssignment | null;
  if (!parsed) throw new Error(`freetext did not parse: "${text}"`);
  const f = initFactors(parsed) as RateFactors;
  const r = calculateRate(f) as CalculatedRate;
  return { key: f.facility.key, mult: r.facilityMult, pay: r.payRate, state: f.state.code };
}

describe('freetext facility false-positive (Pennsylvania / Nevada → phantom VA)', () => {
  it('does NOT classify "CRNA Pennsylvania" as a VA facility', () => {
    const r = facilityFor('CRNA Pennsylvania');
    expect(r.state).toBe('PA');            // geography still resolves
    expect(r.key).not.toBe('va');          // the bug: was 'va'
    expect(r.mult).toBe(1);                // no phantom −15%
    // PA CRNA day at community = 232 (p70) × 0.97 (PA geo) ≈ 225, not the bug's 191.
    expect(r.pay).toBeGreaterThanOrEqual(220);
  });

  it('does NOT classify "CRNA Nevada nights" as a VA facility', () => {
    const r = facilityFor('CRNA Nevada nights');
    expect(r.key).not.toBe('va');
    expect(r.mult).toBe(1);
  });

  it('STILL detects a genuine VA facility (no over-correction)', () => {
    // "va " with the trailing space is a real VA reference — must still map to 'va'.
    const r = facilityFor('CRNA VA hospital nights');
    expect(r.key).toBe('va');
    expect(r.mult).toBeCloseTo(0.85, 5);
  });
});

describe('freetext facility — word-boundary (no substring false-positives)', () => {
  // The facility matcher must not fire on a keyword buried inside an unrelated
  // word. 'asc' (ambulatory surgery center) is the worst offender for anesthesia.
  it('"cardiovascular" / "vascular" do NOT trigger an ASC facility', () => {
    expect(facilityFor('CRNA cardiovascular surgery').key).not.toBe('asc');
    expect(facilityFor('CRNA vascular nights').key).not.toBe('asc');
  });

  it('"ascension health" does NOT trigger an ASC facility', () => {
    expect(facilityFor('anesthesiology ascension health').key).not.toBe('asc');
  });

  it('"clinical" does NOT trigger an outpatient clinic', () => {
    expect(facilityFor('CRNA clinical coverage').key).not.toBe('outpatient');
  });

  it('STILL detects a genuine ASC and a genuine clinic', () => {
    expect(facilityFor('CRNA asc outpatient').key).toBe('asc');
    expect(facilityFor('CRNA outpatient clinic').key).toBe('outpatient');
  });
});
