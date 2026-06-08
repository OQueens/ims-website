-- IMS — INC-3 lead-sweep attempt tracking on ims_contact_messages — 2026-06-07
-- Adds a bounded-retry counter so the scheduled reconcile (/api/contact-sweep)
-- can re-attempt the primary recruiting notification for captured-but-unsent
-- leads without re-alerting forever on a permanently-undeliverable address.
--
-- Additive + safe: both columns have defaults so existing rows backfill to 0 /
-- NULL. Access model unchanged (RLS on, no public policy; service-role only).
-- The existing partial index idx_ims_contact_resend (resend_status != 'sent')
-- already serves the sweep's primary filter; the attempts predicate is a cheap
-- residual, so no new index is required.

ALTER TABLE public.ims_contact_messages
  ADD COLUMN IF NOT EXISTS resend_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at  timestamptz;

COMMENT ON COLUMN public.ims_contact_messages.resend_attempts IS
  'INC-3: number of delivery attempts (submit + each sweep retry). Sweep stops at MAX_ATTEMPTS (contact-sweep.ts) and fires the safety-net alert on the final try.';
COMMENT ON COLUMN public.ims_contact_messages.last_attempt_at IS
  'INC-3: timestamp of the most recent delivery attempt.';
