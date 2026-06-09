-- IMS Hub — ims_ls_analytics table (LocumSmart Sisense KPI snapshots) — 2026-06-09
-- Stores point-in-time snapshots of the KPI data pulled from LocumSmart's OWN
-- Sisense analytics (fill rate, bid-acceptance, speed-to-bid, market share,
-- timesheet/invoice rejection rates, days-to-payment, $ invoiced, $ by
-- specialty). One row per pull; the hub reads the most recent `snapshot_at`.
--
-- `kpis` is the tidied KPI object produced by mapLsAnalytics() (src/lib/hub/
-- ls-analytics.ts) from the raw JAQL result sets — headline ("1-month") figures
-- plus the trailing monthly series for each measure. These are LocumSmart's own
-- computed numbers, surfaced verbatim (no re-derivation, no fabrication).
--
-- Access: service-role key only (the /hub SSR read + the tap loader). RLS is ON
-- with NO public policy — staff-only, like ls_events / ims_jobs / hub_weekly_sync.

CREATE TABLE ims_ls_analytics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- When the snapshot was pulled from LocumSmart (the tap's capturedAt).
  snapshot_at timestamptz NOT NULL,
  -- Provenance: 'sisense' (the analytics.locumsmart.net JAQL tap).
  source      text NOT NULL DEFAULT 'sisense',
  -- Tidied KPI object (LsKpis shape).
  kpis        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ims_ls_analytics_kpis_is_object CHECK (jsonb_typeof(kpis) = 'object')
);

CREATE INDEX idx_ims_ls_analytics_snapshot ON ims_ls_analytics (snapshot_at DESC);

ALTER TABLE ims_ls_analytics ENABLE ROW LEVEL SECURITY;
-- Defense-in-depth: drop the default anon/authenticated grants so the table can
-- never be read from a client surface even if RLS were later disabled. The
-- service-role key (server-only, Cloudflare Pages env) bypasses RLS regardless.
REVOKE ALL ON ims_ls_analytics FROM anon, authenticated;
-- No PUBLIC policies. Service-role key bypasses RLS; it lives only in Cloudflare
-- Pages env vars and never reaches client surfaces.
