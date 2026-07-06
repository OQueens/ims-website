# Map 05 — Compensation Factors: How They Are (and Are Not) Modeled Today

> Deep-dive map, 2026-07-02. Scope: the LIVE rate simulator (imstaffing.ai/hub) served by
> `ias-website` — engine `src/lib/rate-engine/`, hub adapter `src/lib/hub/` — plus the
> still-live data pipeline: scraper `agent-sdk/agents/rate_scraper/` and bridge
> `ias-dashboard/scripts/data-refresh/`. All paths below are relative to those roots unless
> absolute. The `ias-dashboard/src/features/rate-simulator` engine is a DEAD legacy copy
> (topology confirmed 2026-07-02) and is referenced only as divergence risk.
>
> Legend — **FIRST-CLASS** = a typed factor that changes quote math or is an explicit modeled
> surface. **PARTIAL** = represented somewhere (type/table/parse) but not wired into the live
> quote, or modeled on only one of the two quote paths. **IGNORED** = no representation, or
> actively rejected as noise.

---

## 0. Executive scorecard

| Comp factor | Status | Where it lives (or dies) |
|---|---|---|
| Call pay — comp-model typing (beeper vs worked-day vs callback) | **FIRST-CLASS (static only)** | `rate-engine/types.ts:229-286`, `rate-engine/callRates.ts:34-353`, `rate-engine/rateCalculator.ts:766-875` |
| Call pay — "has call" on an hourly assignment | **PARTIAL (flat 1.10×)** | `rate-engine/rateCalculator.ts:673` |
| Gratis / included hours | **PARTIAL (display-only)** | `rate-engine/callRates.ts` (`gratisHrs`), `rate-engine/rateCalculator.ts:834,857` — carried, never priced |
| Callback differential ($/hr after gratis) | **PARTIAL (display-only)** | `rate-engine/rateCalculator.ts:831-833` — band surfaced, never multiplied into pay |
| Travel/housing stipends (GSA per-diem) | **PARTIAL (dead code in live hub)** | `rate-engine/callRates.ts:378-404`, `rate-engine/rateCalculator.ts:643-653` — zero consumers in `src/lib/hub` |
| Sign-on / completion bonuses | **IGNORED (actively filtered as noise)** | `rate_scraper/card_extractor.py:88-89`; no engine type at all |
| Malpractice coverage | **PARTIAL (one dormant field)** | `rate-engine/liveCalibration.ts:40,56` (`insuranceProvidedBy`) — unused by hub |
| CME allowance | **IGNORED (zero hits)** | no occurrence in any of the 3 repos' rate code |
| Per-diem daily rates (call-only $/day) | **FIRST-CLASS (static only)** | same as call pay; `hub/sim-adapter.ts:312-351`, `hub/sim-render.ts:98-129` |
| W2 vs 1099 arrangement | **PARTIAL (3 unlinked layers; no UI control)** | scraper `rate_type` enum; `rate-engine/blsSanityCheck.ts:73-89`; `rate-engine/crnaCellLookup.ts:49-53,653-659` |
| RVU / production comp | **IGNORED (actively rejected)** | `rate_scraper/card_extractor.py:40,69-70`; no engine representation |
| Daily/shift vs hourly units | **PARTIAL (typed but DAY dropped from live pipeline)** | `rate_scraper/agent.py:450,491-493`; `rate-engine/marketRates.ts:562-609` |
| Holiday coverage | **FIRST-CLASS (hourly path)** | `rate-engine/rateCalculator.ts:360-434,675`; `rate-engine/multipliers.ts:18` |
| Overtime / orientation rate caps | **PARTIAL (dormant observed-caps layer)** | `rate-engine/liveCalibration.ts:32-37` — exported, unconsumed by hub |

---

## 1. Data flow — where a comp signal can enter, and where each factor drops out

```
 (A) STATIC CURATED TABLES (analyst-cited)
     specialties.ts  — hourly min/max/p70 per ~88 specialties ("HOURLY PAY rates for
                       locum tenens assignments (not permanent employment)", specialties.ts:16)
     callRates.ts    — CALL_RATE_DATA per-day-type daily bands + compModel + coverageHrs
                       + gratisHrs + callback band (cite-or-suppress; null = insufficient)
     multipliers.ts  — SHIFT_MULT / FACILITY_MULT / DURATION_MULT
     stateData.ts    — STATE_MULT geo multipliers
                         │
 (B) LIVE PIPELINE (hourly-only)                         │
     rate_scraper (agent-sdk)                            │
       card_extractor.py / jsonld_parser.py              │
         → unit gate: HOUR or DAY only; YEAR/WEEK/       │
           MONTH/RVU rejected (jsonld_parser.py:17,      │
           30-40; card_extractor.py:37-42,68-70)         │
       agent.py posting path                             │
         → SECOND gate: `unit != "HOUR"` → row DROPPED   │
           (agent.py:450,491-493) — DAY never inserted   │
       → Supabase rate_intelligence (hourly rows,        │
         rate_type ∈ 7-value enum,                       │
         shared/rate_type_classifier.py:59-67)           │
     bridge (ias-dashboard/scripts/data-refresh)         │
       → variance-weighted robust posterior per          │
         (specialty | national | rate_type) cell         │
       → RTDB rate-simulator/market-rates-v2             │
                         │                               │
 (C) LIVE HUB QUOTE (imstaffing.ai/hub)                  │
     hub/sim-live.ts:43-50 → loadMarketBucketRates()     │
       → marketRates.ts applyMarketBucketsOverlay        │
         (market-typed posterior, n≥4 + ≥2 families,     │
         anchors SPECIALTIES p70; marketRates.ts:469-551)│
     hub/sim-adapter.ts quoteFromFactors ────────────────┘
       hourly path  → calculateRate (multiplier chain, rateCalculator.ts:656-726)
       call-only    → calculateCallRate (STATIC bands ONLY — the live overlay
                      mutates SPECIALTIES hourly bands, never CALL_RATE_DATA)
```

**Load-bearing consequence:** every factor that is not "hourly base rate" gets ZERO live
corroboration. The DAY-unit drop at `agent.py:491-493` (counter
`_POSTING_UNIT_UNSUPPORTED_COUNTER`, `agent.py:450`) means call-only daily stipends — the
comp model with the highest dollar variance — are priced exclusively from the static
`CALL_RATE_DATA` table, whose research snapshot is the 2026-06-03 deep-research PDF
(`callRates.ts:4-7`). The comment at `agent.py:492-493` says a "DAY→hourly conversion is a
deliberate fleet-phase decision" — i.e., a known deferral, not an oversight.

---

## 2. Factor-by-factor detail

### 2.1 Call pay (beeper / in-house / worked-day) — FIRST-CLASS type system, static data, split brain

**The good part (best-modeled factor in the engine):**
- `CallCompModel` = `'worked-day-clinic' | '24hr-beeper-call' | 'mixed' | 'unknown'`
  (`types.ts:229-233`), with the explicit doctrine that these are NOT interchangeable and
  must never be mixed (`types.ts:222-228`, `callRates.ts:13-16`).
- Each `CallRateBand` carries `{min, max, typical, compModel, coverageHrs}` (`types.ts:244-250`);
  `coverageHrs` (24 for beeper, scheduled shift for worked-day) is the honest $/hr divisor
  (`rateCalculator.ts:811-812`, rendered at `hub/sim-render.ts:124`).
- Per-specialty entries in `CALL_RATE_DATA` (`callRates.ts:34-353`) are cite-or-suppress:
  e.g. neurosurgery beeper(4200, 4800, 4500) cited to Lancesoft OH + Ascend AR locum_1099
  DocCafe postings (`callRates.ts:73-82`, OBSERVED, adversarially verified per note);
  anesthesiology worked-day band cited to Aya / Bright Line / AnesthesiaOnCall
  (`callRates.ts:139-146`). Specialties with no public disclosure carry `null` bands +
  `sources: 0` and render the "insufficient public data" surface
  (`rateCalculator.ts:790-805`, `hub/sim-render.ts:107-113`) — no fabrication.
- Call-only detection from PDFs/freetext is real: `detectCallOnly` (`rateCalculator.ts:572-603`)
  distinguishes explicit "Call Only" fields, beeper/home-call WITHOUT scheduled clinical
  hours, and 24-hr coverage without clinical duties. Day-type (weekday/weekend/holiday)
  resolution: `inferDayType` (`rateCalculator.ts:444-501`).

**The split brain:** on the HOURLY path, call is a boolean 1.10× multiplier —
`const callMult = f.call.hasCall ? 1.10 : 1.0` (`rateCalculator.ts:673`), detected by
`hasCall()` (`rateCalculator.ts:323-337`). So "shared call 1:4" and "q2 in-house call" price
identically (+10%), and the hub's manual controls hard-code `call: { hasCall: false }`
(`hub/sim-adapter.ts:141`) — a recruiter using the manual sim cannot express call burden at
all; only the PDF/freetext path can trip it. The 1.10× figure has no inline citation
(UNVERIFIED — needs a source; `RATE_SOURCES.shift` at `callRates.ts:411` is the closest
provenance pointer).

**Coverage math gaps (call-only path):**
- `calculateCallRate` applies geo × facility × duration to the daily `typical`, clamped to
  the researched band `max` (`rateCalculator.ts:780-798`) — but NOT shift/call/holiday
  (baked into per-day-type bands, `types.ts:381-388`).
- Weekend/holiday bands are null for most specialties (holiday band is null for nearly every
  entry in `CALL_RATE_DATA`), so a holiday call-only quote usually lands on the honest
  "insufficient" card rather than a number.

### 2.2 Gratis hours & callback — PARTIAL: carried faithfully, priced never

- `gratisHrs` per specialty (`callRates.ts` entries; e.g. neurosurgery 4 — `callRates.ts:78`,
  GI 4 — `callRates.ts:245`, cardiology 10 — `callRates.ts:235`) and per-assignment override
  `detectIncludedHours` (`rateCalculator.ts:606-618`), merged at `initFactors`
  (`rateCalculator.ts:906`) and in `calculateCallRate` (`rateCalculator.ts:834`).
- Callback band ($/hr) per specialty, e.g. general surgery {325, 350} (`callRates.ts:59`),
  neurosurgery {475, 475} (`callRates.ts:77`); deliberately NOT geo-scaled because it is a
  cited flat contract rate (`rateCalculator.ts:826-830`).
- **BUT: neither field affects any dollar output.** `includedHrs` and `callbackRate` are
  returned on `CalculatedCallRate` (`rateCalculator.ts:857`) purely as display context. The
  daily stipend is not adjusted for expected callback hours; total-comp for a call day
  (stipend + callback hours × callback rate) is never computed. The old gratis-hour divisor
  was intentionally removed as dishonest (`types.ts:345-348`), but nothing replaced it with
  an expected-utilization model. A recruiter pricing a busy 24-hr call (4 gratis + say 6
  callback hrs) sees the same number as a quiet one.

### 2.3 Stipends: travel / housing (GSA per-diem) — PARTIAL: data shipped, surface dead

- FY2026 GSA tables exist: `GSA_STANDARD = { lodging: 110, mie: 68, total: 178 }`
  (`callRates.ts:379`) + ~120 city overrides (`callRates.ts:381-404`), cited to
  "GSA Per Diem Rates FY2026" (`callRates.ts:413`). Lookup: `lookupGsa()` keyed on facility
  city/state then nearest-airport (`rateCalculator.ts:643-653`).
- **No consumer in the live hub.** `GSA_STANDARD` is exported from the barrel
  (`rate-engine/index.ts:30`) but grep over `src/lib/hub` finds zero references to
  `lookupGsa`/`GsaRates`/lodging/M&IE. The dashboard's old UI surfaced it; the hub port did
  not. So today the live simulator quotes pay + bill with no travel/housing/M&IE line at
  all — the quote is "rate-only" and the all-in cost to the facility (or the effective
  value to the physician) is understated by the entire stipend.
- On the intake side, the PDF parser captures a "Call & Travel" section verbatim
  (`parser.ts:167,191`) — its items feed keyword inference (shift/call detection) but no
  travel-comp extraction exists (no mileage/airfare/housing parsing).
- The scraper actively REJECTS weekly stipend figures to protect the hourly band —
  `_DOLLAR_REJECT_UNIT` drops any posting where a $-amount is attached to
  week/month/year/RVU next to an hourly rate (`card_extractor.py:37-42,95-103`). Correct
  for anti-poisoning, but it also means stipend intelligence is discarded rather than
  captured into a separate field.

### 2.4 Sign-on / completion bonuses — IGNORED by design

- Only mention in all three repos: the extractor docstring — "drops out-of-band noise (a
  '$5,000 sign-on bonus' next to a '$325/hr' rate won't poison the range, since 5000 is
  outside the hourly band)" (`card_extractor.py:88-90`). Bonuses are filtered via the
  hourly magnitude band ($60–$900, `card_extractor.py:72`), not even recognized as a
  bonus concept.
- No engine type, no factor, no UI. For locums, completion bonuses on long assignments and
  sign-ons on hard-to-fill specialties are real negotiation levers with dollar impact —
  currently invisible to the quote and to the market-position story.

### 2.5 Malpractice / CME — near-total gaps

- **Malpractice:** the ONLY representation is `insuranceProvidedBy?: string` on
  `EnrichedJob` (`liveCalibration.ts:40`) surfacing into `HcoProfile.insuranceProvidedBy`
  (`liveCalibration.ts:56`) — an observed-caps display layer ("Every number ... is a BID
  CEILING from rateRequirements.max* — NOT a market / winning rate",
  `liveCalibration.ts:9-13`). Exported (`rate-engine/index.ts:36`) but **no hub module
  consumes `observedHcoProfile`** (grep: only the barrel export). Whether malpractice is
  agency-provided vs facility-provided (a real $/hr-equivalent difference on a 1099
  engagement) never touches rate math.
- **CME:** zero occurrences of "CME" in `rate-engine`, `hub`, or `rate_scraper`. IGNORED.

### 2.6 Per-diem (call-only daily) — FIRST-CLASS surface; note the vocabulary collision

- The call-only quote path is a genuine per-diem model: daily stipend hero, comp-model
  label, coverage-hours divisor, fixed 20% call margin (`hub/sim-adapter.ts:312-351`,
  `hub/sim-render.ts:98-129`). The bill on call-only uses `roundUp5(pay/0.80)` — "NOT the
  hourly Target-margin slider ... per-diem economics use call markup bands"
  (`hub/sim-adapter.ts:318-321`). The claim that call margins should be fixed at 20% is a
  ported dashboard convention (RateResults.tsx:236 per comment), not a cited market fact —
  UNVERIFIED as market practice.
- **Naming hazard:** "per diem" means the call-only daily stipend in
  `rateCalculator.ts:755`/`callRates.ts:3` but means GSA travel lodging+M&IE in
  `callRates.ts:378`. Two unrelated comp concepts share a name in the same file.

### 2.7 W2 vs 1099 — three real but unlinked layers, no user-facing control

1. **Scraper/bridge layer (live, guarding the funnel):** 7-value `rate_type` enum —
   `actual_paid_locum, advertised_clinician_pay, agency_bill_rate, permanent_wage_proxy,
   scraped_article_estimate, crowd_survey, aggregator_estimate`
   (`agent-sdk/shared/rate_type_classifier.py:59-67,79-86`). `permanent_wage_proxy` (W2
   salary sources: Doximity/Medscape/MGMA URL overrides retained,
   `rate_scraper/sources.py:215-222`) can NEVER anchor a quote — it is absent from
   `BUCKET_PRECEDENCE` (`marketRates.ts:119-124`) and from `DEFAULT_ANCHORABLE_RATE_TYPES`
   (`marketRates.ts:419-422`). Unit gates kill annualized W2 numbers at parse time
   (`jsonld_parser.py:17,30-40`; `card_extractor.py:68-70`). Posting sources carry
   `evidence_employment_arrangement: "locum_tenens"` (`posting_sources.py:108,129,145,169`).
   This layer is about EXCLUDING W2, not modeling it.
2. **BLS sanity layer (engine, cross-check only):** `LOCUM_MULTIPLIER` per SOC family
   (`blsSanityCheck.ts:73-89`) — e.g. PHYSICIAN_HOSPITALIST 2.45, ANESTHESIA_APP 3.50,
   SURGEON_CORE 1.70 — converts BLS W2 wages into locum-plausibility ceilings. Explicitly
   self-labeled "observation-derived midpoints, NOT primary-source-cited"
   (`blsSanityCheck.ts:70-72`) — ESTIMATED, low confidence. Arrangement parameter defaults
   to `'locum_w2'` "(IAS booking convention)" (`blsSanityCheck.ts:298,419`).
3. **CRNA arrangement layer (engine, dormant in hub):** full arrangement enum
   `w2_employee | 1099_independent | locum_w2 | locum_1099 | locum_general`
   (`crnaCellLookup.ts:49-53`), cell IDs like `"crna|TX|locum_1099"`
   (`cellAggregation.ts:14,72`), and fallback arrangement multipliers
   `{w2_employee: 1.0, 1099_independent: 1.6, locum_w2: 1.4, locum_1099: 1.7}`
   (`crnaCellLookup.ts:653-659`, cited to lokumapp band ratios + B.7-AANA.md §5.2 —
   ESTIMATED, needs verification). **This never runs in the live hub:** Supabase is
   "intentionally NOT injected" into the sim (`hub/sim-live.ts:19-23`).

**Net:** the LIVE quote is implicitly a locum rate (asserted at `specialties.ts:16`), but
there is no W2-locum vs 1099-locum toggle anywhere in the hub sim, despite the engine
having a working arrangement vocabulary for CRNA. Also note `RateObservation` makes
`isLocum: true` a compile-time invariant with a required `employmentEvidenceSpan`
(`rateObservation.ts:38-46`) — the strongest anti-W2-contamination design in the codebase,
currently used by the fleet/verify path, not the hub quote.

### 2.8 RVU / daily / shift vs hourly — hourly is the only live currency

- **RVU:** rejected as a unit everywhere it could enter (`card_extractor.py:24-28` unit
  regex includes wrvu/rvu only so it can be REJECTED via `_REJECT_UNIT_WORDS`,
  `card_extractor.py:69-70`; `_DOLLAR_REJECT_UNIT` `card_extractor.py:40`). No engine
  concept of production-based comp. For locums this is rarer than for perm, but IR/rad and
  some hospitalist locum contracts do quote $/wRVU — currently unquotable and uncapturable.
- **Daily/shift:** typed end-to-end (`unit: 'HOUR'|'DAY'` from both extractors;
  `_DAILY_MIN/_DAILY_MAX = 400/12000` bands `jsonld_parser.py:40`,
  `card_extractor.py:73`) but dropped before persistence (`agent.py:491-493`). Inside the
  engine, daily exists only on the call-only path. There is no "worked shift rate" quote
  for a NON-call daily posting (e.g. a $3,300/12-hr worked day would be quotable only if
  the assignment is classified call-only).
- **Calibration entries** are mode-aware: `rateMode?: 'hourly' | 'call_daily'`
  (`marketRates.ts:562-588`) with a $1,000 magnitude floor to classify legacy rows
  (`LEGACY_CALL_DAILY_FLOOR`, `marketRates.ts:591-609`; rationale "hourly rates top out
  around $400-425/hr ... daily call stipends start ~$1000" cited to Locumstory 2025 /
  CompHealth — worth re-verifying as markets move).

### 2.9 Shift / holiday / facility / duration (context factors that DO price)

- `SHIFT_MULT`: day 1.00 / night 1.20 / weekend_day 1.15 / weekend_night 1.30 / holiday 1.35
  (`multipliers.ts:13-19`; comment cites CompHealth/Weatherby ranges + nocturnist deltas —
  ESTIMATED band midpoints).
- Holiday is properly split: `hasHoliday` (worked → 1.10× toggle unless shift already
  'holiday') vs `holidayAllowed` (PTO eligibility, no multiplier) —
  `rateCalculator.ts:339-434,675`; a hard-won anti-false-premium fix.
- `FACILITY_MULT` 12 settings (academic 0.85 … CAH 1.22, rural_trauma 1.30, telehealth 0.75,
  `multipliers.ts:23-36`) — ESTIMATED, sourced collectively via `RATE_SOURCES.facility`
  (`callRates.ts:412`).
- `DURATION_MULT` emergency 1.20 / short 1.10 / standard 1.00 / long 0.95
  (`multipliers.ts:39-44`) — ESTIMATED.
- Rural was deliberately neutralized to 1.0 (double-counted inside STATE_MULT;
  `rateCalculator.ts:660-669`) — a good example of the engine removing a fabricated premium.
- Combined-multiplier ceiling 1.75× + researched-range ceiling `spec.max`
  (`rateCalculator.ts:677-707`) bound every hourly quote.

### 2.10 Bonus finding — an unused observed comp-structure feed already exists

`liveCalibration.ts` (RS-1) computes per-HCO / per-specialty medians of
`rateRequirements.maxRegular / maxOvertimeMultiplier / maxHolidayMultiplier /
maxOrientation`, `vendorCount`, `estimatedCredentialingTime`, `insuranceProvidedBy`
(`liveCalibration.ts:23-69,180-243`) from the LocumSmart Partner-API job feed. That is
OBSERVED (bid-ceiling) data about overtime multipliers, holiday multipliers, orientation
rates and malpractice provision — exactly the comp factors the static tables estimate — and
the hub consumes none of it (grep: exported at `rate-engine/index.ts:36`, zero hub call
sites).

---

## 3. Seams & smells (coupling, duplication, risk)

1. **Hourly-only live pipeline vs daily-priced call market.** The single biggest structural
   gap: `agent.py:491-493` drops every DAY observation, so `CALL_RATE_DATA` (many bands
   single-source, `sources: 0/1/2` entries throughout `callRates.ts`) can only decay. The
   overlay (`applyMarketBucketsOverlay`) mutates hourly `SPECIALTIES` only — there is no
   call-band overlay path even designed.
2. **Display-only comp fields masquerading as modeled.** `gratisHrs`, `callbackRate`,
   `includedHrs` ride the full type system and renderer but change no dollar. A reader of
   `RateFactors` (`types.ts:187-202`) would reasonably assume `includedHours`/`callbackRate`
   price something; they don't (`rateCalculator.ts:836-874` returns them untransformed).
3. **GSA per-diem is dead weight with a currency risk.** FY2026 hardcoded table
   (`callRates.ts:381-404`) will silently go stale; nothing consumes it in the live hub, so
   it is simultaneously unused AND a future wrong-number source if wired in without a
   refresh mechanism.
4. **Two margin models for bill rate.** Hourly uses the 15–45% slider
   (`hub/sim-adapter.ts:389-413`); call-only pins 20% (`hub/sim-adapter.ts:318-321`). The
   20% call floor is a ported convention, uncited.
5. **W2/1099 knowledge is fragmented across three layers that never meet.** The scraper
   excludes W2; blsSanityCheck multiplies W2→locum for sanity floors; crnaCellLookup has a
   real arrangement model — but the quote surface exposes none of it, and the CRNA/Supabase
   path is explicitly disconnected in the hub (`hub/sim-live.ts:19-23`). A future
   "1099 vs W2-locum" toggle would have to reconcile three different multiplier
   vocabularies (LOCUM_MULTIPLIER per SOC family vs FALLBACK arrangement multipliers vs
   rate_type exclusion).
6. **`hasCall` (hourly) vs `callOnly` (daily) is a cliff, not a dial.** An assignment with
   heavy call attached to clinical shifts gets exactly +10%; one classified call-only jumps
   to a completely different math and data table. Misclassification at
   `detectCallOnly` flips the quote between regimes.
7. **Vendored duplication:** every engine file is stamped "VENDORED — DO NOT EDIT.
   Canonical source: ias-dashboard" (`rateCalculator.ts:1-2` et al.) while the dashboard app
   is dead. Parity is test-gated (`hub/rate-engine-parity.test.ts`) but the "canonical"
   pointer now points at a retired surface — an inversion waiting to confuse a future
   editor.
8. **Bonus/stipend signals are destroyed, not diverted.** The extractor's anti-poisoning
   filters are correct for the hourly band but discard the very fields (weekly stipend $,
   sign-on $) that a comp-factor expansion would need; capturing them into side-channel
   fields at parse time would be nearly free while the pages are already fetched.
9. **Vocabulary collisions:** "per diem" (call stipend vs GSA travel), "cap"
   (PDF bill-rate cap vs 1.75× multiplier ceiling vs researched-range ceiling vs IronDome
   plausibility band) — four distinct clamp mechanisms coexist in `calculateRate`/
   `calculateCallRate` (`rateCalculator.ts:677-707,780-834`); auditors must track which
   fired via `capped` / `payRateCapped` / `marketMaxApplied` / `payCap`.
10. **Manual sim can't express call/holiday/facility.** `factorsFromControls` hardcodes
    `facility: community`, `call: false`, `holiday: false` (`hub/sim-adapter.ts:139-142`);
    only the PDF/freetext path exercises those factors — so the most common recruiter flow
    (manual controls) exposes the fewest comp factors.

---

## 4. Confidence labels on the numbers referenced in this map

- **OBSERVED (cited):** CALL_RATE_DATA bands with agency-named notes (e.g. neurosurgery
  `callRates.ts:73-82`, anesthesiology `callRates.ts:139-146`); GSA FY2026 table
  (`callRates.ts:378-404`); scraper runtime-verified examples (`card_extractor.py:9-13`,
  `jsonld_parser.py:22-23`).
- **ESTIMATED (research-derived, no primary citation inline):** SHIFT_MULT / FACILITY_MULT /
  DURATION_MULT values (`multipliers.ts`); call 1.10× and holiday 1.10× toggles
  (`rateCalculator.ts:673-675`); LOCUM_MULTIPLIER (`blsSanityCheck.ts:70-89`, self-labeled
  non-cited); CRNA arrangement fallback multipliers (`crnaCellLookup.ts:653-659`);
  LEGACY_CALL_DAILY_FLOOR rationale (`marketRates.ts:591-598`); scraper magnitude bands
  ($60–900/hr, $400–12,000/day — `jsonld_parser.py:39-40`).
- **CONVENTION (internal, uncited as market fact):** 20% fixed call-only margin
  (`hub/sim-adapter.ts:318-321`); 80% pay/bill ratio (`rateCalculator.ts:716`); 1.75×
  combined-multiplier ceiling (`rateCalculator.ts:679`).
