-- IMS Hub — Weekly Sync v3 write engine — 2026-06-15
-- Adds optimistic-concurrency `version` + an atomic, op-based apply function so
-- concurrent edits in the same column cannot silently overwrite each other.
-- The browser NEVER calls this; only the service-role /hub/api/sync endpoint does.
-- Mirrors src/lib/hub/sync-ops.ts applyOp (A1: 6 ops). HTML/title are stored
-- raw here and normalized+escaped+sanitized on READ by readColumn (sync-data.ts),
-- matching the existing sanitize-on-read posture — the RPC contains NO sanitizer.

ALTER TABLE public.hub_weekly_sync
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 0;

-- Helper FIRST (no forward reference): apply a section-targeted op to ONE section,
-- returning the new section jsonb. Caps focuses at 50 (mirrors MAX_FOCUSES).
CREATE OR REPLACE FUNCTION public.hub_sync_apply_section(
  s jsonb, p_op jsonb, p_email text, p_now bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_type   text := p_op->>'type';
  v_foc_id text;
  v_html   text;
  v_focs   jsonb;
  v_exists boolean;
BEGIN
  IF v_type = 'setSectionTitle' THEN
    RETURN pg_catalog.jsonb_set(s, '{title}', pg_catalog.to_jsonb(pg_catalog.left(pg_catalog.coalesce(p_op->>'title',''), 80)));

  ELSIF v_type = 'deleteFocus' THEN
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(f ORDER BY ord), '[]'::jsonb) INTO v_focs
      FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord)
      WHERE f->>'id' <> (p_op->>'focusId');
    RETURN pg_catalog.jsonb_set(s, '{focuses}', v_focs);

  ELSIF v_type = 'upsertFocus' THEN
    v_foc_id := p_op->'focus'->>'id';
    v_html   := p_op->'focus'->>'html';
    v_exists := EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(s->'focuses') f WHERE f->>'id' = v_foc_id);
    IF v_exists THEN
      -- update in place ONLY when html differs (idempotent-on-no-change → retry-safe)
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(
        CASE WHEN f->>'id' = v_foc_id AND f->>'html' IS DISTINCT FROM v_html
             THEN f || pg_catalog.jsonb_build_object('html', v_html, 'editedBy', p_email, 'editedAt', p_now)
             ELSE f END
        ORDER BY ord), '[]'::jsonb) INTO v_focs
        FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord);
    ELSE
      -- append only if under the 50-focus cap (mirrors MAX_FOCUSES)
      IF pg_catalog.jsonb_array_length(s->'focuses') < 50 THEN
        SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(f ORDER BY ord), '[]'::jsonb) INTO v_focs
          FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord);
        v_focs := v_focs || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id', v_foc_id, 'html', v_html, 'by', p_email, 'createdAt', p_now));
      ELSE
        v_focs := s->'focuses';
      END IF;
    END IF;
    RETURN pg_catalog.jsonb_set(s, '{focuses}', v_focs);
  END IF;

  RETURN s;
END;
$$;

-- Main: lock (week,col), read (creating a blank row if absent), apply ONE op,
-- bump version ONLY if items changed, return (r_items, r_version). OUT columns
-- are r_* to avoid shadowing the table's items/version inside the body.
CREATE OR REPLACE FUNCTION public.hub_sync_apply(
  p_week  text,
  p_col   text,
  p_op    jsonb,
  p_email text
) RETURNS TABLE(r_items jsonb, r_version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lock_key bigint;
  v_items    jsonb;
  v_new      jsonb;
  v_ver      int;
  v_type     text := p_op->>'type';
  v_sec_id   text := p_op->>'sectionId';
  v_now      bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
BEGIN
  IF p_col IS NULL OR p_col NOT IN ('recruiting','marketing','operations') THEN
    RAISE EXCEPTION 'bad-column: %', p_col;
  END IF;
  IF p_week IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'missing-week-or-email';
  END IF;

  v_lock_key := pg_catalog.hashtextextended(p_week || ':' || p_col, 0);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

  INSERT INTO public.hub_weekly_sync (week_key, column_key, items)
    VALUES (p_week, p_col, '[]'::jsonb)
    ON CONFLICT (week_key, column_key) DO NOTHING;

  SELECT hws.items, hws.version INTO v_items, v_ver
    FROM public.hub_weekly_sync hws
    WHERE hws.week_key = p_week AND hws.column_key = p_col
    FOR UPDATE;

  IF v_type = 'clearColumn' THEN
    v_new := '[]'::jsonb;

  ELSIF v_type = 'addSection' THEN
    IF pg_catalog.jsonb_array_length(v_items) < 16
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_items) s WHERE s->>'id' = p_op->'section'->>'id') THEN
      v_new := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', p_op->'section'->>'id',
        'title', pg_catalog.left(pg_catalog.coalesce(p_op->'section'->>'title',''), 80),
        'by', p_email,
        'focuses', '[]'::jsonb));
    ELSE
      v_new := v_items;
    END IF;

  ELSIF v_type = 'deleteSection' THEN
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(s ORDER BY ord), '[]'::jsonb) INTO v_new
      FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(s, ord)
      WHERE s->>'id' <> (p_op->>'sectionId');

  ELSE
    -- section-targeted ops (upsertFocus / deleteFocus / setSectionTitle)
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(
      CASE WHEN s->>'id' = v_sec_id THEN public.hub_sync_apply_section(s, p_op, p_email, v_now) ELSE s END
      ORDER BY ord), '[]'::jsonb) INTO v_new
      FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(s, ord);
  END IF;

  IF v_new IS DISTINCT FROM v_items THEN
    UPDATE public.hub_weekly_sync hws
      SET items = v_new, version = hws.version + 1, updated_by = p_email, updated_at = pg_catalog.now()
      WHERE hws.week_key = p_week AND hws.column_key = p_col;
    RETURN QUERY SELECT v_new, v_ver + 1;
  ELSE
    RETURN QUERY SELECT v_items, v_ver;   -- genuine no-op: don't bump version / churn the row
  END IF;
END;
$$;

-- Seal: only service_role executes (browser/anon/authenticated never reach the DB).
REVOKE EXECUTE ON FUNCTION public.hub_sync_apply(text, text, jsonb, text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hub_sync_apply_section(jsonb, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
