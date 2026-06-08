-- IMS Hub — hub_weekly_sync table (shared Weekly Sync board) — 2026-06-07
-- Backs the hub's Weekly Sync view. One row per (week, team column); `items` is
-- the ordered list of focus strings for that column that week. Replaces the
-- previous per-browser localStorage-only persistence so the whole team sees the
-- same board.
--
-- Access: service-role key only, from Pages Functions (the /hub/api/sync write
-- endpoint, behind the hub Google-OAuth guard) and the /hub SSR read. RLS is ON
-- with NO public policy, so the anon/public key can neither read nor write —
-- the board is staff-only, like ls_events and ims_jobs.

CREATE TABLE hub_weekly_sync (
  -- ISO 8601 week key, e.g. '2026-W24' (sync-data.ts getWeekKey).
  week_key    text NOT NULL,
  -- Team column: 'recruiting' | 'marketing' | 'operations'.
  column_key  text NOT NULL,
  -- Ordered focus items for this column/week (array of strings).
  items       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- The @iastaffing.com email from the writer's hub session (audit; last writer
  -- wins on this small internal board).
  updated_by  text,

  PRIMARY KEY (week_key, column_key),

  CONSTRAINT hub_weekly_sync_items_is_array CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT hub_weekly_sync_column_key_valid CHECK (
    column_key IN ('recruiting', 'marketing', 'operations')
  )
);

ALTER TABLE hub_weekly_sync ENABLE ROW LEVEL SECURITY;
-- No PUBLIC policies. Service-role key bypasses RLS; that key lives only in
-- Cloudflare Pages env vars and never reaches client surfaces.
