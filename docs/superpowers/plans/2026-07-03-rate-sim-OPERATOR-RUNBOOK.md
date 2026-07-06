# Rate Simulator — Operator Runbook (Zach-only steps)

> These are the steps the autonomous sessions CANNOT do (they need production credentials, a prod DB
> migration, a Firebase rules deploy, or an explicit deploy-go). Each is written turnkey: exact file,
> exact command, what it does, how to verify, how to roll back. Nothing here fabricates a value; every
> SQL/rule shown was read from disk on 2026-07-03. Do these in the order the program needs them
> (see the table at the bottom).
>
> Standing rule: a push to `origin/main` auto-deploys prod (Cloudflare Pages, ~45s). SHOW-BEFORE-DEPLOY
> and wait for an explicit deploy-go. "Do whatever is best" is NOT deploy authorization.

---

## OP-1 — Apply migration `20260701000000` to prod Supabase (unblocks aggregator sources + PLAN 3)

- **File (verified):** `ias-dashboard/supabase/migrations/20260701000000_add_aggregator_estimate_rate_type.sql`
- **What it does:** adds the 7th `rate_type` value `aggregator_estimate` to the `rate_intelligence`
  write-side CHECK constraint. Without it, an `aggregator_estimate` INSERT raises Postgres error
  `23514` (check_violation), and because the scraper writes the whole run as ONE batch statement, a
  single rejected row aborts the entire run's write (silent total data loss). It is the write-side
  companion to deferred read-side telemetry columns (which are intentionally NOT added yet).
- **Idempotent:** yes — it `DROP CONSTRAINT IF EXISTS` then re-adds with all 7 values, so re-running
  is safe. Exact statement:
  ```sql
  ALTER TABLE public.rate_intelligence DROP CONSTRAINT IF EXISTS rate_intelligence_rate_type_chk;
  ALTER TABLE public.rate_intelligence ADD CONSTRAINT rate_intelligence_rate_type_chk
    CHECK (rate_type IS NULL OR rate_type IN (
      'actual_paid_locum','advertised_clinician_pay','agency_bill_rate','permanent_wage_proxy',
      'scraped_article_estimate','crowd_survey','aggregator_estimate'));
  ```
- **How to apply (pick one, your creds):** Supabase dashboard SQL editor (prod project
  `gbakzhibzotugfyktcrt`) paste-and-run; OR `supabase db push` from the `ias-dashboard` repo if the CLI
  is linked to prod; OR the Supabase MCP `apply_migration` once it is authenticated in an interactive
  session.
- **Verify:** run
  ```sql
  SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'rate_intelligence_rate_type_chk';
  ```
  Confirm the returned definition includes `aggregator_estimate`.
- **Rollback:** re-add the constraint WITHOUT `aggregator_estimate` (the original 6 values). Note this
  re-arms the 23514 batch-abort, so only roll back if the aggregator source is being pulled entirely.
- **Do NOT** flip `locumjobsonline` / TrackFive to `verified=True` in the fleet before this is applied.

## OP-2 — Deploy the feedback-node RTDB rules lock (after PLAN 1C stages the file edit)

- **File the session edits (local):** `ias-dashboard/database.rules.json` — the `rate-simulator/feedback`
  node (lines 26-34) goes from `.write:true` (world-writable) to authenticated/validated.
- **Project (verified):** `weekly-sync-451e2` (both `ias-dashboard/.firebaserc` and
  `weekly-sync/.firebaserc` default to it).
- **HAZARD (verified, important):** TWO repos deploy database rules to the SAME project —
  `ias-dashboard/database.rules.json` (authoritative: has the live `market-rates-v2` + `cap-rates`
  tree) and the STALE `weekly-sync/database.rules.json` (its `rate-simulator` block is out of date and
  has `market-rates` as `.write:true`). Whichever repo runs `firebase deploy --only database` LAST
  wins. Deploy the rules from `ias-dashboard` ONLY, and reconcile/retire the weekly-sync copy so a
  future weekly-sync deploy cannot silently re-open the feedback node.
- **Command:** from the `ias-dashboard` repo, authenticated as the project owner:
  `firebase deploy --only database`
- **Verify:** attempt an UNAUTHENTICATED write to `rate-simulator/feedback` (should now be denied) and
  confirm `rate-simulator/market-rates-v2` is still readable and still `.write:false`.
- **Rollback:** `git revert` the rules edit and re-deploy.

## OP-3 — Rotate + vault the two write credentials (anti-manipulation `13 R1`)

- **Why:** the deep-dive verified that quote integrity reduces to two secrets — the bridge's
  firebase-admin service-account key (writes RTDB `market-rates-v2`) and the scraper's
  `SUPABASE_SERVICE_ROLE_KEY` (bypasses Postgres RLS on `rate_intelligence`). Anyone holding either can
  move the live quote. They were referenced in earlier chats, so treat as exposed.
- **How:** generate a NEW firebase-admin service-account key (Firebase console → project settings →
  service accounts) and a NEW Supabase service-role key (Supabase dashboard → API), update the
  bridge/scraper secret stores (EC2 env / firebase-admin creds), then REVOKE the old ones. Least-privilege
  where possible.
- **Verify:** a bridge run and a scraper run both succeed with the new creds; the old keys are rejected.

## OP-4 — Prod deploy (final gate, only after show-before + explicit deploy-go)

- Prod deploys from `origin/main` in the `ias-website` repo (push = Cloudflare Pages auto-deploy).
  All PLAN 1-4 code lands on `redesign/v5-reskin` first and is shown to you. Nothing ships to prod
  until you review the diff and say go.
- **Rollback:** `git revert <sha> && git push origin main` in `ias-website`.

---

## Which operator step unblocks what

| Op | Unblocks | Do it before |
|---|---|---|
| OP-1 migration | aggregator sources; PLAN 3 mapping-layer live data | starting PLAN 3 code / any fleet run |
| OP-2 rules deploy | the anti-manipulation feedback lock is actually live; PLAN 4 calibration loop | wiring PLAN 4 calibration |
| OP-3 credential rotation | closes the two-secret quote-integrity exposure | any external rate-data exposure |
| OP-4 prod deploy | ships PLAN 1+ to real recruiters | after show-before + explicit go, per plan |
