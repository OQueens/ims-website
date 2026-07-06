# Research Prompt — ATS Embed + Hosted Rate API / SDK (refreshes brief 17)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/17-portability-embed.md`.

## Scope
Two delivery vehicles on top of the headless core: (a) the engine embedded in a future in-house
ATS, and (b) a hosted rate API + npm SDK so every surface calls ONE source of truth. Confirm the
API contract, versioning (contract axis vs data-vintage axis), auth/scoping/rate-limits, the
RTDB-REST + KV + Cron snapshot path, and why API-first holds the drift count at 1.

## Code anchors to re-verify
- `src/pages/hub/index.astro:25` (`prerender=false` — Phase-1 engine already runs on workerd in prod)
- `src/pages/api/locumsmart-events.ts` (APIRoute pattern, `locals.runtime.env`, constant-time secret); `zod` in devDeps
- `marketRates.ts:220-248,317-375,469-551` (reader gate stack that must move server-side intact)
- `quote_events`/`quote_outcomes` migration `20260604000000` (the accuracy-KPI denominator)
- `hub/session.ts` (first-party cookie — can't authenticate cross-origin/S2S; per-client keys needed)
- `02-hub-adapter-layer.md §10` (confirmed vendored two-way drift = the observed why-API-first proof)

## External questions to refresh
1. firebase-admin on Workers (community REST-wrapper norm) + `nodejs_compat` state; RTDB REST `.json` read.
2. Cloudflare Cron Triggers + KV + scheduled handler pattern; current Workers script-size limits.
3. Stripe-style versioning (URL major + additive-only; optional date-pinned header).
4. DOJ/FTC 2023 withdrawal of the wage-survey antitrust safe-harbor (UNVERIFIED — counsel before
   selling rate data to other staffing firms; design for aggregated non-attributable cells only).

## Deliverable
Rewrite brief 17 + update BACKLOG rows for pure-core prerequisite, API v0 routes + conformance,
snapshot path, response stamping + quote_events, dedicated Worker + per-key auth, SDK/widgets,
full-RateFactors API, conformance corpus extension, authenticated feedback, Phase-B dual-write.
