/**
 * Single source of the ims_jobs PUBLIC read contract.
 *
 * The schema (migrations/20260508_ims_jobs_table.sql) deliberately separates
 * INTERNAL columns (facility_name, facility_names, description, raw_payload,
 * organization, organization_id — LS payloads embed facility identity, phone
 * numbers, and "vendors must NOT contact the facility" disclaimers) from
 * PUBLIC columns. NOTHING outside this module may query ims_jobs; every
 * public read goes through fetchActiveJobs so the allowlist is the only
 * column set that can reach a rendered page. Deny-by-default: a column not
 * in PUBLIC_JOB_COLUMNS cannot be selected here.
 */
import { createClient } from '@supabase/supabase-js';

export const PUBLIC_JOB_COLUMNS =
  'id, specialty_slug, specialty_name, facility_state, facility_city, public_facility_label, length_category, call_type, coverage_type';

/** Named ONLY so the privacy test can assert they never enter the allowlist. */
export const INTERNAL_JOB_COLUMNS = [
  'facility_name', 'facility_names', 'description', 'raw_payload',
  'organization', 'organization_id',
] as const;

export interface JobRow {
  id: string;
  specialty_slug: string;
  specialty_name: string | null;
  facility_state: string | null;
  facility_city: string | null;
  public_facility_label: string | null;
  length_category: string | null;
  call_type: string | null;
  coverage_type: string | null;
}

export interface JobsEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export const specialtyLabel = (s: string): string =>
  s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const lengthDisplay = (c: string | null): string =>
  c ? c.charAt(0).toUpperCase() + c.slice(1) : '';

export const facilityHeadline = (j: JobRow): string => {
  // Always render public_facility_label; facility_name_public clearance is
  // intentionally NOT consulted (sticky-clearance hazard documented in the
  // schema). 'Healthcare Facility' only fires for the admin-set-NULL edge.
  const label = j.public_facility_label ?? 'Healthcare Facility';
  const locTail = [j.facility_city, j.facility_state].filter(Boolean).join(', ');
  return locTail ? `${label} · ${locTail}` : label;
};

export const bodyParts = (j: JobRow): string =>
  [j.call_type, j.coverage_type].filter(Boolean).join(' · ');

export const cardTitle = (j: JobRow): string =>
  j.specialty_name ?? specialtyLabel(j.specialty_slug);

/**
 * Read active public job rows through the PUBLIC allowlist (the only
 * ims_jobs read path). Returns a DISCRIMINATED result so the caller can
 * distinguish a genuinely-empty board from a degraded read (Codex A4):
 *   { ok:true,  jobs }                  — query succeeded ([] = truly empty)
 *   { ok:false, reason:'unconfigured' } — Supabase env not set yet; the
 *                                         EXPECTED pre-wiring state, NOT an
 *                                         outage — returned SILENTLY (no log)
 *   { ok:false, reason:'query_error' }  — env set but the read failed (DEGRADED)
 *   { ok:false, reason:'timeout' }      — read exceeded JOBS_READ_TIMEOUT_MS
 *                                         (a stalled Supabase; DEGRADED)
 *   { ok:false, reason:'client_crash' } — unexpected exception (DEGRADED)
 * The page renders the dignified shell on every !ok branch; the distinction
 * exists so a degraded read is operator-visible rather than masquerading as
 * "no live assignments". The read is bounded by an AbortController so a
 * stalled Supabase cannot hang /jobs (Codex A4-R2). Error logs carry only
 * the structured code, never raw messages. LIMIT 1000 matches the PostgREST
 * default server max (Phase 1.A scale is tens-to-low-hundreds of rows).
 */
export type JobsReadResult =
  | { ok: true; jobs: JobRow[] }
  | { ok: false; reason: 'unconfigured' | 'query_error' | 'timeout' | 'client_crash' };

/** Wall-clock bound on the /jobs Supabase read; a stalled DB degrades fast
 *  to the dignified shell rather than hanging until the platform timeout. */
export const JOBS_READ_TIMEOUT_MS = 2500;

export async function fetchActiveJobs(env: JobsEnv): Promise<JobsReadResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    // EXPECTED pre-wiring state — silent: the discriminated result IS the
    // signal; logging here would spam every request before Supabase is wired.
    return { ok: false, reason: 'unconfigured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOBS_READ_TIMEOUT_MS);
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from('ims_jobs')
      .select(PUBLIC_JOB_COLUMNS)
      .eq('status', 'active')
      .order('ls_last_modified', { ascending: false, nullsFirst: false })
      .limit(1000)
      .abortSignal(controller.signal);
    if (error) {
      if (controller.signal.aborted) {
        console.error('[/jobs] supabase read timed out after ' + JOBS_READ_TIMEOUT_MS + 'ms');
        return { ok: false, reason: 'timeout' };
      }
      console.error('[/jobs] supabase read failed — code=' + (error.code ?? 'unknown'));
      return { ok: false, reason: 'query_error' };
    }
    return { ok: true, jobs: (data as JobRow[] | null) ?? [] };
  } catch (e) {
    if (controller.signal.aborted) {
      console.error('[/jobs] supabase read timed out after ' + JOBS_READ_TIMEOUT_MS + 'ms');
      return { ok: false, reason: 'timeout' };
    }
    console.error('[/jobs] supabase client crash:', e instanceof Error ? e.message : String(e));
    return { ok: false, reason: 'client_crash' };
  } finally {
    clearTimeout(timer);
  }
}
