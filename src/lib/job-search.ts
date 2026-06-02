/**
 * job-search — shared text-match logic for the live ims_jobs feed.
 *
 * The homepage (src/pages/index.astro) renders specialty cards with an "N open
 * this week" count and deep-links each to `/jobs?q=<query>`. For the count to
 * equal what the visitor then sees on /jobs, the homepage MUST match jobs the
 * exact way the /jobs client filter does. This module is that single source of
 * truth.
 *
 * Invariant (kept in lockstep with the tokenizer + haystack in
 * src/pages/jobs/index.astro):
 *   tokenize(q)      = q.toLowerCase().replace(/[^a-z0-9\- ]+/g,' ').split(/\s+/).filter(Boolean)
 *   match            = every token is a substring of the job's haystack
 *   haystack fields  = the same fields the card exposes via data-keywords
 *                      (specialty_slug, specialty_name, facility_city,
 *                       facility_state, public_facility_label, length_category,
 *                       call_type, coverage_type)
 *
 * facility_name is INTERNAL and deliberately never part of the haystack — only
 * public_facility_label is searchable (mirrors the public/internal boundary the
 * rest of the jobs surface enforces).
 */

export interface JobSearchFields {
  specialty_slug: string;
  specialty_name?: string | null;
  facility_city?: string | null;
  facility_state?: string | null;
  public_facility_label?: string | null;
  length_category?: string | null;
  call_type?: string | null;
  coverage_type?: string | null;
}

/** Split a query/string into lowercase tokens, mirroring the /jobs client. */
export function tokenize(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\- ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Lowercased, space-joined searchable text for a single job. */
export function jobHaystack(job: JobSearchFields): string {
  return [
    job.specialty_slug,
    job.specialty_name,
    job.facility_city,
    job.facility_state,
    job.public_facility_label,
    job.length_category,
    job.call_type,
    job.coverage_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** True when every token of `query` is a substring of the job's haystack. */
export function matchesQuery(job: JobSearchFields, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const hay = jobHaystack(job);
  return tokens.every((t) => hay.includes(t));
}

/** Count how many jobs match `query`. */
export function countMatching(jobs: JobSearchFields[], query: string): number {
  return jobs.reduce((n, job) => (matchesQuery(job, query) ? n + 1 : n), 0);
}
