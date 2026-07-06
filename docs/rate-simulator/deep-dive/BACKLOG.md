# Rate Simulator — Deep-Dive Backlog

> Every recommendation from the 17 pillar briefs, deduped, scored, and sorted by
> **impact then effort**. Generated 2026-07-05 from `briefs/10-26` + `maps/01-06`.
>
> Legend: `impact` and `effort` ∈ {LOW, LOW-MED, MED, MED-HIGH, HIGH}. `pillar` = the north-star
> dimension. `src` = source brief(s). Checkboxes track execution.
>
> **Standing rules that gate several items:** SHOW-BEFORE-DEPLOY + explicit deploy-go; NEVER
> fabricate a $ figure; numbers-only band changes still need golden-master + Zach sign-off;
> the migration `20260701000000` and any prod-schema change are Zach-only operator steps.

---

## Tier 1 — HIGH impact / LOW effort (do first: week-one batch)

- [ ] **Rotate + vault the two write credentials (firebase-admin SA + `SUPABASE_SERVICE_ROLE_KEY`), least-privilege** — quote integrity == these two secrets. `impact:HIGH · effort:LOW · pillar:anti-manipulation · src:13 R1`
- [ ] **Phase-0 percentile honesty patch** — stop labeling `min+(max-min)·p` interpolations as percentiles; rename "Recommended (market median)" → "Recommended (anchor)"; deprecate `getPercentileRate`→`bandInterpolate`. Zero math change. `impact:HIGH · effort:LOW · pillar:percentiles · src:24 R1`
- [ ] **Wire `npm test` into ias-website CI before `verify`; pin golden-master corpus exactly (`toBe(207)`); add bridge CI + monorepo pytest job; decide deploy-gating** — converts every existing test from advisory to load-bearing. `impact:HIGH · effort:LOW · pillar:accuracy-harness · src:14 R1, 17 R2`
- [ ] **Portability Step 0: back-port WS1 deltas, declare the vendored live copy canonical, tombstone `sync-rate-engine.mjs`** — defuses the standing landmine (a sync run silently regresses the `6d9edb1` premium fix). `impact:HIGH · effort:LOW · pillar:portability · src:15 R1`
- [ ] **Apply migration `20260701000000` to prod (Zach), then run fleet+bridge AMN-only to validate end-to-end** — unblocks aggregator sources; one bad row 23514s the whole batch today. `impact:HIGH · effort:LOW · pillar:data-sources · src:19 R1`
- [ ] **Fix the two ingestion-ceiling defects: IronDome CRNA max 250→325 (+ mirrored `blsSanityCheck` ceiling), allergy/immunology 200→≥215** — lets the pipeline SEE the contested market; quote bands unchanged. `impact:HIGH · effort:LOW · pillar:rate-hunt · src:20 R2`
- [ ] **Cited re-audit + correction of the 4 flagged-high bands** — pediatrics→~95-135, OB/GYN→~150-240, endocrinology→~160-240, family-medicine max→~160. Show-before. `impact:HIGH · effort:LOW · pillar:rate-hunt · src:20 R1`
- [ ] **"Why this number" provenance panel** — n_distinct, source families, rate-type trust class, freshness; all already in the RTDB bucket. Cheapest differentiator; no competitor shows provenance. `impact:HIGH · effort:LOW · pillar:competitive-moat · src:18 rec1`
- [ ] **Make unknown-specialty failure honest: kill the silent `internal medicine` default** — route true no-hits to an explicit "manual escalation" surface, cap substring-fold confidence at Low, log fallbacks to `quote_events`. `impact:HIGH · effort:LOW · pillar:specialty-coverage · src:22 R2`
- [ ] **Port the feedback writer to the hub; make capture a by-product of closing; write `CalibrationEntry` to a PRIVATE store (never the public-read tree); log one event per rendered quote** — consume side turns on automatically at n≥3. `impact:HIGH · effort:LOW · pillar:internal-truth · src:23 R1, 21 R1`
- [ ] **Quote-vs-subsequently-paid delta KPI + drift alarm** — per-cell median |sim−accepted|/accepted, weekly digest, alert on drift and on promotions→0. `impact:HIGH · effort:LOW · pillar:internal-truth · src:23 R5`
- [ ] **Write the confidentiality contract before any internal-truth wiring** — internal actuals may anchor/clamp/label, NEVER appear verbatim in a public surface or public-read node; HMAC provider identity at ingest. `impact:HIGH · effort:LOW · pillar:internal-truth · src:23 R8`
- [ ] **Fix the singleton-overlay server hazard: add `resetSpecialtiesToStatic()` before every overlay apply in any non-browser host** — blocks all server-side quoting until fixed. `impact:HIGH · effort:LOW · pillar:portability · src:16 R1`
- [ ] **Build the shared chat formatter as a pure `SimQuote → text/blocks` module with honesty lines baked in** — no adapter can drop a disclosure. `impact:HIGH · effort:LOW · pillar:portability · src:16 R4`
- [ ] **Ship API v0 (`/api/v1/quote` + `/v1/specialties`) in-repo (locumsmart-events pattern) with golden-master conformance in CI** — cross-surface drift gate from day one. `impact:HIGH · effort:LOW · pillar:portability · src:17 R2`
- [ ] **Build the snapshot path: Cron-Triggered Worker GETs RTDB `.json`, runs the full reader gate stack server-side, stores `{vintage,hash,tree}` in KV + a `prev` rollback slot.** `impact:HIGH · effort:LOW · pillar:portability · src:17 R3`
- [ ] **Stamp every API response with `meta.{engineVersion, snapshot.vintage, snapshot.hash}` and log every quote to `quote_events`** — reproducibility + accuracy-KPI foundation. `impact:HIGH · effort:LOW · pillar:portability · src:17 R4`
- [ ] **Make the API accept the FULL `RateFactors` vocabulary (facility/call/holiday/callOnly/dayType)** — do not replicate the hub's hardcoded-neutral controls defect. `impact:HIGH · effort:LOW · pillar:portability · src:17 R7`
- [ ] **Persist daily posterior snapshots (`rate_posterior_history`) + weekly FluView/NREVSS covariates** — the pillar's entire future depends on history we currently delete daily. `impact:HIGH · effort:LOW · pillar:market-timing · src:25 R1`
- [ ] **Fix state-attribution coverage: per-source telemetry + extend URL/content state patterns for WS1 posting sources; verify the v2 tree grows real state cells** — prerequisite for all sub-state geo. `impact:HIGH · effort:LOW-MED · pillar:geo-granularity · src:26 R1`
- [ ] **Fix the manual-controls factor gap / expose facility + call + holiday controls in the hub UI** — recruiters can't price a CAH night-call assignment without pasting a PDF today. `impact:HIGH · effort:LOW-MED · pillar:comp-factors · src:21 R4, 26 R5, 05`

## Tier 2 — HIGH impact / MEDIUM effort

- [ ] **Build the producer→engine specialty mapping layer (152→88) at the bridge + cross-repo key-set test** — unlocks live corroboration for 7 of IAS's top-15 cells with zero new scrapes; the cap on all other live-data work. `impact:HIGH · effort:MED · pillar:specialty-coverage · src:22 R1, 19 R2, 06 §3.4`
- [ ] **Wire the outcome + feedback calibration loop end-to-end** (capture UI → `quote_events`/`quote_outcomes` → calibration → accuracy scorecard); enable `computeDisplayedRate` only after the feedback node is locked. `impact:HIGH · effort:MED · pillar:internal-truth · src:21 R1, 23, 18 rec5, 11 R7`
- [ ] **Lock down `rate-simulator/feedback` (server-timestamp + rate-plausibility validate, or authenticated write path) BEFORE wiring Move #4** — prerequisite, not a nice-to-have. `impact:HIGH · effort:MED · pillar:anti-manipulation · src:13 R2`
- [ ] **Split advertised from paid**: require an `actual_paid_locum` corroborant before an advertised-only cell anchors, OR cap advertised-only at `medium` + anchor at a sourced advertised→paid discount. `impact:HIGH · effort:MED · pillar:anti-manipulation · src:13 R3`
- [ ] **Fix template inflation in the n count**: count distinct (family, rate-bucket) pairs, not (family, location, rate-bucket); cap per-family contribution to `n_distinct`. `impact:HIGH · effort:MED · pillar:anti-manipulation · src:13 R4`
- [ ] **Add a reader-side plausibility cross-check before anchoring** — reject a posterior outside the IronDome/curated band → `manual_review`. `impact:HIGH · effort:MED · pillar:anti-manipulation · src:13 R5`
- [ ] **Add `RateDistribution` to the bridge + RTDB (additive, D-33-safe)** — shrinkage-first (Tier S lognormal-shrunk / Tier P prior-shape); Tier E activates itself as n grows. `impact:HIGH · effort:MED · pillar:percentiles · src:24 R2`
- [ ] **Ship `distribution.ts` + offer-positioning UX** — `percentileOfRate` returns a RANGE + counter dollars ("offer ~p35, counter $X for p50"), normalizing the offer to base terms. `impact:HIGH · effort:MED · pillar:percentiles · src:24 R3`
- [ ] **Property-based + invariant suite** (fast-check TS + Hypothesis py) over the closed enums: bounds, monotonicity, overlay idempotence/safety, posterior permutation-invariance, extractor magnitude bands. `impact:HIGH · effort:MED · pillar:accuracy-harness · src:14 R2`
- [ ] **Canary cells + drift alerts on the live path** — ~15 cited cells, nightly in-band assertion, promotion-count/day-over-day/partition/freshness monitors, rate-surface snapshot table. `impact:HIGH · effort:MED · pillar:accuracy-harness · src:14 R3`
- [ ] **Per-quote provenance object** — `bridgeRunId → bucket (n/families/lastUpdated) → observation URLs`; render "Why this number?"; attach to every feedback event. `impact:HIGH · effort:MED-HIGH · pillar:accuracy-harness · src:14 R4`
- [ ] **"Explain this rate" provenance drawer with verbatim cited spans** — thread `cited_text`/char-ranges through the bridge into `MarketBucketData` (Phase-8 deferral); legal pass on republishing scraped snippets. `impact:HIGH · effort:MED · pillar:competitive-moat · src:21 R2, 18 rec1`
- [ ] **Extract `packages/rate-engine/` with the `MarketSource` port + re-export shims** (Steps 1-2) — kills the barrel-bypass leak; consumable by any TS host. `impact:HIGH · effort:MED · pillar:portability · src:15 R2, 17 R1`
- [ ] **Absorb the quote façade + confidence blend into the core (`quote()`)** — biggest anti-drift move; ship `percentileMethod` + `provenance.anchor` in the result shape. `impact:HIGH · effort:MED · pillar:portability · src:15 R3, 16 R2`
- [ ] **Repoint the bridge at the package (inverted source-vendor), then delete `ias-dashboard/src/features/rate-simulator/`** — one SPECIALTIES key set, one precedence ladder, one `aggregateCell`. `impact:HIGH · effort:MED · pillar:portability · src:15 R6`
- [ ] **Ship the Slack adapter first** (slash + `app_mention`) as Astro API routes on CF Pages, reusing the existing IAS Slack app. `impact:HIGH · effort:MED · pillar:portability · src:16 R3`
- [ ] **Put feedback buttons on every chat reply → write `quote_events`/`quote_outcomes` server-side** (RLS-locked Supabase, not the world-writable RTDB path) — Move #4's missing data producer. `impact:HIGH · effort:MED · pillar:portability · src:16 R5`
- [ ] **Graduate to a dedicated `ims-rate-api` Worker on `api.imstaffing.ai` with per-key auth (hashed keys, scopes, per-key rate limits)** once the ATS prototype consumes v0. `impact:HIGH · effort:MED · pillar:portability · src:17 R5`
- [ ] **Point the scraper fleet at the divergence cells first** (GI, pathology, OB/GYN, pediatrics, endocrinology, hospitalist) — market-typed postings anchor automatically and convert every open dispute into observed data. `impact:HIGH · effort:MED · pillar:rate-hunt · src:20 R3`
- [ ] **Wire the 3 net-new direct families** (Cross Country, LocumTenens.com mobile endpoint, gaswork RSS) — with AMN yields 3-4 independent families across ~11 high-volume specialties. `impact:HIGH · effort:MED · pillar:data-sources · src:19 R4`
- [ ] **Wire the Vivian JSON-LD aggregator** (stealth + sitemap) — biggest hidden-pay recovery surface; strict specialty allowlist + org-recovery required. `impact:HIGH · effort:MED · pillar:data-sources · src:19 R6`
- [ ] **Expand IronDome `PLAUSIBLE_RANGES` cite-or-block** for each specialty a new source can reach + add the canonical-list-vs-bands coverage assertion in CI. `impact:HIGH · effort:MED · pillar:data-sources · src:19 R5`
- [ ] **Build the bill registry from `ls_events.raw_payload` + Partner-API per-CA enrichment** into the RS-0 tables; use the CA CSV export for pre-webhook history. `impact:HIGH · effort:MED · pillar:internal-truth · src:23 R2`
- [ ] **Specify the internal rung of the trust ladder explicitly** — dedicated agent id, n≥3 distinct placements + k≥3 anonymity, shrink toward the prior below the gate; the ≥2-family quorum must NOT apply. `impact:HIGH · effort:MED · pillar:internal-truth · src:23 R3`
- [ ] **Add the P1 physician cells cite-or-suppress** — radiation oncology, cardiothoracic surgery, OB hospitalist/laborist, child neurology, addiction medicine, CNM; engine key + alias + curated band only if cited + producer mapping + `SPECIALTY_TO_SOC`. `impact:HIGH · effort:MED · pillar:specialty-coverage · src:22 R3`
- [ ] **Exponential recency decay via `evidence_weight` + Kish effective-n (`n_eff ≥ 4`) in the anchor gate; widen the bridge window; hard max age** — replaces the 7-day cliff with graceful degradation; zero posterior-math change. `impact:HIGH · effort:MED · pillar:market-timing · src:25 R2`
- [ ] **Per-cell Theil-Sen trend flags (display-only first), fed by posterior history; anchor nowcast only after rate_audit_log backtests** — CHG's +55% anesthesia vs −8% EM proves trend must be per-cell. `impact:HIGH · effort:MED · pillar:market-timing · src:25 R6`
- [ ] **Replace the hand-curated `STATE_DEMAND_CLASS` with a reproducible HPSA-derived index** (carries the dominant 0.40 exponent) — same raw-artifact + extract-script discipline; diff every state before/after. `impact:HIGH · effort:MED · pillar:geo-granularity · src:26 R3`
- [ ] **Extract OEWS metro/nonmetro + ship `GEO_TIER_RATIO` as a labeled static tier-ratio prior** (clamped, applied only when tier is positively known). `impact:HIGH · effort:MED · pillar:geo-granularity · src:26 R4`
- [ ] **W2-locum vs 1099-locum as an observed bucket dimension** (thread `evidence_employment_arrangement` into buckets, visible arrangement badge, toggle ships only when both arrangements have observed cells) + a test asserting no path multiplies a quote by any arrangement constant. `impact:HIGH · effort:MED · pillar:comp-factors · src:10 R3`
- [ ] **Worked-day quote path for non-call daily assignments** — `payUnit` input on `RateFactors`, quote from observed DAY posteriors / `CALL_RATE_DATA` worked-day priors / honest insufficient surface. `impact:HIGH · effort:MED · pillar:comp-factors · src:10 R2`
- [ ] **Split `CallRateEntry` into per-comp-model axes + add `in-house-call` (restricted) to `CallCompModel`** — unblocks the 3 audit-confirmed adds and the restricted-vs-unrestricted premium. `impact:HIGH · effort:MED · pillar:comp-factors · src:11 R1`
- [ ] **Give the manual sim a call control** (none / home-beeper / in-house / call-only + day-type) instead of hardcoded `hasCall:false`. `impact:HIGH · effort:MED · pillar:comp-factors · src:11 R4`
- [ ] **Side-channel extras capture at parse time** — classify discarded $-figures (sign_on/completion/weekly_stipend/per_diem) into new nullable columns instead of destroying them; non-anchorable by construction. `impact:HIGH · effort:MED · pillar:comp-factors · src:12 R1, 18 rec4`
- [ ] **Decide the default-quote position explicitly** (p70 "aggressive-but-winnable" vs band-median + multipliers carry premium) — affects every static-quoted cell. `impact:HIGH · effort:MED · pillar:rate-hunt · src:20 R6`

## Tier 3 — HIGH impact / HIGH effort

- [ ] **Open the DAY-unit funnel + build the call-band overlay path** — persist unit=DAY rows into a separate channel (NEVER convert to hourly), build daily-call posteriors per (specialty, comp-model), design a call-band overlay parallel to Move #1. `impact:HIGH · effort:HIGH · pillar:comp-factors · src:11 R3, 10 R1, 19 R7, 18 rec3, 21 R7`
- [ ] **Comp-structure fidelity program**: `pay_unit` first-class dimension end-to-end (HOUR/DAY/SHIFT/CALL_DAY/WRVU) with per-unit IronDome bands + bridge bucket key `(spec|state|type|unit)`. `impact:HIGH · effort:HIGH · pillar:comp-factors · src:10 R1`
- [ ] **Source-provenance trust score + require ≥1 non-agency corroborant before badging 'high'** — most rows are sell-side (agencies pricing their own product). `impact:HIGH · effort:HIGH · pillar:anti-manipulation · src:13 R12`
- [ ] **Price expected callback on call-only quotes as a labeled quiet/typical/busy scenario band** — only where callbackRate + gratisHrs are cited; E[callback hrs] must be labeled ESTIMATED or gated on LocumSmart timesheet data. `impact:HIGH · effort:HIGH · pillar:comp-factors · src:12 R3, 11 R6`
- [ ] **Generalize the CRNA census-division ladder into the shared engine + implement the shrinkage blend** (`cell → state → division → national`, empirical-Bayes precision-weighted, k≈4). `impact:HIGH · effort:HIGH · pillar:geo-granularity · src:26 R7`

## Tier 4 — MEDIUM-HIGH impact

- [ ] **Launch the weekly Locum Rate Index** (per-specialty trend feed off the posterior tree, anchor-gate-only, thin-cell suppressed) — Vivian's monthly RN report done better; API funnel + SEO. `impact:MED-HIGH · effort:LOW-MED · pillar:competitive-moat · src:21 R5`
- [ ] **Wire the bill-bound backstop as a one-way clamp** (`pay ≤ bill × pay/bill_ratio(HCO)`, ratio learned per HCO; seed Atrium 0.862) — surfaces the Wake-Forest class of over-quote. `impact:MED-HIGH · effort:LOW-MED · pillar:internal-truth · src:23 R4`
- [ ] **Make the reader state-aware** — `readCellBuckets` should prefer `(state cell)→national`, not `national→first-key state cell`; rung-2 prerequisite + fixes a latent arbitrary-cell bug. `impact:MED-HIGH · effort:LOW · pillar:geo-granularity · src:26 R2`
- [ ] **DAY-rate capture channel** — persist unit=DAY posting rows (typed, separate from the hourly band) to feed a future call/day-band refresh; add WEEK as a typed-but-rejected unit with its own counter. `impact:MED-HIGH · effort:MED · pillar:data-sources · src:19 R7`

## Tier 5 — MEDIUM impact / LOW effort

- [ ] **Alarm on the 7-day cliff + promotion-count deltas** (fleet idle >48h, promotions drop ≥50% run-over-run) — turns silent denial-of-accuracy into a paged event. `impact:MED · effort:LOW · pillar:anti-manipulation · src:13 R6, 25 R3, 14`
- [ ] **Raise the anchor bar (`minDistinct`/`minFamilies`) for high-variance / surgical / call-heavy specialties.** `impact:MED · effort:LOW · pillar:anti-manipulation · src:13 R10`
- [ ] **Pin the two SPECIALTIES key sets equal with a cross-repo CI test** — closes the silent coverage gap (`03 §S4`). `impact:MED · effort:LOW · pillar:specialty-coverage · src:13 R11, 22 R5`
- [ ] **Generalize never-anchor from a 2-entry denylist to a class** (any modeled salary aggregator: ZipRecruiter/Glassdoor/Indeed/SimplyHired/Talent/Adzuna/Vivian-W2). `impact:MED · effort:LOW · pillar:anti-manipulation · src:13 R8`
- [ ] **Bridge fail-closed** (assert the 3 partition invariants before the RTDB write) + **CI job diffing deployed RTDB rules vs the repo file.** `impact:MED · effort:LOW · pillar:accuracy-harness · src:14 R7`
- [ ] **Swap the hub to the REST `MarketSource`** — deletes the `firebase` npm dep, `forceWebSockets()`, and the CSP wildcard. Requires RTDB public-read confirmation. `impact:MED · effort:LOW · pillar:portability · src:15 R5`
- [ ] **Publish `@ims/rate-sdk` (zero-dep fetch wrapper) + optional `@ims/rate-widgets`** (packaged `sim-render` builders) for the ATS. `impact:MED · effort:LOW · pillar:portability · src:17 R6`
- [ ] **Extend the conformance corpus with overlay/anchored cases** (seed: the 22-case `marketBucketsOverlay.test.ts`). `impact:MED · effort:LOW · pillar:accuracy-harness · src:17 R8, 14 R6`
- [ ] **Replace the world-writable RTDB feedback path with authenticated `POST /v1/feedback` → `quote_outcomes`** before wiring Move #4. `impact:MED · effort:LOW · pillar:portability · src:17 R9`
- [ ] **Publish a public methodology page** (gates, never-anchor lists, family collapse, honest insufficiency) — full disclosure is a marketing asset because it is real. `impact:MED · effort:LOW · pillar:competitive-moat · src:18 rec8, 21 R8`
- [ ] **Flip the staged posting boards after live selector verification** (Physemp JSON-LD proven, then DocCafe, emCareers) — Physemp+AMN = first real 2-family promotions. `impact:MED · effort:LOW-MED · pillar:data-sources · src:19 R3`
- [ ] **Transparency-state geo scrapes** (CO/WA/NY/IL/CA state-filtered listings for wired + pay-opaque boards) — rows arrive state-attributed. `impact:MED · effort:LOW · pillar:data-sources · src:19 R8`
- [ ] **Ingest Marit Health as a `crowd_survey` geo prior** (per-specialty × per-state $/hr) + annual CHG/LT.com reports as labeled context rungs. `impact:MED · effort:LOW · pillar:data-sources · src:19 R9`
- [ ] **Society-board sweep behind the ACR precedent** (ACR mandated disclosure first, then JAMA) — audit ACEP/SHM/APA/AAFP for salary-required policies. `impact:MED · effort:LOW-MED · pillar:data-sources · src:19 R10`
- [ ] **Freshness/ops hardening**: schedule every verified source ≥2×/week; capture JSON-LD `datePosted` into `published_at`. `impact:MED · effort:LOW · pillar:data-sources · src:19 R11, 25 R8`
- [ ] **Per-board ToS review checklist as a `verified=True` flip precondition** (robots, ToS clause, throttle plan) documented per entry. `impact:MED · effort:LOW · pillar:data-sources · src:19 R13`
- [ ] **Raise the pathology max (200→215 min, 250 preferred)** — justified by the engine's OWN callRates worked-day band alone. `impact:MED · effort:LOW · pillar:rate-hunt · src:20 R4`
- [ ] **Add missing specialty keys where a cited market exists** (pediatric endocrinology; scope radiation oncology). `impact:MED · effort:LOW · pillar:rate-hunt · src:20 R7`
- [ ] **Refresh the empirical universe + rank Phase-2 splits with the collapse anti-test** (split only when subcell distribution is demonstrably separated from parent). `impact:MED · effort:LOW · pillar:specialty-coverage · src:22 R4`
- [ ] **Reconcile the three margin conventions** (0.80 engine / 0.22 hub / 0.35 spec) — pick one labeled convention, expose the per-HCO learned ratio, show recruiters both sides. `impact:MED · effort:LOW · pillar:internal-truth · src:23 R7`
- [ ] **Wire OEWS quantile-RATIOS as shape priors for APP + sub-top-code cells** (with `top_capped` honesty for the rest) — table already vendored. `impact:MED · effort:LOW · pillar:percentiles · src:24 R4`
- [ ] **Wire LocumSmart bid-ceiling quantiles as the cross-axis sanity bound** — `observedHcoProfile`/`observedSpecialtyProfile` compute p25/p50/p75 already and have zero consumers. `impact:MED · effort:LOW · pillar:percentiles · src:24 R5`
- [ ] **Surface data age + `asOf` metadata** (live anchor as-of date; curated band audit date) in the hub sim + add `asOf` to curated tables. `impact:MED · effort:LOW · pillar:market-timing · src:25 R4`
- [ ] **Curated re-audit cadence policy** — re-cite hot specialties every 90d, others 180d (GSA FY table + callRates snapshot will silently rot). `impact:MED · effort:LOW · pillar:market-timing · src:25 R5`
- [ ] **Extract `datePosted` from JSON-LD postings** to reduce the scrape-date-floor age bias. `impact:MED · effort:LOW · pillar:market-timing · src:25 R8`
- [ ] **State-factor context panel (display-only)** — IMLC membership + licensing-speed, CON status, malpractice tier, Medicare geographic-HPSA bonus hint. No multipliers. `impact:MED · effort:LOW-MED · pillar:geo-granularity · src:26 R8`
- [ ] **Add minimum-guarantee fields + display-only "effective day floor" line** (`guarantee.hoursPerDay` on `RateFactors`, parser patterns, manual input). `impact:MED · effort:LOW · pillar:comp-factors · src:10 R4`
- [ ] **Wire the dormant observed OT signal** as a labeled "observed bid-ceiling" context line + add contractual OT inputs; do NOT install a default OT multiplier. `impact:MED · effort:LOW-MED · pillar:comp-factors · src:10 R5`
- [ ] **Gate the Market Position bar to same-unit distributions** (hourly-only until R1/R2) so a daily/shift/wRVU quote can't plot against an hourly distribution. `impact:MED · effort:LOW · pillar:comp-factors · src:10 R7`
- [ ] **Apply the open 2026-06-26 call audit items** once the schema exists (anesthesiology beeper axis, trauma worked-day + investigate the $2,500 "beeper" label first, neonatology bands, urology gratisHrs 4→2). `impact:MED · effort:LOW · pillar:comp-factors · src:11 R2`
- [ ] **Replace or explicitly label the uncited flat 1.10× hourly call multiplier** (tier by burden/restriction with cited differentials, or mark ESTIMATED). `impact:MED · effort:LOW · pillar:comp-factors · src:11 R5`
- [ ] **Logistics & extras context panel** — wire the shipped GSA table into a labeled facility-cost block WITH a fiscal-year staleness guard (or delete the dead table). `impact:MED · effort:LOW-MED · pillar:comp-factors · src:12 R2`
- [ ] **Headline-inflation metadata bit** — flag observations where a bonus/stipend token sits near an "up to"/range headline (metadata only). `impact:MED · effort:LOW · pillar:anti-manipulation · src:12 R5`
- [ ] **Discord adapter = slash-command-only on serverless for now** (guild-allowlist + role-gate; quotes are competitive intelligence). `impact:MED · effort:LOW · pillar:portability · src:16 R6`
- [ ] **Pre-strip question phrasing in the chat adapter** + reply with fuzzy suggestions on `no_specialty` — never a defaulted quote. `impact:MED · effort:LOW · pillar:portability · src:16 R7`
- [ ] **Cache the RTDB REST tree (15-60 min TTL) + surface overlay age in the chat reply footer** — chat has no client-side re-fetch loop. `impact:MED · effort:LOW · pillar:portability · src:16 R8`

## Tier 6 — MEDIUM impact / MEDIUM effort

- [ ] **One machine-readable family registry across languages** (`KNOWN_FAMILY_OVERRIDES` + `AGGREGATOR_SOURCES` + `NEVER_ANCHOR_SOURCE_IDS` as one checksummed JSON) consumed by both Python + TS. `impact:MED · effort:MED · pillar:anti-manipulation · src:13 R7, 19 R12`
- [ ] **Chunk/partition the Supabase insert with per-row error capture** — one poisoned row can't drop the whole fleet's day. `impact:MED · effort:MED · pillar:anti-manipulation · src:13 R9`
- [ ] **Automated benchmark reconciliation** — monthly BLS-verdict batch job; vintage tripwires (OEWS May-2025, GSA FY); one band registry unifying the 4 divergent plausibility tables. `impact:MED · effort:MED · pillar:accuracy-harness · src:14 R5`
- [ ] **Malpractice-provision flag end-to-end** (tri-state on scraper rows + PDF detection; wire dormant `insuranceProvidedBy`) — SEGMENT populations, never invent a $-multiplier. `impact:MED · effort:MED · pillar:comp-factors · src:12 R4`
- [ ] **Instance-scope the specialties table** (`createRateEngine()` clones the static table) — retire the bundler-dedup singleton contract + the long-lived-process staleness hazard. `impact:MED · effort:MED · pillar:portability · src:15 R4`
- [ ] **Ship `/api/rate-quote` on CF Pages as the first headless consumer**, route Discord/Slack through it (one refresh cadence, one number source). `impact:MED · effort:MED · pillar:portability · src:15 R7`
- [ ] **Phase B (after the API is primary): bridge dual-write to the API store, migrate the hub off the browser Firebase SDK, close RTDB public-read.** `impact:MED · effort:MED · pillar:portability · src:17 R10`
- [ ] **Break the LocumStory circularity in the curated prior** + re-baseline against current LocumStory 2025 + add per-band inline citations; surface "prior source class" in the provenance panel. `impact:MED · effort:MED · pillar:rate-hunt · src:18 rec7, 20 R5`
- [ ] **Capture $/wRVU rates as a side-channel WRVU unit** (radiology first); only a user-declared expected-volume input may produce an effective $/hr with a "contingent on productivity" caveat. `impact:MED · effort:MED · pillar:comp-factors · src:10 R6`
- [ ] **Compute a labeled "expected call-day total comp" scenario** (stipend + expected callback hrs × cited callback rate) as a quiet-vs-busy band, never the anchor. `impact:MED · effort:MED · pillar:comp-factors · src:11 R6`
- [ ] **Surge flags** — internal WoW jump detector + a curated external event table (strikes, declared emergencies, epidemic indices); flags change labels + decay, never the quote number. `impact:MED · effort:MED · pillar:market-timing · src:25 R7`
- [ ] **Geo heatmap in the two-layer honest form** (modeled STATE_MULT choropleth + observed state anchors as an empty-but-honest roadmap layer). `impact:MED · effort:MED · pillar:geo-granularity · src:21 R9`
- [ ] **Add `geo_tier` to the observation schema + a `geo_attribution` module** (city→FIPS→RUCC + CAH list match), nullable, with attribution-path telemetry. `impact:MED · effort:MED · pillar:geo-granularity · src:26 R6`
- [ ] **Decide the paid-benchmark license question (MGMA/SullivanCotter/AMGA)** for physician upper-tail shape — ingest as ratios + edition-named `prior_ref` only. `impact:MED · effort:MED · pillar:percentiles · src:24 R6`
- [ ] **Persist the capped survivor-value vector per bucket** so distributions are auditable/regradable; resolve the public-read exposure explicitly. `impact:MED · effort:MED · pillar:percentiles · src:24 R7`
- [ ] **Extend call-band coverage along the specialty priority order** (needs the DAY-unit path un-deferred). `impact:MED · effort:HIGH · pillar:specialty-coverage · src:22 R6`
- [ ] **Fix the operational pay-documentation gap at the source** (per-placement, per-week `(placement, week, paid_rate, hours, rate_axis)` export from whatever runs the weekly pay cycle). `impact:HIGH-longterm · effort:MED-org · pillar:internal-truth · src:23 R6`
- [ ] **Evaluate Marit/SalaryDr as `crowd_survey` context partners + NPI-style verification for any future physician-submitted rates.** `impact:MED · effort:MED · pillar:competitive-moat · src:18 rec9, 21 R10`
- [ ] **Golden-master extension + canonical inversion** (move `gen-golden-master.ts` into the live repo; add overlay/SimQuote/initFactors/bridge goldens). `impact:MED · effort:LOW-MED · pillar:accuracy-harness · src:14 R6`

## Tier 7 — LOW-MEDIUM / LOW impact

- [ ] **Bill-rate honesty label** — one sentence stating travel/lodging/malpractice are billed/absorbed separately, not in the professional-fee bill. `impact:LOW-MED · effort:LOW · pillar:comp-factors · src:12 R6`
- [ ] **Buy/ingest one cross-check on-call survey** (SullivanCotter Physician & APP On-Call) as a LABELED non-locum prior — never a quote anchor. `impact:MED · effort:LOW-cost · pillar:comp-factors · src:11 R8`
- [ ] **Surface geo-saturation honestly** when `marketMaxApplied` fires on call-only in high-mult states. `impact:LOW · effort:LOW · pillar:comp-factors · src:11 R9`
- [ ] **Rename one of the two "per diem" concepts** in `callRates.ts` (call stipend vs GSA travel). `impact:LOW · effort:LOW · pillar:comp-factors · src:11 R10`
- [ ] **Sub-floor drop counter** ($60/hr / $400/day gratis-guard) so a genuine market regime change isn't silently filtered. `impact:LOW · effort:LOW · pillar:comp-factors · src:12 R8`
- [ ] **Anti-scope-creep: do NOT model CME/licensing/rental-car as rate factors** (context booleans only if ever captured) — document the non-decision. `impact:LOW · effort:LOW · pillar:comp-factors · src:12 R7`
- [ ] **Codify the poisoned-comparator list** (ZipRecruiter, Sermo hourly, salary.com, T1 pages that launder them). `impact:LOW · effort:LOW · pillar:rate-hunt · src:20 R8`
- [ ] **Log every chat query verbatim** — free market-demand telemetry ("what can't we price?"). `impact:LOW · effort:LOW · pillar:portability · src:16 R9`
- [ ] **Portability hygiene riders** — rename `firebaseKeyCodec.ts`→`keyCodec.ts`, settle `@ims/` vs `@ias/`, move `goldenMaster.json` into the package, `sideEffects:false`, keep `/bls` + `/crna` as subpath exports. `impact:LOW · effort:LOW · pillar:portability · src:15 R8`
- [ ] **Time-decay the feedback calibration window** (replace last-10-count with exponential decay) when the feedback loop ships. `impact:LOW · effort:LOW · pillar:market-timing · src:25 R10`
- [ ] **Defer any seasonal rate multiplier; ship the qualitative calendar-context card only** — revisit after a full year of history. `impact:LOW-now · effort:LOW · pillar:market-timing · src:25 R9`
- [ ] **Retire `METRO_CITIES` as the metro oracle once RUCC lands** (keep as a parser hint). `impact:LOW-MED · effort:LOW · pillar:geo-granularity · src:26 R9`
- [ ] **Backtest hooks** — log shown quantiles into `quote_events`, add interval-coverage to the validation battery. `impact:LOW · effort:LOW · pillar:percentiles · src:24 R9`
- [ ] **Exploratory only: SAM.gov/USASpending VA staffing awards** for the BILL/cap axis (`agency_bill_rate`, never renderable) — don't spend fleet time until `cap-rates` has a reader. `impact:LOW · effort:MED · pillar:data-sources · src:19 R14`

---

## Cross-cutting prerequisites (schedule WITH the items above, not after)

1. **Migration `20260701000000`** applied to prod (Zach) — blocks all aggregator sources.
2. **Taxonomy mapping layer (152→88)** — caps every live-data-dependent item at ~19/88 until fixed.
3. **Lock the world-writable `feedback` node** — blocks Move #4 calibration.
4. **Portability Step 0 (declare vendored canonical + tombstone sync)** — standing landmine.
5. **RTDB deployed-rules export** — the open adversarial check (`03 §S5`); prerequisite for the REST
   adapter, the API, and any anti-manipulation "high" claim.
6. **State-attribution coverage** — prerequisite for every sub-state geo item.
