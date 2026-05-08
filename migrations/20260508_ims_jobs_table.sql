-- IMS Phase 1.A — ims_jobs table (LocumSmart webhook receiver target) — 2026-05-08
-- Service-role-key only access from Pages Functions; no public RLS policies.
-- Schema fields chosen to cover every input field used by clinician-agent's
-- generateGasworksAd + generateFetchAd (the canonical anesthesia ad shape) plus
-- ops fields needed for upserts and /jobs filtering.

CREATE TABLE ims_jobs (
  -- Identity & lifecycle. id is the LS-provided assignmentId UUID — the
  -- webhook receiver MUST supply it on every insert (no DEFAULT here is
  -- intentional; a missing id should fail fast rather than allocate a local
  -- UUID that LS will never reference again). Different from ims_applications
  -- and ims_contact_messages which have no upstream identity to honor.
  -- assignment_number is the LS human-readable code (e.g. A-DELMC-260508-95739);
  -- it embeds a facility shortcode so it is INTERNAL ONLY — not for URLs.
  id                              uuid PRIMARY KEY,
  assignment_number               text NOT NULL UNIQUE,
  status                          text NOT NULL CHECK (status IN ('active','archived')),
  ls_status                       text NOT NULL,
  ls_operation                    text NOT NULL,

  -- Organization & first-facility. LS sends facilities[]; we flatten
  -- facilities[0] into singular columns for the filter rail AND keep
  -- facility_names as text[] for the multi-facility case so the GasWorks
  -- ad's facilityNames join survives without re-parsing raw_payload.
  --
  -- PUBLIC/INTERNAL boundary: facility_name and facility_names are INTERNAL —
  -- the captured LS payload description explicitly said vendors must NOT
  -- contact the facility, so facility identity is privileged data. The /jobs
  -- public page must render public_facility_label (a derived type label like
  -- "Level 1 Trauma Center" or "Outpatient Surgery Center") instead of the
  -- raw name. facility_name_public is the clearance flag for the rare cases
  -- where LS or the recruiter explicitly OK the actual name for public listing.
  organization                    text,
  organization_id                 uuid,
  facility_name                   text,
  facility_names                  text[],
  public_facility_label           text,
  facility_name_public            boolean NOT NULL DEFAULT false,
  facility_city                   text,
  facility_state                  text,
  facility_timezone               text,
  facility_mapping_timezone_id    text,
  holidays_allowed                text[],

  -- Specialty & provider (LS sends specialties[]; we flatten specialties[0])
  provider_type                   text,
  specialty_id                    uuid,
  specialty_name                  text,
  specialty_slug                  text,
  num_providers_requested         int,

  -- Dates + receiver-computed duration string (the GasWorks ad reads
  -- job.durationDisplay verbatim for the Duration line + 140-char brief; we
  -- compute it once at upsert time so /jobs and the ad generator share wording).
  --
  -- length_category is GENERATED so the /jobs filter rail's
  -- short/medium/long/ongoing buckets are a single source of truth (the SQL
  -- here, not a JS function on the page). Postgres date - date returns int days.
  -- Bucket boundaries: short < 4 weeks, medium 4-12 weeks, long > 12 weeks.
  -- end_date NULL means open-ended assignment so length_category = 'ongoing'.
  -- start_date NULL with end_date set is unusual; we let length_category be NULL
  -- so the page treats it as unbucketed rather than guessing.
  start_date                      date,
  end_date                        date,
  approximate_decision_date       date,
  duration_display                text,
  length_category                 text GENERATED ALWAYS AS (
                                    CASE
                                      WHEN end_date IS NULL THEN 'ongoing'
                                      WHEN start_date IS NULL THEN NULL
                                      WHEN (end_date - start_date) < 28 THEN 'short'
                                      WHEN (end_date - start_date) <= 84 THEN 'medium'
                                      ELSE 'long'
                                    END
                                  ) STORED,

  -- Schedule / coverage
  request_type                    text,
  coverage_type                   text,
  coverage_reason                 text,
  call_type                       text,
  call_response_time_required     text,
  call_ratio                      text,
  practice_setting                text,

  -- Clinical context. PUBLIC/INTERNAL boundary mirrors the facility split:
  -- description holds the raw LS string which empirically embeds facility
  -- name + phone numbers + vendor-must-not-contact disclaimers; the /jobs
  -- public page must render public_description (a receiver-scrubbed version)
  -- instead. If the receiver cannot safely scrub, public_description stays
  -- NULL and the card just omits the case-notes block.
  description                     text,
  public_description              text,
  emr_system                      text,

  -- Requirements
  provider_license_requirement    text,
  board_certification_required    boolean,
  board_certification_minimum     text,
  fellowship                      text,
  require_bls                     boolean,
  require_acls                    boolean,
  require_atls                    boolean,
  require_pals                    boolean,
  require_abls                    boolean,
  require_other                   boolean,
  other_cert_details              text,
  trauma_level                    int,
  peds_level                      int,

  -- Facility staffing & ops
  supervision_required            boolean,
  supervise_other_providers       boolean,
  patient_encounters_per_shift    text,
  temporary_privileges_available  boolean,
  require_hospital_privileges     text,
  estimated_credentialing_time    text,
  nearest_airport                 text,

  -- LS-side timestamps (source of truth for data freshness)
  ls_create_date                  timestamptz,
  ls_last_modified                timestamptz,

  -- Audit + future-proof. jsonb NOT NULL alone admits JSON null/array/scalar;
  -- the typeof check guarantees an object-shaped payload so future field reads
  -- via raw_payload->'foo' don't silently miss on a malformed insert.
  raw_payload                     jsonb NOT NULL CHECK (jsonb_typeof(raw_payload) = 'object'),
  created_at                      timestamptz DEFAULT now(),
  updated_at                      timestamptz DEFAULT now(),

  -- Active-row publicity contract: every row marked status='active' must have
  -- something safe to render in the facility headline slot (either the
  -- recruiter explicitly cleared the actual name, or a derived type label
  -- exists). Archived rows are not rendered publicly so the constraint relaxes.
  CONSTRAINT ims_jobs_active_facility_label_required CHECK (
    status <> 'active'
    OR facility_name_public
    OR public_facility_label IS NOT NULL
  ),

  -- Active-row specialty contract: a specialty bucket is required for the
  -- /jobs filter rail to bin the row. Receiver maps unknown specialties to
  -- 'other' rather than NULL.
  CONSTRAINT ims_jobs_active_specialty_required CHECK (
    status <> 'active' OR specialty_slug IS NOT NULL
  ),

  -- Specialty taxonomy: enforce the canonical 13-value enum from
  -- src/content/config.ts SPECIALTIES so receiver mismaps fail at insert
  -- rather than producing /jobs?specialty= URLs that match nothing.
  CONSTRAINT ims_jobs_specialty_slug_canonical CHECK (
    specialty_slug IS NULL OR specialty_slug IN (
      'anesthesiology','crna','hospitalist','emergency-medicine',
      'family-medicine','psychiatry','ob-gyn','general-surgery',
      'radiology','pediatrics','cardiology','neurology','other'
    )
  ),

  -- Date sanity: end before start indicates a receiver mapping bug or a
  -- malformed LS payload. Failing fast keeps the generated length_category
  -- from silently classifying a negative-duration row as 'short'.
  CONSTRAINT ims_jobs_date_range_valid CHECK (
    start_date IS NULL OR end_date IS NULL OR end_date >= start_date
  )
);

ALTER TABLE ims_jobs ENABLE ROW LEVEL SECURITY;
-- No PUBLIC policies. Service-role-key bypasses RLS; that key lives only in
-- Cloudflare Pages env vars and never reaches client surfaces.

-- assignment_number UNIQUE constraint auto-creates a btree index; no separate
-- index needed for upsert lookups.
CREATE INDEX idx_ims_jobs_status                ON ims_jobs (status);
CREATE INDEX idx_ims_jobs_specialty_slug        ON ims_jobs (specialty_slug) WHERE specialty_slug IS NOT NULL;
CREATE INDEX idx_ims_jobs_facility_state        ON ims_jobs (facility_state);
CREATE INDEX idx_ims_jobs_start_date            ON ims_jobs (start_date);
CREATE INDEX idx_ims_jobs_ls_last_modified      ON ims_jobs (ls_last_modified DESC);
CREATE INDEX idx_ims_jobs_length_category       ON ims_jobs (length_category) WHERE length_category IS NOT NULL;
