-- IMS — ls_events table (unified LocumSmart events log) — 2026-06-02
-- Design: docs/superpowers/specs/2026-06-02-locumsmart-unified-webhook-design.md
--
-- Append-only event log. One LocumSmart webhook subscription POSTs to
-- /api/locumsmart-events; the handler appends every delivery here (the source
-- of truth for Hub analytics) and, when the payload is assignment-shaped, also
-- upserts ims_jobs (the public job board). Current state is PROJECTED from this
-- log: if a Hub metric is ever wrong, recompute it from ls_events.
--
-- Access: service-role key only from Pages Functions; NO public RLS policy.
-- raw_payload holds internal facility names/contacts, so this table must never
-- be publicly readable (unlike ims_jobs, which exposes only public-safe label
-- columns to /jobs). The bearer Webhook Key is redacted out of raw_payload by
-- redactPayloadForStorage before insert.

CREATE TABLE ls_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Idempotency. LS assignment payloads carry no explicit event id, so the
  -- receiver synthesizes one (deriveDedupeKey): assignmentId:operation:ts.
  -- The same logical event (an LS retry or a backfill replay) yields the same
  -- key, so ON CONFLICT (dedupe_key) DO NOTHING makes the append idempotent and
  -- placements/fills are never double-counted in analytics. If a future sample
  -- payload reveals a true LS event id, switch dedupe_key to it.
  dedupe_key               text NOT NULL UNIQUE,

  event_type               text NOT NULL,          -- LS `operation` (Receive/Update/Cancel/...)
  assignment_id            uuid,                    -- null for non-assignment events
  assignment_number        text,

  -- occurred_at = LS lastModified ?? createDate ?? received_at (logical event
  -- time, used for time-series aggregation). received_at = our ingest time.
  occurred_at              timestamptz,
  received_at              timestamptz NOT NULL DEFAULT now(),

  -- Denormalized analytics dimensions (best-effort, null-safe extraction).
  -- These are a convenience projection over raw_payload; they can be backfilled
  -- from the log without re-ingestion if extraction logic changes.
  status_after             text,                    -- 'active' | 'archived' (deriveStatus)
  ls_status                text,
  specialty_slug           text,
  specialty_name           text,
  provider_type            text,
  facility_state           text,
  facility_city            text,
  organization             text,
  -- organization_id is TEXT (not uuid) on purpose: this is the append-only
  -- source of truth, and a non-UUID value from LS must NOT throw a cast error
  -- that drops the whole event (and its lossless raw_payload). assignment_id
  -- stays uuid because it is LS's reliable assignment primary key.
  organization_id          text,
  num_providers_requested  integer,
  recruiter                text,                    -- populated IF the payload attributes one (TBC on first sample)

  -- Lossless capture (bearer key redacted). Anything we do not yet project into
  -- a typed column survives here for later extraction.
  raw_payload              jsonb NOT NULL
);

CREATE INDEX ls_events_occurred_at_idx   ON ls_events (occurred_at DESC);
CREATE INDEX ls_events_event_type_idx    ON ls_events (event_type);
CREATE INDEX ls_events_assignment_id_idx ON ls_events (assignment_id);
CREATE INDEX ls_events_specialty_idx     ON ls_events (specialty_slug);
CREATE INDEX ls_events_state_idx         ON ls_events (facility_state);

-- Service-role only: enable RLS with NO policy, so the anon/public key cannot
-- read or write. Pages Functions use the service-role key, which bypasses RLS.
ALTER TABLE ls_events ENABLE ROW LEVEL SECURITY;
