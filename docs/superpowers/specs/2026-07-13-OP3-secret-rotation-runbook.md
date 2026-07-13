# OP-3 — rotate + vault the two write secrets (runbook, console steps are Zach's)

**Date:** 2026-07-13 · **Status:** BLOCKED on console access — sequenced runbook below.
**Why now:** both credentials are long-lived write keys; the Supabase service-role key sits in
plaintext `.env`s on EC2, and the firebase-admin SA can write the quote-path RTDB.

**Tooling verified 2026-07-13:** EC2 has `aws` CLI under instance role
`ias-clinician-agent-ec2` (Secrets Manager reachable → vaulting automatable). **No gcloud, no
supabase CLI on the box; Supabase MCP unauthenticated in this session** → both rotations need
your console (or a Management-API/gcloud auth you'd have to grant first).

## A. SUPABASE_SERVICE_ROLE_KEY (project `gbakzhibzotugfyktcrt`)

1. **Inventory consumers BEFORE rotating** (10 min, do not skip — this is what breaks):
   run on EC2: `grep -rl "SERVICE_ROLE" /home/ubuntu/*/.env` (expected: ias-dashboard, possibly
   ims-ls-tap) + AWS Secrets Manager entries the ias-agents fleet reads + **Cloudflare Pages
   env vars** for `ims-website` (forms capture + locumsmart webhook write to Supabase) — check
   both Production and Preview scopes.
2. **Prefer the new API-keys system if offered** (Dashboard → Settings → API): create a new
   `sb_secret_…` key, migrate consumers, then disable the legacy JWT-based service_role key.
   This avoids the legacy pitfall where rotating the **JWT secret** invalidates service_role
   AND anon keys at once (which would also break any anon-key browser reads).
3. Flip order: vault new key in AWS Secrets Manager → update EC2 `.env`s → update CF Pages env
   + redeploy → verify each consumer (form submit → row lands; webhook POST → row lands;
   fleet: one `reserve_budget` round-trip) → revoke old key.
4. **Rollback:** the old key stays valid until the explicit revoke in step 3 — do the revoke
   LAST, after all verifies pass.

## B. firebase-admin service account (project `weekly-sync-451e2`)

1. Consumers: the bridge (`ias-dashboard/scripts/data-refresh/*`, EC2) is the only known
   writer; confirm with `grep -rl "GOOGLE_APPLICATION_CREDENTIALS\|serviceAccount" /home/ubuntu/ias-dashboard` (don't cat the JSON).
2. GCP Console → IAM → Service Accounts → the admin SA → **Keys: ADD new key** (download
   straight to the EC2 path, never through chat) → swap the file path/env on EC2 → run one
   read-only bridge health command → **delete the OLD key id**.
3. Optional hardening while you're there: check whether the SA's role can be narrowed to RTDB
   write on the two nodes the bridge touches (it's often project-editor — too broad).
4. **Rollback:** same as A — old key valid until deleted; delete last.

## C. Vault (I can do this part once you hand me the go + the new values exist on-box)

- Store both under AWS Secrets Manager (fleet-standard), reference from `.env` loaders instead
  of inline values, and shred the plaintext copies (`shred -u`). I can script + verify this
  end-to-end from the session; it needs no consoles.

**Order:** A then B (A has more consumers). Each with its own verify; nothing revoked until
its replacement is proven in every consumer.
