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

/**
 * Damerau / optimal-string-alignment edit distance — counts insertion,
 * deletion, substitution, and adjacent transposition as one edit each. Full DP,
 * but the inputs here are single words (≤ ~20 chars) so the cost is negligible.
 * Powers the typo-tolerant search ("radiolgy" → "radiology", "ansethesia" → …).
 */
export function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev2 = new Array<number>(bl + 1).fill(0);
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1); // adjacent transposition
      }
      curr[j] = v;
    }
    const tmp = prev2;
    prev2 = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

/**
 * Per-token typo budget. Longer tokens tolerate more typos; tokens under 4
 * chars get NO fuzz (substring only) because short tokens edit-match far too
 * many unrelated words ("rad" ~ "tax"/"car"/"bad").
 */
function fuzzBudget(len: number): number {
  if (len < 4) return 0;
  if (len <= 6) return 1;
  return 2;
}

/** Split a haystack into whole words for the edit-distance (fuzzy) pass. */
function haystackWords(haystack: string): string[] {
  return haystack.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Does one query token hit the haystack? Substring FIRST — that covers the
 * homepage's curated stems ("anesth", "urolog") and keeps every count in exact
 * lockstep with the pre-fuzzy behavior — then a typo-tolerant pass: the token
 * is within its edit-distance budget of some whole word in the haystack.
 */
export function tokenHits(
  token: string,
  haystack: string,
  collapsedHaystack: string,
  words: string[],
): boolean {
  if (haystack.includes(token)) return true;
  // Separator-insensitive substring so "obgyn" / "ob gyn" both match "ob-gyn"
  // (and a hyphenated query token still matches the same compound). Purely
  // additive — it can only add matches, never remove them, so lockstep holds.
  const collapsedToken = token.replace(/[\s-]+/g, '');
  if (collapsedToken.length >= 3 && collapsedHaystack.includes(collapsedToken)) return true;
  const budget = fuzzBudget(token.length);
  if (budget === 0) return false;
  for (const w of words) {
    if (Math.abs(w.length - token.length) > budget) continue;
    if (editDistance(token, w) <= budget) return true;
  }
  return false;
}

/**
 * True when every token of `query` hits the prebuilt `haystack` — by substring
 * or by typo-tolerant word match. The SINGLE matcher shared by the homepage
 * count (via matchesQuery) and the /jobs client filter (which passes each
 * card's data-keywords as the haystack), so the two surfaces always agree.
 */
export function haystackMatchesQuery(haystack: string, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const hay = haystack.toLowerCase();
  const collapsedHay = hay.replace(/[\s-]+/g, '');
  const words = haystackWords(hay);
  return tokens.every((t) => tokenHits(t, hay, collapsedHay, words));
}

/** True when `query` matches the job — typo-tolerant; every token must hit. */
export function matchesQuery(job: JobSearchFields, query: string): boolean {
  return haystackMatchesQuery(jobHaystack(job), query);
}

/** Count how many jobs match `query`. */
export function countMatching(jobs: JobSearchFields[], query: string): number {
  return jobs.reduce((n, job) => (matchesQuery(job, query) ? n + 1 : n), 0);
}
