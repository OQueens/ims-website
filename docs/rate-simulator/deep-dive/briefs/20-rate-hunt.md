# Brief 20 — Known-Pain Rate Hunt: curated cells vs cited public locum 1099 comparators

> Deep-dive brief, 2026-07-03. Pillar: "specific rates feel wrong."
> Engine under test = the LIVE simulator (imstaffing.ai/hub, `ias-website` repo):
> curated bands `src/lib/rate-engine/specialties.ts`, call bands `src/lib/rate-engine/callRates.ts`,
> ingestion plausibility `C:/Users/oclou/QueenClaude/agent-sdk/core/iron_dome.py`.
> "Engine default quote" below = the band's p70 (`specialties.ts:179`), which is exactly what the
> hub quotes for a National / day-shift / community / standard-duration manual request (all
> multipliers 1.0 — map 01 §5).
>
> HARD RULE compliance: every engine number is READ (file:line); every external number is cited
> to a named source. Comparators are labeled by quality tier. Where evidence diverges, the cell is
> flagged for verification, not silently "corrected." Nothing here changes code.

---

## Summary

1. **The engine's own named upstream source has drifted away from the curated table.** The header
   of `specialties.ts` (lines 3-5) cites "LocumStory 2025 (CHG)" as the first verified source. The
   currently-published LocumStory 2025 pay-trends table now disagrees with the curated band in
   **7 of the 12 specialties it lists**, and in every one of those 7 the engine's DEFAULT quote
   (p70) sits **above LocumStory's published max** (family medicine, internal medicine, pediatrics,
   psychiatry, OB/GYN, orthopedic surgery, urology — table in Finding 1). The drift is one-sided:
   engine tops run rich.
2. **Two cells look clearly TOO HIGH against multiple independent citations**: pediatrics
   (engine 110–160, p70 145 vs Barton 93–130 + LocumStory 105–130 + PhysicianSideGigs avg 108) and
   OB/GYN (engine 160–275, p70 241 vs LocumStory 150–225 + Barton 120–200 + PSG avg 155; one
   contrary source). Endocrinology and the top half of family medicine are probable-high.
3. **Two cells look TOO LOW at the top**: gastroenterology (engine max 310 vs PSG self-reported
   average $367 and AMN's posted-jobs average ≈$729k/yr) and pathology (engine max 200 vs AMN
   posted range up to ≈$263/hr-equivalent and a cited $271/hr VA posting; the engine's OWN
   callRates worked-day band implies $185–215/hr — above the hourly band's p70).
4. **Ingestion-ceiling defects (self-inflicted blindness):** IronDome caps scraped CRNA rows at
   $250/hr while the engine's own `callRates.ts:150` cites public 1099 CRNA rate sheets at
   $200–325/hr and AnesthesiaOnCall documents $275–325 surge rates — so the pipeline REJECTS the
   exact observations that could ever prove the surge market exists. Same class of bug:
   IronDome's allergy/immunology max ($200) is BELOW the curated band max ($215).
5. **The public comparator landscape is heavily poisoned**, which both (a) validates the engine's
   never-anchor design (ZipRecruiter/Adzuna exclusion, `sourceFamily.ts:105-107`) and (b) means
   several "engine looks wrong" signals from casual comparison are actually comparator garbage
   (Sermo lists family medicine at $40–45/hr — an obvious W2/ZipRecruiter blend artifact).
6. **~55 of 88 specialty cells could not be verified against any clean public 1099 hourly
   comparator in this pass** (list in Finding 7). For the north star ("unbelievably accurate for
   EVERY specialty"), those cells are running on unverifiable analyst curation — the scraper fleet
   is the only realistic path to corroborating them.
7. **Aligned cells (good news):** anesthesiology, emergency medicine, radiology, neurology,
   medical oncology, critical care, neonatology, dermatology, CRNA (band center), and the NP/PA
   bands all sit inside or on top of multiple independent citations. The 2026-06 accuracy passes
   (IM/urology/radiology, call bands) visibly improved the table.

**Comparator quality tiers used below**
- **T1 — agency-published locum-specific rate pages** (Barton Associates salary guides;
  LocumStory/CHG pay-trends; AnesthesiaOnCall guides): named firms staking their brand on the
  number; still marketing copy, not placement microdata.
- **T2 — self-reported community data** (PhysicianSideGigs compensation database): real locum
  respondents, unknown n, averages only, admitted small samples in some specialties.
- **T3 — advertised-job aggregates** (AMN "available jobs" averages, Marit Health averages):
  computed off live postings; annualization basis opaque.
- **T4 — derived/secondary** (AllStar 2026 guide: annual FTE ranges ÷ 2,000 hrs, itself citing
  LocumStory/Sermo/Medscape).
- **POISONED — do not use as truth** (ZipRecruiter, Sermo hourly table, salary.com): W2-blended
  or scrape-modeled; used here only as contamination evidence.

---

## Findings (cited)

### Finding 1 — The named upstream source (LocumStory 2025) now contradicts 7 curated bands, always in the "engine rich" direction

Engine bands READ from `specialties.ts:58-165`; p70 per `specialties.ts:179`.
LocumStory 2025 table fetched 2026-07-03 from locumstory.com/spotlight/locum-tenens-compensation-trends
(12 specialties, 2025 vs 2024 hourly ranges, no methodology disclosed).

| Specialty | Engine band (line) | Engine default quote (p70) | LocumStory 2025 | Default quote vs LS max |
|---|---|---|---|---|
| Anesthesiology | 300–400 (:58) | 370 | $300–400 | inside ✓ |
| Emergency medicine | 200–300 (:67) | 270 | $200–300 | inside ✓ |
| Cardiology | 250–360 (:94) | 327 | $250–350 | ≈ at max |
| Medical oncology | 350–500 (:105) | 455 | $375–500 | inside ✓ |
| Neurology | 180–275 (:97) | 247 | $200–275 | inside ✓ |
| Family medicine | 120–175 (:77) | **159** | $120–145 | **+$14 above max** |
| Internal medicine | 130–200 (:76) | **179** | $120–145 | **+$34 above max** (but see F6 — PSG supports 173) |
| Pediatrics | 110–160 (:135) | **145** | $105–130 | **+$15 above max** |
| Psychiatry | 180–255 (:121) | **233** | $185–220 | **+$13 above max** |
| OB/GYN | 160–275 (:114) | **241** | $150–225 | **+$16 above max** |
| Orthopedic surgery | 210–340 (:82) | **301** | $200–240 | **+$61 above max** (LS looks like the outlier — see F6) |
| Urology | 220–330 (:144) | **297** | $220–275 | **+$22 above max** (contested — Barton says $200–500) |

Interpretation (careful): agreement on anesthesiology/EM/cardiology/onc/neuro is partly **by
construction** (LocumStory is a curated-table source). The seven disagreements therefore mean
either (a) the LocumStory page changed since curation, or (b) the curated tops were taken from
other, hotter sources (OnCall Solutions, TheLocumGuy, FastRVU per header) — but in EITHER case the
default quote sitting above the named source family's max is a defect for a tool whose premiums
(shift/geo/urgency) are supposed to be applied ON TOP of the base via multipliers, not baked into
the base. Confidence: table values OBSERVED (both sides); interpretation MEDIUM.

### Finding 2 — Cells flagged TOO HIGH (multi-source)

**2a. Pediatrics — strongest over-quote flag in the table.**
- Engine: 110–160, default quote 145 (`specialties.ts:135`, confidence 'medium').
- Cited comparators: Barton Associates pediatrician guide: locum $93–130/hr (T1, 2026, "BLS
  national mean hourly $107.21" as perm baseline); LocumStory 2025: $105–130 (T1);
  PhysicianSideGigs database: average $108/hr (T2); AllStar 2026 annualized: $200–290K ≈ $100–145
  implied (T4).
- Every T1/T2 comparator tops out at ~$130. The engine's default quote ($145) is above all of
  them, and the max ($160) is 23% above Barton's top.
- **Proposed corrected band: 95–135 (p70 → 123)** — union of Barton (93–130) and LocumStory
  (105–130) with $5 headroom at the top; construction stated, needs the normal cited-audit process
  before any commit. Confidence in direction: HIGH; in exact numbers: MEDIUM.

**2b. OB/GYN (core) — probable over-quote, one dissenting source.**
- Engine: 160–275, default quote 241 (`specialties.ts:114`, 'medium').
- Cited: LocumStory 2025 $150–225 (T1); Barton OB/GYN guide $120–200/hr, explicitly reflecting
  "hard-to-fill call coverage, rural demand" i.e. already premium-flavored (T1, but sourced from
  ZipRecruiter/Sermo/PSG aggregation — weaker than usual Barton); PSG average $155 (T2);
  DISSENT: AllStar 2026 $390–570K ≈ $195–285 implied (T4).
- Three of four put typical OB/GYN locum ≤ $225; the engine default of $241 exceeds that.
  NOTE the comp-model trap: OB/GYN locum work is often quoted as 24-hr call days
  (engine's own `callRates.ts:39-48` worked-day $3,900–4,200/12h ≈ $325–350/hr) — hourly
  comparators may understate what worked OB days actually clear. That is an argument for keeping a
  wide max, not for a $241 DEFAULT.
- **Proposal: review toward 150–240 (p70 → 213)**; gate on scraped market-typed postings before
  changing. Direction confidence: MEDIUM-HIGH.

**2c. Endocrinology — probable over-quote at the default.**
- Engine: 200–275, default quote 253 (`specialties.ts:102`, 'modeled' — no confidence tag).
- Cited: Barton endocrinologist guide $150–200/hr (T1, 2026, W2 baseline ≈$140/hr);
  AMN available-jobs $401–434K/yr ≈ $200–217/hr implied (T3); Aya pediatric-endocrinology
  postings $230–240/hr (T3, via AMN/search result — note this is a SUBSPECIALTY the engine has no
  key for).
- Engine min (200) = Barton max; default quote 253 is above every cited adult-endo point.
- **Proposal: review toward 160–240 (p70 → 216)**. Direction confidence: MEDIUM-HIGH.

**2d. Family medicine — top half runs rich.**
- Engine: 120–175, default quote 159 (`specialties.ts:77`, 'medium').
- Cited: LocumStory 2025 $120–145 (T1); PSG average $140 (T2); AllStar $210–300K ≈ $105–150 (T4).
- Default quote $159 exceeds all three cited maxima/averages. The 175 max may be defensible as
  urgent/rural top, but the default should not be.
- **Proposal: review max toward ~160 and/or reposition the default** (see Finding 8). Direction
  confidence: MEDIUM-HIGH.

**Watch-list (rich defaults, single-source or conflicting evidence — do NOT change yet):**
- **Hospitalist** 145–240, default 212 (`specialties.ts:74`): PSG avg $175–180 (T2); TheLocumGuy
  "$130/hr low … $200+/hr high-end rural/nights" (T1-ish blog); engine's own Aya-derived call band
  `callRates.ts:180-189` implies $170–200/hr. Default $212 sits above every cited typical; max 240
  plausibly covers nocturnist/ICU-comfort premium (the separate nocturnist band is 179–260,
  `specialties.ts:75`).
- **Psychiatry** 180–255, default 233 (`specialties.ts:121`): PSG avg $223 ≈ supports; LocumStory
  $185–220 says rich. Prior cherry-picked honesty downgrade already reduced its confidence tier.
- **Interventional cardiology** 320–460, default 418 (`specialties.ts:95`): Marit Health average
  $346/hr (T3); AMN advertised average ≈$363/hr-equivalent (T3); AllStar $235–340 implied (T4).
  Default 418 above all cited averages — but averages ≠ p70 and IC postings legitimately spike.
- **Urgent care** 115–155, default 143 (`specialties.ts:71`): Sermo $110–130 (poisoned-tier) and
  AllStar $95–140 (T4) both below; weak evidence, minor dollars.
- **Maternal-fetal medicine / gyn-onc / urogynecology** (`specialties.ts:115,117,118`; defaults
  277 / 337 / 263): Barton's only public points are $218 / $172 / $152 per hour. The gyn-onc $172
  is internally implausible (below its own W2 equivalent) — treat Barton as suspect here, but the
  engine values are effectively uncorroborated. Verify-only.

### Finding 3 — Cells flagged TOO LOW (top end)

**3a. Gastroenterology — top of band likely below the real advertised market.**
- Engine: 185–310, default quote 273 (`specialties.ts:99`, 'medium').
- Cited HIGH side: PSG database average **$367/hr** (T2 — an AVERAGE above the engine's MAX);
  AMN available-GI-jobs average $729K/yr ≈ $365/hr at 2,000 hrs (T3; top posting $968K).
  Cited LOW side: Barton GI guide $150–263/hr (T1, Medscape/Doximity-derived).
- Two independent-ish sources converge near $365 while the engine cannot quote above $310
  (researched-range ceiling, `rateCalculator.ts:704-707` clamps to spec.max). If the PSG/AMN
  signal is real, every hot GI quote is silently clamped ~15-20% low.
- **Proposal: do NOT hand-raise yet** (Barton contradicts). Make GI a first-priority scrape target;
  a market-typed posterior with n≥4 + 2 families would resolve this and can already anchor via the
  Move #1 ladder (`marketRates.ts:469-551`). If corroborated, candidate max ≈ 350–380.

**3b. Pathology — max contradicted by advertised postings AND the engine's own call table.**
- Engine: 120–200, default quote 176 (`specialties.ts:147`, 'modeled').
- Cited: AMN locum-pathology available jobs $271K–$526K/yr ≈ $135–263/hr implied, average $338K
  ≈ $169/hr (T3); AMN VA-facility pathologist posting $271/hr, short-term acute-care $151/hr (T3);
  AMN anatomic-path hourly $140–151 (T3). Internal: the engine's own worked-day pathology band
  `callRates.ts:293-302` ($1,480–1,720 over 8h) implies **$185–215/hr** — its top is above the
  hourly band's max.
- Center of the band is fine (AMN avg $169 ≈ default 176); the **max 200 is the defect** — the
  engine can never quote the documented top quartile.
- **Proposal: raise max toward ~250 (band 120–250, p70 → 211), or minimally 120–215 to reconcile
  with the engine's own cited callRates evidence.** Direction confidence: HIGH (internal
  contradiction alone justifies it); exact number: MEDIUM.

### Finding 4 — Ingestion ceilings that reject documented reality (self-inflicted blindness)

- **CRNA:** IronDome `PLAUSIBLE_RANGES["crna"] = {min 120, max 250}` (`iron_dome.py:24`, OBS-03
  comment explains the deliberate tighten) and its mirror `MAX_HOURLY_CEILING = {crna: 250}`
  (`blsSanityCheck.ts:220-223`). But the engine's own curated context cites "Public 1099 CRNA rate
  sheets at $200–325/hr" (`callRates.ts:150-151`) and AnesthesiaOnCall's 2025 CRNA guide states
  ~$200/hr nationwide with urgent-fill offers at **$275–325/hr**. Consequence: any scraped CRNA
  row whose `rate_high` reflects the documented surge market ($275–325) fails
  `validate_rate_record` (`iron_dome.py:133-139`) and never reaches Supabase → the bridge → the
  posterior. The quote band (190–250, `specialties.ts:59`) may well be right for TYPICAL fills —
  but the pipeline is structurally incapable of ever learning otherwise. This is the exact
  opposite failure mode of the $309 Kokomo over-quote the tighten was protecting against.
- **Allergy/immunology:** IronDome max **$200** (`iron_dome.py:50`) < curated band max **$215**
  (`specialties.ts:109`). A scraped observation at $210 — inside the engine's own quoted band —
  is rejected at ingestion. Pure inconsistency; no research question.
- **Coverage note:** ~60 of the 88 engine specialties have no IronDome key at all and fall to
  `DEFAULT_RANGE {60, 700}` (`iron_dome.py:53,133`) — permissive, so no false rejects, but it
  means plausibility validation is real for only ~28 specialties.

### Finding 5 — The comparator landscape itself is the anti-manipulation lesson

- Sermo's 2026 hourly table (fetched 2026-07-03) lists family medicine at **$40–45/hr**,
  pediatrics $35–40, psychiatry $80–90, anesthesiology $180–220 — physically impossible locum
  figures that its own sourcing note explains (compiled from ZipRecruiter et al.). ZipRecruiter's
  "locum GI $182/hr", "locum hospitalist $157/hr", "locum neonatologist $138/hr" run 30–60% below
  every T1 agency figure.
- This is live confirmation of the engine's NEVER-ANCHOR design (ZipRecruiter CRNA $124.86 ≈ half
  the real $200–250 market — production observation cited at `sourceFamily.ts:105-107`; exclusion
  applied at `aggregateBridge.ts:810-813`).
- Risk worth naming: Barton's newer salary guides now openly aggregate "ZipRecruiter (Feb 2026),
  Sermo (2025), Physician Side Gigs (2025)" for some specialties (their OB/GYN guide says exactly
  that) — i.e., even T1 agency pages are starting to launder T-poisoned data. Comparator quality
  must be re-checked per page, per year, not per brand.

### Finding 6 — Cells the hunt CORROBORATED (no action)

| Cell | Engine (line) | Corroboration |
|---|---|---|
| Anesthesiology 300–400, p70 370 (`specialties.ts:58`) | LocumStory 2025 $300–400; AnesthesiaOnCall 2025 "climbed from $275–325 (2024) to $300–400 (2025)"; PSG avg $292 (average sits just below band min — consistent with self-report skew) |
| Emergency medicine 200–300, p70 270 (:67) | LocumStory $200–300; PSG avg $258; AllStar ABEM ≈$225–310 implied |
| Radiology 185–330, p70 287 (:130) | PSG avg **$289** (near-exact match to the default quote); AllStar ≈$195–285 |
| Neurology 180–275, p70 247 (:97) | LocumStory $200–275 |
| Medical oncology 350–500, p70 455 (:105) | LocumStory $375–500 |
| Critical care 190–300, p70 267 (:78) | PSG pulm/CC avg $288; AllStar ≈$215–295 |
| Neonatology 175–260, p70 235 (:136) | Barton: 24-hr-shift locum rates $210–235/hr (PSG's $150 avg is the outlier; likely blends non-24hr structures) |
| Dermatology 200–300, p70 270 (:145) | Barton $200–300 (exact); Sermo $275–320 overlaps top (AllStar ≈$165–245 is the sole low outlier) |
| CRNA 190–250 band center (:59) | AnesthesiaOnCall ~$200/hr nationwide; AllStar ≈$175–255 implied (ceiling issue is Finding 4, not the band center) |
| Internal medicine 130–200, p70 179 (:76) | PSG avg $173 supports the 2026-06 correction; LocumStory's $120–145 reads as outpatient-only |
| General surgery 200–310, p70 277 (:81) | AllStar ≈$225–310; Sermo $200–265; (PSG avg $193 low outlier) |
| Urology 220–330, p70 297 (:144) | Contested but bracketed: Barton $200–500 ("widest bands in medicine") vs LocumStory $220–275; recently re-audited with citations — keep |
| NP/PA bands (:159-165) | AllStar implied: Psych NP ≈$80–130 vs engine 85–120 ✓; FNP ≈$65–100 vs 70–95 ✓; surgical PA ≈$75–115 vs 85–120 ✓ |

Also corroborated at the call-band level (from map 05 / callRates reads, cited in-file):
neurosurgery beeper $4,200–4,800/day (Lancesoft OH + Ascend AR, `callRates.ts:73-82`),
anesthesiology worked-day $2,675–3,900 (Aya/Bright Line/AnesthesiaOnCall, `callRates.ts:137-146`).

### Finding 7 — Cells that could NOT be verified in this pass (no clean public 1099 hourly comparator found)

Hourly bands with zero or near-zero independent corroboration located (all `specialties.ts`):
anesthesiologist assistant (:60), cardiac/pediatric/obstetric anesthesiology (:61-63), pain
management (:64), em nocturnist (:68), rural EM (:69), pediatric EM (:70), hospitalist nocturnist
(:75), neurosurgery hourly 330–480 (:83 — only AllStar's ≈$295–415 implied annualization found;
call-day band IS corroborated), thoracic/vascular/plastic/pediatric/colorectal/hand surgery +
surgical oncology (:84-91), trauma surgery (:86 — AllStar ≈$250–345 implied suggests the 194 min
may be LOW; single derived source), electrophysiology (:96), neurointerventional (:98),
pulmonology (:100), nephrology (:101 — Barton guide exists but returned no clean locum band in
this pass), rheumatology (:103), infectious disease (:104), hematology (:106), heme/onc (:107),
sleep medicine (:108), medical genetics (:110), nuclear medicine (:111), reproductive
endocrinology (:116), all six psychiatry subspecialties (:122-127), interventional radiology
hourly (:131 — call-day band cited in callRates), neuroradiology (:132), pediatric subspecialties
(:137-141), PM&R (:146), ophthalmology (:148), otolaryngology (:149 — PSG "$250 avg ENT" is the
one weak point found, consistent with the band), sports/palliative/geriatric/occupational/
correctional/preventive/wound care (:150-156).

**Count: ~55 of 88 cells are effectively curation-only.** These are exactly the cells the fleet's
Wave-2 specialty expansion should hit, in book-volume order.

### Finding 8 — Systemic: the p70-default embeds a premium before any premium factor is applied

`baseRate = spec.p70` on BOTH entry paths (map 01 §2; `sim-adapter.ts:127` / `rateCalculator.ts:878`),
and p70 = min + 0.70×(max−min) (`specialties.ts:179`). Curated maxes explicitly represent
"high-acuity, urgent, underserved" tops (Barton's own guides say this; so does the engine's
comment history). So the no-premium default quote already prices at the 70th percentile of a range
whose top IS the premium market — then shift/geo/urgency multipliers stack on top of it. Findings
1-2 are largely this one defect expressed per-cell: in 7 of 12 LocumStory-listed specialties the
default quote exceeds the source's max. Where a live posterior anchors (Move #1), this self-heals
(anchor replaces p70); everywhere else, the static p70 IS the quote.

---

## Recommendations

| # | Recommendation | Impact | Effort |
|---|---|---|---|
| R1 | **Cited re-audit + correction of the 4 flagged-high bands** — pediatrics → ~95–135, OB/GYN → ~150–240, endocrinology → ~160–240, family-medicine max → ~160 (exact numbers via the established cited-audit process; golden-master + show-before rules apply) | high | low |
| R2 | **Fix the two ingestion-ceiling defects**: `iron_dome.py` crna max 250 → 325 (cite AnesthesiaOnCall 2025 + engine's own callRates.ts:150 rate-sheet evidence) with the mirrored `blsSanityCheck.ts:223` ceiling raised in the same change (they are documented mirrors); allergy/immunology max 200 → ≥215 to match `specialties.ts:109`. Quote bands unchanged — this only lets the pipeline SEE the contested market so posteriors can decide | high | low |
| R3 | **Point the scraper fleet at the divergence cells first**: GI (is the market really ~$365?), pathology top, OB/GYN, pediatrics, endocrinology, hospitalist. Market-typed postings with n≥4 + 2 families anchor automatically via the Move #1 ladder — this converts every open dispute in this brief into observed data | high | medium |
| R4 | **Raise the pathology max now** (120 → keep min; max 200 → 215 minimum, 250 preferred) — justified by the engine's own callRates evidence alone (`callRates.ts:293-302`), independent of external sources | medium | low |
| R5 | **Re-baseline the curated table against current LocumStory 2025 and add per-band inline citations** — today `specialties.ts` has file-header citations only; per-band provenance would have caught the Finding-1 drift mechanically | medium | medium |
| R6 | **Decide the default-quote position explicitly** (Finding 8): either document "we quote p70 = aggressive-but-winnable" as product intent, or move the default to the band median and let multipliers carry all premium. Affects every static-quoted cell simultaneously — show-before, Zach sign-off | high | medium |
| R7 | **Add missing specialty keys where a cited market exists**: pediatric endocrinology (Aya postings $230–240/hr surfaced in this pass — engine currently folds it into adult endocrinology at a LOWER band, grep confirms no key/alias); scope radiation oncology similarly (locum market exists; no clean rate found this pass) | medium | low |
| R8 | **Codify the poisoned-comparator list** (ZipRecruiter, Sermo hourly tables, salary.com, and now "T1 pages that aggregate them" e.g. Barton's newer OB/GYN guide) in the sourceFamily/never-anchor docs so future audits don't re-litigate them | low | low |
| R9 | **Wire the feedback loop (existing Move #4)** — recruiter accept/reject deltas are the only ground truth that can adjudicate the watch-list cells (hospitalist, psychiatry, interventional cardiology, urgent care) where public sources conflict | high | medium |

---

## Open questions

1. **What annualization basis do AMN's "available jobs up to $X annually" figures use?** The GI
   ($729K avg) and pathology ($526K top) implied-hourly numbers in Finding 3 assume 2,000 hrs/yr;
   if AMN annualizes at 2,300+ hrs (locum-heavy schedules), the implied hourlies drop ~15%.
2. **Has the LocumStory page changed since the curated table was seeded?** If the 2025 table was
   updated mid-year, Finding 1's drift is upstream churn, not curation error — the fix (R5,
   per-band citations with retrieval dates) is the same either way.
3. **What does the IMS placement book actually weight?** Flag severity here is market-generic;
   if IMS staffs 10× more hospitalists than pediatricians, the watch-list hospitalist default
   ($212 vs cited $155–200 cluster) outranks the pediatrics fix in dollar exposure. The
   LocumSmart/Sisense data (memory: 138-placements rate registry, unwired) could rank this.
4. **Are Barton's OB/GYN-subspecialty points trustworthy?** Their gyn-onc $172/hr sits below its
   own W2 equivalent — likely a methodology artifact. If Barton subspecialty pages are unreliable,
   MFM/gyn-onc/urogyn (engine defaults 277/337/263) remain fully uncorroborated either direction.
5. **Should p70-as-default survive Move #1 maturity?** As posteriors anchor more cells, the static
   p70 matters less; R6 could be scoped to only the never-anchored tail.

---

## Source register (external, retrieved 2026-07-03)

- LocumStory (CHG) 2025 pay trends: locumstory.com/spotlight/locum-tenens-compensation-trends
- PhysicianSideGigs compensation database: physiciansidegigs.com/average-hourly-locums-rates-by-specialty
- Barton Associates salary guides: bartonassociates.com — /gastroenterologist-salary-guide-2/,
  /endocrinologist-salary-guide/, /dermatologist-salary-guide/, /pediatrician-salary-guide-2/,
  /ob-gyn-physician-salary-guide/, /urologist-salary-guide/, /neonatologist-salary-guide/,
  /pathologist-salary-guide/
- AnesthesiaOnCall: anesthesiaoncall.com/locum-tenens-crna-salary-guide-2025/ and
  /locum-tenens-anesthesiologist-salary-guide-2025/
- AMN Healthcare locum job pages (advertised aggregates): amnhealthcare.com/careers/physician/apply/
  — gastroenterology, endocrinology, pathology, anatomic-pathology, interventional-cardiology
- AllStar Healthcare Solutions 2026 guide (annual FTE ÷ 2,000 hrs for implied hourlies):
  allstarhealthcaresolutions.com/blog/locum-tenens-salary-by-specialty/
- Marit Health averages: marithealth.com/o/locums/... (physician $290/hr; interventional
  cardiologist $346/hr) — via search snippets, direct fetch 403
- TheLocumGuy hospitalist economics: thelocumguy.com/locum-tenens-hospitalist-salary/
- Sermo 2026 + ZipRecruiter pages — POISONED tier, cited only as contamination evidence
