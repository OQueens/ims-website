-- IMS Phase 1.A — reconcile ims_contact_messages with the redesigned
-- Get-in-touch form (spec §7) — 2026-06-01
--
-- The 2026-05-06 table (migrations/20260506_ims_phase1_tables.sql) modeled an
-- `intent`-based contact form (coverage|general, message NOT NULL). The
-- redesigned form instead sends:
--   name, email, audience('facility'|'clinician'|'other'), role (optional),
--   message (optional). It does NOT send `intent`.
--
-- Pre-apply verification (live prod, project gbakzhibzotugfyktcrt, 2026-06-01):
--   - ims_contact_messages had 0 rows (no data to migrate or lose)
--   - zero views/rules depended on the `intent` column
-- so dropping `intent` and relaxing `message` is safe.
--
-- APPLIED to production via Supabase MCP apply_migration on 2026-06-01 under the
-- migration name `reconcile_ims_contact_messages_for_redesigned_form`. This file
-- is the source-of-truth mirror kept alongside the original migration.
--
-- Access model is unchanged: RLS stays enabled with NO public policies. The
-- Cloudflare Pages function inserts using the service_role key, which bypasses
-- RLS; anon/authenticated have no access (deny-all). The Supabase advisor's
-- INFO "RLS enabled, no policy" notice is the intended posture for this
-- service-role-only table (same as ims_jobs / ims_applications).

ALTER TABLE public.ims_contact_messages
  ADD COLUMN audience text NOT NULL CHECK (audience IN ('facility', 'clinician', 'other')),
  ADD COLUMN role text,
  ALTER COLUMN message DROP NOT NULL,
  DROP COLUMN intent;

COMMENT ON COLUMN public.ims_contact_messages.audience IS 'Who the sender is, from the Get-in-touch form radio. Enforced both here and in src/lib/contact-submission.ts.';
COMMENT ON COLUMN public.ims_contact_messages.role IS 'Optional free-text role or specialty (capped 160 chars in app).';
