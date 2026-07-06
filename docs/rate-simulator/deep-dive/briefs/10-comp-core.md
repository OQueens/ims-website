# Brief 10 — Compensation Taxonomy Part 1: CORE PAY STRUCTURE

> Deep-dive brief, 2026-07-03. Pillar: how locum physician pay is STRUCTURED (the unit and
> arrangement of the number itself), and what the LIVE engine (imstaffing.ai/hub, served by
> `ias-website` — `src/lib/rate-engine/` + `src/lib/hub/`) must change to model each structure
> first-class. Companion maps: `../maps/05-comp-factors-today.md` (factor scorecard) and
> `../maps/03-market-posterior-bridge.md` (pipeline). All code paths relative to
> `C:/Users/oclou/QueenClaude/` unless shortened; the live engine root is
> `ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/`.
>
> Labels: **OBSERVED** = read from code or a fetched named source. **ESTIMATED** = a
> research-derived midpoint with no primary citation. **UNVERIFIED** = flagged for the
> fact-checker (also listed in claims_to_verify).

---

## Summary

Locum pay is quoted in at least five distinct core structures — **hourly**, **daily**,
**per-shift**, **call-period stipend**, and **$/wRVU production** — layered under one
arrangement axis (**W2-locum vs 1099-locum**) and two contract-floor mechanisms
(**minimum-hour guarantees** and **overtime differentials**). The live engine is
first-class on exactly ONE of these: the hourly band. Daily observations are typed but
**dropped before persistence** (`agent-sdk/agents/rate_scraper/agent.py:491-495`), per-shift
rates are folded into the DAY unit and then dropped with it (`card_extractor.py:67`), wRVU
rates are **actively rejected** (`card_extractor.py:69-70`), guarantees have **zero
representation** anywhere in the three repos, and overtime exists only as a dormant
observed-bid-ceiling display layer no hub module consumes (`rate-engine/liveCalibration.ts:34`,
exported at `rate-engine/index.ts:36`, zero hub call sites). The W2↔1099 relationship is
modeled in three unlinked layers whose multipliers disagree by design intent (sanity vs
literature-prior vs exclusion), which is itself the strongest internal evidence that **no
single W2→1099 multiplier may ever be hardcoded**: external cited premia span 20% to 75%
depending on what is being compared, and the engine's own per-family sanity multipliers span
1.35–3.50. For the north star (price EVERY specialty the way a recruiter would actually pay
it, plus honest percentile), the unit gap is the largest structural defect: entire specialty
segments (clinic worked-day, ED per-shift, teleradiology production) transact in non-hourly
units the pipeline cannot see, so their live corroboration is structurally zero and their
"market position" bar is an hourly fiction.

---

## Findings

### F1 — Hourly rate: the only live currency, correctly dominant but not universal

**Definition.** A flat $/hr for time worked; the assignment quotes an hourly figure and hours
are tallied on timesheets.

**When it applies.** The most common locum structure. CompHealth: "Most locum tenens
physicians are paid hourly, though some assignments offer daily or shift-based rates"
(comphealth.com/resources/how-locum-tenens-pay-works, fetched 2026-07-03 — OBSERVED).
Dominant for hospitalist, EM (often expressed per shift but reducible), anesthesia, CRNA,
psychiatry, outpatient coverage.

**Cited ranges (OBSERVED, external).**
- CompHealth 2026 specialty hourly ranges: anesthesiology $300–$425/hr, emergency medicine
  $250–$300/hr, family medicine $120–$135/hr, general surgery $150–$200/hr, hospitalist
  $170–$190/hr, OB/GYN $150–$200/hr (same fetch).
- Physician Side Gigs community survey: average ≈ $215/hr across specialties, full range
  $60–$500/hr; gastroenterology $367/hr (highest reported), general pediatrics $108/hr
  (lowest), anesthesiology $292/hr, EM $258/hr, FM $140/hr
  (physiciansidegigs.com/average-hourly-locums-rates-by-specialty, fetched 2026-07-03).
- Note the CompHealth vs Physician Side Gigs disagreement on general surgery ($150–200 vs a
  survey population that peaks far higher) — evidence that even the hourly axis needs
  source-family provenance, which the engine already has (bridge family collapse,
  `ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts:527-599`).

**Engine today (OBSERVED, code).** First-class: `SPECIALTIES` curated bands
(`rate-engine/specialties.ts:16` — "All rates are HOURLY PAY rates for locum tenens
assignments (not permanent employment)"), multiplier chain + 1.75× ceiling + researched-max
clamp (`rate-engine/rateCalculator.ts:656-726`), live posterior anchor via
`applyMarketBucketsOverlay` (`rate-engine/marketRates.ts:469-551`, gate: market-typed
rate_type ∧ n_distinct≥4 ∧ ≥2 families). The scraper's hourly magnitude band is $60–$900/hr
(`card_extractor.py:72`) — consistent with the Physician Side Gigs $60–$500 observed range,
with headroom.

**Gap vs north star.** The "market position" percentile is not a percentile: legacy p70 is
`min + 0.7·(max−min)` over extrema (`aggregateBridge.ts:743-750`), the live anchor is a
weighted mean inserted into the p70 slot, and the displayed percentile ticks are linear
interpolation of the curated band (`hub/sim-adapter.ts:372`). Map 03 §S6 already names this;
it is a core-pay-structure defect because a true distribution must be **per unit** (hourly
observations only) to be honest.

### F2 — Daily / worked-day rate: typed end-to-end, then thrown away

**Definition.** A fixed $ per worked day (e.g. clinic 8a–5p), independent of minor hour
variation. Distinct from a 24-hr call stipend (F4) — mixing them is the #1 quality risk named
in the engine's own call research (`rate-engine/callRates.ts:13-16`).

**When it applies.** Clinic-based specialties (FM/IM outpatient, OB/GYN clinic days),
surgical worked days, government/IHS-style contracts. NALTO (industry association) still
describes locum pay as "typically paid by the day" (nalto.memberclicks.net Q&A, fetched
2026-07-03 — OBSERVED, though dated in style; the modern agency consensus is hourly-first per
CompHealth above). ResidencyAdvisor's structure taxonomy gives the canonical example:
"$2,000/day, 8a–5p, clinic, no call"
(residencyadvisor.com/resources/physician-salaries-guide/locums-tenens-compensation-rate-structures-travel-stipends-and-hidden-costs,
fetched 2026-07-03).

**Cited ranges (OBSERVED, external — flag source quality).** SalaryDr publishes locum daily
bands: family medicine $1,200–$1,600/day, EM $1,800–$2,800/day, psychiatry $1,800–$2,500/day,
anesthesiology $2,500–$3,500/day, general surgery $2,200–$3,200/day
(salarydr.com/blog/locum-tenens-vs-permanent-salary-comparison, fetched 2026-07-03).
SalaryDr is a crowd-sourced salary site — treat as `crowd_survey`-class context, never an
anchor (consistent with `BUCKET_PRECEDENCE`, `rate-engine/marketRates.ts:119-124`).

**Engine today (OBSERVED, code).** The extractors type DAY correctly with a $400–$12,000/day
magnitude band (`card_extractor.py:73`, `jsonld_parser.py:40`) and cross-unit leak protection
(`_DOLLAR_HOUR`/`_DOLLAR_DAY`, `card_extractor.py:48-53`), but the posting producer drops
every non-HOUR row: `if row.get("unit") != "HOUR": _POSTING_UNIT_UNSUPPORTED_COUNTER[0] += 1;
continue` — "a lossy DAY→HR conversion is a deliberate fleet-phase decision (no-fake-data)"
(`agent.py:491-495`). Inside the engine, daily exists ONLY on the call-only path
(`CALL_RATE_DATA` worked-day bands, e.g. OB/GYN weekday `worked(3900, 4200, 4050, 12)`,
`callRates.ts:40` — OBSERVED, cited in-file to a 2026 agency salary guide). A non-call daily
posting (the $2,000 clinic day) is **unquotable**: `calculateCallRate` fires only when
`factors.callOnly.isCallOnly` (`hub/sim-adapter.ts:312`), and the hourly path has no daily
output. Calibration entries do carry `rateMode: 'hourly' | 'call_daily'` with a $1,000
magnitude classifier for legacy rows (`marketRates.ts:562-609`), whose rationale — "hourly
rates top out around $400-$425/hr … daily call stipends start ~$1000" — is code-cited to
Locumstory 2025/CompHealth (`marketRates.ts:591-598`, OBSERVED in code, worth re-verifying).

**Consequence.** The comp structures with the highest dollar variance (daily/call) get zero
live corroboration; `CALL_RATE_DATA` can only decay from its 2026-06-03 research snapshot
(`callRates.ts:4-7`). Map 05 §1 names this the single load-bearing consequence of the
current design.

### F3 — Per-shift rate: exists in the market, invisible as a distinct unit

**Definition.** A block rate for a defined shift: "$2,400 per 12-hour ED shift, 7a–7p" or
"$3,000 per 24-hour in-house call" (ResidencyAdvisor, same fetch — OBSERVED). Economically a
daily rate WITH a declared hour divisor, which is exactly what makes it safely convertible
to $/hr — unlike a bare daily.

**When it applies.** EM, hospitalist/nocturnist, critical care, OB hospitalist — shift-work
specialties. Hybrid forms exist: "$1,800 per weekday, plus $250/hour after 5 pm for
call-backs" (ResidencyAdvisor, same fetch).

**Engine today (OBSERVED, code).** "shift" is a DAY-word in the extractor
(`_DAY_WORDS = {"day", "daily", "shift"}`, `card_extractor.py:67`), so a per-shift rate is
classified DAY → then dropped at `agent.py:491`. The shift LENGTH is never captured, so even
if DAY rows were persisted, the honest $/hr divisor would be missing. The engine's only
"shift" concept is the hourly premium table `SHIFT_MULT` (day 1.00 / night 1.20 / weekend_day
1.15 / weekend_night 1.30 / holiday 1.35, `rate-engine/multipliers.ts:13-19` — ESTIMATED
band midpoints; the in-file comment cites CompHealth/Weatherby ranges and a nocturnist delta
"$179-200 vs $140-160 day = ~20%", `multipliers.ts:11-12`). The call-only path already
demonstrates the correct pattern: `coverageHrs` as an explicit honest divisor
(`types.ts:244-250`, divisor applied at `hub/sim-adapter.ts:315-316`).

### F4 — Call-period stipend (the OTHER "per diem") — covered in Part 2, cross-referenced here

The 24-hr beeper/availability stipend is a distinct core unit (e.g. neurosurgery beeper
$4,200–$4,800/day typical $4,500, cited in-code to Lancesoft OH + Ascend AR locum_1099
DocCafe postings, `callRates.ts:73-82` — OBSERVED). It is first-class but static-only, and
Physician Side Gigs confirms the market shape: "a minimum flat rate for a set call period
(such as 24 hours)" with separate hourly rates for worked callback hours (same fetch). Full
treatment (gratis hours, callback differential, beeper-vs-worked-day) belongs to Taxonomy
Part 2 (call pay); it appears here only because any `pay_unit` enum must include it as its
own value, never conflated with worked DAY (per `types.ts:229-233` doctrine).

### F5 — wRVU / production-based pay: a real (teleradiology-led) segment, actively rejected

**Definition.** $ per work Relative Value Unit read/generated; pay = volume × rate, possibly
above a guaranteed base.

**When it applies.** Teleradiology is the live epicenter; also some pathology and
high-throughput diagnostics; hybrid "guaranteed base day/shift rate plus RVU bonus above a
high, clearly stated threshold" is the recommended contract form (ResidencyAdvisor, same
fetch — OBSERVED as a recommendation, not a rate).

**Cited figures (OBSERVED, external — niche source, verify).** locumpayguide.com (2026
radiology guide, fetched 2026-07-03): platforms advertise "$45 per wRVU, with targets that
require sustained reading volume," with claimed effective "$450–$500/hr range contingent on
the radiologist hitting specific wRVU thresholds," and the guide's own caveat: "the effective
hourly rate is contingent on productivity, not guaranteed." Same source: onsite radiology
locum hourly $330–$520/hr. A search-result synthesis also attributed "$35/wRVU day, $38/wRVU
night" teleradiology figures to this space, but my direct fetch of the article did NOT
contain them — UNVERIFIED, needs a source.

**Engine today (OBSERVED, code).** Unquotable and uncapturable by design: `wrvu`/`rvu` are in
`_REJECT_UNIT_WORDS` (`card_extractor.py:69-70`) and `_DOLLAR_REJECT_UNIT`
(`card_extractor.py:37-42`); a $-figure attached to wRVU next to an hourly rate rejects the
whole parse (correct anti-poisoning, total signal loss). No engine type, no factor, no UI.
Radiology's curated hourly band therefore silently excludes the production sub-market — and
radiology was one of the 6 cells that moved most at the Move-#1 deploy (−22.2%,
memory/map 03 §5.3), so its evidence base is under active scrutiny already.

**Accuracy doctrine.** The locumpayguide caveat is the engine's own rule restated: an
effective hourly derived from assumed volume is a fabricated number. Capture $/wRVU as its
own unit; never convert to $/hr without a user-declared volume input.

### F6 — W2 ↔ 1099: why they differ, cited ranges, and why NO hardcoded multiplier

**The mechanics (OBSERVED, external).**
- Self-employment tax: a 1099 contractor pays both FICA halves — "Social Security: 12.4% up
  to $184,500 in 2026" + "Medicare: 2.9% with no earnings cap" vs the W2 employee's 7.65%
  share (locumstory.com/spotlight/w2-1099-locum-tenens, fetched 2026-07-03; corroborated by
  AMN: "the full FICA tax (15.3% …)" — amnhealthcare.com W-2 vs 1099 blog, fetched
  2026-07-03).
- Benefits self-funding: locumstory models W2 health insurance at $2,000/yr employee cost vs
  $8,000/yr individual marketplace, plus "$3-6K per year" accounting for a 1099. SalaryDr
  values a permanent position's total benefits at "$41,000–$83,000/yr" (health $15–25k,
  retirement match $10–25k, malpractice $10–50k, CME $3–5k, disability $3–8k, PTO
  "$20,000–$50,000 value" — note: those components sum past the stated total; internally
  inconsistent source, cite with care).
- Malpractice: on W2 locum arrangements the agency typically carries "comprehensive
  malpractice insurance, often with tail coverage" (AMN, same fetch); a 1099 may have to
  self-procure — a $/hr-equivalent difference that VARIES BY SPECIALTY (surgical tail ≫
  psychiatry tail), which alone breaks any flat multiplier.

**Cited premium RANGES (OBSERVED, external — note they measure different things).**
1. **1099-locum vs W2-locum (same work):** locumstory (CHG) advises 1099 assignments should
   pay "at least 20% more than similar W-2 assignments"; their worked example is $120/hr 1099
   vs $100/hr W2 netting "$4,700 more." ResidencyAdvisor's negotiation floor: "a 1099 rate
   that is only 5–10% higher than a W-2 alternative is not actually better." So the honest
   modeling band for the SAME assignment is roughly +10% to +25% — UNVERIFIED as a precise
   band; the two endpoints are cited, the interpolation is mine.
2. **Locum (any) vs permanent W2 salary-equivalent hourly:** SalaryDr: "often 25-75% more";
   Locumpedia: "up to $50 more per hour than a permanent doctor"; a Hanover Research/CHG
   study (cited by Wapiti Medical Staffing) puts it at "$32.45 more per hour" on average —
   UNVERIFIED, needs the primary study.
3. **Both markets exist:** AMN "offers a variety of W-2 and 1099 opportunities" (same fetch),
   so arrangement is a real observable dimension of postings, not a theoretical toggle.

**Engine today: three unlinked layers (OBSERVED, code — map 05 §2.7).**
- **Exclusion layer (live):** `permanent_wage_proxy` can never anchor
  (`marketRates.ts:119-124` BUCKET_PRECEDENCE absence + `DEFAULT_ANCHORABLE_RATE_TYPES`
  :419-422); annualized W2 numbers die at the unit gates; posting sources carry
  `evidence_employment_arrangement: "locum_tenens"`
  (`agent-sdk/agents/rate_scraper/posting_sources.py:108,129,145,169`).
- **Sanity layer (cross-check only):** `LOCUM_MULTIPLIER` per SOC family converts BLS W2
  wages to locum-plausibility ceilings — PHYSICIAN_LOW 1.35 … PHYSICIAN_HOSPITALIST 2.45,
  ANESTHESIA_APP 3.50, SURGEON_CORE 1.70 (`rate-engine/blsSanityCheck.ts:73-89`),
  self-labeled "observation-derived midpoints, NOT primary-source-cited" (:70-72) —
  ESTIMATED. Its arrangement parameter defaults to `'locum_w2'` "(IAS booking convention)"
  (`blsSanityCheck.ts:298,419` per map 05).
- **CRNA arrangement layer (dormant in hub):** full enum `w2_employee | 1099_independent |
  locum_w2 | locum_1099` (`rate-engine/crnaCellLookup.ts:48-53`) with literature-default
  multipliers `{w2_employee: 1.0, '1099_independent': 1.6, locum_w2: 1.4, locum_1099: 1.7}`
  (`crnaCellLookup.ts:652-660`, in-code cited to lokumapp 2025 hourly band ratios
  "1099 $190-$250 / W-2 $81-$204 = ~1.6" + B.7-AANA.md §5.2 — ESTIMATED, explicitly
  "LOW-CONFIDENCE PRIORS" per :646-649). Never runs live: Supabase is "intentionally NOT
  injected" into the hub sim (`hub/sim-live.ts:19-23` per map 05).

**Why the engine must NOT hardcode one multiplier (the argument, assembled).** (a) The two
external comparison classes (1099-vs-W2-locum ≈ +10–25%; locum-vs-perm ≈ +25–75%) are
routinely conflated by sources — a hardcoded number would bake in a category error. (b) The
engine's own three vocabularies disagree because they answer different questions (exclusion
vs plausibility ceiling vs CRNA prior) — collapsing them to one constant would silently
repurpose a sanity bound as a quote mover. (c) The premium is structurally specialty-varying
(malpractice class, benefits value vs income, SE-tax cap interaction at $184,500) and
time-varying (the SS wage base moves annually). (d) Project rule: no estimated data in the
quote path. The correct model is **arrangement as a bucket dimension with observed cells**,
multipliers used only as labeled, low-confidence context.

### F7 — Minimum guarantees: real market floors, zero engine representation

**Definition.** A contractual floor: guaranteed minimum paid hours per scheduled shift/day
(commonly the full scheduled block), a guaranteed flat rate per call period, or a floor on
per-shift comp under production models.

**Cited evidence (OBSERVED, external).** Physician Side Gigs: locums "can also have a
guaranteed minimum number of hours for their scheduled shifts," with "around 5-8 hour
minimums" reported, and "a minimum flat rate for a set call period (such as 24 hours)" (same
fetch). locumpayguide (radiology): negotiate "a minimum number of studies or a floor
guarantee on per-shift compensation" for production contracts (same fetch). KevinMD
(2026-02, Dr. Sriman Swarup): effective hourly "changes dramatically based on how the
contract counts hours, call, and overtime" — advisory, no figures.

**Engine today (OBSERVED, code).** Nothing. Grep for guarantee/minHours across
`src/lib/rate-engine` + `src/lib/hub` returns only unrelated comments (verified 2026-07-03).
The PDF parser captures sections verbatim (`rate-engine/parser.ts:167,191` per map 05) and
`detectIncludedHours` (`rateCalculator.ts:606-618`) proves the extraction pattern exists for
an adjacent concept — but no guaranteed-hours field, no day-floor math, no UI line. A
recruiter pricing "$220/hr, 8-hr daily guarantee" (ResidencyAdvisor's canonical hourly
example is exactly "$220/hour, 8-hour day") sees identical output to "$220/hr, no guarantee"
— yet the day floor ($1,760 vs $0) is a real cost/value difference the facility and physician
both price.

### F8 — Overtime: no public standard exists; the engine already OWNS the best observed signal and ignores it

**Definition.** A premium rate for hours beyond a contractual threshold (per-day 8/10/12 or
per-week 40). Physicians are FLSA-exempt (the learned-professional exemption covers the
practice of medicine, 29 CFR §541.304, and bona fide independent contractors are outside
FLSA entirely — UNVERIFIED citation, needs legal confirmation), so locum OT is purely
contractual: whatever the agreement says.

**Cited evidence (OBSERVED, external — for absence and presence).** Targeted searches for
standardized locum OT multipliers (1.25×/1.5× after 8/10/12) return no agency-published
standard; CompHealth says only that call/weekend/holiday "may earn a higher hourly rate";
Locumpedia's contract guide does not address OT at all. The honest external claim is:
**OT terms are assignment-specific and publicly undisclosed.**

**Engine today (OBSERVED, code — this is the buried treasure).** The LocumSmart Partner-API
feed carries per-job `rateRequirements.maxOvertimeMultiplier`, and `liveCalibration.ts`
already computes per-HCO and per-specialty medians (`rate-engine/liveCalibration.ts:34,
189, 223`). The file header records the one piece of REAL market intelligence on locum OT in
this codebase: "observed OT multiplier caps run ~1.3× but actual closed OT is ~1.0–1.1×; caps
and market rates are different quantities" (`liveCalibration.ts:9-13`, Session-17 correction
— OBSERVED bid-ceiling data, correctly labeled). No hub module consumes `observedHcoProfile`
(exported at `rate-engine/index.ts:36`, zero hub call sites — map 05 §2.10). Nothing in
`calculateRate` models an OT threshold or differential; the hourly quote implicitly assumes
straight time for all hours.

### F9 — Cross-cutting: the bill-rate margin split is a pay-structure inconsistency

Hourly bill = `roundUp5(pay/(1-m))` with a 15–45% slider, REC band 25–32%
(`hub/sim-adapter.ts:389-413`); call-only bill = fixed 20% margin `roundUp5(pay/0.80)`
(`hub/sim-adapter.ts:317-321`), a ported dashboard convention the code itself does not cite
as market fact (map 05 labels it CONVENTION). If daily/shift/wRVU become first-class quote
units (R1/R2), each needs an explicit margin policy decision — silently inheriting either
existing convention would be an unexamined pricing choice.

---

## Recommendations

**R1 — Make `pay_unit` a first-class dimension end-to-end.** [impact: high | effort: high]
Enum `HOUR | DAY | SHIFT | CALL_DAY | WRVU` (SHIFT = DAY + captured `shift_hours`; CALL_DAY
distinct per `types.ts:229-233` doctrine). Concretely: (a) stop the drop at
`agent.py:491-495` — persist non-HOUR rows to `rate_intelligence` with `unit` +
`shift_hours` columns (needs a Supabase migration + IronDome per-unit magnitude bands; the
$400–$12,000 DAY band already exists at `card_extractor.py:73`); (b) bridge: bucket key grows
to (specialty | state | rate_type | **unit**) so populations never mix — mirrors the existing
rate_type split at `aggregateBridge.ts:916-967`; (c) v2 schema: `buckets/{rateType}/{unit}`
or a parallel `units` subtree (whole-node-replace semantics already handle schema evolution,
bridge :888-904); (d) reader/overlay: hourly anchor logic unchanged; new units surface as
labeled context first (no quote change until R2). This is the prerequisite for live
corroboration of `CALL_RATE_DATA` and for any daily/shift quote. Never auto-convert units —
a DAY→HR conversion without observed `shift_hours` is fabrication (the code already says so,
`agent.py:492-494`).

**R2 — Worked-day quote path for non-call daily assignments.** [impact: high | effort:
medium] Today a plain "$2,000/day clinic" posting is unquotable (F2). Add a `payUnit` input
to `RateFactors` (default HOUR, additive — same pattern as `callOnly`), and when DAY: quote
from (i) observed DAY posteriors once R1 lands, (ii) `CALL_RATE_DATA` worked-day bands where
compModel = 'worked-day-clinic' as the curated prior, (iii) honest "insufficient public data"
surface otherwise (the surface already exists, `rateCalculator.ts:790-805`). Reuse
`coverageHrs` as the $/hr display divisor (`hub/sim-adapter.ts:315-316` pattern). Decide the
margin policy explicitly (F9).

**R3 — Arrangement (W2-locum vs 1099-locum) as an observed bucket dimension, never a
hardcoded multiplier.** [impact: high | effort: medium] (a) The scraper already emits
`evidence_employment_arrangement` per source (`posting_sources.py:108-169`) — thread it into
the bridge bucket key or as a bucket attribute; (b) quote surface: a visible badge "1099
locum rate" on every quote (today the arrangement is implicit and internally inconsistent —
the BLS sanity layer defaults to `locum_w2` "IAS booking convention" at
`blsSanityCheck.ts:298` while the curated bands are 1099-flavored per `callRates.ts`
locum_1099 citations; CONFIRM with Zach which arrangement IAS actually books, see Open
Questions); (c) a W2↔1099 toggle ships ONLY when observed cells exist for both arrangements
(AMN proves both exist in market); until then the toggle's second position renders labeled
context: the cited +10–25% same-assignment band (locumstory ≥20%; ResidencyAdvisor "5–10%
higher is not actually better") and the CRNA literature priors (1.4/1.6/1.7,
`crnaCellLookup.ts:652-660`) as LOW-CONFIDENCE prose, never as a computed dollar. (d) Add a
regression test asserting no code path multiplies a quote by any of the three multiplier
vocabularies (LOCUM_MULTIPLIER / LITERATURE_DEFAULT_LOCUM_MULT / any new constant).

**R4 — Minimum-guarantee fields + day-floor line.** [impact: medium | effort: low]
Additive `guarantee: { hoursPerDay: number | null, source: FactorSource }` on `RateFactors`;
parse patterns like "guaranteed 8 hours", "8-hour minimum" (clone the `detectIncludedHours`
regex pattern, `rateCalculator.ts:606-618`); manual-sim numeric input. Output: a display-only
"effective day floor = rate × guaranteed hrs" line (pure arithmetic on two user-known
numbers, no estimation). Also capture scraped guarantee text into a side-channel column at
parse time (the pages are already fetched — map 05 seam 8 argues this is nearly free).

**R5 — Wire the observed OT signal; add contractual OT inputs.** [impact: medium | effort:
low→medium] Low: surface `otMultiplierMedian` / `holidayMultiplierMedian` from
`liveCalibration.ts` on the hub quote as a labeled "observed bid-ceiling" context line
(consumer exists for none of it today; the honesty label is already written in the file
header, :9-13). Medium: add `ot: { multiplier: number | null, thresholdHrs: number | null }`
to `RateFactors` and price hours>threshold in a shift-total view — contract-term inputs, not
market estimates, so no fabrication risk. Do NOT install a default OT multiplier: the
observed caps (~1.3×) vs closed (~1.0–1.1×) gap (:11-13) proves a default would overquote.

**R6 — Capture wRVU rates as a side-channel unit; quote only with declared volume.** [impact:
medium | effort: medium] Extend the extractor to EMIT `unit='WRVU'` rows (magnitude band
roughly $20–$100/wRVU — UNVERIFIED band, set from the $35–$50 cited figures with headroom;
verify before shipping) instead of rejecting the whole parse when a wRVU figure co-occurs
(`card_extractor.py:37-42` currently nukes the row). Keep them out of every hourly band
(exclusion-by-absence from BUCKET_PRECEDENCE, the established idiom). Quote path: only a
user-supplied expected-volume input may produce an effective $/hr, rendered with the
locumpayguide-style caveat ("contingent on productivity, not guaranteed"). Radiology first —
it is both the wRVU epicenter and an already-flagged accuracy cell.

**R7 — Per-unit market-position honesty.** [impact: medium | effort: low] Until R1/R2 land,
gate the Market Position bar and percentile ticks to HOURLY quotes only (call-only already
returns `percentiles: []`, `hub/sim-adapter.ts:338`); any future daily/shift/wRVU quote must
plot against a same-unit distribution or show none. Prevents the category error before it
can ship.

---

## Open questions

1. **Which arrangement does IAS actually book by default — locum_w2 or locum_1099?**
   `blsSanityCheck.ts:298` says `'locum_w2'` "(IAS booking convention)" while the curated
   call bands cite locum_1099 postings and the whole quote is presented as a 1099 tool
   (task premise). This is a one-question Zach confirm and it determines the default badge
   in R3(b).
2. **What does LocumSmart's `maxOvertimeMultiplier` population look like today** (n, spread,
   per-specialty)? `liveCalibration.ts` computes it but nothing renders it; a one-off query
   would tell us whether the ~1.3× cap / ~1.0–1.1× closed observation (Session-17) still
   holds before R5 surfaces it.
3. **Do DAY-unit postings carry recoverable shift hours often enough to matter?** The R1
   design assumes `shift_hours` is frequently extractable ("12-hour ED shift" patterns). A
   50-posting sample from the existing fetch corpus would size the SHIFT vs bare-DAY split
   before committing the schema.
4. **Margin policy for non-hourly units (F9):** does the fixed-20% call margin convention
   extend to worked-day/shift bills, or does the 15–45% slider? Business decision, not a
   research question — but it blocks R2's bill output.
5. **wRVU magnitude band:** the $20–$100/wRVU IronDome band proposed in R6 is my headroom
   guess around cited $35–$50 figures — needs a proper multi-source pass before any row is
   accepted.
6. **The Hanover Research/CHG "$32.45/hr more than perm" study** — locate the primary
   publication (currently known only via Wapiti Medical Staffing's citation).
7. **Legacy calibration backfill:** `inferLegacyRateMode`'s $1,000 floor
   (`marketRates.ts:598`) was flagged in-code as needing an audit/backfill of legacy Firebase
   rows "before claiming zero migration risk" — still open, and R1's unit work touches the
   same seam.

---

## Source register (external, fetched 2026-07-03)

- CompHealth — "How does locum tenens pay and salary work for physicians?"
  https://comphealth.com/resources/how-locum-tenens-pay-works
- Physician Side Gigs — "Average Hourly Locum Tenens Pay Rate and Annual Earnings for
  Physicians, by Specialty" https://www.physiciansidegigs.com/average-hourly-locums-rates-by-specialty
- ResidencyAdvisor — "Locums Tenens Compensation: Rate Structures, Travel Stipends, and
  Hidden Costs" https://residencyadvisor.com/resources/physician-salaries-guide/locums-tenens-compensation-rate-structures-travel-stipends-and-hidden-costs
- Locumstory (CHG) — "W-2 vs. 1099: A complete guide for locum tenens professionals"
  https://locumstory.com/spotlight/w2-1099-locum-tenens
- AMN Healthcare — "W-2 vs. 1099: What Locum Tenens Physicians and APPs Need to Know"
  https://www.amnhealthcare.com/blog/advanced-practice/locums/w-2-vs-1099-what-locum-tenens-physicians-and-apps-need-to-know/
- SalaryDr — "Locum Tenens vs Permanent Position: Salary & Benefits Comparison"
  https://www.salarydr.com/blog/locum-tenens-vs-permanent-salary-comparison
- locumpayguide.com — "Radiology Locum Pay Guide 2026" (niche blog; verify independently)
  https://locumpayguide.com/radiology-locum-pay-guide-2026-rates-teleradiology-and-what-to-negotiate/
- Locumpedia — "No BS Locum Tenens Guide Part 5: Salary, Contracts, Taxes & Insurance"
  https://www.locumpedia.com/guides/no-bs/locum-tenens-salary-contracts-taxes-insurance/
- NALTO — "Q&A: Common questions about locum tenens pay rates"
  https://nalto.memberclicks.net/index.php?option=com_dailyplanetblog&view=entry&category=locums-life&id=9:q-a-common-questions-about-locum-tenens-pay-rates
- KevinMD — "Reviewing locum tenens agreements: Look beyond the hourly rate" (2026-02)
  https://kevinmd.com/2026/02/reviewing-locum-tenens-agreements-look-beyond-the-hourly-rate.html
- Wapiti Medical Staffing — "Locum Tenens Salary" (secondary cite of Hanover Research/CHG)
  https://www.wapitimedical.com/2025/06/09/locum-tenens-salary/ [not directly fetched]
