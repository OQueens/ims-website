# Brief 18 — Competitor Teardown: Locum/Physician Rate Tools vs the IMS Rate Engine

> Deep-dive brief, 2026-07-03. Pillar: COMPETITOR TEARDOWN.
> Scope: every notable tool a physician, recruiter, or facility could use instead of the
> imstaffing.ai/hub rate simulator — what data each runs on, its granularity and
> transparency, what it gets right, and the gap an accuracy-first, provenance-backed,
> everywhere-embeddable locum engine exploits.
>
> Conventions: **OBSERVED** = read from our code (file:line) or quoted from a named external
> page. **STATED** = a competitor's own claim, not independently verified — every such $
> figure/behavioral claim is listed in `claims_to_verify` for the fact-checker.
> All internal paths are under `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/`
> unless noted. This is a locum-tenens (1099 contractor) rate context; W2 salary tools are
> covered because they are the contamination vector, not because they are substitutes.

---

## Summary

The competitive field splits into five archetypes, and **none of them does what the north
star demands** (recruiter-grade accuracy per specialty + honest percentile placement +
provenance):

1. **Agency content-marketing rate pages** (LocumStory/CHG, CompHealth, Weatherby, Barton,
   locums.com, AMN job pages) — publish locum-specific hourly ranges but with **zero
   disclosed methodology**, structural conflict of interest (they profit from the
   pay/bill spread), and lead-gen intent. These are, uncomfortably, the sources our own
   curated prior cites (`src/lib/rate-engine/specialties.ts:3-5`).
2. **W2 salary surveys** (Doximity, Medscape, MGMA, LocumTenens.com's own survey) — large
   samples, real methodology, but **annual W2 compensation**, 12–18 months stale, and
   locum-irrelevant unless converted (which our engine explicitly refuses to do as an
   anchor: `permanent_wage_proxy` can never anchor a quote — `marketRates.ts:119-124`).
3. **Verified crowdsourced platforms** (Marit Health, SalaryDr, Resolve, Ivy Clinicians) —
   the real innovation wave. **Marit already has live locum-tenens hourly pages**
   (STATED: locum physician average $290/hr, 2026) with per-submission drill-down. This is
   the closest thing to a direct threat AND the best model to learn from.
4. **Job-board/marketplace transparency** (Vivian for nursing, ZipRecruiter/Adzuna
   estimates) — posting-derived, fresh, but W2-blended and modeled; our pipeline already
   classifies ZipRecruiter/Adzuna as NEVER-ANCHOR after a production incident
   (`sourceFamily.ts:105-121`).
5. **Clinician-side contract calculators** (LocumCalc, TheLocumGuy, locums.com estimator)
   — arithmetic on a user-supplied rate; no market data of their own.

**The exploitable white space:** no public tool anywhere combines (a) locum-1099-specific
observed rates, (b) per-quote provenance (n, source families, rate-type trust class,
citations), (c) call/per-diem daily-stipend modeling, (d) shift/facility/geo comp factors,
(e) recruiter workflow (pay AND bill with margin), and (f) embeddability/API. We already
have a-through-e in some stage of build; nobody else has more than two. The two credible
threats are **Marit** (verified crowdsourced locum hourly, well-funded, Glassdoor DNA) and
**CHG's private data moat** (largest agency; their public numbers are unverifiable but their
internal fill data is the industry's best).

---

## Findings (cited)

### F1. LocumStory / CHG (locumstory.com) — the incumbent "rate truth" is methodology-free

- **What it is:** CHG Healthcare's content site; annual "Locum tenens pay trends by
  specialty" report (published 2025-09-17 per page), hourly ranges per specialty.
- **Data source:** undisclosed. The page names no survey, no sample, no internal-data
  claim. Fetched 2026-07-03: "The report does not disclose its data source, methodology,
  sample size, or specific provenance" ([locumstory.com](https://locumstory.com/spotlight/locum-tenens-compensation-trends)).
- **Granularity:** specialty × hourly range, national only. Geography is qualitative
  ("Midwest accounts for nearly one-third of openings"). No shift/call/facility axes.
- **STATED 2025 ranges (all → claims_to_verify):** anesthesiology $300–400/hr;
  cardiology $250–350/hr; emergency medicine $200–300/hr; family medicine $120–145/hr;
  medical oncology $375–500/hr; psychiatry $185–220/hr.
- **What they get right:** locum-specific, hourly-denominated, per-specialty, annually
  refreshed, free. The de facto anchor for physician expectations.
- **The gap:** zero provenance, no distribution (just min–max), no state/shift/call
  detail, and a structural conflict: CHG's brands (CompHealth, Weatherby, Global Medical)
  make money on the bill/pay spread — our own family registry collapses all of them into
  ONE corporate voice for exactly this reason (`sourceFamily.ts:73-103`, CHG family =
  {locumstory, comphealth, weatherby, global_medical}).
- **⚠ Circularity risk (internal):** our curated prior's first-listed source IS
  "LocumStory 2025 (CHG)" (`specialties.ts:3-5`), and the provenance docstring admits
  these are "publicly self-published sources and several are CHG-correlated ... a starting
  estimate, not observed paid rates" (`specialties.ts:20-28`). Until the live fleet
  corroborates a band, our prior partially inherits a competitor's unverifiable marketing
  numbers. That is precisely why the Move #1 trust ladder exists
  (`marketRates.ts:377-412`) — observed market-typed posteriors overwrite this prior.

### F2. CompHealth / Weatherby (CHG brands) — explainer content + a facility-side ROI tool

- **Weatherby compensation page:** no specialty rates at all; one headline stat — locums
  "make over $32 more per hour than their permanently employed colleagues," attributed to
  "CHG Healthcare's State of Locum Tenens report" with no link or methodology
  ([weatherbyhealthcare.com](https://weatherbyhealthcare.com/locum-tenens/resources/compensation), fetched 2026-07-03; STATED → claims_to_verify).
  Lists the same qualitative pay factors we model quantitatively (location, specialty
  demand, shift type, contract length).
- **CHG Locums Revenue Estimator** ([chghealthcare.com](https://chghealthcare.com/locums-revenue-estimator), fetched 2026-07-03):
  facility-facing, 60+ specialty dropdown, outputs projected gross profit/ROI of hiring a
  locum. Data claim (STATED): "actual claims data for CHG Healthcare providers.
  Aggregated from 73% of all claims data in the U.S. ... Compiled quarterly, with a six-
  to nine-month lag." Marketing stats on the page (STATED): 600% average ROI (up to
  800%); specialty positions take up to 226 days to fill costing up to $4.5M; primary
  care up to 189 days / $1.9M; "80–90% of healthcare organizations utilize locum tenens."
- **What they get right:** the revenue estimator is the only competitor artifact that
  speaks to the FACILITY's economics (revenue side of the bill rate). Notably it does NOT
  expose bill rates themselves.
- **The gap:** neither brand exposes a rate quote tool. The recruiter workflow —
  "what do I pay this physician and what do I bill this facility" — is served by nobody
  publicly. Our hub answers both in one panel (pay + bill with the 15–45% margin slider,
  `src/lib/hub/sim-adapter.ts:389-413`).

### F3. LocumTenens.com (Jackson) — a salary survey that isn't locum, plus an MGMA-priced calculator

- **Annual "Salary and Employment Survey"** (fielded Aug–early Oct 2023 per their report
  page): respondents include locum AND permanent clinicians, but "compensation results
  consist of only full-time, permanent employees and consider only annual salary and
  bonuses" ([locumtenens.com](https://www.locumtenens.com/resource-center/salary-survey-reports/); STATED → claims_to_verify). I.e., the
  locum-branded survey publishes W2 numbers.
- **ROI / cost-comparison calculator** ([locumtenens.com](https://www.locumtenens.com/resource-center/interactive-tools/cost-comparison-calculator/)):
  compares locum cost vs perm hire; perm salary/gross charges/benefits inputs are
  "derived from a recent physician compensation report from the Medical Group Management
  Association (MGMA)"; hourly/hotel/car figures from their own accounting department;
  "most of these are average nationwide rates" (STATED).
- **The gap:** the biggest locum-native brand's public data product is W2-annual. It
  validates our core design decision: locum and permanent comp are different economic
  populations, and our schema enforces that separation at the row level
  (`evidence_employment_arrangement`, 5-value CHECK — Supabase migration
  `20260521203841_evidence_canonicalization_a2.sql:469-477`; `RateObservation` makes
  `isLocum: true` a compile-time invariant with a required `employmentEvidenceSpan`,
  `src/lib/rate-engine/rateObservation.ts:38-46`).

### F4. Barton Associates — the "salary tool" as pure lead-gen

- Fetched 2026-07-03 ([bartonassociates.com/salary-tool](https://www.bartonassociates.com/salary-tool/)): inputs are role
  (physician/NP/PA/dentist/CRNA) + specialty; the surfaced output is "Up to 32%"-style
  potential earnings INCREASES, not rates; "no disclosure regarding data sources ...
  methodology ... whether figures represent hourly or annual compensation."
- **The gap:** this is what agency rate tools converge to when accuracy isn't the
  product: a teaser percentage and a recruiter contact form. An accuracy-first tool with
  visible provenance is positioned directly against this pattern.

### F5. Marit Health — the credible threat: verified crowdsourced locum hourly data

- **What it is:** anonymous, verified clinician salary sharing; give-to-get ("share your
  anonymous salary to unlock full access"); founded with Glassdoor alumni; $3.2M seed led
  by Define Ventures with Rich Barton participating (STATED, [PR Newswire 2025](https://www.prnewswire.com/news-releases/marit-health-launches-groundbreaking-community-powered-platform-for-salary-transparency-in-medicine-secures-3-2m-seed-round-302413389.html)).
- **Scale (STATED → claims_to_verify):** ~27,000 anonymous clinician salaries; physician
  average $465,596 / median $414,000 on 20,466 salaries (as of 2026-06-24, per
  [marithealth.com](https://www.marithealth.com/o/-/physician/salary)).
- **⚠ LOCUM COVERAGE EXISTS:** Marit publishes locum-specific hourly pages —
  "Locum Tenens Physician Salary (2026) — $290/hr Avg"
  ([marithealth.com/o/locums/physician/salary](https://www.marithealth.com/o/locums/physician/salary)) and
  "Locum Tenens Family Medicine Physician Salary (2026) — $156/hr Avg"
  ([marithealth.com/o/locums/family-medicine-physician/salary](https://www.marithealth.com/o/locums/family-medicine-physician/salary)); example
  submission granularity includes hours/week and city (a $150/hr FM position at 40
  hrs/week in New York, NY). All STATED → claims_to_verify (pages 403 direct fetch;
  figures from search-index snapshots 2026-07-03).
- **Methodology posture (STATED):** outlier removal + "de-biasing adjustments";
  per-submission drill-down ("explore the anonymized, individual salaries underlying the
  averages"); real-time updates as submissions arrive; specialty panels are small and
  self-selected (e.g., 352 OB/GYN submissions as of April 2026).
- **What they get right:** observed (self-reported but structured) data, per-observation
  transparency, workload/call-structure fields, freshness. This is the only competitor
  whose product philosophy overlaps ours ("show the underlying observations").
- **The gap we exploit:** (1) self-report ≠ market-typed — our taxonomy would classify
  Marit rows as `crowd_survey` (precedence 2, context-only, never an anchor —
  `bridge-rate-intelligence.ts:77-90` via map 03); no employment-evidence span, no URL
  provenance, thin per-cell n. (2) No recruiter surface: no bill rate, no margin, no
  facility/shift/duration pricing, no call-stipend comp-model typing. (3) Clinician-first
  give-to-get gating blocks embedding — a recruiter can't quote from it in a workflow.
  (4) Small-n locum cells vs our multi-source triangulation (n≥4 + ≥2 independent
  families before anything anchors, `marketRates.ts:469-551`).
- **Strategic note:** Marit is simultaneously a partner candidate — a `crowd_survey`
  context rung already exists in our enum, so licensed/partnered Marit aggregates could
  light up context panels without ever touching the anchor.

### F6. SalaryDr — NPI-verified crowdsourcing (the verification bar we should match)

- **Methodology (STATED, [salarydr.com/methodology](https://www.salarydr.com/methodology)):** every submission requires an
  NPI validated in real time against the NPPES registry; automated outlier screening;
  flagged rows go to human review; rolling daily recalculation of medians/percentiles;
  3,000+ verified submissions.
- **What they get right:** identity verification (NPI→NPPES) is a cheap, strong
  anti-fabrication gate; daily rolling stats vs annual surveys.
- **The gap:** W2-annual focus, small n, no locum-specific product, no comp-factor
  modeling. But their verification pattern is directly reusable if we ever accept
  physician-submitted locum rates (would enter our pipeline as `crowd_survey`, context
  rung, per the trust ladder).

### F7. Doximity & Medscape — the big W2 surveys (context ceiling, not competition)

- **Doximity 2025 report:** surveyed 37,000+ full-time physicians (Jan–Dec 2024), drew on
  230,000+ compensation surveys over six years; responses mapped to MSAs, top 60 MSAs
  ranked; controls for geography, specialty, tenure, self-reported hours. Salary Map
  gated behind completing their own comp survey annually. Own disclaimer: "Survey
  participant demographics are not population-based" (all STATED,
  [doximity.com report](https://www.doximity.com/reports/physician-compensation-report/2025), [support.doximity.com](https://support.doximity.com/hc/en-us/articles/9822138097171-The-Salary-Map-Feature-Completing-The-Salary-Survey)).
- **Medscape 2025 report:** 7,322 U.S. physicians across 29+ specialties; online
  self-selected survey; stated margin of error ±1.15% at 95% (STATED,
  [medscape.com](https://www.medscape.com/slideshow/2025-compensation-overview-6018103), [PR Newswire](https://www.prnewswire.com/news-releases/medscapes-2025-physician-compensation-report-small-pay-gains-increasing-financial-pressures-302428344.html)). Salary Explorer tool is
  paywalled (HTTP 402 on fetch, 2026-07-03).
- **Relationship to us:** these are exactly the `permanent_wage_proxy` class our pipeline
  retains as labeled context but structurally bars from anchoring
  (`rate_type_classifier.py` short-circuit; absent from `DEFAULT_ANCHORABLE_RATE_TYPES`,
  `marketRates.ts:419-422`). The dormant BLS sanity layer converts W2 wages to locum
  plausibility ceilings via per-SOC multipliers (`blsSanityCheck.ts:73-89`,
  self-labeled "observation-derived midpoints, NOT primary-source-cited") — the correct
  use of W2 data: cross-check, never quote.

### F8. MGMA DataDive — the only competitor with call/daily-rate granularity, and it's paid + perm

- **Granularity (STATED, [mgma.com/datadive](https://www.mgma.com/datadive/provider-compensation)):** percentiles 10th–90th
  (beyond that = paid custom analysis); explorable by annual comp, **daily rate, weekend
  rate, holiday rate, hourly rate, filtered by on-call coverage type**; segmented by
  ownership, academic, medical directorships, starting salaries.
- **What they get right:** MGMA is the only player publishing day-type-split on-call
  compensation percentiles — the closest analogue to our `CALL_RATE_DATA` per-day-type
  bands (`callRates.ts:34-353`).
- **The gap:** employer-reported W2/employed-provider data, expensive (pricing
  undisclosed publicly; enterprise sales), annual cycle, and NOT locum. A recruiter
  cannot price a 1099 weekend beeper stipend from it. Our call path already types
  comp-model (beeper vs worked-day, `types.ts:229-233`) — no competitor distinguishes
  these at all — but only 19/88 specialties carry a quotable daily band today (map 01 §6),
  so the moat is real yet thin.

### F9. Resolve (rData) — contract-verified perm comp; the provenance bar for documents

- **STATED ([resolve.com/the-data](https://www.resolve.com/the-data), [AMA](https://www.ama-assn.org/medical-residents/transition-resident-attending/check-out-must-have-dataset-physician-salary), [whitecoatinvestor.com](https://www.whitecoatinvestor.com/physician-salary-and-contract-comparison-data-from-resolve/)):** 30,000+
  attorney-reviewed physician employment contracts; compares 11 contract terms; filter by
  specialty/location; updated daily.
- **What they get right:** document-verified observations (a real contract, not a survey
  answer) — the strongest provenance class in the field. Analogous to our
  `actual_paid_locum` top rung (precedence 4).
- **The gap:** permanent-employment contracts; no locum/1099 vertical found; gated
  product attached to contract-review services.

### F10. Vivian Health & Ivy Clinicians — posting-level transparency proves the embeddable model (in adjacent verticals)

- **Vivian (nursing/allied):** every job on the marketplace must list transparent pay;
  salary pages aggregate ACTUAL posted jobs down to city level; monthly travel-RN wage
  trend reports across all 50 states (STATED, [vivian.com/salary](https://www.vivian.com/salary/), [hire.vivian.com](https://hire.vivian.com/blog)).
  This is `advertised_clinician_pay` at scale — the same trust class as our anchorable
  rung 3.
- **Ivy Clinicians (EM):** free EM job board; launched Aug 2022; charges employers 1.9%
  of first-year salary on signed contracts; own salary survey collected 947 entries
  (2023-01-01→2024-11-21); partnered with ACEP on "Open Book"; their market framing:
  fewer than 10% of community EM job posts list pay (all STATED,
  [ivyclinicians.io](https://www.ivyclinicians.io/), [emworkforce.substack.com](https://emworkforce.substack.com/p/emergency-physician-compensation)).
- **The gap/lesson:** both prove that posting-derived, provenance-visible pay data wins
  trust in a vertical — but neither touches physician locums (Vivian) or locum rates at
  all (Ivy is perm/employed EM). The locum posting universe is exactly what our scraper
  fleet + `advertised_clinician_pay` bucket is built to capture, with dedup and family
  collapse those platforms don't need (they own their postings; we triangulate everyone
  else's).

### F11. ZipRecruiter / Adzuna / generic comp sites — the contamination class (we already learned this the hard way)

- ZipRecruiter's "Locum Tenens Salary" page (STATED, [ziprecruiter.com](https://www.ziprecruiter.com/Salaries/Locum-Tenens-Salary)):
  average $311,794/yr, 25th–75th percentile $222,500–$400,000 — an annualized blended
  number that answers no locum pricing question. Their own docs say estimates derive
  "from employer job postings and third party data sources"
  ([support.ziprecruiter.com](https://support.ziprecruiter.com/candidate/s/article/What-is-the-ZipRecruiter-Compensation-Estimate)) — i.e., modeled.
- **Code-documented production incident (OBSERVED in code, figure flagged for
  re-verification):** "the CRNA spike: ZipRecruiter $124.86 ≈ HALF the real locum
  $200-250" — the reason ZipRecruiter/Adzuna are NEVER-ANCHOR sources excluded at the
  bridge's row-admission gate (`sourceFamily.ts:105-121`; admission filter per map 03
  §3.1). No competitor tool we found discloses ANY equivalent source-exclusion policy.

### F12. Clinician-side calculators (LocumCalc, TheLocumGuy, locums.com estimator) — arithmetic, not intelligence

- **LocumCalc** ([locumcalc.com](https://www.locumcalc.com/)): free contract comparison for
  CRNA/NP/PA/physician — hourly rate, housing stipend, travel, overtime → "true hourly
  rate." User supplies every number.
- **TheLocumGuy calculator** (fetched 2026-07-03, [thelocumguy.com](https://thelocumguy.com/locum-tenens-salary-calculator/)):
  shifts/month × user-entered hourly rate → gross annual; hospitalist-centric; "minimal
  transparency regarding calculation methodology"; anchor claim "$150/hr or higher" as a
  reasonable hospitalist rate (STATED). Note: TheLocumGuy is ALSO one of our curated
  prior's named sources (`specialties.ts:4`).
- **The gap/lesson:** these tools model the physician's TAKE (stipends, overtime, taxes)
  better than we do — our GSA per-diem table is dead code in the live hub
  (`callRates.ts:378-404` with zero hub consumers, map 05 §2.3) and bonuses are actively
  filtered as noise (`card_extractor.py:88-90` per map 05 §2.4). They have no market
  data; we have market data but no all-in-value view. Combining both is an open win.

### F13. Recruiter/facility side — VMS rate benchmarking is a vacuum we're uniquely positioned in

- Industry commentary (STATED, [hallmarkhcs.com](https://www.hallmarkhcs.com/fixing-locum-tenens-part-3-readiness/)): in locums,
  "rate benchmarking, if it happens at all, relies on vendor-reported data"; locums ≈
  $10B market with <30% sourced through centralized third-party solutions.
- **Our asymmetry:** IMS already ingests LocumSmart Partner-API job data (bid ceilings:
  `rateRequirements.max*` medians per HCO/specialty — `liveCalibration.ts:23-69`,
  currently dormant in the hub) and has quote-outcome telemetry tables waiting
  (`quote_events`/`quote_outcomes`, migration `20260604000000_quote_regret_telemetry.sql`
  per map 06). No public competitor has an observed bid-ceiling feed OR a won/lost quote
  loop. AMN posts per-job locum ranges (e.g., critical care trauma surgery "$281 to $305
  per hour" on its careers page, STATED → claims_to_verify) sourced from "active locum
  tenens physician job postings and market-aligned AMN Healthcare assignment data" — but
  per-job, not a tool, and single-family by construction.

---

## Differentiation table — where an accuracy-first, provenance-backed, embeddable locum engine wins

| Capability | LocumStory/CHG pages | Barton/agency tools | LocumTenens.com | Marit | SalaryDr | Doximity/Medscape | MGMA DataDive | Resolve | Vivian/Ivy | ZipRecruiter class | **IMS engine (today / designed)** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Locum-1099-specific rates | ✅ (hourly ranges) | teaser only | ❌ (survey is W2) | ✅ (new, thin n) | ❌ | ❌ | ❌ | ❌ | ❌ (adjacent verticals) | ❌ (blended) | ✅ enforced at type level (`rateObservation.ts:38-46`; W2 never anchors) |
| Disclosed methodology | ❌ | ❌ | partial (survey dates) | partial | ✅ (NPI+review) | ✅ | ✅ | ✅ | ✅ (postings) | ❌ | ✅ designed (trust ladder, gates, telemetry) — not yet user-visible |
| Per-observation provenance (source, URL, citation span) | ❌ | ❌ | ❌ | partial (row drill-down, no source docs) | ❌ | ❌ | ❌ | ✅ (contracts, gated) | ✅ (the posting IS the source) | ❌ | ✅ schema shipped (`cited_text`/`char_range`/`employment_evidence_span`, a2+chunks migrations) — read-path deferred |
| Multi-source triangulation + independence guards | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | n/a | ❌ | ✅ live (dedup ×2, family collapse, 60% cap, n≥4 + ≥2 families anchor gate — map 03) |
| Call / per-diem daily stipends, comp-model typed | ❌ | ❌ | ❌ | partial (call-structure survey field) | ❌ | ❌ | ✅ (on-call cuts, perm, paid) | ❌ | ❌ | ❌ | ✅ unique typing (beeper vs worked-day, `types.ts:229-233`) but 19/88 quotable + no live DAY feed (defect) |
| Shift/facility/geo/duration comp factors priced | ❌ | ❌ | ❌ | ❌ | ❌ | geo only (MSA avgs) | filters | filters | city-level postings | ❌ | ✅ multiplier chain live (`rateCalculator.ts:656-726`) — values ESTIMATED, need observed calibration |
| Percentile placement in a real distribution | ❌ | ❌ | ❌ | partial (submission list) | partial (rolling percentiles, W2) | ❌ (averages) | ✅ (10th–90th, W2, paid) | ✅ (gated) | ❌ | fake | ❌ **today ours is fabricated-shape too** (linear min→max interpolation, `sim-adapter.ts:372`) — Move #2/#3 gap |
| Recruiter workflow: pay + bill + margin | ❌ | ❌ | partial (ROI calc) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ live (margin slider, dual quote paths) |
| Freshness | annual | n/a | annual | real-time (self-report) | daily | annual | annual (6–18mo lag) | daily | real-time postings / monthly reports | modeled | daily bridge, 7-day observation window (map 03) |
| Embeddable / API | ❌ | ❌ | ❌ | ❌ (give-to-get gate) | ❌ | ❌ | ❌ (enterprise) | ❌ | ❌ | API for jobs, not rates | 🔲 designed (portability pillar) — nobody else even attempts it |
| Honest insufficiency (refuses to fabricate) | ❌ (always shows a range) | ❌ | ❌ | partial (shows n) | partial | n/a | n/a | n/a | n/a | ❌ (models everything) | ✅ live (null call bands → "insufficient public data", `rateCalculator.ts:790-805`; bimodal cells refuse a point estimate) |

**Net position:** we are the only entrant whose architecture treats accuracy as an
adversarial problem (dedup, family independence, never-anchor lists, cite-or-suppress).
The three places competitors beat the LIVE surface today: Marit's per-observation
drill-down transparency (our provenance is in the schema but not on the screen), MGMA's
real percentiles (ours are linear-interpolation shape), and clinician calculators'
all-in-value math (our stipend/bonus signals are dead code or discarded).

---

## Recommendations

1. **Ship a "Why this number" provenance panel on every quote** — n_distinct, source
   families, rate-type trust class, freshness, and (when Observe-and-Cite read-path
   lands) the cited text spans. Everything but the spans is ALREADY in the RTDB bucket
   the hub reads (`MarketBucketData`: n_distinct, source_families, confidence —
   `marketRates.ts:84-94`). This is the single cheapest differentiator: no competitor
   shows provenance, and it converts our internal honesty machinery into visible trust.
   **[impact: high | effort: low]**
2. **Replace fabricated-shape percentiles with observed-distribution placement (Moves
   #2/#3).** Marit shows raw submissions; MGMA sells real percentiles; our own map calls
   the linear min→max interpolation the north-star gap (map 01 §10.2, S6). Persist
   per-cell observation quantiles in the bridge (it already holds every distinct
   observation pre-aggregation) and render honest bands with shrinkage for thin cells.
   **[impact: high | effort: medium]**
3. **Un-drop the DAY unit and build the call-band overlay path.** The highest-variance
   comp surface (daily call stipends) has zero live corroboration because
   `agent.py:491-493` drops DAY rows and the overlay only mutates hourly bands (map 05
   §1). MGMA is the only competitor with day-type granularity and it's paid+perm — this
   is our clearest defensible moat, currently starving (19/88 specialties quotable).
   **[impact: high | effort: medium]**
4. **Capture stipend/bonus side-channels at parse time instead of destroying them.** The
   extractor already sees weekly stipends and sign-on bonuses and discards them as noise
   (`card_extractor.py:37-42,88-103`). Clinician calculators (LocumCalc) and LocumStory's
   "15–25% effective value" framing prove physicians think in all-in terms. Side-channel
   fields are nearly free while pages are already fetched; pricing them can come later.
   **[impact: medium | effort: low]**
5. **Weaponize the proprietary feeds no competitor has: LocumSmart bid ceilings +
   quote-outcome telemetry.** `liveCalibration.ts` (observed bid-ceiling medians) and
   `quote_events`/`quote_outcomes` are built and dormant. A won/lost feedback loop turns
   the simulator into the only tool calibrated against real placement outcomes — the
   VMS-vacuum finding (F13) says nobody else can. **[impact: high | effort: medium]**
6. **Build the embeddable/API surface (portability pillar) before Marit does.** Marit's
   give-to-get gate structurally prevents embedding; agencies won't expose methodology;
   MGMA is enterprise-priced. A provenance-stamped quote widget/API for Discord/Slack/ATS
   is uncontested space today. **[impact: high | effort: high]**
7. **Break the LocumStory circularity in the curated prior.** Re-audit curated bands whose
   only sources are competitor marketing pages (LocumStory/TheLocumGuy per
   `specialties.ts:3-5`) as fleet data arrives, and surface "prior source class" in the
   provenance panel so a CHG-derived prior is never displayed with the same weight as an
   observed posterior. (Cited re-audit is already a named follow-up in project memory.)
   **[impact: medium | effort: medium]**
8. **Publish a public methodology page.** Every trust-winning competitor (SalaryDr,
   Doximity, MGMA) discloses method; every agency tool hides it. We have the rare
   position where full disclosure (gates, never-anchor lists, family collapse, honest
   insufficiency) is a marketing asset because it is real. **[impact: medium | effort: low]**
9. **Evaluate Marit/SalaryDr as `crowd_survey` context partners, and NPI-style
   verification for any future physician-submitted rates.** The enum rung exists
   (precedence 2, never anchors); partnership fills context panels for thin specialties
   without compromising the anchor gate. **[impact: low | effort: medium]**

---

## Open questions

1. **Marit's locum sample sizes per specialty** — their locum pages 403 direct fetch; we
   only have headline averages from search snapshots. How thin are their locum cells
   (n per specialty/state)? Determines whether they're a threat in 12 months or 3.
2. **Does CHG's pay-trends report use internal fill data?** If yes, their numbers are the
   best-informed in the market despite zero disclosure — which raises the bar for our
   observed-data corroboration before we contradict them publicly.
3. **AMN per-job range provenance** — are AMN's posted locum ranges
   (`$281–305/hr` example) computed from assignment data per their claim, and are they
   scrapeable at scale as `advertised_clinician_pay` (AMN is already a modeled family in
   `sourceFamily.ts`)?
4. **MGMA on-call locum contamination** — does any MGMA on-call/daily-rate cut include
   1099 locum arrangements, or is it purely employed providers? Affects whether MGMA can
   ever be a legitimate `crowd_survey`-class context source for call bands.
5. **Is there any public locum-rate API we missed?** None found in this pass (searches
   2026-07-03), but "no public locum rate API exists" is a negative claim — flag as
   UNVERIFIED and re-check before using it in marketing copy.
6. **Ivy/ACEP Open Book expansion** — will the ACEP partnership push posting-level pay
   transparency into locum EM postings? If so, EM becomes the first specialty where
   `advertised_clinician_pay` coverage could rival curated bands.
7. **ZipRecruiter locum annualization** — their $311,794 average: what mix of W2 perm,
   employed "locum-titled" roles, and true 1099 postings feeds it? Useful to document as
   the canonical example of why blended aggregators are NEVER-ANCHOR.
