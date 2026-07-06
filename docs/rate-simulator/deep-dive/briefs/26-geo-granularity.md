# Brief 26 — Geo Granularity Below the State Level

> Deep-dive research brief, 2026-07-03. Pillar: metro/rural rate differentials, state
> attractiveness factors, metro-level data sources, and a geo-tier design for the cell key
> with an explicit shrinkage hierarchy.
>
> Scope discipline: the LIVE simulator is imstaffing.ai/hub served by `ias-website`
> (`src/lib/rate-engine`, `src/lib/hub`); the still-live data pipeline is the scraper
> (`agent-sdk/agents/rate_scraper` + `agent-sdk/shared`) and the bridge
> (`ias-dashboard/scripts/data-refresh`). All engine paths below are relative to
> `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/` unless
> absolute. OBSERVED = read from code or a named primary source; ESTIMATED = research-derived
> or secondary-source; every $ figure is listed in claims_to_verify for the fact-checker.

---

## Summary

Geography in the live quote today is exactly one number: a **static state multiplier**
(`STATE_MULT`, range 0.88–1.38) applied to a national curated band. There is **no sub-state
dimension anywhere on the live path**:

- The market-posterior cell key is `(specialty | stateKey | rate_type)` in schema, but live
  scraped rows are 100% state-NULL, so every live bucket is `stateKey='national'`
  (map 03 §S7; bridge comment at `aggregateBridge.ts`). Geo differentiation is carried
  entirely by the static engine.
- The rural multiplier was deliberately **neutralized to 1.0** in June 2026 after a
  double-counting audit (`rateCalculator.ts:660-669`); the only genuine rural premium left
  is the facility-type multiplier (CAH 1.22× / rural-trauma 1.30×, `multipliers.ts:23-36`,
  ESTIMATED) — and the hub's manual controls hard-code `facility: 'community'`
  (`hub/sim-adapter.ts:139`), so a recruiter pricing a critical-access assignment in the
  main flow **cannot express the single largest legitimate geographic premium the engine
  models**.
- BLS OEWS — the one metro-granular wage source the engine already consumes — is extracted
  **state-level only** (`extract-bls-oews.mjs:3-9`; `blsOewsBaseline.ts:42`), even though
  the May 2024 OEWS release publishes estimates for roughly 530 metropolitan +
  nonmetropolitan areas (BLS, OMB Bulletin 23-01 delineations).

The domain evidence says sub-state geography is a first-order comp factor for locums:
rural/hard-to-fill facilities pay more (CompHealth states this directly), the premium is
specialty-heterogeneous and sometimes inverts (MGMA 2018 showed non-metro *surgical*
medians BELOW urban), physician pay famously inverts against cost of living (Doximity 2025:
Rochester MN and St. Louis out-earn LA and NYC), and federal machinery already prices
geography below the state level (Medicare geographic-HPSA 10% bonus; GPCI localities;
permanent frontier-state PE floor).

**Recommended shape:** add a 3-value `geo_tier` (metro / non-metro / rural-CAH-frontier)
derived from *observable designations* (OMB CBSA / USDA RUCC county codes, CMS CAH
certification), attach it to observations at scrape time as a nullable field, and quote via
a shrinkage ladder `cell(spec|state|tier) → state(spec|state) → census-division(spec|div) →
national(spec)`. The engine already contains the in-house precedent for exactly this ladder
— the CRNA lookup's DERIVED tier falls from state (n<5) to census division to national
(`crnaCellLookup.ts:37-46`, `censusDivisionOf` :266-286). Critically, **today's data cannot
fill tier cells or even state cells** (live n per specialty is single-digit; the 2026-06-30
deploy observed 0 promotions), so the first moves are attribution coverage and static tier
*ratio* priors from OEWS metro/nonmetro shape — not a bigger cell key.

---

## Findings

### A. What the code does today (OBSERVED, cited)

**A1. The only live geo lever is `STATE_MULT`, and its dominant input is hand-labeled.**
`stateData.ts:149-176` derives the multiplier as
`clamp( (100/COLI)^0.30 × (304/density)^0.30 × demandWeight^0.40, 0.88, 1.38 )`.
Inputs:
- COLI = BEA Regional Price Parities 2024, state level (`stateData.ts:28-43`; raw artifact
  `scripts/data-refresh/raw/bea-rpp-2024.csv`) — OBSERVED, reproducible.
- Physician density = HRSA AHRF 2024-2025 state layer, ACS 5-yr PUMS methodology
  (`stateData.ts:45-83`; population-weighted national average 304 per 100K,
  `stateData.ts:85-92`) — OBSERVED, reproducible, with the documented methodology-shift
  caveat (`stateData.ts:66-75`).
- `STATE_DEMAND_CLASS` (`stateData.ts:100-110`) + `DEMAND_WEIGHTS` critical 1.30 → surplus
  0.90 (`stateData.ts:112-118`) — **hand-curated**. The comment says "Derived from: HRSA
  HPSA designations, rural hospital density, physician age demographics"
  (`stateData.ts:95`) but there is no raw artifact, no extraction script, and no citation
  per state. This input carries the **largest exponent (0.40)** — the dominant driver of
  every geographic quote is the least reproducible number in the file. ESTIMATED.
- Note `RATE_SOURCES.state` still cites "BEA Regional Price Parities 2022, AAMC Physician
  Workforce 2022" (`callRates.ts:410`) — stale relative to the actual 2024 BEA / AHRF
  2024-2025 inputs; display-provenance drift.

**A2. The market-posterior cell key materializes state but never sees one.** Bucket split is
`(specialty, stateKey, rateTypeKey)` with NULL state → literal `'national'`
(map 03 §3.4; `aggregateBridge.ts:916-967`). Live rows are 100% state-NULL (map 03 §S7,
flagged there as "[Verify: current v2 tree contains only 'national' cells]"). The scraper's
`state_attribution.py` (agent-sdk/shared) resolves URL/content → 2-letter state or NULL —
there is **no city, county, ZIP, or metro attribution attempt at all** (`state_attribution.py:1-101`).

**A3. Even if state cells arrived tomorrow, the live reader would not use them per-state.**
`readCellBuckets` prefers the `'national'` cell and otherwise falls to **the first real
state cell in key order** (`marketRates.ts:286-295`) — a single cell chosen without
reference to the user's selected state. `applyMarketBucketsOverlay` then mutates the ONE
national `SPECIALTIES` band (`marketRates.ts:469-551`), and geography re-enters only as
`geoMult = STATE_MULT[state] || 1.0` (`rateCalculator.ts:659,773`). So the pipeline's state
dimension is currently write-only freight; the geo model is
`national_anchor × static_state_mult` end to end.

**A4. Rural is display-only; the real rural premium hides behind facility type.**
`inferRural` only asserts NOT-rural on positive metro evidence (the ~140-city
`METRO_CITIES` whitelist, `stateData.ts:121-141`; logic `rateCalculator.ts:165-206`);
`ruralMult` is pinned 1.0 on both quote paths (`rateCalculator.ts:669,776`) after the
2026-06-01 audit found double-counting (engine-cited example: CRNA Kokomo IN
232 × geo 1.17 × rural 1.20 × 0.95 = $309 vs researched max $250,
`rateCalculator.ts:660-668` — OBSERVED as a code-documented audit note). Genuine
frontier-rural premium routes only through `FACILITY_MULT` `cah: 1.22` / `rural_trauma:
1.30` (`multipliers.ts:23-36`, ESTIMATED, collectively sourced via `RATE_SOURCES.facility`
`callRates.ts:412`), which requires positive facility-text evidence
(`rateCalculator.ts:269-279`) — and the manual sim never sets it (`hub/sim-adapter.ts:139`).

**A5. BLS OEWS is consumed at state level only.** `blsOewsBaseline.ts` is
`Record<state, Record<SOC, OewsPercentiles>>` (`blsOewsBaseline.ts:42`), generated from
`bls-oews-may-2024-state.xlsx` by `extract-bls-oews.mjs` (canonical:
`C:/Users/oclou/QueenClaude/ias-dashboard/scripts/data-refresh/extract-bls-oews.mjs:3-9`).
`blsSanityCheck.ts` keys `BLS_OEWS_BASELINE[state]` (`blsSanityCheck.ts:327,535`) — no
metro rung exists. The file's own header documents the suppression/aggregation problem at
state level (29-1229 / 29-1249 aggregates, `blsOewsBaseline.ts:13-27`); metro-level
physician detail codes will be suppressed even more often (expected from BLS suppression
policy — flag to verify empirically against the MSA file before building on it).

**A6. The UI's geo control is 4 regions → one representative state.** The hub keeps
region buttons and maps each region to the state whose `STATE_MULT` is closest to the
region mean (`hub/sim-adapter.ts:52-99`); a PDF-parsed state overrides. Unknown states
default to region 'South' (`hub/sim-adapter.ts:71`). There is no metro/rural control of any
kind on the live surface.

**A7. The shrinkage ladder already exists in-house — for CRNA only.** The CRNA tier system
falls `HIGH (state n≥10) → MULTI-SOURCE (state n 5-9) → DERIVED (census-division aggregate
when state n<5) → PUBLIC-HINT (national ratio / literature)` (`crnaCellLookup.ts:37-46`),
with the 9-division census mapping implemented and coverage-checked at
`crnaCellLookup.ts:242-286` (source: census.gov levels page, cited in-file; note the NE/MA
division-code vs state-code collision caveat at :246-250). This layer is dormant in the hub
(Supabase intentionally not injected, `hub/sim-live.ts:19-23`) but is the exact structural
precedent for a general `cell → state → division → national` ladder.

**A8. City-level artifacts already exist but are dead or unpriced.** `GSA_OVERRIDES` holds
~120 city-keyed per-diem rows (`callRates.ts:381-404`, FY2026, no live consumer — map 05
§2.3), and `fuzzyMatch.ts` already builds a known-city set from METRO_CITIES + GSA keys
(`fuzzyMatch.ts:104-110`). The parser extracts facility city/state (`rateCalculator.ts:138-160`).
So facility-city capture is solved; what is missing is the city → county → tier mapping.

### B. Domain evidence (external, cited; confidence labeled)

**B1. Rural premium is real for locums, but the honest size is specialty-dependent — and
sometimes inverts.**
- CompHealth (named agency, its own pay explainer): "Facilities in rural areas generally
  pay locum tenens physicians more than urban facilities because it is more difficult to
  attract candidates to these areas" — and its 2026 top-paying-state list is dominated by
  rural/less-urban states (Arkansas, West Virginia, South Dakota, Mississippi…)
  ([comphealth.com](https://comphealth.com/resources/how-locum-tenens-pay-works)). OBSERVED
  (agency statement about its own market).
- NEJM CareerCenter (2019, "Demystifying Urban Versus Rural Physician Compensation"):
  recruiters put the *permanent-hire* rural differential at ~5-10% (Vista Staffing "maybe
  10 percent at the most"; AMGA "more like 5 to 10 percent"; Jackson Physician Search "9 to
  10 percent"), and MGMA 2018 medians showed primary care non-metro $205,588 vs urban
  $200,000 — but **surgical specialists inverted: $250,000 non-metro vs $320,000 urban**
  ([nejmcareercenter.org](https://resources.nejmcareercenter.org/article/demystifying-urban-versus-rural-physician-compensation/)).
  OBSERVED (named survey, dated) — key lesson: a single flat rural premium is wrong in both
  directions; procedural specialties can pay LESS rurally (volume-limited) while coverage
  specialties (hospitalist, EM, primary care) pay more.
- Claims of "10-25%, up to 30%+ at critical-access hospitals" circulate in staffing
  marketing content (e.g., allstarhealthcaresolutions.com blog) — ESTIMATED, low
  confidence, do NOT hardcode. UNVERIFIED — needs a primary source.
- Rural compensating differentials in permanent deals often arrive as bonuses/loan
  forgiveness rather than rate (NEJM CareerCenter above: signing bonuses to $100K primary
  care; AMGA 2018 loan-forgiveness median $75K) — consistent with map 05 §2.4's finding
  that the engine currently discards bonus signals entirely.
- AMN/Merritt Hawkins 2024 Review: 71% of search engagements were in communities of
  100,000+ people — the *permanent* recruiting market has urbanized, which strengthens the
  scarcity story for rural *locum* coverage (locums backfill where perm recruiting fails)
  ([amnhealthcare.com](https://www.amnhealthcare.com/siteassets/amn-insights/physician/incentive-review-2024-final.pdf)).
  OBSERVED (named report) — interpretation is ESTIMATED.

**B2. Cost-of-living vs physician pay INVERTS — the engine's inverse-COLI direction is
right, and metro data proves it below state level.** Doximity 2025 Physician Compensation
Report: the two highest-paying metros were Rochester, MN ($495,532) and St. Louis, MO
($484,883), beating Los Angeles ($470,198) and New York ($435,986); Boston, Washington DC,
Seattle, San Francisco, Denver were the worst COL-adjusted metros
([doximity.com](https://www.doximity.com/reports/physician-compensation-report/2025)).
OBSERVED (named survey; W2-weighted — use directionally, never as locum levels). This
inversion is *within-state-visible* (St. Louis vs the MO average; Rochester vs MSP), which
a state multiplier structurally cannot express.

**B3. Federal payment machinery already prices geography below the state level — free,
citable anchors for a tier model.**
- **Medicare geographic-HPSA bonus:** CMS pays a 10% quarterly bonus on physician
  professional services furnished in geographic primary-care HPSAs (psychiatrists in mental
  health HPSAs) ([cms.gov](https://www.cms.gov/medicare/payment/fee-for-service-providers/physician-bonuses-health-professional-shortage-areas-hpsas);
  42 CFR §414.67). OBSERVED. As of 12/31/2025 there were 8,467 primary care HPSA
  designations with ~48.2% of need met (KFF tabulation of HRSA data,
  [kff.org](https://www.kff.org/other-health/state-indicator/primary-care-health-professional-shortage-areas-hpsas/)).
  HPSA is sub-state (county/tract/facility) and downloadable from data.hrsa.gov — the
  reproducible replacement for the hand-curated `STATE_DEMAND_CLASS`.
- **GPCI:** 109 Medicare payment localities; the work-GPCI 1.0 floor (protecting ~51
  localities, mostly rural/low-cost) was extended through Jan 31, 2026 by H.R.5371 §6207 —
  status after that date needs re-check; the **frontier-state PE GPCI 1.0 floor (MT, NV,
  ND, SD, WY) is permanent** (AMA GPCI explainer,
  [ama-assn.org](https://www.ama-assn.org/system/files/geographic-practice-cost-indices-gpcis.pdf)).
  OBSERVED. GPCI locality tables are a free county-mapped cost prior.
- **Critical Access Hospitals:** federally certified, ≤25 inpatient beds, >35 miles from
  the nearest hospital (or >15 via mountainous/secondary roads), 96-hr average LOS
  (42 CFR Part 485 Subpart F; CMS MLN006400). 1,377 certified CAHs in 45 states as of July
  2025 (Rural Health Information Hub,
  [ruralhealthinfo.org](https://www.ruralhealthinfo.org/topics/critical-access-hospitals));
  CT/DE/MD/NJ/RI have none. OBSERVED. CAH status is a machine-checkable facility flag — a
  far better "rural" anchor than adjectives, and the engine already carries a CAH
  multiplier that just needs a reachable input.

**B4. State factors that shift effective attractiveness (and therefore locum supply and
rates):**
- **Licensure friction / IMLC:** the Interstate Medical Licensure Compact had 43 member
  states + DC + Guam as of Jan 2026 (Weatherby's compact guide,
  [weatherbyhealthcare.com](https://weatherbyhealthcare.com/blog/interstate-medical-licensure-compact));
  imlcc.com reports Alaska became the 44th member state June 22, 2026, and one industry
  tracker reports a Michigan withdrawal effective March 28, 2026 — the exact roster churns
  and must be re-verified against imlcc.com before shipping. Notable NON-members per the
  Weatherby list: **California, New York, Oregon, South Carolina, Virginia** (plus PR/VI).
  IMLC-derived sources claim an average ~19-day license wait with 51% inside a week, vs
  traditional licensure at one to four+ months. ESTIMATED (industry sources) — but the
  mechanism is solid: high-friction non-compact states (CA, NY) throttle how quickly locum
  supply can respond, which is upward rate pressure independent of COLI/density; compact
  states import supply faster.
- **Certificate of Need:** CON programs are active in 35 states + DC (NCSL,
  [ncsl.org](https://www.ncsl.org/health/certificate-of-need-state-laws)). OBSERVED. CON
  constrains facility expansion (fewer competing sites, more consolidated call burden) —
  plausible second-order rate effect, context-panel material, not a multiplier.
- **Malpractice environment:** AMA Policy Research Perspectives analysis of the Medical
  Liability Monitor 2025 rate survey: Miami-Dade IM manual premium $59,736 and ob/gyn +
  general surgery $243,988, vs Los Angeles (MICRA-capped California) IM $8,274; 36 states
  saw at least one premium increase in 2025
  ([ama-assn.org PDF](https://www.ama-assn.org/system/files/prp-mlm-premiums-2025.pdf)).
  OBSERVED (named survey). Locum malpractice is usually agency-paid, so this cost lands in
  the BILL rate and margins — geographic malpractice tiering is a bill-side factor the
  margin slider currently ignores; note the engine's only malpractice field
  (`insuranceProvidedBy`, `liveCalibration.ts:40,56`) is dormant (map 05 §2.5).

**B5. Metro-level data sources that could actually feed a tier.**
- **BLS OEWS metro/nonmetro:** May 2024 OEWS publishes cross-industry estimates for ~530
  MSAs + nonmetropolitan areas (BLS
  [oessrcma page](https://www.bls.gov/oes/2024/may/oessrcma.htm)), on OMB Bulletin 23-01
  delineations; nonmetro areas are OEWS-specific groupings set with state workforce
  agencies ([bls.gov msa_def](https://www.bls.gov/oes/current/msa_def.htm)). The same
  download bundle the pipeline already uses has MSA + nonmetro files — the extractor just
  never pulls them. W2 levels, so usable only as *ratios/shape*, per the engine's own
  W2-vs-locum doctrine (`blsSanityCheck.ts:73-89` multipliers are the existing bridge).
- **USDA ERS RUCC 2023:** every county classified 1-9; 1,186 metro / 1,958 nonmetro
  counties, built on OMB 2023 delineations
  ([ers.usda.gov](https://www.ers.usda.gov/data-products/rural-urban-continuum-codes)).
  OBSERVED. A single small static table (FIPS → RUCC) is the deterministic
  city/ZIP→tier resolver. RUCA (tract-level) exists if finer resolution is ever needed.
- **HRSA data warehouse:** HPSA designation files (geographic/population/facility, with
  scores and rural flags) downloadable at data.hrsa.gov — the reproducible demand-side
  input (B3).
- **CMS CAH certification list + GPCI locality tables:** facility-level rural flag and
  county-mapped cost indices (B3).
- **GSA per-diem city table:** already in-repo (`callRates.ts:378-404`) — a live-able
  city-granular cost-of-stay signal for the stipend surface (map 05 flags it dead + staleness risk).

### C. Design — the geo-tier dimension and shrinkage hierarchy

**C1. Tier taxonomy (3 values, observable-designation-keyed, nullable):**

| geo_tier | Definition (deterministic) | Data anchor |
|---|---|---|
| `metro` | Facility county RUCC 1-3 (in an OMB metro CBSA) | USDA RUCC 2023 (FIPS table) |
| `non_metro` | County RUCC 4-7 (micropolitan / adjacent) | USDA RUCC 2023 |
| `rural_cah` | County RUCC 8-9, OR facility on the CMS CAH list, OR frontier state (MT/NV/ND/SD/WY) | RUCC + CMS CAH certification + ACA frontier list |
| `null` | Unknown — honest absence, exactly like NULL state today (D-19 discipline) | — |

Three tiers, not five: physician-detail sample sizes cannot support finer splits (B5
suppression), and the comp-relevant boundary the domain evidence supports is
metro vs everything / genuinely-frontier vs everything (B1, B3).

**C2. Where the tier attaches.**
- **Observation side (scraper):** extend the Phase-A.2 attribution seam — a
  `geo_attribution` sibling to `state_attribution.py` that resolves posting city/facility →
  county FIPS → RUCC tier; NULL when no city resolves (never guess; same no-fake-data rule
  as `state_attribution.py:26-31`). New nullable column on `rate_intelligence` +
  the same partition-invariant telemetry pattern as state attribution.
- **Cell key (bridge):** `(specialty | stateKey | geo_tier? | rate_type)` — tier as an
  OPTIONAL fourth dimension nested under the state cell (`{state}/tiers/{tier}/buckets/...`
  keeps the v2 whole-node-replace semantics, map 03 §4). NULL-tier rows keep aggregating
  into today's state (or national) cell, so **adding the dimension never thins existing
  cells** — the tier split is additive, computed only over tier-attributed rows.
- **Quote side (engine):** `RateFactors` gains `geoTier` next to `rural`
  (`types.ts:124-126,190`), populated from facility city/PDF (the capture already exists,
  A8) or a new hub control; `inferRural`'s metro-whitelist logic collapses into the
  RUCC lookup (whitelists of 140 city strings stop being the metro oracle).

**C3. The shrinkage ladder (the accuracy core of this proposal).**

```
rung 1: cell   (spec | state | tier | market-typed rate_type)   n≥4 ∧ ≥2 families → ANCHOR
rung 2: state  (spec | state | market-typed)                    n≥4 ∧ ≥2 families → anchor × static tier ratio (labeled)
rung 3: div    (spec | census-division pooled)                  n≥4 ∧ ≥2 families → anchor × STATE_MULT-relative + tier ratio (labeled)
rung 4: nat    (spec | national)  ← today's ONLY live rung      current Move-#1 gate → anchor × STATE_MULT × tier ratio
rung 5: curated static band × STATE_MULT × tier ratio           today's prior, unchanged
```

- Pooling uses the existing `censusDivisionOf` 9-division mapping
  (`crnaCellLookup.ts:266-286`) — generalize it out of the CRNA module into the shared
  engine (it is already pure and coverage-checked). Keep the documented NE/MA
  division-vs-state code collision guard (:246-250).
- Shrinkage estimator: empirical-Bayes precision-weighted blend
  `posterior_cell = (n_cell·x̄_cell + k·μ_parent) / (n_cell + k)` with k ≈ 4 (matching the
  existing `minDistinct` anchor gate, `marketRates.ts:473`) so a thin tier cell is pulled
  toward its parent rather than either fabricating confidence or being discarded. This is
  Move #3 (shrinkage) from the improvement plan, instantiated on the geo axis; the
  variance machinery (`aggregateCell`'s IVW weights, `cellAggregation.ts:286-411`) already
  produces the per-cell precisions the blend needs. Named losing side: shrinkage
  **under-states genuine frontier premiums while tier cells are thin** — the label must say
  "state-level anchor, rural adjustment estimated" until rung 1 fills.
- Every rung is a distinct provenance label (extend `provenance: 'live'`,
  `marketRates.ts:540` region) — the trust-ladder honesty rule (map 03 §5.2) applies
  unchanged: deeper rungs cap confidence lower.

**C4. The static tier RATIO prior — how to price tiers before tier cells exist.**
Levels from W2 sources are forbidden as anchors (engine doctrine, `marketRates.ts:119-124`
exclusion of `permanent_wage_proxy`), but **ratios within the same W2 distribution are a
defensible shape prior**: extract, per SOC family and state, `median(metro areas)` vs
`median(nonmetro areas)` from the OEWS MSA/nonmetro files and publish a
`GEO_TIER_RATIO[socFamily][tier]` table alongside `BLS_OEWS_BASELINE` (same
extract-script + raw-artifact discipline, `extract-bls-oews.mjs` pattern). Expected
properties, to be verified from the actual extract, NOT assumed: small positive nonmetro
premium for coverage families (FM/IM/hospitalist/psych), flat-to-negative for
procedure-heavy families (B1's MGMA inversion). Cap the applied ratio band (e.g. clamp to
[0.90, 1.25] pending observed data) exactly like STATE_MULT is clamped, and label it
ESTIMATED. Where OEWS suppresses physician detail codes at metro level, fall back to the
29-1229/29-1249 aggregates per the existing state-level policy (`blsOewsBaseline.ts:13-27`)
or emit no ratio (honest absence) — never interpolate.

**C5. What current data can and cannot support (be blunt).**
- CANNOT: live tier-level posteriors (rung 1). Live rows are 100% state-NULL (A2); the
  national anchor gate itself passed 0 specialties at the 2026-06-30 deploy (map 03 §5.3).
  Tier cells are two sparsity levels below a bar the data does not currently clear.
- CANNOT: state-level posterior anchors (rung 2) until the fleet + state attribution
  actually populate states; also blocked on the reader's first-state-cell arbitrariness (A3).
- CAN, today: (a) deterministic tier *classification* of quotes (RUCC/CAH tables are
  static, tiny, and free); (b) the OEWS tier-ratio prior (C4) — static, reproducible,
  labeled; (c) a reachable CAH/facility control in the hub (the multiplier already exists);
  (d) replacing the hand-curated `STATE_DEMAND_CLASS` with an HPSA-derived reproducible
  index; (e) state-factor context (IMLC/CON/malpractice/HPSA-bonus) as display context.
- The schema change (C2) is cheap insurance to ship early ONLY because NULL-tier rows keep
  flowing into existing cells; the ladder rungs activate as data arrives, never before.

---

## Recommendations

1. **Fix state-attribution coverage before any geo schema work** — instrument per-source
   state-coverage telemetry in the fleet, extend `_URL_STATE_PATTERNS` for the WS1 posting
   sources, and verify the v2 tree starts growing real state cells. *(impact: high —
   everything else stacks on it; effort: low-medium)*
2. **Make the reader state-aware** — `readCellBuckets` should accept the quote's state and
   prefer `(state cell) → national`, not `national → first-key state cell`
   (`marketRates.ts:286-295`); this is the rung-2 prerequisite and fixes a latent
   arbitrary-cell bug. *(impact: medium today / high once state cells exist; effort: low)*
3. **Replace hand-curated `STATE_DEMAND_CLASS` with a reproducible HPSA-derived index**
   (HRSA downloadable designation files: population-weighted geographic-HPSA share or mean
   HPSA score per state), same raw-artifact + extract-script discipline as BEA/AHRF; keep
   the 0.40 exponent initially so quotes move only from re-labeling, and diff every state's
   multiplier before/after. *(impact: high — de-fabricates the dominant geo input;
   effort: medium)*
4. **Extract OEWS metro/nonmetro and ship `GEO_TIER_RATIO` as a labeled static prior**
   (C4), applied only when a tier is positively known; render as "rural/metro adjustment —
   estimated from BLS wage-distribution shape". *(impact: high — first honest sub-state
   pricing; effort: medium)*
5. **Expose the existing CAH / rural-trauma facility control in the hub manual sim**
   (today hardcoded `community`, `hub/sim-adapter.ts:139`) — the single cheapest way to let
   recruiters price the one genuine rural premium already in the engine. *(impact:
   medium-high; effort: low)*
6. **Add `geo_tier` to the observation schema + a `geo_attribution` module (city→FIPS→RUCC
   + CAH list match)**, nullable, with attribution-path telemetry mirroring
   `state_attribution.py`. *(impact: medium now, high later; effort: medium)*
7. **Generalize the CRNA census-division ladder into the shared engine and implement the
   shrinkage blend (C3)** gated behind the same n≥4/≥2-family thresholds per rung.
   *(impact: high; effort: high)*
8. **State-factor context panel (display-only):** IMLC membership (with licensing-speed
   note), CON status, malpractice-premium tier (MLM/AMA), Medicare geographic-HPSA bonus
   eligibility hint. No multipliers — context that explains WHY a state prices hot/cold and
   arms the recruiter's negotiation story. *(impact: medium; effort: low-medium)*
9. **Retire `METRO_CITIES` as the metro oracle once RUCC lands** (keep as a parser hint
   only); it is a 140-city whitelist standing in for a 3,144-county classification.
   *(impact: low-medium; effort: low)*

## Open questions

1. **How suppressed are physician detail SOCs in the OEWS metro/nonmetro files?** If
   29-1229/29-1249 aggregates dominate at MSA level, the tier-ratio prior may only be
   buildable per SOC *family*, not per specialty. Needs the actual May 2024 MSA/nonmetro
   extract (rec 4) before committing to per-specialty ratios.
2. **Facility-city coverage rate in real scraped postings** — what fraction of
   `rate_intelligence` rows carry a resolvable city (vs state-only vs nothing)? Determines
   whether geo_tier attribution yields any non-NULL rows worth bucketing.
3. **Does IAS's own placement history (LocumSmart feed, `liveCalibration.ts`) carry
   facility city/ZIP?** If yes, it is the only *locum-native* sub-state observation source
   in-house and should seed tier cells long before the public scraper can.
4. **Michigan's IMLC status and the exact mid-2026 member roster** (reported withdrawal
   effective 2026-03-28 vs imlcc.com's 44-state count after Alaska joined 2026-06-22) —
   verify on imlcc.com before shipping any IMLC context panel.
5. **Work-GPCI floor status after 2026-01-31** (H.R.5371 extension horizon) — affects
   whether the GPCI-based cost prior needs a floor-toggle.
6. **Tier boundary choice:** is RUCC 4-7 vs 8-9 the right non-metro/rural split for locum
   economics, or should the split be CAH-anchored only (tier 3 = CAH/frontier, everything
   else non-metro)? Decide from the first tier-attributed observation histogram, not a priori.
7. **Cross-repo key-set risk (map 03 §S4):** any bucket-key change must land in the
   dashboard's bridge AND the vendored website reader in one sync, or tier nodes will be
   written that the live reader strips silently.
