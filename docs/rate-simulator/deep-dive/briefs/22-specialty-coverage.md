# Brief 22 — Full-Specialty Coverage: the locum universe vs the engine's cell taxonomy

> Deep-dive research brief, 2026-07-03. Pillar: **"every single specialty in the locums world."**
> Scope: the LIVE rate simulator (imstaffing.ai/hub, served by `ias-website`) — engine
> `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/` —
> plus the still-live pipeline (scraper `C:/Users/oclou/QueenClaude/agent-sdk/`, bridge
> `C:/Users/oclou/QueenClaude/ias-dashboard/scripts/data-refresh/`).
> Builds on maps 01/03/05/06 (`docs/rate-simulator/deep-dive/maps/`) and the 2026-05-05 empirical
> audit `C:/Users/oclou/QueenClaude/ias-dashboard/docs/rate-simulator/audit-2026-05-05/SPECIALTY_UNIVERSE.md`.
> **No rates are proposed in this brief.** Coverage gaps, mislabel mechanics, demand signals, and
> seeding sources only. Every number is OBSERVED (file:line or named external source) or flagged.

---

## Summary

The engine quotes from an **88-cell curated table** (`src/lib/rate-engine/specialties.ts:56-166`).
The recognized locum-tenens physician universe is **~140–160 specialty cells** — this is where the
ABMS taxonomy (38 specialties + 89 subspecialties per the 2024–2025 ABMS Board Certification
Report), the LocumTenens.com job tree (155 named physician specialties, fetched verbatim
2026-07-03), Barton Associates (12 specialties / 149 subspecialties), CompHealth ("more than 100
specialties"), and IAS's own 2,831-booking LocumSmart history (SPECIALTY_UNIVERSE.md §3) all
converge. So the engine is missing roughly **a third to half of the universe by cell count** —
including cells IAS *demonstrably books* (radiation oncology: 41 bookings/32mo; PA –
cardiovascular/CT surgery: 68; certified nurse midwife: 16 — all OBSERVED in SPECIALTY_UNIVERSE.md
§3.2–3.3 and all absent from `specialties.ts`).

Three distinct defect classes, in priority order:

1. **The taxonomy chasm (highest-leverage defect, already half-known).** The write-side canonical
   vocabulary is 152 cells (`agent-sdk/shared/specialty_canonical_list.json`, metadata
   `cell_count_total: 152`), but the bridge's allowlist is the engine's 88 keys
   (`bridge-rate-intelligence.ts:1477`), and only **19 names exist in both** (independently
   re-verified for this brief; list in Finding F2). Every fresh scraped observation for the other
   133 producer cells — including CRNA, cardiology, OB/GYN, general surgery, ortho — is dropped as
   `unknownSpecialties` (`aggregateBridge.ts:833-840`) before it can ever corroborate a quote.
   Live-signal coverage is structurally capped at ~19/88 quote cells no matter how well the fleet
   scrapes. As of the 2026-06-30 deploy observation, **0 cells are live-anchored** (map 03 §5.3).

2. **Missing cells fail DANGEROUSLY, not honestly.** `mapSpecialty()`
   (`rateCalculator.ts:77-94`) resolves unknown specialties by alias/substring scan and then
   **defaults to `internal medicine`**. Worked examples (mechanics verified against the code, this
   session): "radiation oncology" → alias `'oncology'` → quoted off the **medical oncology** band;
   "cardiothoracic surgery" → substring → **thoracic surgery** band; "child neurology" → alias
   `'neuro'` → adult **neurology** band; "certified nurse midwife", "spine surgery", and
   "addiction medicine" → hard default → **internal medicine** band ($130–200/hr curated,
   `specialties.ts:76`). A recruiter pricing a real placement gets a *plausible-looking wrong
   number*, and because the substring/alias hits carry `source: 'inferred'` (not `'default'`),
   identification confidence can still read Medium/High (`scoreConfidence`,
   `rateCalculator.ts:621-640`). Against the north star this is worse than a gap — it is a silent
   mispricing machine for exactly the cells we don't cover.

3. **Band quality inside the 88 is thin and call coverage is thinner.** Zero static cells are
   'high' confidence (18 medium / 5 low / 65 modeled — counted from `specialties.ts:56-166` after
   the 2026-06-30 honesty downgrade); call-only daily bands exist for only **19 of 88** cells (38
   `CALL_RATE_DATA` entries, 19 with a quotable weekday band — grep-verified `callRates.ts`);
   every holiday band is null.

The fix order matters: **build the 152→88 mapping layer first** (it upgrades band quality for
cells that already exist and IAS already books), **make unknown-specialty failure honest second**
(cheap, kills the silent mispricing), and only then **add new cells** in demand order, each seeded
cite-or-suppress from a named source.

---

## Findings

### F1 — The engine's quote taxonomy: 88 cells, all-curated, no static 'high'

- 88 keys in `_SPECIALTIES_RAW` (`specialties.ts:56-166`), organized in 11 categories:
  Anesthesia 7, Emergency 5, Hospital Medicine 5, Surgery 11, Medical Specialties 18, OB/GYN 5,
  Psychiatry 7, Radiology 3, Pediatrics 7, Other 13, NP/PA 7. (OBSERVED, counted.)
- Confidence distribution (OBSERVED, counted from the file): **18 `medium`** (anesthesiology, crna,
  emergency medicine, urgent care, hospitalist, internal medicine, family medicine, critical care,
  orthopedic surgery, cardiology, neurology, gastroenterology, medical oncology, ob/gyn,
  psychiatry, radiology, pediatrics, urology), **5 `low`** (general surgery, nephrology,
  rheumatology, neonatology, dermatology), **65 default `modeled`**, **0 `high`** (static 'High'
  retired 2026-06-30; only live-corroborated posteriors may earn it —
  `marketRates.ts:448-456`).
- All bands are ESTIMATED analyst curation from self-published industry sources (file header,
  `specialties.ts:3-5`: LocumStory 2025/CHG, OnCall Solutions 2024, TheLocumGuy, ResidencyAdvisor
  2025, FastRVU 2026), explicitly "not observed paid rates" (`specialties.ts:20-36`).
- ~140 aliases (`specialties.ts:243-381`) serve free-text parsing.

### F2 — The taxonomy chasm: 152 producer cells, 88 engine cells, 19-name intersection

- Producer canonical list: 152 cells in 5 tiers (T1 15, T2 16, T3 16, T4 47, APP 58) + 178
  aliases (`agent-sdk/shared/specialty_canonical_list.json`, metadata block). Enforced at INSERT
  by `normalize_specialty_canonical()` (`agent-sdk/shared/specialty_canonical.py:75-119`) —
  non-canonical rows are rejected, never inserted raw.
- Bridge allowlist = engine keys: `knownSpecialties = new Set(Object.keys(SPECIALTIES))`
  (`ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:1477`, reading the
  *dashboard's* copy of specialties.ts); non-members are dropped to `unknownSpecialties`
  (`lib/aggregateBridge.ts:833-840`) — surfaced in telemetry, excluded from RTDB.
- **Intersection = 19 names** (independently re-verified this session by set-comparing the two
  files; matches map 06 §3.4): `anesthesiologist assistant, anesthesiology, dermatology,
  emergency medicine, family medicine, hospitalist, internal medicine, interventional cardiology,
  maternal-fetal medicine, medical genetics, neurology, ophthalmology, otolaryngology, pediatric
  hospitalist, pediatrics, plastic surgery, psychiatry, radiology, urology`.
- The chasm cuts **both ways**:
  - **133 producer cells can never reach RTDB** — including IAS Tier-1 volume cells: `nurse
    anesthetist` (the producer REWRITES `crna → nurse anesthetist` at INSERT via the alias map,
    so a fresh CRNA scrape can never reach the engine's `crna` node), `internal medicine -
    cardiology` (≠ engine `cardiology`), `obstetrics and gynecology` (≠ `ob/gyn`), `surgery -
    general` (≠ `general surgery`), `orthopaedic surgery` (≠ `orthopedic surgery`, spelling),
    `internal medicine - gastroenterology`, `internal medicine - hematology and oncology`,
    `physician assistant - cardiovascular/cardiothoracic surgery`, all 58 APP cells, `radiation
    oncology`, `general dentistry`.
  - **69 of 88 engine cells can never receive live data** even in principle, because the producer
    vocabulary contains no name that maps to them — e.g. `crna`, `cardiology`, `ob/gyn`,
    `general surgery`, `critical care`, `pain management` (producer: `pain medicine`),
    `urgent care` (producer: `emergency medicine - urgent care`), every psychiatry subspecialty
    cell, every `np/pa (...)` bucket, `em nocturnist` / `hospitalist nocturnist` (producer has
    only unified `nocturnist`), `electrophysiology` (producer: `internal medicine - clinical
    cardiac electrophysiology`), `neurointerventional` (producer: `neurological surgery -
    endovascular surgical neuroradiology`).
- No mapping table exists in any of the three repos (map 06 §3.4). This is the single highest
  coverage defect: it caps live corroboration below 22% of quote cells *forever* until fixed.

### F3 — The locum specialty universe: ~140–160 physician cells (cited)

- **ABMS**: 24 member boards certify in **38 specialties and 89 subspecialties** per the
  2024–2025 ABMS Board Certification Report (abms.org; announced Dec 2025 — note the earlier
  internal audit cited "40 specialties," so the ABMS count itself has drifted; treat 38/89 as
  current). ABMS is the credentialing skeleton, not the staffing tree — locum taxonomies split
  work-pattern cells ABMS doesn't (nocturnist, urgent care, OB laborist, teleradiology).
- **LocumTenens.com**: advertises "over 150 specialties"; its physician specialty-by-state tree
  enumerates **155 named specialties** (fetched verbatim 2026-07-03 from
  locumtenens.com/physician-jobs-specialty-and-state/) — including cells the engine lacks:
  Radiation Oncology, Addiction Medicine, Child Neurology, Vascular Neurology, Spine Surgery,
  Orthopedic Trauma Surgery, Foot and Ankle Orthopedics, Transplant Surgery, Surgical Critical
  Care, Oral & Maxillofacial Surgery, Musculoskeletal/Abdominal/Cardiothoracic/Pediatric
  Radiology, Neonatal Medicine vs Pediatric subspecialty fan-out (~20 peds cells), IM-Pediatrics
  (med-peds), Adolescent Medicine, Hepatology, five Sports-Medicine variants, and a full pathology
  subspecialty tree.
- **Barton Associates**: "12 high-demand specialties and 149 subspecialties" for physicians, NPs,
  PAs, CRNAs, dentists (bartonassociates.com).
- **CompHealth (CHG)**: "more than 100 specialties" (comphealth.com).
- **IAS empirical universe**: 2,831 enriched LocumSmart bookings over 32 months → ~140 distinct
  specialty cells with ≥3 bookings; ~190 distinct enriched specialty strings
  (SPECIALTY_UNIVERSE.md §0, runtime-verified snapshot 2026-05-05). The audit's cross-reference
  section locked the position: "universe target ~140–160 specialty cells" (§0, §3).
- Provider-type axes beyond physician (IAS empirical, §2): Advanced Practice 21.4% of bookings,
  Dentistry 0.85%, Allied 0.5%, Nursing 0.07%, Optometry 0.04%.

### F4 — Missing-entirely cells with OBSERVED demand (the priority list)

All booking counts are OBSERVED from IAS's own LocumSmart history (SPECIALTY_UNIVERSE.md §3,
32-month window, runtime-verified 2026-05-05):

| Missing cell | IAS bookings (32mo) | Producer-canonical? | Notes |
|---|---:|---|---|
| PA – cardiovascular/cardiothoracic surgery | 68 | yes (T1) | Would be an IAS **Tier-1** cell; today folds to `np/pa (surgery)` 85–120 curated band (`specialties.ts:162`) — whether CV-surgery PAs command a premium over that band is UNVERIFIED — needs a source |
| NP – cardiovascular surgery | 42 | yes (APP) | Same fold |
| Radiation oncology | 41 | yes (T2) | **Biggest physician miss.** In producer taxonomy, so scraped rows already flow to Supabase — then die at the bridge allowlist |
| Surgery – cardiovascular (CT surgery) | 33 (+28 as "Thoracic Surgery - Cardio Thoracic") | yes (T2 ×2) | Freetext folds into `thoracic surgery` via substring (see F5) |
| NP – cardiology | 29 | yes (APP) | |
| PA – cardiology | 26 | yes (APP) | |
| General dentistry | 21 | yes (manual-escalation list) | Different rate economics; audit recommends manual-escalation, not a band |
| NP – hematology oncology | 20 | yes (APP) | |
| Certified nurse midwife | 16 | yes (APP) | Freetext CNM currently defaults to **internal medicine** (F5) — a physician band for a midwife quote |
| Pain medicine (as producer names it) | 18 | yes (T3) | Engine HAS `pain management`; pure naming mismatch — a mapping-layer fix, not a new cell |
| Ortho trauma / hand fan-out | 10 each | yes (T3) | Engine has `hand surgery` but not `orthopedic trauma`; spine absent everywhere |
| Radiology – breast only | 10 | yes (T3) | Folds to generic `radiology` |
| OB/GYN laborist (OB hospitalist) | 3 + fan-out | yes (T4) | Freetext "ob hospitalist" folds to generic `hospitalist` via substring (F5) |
| Child neurology | 4 | yes (T4) | Folds to adult `neurology` |
| Neurohospitalist | n/a (T4 producer) | yes (T4) | No engine cell; freetext lands on `neurology` or IM default |
| Addiction medicine | n/a | no | Distinct ABPM subspecialty ≠ addiction psychiatry; LocumTenens.com staffs it; freetext defaults to internal medicine |
| Surgical critical care / burn / OMFS / transplant surgery / undersea-hyperbaric | ≤ a few each | yes (T4) | Long-tail; manual-escalation candidates |
| Peds subspecialty fan-out (endo, GI, nephrology, pulmonology) | 1–9 each | yes (T4) | Engine has 7 peds cells vs empirical 14+ (audit §3.5) |
| Audiologist / pathology assistant / optometry / allied | ≤ 14 total | partial | Manual-escalation per audit §2 |

### F5 — Missing cells fail silently into wrong bands (mechanics, verified)

`mapSpecialty` (`rateCalculator.ts:77-94`): exact key → exact alias → word-boundary short-alias →
**substring scan over aliases then keys (longest-first)** → **hard default `internal medicine`
with `source:'default'`**. Traced consequences for cells outside the 88:

| Recruiter input | Resolution path | Band actually quoted | Why it's wrong |
|---|---|---|---|
| "radiation oncology" | substring hit on alias `'oncology'` (`specialties.ts:288`) | `medical oncology` 350–500 (`specialties.ts:105`) | Different specialty, different market; plausible-looking number |
| "cardiothoracic surgery" | substring hit on key `'thoracic surgery'` | `thoracic surgery` 280–400 (`specialties.ts:84`) | CT surgery is its own cell in both the producer taxonomy and IAS bookings |
| "child neurology" | substring hit on alias `'neuro'` (`specialties.ts:268`) | adult `neurology` 180–275 (`specialties.ts:97`) | Peds subspecialty priced as adult parent |
| "ob hospitalist" / "laborist" | substring hit on key `'hospitalist'` | `hospitalist` 145–240 (`specialties.ts:74`) | OB hospitalist is an OB cell, not an IM cell |
| "certified nurse midwife" | no hit → default | `internal medicine` 130–200 (`specialties.ts:76`) | A physician band for an APP quote |
| "spine surgery" | no hit → default | `internal medicine` 130–200 | Massive underquote class (spine is a surgical subspecialty) |
| "addiction medicine" | no hit → default | `internal medicine` 130–200 | Distinct growing locum cell (LocumTenens.com lists it) |

Only the hard default is visible to confidence scoring (`scoreConfidence`,
`rateCalculator.ts:621-640` scores `source==='default'` as Low); the substring/alias mis-folds
carry `source:'inferred'` and can display Medium — or High when a state parses. There is no
"unknown specialty — manual escalation" surface anywhere in the live hub; the 2026-05-05 audit
mandated one (SPECIALTY_UNIVERSE.md §0: "cells unreachable surface explicit 'manual escalation
required' UI rather than fake-confident quotes") and it was never built into the hub port.

### F6 — Band quality within the covered 88

- **Hourly**: 100% curated-static today. The Move #1 trust ladder can promote a cell to a
  live-anchored band (`marketRates.ts:469-551`) but the observed effect at deploy was **0
  promotions** and 6 cells reverting legacy→curated (map 03 §5.3, 2026-06-30). Combined with F2,
  at most 19 cells can ever promote under the current seam.
- **Call-only daily**: 38 entries in `CALL_RATE_DATA`, **19 with a quotable weekday band**
  (grep-verified `callRates.ts`; `weekday: worked(...)|beeper(...)` = 19 hits), 3 more carry
  context-only adjacent-hourly (crna, psychiatry, neonatology per map 01 §6), 50 of 88 fall to
  the all-null `getCallRateEntry` fallback (`callRates.ts:361-376`) → honest `insufficientData`.
  Every `holiday` band in the table is null. IAS's book is 26% call-only + 31% mixed coverage
  (SPECIALTY_UNIVERSE.md §7) — so the call surface is the thinnest exactly where IAS's volume is.
- **State grain**: every live bucket is `national` today (bridge comment,
  `bridge-rate-intelligence.ts:966-972`); geo pricing rides on the derived `STATE_MULT`
  (`stateData.ts:149-173`), not observed state cells. Coverage expansion should not promise
  state-level bands it can't fill.

### F7 — Demand signals (external, cited; no $ figures)

- **AAPPR 2024 data via AMA**: among organizations' physician searches, locums were used to fill
  **anesthesia 65.4%, pediatrics 47.5%, urgent care 41.5%, hospital medicine 30.1%, emergency
  medicine 24.4%** of searches — the top-5 locum-usage specialties (ama-assn.org, "Which
  specialties are more likely to have locum tenens physicians?").
- **AMN Healthcare, "Best Locum Tenens Specialties in 2026"** (amnhealthcare.com): psychiatry ≈
  **11% of all locum usage**; radiology ≈ **9% of locum usage**; anesthesiology facing a **"55%
  expected increase in demand"**; hospital medicine "third most requested"; family medicine,
  internal medicine, OB/GYN round out the list.
- **CompHealth "Top 12 in-demand locum specialties for 2025"** (comphealth.com/resources/):
  surgical specialties (general/trauma/ortho/CV/neuro/urology), EM, anesthesiology, OB/GYN,
  family practice, GI, radiology, IM, hospitalist, psychiatry, cardiology, medical oncology.
- **SIA**: US locum tenens market ≈ **$9.6B revenue in 2025**, projected $9.1B (2024) → $9.9B
  (2026) (staffingindustry.com).
- **IAS's own top-15 by volume** (OBSERVED, SPECIALTY_UNIVERSE.md §3.1): OB/GYN 281, CRNA 157,
  GI 144, general surgery 107, urology 105, heme/onc 100, EM 93, anesthesiology 92, cardiology
  83, pediatrics 69, **PA-CV surgery 68 (not in engine)**, family medicine 62, hospitalist 59,
  interventional cardiology 51, orthopaedic surgery 50.
- Alignment check: IAS's Tier-1 list and the industry lists agree almost cell-for-cell — and
  **of IAS's top-15, only `anesthesiology`, `emergency medicine`, `family medicine`,
  `hospitalist`, `internal medicine`(via T2), `interventional cardiology`, `pediatrics`, and
  `urology` survive the bridge seam today** (8 of 15; the other 7 are name-mismatched or missing).

### F8 — The APP lane is structurally underpowered

Engine: 7 coarse `np/pa (...)` buckets + `crna` + `anesthesiologist assistant`
(`specialties.ts:159-165, 59-60`). Producer: **58 APP cells** (APP_fan_out tier). IAS empirical:
**21.4% of all bookings are Advanced Practice** (SPECIALTY_UNIVERSE.md §2), with 30+ APP
sub-specialty variants including four cells at ≥26 bookings (F4). None of the 58 producer APP
names maps to an engine key except `anesthesiologist assistant`, so **zero live APP signal can
ever corroborate the 7 buckets**. CRNA — IAS's #2 specialty by volume (157 bookings) — is
name-severed from its own live data by the `crna → nurse anesthetist` producer rewrite (F2).

### F9 — Cells the engine has that the universe/producer lacks (over-coverage & naming debt)

Engine-only cells with no producer counterpart and thin external existence as *locum staffing*
cells: `rural emergency medicine`, `wound care`, `urogynecology`, `reproductive endocrinology`,
`sleep medicine` (producer folds into `pulmonology sleep medicine`), `telepsychiatry` /
`correctional psychiatry` / `forensic psychiatry` / `geriatric psychiatry` / `addiction
psychiatry` (producer collapses all to `psychiatry`), `obstetric anesthesiology`, `hematology`
(standalone), `nuclear medicine`, `preventive medicine`, `occupational medicine`, `sports
medicine` (LocumTenens.com splits it 5 ways by parent board). These aren't wrong to have — several
encode real rate-relevant work patterns (telepsych, correctional) — but each is a cell that (a)
can never get live corroboration under the current producer vocabulary and (b) widens the
alias/mapping surface that must be maintained. Any mapping layer must decide: collapse these into
producer parents for aggregation while keeping quote-side granularity, or add producer names.

### F10 — What the 2026-05-05 audit already decided (don't re-litigate)

- Universe locked at ~140–160 cells; quote-grain dense cells (n≥10 recent-24mo) = **32**; don't
  chase 100% grid coverage (SPECIALTY_UNIVERSE.md §0, §14).
- Subspecialty split rule: split when fellowship-credentialing/liability/recruiter-pod differ;
  **collapse anti-test** — fold into parent when recent-24 n<10 AND <2 external sources AND
  subcell median within ±10% of parent (§3.5). This is the right gate for the F4/F5 splits.
- Dentistry/optometry/nursing/allied → manual-escalation, not bands (§2). The producer JSON
  already encodes this (`manual_escalation_default` list).
- Caveat: the audit snapshot is now ~2 months stale and predates the Move #1 architecture; its
  RTDB-derived counts should be refreshed before Phase-1 cell additions are finalized.

---

## The gap table

Legend — **Band quality**: `curated-med/low/modeled` = static analyst band + tag; `call:yes/no` =
quotable call-only daily band exists; `live:reachable/severed` = can the cell receive bridge
signal under today's 19-name intersection. **Demand**: IAS = 32-month LocumSmart bookings
(OBSERVED); industry citations per F7. **Priority**: P0 = seam fix unlocks it, P1 = add/split next,
P2 = after P1, P3 = manual-escalation surface only.

| Specialty (universe name) | In engine? | Band quality today | Locum demand signal | Priority | Seed source for the cell |
|---|---|---|---|---|---|
| CRNA | yes (`crna`) | curated-med · call:no (adjacentHourly only) · **live:severed** (producer=`nurse anesthetist`) | IAS #2 (157); AAPPR anesthesia 65.4% locum usage | **P0 (mapping)** | Already flowing: gasworks/board rows in `rate_intelligence`; AANA survey envelope in `external_specialty_surveys` (context) |
| Cardiology (general) | yes | curated-med · **live:severed** (`internal medicine - cardiology`) | IAS 83; CompHealth top-12 | **P0 (mapping)** | Already flowing; fleet posting sources |
| OB/GYN | yes | curated-med · call:yes · **live:severed** (`obstetrics and gynecology`) | IAS #1 (281); AMN 2026 list | **P0 (mapping)** | Already flowing |
| General surgery | yes | curated-low · call:yes · **live:severed** (`surgery - general`) | IAS 107; CompHealth #1 group | **P0 (mapping)** | Already flowing |
| Orthopedic surgery | yes | curated-med · call:callback-only · **live:severed** (spelling: `orthopaedic`) | IAS 50 + hand 10 + trauma 10 | **P0 (mapping)** | Already flowing |
| Gastroenterology | yes | curated-med · call:yes · **live:severed** | IAS 144; CompHealth top-12 | **P0 (mapping)** | Already flowing |
| Hematology/oncology | yes | curated-modeled · **live:severed** | IAS 100 | **P0 (mapping)** | Already flowing |
| Critical care | yes | curated-med · call:yes · **live:severed** (`internal medicine - critical care medicine`) | IAS T2/T3 combined | **P0 (mapping)** | Already flowing |
| Pain management | yes | curated-modeled · **live:severed** (`pain medicine`) | IAS 18; LocumTenens.com growth flag | **P0 (mapping)** | Already flowing |
| Urgent care | yes | curated-med · **live:severed** (`emergency medicine - urgent care`) | AAPPR 41.5% locum usage | **P0 (mapping)** | Already flowing |
| All 7 `np/pa (...)` buckets | yes | curated-modeled · **live:severed** (58 producer APP cells unmapped) | IAS 21.4% of book | **P0 (mapping, coarse)** | Already flowing (APP fan-out rows) |
| **Radiation oncology** | **no** | none (freetext → medical-oncology band, F5) | IAS 41; in producer T2 | **P1 (new cell)** | Fleet: LocumTenens.com/DocCafe/LocumJobsOnline rad-onc locum postings (source family already cataloged in WS1); BLS OEWS SOC baseline as W2 sanity context only |
| **Cardiothoracic/cardiovascular surgery** | **no** (folds to thoracic) | thoracic band only | IAS 33+28; CompHealth surgical group | **P1 (new cell or deliberate alias)** | Fleet: CT-surgery locum postings (DocCafe, CTSNet job board); producer names already canonical |
| **OB hospitalist / laborist** | **no** (folds to hospitalist) | none | Producer T4; AMN flags OB hospitalist demand | **P1 (new cell)** | Fleet: OB-hospitalist locum postings on agency boards; LocumSmart `coverageType` rows |
| **Child neurology** | **no** (folds to adult neurology) | none | IAS 4; producer T4; LocumTenens.com cell | **P1 (new cell, collapse anti-test)** | Fleet: child-neuro locum postings; ABPN taxonomy for the label |
| **Addiction medicine** | **no** (defaults to IM) | none | LocumTenens.com dedicated cell; opioid-policy tailwind (audit §13) | **P1 (new cell)** | Fleet: LocumTenens.com addiction-medicine postings |
| **Neurohospitalist** | **no** | none | Producer T4 (`internal medicine - neurohospitalist`) | **P2** | Fleet postings; collapse anti-test vs neurology |
| **Spine surgery / ortho trauma** | **no** (spine → IM default!) | none | IAS ortho-trauma 10; LocumTenens.com cells | **P2 (at minimum kill the IM default)** | Fleet ortho-subspec postings; collapse anti-test vs orthopedic surgery |
| **Breast imaging (radiology)** | **no** (folds to radiology) | none | IAS 10 (`radiology - breast only`) | **P2** | Fleet teleradiology/breast postings; collapse anti-test vs radiology |
| **CNM (certified nurse midwife)** | **no** (defaults to IM!) | none | IAS 16; producer APP cell | **P1 (new cell — the IM default is indefensible)** | Fleet: CNM locum postings (Barton staffs CNMs); BLS OEWS 29-1161 as W2 context only |
| **PA/NP – CV surgery, cardiology, heme/onc** (dense APP cells) | **no** (fold to generic buckets) | generic np/pa bands | IAS 68/42/29/26/20 | **P2 (split after P0 gives the buckets live signal)** | LocumSmart internal history (densest source); fleet APP postings |
| Peds subspecialty fan-out (endo/GI/nephro/pulm) | no | none | IAS 1–9 each; Doximity flags peds nephro growth (audit §13) | **P2/P3** | Fleet; collapse anti-test vs `pediatrics` |
| Surgical critical care, burn, transplant, OMFS, hyperbaric | no | none | producer T4, ≤ a few bookings | **P3 (manual-escalation)** | none — explicit escalation surface |
| **General dentistry** | no | none | IAS 21 | **P3 (manual-escalation by design)** | none — different rate economics (audit §2) |
| Optometry / nursing / allied / audiology / path assistant | no | none | IAS ≤14 total | **P3 (manual-escalation)** | none |

---

## Recommendations

**R1 — Build the producer→engine specialty mapping layer at the bridge. [impact: high | effort: medium]**
A single translation table (152 canonical names → 88 engine keys, ~60 real mappings + explicit
`null` for unmappable cells) applied in `aggregateBridge()` before the `knownSpecialties` gate,
plus a cross-repo sync test pinning the map's domain = canonical list and range ⊆ engine keys
(closes map 03 seam S4 at the same time). This is the only change that turns the fleet's existing
output into corroboration for CRNA, cardiology, OB/GYN, general surgery, ortho, GI, heme/onc —
7 of IAS's top-15 cells — without adding a single new scrape. Design note: map *aggregation-side*
(bridge), not producer-side, so the Supabase spine keeps the richer 152-name grain for future
subspecialty splits. Watch the one-way folds (e.g. producer `nocturnist` → engine
`hospitalist nocturnist` vs `em nocturnist` is ambiguous — route ambiguous names to `null` +
telemetry, never guess).

**R2 — Make unknown-specialty failure honest: kill the silent internal-medicine default. [impact: high | effort: low]**
In `mapSpecialty`, distinguish "resolved by risky substring" from "resolved exactly": cap
identification confidence at Low for substring-scan hits on inputs containing specialty-bearing
tokens the scan didn't consume ("radiation", "spine", "midwife", "cardiothoracic", "laborist"),
and route true no-hits to an explicit `unknown specialty — manual escalation` quote surface
(the audit's mandated UI, never built) instead of the IM band. Log every fallback into
`quote_events` so gap priority becomes empirical. This converts F5's silent mispricing into
visible coverage demand data.

**R3 — Add the P1 physician cells, cite-or-suppress: radiation oncology, cardiothoracic surgery, OB hospitalist/laborist, child neurology, addiction medicine, CNM. [impact: high | effort: medium]**
Each gets: an engine key + alias set, a curated band ONLY if a named source can be cited
(otherwise ship the cell with `null` band + manual-escalation surface — the callRates.ts
FACTOR-05 pattern already proves this works), a producer mapping row (they're all already
canonical except addiction medicine, which needs a canonical-list addition + migration per the
additive convention in a2 §1.3), and a `SPECIALTY_TO_SOC` entry so the dormant BLS sanity layer
covers it. Seed sources per the gap table; no number enters `specialties.ts` without a citation
per the existing provenance doctrine (`specialties.ts:20-36`).

**R4 — Refresh the empirical universe and rank Phase-2 splits with the collapse anti-test. [impact: medium | effort: low]**
Re-run `query-empirical-universe.mjs` (audit-2026-05-05) on the recent-24 window; feed the
refreshed per-cell counts + the R2 fallback telemetry into the §3.5 collapse anti-test to decide
the P2 splits (APP fan-out, breast imaging, ortho subspecs, peds subspecs). Do not split any cell
whose subcell rate distribution is not demonstrably separated from its parent — that is fabricated
granularity.

**R5 — Pin the taxonomy with tests so the chasm can't silently re-open. [impact: medium | effort: low]**
(a) A test asserting `SPECIALTIES` keys are identical across ias-dashboard and ias-website
(map 03 S4); (b) a test asserting every canonical-list name either maps to an engine key or is on
an explicit `UNMAPPED_BY_DESIGN` list; (c) alert when `bridge_runs` unknown-specialty count for a
mapped name is > 0. Today nothing fails when a new producer cell lands unmapped — it just silently
never reaches a quote.

**R6 — Extend call-band coverage along the same priority order (separate workstream). [impact: medium | effort: high]**
19/88 quotable call cells against a 26%-call-only + 31%-mixed book is the second coverage axis;
it needs the DAY-unit scraper path un-deferred (`agent.py:491-493`) and is covered by the comp-
factors brief — flagged here only so cell additions in R3 ship with call-band research slots
(even if null) rather than falling to the 50-cell fallback.

**Sequencing:** R2 (days) → R1 (unlocks live signal) → R5 (locks it) → R3 (new cells) → R4 → R6.
Adding cells before R1/R2 would just create more curated-only bands that can neither be
corroborated nor fail honestly.

---

## Open questions

1. **Live telemetry check**: what does `bridge_runs.errors_json`/unknown-specialty telemetry
   actually show for the last 30 days of fleet runs? The 19-name intersection is code-derived;
   the *observed* drop mix (which producer names, what volumes) should rank R1's mapping rows.
   (Map 06 §3.4 flagged the same verification.)
2. **CV-surgery APP premium**: is the `np/pa (surgery)` 85–120 band materially wrong for
   PA – cardiovascular/CT surgery (IAS's 68-booking cell)? UNVERIFIED — needs a source (IAS's own
   LocumSmart bid history is the best candidate once Sisense actual-paid unblocks).
3. **Dentistry**: does Zach want the 21-booking dentistry lane as a quotable vertical (different
   economics: per-diem/per-procedure) or is manual-escalation the permanent answer per the audit?
4. **Producer-side gaps**: `addiction medicine` and `obstetric anesthesiology` are absent from
   the 152-name canonical list itself — additions require the additive sub-migration convention
   (a2 migration §growth convention) and Zach applying it to prod (same operator gate as the
   pending `20260701000000` migration).
5. **ABMS count drift**: internal docs cite "40 specialties + 89 subspecialties"; the 2024–2025
   ABMS report says 38 + 89. Worth re-pinning wherever the audit doc is cited.
6. **Engine-only work-pattern cells** (telepsychiatry, correctional psychiatry, em nocturnist…):
   should these stay quote-side cells that *aggregate* under a producer parent (needs the mapping
   layer to support N:1 with premium preservation), or should the producer taxonomy grow to match?
   Today they are permanently curated-only.

---

## Source list (external)

- ABMS, "Medical Specialties & Subspecialties" + 2024–2025 ABMS Board Certification Report —
  https://www.abms.org/member-boards/specialty-subspecialty-certificates/ ,
  https://www.abms.org/wp-content/uploads/2025/12/2024_25_ABMSCertReport_FNL_20251212.pdf
  (38 specialties, 89 subspecialties; "one in a million" release Dec 2025).
- LocumTenens.com specialty tree — https://www.locumtenens.com/physician-jobs-specialty-and-state/
  (155 named physician specialties, fetched 2026-07-03); "over 150 specialties" claim —
  https://www.locumtenens.com/ .
- Barton Associates clinical services — https://www.bartonassociates.com/clinical-services/
  (12 specialties / 149 subspecialties; physicians, NPs, PAs, CRNAs, dentists).
- CompHealth — https://comphealth.com/ ("more than 100 specialties");
  "Top 12 in-demand specialties for locum tenens for 2025" —
  https://comphealth.com/resources/top-specialties-locum-tenens .
- AMN Healthcare, "Best Locum Tenens Specialties in 2026" —
  https://www.amnhealthcare.com/blog/physician/locums/best-specialties-locum-tenens-2026/
  (psychiatry ≈11% of locum usage; radiology ≈9%; anesthesia 55% expected demand increase).
- AMA (AAPPR data), "Which specialties are more likely to have locum tenens physicians?" —
  https://www.ama-assn.org/medical-residents/transition-resident-attending/which-specialties-are-more-likely-have-locum-tenens
  (anesthesia 65.4%, pediatrics 47.5%, urgent care 41.5%, hospital medicine 30.1%, EM 24.4%).
- Staffing Industry Analysts — https://www.staffingindustry.com/editorial/healthcare-staffing-report/structural-forces-reshape-9.6b-locum-tenens-market
  ($9.6B US locum market 2025; $9.1B 2024 → $9.9B 2026 projection).
- Internal (OBSERVED): `ias-dashboard/docs/rate-simulator/audit-2026-05-05/SPECIALTY_UNIVERSE.md`
  (2,831-booking empirical universe, runtime-verified 2026-05-05);
  `agent-sdk/shared/specialty_canonical_list.json` (152 cells / 178 aliases);
  `ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/specialties.ts` (88 cells);
  `.../callRates.ts` (38 entries / 19 quotable); deep-dive maps 01/03/05/06.
