# 00 — Rate Simulator Deep-Dive: Master Report

> Synthesis of 6 architecture maps + 17 research briefs, 2026-07-05. The definitive
> state-of-the-engine document and the prioritized path to the north star.
>
> **NORTH STAR (Zach, 2026-07-02):** recruiters price real placements off this simulator.
> It must be unbelievably accurate for EVERY specialty staffed in the locums world — *the
> rate we would actually pay the physician* AND *where that rate sits in the market
> distribution (percentile)*. Specialty-coverage gaps, missing comp factors, and
> unquantified uncertainty are **defects, not nice-to-haves**.
>
> **TOPOLOGY (Zach-confirmed 2026-07-02):** the LIVE simulator = `imstaffing.ai/hub`, served
> by the **ias-website** repo — engine `src/lib/rate-engine/` + hub adapter `src/lib/hub/`.
> The ias-dashboard *app* (`ias-hub-dashboard.web.app`) is DEAD; `ias-dashboard/src/features/rate-simulator/`
> is a legacy copy. But the **bridge** (`ias-dashboard/scripts/data-refresh/`) and **scraper**
> (`agent-sdk/agents/rate_scraper/`) ARE the still-live data pipeline writing the RTDB the hub
> reads. There is ONE live engine.
>
> **HONESTY DISCIPLINE (applies to every number below):** OBSERVED = read from code (file:line)
> or a fetched named external source. ESTIMATED = analyst-derived, labeled. UNVERIFIED = flagged.
> No fabricated $ figures survive; refuted claims from the fact-check pass are corrected inline.

Companion documents in this folder: `maps/01-06` (architecture), `briefs/10-26` (pillar research),
`BACKLOG.md` (every recommendation, scored + sorted), `research-prompts/` (re-runnable per pillar).

---

## 1. Executive Summary

The engine is, structurally, **far better than the competitive field** and **far short of the
north star at the same time** — and both facts come from the same root: it is an unusually
disciplined *point + curated band* estimator with a genuinely adversarial data pipeline, sitting
on top of a data substrate that cannot yet answer either half of the north-star question.

**What is genuinely strong (keep, surface, extend):**
- A faithful, golden-master-pinned calculation engine (207-case parity corpus): curated hourly
  bands × a geo/shift/facility/duration multiplier chain, with hard clamps and honest
  insufficient-data surfaces (`rateCalculator.ts:656-726`, `06-data-model.md §4`).
- A **16-rung anti-fabrication pipeline** ending in the Move #1 trust-ladder anchor gate:
  a scraped posterior may move a real quote only if it is market-typed
  (`actual_paid_locum`/`advertised_clinician_pay`) AND `n_distinct ≥ 4` AND ≥ 2 independent
  corporate families (`marketRates.ts:469-551`; full stack `03-market-posterior-bridge.md §7`).
  No public competitor treats accuracy as an adversarial problem at all (`18-competitors.md`).
- A **cite-or-suppress culture**: null call bands render "insufficient public data" rather than a
  fabricated number; bimodal cells refuse a point estimate (`cellAggregation.ts:195-263`).
- **Half the moat is already built and dormant:** provenance capture (verbatim cited spans in
  Supabase), the quote-outcome telemetry tables (`quote_events`/`quote_outcomes`), and the
  recruiter-feedback calibration loop are all migrated/coded and **unwired** (`21-innovation.md`,
  `23-internal-truth.md`).

**The seven load-bearing defects, against the north star:**

1. **Coverage is capped at ~19 cells by a taxonomy chasm.** The producer speaks 152 canonical
   names, the engine 88 keys, and only **19 names exist in both** — so a perfectly scraped CRNA,
   cardiology, OB/GYN, general-surgery, or ortho observation is discarded as `unknownSpecialties`
   before it can ever corroborate a quote (`06-data-model.md §3.4`, `22-specialty-coverage.md §F2`).
   No mapping table exists anywhere in the three repos. Every improvement that depends on live
   data inherits this ~19/88 ceiling.
2. **"Where it sits in the distribution" is fabricated shape.** Every percentile the recruiter
   sees — the p25/p50/p70/p75/p90 chips, the "Recommended (market median)" legend — is a **linear
   interpolation between two band endpoints**, not a percentile of any observed distribution
   (`sim-adapter.ts:254,372`; `24-percentiles.md §F1`). Wage distributions are right-skewed, so
   uniform interpolation overstates mid percentiles and mislocates a high offer. No store on the
   live path holds a real quantile.
3. **There is no internal PAY ground truth — by process, not integration.** Zach-confirmed: *"we
   have the BILL rate but we don't know what we actually PAID them because it changes and we don't
   document that"* (`23-internal-truth.md §F1`). The top rung of the trust ladder
   (`actual_paid_locum`) is a well-guarded, permanently empty seat. The feedback calibration loop
   consumes an empty, world-writable RTDB node.
4. **The highest-variance comp surface (daily/call) has zero live corroboration.** The scraper
   drops every DAY-unit observation before insert (`agent.py:491-495`), the overlay mutates only
   hourly bands, and `CALL_RATE_DATA` (19/88 quotable weekday bands, 0 holiday bands) can only
   decay from its 2026-06-03 snapshot (`10-comp-core.md §F2`, `11-comp-call.md`).
5. **The manual sim cannot express real comp factors.** `factorsFromControls` hard-codes
   facility=`community`, call=`false`, holiday=`false` (`sim-adapter.ts:139-142`) — CAH (+22%),
   rural-trauma (+30%), call (+10%) are reachable only via PDF/freetext parse. The most common
   recruiter flow exposes the fewest comp factors (`05-comp-factors-today.md §3.10`).
6. **The accuracy machinery gates nothing.** The 207-case parity suite, the 22-case overlay suite,
   and ~44 `src/lib` test files **never run in CI** — ias-website CI runs `build` + `verify` only;
   the bridge repo has no CI at all; prod is a Cloudflare-Pages auto-deploy on push. A red parity
   gate ships anyway (`14-accuracy-harness.md §F2`).
7. **The vendoring arrow now points from a dead app to the live one,** and a live production fix
   (premium-erasure, commit `6d9edb1`) is one `sync-rate-engine.mjs` run away from silent reversion
   (`02-hub-adapter-layer.md §10`). This is a standing landmine independent of any feature work.

**The strategic read.** The moat is not a UI feature; it is the compounding stack nobody can
scrape: **(1) proprietary placement outcomes** (only a real staffing operation has won/lost per
quote), **(2) provenance-backed anti-gaming rails**, and **(3) the cite-or-suppress honesty
culture.** Every top move below either surfaces one of those three assets or removes a blocker
(taxonomy chasm, fabricated percentiles, hourly-only pipeline, credential trust boundary) that
would make the surfaced feature dishonest. The single highest-leverage sequencing insight recurs
across five briefs: **fix the taxonomy chasm and start persisting history/outcomes NOW**, because
every downstream accuracy gain (percentiles, trend, calibration, geo) inherits the same data
ceiling and the same "we deleted the history we'll need" problem.

The prioritized **Top 10 Moves** are in §10.

---

## 2. Current-State Architecture

*(Sources: maps `01-engine-core`, `02-hub-adapter-layer`, `03-market-posterior-bridge`,
`04-scraper-pipeline`, `05-comp-factors-today`, `06-data-model`.)*

### 2.1 The four-layer override chain

The quote is a layered override chain; each layer lives in a different store
(`06-data-model.md §0`):

| Layer | Store | What it is | Read at quote time |
|---|---|---|---|
| **1. Curated prior** | JS bundle: `specialties.ts` (88 keys), `callRates.ts`, `stateData.ts`, `blsOewsBaseline.ts` | Analyst-curated hourly bands (min/max/p70), call daily bands, state multipliers, BLS baselines | **Always** — the default when no live anchor fires |
| **2. Observation spine** | Supabase `rate_intelligence` + `canonical_rate_intelligence` view | Raw scraped/typed/dedup-keyed/cited rate observations | **Never directly** — only the bridge reads it |
| **3. Aggregated posterior** | Firebase RTDB `rate-simulator/market-rates-v2` | Per-(specialty, state, rate_type) MAD+IVW posteriors, written daily by the EC2 bridge | **The live hub** — `initLiveMarket()` overlays `SPECIALTIES` in place |
| **4. Behavior contract** | `goldenMaster.json` (207 cases) | Frozen engine outputs — math truth, not data truth | CI parity tests only |

### 2.2 How one quote is produced (`01-engine-core.md`)

Three entry paths — manual controls, LocumSmart PDF text, freetext ("CRNA nights in Houston, TX")
— all converge on `RateFactors` (`types.ts:187`), then split:
`callOnly=false → calculateRate` (hourly $/hr) or `callOnly=true → calculateCallRate` (per-diem $/day).

**Hourly formula** (`rateCalculator.ts:656-726`, every bound OBSERVED):
```
base         = spec.p70                              // p70 = round(min + (max-min)*0.70)
combinedMult = geo × 1.0(rural) × shift × facility × duration × call(1.10) × holiday(1.10)
cappedMult   = min(combinedMult, 1.75)               // CLAMP 1 (magic 1.75, duplicated on call path)
payRate      = min(base × cappedMult, rateCap×0.80, spec.max)   // CLAMP 2 (PDF cap), CLAMP 3 (researched ceiling)
billRate     = roundUp5(payRate / (1 - margin))      // hub margin slider 15-45%, default 22%
```
- **Geo** = `STATE_MULT` (`stateData.ts:149-173`): `clamp((100/COLI)^0.30 × (304/density)^0.30 × demand^0.40, 0.88, 1.38)`. COLI (BEA RPP 2024) and density (HRSA AHRF 2024-25) are OBSERVED/reproducible; the **demand class carries the largest exponent (0.40) and is the least reproducible input** — hand-curated, no per-state citation (`stateData.ts:94-97`).
- **Shift/facility/duration** multipliers (`multipliers.ts:13-44`) are ESTIMATED, comment-cited only.
- **Rural = 1.0 always** (removed 2026-06-01 after the CRNA Kokomo IN over-quote; `rateCalculator.ts:660-669`). The genuine rural premium now hides behind facility type (CAH 1.22×, rural_trauma 1.30×), which the manual sim never sets.
- The **1.10× call multiplier has no cited source** (`rateCalculator.ts:673`) — UNVERIFIED. So "q2 in-house" and "1:4 shared beeper" price identically.

**Call-only path** (`rateCalculator.ts:766-875`, `callRates.ts`): daily `typical × (geo×facility×duration, capped 1.75) → min(band.max, cap×0.80)`; shift/call/holiday are baked into per-day-type bands. `band==null → insufficientData` (honest zero). Every holiday band is null; only 19/88 specialties have a quotable weekday band.

### 2.3 The live overlay — Move #1 trust ladder (`02`, `03`)

Once per session, client-side: `initLiveMarket()` → `loadMarketBucketRates()` reads RTDB
`market-rates-v2` and **mutates the `SPECIALTIES` singleton in place** (a load-bearing
bundler-dedup invariant, `sim-live.ts:12-17`). A cell's posterior ANCHORS the quote only when ALL
gates pass: rate type ∈ {`actual_paid_locum`, `advertised_clinician_pay`}; `weighted_mean` finite
> 0; `n_distinct` integer ≥ 4; ≥ 2 trim+lowercase-normalized source families
(`marketRates.ts:469-551`). On promotion: `p70 = round(weighted_mean)`; band from the **frozen**
`STATIC_SPECIALTY_RANGES`, with a geometric max re-scale when the anchor ≥ curated max (the
2026-07-02 premium-erasure fix, commit `6d9edb1`). Real observed effect at the 2026-06-30 deploy:
**0 promotions**, 6 cells reverting legacy→curated (`03 §5.3`).

### 2.4 The producer pipeline (`03`, `04`)

`agent-sdk` scraper (Firecrawl marketing pages + SerpAPI + Scrapling per-job postings) →
per-row dedup keys computed at INSERT (`content_hash`, `dedup_group_id`, `rate_type` 7-value enum)
→ Supabase `rate_intelligence` (one all-or-nothing batch INSERT — one bad row aborts the run's
write). The bridge (`bridge-rate-intelligence.ts`, daily 04:00 UTC EC2 cron) reads the 7-day
window through `canonical_rate_intelligence`, runs `aggregateBridge` (validity → never-anchor drop
→ **unknown-specialty gate against the 88 engine keys** → 2-stage dedup → family collapse-then-cap
≤60% → `aggregateCell` MAD+IVW posterior → bimodal→null), and writes one atomic RTDB update.
IronDome `PLAUSIBLE_RANGES` (29 hand-tuned specialty bands, `iron_dome.py:16-53`) is the ingestion
plausibility gate.

### 2.5 Structural seams (the recurring risk list)

- **Taxonomy chasm** (`06 §3.4`): 152 producer names vs 88 engine keys, 19-name intersection; the
  bridge drops the rest as `unknownSpecialties`. The single highest coverage defect.
- **Vendoring inversion + confirmed two-way drift** (`02 §10`): canonical (dead app) has WS1
  `aggregator_estimate` the live copy lacks; the live copy has the premium-erasure fix canonical
  lacks. `sync-rate-engine.mjs` would regress the live fix and the golden master would not catch it.
- **National-only cells** (`03 §S7`): every live bucket is `stateKey='national'`; all geo pricing
  rides on the static `STATE_MULT`.
- **Global mutable singleton overlay** (`01 §S3`): correctness depends on Vite never splitting
  `specialties.ts`; untenable for a long-lived server process (staleness bug).
- **World-writable feedback node** (`06 §2.1`): `rate-simulator/feedback` is `.write:true` with
  2-field validation — a prerequisite blocker before wiring Move #4 calibration.
- **Three-copy family/precedence registries** (`03 §S3`, `04 §S8.1`): the independence semantics
  live in Python `dedup.py` + two `sourceFamily.ts` copies that must agree token-for-token.

---

## 3. The Accuracy & Anti-Manipulation Doctrine

*(Sources: briefs `10/11/12` comp-taxonomy, `13` anti-manipulation, `14` accuracy-harness,
`20` rate-hunt; fact-check verdicts applied.)*

### 3.1 Comp-factor taxonomy: what the engine models, partially models, and ignores

Locum pay is quoted in five core structures under one arrangement axis and two floor mechanisms.
The engine is first-class on exactly one (hourly).

| Comp factor | Status today | The defect |
|---|---|---|
| **Hourly $/hr** | FIRST-CLASS (the only live currency) | Its "percentile" is fabricated shape (§5) |
| **Daily / worked-day** | Typed end-to-end, then **dropped before persistence** (`agent.py:491-495`) | A "$2,000/day clinic" posting is unquotable; call daily bands can only decay |
| **Per-shift** ("$2,400 / 12-hr ED shift") | Folded into DAY, then dropped; shift length never captured | The honest $/hr divisor (`coverageHrs`) exists on the call path but not here |
| **Call-period stipend** | FIRST-CLASS but **static-only, 19/88 quotable**, 0 holiday bands | No live corroboration path even designed |
| **$/wRVU production** | **Actively rejected** at parse (`card_extractor.py:69-70`) | Teleradiology's real production sub-market is invisible |
| **W2-locum vs 1099-locum** | 3 unlinked layers (exclusion / BLS sanity / dormant CRNA), no UI toggle | No arrangement badge; implicit and internally inconsistent |
| **Minimum guarantees** | ZERO representation anywhere | "$220/hr, 8-hr guarantee" quotes identically to no guarantee |
| **Overtime** | Dormant observed signal (`liveCalibration.ts`), never consumed | Best OT intel in the codebase is ignored |
| **Stipends / bonuses / travel** | Destroyed at parse or dead code (GSA table has 0 hub consumers) | Bill number is a professional-fee bill, not all-in cost, and doesn't say so |

**Cited external anchors (OBSERVED, fact-check CONFIRMED unless noted):**
- CompHealth 2026 hourly: anesthesiology $300-425, EM $250-300, FM $120-135, general surgery
  $150-200, hospitalist $170-190, OB/GYN $150-200. **Provenance nuance (fact-check):** the
  CompHealth page attributes these to *Locumstory (CHG)* data — so CompHealth and Locumstory are
  NOT independent corroboration.
- Physician Side Gigs survey: avg ≈ $215/hr, range $60-500; GI $367 (highest), gen-peds $108
  (lowest), anesthesiology $292, EM $258, FM $140.
- ResidencyAdvisor structure examples: $220/hr 8-hr day; $2,000/day clinic; $2,400 per 12-hr ED
  shift; $3,000 per 24-hr in-house call.
- **W2↔1099 (corrected per fact-check):** NO single multiplier may be hardcoded. The *worthwhile*
  1099-over-W2-locum premium on the SAME assignment starts around **+20%** (Locumstory's "at least
  20% more," an open-ended floor); a rate only 5-10% higher is the *not-worth-it* zone that merely
  offsets self-funded taxes/benefits/malpractice (ResidencyAdvisor). SE tax 15.3% (12.4% SS to the
  2026 wage base **$184,500** + 2.9% Medicare) is the real, specialty-and-time-varying driver.
- **wRVU teleradiology:** platforms advertise $45/wRVU with a *claimed* effective $450-500/hr
  *contingent on volume* (locumpayguide, low-quality niche source). The "$35/wRVU day, $38/wRVU
  night" figures are **UNVERIFIED — keep out of any user surface** (fact-check: no primary source;
  likely a per-*study* / per-wRVU unit conflation).
- **Hanover Research/CHG "$32.45/hr more than perm":** real but **CHG-commissioned** (cited by
  CHG's own Weatherby), not neutral third-party — treat as a vendor statistic.

### 3.2 The rate-hunt: known-wrong bands (`20-rate-hunt.md`, fact-check CONFIRMED)

The engine's own named upstream source (LocumStory 2025) now **contradicts 7 of 12 curated bands,
always in the "engine rich" direction** — in every one the default p70 sits above LocumStory's max.
Flagged **too high** (multi-source): pediatrics (p70 145 vs Barton 93-130 + LocumStory 105-130 +
PSG avg 108), OB/GYN (p70 241 vs LocumStory 150-225 + Barton 120-200 + PSG 155), endocrinology,
family-medicine top. Flagged **too low**: gastroenterology (max 310 vs PSG avg $367 + AMN implied
~$365), pathology (max 200 vs the engine's OWN callRates worked-day band implying $185-215/hr).
**Self-inflicted ingestion blindness:** IronDome caps scraped CRNA at $250/hr while the engine's own
`callRates.ts:150` cites $200-325/hr — so the pipeline REJECTS the exact surge observations that
could prove the market; and allergy/immunology IronDome max ($200) is *below* the curated band max
($215). **Systemic root cause (Finding 8):** `baseRate = p70` prices the no-premium default at the
70th percentile of a band whose top IS the premium market, then multipliers stack on top.

### 3.3 Anti-manipulation threat model (`13-anti-manipulation.md`)

The design idiom is **exclusion-by-absence** (a distrusted class is never admitted to the voting
set). Ten cited guards sit in front of the anchor gate. **The verified trust boundary is
credential-strength, not logic-strength:** the RTDB rules DO close the forged-node attack
(`market-rates-v2` is `.write:false`, proven by test), so quote integrity reduces to two secrets —
the bridge's firebase-admin service account and the scraper's `SUPABASE_SERVICE_ROLE_KEY`
(which bypasses Postgres RLS). The 12 residual gaps, by leverage:

1. **`advertised_clinician_pay` anchors AND reads 'high'** — advertised ≠ paid. Two agencies
   posting inflated "up to $X" ranges across ≥4 postings / ≥2 families anchor the quote up and
   badge it 'high' with zero actual-paid corroboration. *The single biggest north-star subtlety.*
2. **Template inflation inflates n.** The dedup key includes `location`, so one templated rate
   posted in 10 cities = 10 distinct observations → climbs the ≥4 bar from one template; only the
   ≥2-family gate then stops it.
3. **Selection bias is entirely unmodeled** — the fleet scrapes a sell-side catalog (agencies
   marketing their own placements); no inverse-propensity weighting.
4. **The 7-day cliff is a silent denial-of-accuracy.** Suppress the fleet for a week (one poisoned
   row aborts the all-or-nothing batch) and every promoted cell silently reverts to curated with
   no hub alarm. *Denial-of-accuracy is cheaper than inflation.*
5. World-writable `feedback` node arms feedback-calibration poisoning **before** Move #4 ships.
6. Independence registry lives in 3 language copies (token-for-token divergence risk).

### 3.4 The continuous accuracy harness (`14-accuracy-harness.md`)

The project owns a strong *point-in-time* arsenal (207-case golden master, 22-case overlay suite,
~130 bridge tests, the fail-closed scraper partition, IronDome, three dormant audit engines) but
**no continuous harness**: none of it gates a deploy; the regression net covers code, not the
numbers flowing through RTDB; a quote cannot explain itself; benchmarks age silently (BLS OEWS is
May-2024 while May-2025 shipped 2026-05-15; GSA FY2026 goes stale 2026-10-01). The build plan is
mostly **wiring what already exists**: (Phase 0) `npm test` in CI + pin the golden-master count
exactly; (Phase 1) property suite (fast-check TS + Hypothesis py — already a dep) over the closed
enums; (Phase 2) ~15 cited canary cells + drift alerts on the live path + a nightly rate-surface
snapshot; (Phase 3) a per-quote provenance object (`bridgeRunId → bucket → n → families →
observation URLs`); (Phase 4) monthly BLS-verdict batch + one band registry unifying the four
divergent plausibility tables; (Phase 5) golden-master extension + canonical inversion.

### 3.5 Doctrine statement (the rules every surface must inherit)

1. **Advertised is not paid.** Cap advertised-only anchors at `medium`, or require an
   `actual_paid_locum` corroborant, or anchor at a sourced advertised→paid discount.
2. **n must be honest.** Count distinct (family, rate-bucket) pairs, not (family, location,
   rate-bucket); cap per-family contribution to n; raise the bar for high-variance specialties.
3. **Never convert units without observed shift hours** — a DAY→HR conversion is fabrication.
4. **No hardcoded arrangement/geo/OT multiplier as a quote mover** — arrangement is a bucket
   dimension with observed cells; multipliers are labeled low-confidence context only.
5. **Cite-or-suppress, and label the method.** Every quantile/anchor renders with `method` +
   `n_used` + provenance, or renders "insufficient data." Bimodal cells never collapse to a point.
6. **The trust boundary is two credentials** — rotate, vault, least-privilege; lock the feedback
   node before it can move a quote.

---

## 4. Full-Specialty Coverage Plan

*(Sources: `22-specialty-coverage.md`, `06-data-model.md §3`, `19-data-sources.md`,
`20-rate-hunt.md`.)*

**The universe:** ~140-160 physician specialty cells (ABMS 38 specialties + 89 subspecialties;
LocumTenens.com's 155-name tree; IAS's own 2,831-booking history → ~140 cells with ≥3 bookings).
The engine quotes from **88** curated cells — missing roughly a third-to-half of the universe by
count, **including cells IAS demonstrably books** (radiation oncology 41 bookings/32mo; PA-CV/CT
surgery 68; CNM 16).

### 4.1 Three defect classes, in fix order

1. **The taxonomy chasm (P0, unlocks everything).** 152 producer names, 88 engine keys, **19-name
   intersection**. 133 producer cells can never reach RTDB (the producer rewrites `crna → nurse
   anesthetist` at INSERT — a fresh CRNA scrape can *never* reach the engine `crna` node); 69 of 88
   engine cells can never receive live data. Live-signal coverage is structurally capped at ~19/88
   **forever** until a mapping layer exists.
2. **Missing cells fail DANGEROUSLY, not honestly.** `mapSpecialty` (`rateCalculator.ts:77-94`)
   defaults unknown specialties to `internal medicine`. Worked examples (mechanics verified):
   "radiation oncology" → `medical oncology` band; "cardiothoracic surgery" → `thoracic surgery`;
   "child neurology" → adult `neurology`; "certified nurse midwife" / "spine surgery" / "addiction
   medicine" → `internal medicine` band. Substring/alias mis-folds carry `source:'inferred'` and
   can still display **Medium/High** confidence — a silent mispricing machine for exactly the cells
   we don't cover. The audit-mandated "manual escalation" surface was never built into the hub.
3. **Band quality inside the 88 is thin.** 18 medium / 5 low / 65 modeled / **0 static high**;
   call-only quotable for 19/88; every holiday band null.

### 4.2 The gap table (priority extract; full table in `22-specialty-coverage.md`)

| Cell | In engine? | Live status | IAS demand (32mo) | Priority |
|---|---|---|---|---|
| CRNA, cardiology, OB/GYN, general surgery, ortho, GI, heme/onc, critical care, pain, urgent care | yes | **severed** (name mismatch) | IAS #1-#9 range | **P0 (mapping)** |
| All 7 `np/pa (...)` buckets | yes (coarse) | **severed** (58 producer APP cells unmapped) | 21.4% of book | **P0 (mapping, coarse)** |
| Radiation oncology | **no** → medical-oncology band | — | 41 | **P1 (new cell)** |
| Cardiothoracic/CV surgery | **no** → thoracic band | — | 33+28 | **P1** |
| OB hospitalist / laborist | **no** → hospitalist | — | 3+fanout | **P1** |
| Certified nurse midwife | **no** → **IM band (indefensible)** | — | 16 | **P1** |
| Child neurology, addiction medicine | **no** → neurology / IM | — | 4 / — | **P1** |
| Spine surgery, ortho trauma, breast imaging | **no** (spine → IM!) | — | 10 each | **P2 (min: kill IM default)** |
| PA/NP-CV surgery / cardiology / heme-onc | **no** → generic buckets | — | 68/42/29/26/20 | **P2 (split after P0)** |
| Dentistry / optometry / allied / peds subspec | no | — | ≤21 each | **P3 (manual-escalation)** |

### 4.3 Expansion phases

- **Phase 0 (days):** kill the silent IM default → route true no-hits to an explicit "manual
  escalation" surface, cap substring-fold confidence at Low, log every fallback to `quote_events`
  so gap priority becomes empirical (`22 R2`).
- **Phase 1 (mapping layer):** one 152→88 translation table applied at the bridge before the
  `knownSpecialties` gate, with a cross-repo sync test pinning domain=canonical / range⊆engine
  (closes `03 §S4`). Turns the fleet's existing output into corroboration for 7 of IAS's top-15
  cells **without a single new scrape** (`22 R1`, `19 R2`).
- **Phase 2 (new P1 cells, cite-or-suppress):** radiation oncology, cardiothoracic surgery, OB
  hospitalist, child neurology, addiction medicine, CNM — each with an engine key + alias + curated
  band ONLY if a named source cites it (else `null` band + escalation surface), a producer mapping
  row, and a `SPECIALTY_TO_SOC` entry (`22 R3`).
- **Phase 3 (splits by demand):** refresh the empirical universe, rank APP/peds/ortho/breast splits
  with the §3.5 collapse anti-test (split only when the subcell distribution is demonstrably
  separated from parent — never fabricated granularity), pin the taxonomy with tests (`22 R4/R5`).
- **IronDome band coverage** must grow in lockstep (29 bands → the reachable specialties) cite-or-
  block, because the no-tight-bound guard hard-blocks the posting path for any specialty without a
  vetted band (`19 R5`, `04 §3`).

---

## 5. The Percentile & Ground-Truth Doctrine

*(Sources: `24-percentiles.md`, `23-internal-truth.md`; fact-check applied.)*

### 5.1 The percentile problem and the honest fix

Every displayed "percentile" is `min + (max-min)·(p/100)` — the p-th percentile of a **uniform
distribution the data never claimed** (`sim-adapter.ts:254,372`; also `getPercentileRate`, the
curated p70, and the legacy-band p70). The stored posterior cannot yield percentiles: it keeps
`weighted_mean, weighted_variance (= estimator SE, not spread), median, n_distinct, families` —
the sorted observation vector dies inside the bridge run. **No public source publishes a locum-rate
percentile table** (BLS OEWS, MGMA, SullivanCotter, AAPA are all permanent/W2 comp — usable as
*shape* priors, never level anchors; BLS physician upper percentiles are top-coded to null exactly
for high-pay physician SOCs). Marit Health is the only public locum-typed percentile-shaped source,
and it is crowd-survey class (never anchorable) behind a give-to-get wall.

**The design (`24 §D1-D6`):** a `RateDistribution` object computed by the bridge (pure, beside
`aggregateCell`, D-33-safe), persisted **additively** inside each v2 bucket (extra keys are ignored
by the untrusting reader — deploy-safe both directions). Estimation is **shrinkage-first**:
- Tier E `empirical_weighted` (n ≥ ~20, aspirational): weighted quantiles + bootstrap CI.
- Tier S `lognormal_shrunk` (4 ≤ n < 20): μ = ln(weighted_mean), σ from MAD shrunk toward a parent
  pool (cell → specialty → category → all-physicians); t-predictive inflation **widens thin cells
  by construction**.
- Tier P `prior_shape` (n < 4, MOST cells today): level from the trust ladder, shape from an
  external/pooled quantile-*ratio* prior (OEWS ratios where un-top-coded, licensed MGMA/SullivanCotter
  ratios, pooled siblings). Renders "modeled shape," never a bare "p90: $X."
- **Hard refusals:** bimodal → no distribution object; suppressed-basis quantile → null ("insufficient
  data above p75"); never extrapolate beyond stored quantiles.

**Recruiter payoff:** `percentileOfRate` returns a **range** ("offer sits at ~p25-p45"), and a
counter line ("to reach p50: $X · p75: $Y"), after normalizing the offer to base terms
(`offer / cappedMult`) so a night-CAH offer is positioned against the base-rate distribution, not a
mixture. **Phase 0 is a same-day honesty patch** independent of everything: stop labeling
interpolations as percentiles and rename "Recommended (market median)" to "Recommended (anchor)."

### 5.2 Internal ground truth and the calibration loop

**The foundational fact is negative and Zach-confirmed:** IMS does not document what it actually
pays. So `actual_paid_locum` **cannot be backfilled for pay** — it must be born at deal-close going
forward. What exists is bill-side and aggregate-side: the LocumSmart webhook logs everything
losslessly into `ls_events` but extracts **zero dollars**; the Sisense tap ships LS's own
aggregates (invoiced $, revenue-by-specialty — anesthesia/CRNA-dominant, so internal truth will
sharpen a few cells, never be the coverage story). But the **per-placement BILL rates DO exist
inside LocumSmart** (recon-proven: `Fact_ProposedChanges` carries RegularRate/OvertimeRate/
TwentyFourHourCallRate/CallBackRate/…), a complete RS-0 Supabase schema was migrated for exactly
this, and the writer was never built (10-byte stubs).

**The designed loop (`23 §F8`):** (a) port the `FeedbackSection` writer into the hub, write
`CalibrationEntry` rows to a **private** store (never the public-read tree), log one event per
rendered quote so the denominator exists; the consume side (`loadSpecialtyCalibration` →
`computeDisplayedRate`, dampened 50%, clamped ±15%, n≥3) turns on automatically. (b) Build the
bill registry from `ls_events.raw_payload` + Partner-API per-CA enrichment into the RS-0 tables.
(c) Specify the **internal rung** with its OWN gate (internal actuals are ONE family, so the
≥2-family quorum must NOT apply — use n≥3 distinct placements + k≥3 anonymity + shrink toward the
prior below the gate). (d) Wire a **bill-bound backstop** one-way clamp (`pay ≤ bill × pay/bill_ratio`,
ratio learned per HCO — the one real internal observation on disk is Atrium CRNA 0.862, materially
different from the 0.80 convention, and it is exactly the ratio that would have caught the Wake
Forest $298-model-vs-$250-paid over-quote). **The codebase carries three inconsistent margin
conventions (0.80 / 0.22 / 0.35) that must be reconciled.**

### 5.3 The quote-vs-paid accuracy KPI

`quote_events` / `quote_outcomes` (6-value enum, migrated, unwired) are the natural home. The
fields already exist (`accuracy`, `avgDelta`, `sampleSize`). Ship a per-cell scoreboard (median
|simulated − accepted| / accepted), a weekly digest, and two alerts: (a) |avgDelta| > threshold on
n≥5 cells (drift); (b) live-anchor promotions dropping to 0 (the invisible 7-day cliff). A monthly
published "simulator vs booked" MAPE-per-tier would make IMS the **only accuracy-audited rate tool
in the field** — no competitor publishes accuracy (`18 F13`, `21 F8`). **Confidentiality contract
first:** internal actuals may anchor/clamp/label but may NEVER appear verbatim in a public surface
or public-read node; provider identity HMAC'd at ingest; per-HCO caps render "contract cap applied,"
never the number.

---

## 6. Market Timing & Geo Granularity

*(Sources: `25-market-timing.md`, `26-geo-granularity.md`.)*

### 6.1 Market timing — rates are a time series, the engine treats them as a constant

Time is modeled as a **binary 7-day cliff** (weight 1.0 inside, 0 outside) with no recency
weighting, no trend, no seasonality, no surge machinery, and **no staleness metadata on curated
priors at all** (live data has a 7-day SLA; curated bands have an *infinite* SLA). The raw material
is being thrown away twice: `rate_intelligence` retains every dated row but the bridge reads only 7
days, and the RTDB posterior is whole-node-replaced daily, so **no posterior time series is
retained anywhere.**

External evidence (cited) confirms the pillar is real: demand seasonality is well documented (winter
respiratory, summer PTO, July academic turnover); surge events move temporary-staffing pay **2-3×**
(NYC strike nurses ~$9,000/wk ≈ 3× typical; 2022 tripledemic peds ED ~3×); locum rate bands moved
**+3% to +22% YoY** 2024→2025 by specialty, with a documented **downward** travel-nurse correction
(bill rates −20% YoY) proving decay must be two-sided; CHG's 2025 report shows **anesthesiology
demand +55% while EM declined 8% in the same year** — so a global drift term is wrong by
construction, trend must be per-cell. **Critically, no public source quantifies locum *rate*
seasonality amplitude** — it must be measured from our own spine, which makes persisting posterior
history NOW the highest-leverage timing move.

**Buildable now (no new data):** persist daily posterior snapshots + weekly FluView/NREVSS
covariates (`R1`); exponential recency decay via the already-designed-but-unused `evidence_weight`
hook + a **Kish effective-n** anchor gate (`n_eff ≥ 4`) so a fleet outage degrades gracefully
instead of cliff-reverting (`R2`, H ≈ 30d ESTIMATED default until fit); freshness SLA + the missing
promotion-drop alert (`R3`); surface data age + `asOf` metadata (`R4`); extract JSON-LD `datePosted`
to fix the scrape-date-floor age bias (`R8`). **Needs data:** per-cell Theil-Sen trend flags
(display-only first, ~3-6 months of history); surge detectors; measured seasonality (~mid-2027, one
full cycle). **Do NOT ship a seasonal rate multiplier now — there is no citable amplitude.**

### 6.2 Geo granularity below the state level

Geography today is one number: a static `STATE_MULT` (0.88-1.38) on a national band. There is no
sub-state dimension on the live path; rural was neutralized to 1.0; the only genuine rural premium
hides behind CAH/rural-trauma facility multipliers the manual sim never sets; BLS OEWS is consumed
state-level only though it publishes ~530 metro/nonmetro areas. Domain evidence: rural premium is
real but **specialty-heterogeneous and sometimes inverts** (MGMA 2018: non-metro surgical medians
*below* urban); physician pay inverts against COL (Doximity 2025: Rochester MN + St. Louis
out-earn LA/NYC — within-state-visible, which a state multiplier structurally cannot express);
federal machinery already prices geography below the state level (Medicare geographic-HPSA 10%
bonus; GPCI 109 localities + permanent frontier-state floor; CAH certification).

**The design:** a 3-value `geo_tier` (metro / non_metro / rural_cah / null) derived from
*observable designations* (USDA RUCC county codes, CMS CAH list, ACA frontier states), attached at
scrape time as a nullable field, quoted via a **shrinkage ladder** `cell(spec|state|tier) → state →
census-division → national` — the exact pattern the CRNA lookup already implements
(`crnaCellLookup.ts:37-46`). **What current data supports:** deterministic tier *classification*,
an OEWS metro/nonmetro tier-*ratio* prior (labeled ESTIMATED, clamped), replacing the hand-curated
`STATE_DEMAND_CLASS` with a reproducible HPSA-derived index (it carries the dominant 0.40 exponent),
and — the cheapest win — **exposing the existing CAH/rural-trauma facility control in the hub**.
What it does NOT support: live tier or even state posteriors (live rows are 100% state-NULL; the
national gate itself passed 0 cells at deploy). **State-attribution coverage is the prerequisite;**
`19` shows transparency-state (CO/WA/NY/IL/CA) posting scrapes are the lever that yields
state-attributed rows.

---

## 7. Portability Blueprint

*(Sources: `15-portability-core.md`, `16-portability-chat.md`, `17-portability-embed.md`.)*

The engine is ~95% of the way to a headless package: across 23 modules (~25.3k lines), the ONLY
non-relative value import is `import { ref, get } from 'firebase/database'` (`marketRates.ts:9`);
the DI seam and the Phase-1/Phase-2 barrel split already exist; the Phase-1 calc core **already runs
server-side on Cloudflare Workers in production** (the hub SSR first paint). Four things block a
clean core, none of them rate math:

1. **The quote API lives in the host** (`sim-adapter.ts`), deep-imports two engine functions the
   barrel doesn't export, and holds the confidence-honesty blend — so any new consumer must
   re-implement the blend or silently overclaim.
2. **The overlay is a global mutable singleton** — untenable for a long-lived server process (a
   cell promoted at boot stays promoted after its posterior goes stale, defeating the freshness
   gate).
3. **The market transport is over-specified** — a one-shot `get()` of a *public-read* path that RTDB
   also serves over plain HTTPS `.json` REST, so a 1-method `MarketSource` port removes the entire
   firebase npm dependency, the `forceWebSockets()` workaround, and shrinks the hub CSP.
4. **The producer (bridge) consumes the same logic from the dead app's directory** — the "legacy
   copy" is a live production dependency; the bridge must be repointed before the dead twin can be
   deleted.

**The plan:** (Step 0, standalone landmine) back-port the WS1 deltas, declare the vendored live copy
canonical, tombstone `sync-rate-engine.mjs`. (Steps 1-3) extract `packages/rate-engine/` with a
`createRateEngine(config) → RateEngine.quote(input) → QuoteResult` façade that **absorbs the
confidence blend and ships `percentileMethod` + `provenance.anchor` in the result shape** (so no
surface can drop a disclosure), swap the `MarketSource` port, instance-scope the specialties table.
(Steps 4-6) hub goes REST, repoint the bridge via inverted source-vendor, delete the dead twin.
(Step 7) ship `/api/rate-quote` on the existing CF Pages deploy as the first headless consumer.

**Chat + embed surfaces** ride on top: **Slack first** (slash + `@mention` are HTTP-webhook-native,
fit the existing CF Pages `locumsmart-events.ts` pattern); Discord slash-command-only serverless
(the mention flow needs a Gateway daemon); an authenticated **hosted API + npm SDK** (`api.imstaffing.ai`,
Stripe-style versioning, KV-cached RTDB snapshot, per-key auth) that the ATS consumes server-to-server.
Every surface routing through ONE API holds the drift count at 1 instead of N — the confirmed
two-way vendored divergence is the observed proof of why. **Two prerequisites recur:** a
`resetSpecialtiesToStatic()` (or pure-table refactor) before any long-lived server quotes, and
feedback buttons on chat replies writing to the RLS-locked `quote_outcomes` (not the world-writable
RTDB path) — turning portability work into the accuracy loop's missing data producer.

---

## 8. Competitive Moat

*(Source: `18-competitors.md`; Marit/Levels figures fact-check-flagged as STATED.)*

The field splits into five archetypes and **none does what the north star demands**: agency
content-marketing pages (LocumStory/CHG, CompHealth, Barton — locum-specific but zero methodology,
structurally conflicted, and the very sources our curated prior cites — a **circularity risk**); W2
salary surveys (Doximity/Medscape/MGMA — real method, wrong economic population); verified
crowdsourced platforms (**Marit Health** — the credible threat: live locum hourly pages, ~$290/hr
avg STATED, Glassdoor DNA, $3.2M seed — but self-report ≠ market-typed, no recruiter surface, no
comp-model typing, give-to-get gating blocks embedding); job-board estimates (ZipRecruiter/Adzuna —
the contamination class we already NEVER-ANCHOR after the CRNA $124.86 ≈ half-the-real-rate
incident); and clinician calculators (arithmetic on a user-supplied rate).

**The exploitable white space:** no public tool combines (a) locum-1099-specific observed rates,
(b) per-quote provenance, (c) call/per-diem comp-model typing, (d) shift/facility/geo factors,
(e) recruiter pay+bill+margin workflow, and (f) embeddability/API. IMS has a-through-e in some
stage; nobody else has more than two. The three places competitors beat the LIVE surface **today**:
Marit's per-observation drill-down (our provenance is in the schema, not on screen), MGMA's real
percentiles (ours are linear-interp shape), and clinician calculators' all-in-value math (our
stipend signals are dead code). **The durable moat** = proprietary placement outcomes +
provenance-backed anti-gaming rails + cite-or-suppress honesty — none scrapable. Cheapest
differentiators: the "Why this number" provenance panel (data already in the RTDB bucket) and a
public methodology page (full disclosure is a marketing asset *because it is real*). Marit is a
**watch/partner**, not a build target — its data can fill `crowd_survey` context panels without
touching the anchor.

---

## 9. Data-Source Roadmap

*(Source: `19-data-sources.md`.)*

The binding constraint on live-anchored coverage is **independent-family count per cell, not
observation volume** — the anchor gate needs ≥2 families and today the posting path has exactly ONE
verified family (AMN). WS1 discovery (live-verified 2026-06-30): at least 4-6 genuinely independent
families publish scrapable per-job $/hr (AMN, Cross Country, LocumTenens.com mobile, gaswork for
anesthesia/CRNA, Vivian-recovered agencies, Aya), plus JSON-LD aggregator boards (Physemp, DocCafe,
LJO) that RECOVER pay for pay-opaque families via the already-wired family-recovery seam. **Four
co-blockers must be scheduled WITH source expansion, not after:** (1) the 19/152 taxonomy seam,
(2) IronDome band coverage (29/152), (3) the DAY/WEEK unit drop, (4) the unapplied migration
`20260701000000` (one `aggregator_estimate` row 23514s the whole batch). A secondary geo lever:
**pay-transparency laws** (17 states; ACR Career Center mandates disclosure on all postings) force
ranges into postings AND yield state-keyed rows for the empty state dimension.

**Wire order (prerequisites first):** apply the migration → build the mapping layer → flip staged
boards after live selector verification (Physemp+AMN = first real 2-family promotions) → wire the 3
net-new direct families → expand IronDome cite-or-block → Vivian aggregator → DAY-rate capture
channel → transparency-state geo scrapes → Marit as crowd_survey geo prior → society-board sweep
(ACR first) → freshness hardening → single machine-readable family registry → per-board ToS checklist.
**Context rungs (never anchor, correctly):** Marit/PSG (crowd_survey), CHG/LT.com annual reports,
AANA/BLS (already wired), gov procurement (agency_bill_rate, cap axis only).

---

## 10. Top 10 Moves (impact × effort)

Ranked by north-star leverage. Each links its source brief(s). Effort is relative
engineering size, not calendar. "Prereq" names the hard dependency.

| # | Move | Impact | Effort | Source | Why it's here / prereq |
|---|---|---|---|---|---|
| **1** | **Producer→engine specialty mapping layer (152→88)** at the bridge, + cross-repo key-set test | HIGH | MEDIUM | `22 R1`, `06 §3.4`, `19 R2` | Unlocks live corroboration for 7 of IAS's top-15 cells with **zero new scrapes**; caps every other live-data gain until fixed. Prereq: apply migration `20260701000000` |
| **2** | **Wire the outcome + feedback calibration loop** (capture → `quote_events`/`quote_outcomes` → calibration → published accuracy scorecard) | HIGH | MEDIUM | `21 R1`, `23 R1/R5`, `16 R5`, `11 R7`, `20 R9` | The unscrapable moat + the only ground truth + the quote-vs-paid KPI. **Prereq: lock the world-writable `feedback` node** (`13 R2`); write to private store only |
| **3** | **Percentile honesty: Phase-0 relabel now → `RateDistribution` (shrinkage-first)** | HIGH | LOW → MEDIUM | `24 R1/R2/R3`, `18 rec2`, `21 R3` | Makes the north star's second half real. Phase-0 (stop calling interpolations "percentiles," fix "market median" legend) is a same-day defect fix; the distribution layer is additive + D-33-safe |
| **4** | **Turn the test arsenal into a CI gate + property suite + canary cells** | HIGH | LOW → MEDIUM | `14 R1/R2/R3`, `17 R2` | Converts every existing test from advisory to load-bearing (Phase-0 is same-day); adds continuous monitoring of the numbers flowing through RTDB, not just code |
| **5** | **Anti-manipulation hardening**: split advertised-from-paid, fix template-inflation n-count, vault the two write credentials, reader-side sanity cross-check | HIGH | MEDIUM | `13 R1/R3/R4/R5` | Closes the "'high' on advertising" defect (the biggest accuracy subtlety) and reduces quote integrity to two rotated secrets. Some sub-parts (credential vault, feedback lock) are LOW effort, do first |
| **6** | **Extract the headless `@ims/rate-engine` core** — Step-0 landmine first, then package + `MarketSource` port + `quote()` façade | HIGH | MEDIUM | `15 R1/R2/R3`, `16 R2`, `17 R1` | Step 0 (declare vendored copy canonical, tombstone the backwards sync script) is HIGH/LOW and defuses a standing landmine; the extraction absorbs the confidence blend so no future surface overclaims |
| **7** | **Open the DAY-unit funnel + build the call-band overlay path** | HIGH | HIGH | `11 R3`, `10 R1`, `19 R7`, `05 §3.1`, `18 rec3` | The highest-variance, most-differentiated comp surface (MGMA is the only competitor with day-type granularity, and it's paid+perm) currently decays on a static snapshot. Never convert DAY→HR without observed shift hours |
| **8** | **Fix known-wrong bands + ingestion ceilings** | HIGH | LOW | `20 R1/R2/R4` | IronDome CRNA 250→325 + allergy 200→215 (self-inflicted blindness); cited re-audit of pediatrics/OB-GYN/endo/FM highs; raise pathology max (justified by the engine's OWN callRates). Numbers-only, cited, show-before |
| **9** | **Comp-structure fidelity + manual-sim factor controls**: `pay_unit` dimension, worked-day quote path, W2/1099 arrangement as an observed bucket, minimum-guarantee + observed-OT context, side-channel extras capture, expose facility/call/holiday controls | HIGH | HIGH | `10 R1-R5`, `12 R1`, `05`, `21 R4`, `26 R5` | Recruiters can't express real placements today; the flagship features (negotiation delta, provenance drawer) inherit the error if the cell's factors are wrong. No hardcoded arrangement/OT multiplier as a quote mover |
| **10** | **Market-timing + geo granularity foundations**: persist posterior history + recency decay (effective-n) + freshness/promotion-drop alert; HPSA-derived demand class + OEWS tier ratios + `geo_tier` + state-aware reader | MEDIUM-HIGH | MEDIUM | `25 R1/R2/R3/R4`, `26 R1/R2/R3/R4/R5` | History we delete daily is the substrate for all future trend/seasonality work; de-fabricates the dominant geo input (0.40-exponent demand class); the state-aware reader + CAH control are near-free correctness fixes |

**Sequencing note.** Do the LOW-effort sub-parts across moves first as a "week-one" batch — they are
disproportionately high leverage and mostly independent: Phase-0 percentile relabel (`3`), `npm test`
in CI + golden-master pin (`4`), credential vault + feedback-node lock (`5`), portability Step 0
(`6`), IronDome ceiling fixes (`8`), expose the CAH/call controls (`9`/`26 R5`), the promotion-drop
alert (`10`). Then the mapping layer (`1`) unlocks the live-data-dependent moves (`2`, `3`
distribution tier, `10` trend), and the headless-core extraction (`6`) unlocks the portability
surfaces. `7` and `9` are the deep, high-effort accuracy unlocks that follow.

---

## Appendix A — Fact-check corrections applied

Per the fact-check verdicts, the following are corrected/flagged wherever they appear above:
- CompHealth 2026 hourly ranges are **sourced from Locumstory (CHG)** — not independent of our
  curated prior's sources (circularity, not corroboration).
- **W2↔1099 same-assignment premium:** the worthwhile 1099-over-W2-locum premium starts around
  **+20%** (Locumstory floor); 5-10% is the "not-worth-it" break-even zone (ResidencyAdvisor). The
  earlier "+10% to +25% band" synthesis was rated *uncertain* — do not present it as a precise band.
- **"$35/wRVU day, $38/wRVU night" teleradiology figures are UNVERIFIED** with no primary source —
  kept out of every user surface.
- **Hanover Research/CHG "$32.45/hr more than perm"** is CHG-commissioned (vendor statistic), not
  neutral third-party.
- SalaryDr benefit-component figures are internally inconsistent (components sum past the stated
  total) — cited with care, never as engine input.
- All internal code figures (LOCUM_MULTIPLIER 1.35-3.50, CRNA priors 1.0/1.4/1.6/1.7,
  LEGACY_CALL_DAILY_FLOOR $1,000, neurosurgery beeper 4200-4800, OB/GYN worked-day 3900-4200) were
  read verbatim and CONFIRMED at the cited file:lines.

## Appendix B — Standing UNVERIFIED items (need a live query / creds / counsel)

RTDB deployed-rules export (public-read + bridge-only-write confirmation, `03 §S5`); whether any
`advertised_clinician_pay`-only cell has ever anchored; live `ls_events` volume + the 3 LS-semantics
questions (`confirmationAgreementId` ≡ placement? `totalMarkup`/`totalExpense` = bill vs margin?);
whether RS-0 migration `20260422173200` was applied to prod; DOJ/FTC 2023 antitrust safe-harbor
withdrawal (before any external rate-data sale); IMLC roster churn; per-cell `rate_intelligence`
history depth since 2026-05-20; BLS hourly top-code figure; Marit locum per-specialty n.
