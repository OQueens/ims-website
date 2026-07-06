# Brief 12 — Compensation Taxonomy Part 3: Stipends, Gratis & Extras

> Deep-dive brief, 2026-07-03. Scope: every non-base-rate compensation element in the
> locum-tenens (1099 physician contractor) world — bonuses, travel, housing, rental car,
> malpractice + tail, CME, licensing/credentialing, meal per-diem, and gratis/pro-bono/
> reduced-rate arrangements — mapped against the LIVE engine
> (`ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine` + `src/lib/hub`) and the
> still-live pipeline (`agent-sdk/agents/rate_scraper`, `ias-dashboard/scripts/data-refresh`).
> Companion maps: `../maps/05-comp-factors-today.md` (factor scorecard),
> `../maps/03-market-posterior-bridge.md` (gate stack).
>
> Labels: **OBSERVED** = read from code or a named external source (cited). **ESTIMATED** =
> research-derived, no primary cite. **UNVERIFIED** = flagged in claims_to_verify.

---

## Summary

The live simulator quotes a **rate-only** number (hourly $/hr or call-only $/day). Every
"extra" in the locum comp taxonomy is today one of: **display-only** (gratis hours, callback
band), **dead code** (GSA travel/lodging/M&IE tables with zero hub consumers), **dormant**
(`insuranceProvidedBy`, credentialing-time medians in `liveCalibration.ts`), or **actively
destroyed at parse time** (sign-on bonuses and weekly stipends filtered as noise by the
scraper).

The critical domain fact that makes this *mostly defensible*: in US physician locums, the
industry norm is that the agency pays travel, housing, rental car, malpractice (often with
tail), and licensing **on top of** the advertised hourly/daily rate — the extras do not flow
through the physician's quoted rate ([Locumstory pay guide](https://locumstory.com/spotlight/locum-tenens-pay);
[Weatherby benefits](https://weatherbyhealthcare.com/resources/locum-tenens-benefits)). So
scraped hourly rates are *roughly* like-for-like, and a rate-only simulator is comparing the
right axis. This is unlike travel nursing, where pay is deliberately split into a low taxable
base + large "tax-free" stipends and the headline "blended rate" is a manipulation surface
(Clarke v. AMN Services, 9th Cir. 2021).

Four real defects remain against the north star ("the rate we would actually pay AND where it
sits in the distribution"):

1. **Extras signals are destroyed, not diverted** — the scraper's anti-poisoning filters drop
   bonus/stipend dollars (and sometimes the whole posting) instead of capturing them into
   side-channel fields, so the engine can never detect a low-base-disguised-by-extras posting
   or an "up to $X incl. bonus" inflated headline.
2. **Gratis/callback hours are carried but never priced** — a busy 24-hr call (4 gratis +
   6 callback hrs) quotes identically to a quiet one, and the live hub UI doesn't even render
   the gratis/callback context the engine carries.
3. **The GSA per-diem layer is dead weight** — shipped, audit-verified, and unconsumed; the
   simulator's "bill to facility" therefore excludes the travel/housing cost block that real
   invoices carry, without saying so.
4. **Malpractice/tail provision is unmodeled** — a direct-contract 1099 rate without provided
   malpractice is NOT economically comparable to an agency rate with $1M/$3M + tail, and no
   flag exists to segment the two populations in scraped data.

---

## Findings (cited)

### F1. Sign-on / completion / retention bonuses — IGNORED by design; signal destroyed

**Domain.** Locum contracts do carry them: Locumstory states some assignments include
"completion bonuses or higher rates for weekend, holiday, or overnight shifts"
([Locumstory](https://locumstory.com/spotlight/locum-tenens-pay)); SUMO Medical Staffing lists
sign-on/completion bonuses among locum comp components
([SUMO](https://www.sumostaffing.com/blog/understanding-compensation-packages-for-locum-tenens/)).
They are lump sums paid outside the hourly rate — amortized over a contract they raise the
effective $/hr, and recruiters use them as a closing lever without moving the posted rate.
Perm-market contrast (for scale only, **NOT locum data**): AMN Healthcare's 2025 Review of
Physician and Advanced Practitioner Recruiting Incentives reports the average *permanent*
physician signing bonus at **$38,315** (+23% YoY), and signing + relocation + CME combined at
**$58,854** ([AMN 2025 Review](https://www.amnhealthcare.com/amn-insights/physician/whitepapers/2025-review-of-physician-and-advanced-practitioner-recruiting-incentives/)) — UNVERIFIED, in claims_to_verify.

**Engine.** No type, no factor, no UI anywhere in the three repos. The only mention is the
extractor docstring: a "'$5,000 sign-on bonus' next to a '$325/hr' rate won't poison the
range, since 5000 is outside the hourly band" (`agent-sdk/agents/rate_scraper/card_extractor.py:88-90`;
magnitude band $60–$900/hr at `card_extractor.py:72`). Bonuses are filtered by magnitude,
never *recognized* — the dollar value is discarded.

**Effective rate or separate?** Separate lump sum; part of effective comp. **Manipulation
vector:** (a) "up to $X/hr" headlines that only reach $X with bonus inclusion enter the
scraper as `rate_high` at face value — no bonus-inclusion check exists; (b) a
low-base-plus-big-completion-bonus posting enters the sample as its low hourly and drags the
posterior *down* (the inverse of the usual inflation fear). Neither is detectable today.

### F2. Travel reimbursement (flights, mileage, parking, baggage) — separate by norm; parser sees it, extracts nothing

**Domain.** "Flights, rental cars, and accommodations are arranged and paid for by the
agency," and many agencies also "reimburse meals and incidentals, and cover costs like
mileage, parking, or baggage fees" ([Locumstory](https://locumstory.com/spotlight/locum-tenens-pay));
Weatherby covers travel to/from assignment ([Weatherby](https://weatherbyhealthcare.com/resources/locum-tenens-benefits)).
So travel is **separate from the rate** in the standard agency model; an advertised locum
hourly normally excludes it. On the facility side those costs ride inside the agency bill
(rate + passthrough or all-inclusive bill), which is why bill ≫ pay: one industry explainer
puts it as agency bills $3,000–$5,000/day while paying the physician $1,500–$3,000/day
([ERA Locums](https://eralocums.com/blog/locum-tenens-cost/)) — UNVERIFIED band, context only.

**Engine.** The PDF parser captures a "Call & Travel" section verbatim
(`src/lib/rate-engine/parser.ts:167,191`) but there is no travel-comp extraction (no
mileage/airfare/housing parsing). The scraper's `_DOLLAR_REJECT_UNIT` regex
(`card_extractor.py:37-42`) drops **the entire posting** when a $-amount attached to
week/month/year/RVU sits next to an hourly figure ("$200-$250 weekly stipend, hourly pay
separate" → row dropped, `card_extractor.py:95-103`). Correct anti-poisoning, but note the
**selection bias**: postings that advertise split comp (rate + stipend) are systematically
excluded from the observed distribution, and the stipend dollar itself is never captured.

### F3. Housing / lodging — separate by norm; engine data shipped, surface dead

**Domain.** Agencies arrange and pay housing (hotel/extended-stay/apartment) in addition to
the rate ([Weatherby](https://weatherbyhealthcare.com/resources/locum-tenens-benefits);
[Locumstory](https://locumstory.com/spotlight/locum-tenens-pay)). The manipulation precedent
lives next door in travel *nursing*: pay split into a low taxable base plus large "tax-free"
housing/meal stipends. The Ninth Circuit held in **Clarke v. AMN Services** (No. 19-55784,
Feb 8 2021) that AMN's weekly per-diems "functioned as compensation for work" rather than
expense reimbursement and were improperly excluded from the FLSA regular rate — per-diems
were paid for 7 days while clinicians worked 3, and local clinicians got the same per-diem
without traveling ([9th Cir. opinion](https://cdn.ca9.uscourts.gov/datastore/opinions/2021/02/08/19-55784.pdf);
[Stoel Rives summary](https://www.stoelrivesworldofemployment.com/2021/02/articles/statutes/flsa/ninth-circuit-rules-that-per-diem-payments-must-be-included-in-regular-rate-under-the-flsa/)).
Travel-nurse tax guides call the low-base variant "wage recharacterization," IRS-prohibited
and audit-risky ([Advantis Med](https://advantismed.com/blog/travel-nurse-tax-home);
[travelnursing.org tax guide](https://www.travelnursing.org/travel-nurse-taxes-comprehensive-guide/)).
For 1099 physician locums the agency-books-housing norm largely closes this vector, but any
posting quoting a housing-inclusive "blended" hourly is inflated relative to the market's
rate-only convention — and the engine has no way to notice.

**Engine.** FY2026 GSA tables are fully shipped: `GSA_STANDARD = {lodging: 110, mie: 68,
total: 178}` plus ~120 city overrides (`src/lib/rate-engine/callRates.ts:379-404`), cited to
"GSA Per Diem Rates FY2026" (`callRates.ts:413`), lookup via `lookupGsa()` keyed on facility
city/state then nearest airport (`rateCalculator.ts:643-653`). The 2026-06-26 request-type
audit verified all spot-checks against the official api.gsa.gov FY2026 data (NY $434, SF
$364, Boston $441, Chicago $326, Dallas $271, Augusta $199, Aspen $499, Park City $575 —
peak-month lodging + M&IE) — OBSERVED
(`~/.claude/.../memory/reference_request_type_audit_2026-06-26.md` §4). **Zero consumers in
the live hub**: grep of `src/lib/hub` finds no `lookupGsa`/`GsaRates` call sites; the only
"stipend" strings in the hub are the call-only daily-stipend hero
(`src/lib/hub/sim-render.ts:98-129`). Also a hardcoded-vintage risk: the FY2026 table will
silently go stale after Sep 30 2026 with no refresh mechanism.

### F4. Rental car — separate by norm; no representation

Agency-arranged alongside flights ([Locumstory](https://locumstory.com/spotlight/locum-tenens-pay)).
No engine concept anywhere (grep `rental` across the three rate roots: zero rate-code hits).
Correctly out of the rate; belongs, if anywhere, in a facility-cost/logistics context panel
(see R2).

### F5. Malpractice + TAIL coverage — the largest unmodeled $-equivalent differential

**Domain.** Most agencies provide malpractice at no cost to the provider
([Barton Associates](https://www.bartonassociates.com/malpractice-insurance/);
[locumtenens.com](https://www.locumtenens.com/physician-resources/medical-malpractice/)).
CompHealth: claims-made policy, **$1M per occurrence / $3M aggregate** per provider (higher
where state-mandated, e.g. VA/NY $1.3M/$3.9M), covering assignment-related claims "even if
they are no longer working for CompHealth when the claim is made," plus up to $25,000 defense
costs for administrative/board actions ([CompHealth](https://comphealth.com/resources/locum-tenens-malpractice-coverage)).
Weatherby advertises **lifetime tail coverage on every locums assignment**
([Weatherby benefits](https://weatherbyhealthcare.com/resources/locum-tenens-benefits);
[Weatherby malpractice FAQ](https://weatherbyhealthcare.com/blog/weatherby-healthcare-malpractice-faq)).
Mechanically, agencies with continuous blanket claims-made policies don't need to buy
per-provider tail; coverage extends back to the policy's retroactive date
([locumtenens.com](https://www.locumtenens.com/physician-resources/medical-malpractice/)).
For a physician contracting *directly* (no agency), a claims-made policy requires tail on
exit, and tail can cost on the order of **100–200% of the annual base premium**
([AMN malpractice guide](https://www.amnhealthcare.com/blog/physician/locums/guide-to-locum-tenens-malpractice-insurance/)) —
UNVERIFIED %, in claims_to_verify.

**Effective rate or separate?** Separate benefit, but a real $/hr-equivalent: a direct 1099
rate WITHOUT provided malpractice must exceed an agency rate WITH it for economic
equivalence. Scraped direct-facility postings vs agency postings are therefore two different
economic populations on this axis.

**Engine.** The ONLY representation is `insuranceProvidedBy?: string` on `EnrichedJob`
(`src/lib/rate-engine/liveCalibration.ts:40`) surfacing into
`HcoProfile.insuranceProvidedBy` (`liveCalibration.ts:56`) — a bid-ceiling display layer
("Every number ... is a BID CEILING ... NOT a market / winning rate",
`liveCalibration.ts:9-13`) with **no hub consumer** (exported at `rate-engine/index.ts:36`
only). No "tail" concept exists in any rate module (grep: only heavy-tail statistics
comments, e.g. `src/lib/hub/rate-engine-gate2-cellagg.test.ts:104-127`). No scraper field, no
bridge column, no anti-manip flag. The dormant CRNA arrangement layer is the closest
vocabulary: `locum_1099` vs `1099_independent` with fallback multipliers 1.7 vs 1.6
(`crnaCellLookup.ts:49-53,653-659` — ESTIMATED, self-labeled needs-verification, and
explicitly disconnected from the hub, `src/lib/hub/sim-live.ts:19-23`).

### F6. CME allowance — IGNORED; correctly below rate resolution, worth a context bit at most

**Domain.** Locums are 1099 contractors responsible for their own health insurance,
retirement, and taxes ([Locumstory](https://locumstory.com/spotlight/locum-tenens-pay)); CME
is classically a W2/perm benefit (it is one of the three components in AMN's perm
signing+relocation+CME $58,854 combined figure — perm data, not locum). Some industry blogs
claim "many locum tenens contracts include funding for continuing medical education"
([ERA Locums](https://eralocums.com/blog/1099-physician-tax-deductions/)) — this conflicts
with the no-benefits 1099 norm and is UNVERIFIED. Unreimbursed CME is deductible against 1099
income ([Physician Side Gigs](https://www.physiciansidegigs.com/1099-locums-physicians-tax-deductions)).

**Engine.** Zero occurrences of "CME" in `rate-engine`, `hub`, or `rate_scraper` (grep,
2026-07-03 — matches map 05 §2.5). **Materiality check:** even a generous $3–4k/yr CME
allowance amortized over a full locum year is on the order of $1.5–2/hr — below the
resolution of every curated band in `specialties.ts`. Modeling it as a rate factor would be
noise; capturing it as a context boolean (if it ever appears in a parsed packet) is the
ceiling of what's justified.

### F7. Licensing / credentialing reimbursement — separate by norm; engine models the TIME, not the $

**Domain.** Agencies run licensing/credentialing with in-house teams and "often pay upfront
for licensing fees" ([Locumstory](https://locumstory.com/spotlight/locum-tenens-pay));
Weatherby's consultant model covers "licensing and credentialing to travel and housing"
([Weatherby](https://weatherbyhealthcare.com/locum-tenens)). Unreimbursed license/DEA/board
fees are 1099-deductible ([The Locum Guy](https://thelocumguy.com/locum-tenens-tax-deductions/)).
So: separate from the rate, usually agency-absorbed, low per-hour materiality.

**Engine.** Only the TIME dimension exists: `estimatedCredentialingTime` →
`avgCredentialingDays` (`liveCalibration.ts:39,58,193,206`, dormant) and the LocumSmart
webhook persists `estimated_credentialing_time` (`src/lib/locumsmart-webhook-logic.ts:329,429`).
No dollar concept — which is fine for rate math; credentialing time affects fill economics,
not the physician's rate.

### F8. Meal per-diem (M&IE) — shipped data, dead surface; the historically litigated disguise vector

**Domain.** "Many agencies reimburse meals and incidentals"
([Locumstory](https://locumstory.com/spotlight/locum-tenens-pay)). GSA FY2026 standard CONUS
M&IE is $68/day (`callRates.ts:379`, OBSERVED — audit-verified against api.gsa.gov). Whether
a per-diem is expense reimbursement or disguised wages is exactly the Clarke v. AMN question
(F3): paid-regardless-of-expense per-diems are compensation. For W2-locum arrangements
(the IAS booking convention default per `blsSanityCheck.ts:298,419`) this is a live
compliance axis, not just an accuracy one.

**Engine.** Same GSA table, same zero consumers (F3). The `mie` field exists on `GsaRates`
(`types.ts:431-435`). Nothing in the scraper captures per-diem dollars; a per-diem next to an
hourly triggers the F2 row-drop only if phrased with weekly/monthly units.

### F9. GRATIS — two distinct senses; one carried-but-unpriced, one an upstream selection effect

**(a) Gratis/included hours inside a call stipend** — the first N callback hours bundled into
the daily rate. The engine models this faithfully as DATA: per-specialty `gratisHrs`
(neurosurgery 4 — `callRates.ts:78`; cardiology 10 — `callRates.ts:235`; GI 4 —
`callRates.ts:245`; urology 4 — `callRates.ts:282-285`), a per-assignment parser
`detectIncludedHours` ("includes up to 4 hours daily rounding" →
`rateCalculator.ts:606-618`), merged at `initFactors` (`rateCalculator.ts:906`). **But it
never prices anything**: `includedHrs` and `callbackRate` are returned untransformed on
`CalculatedCallRate` (`rateCalculator.ts:834,857`); the old gratis-hour divisor was removed
as dishonest and deliberately replaced with the coverage-hours divisor, not an expected-
utilization model (`types.ts:344-348`). Worse, the LIVE hub renders none of it: the call-only
surface shows only stipend ÷ coverage-hrs, comp model, sources, and note
(`src/lib/hub/sim-render.ts:103-129`); grep of `src/lib/hub` for `callback|gratis|includedHrs`
finds only `sim-adapter.ts:148` hard-zeroing `callbackRate: 0` on the manual path. Net: a
recruiter pricing a busy 24-hr call (4 gratis + 6 expected callback hrs at neurosurgery's
cited $475/hr callback, `callRates.ts:77`) sees the same number as a quiet one, and can't
even see the gratis window that changes the negotiation. One pending data item: the
2026-06-26 audit flagged urology `gratisHrs` 4→2 as real-direction-but-PENDING (two
independent families at 2) — borderline-applicable, awaiting the call
(`reference_request_type_audit_2026-06-26.md`).

**(b) Uncompensated ("gratis") call & pro-bono/reduced-rate work** — the upstream market
reality. Historically physicians took ED call uncompensated as a condition of privileges;
willingness has declined since the early 2000s, and typical medical-staff policies still
embed roughly 5–10 uncompensated call days/month before stipends apply, with per-diem the
most common paid-call method
([Pinnacle Healthcare Consulting](https://askphc.com/breaking-down-the-valuation-of-physician-call-coverage/);
[HSG Advisors](https://hsgadvisors.com/provider-compensation-and-compliance/considerations-for-medical-staff-call-coverage-compensation/);
[Coker](https://www.cokergroup.com/insights/understanding-call-pay-compensation-methods/)).
Two consequences for the engine: (1) **survivorship**: the observed distribution of PAID call
stipends is conditional on a facility having crossed the pay-for-call threshold — it is not
the distribution of call *value*, and `CALL_RATE_DATA` bands inherit that skew (un-labelable
today, worth a note in provenance); (2) **contamination is already well-guarded**: pro-bono/
volunteer/reduced-rate observations near $0 die at the scraper's magnitude floors
(`_HOURLY_MIN, _HOURLY_MAX = 60, 900`; `_DAILY_MIN, _DAILY_MAX = 400, 12000` —
`card_extractor.py:72-73`), a lone low outlier is MAD-rejected (|z|>3.5), and a *tight low
cluster* (e.g. a batch of academic/mission reduced-rate postings) trips `detectBimodal`/
`detectModalEscape` → `manual_review_bimodal` with a null mean that can never anchor
(map 03 §3.6; anchor gate `marketRates.ts:469-551`). Gratis-contamination risk on the hourly
posterior: LOW. The real gap is (a), not (b).

### F10. The bill-rate side — extras live in the agency margin the simulator doesn't model

Real agency economics: the bill to the facility covers provider pay **plus** credentialing,
licensing, travel, housing, insurance, and recruiter support
([ERA Locums](https://eralocums.com/blog/locum-tenens-cost/);
[CompHealth billing guide](https://comphealth.com/resources/bill-locum-tenens-services)).
The hub's bill is `roundUp5(pay/0.80)` on call-only (fixed 20% margin,
`src/lib/hub/sim-adapter.ts:318-321` — internal CONVENTION, uncited as market practice) and
`pay/(1-margin)` with a 15–45% slider on hourly (`sim-adapter.ts:389-413`). Neither includes
a travel/housing block, and nothing labels the omission. At GSA city totals of $178–$575/day
(`callRates.ts:379-404`, OBSERVED), the unmodeled logistics block is a material % of a
locum day's facility cost — the simulator's bill number is a professional-fee bill, not an
all-in cost, and should say so.

### F11. How extras map onto the anti-manipulation model — threat matrix

Existing gate stack (map 03 §7) vs the extras-as-disguise threats:

| Threat | Vector | Current defense | Gap |
|---|---|---|---|
| T1: inflated headline | "up to $X/hr" reachable only with bonus/stipend inclusion | none — `rate_high` taken at face value | no bonus-proximity flag on extraction |
| T2: low base + big extras | $180/hr + $2k/wk stipend + completion bonus | `_DOLLAR_REJECT_UNIT` drops the whole row (`card_extractor.py:37-42,95-103`) | signal destroyed + selection bias; posterior sample over-represents clean-hourly ads |
| T3: blended rate | housing/per-diem value folded into quoted hourly (travel-nursing style) | partial — never-anchor family kill (ZipRecruiter/Adzuna, `sourceFamily.ts:105-107`), W2 unit gates | a locum-branded blended ad passes; no all-in-vs-rate-only normalization flag |
| T4: gratis-hour games | same stipend, worse gratis/callback terms (real pay cut invisible to a rate-only compare) | data carried (`gratisHrs`, callback band) | never priced, never rendered live (F9a) |
| T5: per-diem-as-wage packages | W2 travel-style split comp leaking into locum bands | rate_type ladder + `permanent_wage_proxy` exclusion + unit gates + never-anchor | adequate today; keep |
| T6: fake-low gratis flood | pro-bono/reduced-rate cluster dragging the posterior | magnitude floors + MAD + bimodal/modal-escape → `manual_review_bimodal` | adequate; add a sub-floor drop counter so a true market crash isn't silently filtered |

The through-line: the anchor gate (market-typed ∧ n≥4 ∧ ≥2 families) protects the QUOTE from
most extras-based poisoning, but the engine is **blind** to extras as *information* — it can
neither warn a recruiter that a competing offer's headline is extras-inflated nor credit a
quiet-call assignment's better gratis terms.

---

## Recommendations

Each tagged **impact / effort**. Ordering = suggested priority.

- **R1 — Side-channel extras capture at parse time** (impact: **high**, effort: **medium**).
  When `_DOLLAR_REJECT_UNIT` or the magnitude band would discard a $-figure, classify it
  (`sign_on_bonus | completion_bonus | weekly_stipend | per_diem | other_extra`) into new
  nullable `rate_intelligence` columns instead of destroying it; keep the RATE-band drop
  semantics byte-identical. The pages are already fetched — this is nearly free at the
  extractor (map 05 seam 8). Extras must be non-anchorable by construction (absent from
  `BUCKET_PRECEDENCE`/`DEFAULT_ANCHORABLE_RATE_TYPES`, same exclusion-by-absence idiom as
  `agency_bill_rate`). Requires a prod migration (same class as the pending `20260701000000`
  — Zach-only step).
- **R2 — "Logistics & extras" context panel on the hub quote** (impact: **medium**, effort:
  **low-medium**). Wire the already-shipped, already-audit-verified GSA table
  (`lookupGsa`, `callRates.ts:378-404`) into a clearly-labeled facility-cost context block
  (lodging + M&IE for the facility city, "GSA FY2026, never added to pay"). Precondition: a
  fiscal-year staleness guard (render the FY label; suppress after FY2026 ends unless
  refreshed) so the dead table can't become a silent wrong number. Alternative if not wired:
  delete the table (dead weight with currency risk).
- **R3 — Price expected callback on call-only quotes as a labeled scenario band** (impact:
  **high** for call accuracy, effort: **medium-high**). Total-comp for a call day = stipend +
  max(0, E[callback hrs] − gratisHrs) × callbackRate, shown as quiet/typical/busy scenarios
  ONLY where both callbackRate and gratisHrs are cited (else keep the honest suppression).
  Blocker named honestly: there is NO observed utilization source today — E[callback hrs]
  would be ESTIMATED and must be labeled as such or gated behind observed data (LocumSmart
  timesheets are the natural future source). This directly fixes T4/F9a.
- **R4 — Malpractice-provision flag end-to-end** (impact: **medium**, effort: **medium**).
  Add `malpractice_provided` (tri-state: agency | facility | none/unknown) to the scraper
  row + PDF/freetext detection, and wire the dormant `insuranceProvidedBy`
  (`liveCalibration.ts:40,56`) into the quote context. Use it to SEGMENT (never multiply):
  direct-contract no-coverage observations should not silently share a bucket with
  agency-covered ones. Do not invent a $-equivalent multiplier — the tail-cost basis
  (100–200% of premium) is UNVERIFIED and premium varies by specialty/state.
- **R5 — Headline-inflation metadata bit** (impact: **medium**, effort: **low**). At
  extraction, if a bonus/stipend token occurs within N chars of an "up to"/range headline,
  set `headline_inflated_risk = true` on the observation (metadata only, no math change).
  Gives the anti-manip layer a lever to down-weight `rate_high` reliance later, and gives
  auditors a queryable cohort.
- **R6 — Bill-rate honesty label** (impact: **low-medium**, effort: **low**). One sentence on
  the bill line: "Professional-fee bill only — travel, lodging, and malpractice are billed or
  absorbed separately and are not included." Fixes F10's silent omission without building a
  cost model.
- **R7 — Anti-scope-creep: do NOT model CME/licensing/rental-car as rate factors** (impact:
  **low**, effort: **low**). Their per-hour materiality is below band resolution and the
  agency-absorbed norm keeps them out of the physician rate (F4/F6/F7). Context booleans
  only, if ever captured. Documenting the non-decision prevents a future fabricated
  multiplier.
- **R8 — Sub-floor drop counter** (impact: **low**, effort: **low**). Count rows dropped by
  the $60/hr / $400/day floors (parallel to `_POSTING_UNIT_UNSUPPORTED_COUNTER`,
  `agent.py:450`) so the gratis/pro-bono guard stays observable and a genuine market regime
  change can't be silently filtered (T6).

---

## Open questions

1. **Does IAS's own LocumSmart/Sisense data expose travel + housing line items** on invoices
   or assignment records (the 138-placements rate registry)? That would convert the entire
   extras block from ESTIMATED-industry-norm to OBSERVED-first-party — the single biggest
   upgrade available for F10/R2.
2. **What fraction of scraped postings does `_DOLLAR_REJECT_UNIT` currently drop?** No
   counter exists for this reject class (only the DAY-unit counter at `agent.py:450`). If the
   fraction is material, the F2 selection bias is material.
3. **Weatherby "lifetime tail" mechanics** — is it a true extended-reporting endorsement per
   assignment, or continuous-blanket-policy marketing? Changes whether "tail included" is a
   real cross-agency differentiator or table stakes.
4. **Urology `gratisHrs` 4→2** — pending audit decision (verifier-surfaced 2nd family;
   `reference_request_type_audit_2026-06-26.md`). Zach's call.
5. **Do any US locum agencies pay housing stipends in lieu of arranged housing at scale** for
   1099 physicians (the travel-nursing wage-recharacterization vector)? If yes, T3 needs a
   real detector, not just the never-anchor family list.
6. **Completion-bonus prevalence and magnitude in locums** — no named survey quantifies it
   (AMN's figures are perm-only). Candidate sources: NALTO member surveys, Locumstory annual
   survey, LocumTenens.com compensation reports.

---

## Provenance & confidence recap

- **OBSERVED (code):** every file:line cite above; GSA FY2026 values (`callRates.ts:379-404`,
  independently verified vs api.gsa.gov per the 2026-06-26 audit); gratisHrs/callback bands
  (`callRates.ts`); filter regexes (`card_extractor.py`).
- **OBSERVED (external, named):** CompHealth malpractice terms; Weatherby travel/housing/tail
  claims; Locumstory pay-structure norms; Clarke v. AMN Services (9th Cir. 2021); call-pay
  history (Pinnacle/HSG/Coker); AMN 2025 perm incentives.
- **ESTIMATED / UNVERIFIED:** tail cost 100–200% of premium; ERA bill/pay day bands
  ($3–5k vs $1.5–3k); "many locum contracts include CME funding"; uncompensated-call
  5–10 days/month typicality; AMN $38,315/$58,854/$403,000 figures (perm). All in
  claims_to_verify.
