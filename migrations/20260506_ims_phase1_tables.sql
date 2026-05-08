-- IMS Phase 1.A — apply + contact tables (spec §0.5.4) — 2026-05-06
-- Service-role-key only access from Pages Functions; no public RLS policies.

CREATE TABLE ims_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_ref         text,
  job_title       text,
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  npi             text,
  licenses        text[],
  note            text,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz DEFAULT now(),
  status          text DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  resend_status   text DEFAULT 'pending' CHECK (resend_status IN ('pending','sent','failed')),
  resend_error    text
);

CREATE TABLE ims_contact_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent          text NOT NULL CHECK (intent IN ('coverage','general')),
  name            text NOT NULL,
  email           text NOT NULL,
  message         text NOT NULL,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz DEFAULT now(),
  status          text DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  resend_status   text DEFAULT 'pending' CHECK (resend_status IN ('pending','sent','failed')),
  resend_error    text
);

ALTER TABLE ims_applications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ims_contact_messages ENABLE ROW LEVEL SECURITY;
-- No PUBLIC policies. Service-role-key bypasses RLS; that key lives only in
-- Cloudflare Pages env vars and never reaches client surfaces.

CREATE INDEX idx_ims_applications_created_at ON ims_applications (created_at DESC);
CREATE INDEX idx_ims_applications_status     ON ims_applications (status);
CREATE INDEX idx_ims_applications_resend     ON ims_applications (resend_status) WHERE resend_status != 'sent';
CREATE INDEX idx_ims_contact_created_at      ON ims_contact_messages (created_at DESC);
CREATE INDEX idx_ims_contact_resend          ON ims_contact_messages (resend_status) WHERE resend_status != 'sent';
