# Brief 23 — Internal Ground Truth: What We Actually Pay, What We Actually Bill, and the Calibration Loop

> Deep-dive research brief, 2026-07-03. Pillar: INTERNAL GROUND TRUTH — actual-paid observations
> as the highest-trust rung of the trust ladder.
>
> Scope: the LIVE simulator (imstaffing.ai/hub, `ias-website` repo: `src/lib/rate-engine` +
> `src/lib/hub`), the still-live pipeline (`ias-dashboard/scripts/data-refresh` bridge +
> `agent-sdk` scraper), the LocumSmart webhook (`/api/locumsmart-events`), the EC2 Sisense tap
> (`C:/Users/oclou/QueenClaude/ims-ls-tap`), and the dormant RS-0 internal-rates schema.
> All paths absolute or relative to `C:/Users/oclou/QueenClaude/`. Every number is labeled
> OBSERVED (read from code/data, cited) or ESTIMATED/CONVENTION (uncited constant). Anything
> not directly readable is flagged UNVERIFIED and listed in the fact-check queue.

---

## Summary

1. **The foundational fact of this pillar is negative and Zach-confirmed:** IMS does **not**
   document what it actually pays physicians. Verbatim (2026-06-01, north-star correction
   banner): *"we have the BILL rate but we don't know what we actually PAID them because it
   changes and we don't document that"*
   (`ias-dashboard/docs/rate-simulator/2026-06-01-accuracy-redesign-spec.md:9`, restated
   :111-121). The memory audit trail agrees: `ls_events`/`ims_jobs` have **no rate columns**;
   LS invoice/timesheet payloads are logged with no rate extraction; the "138-placements
   rate registry" **does not exist** (memory `project_ims_rate_accuracy_system_2026-06-25.md:60`).
   Consequence: the actual-paid rung of the trust ladder cannot be *backfilled* for pay — it
   must be **born at deal-close time going forward**, plus a bill-side registry that CAN be
   backfilled from LocumSmart.

2. **What exists today is bill-side and aggregate-side, not pay-side.** Four internal surfaces
   exist, none wired into the quote: (a) the LS webhook event log `ls_events` (lossless
   `raw_payload`, zero typed rate fields), (b) the EC2 Sisense KPI tap → `ims_ls_analytics`
   (LS's own aggregates: fill rate, invoiced $, revenue by specialty — no per-placement
   rates), (c) a fully-designed-but-never-built RS-0 internal rates pipeline
   (`sisense_bids` / `sisense_bid_rate_history` / `sisense_agreements` /
   `sisense_proposed_changes` / k-anonymized `sisense_bid_market_masked` — migration written,
   client scripts are 10-byte stubs), and (d) a one-row HCO contract-caps worksheet
   (Atrium/Wake Forest CRNA: bill $290 / pay $250 / 0.862 pay-bill ratio, "Zach 2026-05-15
   verbal").

3. **The engine is already shaped to receive internal truth.** `actual_paid_locum` is the top
   of `BUCKET_PRECEDENCE` (rank 4) and a member of `DEFAULT_ANCHORABLE_RATE_TYPES`
   (`src/lib/rate-engine/marketRates.ts:119-124,419-422`), and a complete quote-vs-accepted
   calibration loop (`CalibrationEntry`, dampened 50%, clamped ±15%, min n=3) is consumed by
   `computeDisplayedRate` — but the RTDB `rate-simulator/feedback` node is **empty** and the
   hub has **no write path** (`docs/rate-simulator-IMPROVEMENT-PLAN.md:31`). The missing work
   is capture + plumbing + a deliberate internal-rung gate design, not modeling.

4. **Bill vs pay is currently a convention, not an observation.** The engine invariant is
   `bill = pay / 0.80` (`rateCalculator.ts:716`); the hub slider defaults to 22% margin
   (`sim-adapter.ts:49`) and call-only pins 20% (`sim-adapter.ts:318-321`). The single real
   internal observation on disk says Atrium runs **0.862** pay/bill — a materially different
   number that the worksheet itself flags ("The squeeze produces a higher actual paid rate
   than the default ratio would predict", `hco-contract-caps-WORKSHEET.csv` row 1).
   Recruiters need both sides quoted; today both sides are one number and a hardcoded ratio.

---

## Findings (cited)

### F1. There is no internal PAY ground truth — by process, not by missing integration

- OBSERVED (doc): the Tier-0 "own placement PAY history" plan was declared **DEAD** on
  2026-06-01: *"It is confirmed DEAD — Zach: 'we have the BILL rate but we don't know what we
  actually PAID them because it changes and we don't document that.' There is no internal pay
  ground-truth."* (`ias-dashboard/docs/rate-simulator/2026-06-01-accuracy-redesign-spec.md:9`;
  §3 Tier-0 entry :48; the struck-through original framing :121).
- OBSERVED (memory, 2026-06-25): "`ls_events`/`ims_jobs` have **no rate columns**; LS
  invoice/timesheet payloads are logged as `event_type:'unknown'` with no rate extraction;
  the '138-placements rate registry' does NOT exist"
  (`~/.claude/projects/.../memory/project_ims_rate_accuracy_system_2026-06-25.md:60`).
  The "~138 placements" figure traces to the Confirmation-Agreement CSV client roster
  (CHS 101 / Advocate 24 / Tenet 5 / Ochsner 3 / LifePoint / Providence / USPI —
  memory `project_ims_locumsmart_sisense_tap_2026-06-08.md:82`) — UNVERIFIED as an exact
  placement count; needs the CA export.
- Root cause is **operational**: pay is renegotiated per placement and per week (pay cadence
  is weekly per standing rules) and never lands in a system of record. No code change alone
  fixes this; F8/R1/R7 below are the capture design.

### F2. The LocumSmart webhook captures everything losslessly — and extracts zero dollars

- OBSERVED: `POST /api/locumsmart-events`
  (`ias-website/.worktrees/feat-ims-phase-1-plan/src/pages/api/locumsmart-events.ts:54-119`)
  appends **every** authenticated delivery to append-only `ls_events` (idempotent on
  `dedupe_key`, :92-94), then projects assignment-shaped payloads onto the `ims_jobs` board
  (:105-111). Validation is deliberately lenient — only the bearer `key` is required
  (`src/lib/locumsmart-events-logic.ts:109-120`), precisely so non-assignment events
  ("Bid / Agreement / Invoice / Timesheet / Provider / Confirmation Amendment",
  :113-117,148-150) are logged the day they first arrive.
- OBSERVED: the `ls_events` schema has **no rate column of any kind** — typed columns are
  identity/specialty/geo/count fields only, plus lossless `raw_payload` with the bearer key
  redacted (`migrations/20260602_ls_events_table.sql:16-58`). Same for the 60+-column
  `ims_jobs` row: `mapToImsJobsRow` maps call structure (`callType`, `callRatio`,
  `callResponseTimeRequired`), trauma level, certifications — but no dollar field exists in
  the typed LS assignment contract (`src/lib/locumsmart-webhook-logic.ts:42-97,277-335`).
- OBSERVED (spec): the 2026-06-08 research states Timesheet (Submitted/Approved) and Invoice
  (PendingLMApproval/Paid) events "already landing in `ls_events`" carry a
  **`confirmationAgreementId`** (a distinct one = a real confirmed placement) and invoices
  carry **`totalMarkup` / `totalExpense`** = "real internal dollars"
  (`docs/superpowers/specs/2026-06-08-locumsmart-analytics-access-research.md:60,67-69,134-136`).
  The same spec explicitly flags the three semantics questions as [Needs-live-confirm]
  (:167): (i) does one distinct `confirmationAgreementId` equal one placement, (ii) the
  fill-rate denominator window, (iii) whether `totalMarkup`/`totalExpense` mean bill, margin,
  or expense. **UNVERIFIED — needs a live `ls_events` query** (Supabase MCP unauthenticated in
  this session; no row counts or field presence could be read).
- OBSERVED: today's hub analytics honestly refuse to fabricate from this gap — "NOT COMPUTED:
  true fill rate / placements / submittal→offer … the UI shows '—' rather than a fabricated
  number" (`src/lib/hub/hub-analytics.ts:14-16`).

### F3. The Sisense tap ships LS's own aggregates — bill-side, no per-placement rates

- OBSERVED: `ims-ls-tap` (EC2 `ubuntu@54.145.175.182`, pm2, pulls every 360 min per memory
  `project_ims_locumsmart_sisense_tap_2026-06-08.md:13` — UNVERIFIED live) replays 19 JAQL
  KPI queries cookie-only against `analytics.locumsmart.net` and inserts one `LsKpis` JSON row
  per pull into `ims_ls_analytics` (`migrations/20260609_ims_ls_analytics.sql:15-26`;
  mapper `src/lib/hub/ls-analytics.ts:35-55,145-224`).
- OBSERVED (snapshot 2026-06-09, `ims-ls-tap/ims-kpis.json`): the KPIs are **aggregates
  only** — fill rate, bid acceptance, speed-to-bid, market share, TS/invoice reject rates,
  days-to-payment, `invoicedThisYear: 7,182,539.19`, `invoicedPrevYear: 8,391,223.64`, and
  `revenueBySpecialty`: CRNA $3,608,934.03 / Anesthesiology $2,606,171.16 / OB-Anesthesiology
  $1,615,094.07 / Adult-Cardiothoracic $321,903.51 / Peds-Anesthesiology $12,528.64.
  These are **invoiced (bill-side) dollars**, "LocumSmart's own computed numbers, surfaced
  verbatim (no re-derivation, no fabrication)" (`ls-analytics.ts:5-9`). Zero per-placement,
  per-rate-type rows flow through this tap.
- Load-bearing corollary for coverage: the revenue mix shows IMS's realized business is
  **anesthesia/CRNA-dominant** (5 of 5 revenue lines). Any internal-truth calibration will
  therefore be densest exactly where the sim's CRNA/anesthesia cells are — and empty for most
  of the other ~83 specialties in `SPECIALTIES`. Internal truth sharpens a few cells; it can
  never be the coverage story alone.

### F4. The per-placement BILL rates DO exist inside LocumSmart — recon-proven, schema built, writer never built

- OBSERVED (recon artifact, 222 JAQL bodies parsed from a real authenticated capture):
  `ias-dashboard/docs/locumsmart-recon/artifacts/sisense-cube-schemas.json` shows the
  Agreement cube's **`Fact_ProposedChanges`** carries per-CA rate axes:
  `RegularRate, OvertimeRate, TwentyFourHourCallRate, CallBackRate, NightlyCallRate,
  OrientationRate, HolidayRate` + `ActionTaken`/`ProposedDate`/`ResponseDate`; the Bid cube's
  **`Fact_BidRate`** carries `Rate` per `RateTypeId` + `BidAwarded`; `Fact_TimesheetLine`
  carries `SubmittedHours`/`ApprovedHours` + `Dimension_HourType`; `Fact_InvoiceLineItem`
  carries `TotalLineItemAmount` (+ `ProviderRegistryId` — PII flag). These are the exact comp
  axes the engine's static tables estimate (compare `CALL_RATE_DATA` comp models, map
  05 §2.1-2.2).
- OBSERVED: a complete Supabase schema for exactly this data was migrated in the dashboard
  repo on 2026-04-22 — `sisense_bids` (PK `(bid_id, rate_type_id)`, `rate NUMERIC`,
  `bid_awarded`), `sisense_bid_rate_history` (all 7 rate axes per CA amendment),
  `sisense_agreements`, `sisense_proposed_changes` (all 7 axes + accept/decline),
  `sisense_bid_market_masked` with a **k-anonymity CHECK
  (`distinct_token_count_in_partition >= 3`)** for masked competitor bids
  (`ias-dashboard/supabase/migrations/20260422173200_sisense_rs0.sql:40-150`).
  **UNVERIFIED whether this migration was ever applied to prod Supabase.**
- OBSERVED: the client that would fill those tables was never built — every module in
  `ias-dashboard/scripts/sisense/` (`orchestrator.ts`, `auth.ts`, `supabaseWriter.ts`,
  `queryBuilder.ts`, …) is a **10-byte stub**; only `db.ts`/`db.test.ts` (~750 B) have
  content.
- OBSERVED: the bridge is already defensively wired for this future writer:
  `CAP_CAPABLE_AGENT_IDS = {'sisense_rate_writer'}` quarantines any row from it that is
  mislabeled `value_type='market'`
  (`ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts:215-217,788-798`), and the
  architecture doc pre-commits the split `sisense_rate_market_writer` vs
  `sisense_rate_cap_writer` if a bivalent writer ever exists
  (`ias-dashboard/docs/rate-simulator/ARCHITECTURE.md:45-47`). `cap-rates` already has a
  write path in the bridge and **no live reader** (map 03 §4, S9).
- OBSERVED: the Partner API provides per-record enrichment + disaster recovery:
  `GET /ConfirmationAgreement/{CA#}` → `ConfirmationAgreementJsonDto`,
  `GET /ConfirmationAgreement/RateRequirements/{CA#}`, `GET /Invoice/{num}`,
  `GET /Timesheet/{num}`, and **webhook replay** endpoints
  (`POST /{Resource}Webhook/{Number}`) to backfill missed events
  (`ias-dashboard/docs/locumsmart-recon/20-endpoint-catalog.md:41-64`). No list endpoint —
  you must already know the numbers (which `ls_events` raw payloads supply).
- **Semantic caution (bill vs pay):** LocumSmart is the HCO-side VMS; IMS is the vendor. The
  CA/bid rate axes are the vendor↔HCO **contracted bill rates**, consistent with Zach's "we
  have the BILL rate" statement (F1). They are NOT physician pay. UNVERIFIED — confirm on a
  live CA record before labeling columns.

### F5. One real internal pay-adjacent observation exists on disk — exactly one

- OBSERVED: `ias-dashboard/docs/rate-simulator/hco-contract-caps-WORKSHEET.csv` (70 lines,
  one filled row): `Atrium Health, Wake Forest Baptist…, crna, max_bill 290, max_pay 250,
  pay_bill_ratio 0.862, source "Zach 2026-05-15 verbal", confidence high`. The header comment
  records the trigger: "Wake Forest Baptist CRNA $298 model vs $250 paid 2026-05-15" — i.e.,
  the sim over-quoted a real placement by ~19% because it didn't know the facility's
  contract cap. This is the entire current internal actual-paid corpus: **n=1, verbal**.
- OBSERVED: the engine's second internal-shaped feed — `liveCalibration.ts` per-HCO medians of
  `rateRequirements.maxRegular/maxOvertimeMultiplier/maxHolidayMultiplier/maxOrientation` +
  `insuranceProvidedBy` from the Partner-API job feed — is explicitly **bid ceilings, not
  paid rates** ("Every number … is a BID CEILING … NOT a market / winning rate";
  "observed OT multiplier caps run ~1.3× but actual closed OT is ~1.0-1.1×",
  `src/lib/rate-engine/liveCalibration.ts:9-14`), exported and consumed by **zero** hub
  modules (map 05 §2.10).

### F6. The engine's receiving slots for internal truth are already built and gated

- OBSERVED: `actual_paid_locum` is rank 4 (top) of `BUCKET_PRECEDENCE`
  (`src/lib/rate-engine/marketRates.ts:119-124`) and one of the only two members of
  `DEFAULT_ANCHORABLE_RATE_TYPES` (:419-422); the ladder comment names it rung 1
  (:385). The confidence ceiling maps market-typed rows (only) to `'high'` (:449-456). The
  producer enum has carried `actual_paid_locum` since D-11
  (`agent-sdk/shared/rate_type_classifier.py:59-67`) — but **no producer emits it today**
  (no source default or URL pattern maps to it; `rate_type_url_patterns.json` and
  `sources.py` contain zero `actual_paid` references; `gov_data_syncer` tests assert it never
  emits it, `agent-sdk/tests/test_gov_data_syncer.py:421`). The top rung is a well-guarded,
  permanently-empty seat.
- OBSERVED: the anchor gate requires `n_distinct ≥ 4` AND `≥ 2 distinct normalized
  source_families` (:473,498,505-512). **Design collision:** internal actuals are, by
  construction, ONE source family ("ims internal"). If internal rows were pushed through the
  existing bridge path, the ≥2-family quorum would block them forever — or worse, tempt
  someone to fake families. The internal rung needs its own explicit gate (R3).
- OBSERVED: the quote-vs-accepted loop already exists end-to-end on the consume side:
  `CalibrationEntry { specialty, state, rateMode, simulatedRate, acceptedRate, accuracy,
  submittedBy, notes, timestamp, quoteCapBound }` (:564-589); `loadSpecialtyCalibration`
  merges RTDB `rate-simulator/feedback` + localStorage, dedups, and computes an adjustment
  only when `recent.length >= 3 && |recentAvgRatio − 1| > 0.03`, dampened to 50% of observed
  bias and clamped to [0.85, 1.15] (:840-854); `applyCalibration` refuses below sampleSize 3
  (:870-877); `computeDisplayedRate` suppresses positive calibration on capped quotes so the
  loop can never leak margin upward (:933-955, "See feedback_never_reveal_margin.md").
  Call-daily vs hourly entries are separated by `rateMode` with a $1,000 magnitude floor for
  legacy rows (:562-609). **The node is empty and the hub is read-only** — the hub port
  explicitly deferred the Phase-2 feedback layer (`src/lib/hub/sim-adapter.ts:13-15`), and
  `docs/rate-simulator-IMPROVEMENT-PLAN.md:31` ranks instrumenting it as move #4/top-2. The
  dashboard's write-side pattern to port is
  `ias-dashboard/src/features/rate-simulator/components/FeedbackSection.tsx`.

### F7. Confidentiality boundaries are real and partially already violated-by-default if done naively

- OBSERVED: `ls_events` and `ims_ls_analytics` are RLS-on with **no public policy** and (for
  analytics) explicit `REVOKE ALL … FROM anon, authenticated`
  (`migrations/20260602_ls_events_table.sql:66-68`, `migrations/20260609_ims_ls_analytics.sql:30-36`).
  Good — internal dollars never reach a client surface from Supabase.
- OBSERVED: the RTDB tree the live sim reads (`rate-simulator/*`) is **public-READ by hub
  design** (map 03 §0 and S5; the write-rule audit is still the named open adversarial
  check). Therefore raw internal actuals must NEVER be written to `market-rates-v2` — a
  competitor or physician could read per-facility paid rates verbatim. Internal truth must
  either (a) live in a private tree/Supabase and influence the quote server-side at build/
  publish time, or (b) be pre-aggregated to k≥3 cells before touching any public-read node —
  the k-anonymity CHECK in `sisense_bid_market_masked` (F4) is the in-house precedent.
- OBSERVED: the engine already has the "calibrate, never reveal" discipline for exactly this
  reason: positive calibration is suppressed when the quote is cap-bound so accepted-rate
  feedback cannot walk a public quote up to a confidential contract cap
  (`marketRates.ts:900-955`; `types.ts:408-418`). The same one-way discipline (internal data
  may LOWER/clamp or re-center within cited bounds; it may not print itself) is the template
  for the bill-bound (F8).
- PII: `Fact_InvoiceLineItem.ProviderRegistryId` and provider dimensions (F4) identify
  individual physicians. Any internal registry must strip/HMAC provider identity before it
  leaves the ingest boundary.

### F8. The designed calibration loop (synthesis)

Assembled from what exists, the internal-truth loop that fits this codebase is:

```
CAPTURE (new, tiny)                         BILL REGISTRY (backfillable)
 hub FeedbackSection port                    ls_events raw_payload re-extract
 1 row per quote:                            (confirmationAgreementId, totalMarkup/
 {simulatedRate, quoteCapBound,               totalExpense) + Partner-API per-CA
  acceptedRate, specialty, state,             enrichment (+ CA CSV export backfill)
  rateMode, submittedBy, ts}                  → sisense_* tables (RS-0 schema)
        │                                            │
        ▼                                            ▼
 PRIVATE store (Supabase RLS-on, or auth-      bill-side posterior per cell
 gated RTDB path — NOT public-read tree)       (aggregateCell reused; MAD+IVW)
        │                                            │
        ├── quote-vs-paid delta KPI  ◄───────────────┤
        │   (avgDelta / avgAccuracy per cell,        │
        │    alert on |delta| > threshold            │
        │    or promotions 6→0)                      │
        ▼                                            ▼
 internal rung of the trust ladder:            bill-bound backstop:
 actual_paid_locum cell, own gate              pay_quote ≤ bill_cell × pay/bill ratio
 (n≥3 internal obs, k≥3 anonymity,             (one-way clamp DOWN only; ratio from
  shrink toward curated prior below n)          observed data, e.g. 0.862 Atrium, not
        │                                       the 0.80 convention)
        ▼
 blends ABOVE advertised-pay in precedence (rank 4 already reserved);
 public quote shows the blended band + percentile, NEVER the internal observation
```

Small-n discipline is already codified three times and should be reused, not reinvented:
anchor gate n≥4 (`marketRates.ts:498`), calibration n≥3 + 50% damp + ±15% clamp
(:849-853,875), and `aggregateCell`'s single_source/zero_spread/bimodal honesty labels
(`cellAggregation.ts:286-411`, map 03 §3.6). One placement mathematically cannot swing a
cell through any of these gates.

### F9. Bill-vs-pay spread: the one ratio the whole loop hinges on

- CONVENTION (internal, uncited as market fact): `bill = pay / 0.80` hourly invariant
  (`rateCalculator.ts:716`, also cap×0.80 pay ceiling :690-691, call-only daily
  `roundUp5(pay/0.80)` at `sim-adapter.ts:318-321`); hub Target-margin slider default 22%,
  clamped 0-95 (`sim-adapter.ts:49,298-301`).
- OBSERVED (n=1 internal): Atrium pay/bill = 0.862 (F5).
- ESTIMATED (spec): the redesign spec's derived-bill formula used margin default **0.35**
  "clustered 30-50% across two independent sources"
  (`2026-06-01-accuracy-redesign-spec.md:54`) — note this is a *different* number than the
  engine's 0.80 pay/bill (=20% margin). The codebase currently carries **three inconsistent
  margin conventions** (20%, 22%, 35%).
- EXTERNAL (search-level, UNVERIFIED — needs source-by-source confirmation): public sources
  put general staffing markups at ~30-75% and locum agency margins ~20-50%, with one locum
  platform self-reporting 15-22% ([The Resource Co. staffing markup report](https://www.theresource.com/2025/10/27/average-staffing-agency-markup-in-2025/),
  [locums.one — How Locums Pricing Works](https://locums.one/blog/how-locums-pricing-works),
  [Physician Side Gigs — agency cut](https://www.physiciansidegigs.com/how-much-money-locums-company-makes-from-physicians),
  [Imperial Locum — profit margin](https://imperiallocum.com/blog/what-is-the-profit-margin-for-locum-tenens/)).
  The honest position: the pay↔bill ratio is a **per-HCO learned parameter** (the worksheet's
  `pay_bill_ratio` column is exactly right), not a universal constant.

---

## Recommendations

Each tagged [impact / effort].

- **R1 — Port the feedback writer to the hub and make capture a by-product of closing.**
  [impact: HIGH / effort: LOW] Port `FeedbackSection` (dashboard) into the hub sim; write
  `CalibrationEntry` rows (schema already final, `marketRates.ts:564-589`) including
  `quoteCapBound`; log one event per rendered quote so the denominator (quotes shown) exists,
  not just accepted outcomes. Store to a **private** path (Supabase RLS-on table mirroring
  the entry shape, or an auth-write RTDB path) — NOT the public-read tree. The consume side
  (`loadSpecialtyCalibration` → `computeDisplayedRate`) turns on automatically at n≥3 per
  specialty×rateMode. This is improvement-plan Move #4 verbatim (`IMPROVEMENT-PLAN.md:31,68`).

- **R2 — Build the bill registry from data IMS already receives.** [impact: HIGH / effort:
  MEDIUM] Two-step: (1) re-extract `confirmationAgreementId` + `totalMarkup`/`totalExpense`
  from `ls_events.raw_payload` (pure function + backfill query — the log is lossless by
  design, `locumsmart-events-logic.ts:15-19`), after Zach answers the 3 LS-semantics
  questions (`2026-06-08 spec :167`); (2) enrich per CA via Partner API
  `/ConfirmationAgreement/{num}` + `/RateRequirements/{CA#}` into the already-migrated RS-0
  tables (`sisense_agreements`/`sisense_proposed_changes` hold all 7 rate axes). Use the CA
  CSV export for pre-webhook history (the real "138-placement registry", bill-side, labeled
  as bill). Do NOT build the full Sisense JAQL daemon first — the webhook+Partner-API path is
  the robust tier (2026-06-08 spec §6 robustness ranking).

- **R3 — Specify the internal rung of the trust ladder explicitly (do not reuse the market
  gate).** [impact: HIGH / effort: MEDIUM] Internal actuals are one corporate family, so the
  ≥2-family quorum must NOT apply; instead: dedicated agent id (`ims_actuals_writer`,
  following the `sisense_rate_writer` allowlist pattern and the one-type-per-agent contract,
  `ARCHITECTURE.md:45-47`), `rate_type='actual_paid_locum'`,
  `evidence_employment_arrangement` set, own gate = **n≥3 distinct placements per cell
  within the freshness window, k≥3 distinct providers/facilities (anonymity), shrink toward
  the curated prior below the gate** (never a raw swap). Blend with the market posterior by
  inverse variance — `aggregateCell` needs zero math changes (D-33). Decide explicitly
  whether internal cells anchor at state level (they are the first data with real states —
  today every live bucket is `'national'`, map 03 S7).

- **R4 — Wire the bill-bound backstop as a one-way clamp.** [impact: MEDIUM-HIGH / effort:
  LOW-MEDIUM once R2 lands] `pay_quote ≤ bill_cell × pay/bill_ratio(HCO)` with the ratio
  learned per HCO (seed: Atrium 0.862; default: engine 0.80 labeled as convention). Clamp
  DOWN only, matching the engine's existing "math only lowers toward a documented bound"
  discipline (deep-research brief B6, `docs/rate-simulator-deep-research-brief.md:1267`).
  Surfaces the Wake-Forest class of over-quote (F5) systematically.

- **R5 — Make quote-vs-subsequently-paid delta the standing accuracy KPI + drift alarm.**
  [impact: HIGH / effort: LOW] The fields already exist (`accuracy`, `avgDelta`,
  `sampleSize` in `SpecialtyCalibration`, `marketRates.ts:665-671,834-861`). Add: a per-cell
  scoreboard (median |simulated−accepted|/accepted), a weekly digest, and two alerts —
  (a) |avgDelta| > threshold for n≥5 cells (drift), (b) live-anchor promotions dropping to 0
  (the invisible 7-day-cliff failure, map 03 S11). Piggyback on `bridge_runs`-style telemetry
  invariants rather than inventing a new channel.

- **R6 — Fix the operational pay-documentation gap at the source.** [impact: HIGHEST
  long-term / effort: MEDIUM (org change, not code)] The reason no pay truth exists is that
  final pay changes and "we don't document that" (F1). Whatever runs the weekly pay cycle
  holds the real number — a per-placement, per-week `(placement, week, paid_rate, hours,
  rate_axis)` export into the same private store closes the loop without asking recruiters
  to type anything. UNVERIFIED what the payroll system is — first step is naming it.

- **R7 — Reconcile the three margin conventions.** [impact: MEDIUM / effort: LOW] 0.80
  engine invariant vs 22% hub default vs 0.35 spec derivation (F9) — pick one labeled
  convention, expose the per-HCO learned ratio where known, and show recruiters BOTH sides
  (pay + bill + margin) with provenance labels. Recruiters price deals on the spread; a
  hidden hardcoded ratio is a silent mispricing on every quote where the true ratio is 0.86.

- **R8 — Confidentiality contract before any wiring.** [impact: HIGH (risk-avoidance) /
  effort: LOW] Write the rule down in the engine docs: internal actuals may (a) anchor a
  posterior, (b) clamp a quote, (c) set a confidence label — they may NEVER appear verbatim
  in a public quote surface, error message, or public-read RTDB node; provider identity is
  HMAC'd at ingest; per-HCO caps render only as "contract cap applied", never the number
  (existing precedent: `feedback_never_reveal_margin.md` discipline at
  `marketRates.ts:933`). Pair with the still-open RTDB write-rules audit (map 03 S5).

Sequencing note: R1 + R5 are independent of LocumSmart semantics and can ship first; R2→R4
are one chain gated on Zach's three LS-semantic answers; R3 and R8 are design docs that
should land before any writer writes a row.

---

## Open questions

1. **Do Timesheet/Invoice events actually flow today, and at what volume?** Requires
   `SELECT event_type, count(*) FROM ls_events GROUP BY 1` + raw_payload inspection of one
   timesheet and one invoice event (Supabase MCP was unauthenticated this session). The
   2026-06-25 memory says they land as `event_type:'unknown'`; the 2026-06-08 spec says they
   carry `confirmationAgreementId`/`totalMarkup`/`totalExpense`. Both are secondhand.
2. **The 3 LS-semantics questions** (spec :167): distinct `confirmationAgreementId` ≡ one
   placement? fill-rate denominator? `totalMarkup`/`totalExpense` = bill vs margin vs
   expense? Blocking R2/R4 labeling.
3. **Are the Fact_ProposedChanges rate axes bill-to-HCO or something else?** Confirm against
   one real CA record via Partner API before schema labeling (F4 caution).
4. **Was the RS-0 migration (`20260422173200_sisense_rs0.sql`) ever applied to prod
   Supabase?** Tables may or may not exist; the writer certainly doesn't.
5. **Where does final physician pay live operationally** (payroll provider? spreadsheet?
   recruiter email)? Names the R6 export source. Also: does the weekly pay cadence mean pay
   can change mid-placement — i.e., is "actual paid" a time series per placement, not a
   scalar?
6. **RTDB security rules for `rate-simulator/*`** — is `feedback` (or any node) writable by
   non-admin credentials? (Map 03 S5 names this the highest-leverage adversarial check; it
   becomes critical the moment feedback rows influence quotes.)
7. **Recruiter attribution** — `ls_events.recruiter` is still always null
   (`locumsmart-events-logic.ts:186-187`); does any LS payload attribute an owner? Needed for
   per-recruiter accuracy scoreboards (and gaming detection on self-reported acceptedRate).
8. **How many historical CAs exist** (the "~138" figure) and does the CA CSV export carry
   the rate axes or only counts/parties? Determines how much bill history is backfillable
   without the Sisense daemon.
9. **Cross-check risk:** self-reported `acceptedRate` (R1) vs LS bill × ratio (R4) will
   disagree sometimes — define which wins and how disagreement is surfaced (proposal: neither
   wins; disagreement > X% flags the cell `manual_review`, mirroring the bimodal-honesty
   pattern in `cellAggregation.ts`).

---

## Fact-check queue (every $ / behavioral claim asserted above)

See `claims_to_verify` in the structured output; the load-bearing ones: the Zach bill-vs-pay
quote (doc-cited, verbal origin); Timesheets/Invoices in the live webhook subscription;
`confirmationAgreementId`/`totalMarkup`/`totalExpense` presence + meaning; tap cadence
(6h) and pm2 liveness; invoiced YTD $7.18M / $8.39M and the per-specialty revenue figures
(internal snapshot 2026-06-09, staleness unknown); Atrium 290/250/0.862 (verbal, n=1);
RS-0 prod application; external margin ranges (search-level only); RTDB public-read +
write-rule status; `rate-simulator/feedback` emptiness as of today.
