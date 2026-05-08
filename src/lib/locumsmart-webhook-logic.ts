/**
 * Pure-logic helpers for the LocumSmart webhook receiver.
 *
 * Kept separate from src/pages/api/locumsmart-webhook.ts so vitest can cover
 * token verification, field mapping, and derivations without mocking the
 * Supabase client or the Cloudflare Pages runtime.
 *
 * Reference for the canonical job shape consumed by these helpers:
 *   c:/Users/oclou/clinician-agent-new/src/gasworks-ad.js (generateGasworksAd
 *   + generateFetchAd) — the public-facing ad templates the website mirrors.
 *
 * Auth model is bare-token-in-body (NOT HMAC), confirmed empirically via
 * webhook.site capture 2026-05-08: payload includes a `key` field whose
 * value matches the per-subscription Webhook Key shown in the LS dashboard.
 */

// ---------------- LS payload types ----------------

export interface LSFacility {
  facilityId?: string;
  facility?: string;
  facilityAddress?: string;
  facilityCity?: string;
  facilityState?: string;
  facilityZip?: string;
  facilityPhoneNumber?: string;
  facilityUrl?: string;
  facilityTimeZone?: string;
  facilityMappingTimeZoneId?: string;
  holidaysAllowed?: string[];
  // Contact emails are present in LS payloads but never surfaced through this
  // module — they live in raw_payload jsonb only and are never copied into
  // typed columns.
  [key: string]: unknown;
}

export interface LSSpecialty {
  specialtyId?: string;
  specialtyName?: string;
}

export interface LSAssignmentDetails {
  assignmentId?: string;
  assignmentNumber?: string;
  status?: string;
  organizationId?: string;
  organization?: string;
  facilities?: LSFacility[];
  providerType?: string;
  specialties?: LSSpecialty[];
  numProvidersRequested?: number;
  startDate?: string | null;
  endDate?: string | null;
  approximateDecisionDate?: string | null;
  description?: string | null;
  emrSystem?: string | null;
  requestType?: string | null;
  coverageType?: string | null;
  coverageReason?: string | null;
  callType?: string | null;
  callResponseTimeRequired?: string | null;
  callRatio?: string | null;
  practiceSetting?: string | null;
  boardCertificationRequired?: boolean | null;
  boardCertificationMinimum?: string | null;
  fellowship?: string | null;
  requireBls?: boolean | null;
  requireAcls?: boolean | null;
  requireAtls?: boolean | null;
  requirePals?: boolean | null;
  requireAbls?: boolean | null;
  requireOther?: boolean | null;
  otherCertDetails?: string | null;
  traumaLevel?: number | null;
  pedsLevel?: number | null;
  providerLicenseRequirement?: string | null;
  estimatedCredentialingTime?: string | null;
  supervisionRequired?: boolean | null;
  superviseOtherProviders?: boolean | null;
  patientEncountersPerShift?: string | null;
  temporaryPrivilegesAvailable?: boolean | null;
  requireHospitalPrivileges?: string | null;
  nearestAirport?: string | null;
  createDate?: string | null;
  lastModified?: string | null;
  [key: string]: unknown;
}

export interface LSWebhookPayload {
  assignmentId: string;
  assignmentNumber: string;
  details: LSAssignmentDetails;
  key: string;
  operation: string;
  message?: string;
  [key: string]: unknown;
}

// ---------------- Auth ----------------

/**
 * Constant-time string equality. Length is checked first because LS Webhook
 * Keys are fixed-length per subscription so a length mismatch leaks no useful
 * information beyond "wrong secret entirely".
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return acc === 0;
}

// ---------------- Status & operation ----------------

/**
 * Map an LS event operation to our internal status enum. Receive and Update
 * keep the row visible on /jobs; Cancel / Archive / any terminal-sounding
 * operation flips it to archived. Defensive substring match in case LS adds
 * future terminal operations under names we haven't seen yet.
 */
export function deriveStatus(operation: string | null | undefined): 'active' | 'archived' {
  if (!operation) return 'active';
  const op = operation.toLowerCase();
  if (op.includes('cancel') || op.includes('archive') || op.includes('close')) {
    return 'archived';
  }
  return 'active';
}

// ---------------- Specialty normalization ----------------

const CANONICAL_SPECIALTIES = [
  'anesthesiology',
  'crna',
  'hospitalist',
  'emergency-medicine',
  'family-medicine',
  'psychiatry',
  'ob-gyn',
  'general-surgery',
  'radiology',
  'pediatrics',
  'cardiology',
  'neurology',
  'other',
] as const;

export type SpecialtySlug = typeof CANONICAL_SPECIALTIES[number];

/**
 * Map an LS specialtyName string to our canonical slug enum. Order matters:
 * CRNA-specific patterns must match before generic anesthesiology so a
 * "Certified Registered Nurse Anesthetist" string buckets to crna not
 * anesthesiology. Unknown specialties fall through to 'other' so the
 * receiver never produces a row that fails the active-row specialty CHECK.
 */
export function normalizeSpecialtySlug(name: string | null | undefined): SpecialtySlug {
  if (!name) return 'other';
  const lower = name.toLowerCase();
  if (lower.includes('crna') || lower.includes('certified registered nurse')) return 'crna';
  if (lower.includes('anesthesiolog') || lower.includes('anesthesia')) return 'anesthesiology';
  if (lower.includes('hospitalist') || lower.includes('hospital medicine')) return 'hospitalist';
  if (lower.includes('emergency')) return 'emergency-medicine';
  if (lower.includes('family')) return 'family-medicine';
  if (lower.includes('psychiat') || lower.includes('psych')) return 'psychiatry';
  if (lower.includes('gyn') || lower.includes('obstetric') || lower.includes('ob/gyn') || lower.includes('ob-gyn')) return 'ob-gyn';
  if (lower.includes('surgery')) return 'general-surgery';
  if (lower.includes('radiology')) return 'radiology';
  if (lower.includes('pediatric') || lower.includes('peds')) return 'pediatrics';
  if (lower.includes('cardiology') || lower.includes('cardiac')) return 'cardiology';
  if (lower.includes('neurolog')) return 'neurology';
  return 'other';
}

// ---------------- Public facility label ----------------

/**
 * Derive a public-safe facility headline that the /jobs card can render in
 * place of the internal facility name. Always returns a non-null string so
 * the schema's active-row safe-label CHECK passes (active rows must have
 * either facility_name_public=true or public_facility_label IS NOT NULL,
 * and the receiver leaves facility_name_public at the schema default false).
 */
export function derivePublicFacilityLabel(d: LSAssignmentDetails | null | undefined): string {
  const traumaLevel = d?.traumaLevel;
  const setting = d?.practiceSetting;
  const facCount = d?.facilities?.length ?? 0;

  if (typeof traumaLevel === 'number' && traumaLevel >= 1 && traumaLevel <= 5) {
    return `Level ${traumaLevel} Trauma Center`;
  }
  if (setting === 'Outpatient') {
    return facCount > 1 ? 'Multi-Site Outpatient Network' : 'Outpatient Surgery Center';
  }
  if (setting === 'Inpatient') {
    return facCount > 1 ? 'Multi-Site Health System' : 'Hospital';
  }
  return 'Healthcare Facility';
}

// ---------------- Duration display ----------------

/**
 * Friendly duration string mirroring what generateGasworksAd reads from
 * job.durationDisplay. Inclusive day count (May 15 -> May 17 reads as
 * "3 days"). Open-ended assignments (end_date null) read as "Ongoing".
 * Returns null only when start_date itself is missing.
 */
export function deriveDurationDisplay(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start) return null;
  if (!end) return 'Ongoing';
  const sd = new Date(start);
  const ed = new Date(end);
  if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return null;
  const ms = ed.getTime() - sd.getTime();
  if (ms < 0) return null;
  const days = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days === 7) return '1 week';
  if (days < 28) return `${Math.round(days / 7)} weeks`;
  const weeks = Math.round(days / 7);
  if (weeks < 12) return `${weeks} weeks`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? '1 month' : `${months} months`;
  const years = Math.round(months / 12);
  return years === 1 ? '1 year' : `${years} years`;
}

// ---------------- Dot-string nullification ----------------

/**
 * LS sends "." as a placeholder for "no data" in some text fields
 * (callResponseTimeRequired, callRatio, patientEncountersPerShift, etc.).
 * Normalize to NULL at the receiver so /jobs render logic doesn't have to
 * special-case the dot.
 */
export function nullifyDot(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  if (trimmed === '' || trimmed === '.') return null;
  return s;
}

// ---------------- Field mapping ----------------

/**
 * Database row shape for an UPSERT into ims_jobs. Column names match the
 * migration at migrations/20260508_ims_jobs_table.sql verbatim.
 *
 * Intentionally absent from this type:
 *   - length_category — Postgres GENERATES it; receiver must not set it.
 *   - created_at — schema DEFAULT now(); receiver must not set it.
 *   - facility_name_public — recruiter-owned via dashboard. Omitting from the
 *     upsert body means INSERT uses schema DEFAULT (false) on first write,
 *     and ON CONFLICT DO UPDATE leaves the column at whatever the recruiter
 *     last set it to. Including it would silently reset recruiter clearance
 *     on every LS retry/update.
 *   - public_description — same recruiter-owned pattern. Omitted so manual
 *     dashboard edits survive subsequent LS events.
 */
export interface ImsJobsRow {
  id: string;
  assignment_number: string;
  status: 'active' | 'archived';
  ls_status: string;
  ls_operation: string;
  organization: string | null;
  organization_id: string | null;
  facility_name: string | null;
  facility_names: string[] | null;
  public_facility_label: string;
  facility_city: string | null;
  facility_state: string | null;
  facility_timezone: string | null;
  facility_mapping_timezone_id: string | null;
  holidays_allowed: string[] | null;
  provider_type: string | null;
  specialty_id: string | null;
  specialty_name: string | null;
  specialty_slug: SpecialtySlug;
  num_providers_requested: number | null;
  start_date: string | null;
  end_date: string | null;
  approximate_decision_date: string | null;
  duration_display: string | null;
  request_type: string | null;
  coverage_type: string | null;
  coverage_reason: string | null;
  call_type: string | null;
  call_response_time_required: string | null;
  call_ratio: string | null;
  practice_setting: string | null;
  description: string | null;
  emr_system: string | null;
  provider_license_requirement: string | null;
  board_certification_required: boolean | null;
  board_certification_minimum: string | null;
  fellowship: string | null;
  require_bls: boolean | null;
  require_acls: boolean | null;
  require_atls: boolean | null;
  require_pals: boolean | null;
  require_abls: boolean | null;
  require_other: boolean | null;
  other_cert_details: string | null;
  trauma_level: number | null;
  peds_level: number | null;
  supervision_required: boolean | null;
  supervise_other_providers: boolean | null;
  patient_encounters_per_shift: string | null;
  temporary_privileges_available: boolean | null;
  require_hospital_privileges: string | null;
  estimated_credentialing_time: string | null;
  nearest_airport: string | null;
  ls_create_date: string | null;
  ls_last_modified: string | null;
  raw_payload: Record<string, unknown>;
  updated_at: string;
}

const REDACTED_KEY_MARKER = '[REDACTED]';

/**
 * Strip the bearer secret from the payload before persisting it as
 * raw_payload. The captured LS payload's `key` field IS the per-subscription
 * Webhook Key the receiver authenticates against — replicating it into every
 * ims_jobs row would expand the secret blast radius to DB dumps, Supabase
 * Studio, future admin views, and forensic exports.
 */
export function redactPayloadForStorage(payload: LSWebhookPayload): Record<string, unknown> {
  return { ...payload, key: REDACTED_KEY_MARKER };
}

/**
 * Map an LS webhook payload into the ims_jobs UPSERT row. Pure function —
 * no I/O, no env access. Receiver-side logic only.
 *
 * Recruiter-owned columns (facility_name_public, public_description) are
 * intentionally omitted — see ImsJobsRow type for the rationale. Their
 * absence from this object means they survive LS retries/updates.
 *
 * raw_payload has the bearer secret stripped via redactPayloadForStorage so
 * the secret isn't replicated across every database row.
 */
export function mapToImsJobsRow(payload: LSWebhookPayload): ImsJobsRow {
  const d = payload.details ?? {};
  const facility0 = d.facilities?.[0];
  const specialty0 = d.specialties?.[0];

  return {
    id: payload.assignmentId,
    assignment_number: payload.assignmentNumber,
    status: deriveStatus(payload.operation),
    ls_status: d.status ?? 'unknown',
    ls_operation: payload.operation,

    organization: d.organization ?? null,
    organization_id: d.organizationId ?? null,
    facility_name: facility0?.facility ?? null,
    facility_names: d.facilities && d.facilities.length > 0
      ? d.facilities.map((f) => f.facility ?? '').filter((s) => s.length > 0)
      : null,
    public_facility_label: derivePublicFacilityLabel(d),
    facility_city: facility0?.facilityCity ?? null,
    facility_state: facility0?.facilityState ?? null,
    facility_timezone: facility0?.facilityTimeZone ?? null,
    facility_mapping_timezone_id: facility0?.facilityMappingTimeZoneId ?? null,
    holidays_allowed: facility0?.holidaysAllowed && facility0.holidaysAllowed.length > 0
      ? facility0.holidaysAllowed
      : null,

    provider_type: d.providerType ?? null,
    specialty_id: specialty0?.specialtyId ?? null,
    specialty_name: specialty0?.specialtyName ?? null,
    specialty_slug: normalizeSpecialtySlug(specialty0?.specialtyName),
    num_providers_requested: typeof d.numProvidersRequested === 'number' ? d.numProvidersRequested : null,

    start_date: d.startDate ?? null,
    end_date: d.endDate ?? null,
    approximate_decision_date: d.approximateDecisionDate ?? null,
    duration_display: deriveDurationDisplay(d.startDate, d.endDate),

    request_type: d.requestType ?? null,
    coverage_type: d.coverageType ?? null,
    coverage_reason: d.coverageReason ?? null,
    call_type: d.callType ?? null,
    call_response_time_required: nullifyDot(d.callResponseTimeRequired),
    call_ratio: nullifyDot(d.callRatio),
    practice_setting: d.practiceSetting ?? null,

    description: d.description ?? null,
    emr_system: d.emrSystem ?? null,

    provider_license_requirement: d.providerLicenseRequirement ?? null,
    board_certification_required: typeof d.boardCertificationRequired === 'boolean' ? d.boardCertificationRequired : null,
    board_certification_minimum: d.boardCertificationMinimum ?? null,
    fellowship: d.fellowship ?? null,
    require_bls: typeof d.requireBls === 'boolean' ? d.requireBls : null,
    require_acls: typeof d.requireAcls === 'boolean' ? d.requireAcls : null,
    require_atls: typeof d.requireAtls === 'boolean' ? d.requireAtls : null,
    require_pals: typeof d.requirePals === 'boolean' ? d.requirePals : null,
    require_abls: typeof d.requireAbls === 'boolean' ? d.requireAbls : null,
    require_other: typeof d.requireOther === 'boolean' ? d.requireOther : null,
    other_cert_details: nullifyDot(d.otherCertDetails),
    trauma_level: typeof d.traumaLevel === 'number' ? d.traumaLevel : null,
    peds_level: typeof d.pedsLevel === 'number' ? d.pedsLevel : null,

    supervision_required: typeof d.supervisionRequired === 'boolean' ? d.supervisionRequired : null,
    supervise_other_providers: typeof d.superviseOtherProviders === 'boolean' ? d.superviseOtherProviders : null,
    patient_encounters_per_shift: nullifyDot(d.patientEncountersPerShift),
    temporary_privileges_available: typeof d.temporaryPrivilegesAvailable === 'boolean' ? d.temporaryPrivilegesAvailable : null,
    require_hospital_privileges: d.requireHospitalPrivileges ?? null,
    estimated_credentialing_time: nullifyDot(d.estimatedCredentialingTime),
    nearest_airport: d.nearestAirport ?? null,

    ls_create_date: d.createDate ?? null,
    ls_last_modified: d.lastModified ?? null,

    raw_payload: redactPayloadForStorage(payload),
    updated_at: new Date().toISOString(),
  };
}

// ---------------- Freshness guard ----------------

export interface FreshnessCheckInput {
  incomingLsLastModified: string | null | undefined;
  incomingStatus: 'active' | 'archived';
  storedLsLastModified: string | null | undefined;
  storedStatus: 'active' | 'archived' | null | undefined;
}

export type FreshnessVerdict =
  | { apply: true }
  | { apply: false; reason: 'stale' | 'tie-archived-wins' };

/**
 * Decide whether to apply an incoming webhook against an existing row. Two
 * skip cases:
 *   1. Strictly older — the incoming event predates the stored event.
 *   2. Same timestamp, stored is archived, incoming is active — terminal
 *      events dominate same-timestamp ties to prevent canceled assignments
 *      from being resurrected by retries.
 *
 * If no stored row exists (storedLsLastModified is null) the receiver
 * proceeds to INSERT regardless. If the incoming has no timestamp, skip the
 * check rather than dropping the event silently.
 */
export function evaluateFreshness(input: FreshnessCheckInput): FreshnessVerdict {
  const { incomingLsLastModified, incomingStatus, storedLsLastModified, storedStatus } = input;

  if (!storedLsLastModified) return { apply: true };
  if (!incomingLsLastModified) return { apply: true };

  const incoming = new Date(incomingLsLastModified).getTime();
  const stored = new Date(storedLsLastModified).getTime();
  if (isNaN(incoming) || isNaN(stored)) return { apply: true };

  if (incoming < stored) return { apply: false, reason: 'stale' };
  if (incoming === stored && storedStatus === 'archived' && incomingStatus === 'active') {
    return { apply: false, reason: 'tie-archived-wins' };
  }
  return { apply: true };
}

// ---------------- Payload validation ----------------

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Lightweight shape check before we hit the DB. Catches missing required
 * fields and obvious type mismatches; does NOT enforce the full LS contract
 * (raw_payload jsonb captures unknown fields for forensic recovery).
 */
export function validatePayloadShape(payload: unknown): ValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'payload must be a JSON object' };
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.assignmentId !== 'string' || p.assignmentId.length === 0) {
    return { ok: false, reason: 'assignmentId required' };
  }
  if (typeof p.assignmentNumber !== 'string' || p.assignmentNumber.length === 0) {
    return { ok: false, reason: 'assignmentNumber required' };
  }
  if (typeof p.operation !== 'string' || p.operation.length === 0) {
    return { ok: false, reason: 'operation required' };
  }
  if (typeof p.key !== 'string' || p.key.length === 0) {
    return { ok: false, reason: 'key required' };
  }
  if (!p.details || typeof p.details !== 'object' || Array.isArray(p.details)) {
    return { ok: false, reason: 'details must be a JSON object' };
  }
  return { ok: true };
}
