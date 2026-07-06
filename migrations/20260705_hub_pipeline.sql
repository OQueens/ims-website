-- migrations/20260705_hub_pipeline.sql
-- IMS Hub — Recruitment & Credentialing pipeline — 2026-07-05
-- Row-per-person board. Recruitment = one `stage`; credentialing = 6 independent
-- boolean flags (parallel). Optimistic-concurrency `version` + an atomic op-based
-- apply so concurrent recruiter edits cannot silently overwrite each other. The
-- browser NEVER calls the RPC; only the service-role /hub/api/pipeline endpoint.
-- Mirrors src/lib/hub/pipeline-ops.ts applyOp. Text fields are stored raw here and
-- escaped on READ by readPerson (pipeline-data.ts), matching the hub's
-- sanitize-on-read posture — the RPC contains no sanitizer.
-- GRACEFUL DEGRADATION (approximates the oracle's coerceField/cleanDate): the typed
-- columns target_start_date (date), assignment_id (uuid) and the row id (uuid) are
-- coerced inside BEGIN/EXCEPTION blocks so a malformed/hostile value degrades to
-- NULL (or a no-op for a bad/absent id) instead of throwing a hard cast error that
-- would abort the whole op. A non-board/unknown stage falls back to 'warm_lead'.
-- Two DOCUMENTED residual divergences from the TS oracle, both graceful (never a
-- throw) and both unreachable via the legitimate UI but reachable via an arbitrary
-- hostile POST (validateOp does not format-check these values):
--   1. assignment_id stores only a well-formed uuid; the oracle keeps any <=64-char
--      string (the column is uuid). The real client always sends a uuid.
--   2. target_start_date is STRICTER than cleanDate for impossible/extreme calendar
--      dates (e.g. 2026-02-30: JS Date.parse rolls it over and the oracle keeps the
--      string, but Postgres ::date rejects it -> NULL). Exact JS-Date/PG-date parity
--      is unachievable (rollover, year 0, BC differ); the <input type=date> UI can
--      only emit real dates, so both sides agree on every value the UI produces.
-- NOTE: coalesce/case/nullif/in are SQL keyword constructs — write them BARE; real
-- functions stay pg_catalog-qualified for search_path='' safety.

CREATE TABLE IF NOT EXISTS public.hub_pipeline_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage         text NOT NULL DEFAULT 'warm_lead' CHECK (stage IN (
                  'warm_lead','active_bid','accepted_bid','needs_onboarding','placed','archived')),
  full_name         text NOT NULL,
  specialty_slug    text,
  specialty_name    text,
  state             text,
  phone             text,
  email             text,
  owner_email       text,
  target_start_date date,
  assignment_id     uuid,
  assignment_number text,
  assignment_label  text,
  chk_collecting_docs        boolean NOT NULL DEFAULT false,
  chk_needs_contract         boolean NOT NULL DEFAULT false,
  chk_start_dates_booked     boolean NOT NULL DEFAULT false,
  chk_credentialing_started  boolean NOT NULL DEFAULT false,
  chk_credentialing_complete boolean NOT NULL DEFAULT false,
  chk_provider_working       boolean NOT NULL DEFAULT false,
  checklist_audit   jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes             text,
  version     int NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_pipeline_stage_idx   ON public.hub_pipeline_people (stage) WHERE stage <> 'archived';
CREATE INDEX IF NOT EXISTS hub_pipeline_updated_idx ON public.hub_pipeline_people (updated_at DESC);

ALTER TABLE public.hub_pipeline_people ENABLE ROW LEVEL SECURITY;  -- no public policy: service-role only

-- Apply ONE op atomically. createPerson INSERTs (client-provided id); every other
-- op locks the row by id, mutates, bumps version. Returns the resulting row.
CREATE OR REPLACE FUNCTION public.hub_pipeline_apply(p_op jsonb, p_email text)
RETURNS SETOF public.hub_pipeline_people
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_type text := p_op->>'type';
  v_id   uuid;
  v_lock bigint;
  v_now  timestamptz := pg_catalog.now();
  v_at   bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
  v_item text;
  v_val  boolean;
  v_field text;
  v_value text;
  v_stage text;
  v_cid   uuid;
  v_date  date;
  v_uuid  uuid;
BEGIN
  IF p_email IS NULL THEN RAISE EXCEPTION 'missing-email'; END IF;

  IF v_type = 'createPerson' THEN
    -- A non-uuid client id is a no-op (never a hard error). The real client always
    -- sends crypto.randomUUID(); this only guards malformed/hostile input.
    BEGIN
      v_cid := (p_op->'input'->>'id')::uuid;
    EXCEPTION WHEN others THEN
      RETURN;
    END;
    -- A NULL/absent id casts to NULL WITHOUT raising, so the block above won't catch
    -- it; guard explicitly or the NOT NULL PK insert below would 502 (validateOp's
    -- isId rejects this upstream, but the RPC defends itself like every other field).
    IF v_cid IS NULL THEN RETURN; END IF;
    -- Mirror applyOp: an out-of-set stage falls back to 'warm_lead' (never aborts on
    -- the CHECK constraint). The same coerced stage drives the working⟺placed invariant.
    v_stage := CASE WHEN (p_op->'input'->>'stage') IN
                 ('warm_lead','active_bid','accepted_bid','needs_onboarding','placed','archived')
               THEN p_op->'input'->>'stage' ELSE 'warm_lead' END;
    -- Degrade a malformed target_start_date to NULL (approximate cleanDate: first 10
    -- chars, YYYY-MM-DD; stricter on impossible dates — see header) not a ::date throw.
    BEGIN
      v_date := CASE WHEN pg_catalog.substr(pg_catalog.btrim(coalesce(p_op->'input'->>'target_start_date','')),1,10) ~ '^\d{4}-\d{2}-\d{2}$'
                     THEN pg_catalog.substr(pg_catalog.btrim(p_op->'input'->>'target_start_date'),1,10)::date ELSE NULL END;
    EXCEPTION WHEN others THEN
      v_date := NULL;
    END;
    INSERT INTO public.hub_pipeline_people (
      id, stage, full_name, specialty_slug, specialty_name, state, phone, email,
      owner_email, target_start_date, notes, chk_provider_working, created_by, updated_by)
    VALUES (
      v_cid,
      v_stage,
      p_op->'input'->>'full_name',
      p_op->'input'->>'specialty_slug', p_op->'input'->>'specialty_name', p_op->'input'->>'state',
      p_op->'input'->>'phone', p_op->'input'->>'email', p_op->'input'->>'owner_email',
      v_date,
      p_op->'input'->>'notes',
      (v_stage = 'placed'),  -- invariant: working ⟺ placed
      p_email, p_email)
    ON CONFLICT (id) DO NOTHING;
    RETURN QUERY SELECT * FROM public.hub_pipeline_people WHERE id = v_cid;
    RETURN;
  END IF;

  -- A non-uuid id matches no row: graceful no-op, never a hard cast error.
  BEGIN
    v_id := (p_op->>'id')::uuid;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  v_lock := pg_catalog.hashtextextended(v_id::text, 0);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock);

  IF v_type = 'moveStage' THEN
    UPDATE public.hub_pipeline_people SET
      stage = p_op->>'stage',
      chk_provider_working = CASE WHEN p_op->>'stage' = 'placed' THEN true
                                  WHEN p_op->>'stage' <> 'placed' THEN false
                                  ELSE chk_provider_working END,
      version = version + 1, updated_by = p_email, updated_at = v_now
    WHERE id = v_id;

  ELSIF v_type = 'toggleChecklist' THEN
    v_item := p_op->>'item';
    v_val  := (p_op->>'value')::boolean;
    UPDATE public.hub_pipeline_people SET
      chk_collecting_docs        = CASE WHEN v_item='collecting_docs'        THEN v_val ELSE chk_collecting_docs END,
      chk_needs_contract         = CASE WHEN v_item='needs_contract'         THEN v_val ELSE chk_needs_contract END,
      chk_start_dates_booked     = CASE WHEN v_item='start_dates_booked'     THEN v_val ELSE chk_start_dates_booked END,
      chk_credentialing_started  = CASE WHEN v_item='credentialing_started'  THEN v_val ELSE chk_credentialing_started END,
      chk_credentialing_complete = CASE WHEN v_item='credentialing_complete' THEN v_val ELSE chk_credentialing_complete END,
      chk_provider_working       = CASE WHEN v_item='provider_working'       THEN v_val ELSE chk_provider_working END,
      stage = CASE WHEN v_item='provider_working' AND v_val THEN 'placed'
                   WHEN v_item='provider_working' AND NOT v_val AND stage='placed' THEN 'needs_onboarding'
                   ELSE stage END,
      checklist_audit = checklist_audit || pg_catalog.jsonb_build_object('chk_'||v_item, pg_catalog.jsonb_build_object('by', p_email, 'at', v_at)),
      version = version + 1, updated_by = p_email, updated_at = v_now
    WHERE id = v_id;

  ELSIF v_type = 'updateField' THEN
    v_field := p_op->>'field';
    v_value := p_op->>'value';  -- null when JSON value is null
    -- Coerce the two typed columns toward the TS oracle — degrade a malformed value
    -- to NULL, NEVER throw (a bare ::date/::uuid cast would abort the whole op). Only
    -- the branch matching v_field consumes these. Residuals documented in the header.
    BEGIN
      v_date := CASE WHEN pg_catalog.substr(pg_catalog.btrim(coalesce(v_value,'')),1,10) ~ '^\d{4}-\d{2}-\d{2}$'
                     THEN pg_catalog.substr(pg_catalog.btrim(v_value),1,10)::date ELSE NULL END;
    EXCEPTION WHEN others THEN
      v_date := NULL;
    END;
    BEGIN
      v_uuid := nullif(pg_catalog.btrim(coalesce(v_value,'')),'')::uuid;
    EXCEPTION WHEN others THEN
      v_uuid := NULL;
    END;
    UPDATE public.hub_pipeline_people SET
      full_name         = CASE WHEN v_field='full_name'         THEN coalesce(nullif(pg_catalog.btrim(v_value),''), full_name) ELSE full_name END,
      specialty_slug    = CASE WHEN v_field='specialty_slug'    THEN v_value ELSE specialty_slug END,
      specialty_name    = CASE WHEN v_field='specialty_name'    THEN v_value ELSE specialty_name END,
      state             = CASE WHEN v_field='state'             THEN v_value ELSE state END,
      phone             = CASE WHEN v_field='phone'             THEN v_value ELSE phone END,
      email             = CASE WHEN v_field='email'             THEN v_value ELSE email END,
      owner_email       = CASE WHEN v_field='owner_email'       THEN v_value ELSE owner_email END,
      target_start_date = CASE WHEN v_field='target_start_date' THEN v_date ELSE target_start_date END,
      notes             = CASE WHEN v_field='notes'             THEN v_value ELSE notes END,
      assignment_id     = CASE WHEN v_field='assignment_id'     THEN v_uuid ELSE assignment_id END,
      assignment_number = CASE WHEN v_field='assignment_number' THEN v_value ELSE assignment_number END,
      assignment_label  = CASE WHEN v_field='assignment_label'  THEN v_value ELSE assignment_label END,
      version = version + 1, updated_by = p_email, updated_at = v_now
    WHERE id = v_id;

  ELSIF v_type = 'archivePerson' THEN
    UPDATE public.hub_pipeline_people SET stage='archived', chk_provider_working=false, version=version+1, updated_by=p_email, updated_at=v_now WHERE id = v_id;

  ELSIF v_type = 'restorePerson' THEN
    UPDATE public.hub_pipeline_people SET
      stage = CASE WHEN p_op->>'stage' IN ('warm_lead','active_bid','accepted_bid','needs_onboarding','placed') THEN p_op->>'stage' ELSE 'needs_onboarding' END,
      chk_provider_working = (CASE WHEN p_op->>'stage' IN ('warm_lead','active_bid','accepted_bid','needs_onboarding','placed') THEN p_op->>'stage' ELSE 'needs_onboarding' END = 'placed'),  -- invariant
      version=version+1, updated_by=p_email, updated_at=v_now
    WHERE id = v_id;

  ELSE
    RAISE EXCEPTION 'unknown-op-type: %', v_type;
  END IF;

  RETURN QUERY SELECT * FROM public.hub_pipeline_people WHERE id = v_id;
END;
$$;

-- Seal: only service_role executes (browser/anon/authenticated never reach the DB).
REVOKE EXECUTE ON FUNCTION public.hub_pipeline_apply(jsonb, text) FROM PUBLIC, anon, authenticated;
