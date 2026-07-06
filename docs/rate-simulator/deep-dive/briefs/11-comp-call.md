# Brief 11 — Compensation Taxonomy Part 2: CALL PAY

> Deep-dive research brief, 2026-07-03. Pillar: call pay as a top source of quote error.
> Scope: enumerate every call type in the locum-tenens market, cite real ranges, and map
> each to the LIVE engine (`ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine`
> + `src/lib/hub`, serving imstaffing.ai/hub). All file paths relative to that worktree root
> unless absolute. Every $ figure is labeled **OBSERVED** (read from code or a named public
> source) or **ESTIMATED/CONVENTION** (uncited internal constant). Nothing here is invented;
> anything I could not trace is marked UNVERIFIED and listed in claims_to_verify.

---

## Summary

Call pay is the best-typed and worst-fed factor in the engine. The type system is genuinely
strong — `CallCompModel` (`types.ts:229-233`) enforces the single most important market rule
(never mix a 24-hr beeper stipend with a worked clinical day), and `CALL_RATE_DATA`
(`callRates.ts:34-353`) is cite-or-suppress with real provenance notes. But the data behind
it is a static 2026-06-03 research snapshot (28 public sources, `callRates.ts:4-7`;
extracted text at `C:/Users/oclou/QueenClaude/ias-dashboard/docs/rate-simulator/call-rate-research-2026-06-03-deep-research.txt`)
that **can only decay**: the scraper drops every DAY-unit observation before insert
(`agent-sdk/agents/rate_scraper/agent.py` — `_POSTING_UNIT_UNSUPPORTED_COUNTER`, comment
"DAY→hourly conversion is a deliberate fleet-phase decision"), the Move #1 live overlay
mutates hourly `SPECIALTIES` only, and the hub consumes no calibration feedback — so **zero
live corroboration reaches any call number**.

Coverage against the north star ("unbelievably accurate for EVERY specialty"): of **88**
specialties in `SPECIALTIES` (`specialties.ts`, 88 entries), only **38** have a
`CALL_RATE_DATA` entry at all; **19** can produce a numeric weekday call-only quote, **10**
a weekend quote, **0** a holiday quote, **8** carry a callback band, **6** carry gratis
hours, and **3** carry an adjacent-hourly context signal. The other 50 specialties fall
through `getCallRateEntry()` (`callRates.ts:361-376`) to the honest "insufficient public
data" surface — honest, but a quote the recruiter cannot use. Meanwhile the market taxonomy
itself is only half-modeled: the engine has **no restricted/in-house call concept** (the
single largest documented price differentiator — restricted trauma call ≈ $2,000–2,500/day
vs unrestricted ≈ $1,000–1,500/day in the employed-FMV world, per Becker's), **no call
frequency/burden dial** (a "q2 in-house" and a "1:4 shared beeper" hourly assignment both
price at exactly +10%, `rateCalculator.ts:673`), and **callback/gratis fields that never
move a dollar** (`rateCalculator.ts:826-834` return them as display context only).

---

## Findings

### F1 — The market taxonomy of call pay (external, cited)

The U.S. physician call-pay market distinguishes these compensation constructs. Sources:
the FMV/consulting literature (Becker's Hospital Review "Physician Call Compensation Rates:
11 Determining Factors"; Pinnacle Healthcare Consulting; Coker Group; PMC6140224 "Call
Coverage Rates: What's Driving That Number?"), the crowd-sourced Physician Side Gigs on-call
database (updated Jan 2025), and the project's own 28-source locum deep research (2026-06-03).

1. **Unrestricted call (home / beeper / pager call).** Physician carries a pager and may be
   at home; must respond within a defined window (e.g. 20–30 min) and return to the facility
   if activated. Also called "beeper-only" coverage. Paid most commonly as a **per-diem
   daily stipend** (Coker: daily stipend "significantly more common than other options").
   OBSERVED (employed-FMV context): unrestricted trauma-adjacent call ≈ **$1,000–1,500/day**
   (Becker's 11-factors; UNVERIFIED exact figures — re-pull the article). OBSERVED (locum):
   the engine's 8 beeper bands, e.g. neurosurgery $4,200–4,800/day (Lancesoft OH + Ascend AR
   locum_1099 DocCafe postings, `callRates.ts:73-82`), urology $2,500–3,500/day
   (`callRates.ts:277-286`, 5 sources), GI $3,500–3,700/day (`callRates.ts:240-249`).
   Note the locum beeper day rates run FAR above employed medical-staff stipends for the
   same specialty — the two markets must never be blended.

2. **Restricted call (in-house call).** Physician must remain at (and if necessary sleep
   at) the hospital, unencumbered by other obligations. Commands a premium over unrestricted:
   restricted trauma surgery call ≈ **$2,000–2,500/day** vs $1,000–1,500 unrestricted
   (Becker's 11-factors, employed-FMV context; UNVERIFIED exact figures). Locum-side OBSERVED
   example from the 2026-06-26 request-type audit
   (`~/.claude/.../memory/reference_request_type_audit_2026-06-26.md` §3): Bright Line
   anesthesiology **in-house $3,500/12h vs pager $1,500/12h** — a ~2.3× spread *within one
   specialty at one agency*. **The engine has no restricted/in-house type at all** (see F4).

3. **Worked-day-during-call / clinic-plus-call.** A scheduled clinical day (8/10/12-hr)
   whose contract bundles after-hours availability. The engine's `worked-day-clinic` comp
   model covers the scheduled-day part (11 of the 19 priced weekday bands are `worked(...)`,
   e.g. anesthesiology $2,675–3,900/12h, `callRates.ts:137-146`; OB/GYN $3,900–4,200/12h,
   `callRates.ts:39-48`; nephrology $1,320–1,440/12h "clinic+call", `callRates.ts:250-259`).
   The bundled-call component is NOT separately priced anywhere.

4. **Callback / activation pay.** Hourly rate paid when physically called in, usually after
   a **gratis window**. OBSERVED locum callback bands in the engine (all from the 2026-06-03
   research): general surgery $325–350/hr (`callRates.ts:59`), orthopedic surgery $450/hr
   (`callRates.ts:67`), neurosurgery $475/hr (`callRates.ts:77`), trauma surgery $350/hr
   (`callRates.ts:97`), anesthesiology $400–500/hr (`callRates.ts:141`), cardiology $350/hr
   (`callRates.ts:224`), gastroenterology $375/hr (`callRates.ts:244`), urology $350–450/hr
   (`callRates.ts:281`). Cross-cutting convention (research p.15): the strongest
   callback-dollar visibility clusters in urology/GI/cardiology/neurosurgery/trauma/anesthesia.

5. **Gratis / included hours.** The included-time threshold before callback pay starts.
   OBSERVED convention: **2–4 gratis hours** is the most common threshold in public
   surgical/procedural call postings (research p.15; specifically urology, vascular, trauma,
   neurosurgery). Engine values: neurosurgery 4 (`callRates.ts:78`), vascular 2
   (`callRates.ts:88`), trauma 4 (`callRates.ts:98`), interventional cardiology 10
   (`callRates.ts:235`), GI 4 (`callRates.ts:245`), urology 4 (`callRates.ts:283`; the
   audit flagged a pending 4→2 correction, 2 independent families now at 2).

6. **Weekend / holiday differentials.** Locum market reality (research pp.1,15): weekend
   daily bands are published for some specialties (OB/GYN weekend beeper $1,500–1,800 vs
   weekday worked $3,900–4,200 — *different comp models*, `callRates.ts:39-48`; GI weekend
   typical $3,700 vs weekday $3,500, `callRates.ts:240-249`), but **holiday daily stipends
   are "by far the sparsest field"** — the research found holiday *hourly* premiums (e.g.
   anesthesiology $450/hr holidays, a LocumTenens.com search-result disclosure, research
   p.5) but no robust body of holiday day stipends. Agency guidance confirms the direction
   without numbers: "If you are on call or working weekends or holidays, you may earn a
   higher hourly rate" (CompHealth, comphealth.com/resources/how-locum-tenens-pay-works).

7. **Call frequency / burden ratio (1:N, q2) and activation rate.** In the FMV world these
   are primary rate drivers: "Higher frequency of call response results in increased
   burden"; "Increased percentage of calls resulting in full activations translates to
   higher burden"; response-time requirements ("15 minutes or the next day") have "a
   profound impact" (Pinnacle Healthcare Consulting, askphc.com). Trauma-designated
   facilities pay ~**15–25% more** than non-trauma (Becker's 11-factors; UNVERIFIED exact
   figure). Tertiary centers pay more than rural counterparts (PMC6140224).

8. **Other employed-world structures the classifier must EXCLUDE, not price:** annual
   stipends, salary-inclusive call, per-activation fee-for-service, RVU-credit models,
   deferred comp (Coker; Physician Side Gigs lists 7 distinct models, including "no call pay
   but RVUs"). These are W2/medical-staff constructs; if scraped they would poison locum
   bands. Note OIG Advisory Opinion 12-15 warns improperly structured call payments can
   disguise unlawful remuneration — a reason facility-side call FMV data is conservative
   relative to locum agency pricing.

**Scale calibration (employed vs locum — labeled, do not mix):** Physician Side Gigs
(self-reported, mostly employed, Jan 2025) medians/ranges per 24-hr call shift: general
surgery $400–2,000 (~$950 avg), ortho $500–2,500 (~$1,275 avg), anesthesiology $350–4,500,
neurology $1,000–2,500 (24-hr), OB/GYN $300–2,000, urology $150–1,600, radiology $200–2,600,
pediatrics ~$250 avg; and % *paid at all* for call ranges from 15% (IM) to 70% (urology).
The engine's locum beeper bands sit near or above the TOP of these employed ranges
(neurosurgery locum $4,200–4,800 vs employed ortho avg $1,275) — consistent with locum
day-rate economics, and a good sanity check that `CALL_RATE_DATA` is locum-pure.

### F2 — What the engine models today (the good part)

- **Comp-model typing is first-class and doctrine-enforced.** `CallCompModel =
  'worked-day-clinic' | '24hr-beeper-call' | 'mixed' | 'unknown'` (`types.ts:229-233`);
  every `CallRateBand` carries `{min,max,typical,compModel,coverageHrs}` (`types.ts:244-250`)
  and the research is explicit these are not interchangeable (`callRates.ts:13-16`). The
  cardiology entry is the exemplar: the $3,200/day worked-day quote is preserved in the note
  but deliberately NOT used to price the $2,500 beeper band (`callRates.ts:214-229`).
- **Cite-or-suppress works.** Null bands render the honest "insufficient public data"
  surface (`rateCalculator.ts:790-805` sentinel + `hub/sim-render.ts:107-113`), never a
  fabricated dollar. `getCallRateEntry()` returns an all-insufficient entry for the 50
  unlisted specialties (`callRates.ts:361-376`).
- **Honest $/hr denominator.** The hero $/hr divides the daily by `coverageHrs` — 24 for a
  beeper, the scheduled shift for a worked day (`rateCalculator.ts:811-812`,
  `hub/sim-render.ts:124`). The old gratis-hour divisor that overstated beeper $/hr was
  removed as dishonest (`types.ts:345-348`).
- **Call-only math** (`calculateCallRate`, `rateCalculator.ts:766-875`): daily = band
  `typical` × (geo × facility × duration, capped 1.75×), clamped to the researched band
  `max`, then to any parsed day/shift rate cap (`getCallOnlyPayCap`,
  `rateCalculator.ts:555-561`). Shift/call/holiday multipliers deliberately do NOT stack
  (baked into per-day-type bands, `rateCalculator.ts:851-854`). Bill = fixed 20% margin
  `roundUp5(pay/0.80)` (`hub/sim-adapter.ts:318-321`) — a ported dashboard CONVENTION,
  uncited as market practice.
- **Day-type resolution** (`inferDayType`, `rateCalculator.ts:444-501`): holiday >
  weekend > weekday, with hard-won label-leak fixes. **Call-only detection**
  (`detectCallOnly`, `rateCalculator.ts:572-603`): explicit field > beeper/home-call
  without clinical hours > "call only" text > 24-hr coverage without clinical duties.
- **Recent cited corrections landed:** neurosurgery beeper 4000→4200–4800 (commit
  `396da93`), anesthesiology worked-day 2600–2750→2675–3900 (commit `77bfe0b`), both from
  the adversarially-verified 2026-06-26 audit; GSA FY2026 table spot-checked 9/9 correct
  against api.gsa.gov (audit §4).

### F3 — Coverage census (the defect, quantified)

Counted directly from `callRates.ts:34-353` against `specialties.ts` (88 keys):

| Surface | Count | Specialties |
|---|---|---|
| `CALL_RATE_DATA` entries | 38 / 88 | listed in callRates.ts |
| Numeric weekday call quote possible | **19 / 88** | 8 beeper (gen surg, neurosurg, vascular, trauma, cardiology, int. cardiology, GI, urology) + 11 worked-day (ob/gyn, anesthesiology, IM, hospitalist, FM, nephrology, neurology, pathology, pediatrics, radiology, IR) |
| Numeric weekend call quote | **10 / 88** | ob/gyn, gen surg, neurosurg, vascular, trauma, hospitalist, cardiology, int. cardiology, GI, urology |
| Numeric holiday call quote | **0 / 88** | every `holiday:` slot is null |
| Callback band | 8 / 88 | gen surg, ortho, neurosurg, trauma, anesthesiology, cardiology, GI, urology |
| gratisHrs value | 6 / 88 | neurosurg 4, vascular 2, trauma 4, int. card 10, GI 4, urology 4 |
| adjacentHourly context | 3 / 88 | CRNA $200–325/hr, psychiatry $200–260/hr, neonatology $200–220/hr (`callRates.ts:147-151,287-292,315-320`) |

Depth is as thin as breadth: most bands are `sources: 0–2`; four are literally single-point
(trauma beeper 2500/2500/2500 `callRates.ts:93-102`, int. cardiology 3000/3000/3000
`callRates.ts:230-239`, and cardiology's flat 2500 band). Per the audit, some nulls are
*correct* (EM has no home-call structure — in-house worked shifts only; CRNA market is
hourly-only; psychiatry call is often unpaid/home and its only pager quotes trace to one
family) — but high-volume gaps like hospitalist weekend-only coverage, critical care,
pulmonology, otolaryngology, thoracic/colorectal/plastic surgery, and MFM are real
revenue-relevant holes.

### F4 — Taxonomy → engine map (per call type)

| Market call type | Engine representation | Status |
|---|---|---|
| Unrestricted / beeper / home call | `'24hr-beeper-call'` comp model + daily band | **FIRST-CLASS, static-only** (8 specialties) |
| Restricted / in-house call | **none** — no comp-model value, no band slot | **GAP.** The audit's strongest structural signal: trauma's $2,500 "beeper" actually matches AMN's worked-day band ($2,425–2,625/day) → likely a LABEL mismatch (`reference_request_type_audit_2026-06-26.md` §3); anesthesiology in-house $3,500/12h vs pager $1,500/12h is unrepresentable — both would land in the same slot |
| Worked-day-during-call | `'worked-day-clinic'` bands (11 specialties) | **PARTIAL** — the scheduled day prices; the attached call obligation does not |
| Call attached to an hourly assignment | `hasCall` boolean → flat **1.10×** (`rateCalculator.ts:673`; detection `rateCalculator.ts:323-337` — regex incl. `call ratio`, `call \d+:\d+`, `shared call`, `pager`, `beeper`) | **PARTIAL/ESTIMATED** — the 1.10 has no inline citation (nearest provenance: `RATE_SOURCES.shift`, `callRates.ts:411`); q2 in-house and 1:4 shared beeper price identically |
| Callback / activation $/hr | `CallbackBand` + `f.callbackRate` (`rateCalculator.ts:826-833`) | **PARTIAL — display-only**; deliberately not geo-scaled (cited flat contract rate); never multiplied into any pay figure |
| Gratis window | `gratisHrs` + `detectIncludedHours` (`rateCalculator.ts:606-618`, merged `rateCalculator.ts:906`) | **PARTIAL — display-only** (`includedHrs` returned untransformed, `rateCalculator.ts:834,857`) |
| Weekend differential | per-day-type band (`entry.weekend`) on call path; `SHIFT_MULT.weekend_day 1.15 / weekend_night 1.30` on hourly path (`multipliers.ts:16-17`, ESTIMATED band midpoints) | **PARTIAL** (10 specialties call-side) |
| Holiday differential | `entry.holiday` (all null → honest insufficient); hourly path `SHIFT_MULT.holiday 1.35` or `hasHoliday` 1.10× toggle (`multipliers.ts:18`, `rateCalculator.ts:675`) | **PARTIAL** — call-side holiday is 0/88 by honest design; hourly holiday multipliers are ESTIMATED |
| Call frequency / ratio / activation rate | regex-detected only to trip the boolean | **GAP** — never priced, never surfaced |
| Response-time requirement | not parsed, not priced | **GAP** |
| Trauma-designation premium | closest proxy `FACILITY_MULT.rural_trauma 1.30` / `cah 1.22` (`multipliers.ts:28,33`, ESTIMATED) | **PARTIAL** — see F6 saturation |
| Annual stipend / RVU-credit / salary-inclusive call (W2 constructs) | no type; scraper magnitude gates drop them incidentally (`card_extractor.py` hourly band $60–900, daily $400–12,000) | **CORRECTLY EXCLUDED**, but by accident of magnitude, not by classification |

### F5 — The split brain and the manual-sim blind spot

The hourly path and the call-only path are a **cliff, not a dial**: `detectCallOnly`
flipping changes the quote regime entirely (different data table, different margin model,
different multiplier stack). On the hourly side, call burden = +10% flat. And in the hub's
most common recruiter flow — the manual controls — call cannot be expressed at all:
`factorsFromControls` hardcodes `call: { hasCall: false }` and
`callOnly: { isCallOnly: false }` (`hub/sim-adapter.ts:141,145`). Only the PDF/freetext
paths (`simParseAssignment`/`simParseFreetext`, `hub/sim-adapter.ts:185-218`) can produce a
call quote. A recruiter pricing a call-heavy hourly assignment from the controls gets a
no-call number with no warning.

### F6 — Call-only quotes saturate the band max, erasing geo/facility premium

`dayPay` clamps `typical × cappedMult` to the researched band `max`
(`rateCalculator.ts:790-798`). For narrow or single-point bands this makes the upside
multipliers inert: trauma surgery `beeper(2500,2500,2500)` clamps for ANY combined mult
> 1.0; neurosurgery (typical 4500, max 4800) clamps at mult ≥ 1.067 — so a CA (high-geo) or
rural-trauma-facility call quote equals the national one, while low-mult states still scale
DOWN. Asymmetric by design (never exceed the highest publicly observed daily — honest), but
it means the call path systematically under-differentiates high-cost geographies, and the
`marketMaxApplied` note (`hub/sim-render.ts:117-118`) is the only tell. The fix is more
observed data (wider bands), not a looser clamp.

### F7 — Zero live-data path for call, in four places

1. **Scraper:** posting rows with `unit != "HOUR"` are dropped-and-counted
   (`agent.py`, `_POSTING_UNIT_UNSUPPORTED_COUNTER`, "DAY→hourly conversion is a deliberate
   fleet-phase decision" — verified firsthand in this session). Every daily call stipend the
   fleet sees dies here.
2. **Bridge/overlay:** `applyMarketBucketsOverlay` mutates hourly `SPECIALTIES` only
   (`marketRates.ts:469-551`); no call-band overlay path exists even in design. Calibration
   rows are mode-aware (`rateMode: 'hourly' | 'call_daily'`, `marketRates.ts:562-607`, with
   the `LEGACY_CALL_DAILY_FLOOR = $1000` magnitude classifier — rationale cited to
   Locumstory 2025/CompHealth, worth re-verifying) — but…
3. **Hub:** neither `loadSpecialtyCalibration` nor `computeDisplayedRate` has any call site
   in `src/lib/hub` outside tests (grepped this session) — the recruiter-feedback loop that
   could observe accepted call quotes is dormant on the live surface (Move #4 open).
4. **Schema:** `CallRateEntry` is one-band-per-day-type-slot, which BLOCKED two
   audit-confirmed additions: the anesthesiology beeper axis (Bright Line pager ~$3,000/24h,
   in-house $3,500/12h, locums.one $6,000–9,000/24h — confirmed, 2 families + SDN) and the
   trauma worked-day axis (AMN $2,425–2,625/day + Parsons in-house $3,600/24h — confirmed),
   plus optional neonatology worked-day bands (AMN $1,455–1,575/day sub-24h; Barton in-house
   $210–245/hr ≈ $5,040–5,880/24h) (`reference_request_type_audit_2026-06-26.md` §3, §5).

### F8 — What the quote surface can and cannot say about market position

For call-only, `quoteFromFactors` returns `percentiles: []` and `waterfall: []`
(`hub/sim-adapter.ts:334-338`): there is **no distribution, no percentile placement** — the
north star's "where the rate sits in the market" is unanswerable on the call path today.
The band `{min,max,typical}` from ≤5 sources is the entire distribution model. Also note
the vocabulary hazard: "per diem" means the call-only daily stipend at
`rateCalculator.ts:755` but GSA travel lodging+M&IE at `callRates.ts:378-404` — two
unrelated comp concepts in one file.

---

## Recommendations

1. **Split `CallRateEntry` into per-comp-model axes** (beeper / in-house-restricted /
   worked-day per day-type) and add `'in-house-call'` (restricted) to `CallCompModel`.
   This is the schema unblock for the three audit-CONFIRMED adds (anesthesiology beeper
   axis, trauma worked-day axis + label investigation, neonatology worked-day) and the only
   way to represent the restricted-vs-unrestricted premium — the market's largest single
   call differentiator. Canonical edit in ias-dashboard engine, golden-master regen, sync.
   **[impact: high | effort: medium]**
2. **Apply the still-open 2026-06-26 audit items** once the schema exists: anesthesiology
   beeper axis, trauma `worked(2425,2625,2525,24)` + investigate the $2,500 "beeper" label
   mismatch FIRST, optional neonatology bands, and decide the pending urology `gratisHrs`
   4→2. All are cite-clean, ≥2 independent non-CHG families. **[impact: medium | effort: low]**
3. **Open the DAY-unit funnel**: persist `unit='DAY'` posting rows into a separate
   `call_daily` bucket (new rate_type or unit column; NEVER convert to hourly), teach the
   bridge to build daily-call posteriors per (specialty, comp-model) cell, and design a
   call-band overlay parallel to Move #1 (anchor `typical`, keep curated band geometry).
   This is the only path to call data that doesn't decay. Requires IronDome daily bands
   (the $400–12,000 magnitude gate already exists in the extractors). **[impact: high | effort: high]**
4. **Give the manual sim a call control** (none / home-beeper / in-house / call-only +
   day-type) instead of hardcoded `hasCall:false` — recruiters' primary flow currently
   cannot express the factor this brief is about. Freetext path already proves the engine
   plumbing. **[impact: high | effort: medium]**
5. **Replace or cite the flat hourly 1.10× call multiplier.** Either tier it by
   burden/restriction with cited differentials, or keep 1.10 but label it ESTIMATED on the
   surface and in `RATE_SOURCES`. Today it is an uncited constant that prices q2 in-house
   equal to 1:4 beeper. **[impact: medium | effort: low]**
6. **Price a labeled "expected call-day total comp" scenario**: stipend + max(0, expected
   callback hrs − gratis) × callback rate, using ONLY the cited callback band and gratis
   values, presented as a scenario band (quiet vs busy day) — never as the anchor. This
   converts two display-only fields into decision value without fabricating a rate. The
   cardiology note's "~20% callback average" (Scranton posting, `callRates.ts:228`) is the
   kind of activation-rate evidence to capture systematically. **[impact: medium | effort: medium]**
7. **Instrument recruiter feedback with `rateMode:'call_daily'`** (Move #4): the engine
   already types it (`marketRates.ts:562-607`); wiring hub feedback would create the first
   OBSERVED call-rate stream from IAS's own placements — the only data source that can
   cover the 50-specialty long tail where public disclosure doesn't exist. **[impact: high | effort: medium]**
8. **Buy/ingest one cross-check survey** (SullivanCotter Physician & APP On-Call
   Compensation Survey — restricted vs unrestricted and trauma-level cuts; or MGMA On-Call
   report) as a LABELED non-locum prior for sanity-checking band plausibility per specialty,
   analogous to `blsSanityCheck`'s role for hourly. Never anchor quotes from it.
   **[impact: medium | effort: low (cost, not code)]**
9. **Surface geo-saturation honestly**: when `marketMaxApplied` fires on call-only in a
   high-mult state, say "band ceiling reached — high-cost-state premium not reflected;
   based on N public sources" so recruiters know the flatness is a data limit, not a market
   fact. **[impact: low | effort: low]**
10. **Rename one of the two "per diem" concepts** in `callRates.ts` (call stipend vs GSA
    travel) before any stipend work begins (Brief 12 territory) — cheap now, expensive
    after more consumers exist. **[impact: low | effort: low]**

---

## Open questions

1. **Is trauma's $2,500 "beeper" band actually a worked-day rate?** The audit's verifier
   says the number matches AMN's worked-day band — if so the current label misprices the
   $/hr hero by the 24-vs-shift divisor. Needs the original posting re-pull before any edit.
2. **What is the real restricted-vs-unrestricted spread in the LOCUM market** (not the
   employed-FMV market)? Only one within-specialty pair is on file (Bright Line anesthesia
   $3,500/12h in-house vs $1,500/12h pager). Is ~2–2.3× generalizable across specialties?
3. **Call frequency pricing:** does the locum market actually price 1:2 vs 1:4 differently
   on the DAILY stipend, or only via more paid days? No public evidence either way in the
   collected sources; determines whether a burden dial belongs on the daily or only on the
   hourly path.
4. **Weekend/holiday call:** should holiday call-only remain 0/88 (honest) or is IAS's own
   LocumSmart feed (rateRequirements.maxHolidayMultiplier already observed in
   `liveCalibration.ts:32-37`, unconsumed) usable as a facility-side ceiling signal for
   holiday call quotes?
5. **The 20% fixed call-only margin** (`hub/sim-adapter.ts:318-321`): is that IAS's actual
   call-margin practice? It is a ported dashboard convention with no market citation; if
   real placements bill differently, the bill-side of every call quote is off.
6. **Does IAS's own placement history contain call assignments** (LocumSmart
   webhook/Sisense tap) that could seed OBSERVED call rates for the top-gap specialties
   before the scraper path (Rec 3) lands?
