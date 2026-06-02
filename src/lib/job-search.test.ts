import { describe, it, expect } from 'vitest';
import {
  tokenize,
  jobHaystack,
  matchesQuery,
  countMatching,
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
