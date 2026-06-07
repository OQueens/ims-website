# IMS Hub — Data-Port Spec (2026-06-06)

Source: `hub-data-port-recon` workflow (`wf_0cce0c0b-2a9`, 7 agents) mapping `C:\Users\oclou\QueenClaude\ias-dashboard`
(the IAS hub: React+Vite SPA on Firebase Hosting) against the IMS hub components on the `hub-port` branch.
**Design is FINAL — this is a pure DATA rewire.** Honor CLAUDE.md "no fake data": render `—` over any fabricated number.

## THE governing fact
The IAS dashboard computes its rich metrics from **Firebase RTDB `locumsmart/jobs`** — 83-field LocumSmart Partner-API
records with `daysPosted`, bid fields, and multi-status (Open/Filled/Awarded/Closed). The IMS hub reads **Supabase
`ims_jobs`** — status collapsed to `active|archived`, NO rate / daysPosted / bid fields. **So IAS formulas cannot port
verbatim — half their inputs do not exist in our DB.** We compute what we honestly can from `ims_jobs` + the append-only
`ls_events` log, label proxies clearly, and `—` everything else. (`ims_jobs` = currently-active only → any trend or
terminal/closed metric MUST come from `ls_events.occurred_at`.)

## Build order (steps that need NO Zach decision — build now)
1. **[trivial] Shared seam** — extract the inline Supabase service-role client from `/hub/index.astro` into
   `src/lib/hub/hub-supabase.ts` `getHubSupabase(env)` (uses existing SUPABASE_URL + SERVICE_ROLE_KEY). +unit test. Every later read reuses it (server-side only; ls_events + new tables are RLS-on, no public policy).
2. **[small] De-fake Overview KPIs (HONESTY)** — `OverviewView.astro` lines ~36-53 hardcode `18 days / $268 / 94%`.
   Make them props (`fillTimeDays|null, billRate|null, fillRatePct|null`) → render `—` when null. Ship all three `—`
   initially (bill rate stays `—` per Rate-on-request policy; fill time/rate become the step-4 proxy).
3. **[trivial] Verify** the 4 already-live Overview pieces (Active reqs, state bars, specialty bars, activity feed) track `/jobs`.
4. **[large] Analytics REAL + labeled proxy** — second server read of `ls_events` (occurred_at/event_type/assignment_id/
   status/specialty/state/organization, ~5000) via the step-1 helper; NEW pure `aggregateAnalytics(jobs, events, now)`
   in hub-data.ts (port IAS `analytics.ts` countBy/monthlySeries/trend/avgBy bodies to IMS columns). SHIP REAL:
   active-reqs KPI+trend, specialty donut (relabel center → ACTIVE REQS), top-facilities (organization), reqs-opened/month.
   SHIP LABELED PROXY: avg time-to-fill + by-specialty = avg(first-archive − first-Receive) per assignment_id = "avg days
   to close" (a cancel also archives — NOT true fill). LEAVE ON SEED: true fill rate, Placements YTD, submittal→offer.
   Inject as JSON `<script>`; hub-client.ts drawAnalytics() prefers it over seed (seed = empty-state fallback). +vitest.
5. **[small] Real activity feed** — optional: `aggregateActivityFromEvents(events, now)` from ls_events (true event stream).
6. **[medium] Rate checker static tables** — NEW `src/lib/hub/rate-engine.ts`: port IAS `specialties.ts` curated min/max
   (+ p70=round(min+(max−min)*0.70)), `multipliers.ts`, `stateData.ts` as STATIC code (no DB). Render real numbers into the
   existing `<option value>`/`<seg data-mult>`/band attrs; hub-client.ts updateSim() goes real with ZERO JS change.

## Build order (DECISION-GATED — needs a Zach call)
7. **[medium] Weekly Sync → real.** RECOMMENDED (default, no new secret): NEW Supabase table `hub_weekly_sync`
   (PK week_key,column_key; items jsonb; RLS-on no-policy) + write endpoint `src/pages/api/hub/sync.ts` (prerender=false,
   behind hub guard) + `src/lib/hub/sync-data.ts` (port IAS weekHelpers getCurrentWeekKey). hub-client.ts hydrates from a
   JSON `<script>` + POSTs (debounced), localStorage as offline mirror. (Alt = reuse IAS Firebase `meetings/{weekKey}` →
   unifies both teams' standup but couples the SSO hub to a world-writable RTDB + needs Firebase creds. **Decision: A vs B.**)
8. **[medium] Costs — DECISION-GATED + honesty.** De-fake fabricated $ literals → `—`/labeled NOW. Cheap real win:
   replace `COST_TOOLS` with a real tooling list (`hub_subscriptions` table or TS const: name/vendor/monthly_cost/category)
   → Tooling/mo KPI = sum. **But recruiting $ (placement cost, spend, cost-per-placement) has NO source anywhere** (no
   expense ledger in Supabase/ls_events/ims_applications/IAS). Leave those `—` until Zach connects an expense source.

## Hard blockers (do NOT fabricate; leave on seed/`—`)
- **True fill rate / Placements YTD / submittal→offer** — need an LS **Bids + Agreements/Confirmation-Amendments**
  subscription flowing into `ls_events` (only Receive/Update/Cancel/Reject observed so far) OR the Sisense Agreement cube.
- **Bill/blended rate + all Costs dollars** — no expense ledger exists; LS Partner-API *may* carry bill/pay rate (the
  backfill script doesn't extract it today) → needs Zach OK to surface internal $ on the staff hub (site is else Rate-on-request).
- **Per-recruiter desk analytics** — `ls_events.recruiter` is null until a real LS payload proves attribution.

## Real-world questions only Zach can answer
1. Fill metrics: ship labeled proxies now (DEFAULT), or hold until you add an LS Bids+Agreements subscription?
2. Weekly Sync: new IMS Supabase table (RECOMMENDED) or reuse the live IAS Firebase board?
3. Costs: keep labeled placeholder / re-purpose to pipeline economics (no $) / connect a real expense source?
4. Are `COST_TOOLS` vendors (VerifyCred, RateCast, TravelWise) + recruiter names (Kelly R., Jordan M.) real or invented?
5. Does the LS Partner-API Assignment record return bill_rate/pay_rate? OK to surface internal $ in the staff hub?
6. Facility count: switch Overview from distinct public_facility_label (TYPE, under-counts) → distinct organization_id?
   OK to show real facility org names in the staff-only Analytics top-facilities?
7. Simulator: confirm the 8 specialties the `<select>` exposes; margin slider default 22% (as designed) vs 20% (IAS)?

## No new secret needed for steps 1-6 + Weekly-Sync-Option-B + Costs-tooling-list.
SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY already in HubEnv (hub-env.ts), provisioned on prod CF ims-website.
