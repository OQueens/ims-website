import { describe, it, expect } from 'vitest';
import {
  tokenize,
  jobHaystack,
  matchesQuery,
  countMatching,
  editDistance,
  haystackMatchesQuery,
  type JobSearchFields,
} from './job-search';

const job = (over: Partial<JobSearchFields> = {}): JobSearchFields => ({
  specialty_slug: 'anesthesia',
  specialty_name: 'Anesthesiology',
  facility_city: 'Austin',
  facility_state: 'TX',
  public_facility_label: '240-bed acute',
  length_category: 'long',
  call_type: null,
  coverage_type: null,
  ...over,
});

describe('tokenize', () => {
  it('lowercases, strips punctuation, and splits on whitespace', () => {
    expect(tokenize('OB-GYN, Sacramento!')).toEqual(['ob-gyn', 'sacramento']);
  });

  it('keeps hyphens inside a token', () => {
    expect(tokenize('internal-medicine')).toEqual(['internal-medicine']);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  // Mirrors the /jobs client tokenizer exactly (jobs/index.astro <script>):
  //   s.toLowerCase().replace(/[^a-z0-9\- ]+/g,' ').split(/\s+/).filter(Boolean)
  it('matches the /jobs client tokenizer on mixed input', () => {
    expect(tokenize('  Emergency / Helena, MT  ')).toEqual(['emergency', 'helena', 'mt']);
  });
});

describe('jobHaystack', () => {
  it('includes specialty, location, and label fields lowercased', () => {
    const h = jobHaystack(job());
    expect(h).toContain('anesthesia');
    expect(h).toContain('anesthesiology');
    expect(h).toContain('austin');
    expect(h).toContain('tx');
    expect(h).toContain('240-bed acute');
  });

  it('omits null/undefined fields without emitting literal "null"/"undefined"', () => {
    const h = jobHaystack(job({ specialty_name: null, call_type: null, coverage_type: undefined }));
    expect(h).not.toContain('null');
    expect(h).not.toContain('undefined');
    expect(h).toContain('anesthesia');
  });
});

describe('matchesQuery', () => {
  it('treats an empty or whitespace query as matching everything', () => {
    expect(matchesQuery(job(), '')).toBe(true);
    expect(matchesQuery(job(), '   ')).toBe(true);
  });

  it('matches a partial token via substring (anesth → Anesthesiology)', () => {
    expect(matchesQuery(job(), 'anesth')).toBe(true);
  });

  it('matches by city and by state', () => {
    expect(matchesQuery(job(), 'austin')).toBe(true);
    expect(matchesQuery(job(), 'tx')).toBe(true);
  });

  it('requires every token of a multi-word query to be present', () => {
    const im = job({
      specialty_slug: 'internal-medicine',
      specialty_name: 'Internal Medicine',
      facility_city: 'Reno',
      facility_state: 'NV',
      public_facility_label: null,
    });
    expect(matchesQuery(im, 'internal medicine')).toBe(true);
  });

  it('does not match an unrelated specialty (hospitalist vs internal medicine)', () => {
    const hosp = job({
      specialty_slug: 'hospitalist',
      specialty_name: 'Hospitalist',
      facility_city: 'Boise',
      facility_state: 'ID',
      public_facility_label: null,
    });
    expect(matchesQuery(hosp, 'internal medicine')).toBe(false);
  });

  it('returns false when no field contains the query', () => {
    expect(matchesQuery(job(), 'radiology')).toBe(false);
  });
});

describe('countMatching', () => {
  const feed: JobSearchFields[] = [
    job({ specialty_slug: 'anesthesia', specialty_name: 'Anesthesiology' }),
    job({ specialty_slug: 'ob-gyn', specialty_name: 'OB-GYN', facility_city: 'Sacramento', facility_state: 'CA' }),
    job({ specialty_slug: 'radiology', specialty_name: 'Radiology', facility_city: 'Helena', facility_state: 'MT' }),
  ];

  it('counts only the jobs whose haystack matches the query', () => {
    expect(countMatching(feed, 'anesth')).toBe(1);
    expect(countMatching(feed, 'ob-gyn')).toBe(1);
    expect(countMatching(feed, 'radiolog')).toBe(1);
  });

  it('returns 0 for a specialty absent from the feed', () => {
    expect(countMatching(feed, 'psych')).toBe(0);
  });

  it('counts every job for an empty query', () => {
    expect(countMatching(feed, '')).toBe(feed.length);
  });
});

describe('editDistance (Damerau / optimal string alignment)', () => {
  it('is 0 for identical strings', () => {
    expect(editDistance('radiology', 'radiology')).toBe(0);
  });

  it('counts a single deletion (radiolgy → radiology)', () => {
    expect(editDistance('radiolgy', 'radiology')).toBe(1);
  });

  it('counts a single insertion (dalas → dallas)', () => {
    expect(editDistance('dalas', 'dallas')).toBe(1);
  });

  it('counts an adjacent transposition as a single edit', () => {
    expect(editDistance('ba', 'ab')).toBe(1);
    expect(editDistance('cardilogy', 'cardiolgy')).toBe(1);
  });

  it('counts a full replacement', () => {
    expect(editDistance('abc', 'xyz')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
});

describe('matchesQuery — typo tolerance (fuzzy, every-token-must-hit)', () => {
  it('matches a misspelled specialty (anesthesiolgy → Anesthesiology)', () => {
    expect(matchesQuery(job(), 'anesthesiolgy')).toBe(true);
  });

  it('matches a misspelled/short-by-one specialty (radiolgy → Radiology)', () => {
    const rad = job({ specialty_slug: 'radiology', specialty_name: 'Radiology', public_facility_label: null });
    expect(matchesQuery(rad, 'radiolgy')).toBe(true);
  });

  it('matches a misspelled city (dalas → Dallas)', () => {
    const j = job({ facility_city: 'Dallas', facility_state: 'TX', public_facility_label: null });
    expect(matchesQuery(j, 'dalas')).toBe(true);
  });

  it('matches free-text specialty + location with a typo (cardiology houstan)', () => {
    const j = job({
      specialty_slug: 'cardiology',
      specialty_name: 'Internal Medicine - Cardiology',
      facility_city: 'Houston',
      facility_state: 'TX',
      public_facility_label: null,
    });
    expect(matchesQuery(j, 'cardiology houstan')).toBe(true);
  });

  it('still requires every token to hit (right specialty, wrong city → false)', () => {
    const j = job({
      specialty_slug: 'cardiology',
      specialty_name: 'Cardiology',
      facility_city: 'Houston',
      facility_state: 'TX',
      public_facility_label: null,
    });
    expect(matchesQuery(j, 'cardiology boston')).toBe(false);
  });

  it('does not fuzzy-match a clearly different specialty (psychiatry vs anesthesiology)', () => {
    expect(matchesQuery(job(), 'psychiatry')).toBe(false);
  });

  it('does not apply edit-distance fuzz to very short tokens (≤3 chars: substring only)', () => {
    // "rad" should NOT fuzz-match "tax"/"car"/etc.; only substring hits count.
    const j = job({ specialty_slug: 'other', specialty_name: 'Audiologist', facility_city: 'Reno', facility_state: 'NV', public_facility_label: null });
    expect(matchesQuery(j, 'rad')).toBe(false);
  });

  it('matches a separator-free or hyphenated query (obgyn / ob-gyn → Obstetrics and Gynecology)', () => {
    const j = job({ specialty_slug: 'ob-gyn', specialty_name: 'Obstetrics and Gynecology', facility_city: 'Reno', facility_state: 'NV', public_facility_label: null });
    expect(matchesQuery(j, 'obgyn')).toBe(true);
    expect(matchesQuery(j, 'ob-gyn')).toBe(true);
  });

  it('does not let the separator-insensitive path match an unrelated job', () => {
    expect(matchesQuery(job(), 'obgyn')).toBe(false);
  });
});

describe('haystackMatchesQuery — client-facing matcher over a prebuilt haystack', () => {
  it('matches substring and typo queries against a haystack string', () => {
    const h = jobHaystack(job());
    expect(haystackMatchesQuery(h, 'anesth')).toBe(true);
    expect(haystackMatchesQuery(h, 'anesthesiolgy')).toBe(true);
    expect(haystackMatchesQuery(h, 'austin')).toBe(true);
    expect(haystackMatchesQuery(h, 'radiology')).toBe(false);
  });

  it('treats an empty query as matching', () => {
    expect(haystackMatchesQuery('anything here', '')).toBe(true);
  });

  it('is the engine behind matchesQuery (same result for the job haystack)', () => {
    const j = job({ specialty_name: 'Cardiology', facility_city: 'Houston' });
    expect(haystackMatchesQuery(jobHaystack(j), 'cardiolgy houstan')).toBe(matchesQuery(j, 'cardiolgy houstan'));
  });
});
