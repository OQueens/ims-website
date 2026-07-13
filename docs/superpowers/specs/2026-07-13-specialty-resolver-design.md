# Specialty Resolver Redesign — token-consumption matching with escalation (v2)

**Date:** 2026-07-13 · **Status:** DESIGN v2 — red-team hardened (37-verifier adversarial
workflow, 20+ upheld findings folded in), awaiting Zach review before implementation.
**Replaces:** `mapSpecialty` (rateCalculator.ts:77-95) + `fuzzyMatchSpecialty` (fuzzyMatch.ts:70-86)
**Fixes:** C1/C4/C5/C16/Sol-N2 (misroutes), C13 (ob-gyn null), + the refine-hijack hole found in red-team
**Non-goals:** bridge-side 152→88 key mapping (PLAN3 — this module is designed to be its engine);
liveCalibration's `looseMatch` clone (third site, same disease — follow-up).

## 1. The disease (unchanged from v1)

Both live matchers match **without consumption accounting** — the ignored tokens are exactly
the ones that change the price cell:

| Input | Today | Right answer |
|---|---|---|
| `Radiation Oncology` | medical oncology ($350–500) | **escalate** (not in taxonomy) |
| `Endovascular Surgery` | endocrinology (`endo` ⊂ "**endo**vascular") | **escalate** |
| `Pediatric ICU` | critical care (adult) | pediatric critical care |
| `Pediatric Anesthesiologist` | anesthesiology (general) | pediatric anesthesiology |
| `Gynecological Oncology` | medical oncology | gynecologic oncology |
| `Reproductive Endocrinology & Infertility` | endocrinology (adult) | reproductive endocrinology |
| `OB-GYN` | **null** (C13) | ob/gyn |

All wrong routes return `source:'inferred'` → Medium/High confidence on the wrong cell. The
safe hatch exists (`source:'default'` → manual-escalation UI). **The win condition (§6 tests
enforce it): misroutes → escalation; routine quotes stay quotes.** Over-escalation of normal
inputs is the failure mode v1 had and v2 kills.

## 2. v2 algorithm

### Normalization (both sides — candidates and input)
- lowercase; `&`→space; split on `[^a-z0-9]+` (so `/`, `-`, `(` are boundaries).
- **Fold table** (applied per token, both sides; consistency > linguistics):
  suffix rules `-ologist/-ological/-ologic→-ology`, `-iatrist/-iatric(s)→-iatry`,
  `-paed-→-ped-` (orthopaedic), `surgeons?→surgery`, plural-family unifications
  (pediatric/pediatrics/peds→PED, orthopedic/orthopedics/ortho→ORTHO,
  obstetric/obstetrics/ob→OB, gynecologic/gynecological/gynecology/gyn→GYN), synonyms
  (children/childrens/kids→PED). Closed-list gaps are a known residual — §6's alias/key
  identity suite + the red-team corpus pin every folding the tables need.
- Drop NOISE tokens: locum(s), tenens, physician, provider, md, do, board, certified, bc, be,
  needed, coverage, position, job, opportunity, dept, department, s (possessive fragment).

### Candidate index
- Every SPECIALTIES key → profile (target = itself).
- Every SPECIALTY_ALIASES entry → profile (target = its key). Aliases are matched as
  candidates but **never inject their target key's tokens into the input** (v1's rewrite-
  injection broke the NP/PA family — red-team F-design-breaking).
- **New aliases required for parity** (golden-master-pinned prefix shorthands the token model
  can't derive): `anes`, `anesth` → anesthesiology; `cardio` → cardiology; `gastro` →
  gastroenterology. Plus `pulmonary critical care medicine` → critical care ('medicine' glue).

### Field resolve (mapSpecialty path — the whole string is the specialty phrase)
1. **Provider-class pass first**: if tokens contain a provider-role token (np, pa, crna, caa,
   'nurse practitioner', 'physician assistant' profiles), resolve within that family —
   np/pa + specialty token (psychiatry→np/pa (psychiatry), emergency→np/pa (emergency), …,
   none/primary/care→np/pa (primary care)); crna/caa → their cells (crna + cardiac →
   cardiac anesthesiology per existing alias). This is a two-axis family; generic maximality
   demonstrably misroutes it (red-team: "Psychiatric Nurse Practitioner", "primary care NP").
2. **KEY pass**: candidates whose full profile ⊆ input tokens; keep maximal by profile size.
3. **ALIAS pass**: same subset rule over alias profiles; on a match, attempt **UPGRADE**: a key
   whose profile ⊆ (aliasTarget profile ∪ leftover input tokens) wins (this is what routes
   `pediatric icu`: alias icu→critical care, upgrade finds 'pediatric critical care'). No
   further recursion (aliases point only at keys).
4. **Tie-break (deterministic, in order)**: (a) strict-superset profile wins; (b) candidate
   covering more non-TRANSPARENT tokens wins (TRANSPARENT_QUALIFIERS = {general, clinical} —
   demoted genericizers, so "Pediatric General Surgery" → pediatric surgery, "General Surgery -
   Trauma" → trauma surgery); (c) key beats alias; (d) still tied across different keys →
   ESCALATE.
5. **Leftover accounting** (leftover = input − consumed − NOISE). A leftover token BLOCKS
   (→ ESCALATE) iff:
   - it ∈ **EXTRA_MODIFIERS** (curated, first-class data table — not a footnote: radiation,
     endovascular, transplant, robotic, invasive, noninvasive, bariatric, oncologic?…) — the
     out-of-taxonomy clinical modifiers; **or**
   - it belongs to some candidate profile whose FULL profile is ⊆ input tokens but whose
     target ≠ matched key (a compatible alternative actually present — real ambiguity); **or**
   - (typo guard) it is Levenshtein-1 from an EXTRA_MODIFIERS/taxonomy token of ≥6 chars —
     used for BLOCKING only, never to fabricate a match ("Pedatric ICU" escalates, never
     quotes adult critical care).
   Otherwise leftover tokens (unknown decorations: infertility, dallas, women, health,
   virtual…) **downgrade to `inferred`**, never block — this is the v1→v2 change that stops
   mass over-escalation ('general cardiology', "Women's Health - OB/GYN", 'cardiac cath lab',
   'interventional pain' all quote normally).
6. Nothing matched → ESCALATE (`{key:'internal medicine', source:'default'}`, byte-compatible
   with today's default).

### Freetext path (parser.ts window scan)
- Windows match by **exact token-set equality** (after fold; alias targets may substitute via
  the same UPGRADE rule) — NOT subset. A 3-token window "crna dallas tx" must not match 'crna'
  and swallow the location tokens (red-team: flips 4/5 golden parse cases; state/city
  extraction depends on precise consumption).
- **Whole-field modifier guard replaces v1's left-peek**: after a window match, compute
  leftover over the ENTIRE remaining freetext token list; any EXTRA_MODIFIERS /
  compatible-alternative / Levenshtein-1-modifier token blocks → window match DISCARDED.
  Catches "oncology - radiation therapy" (right-side modifier — v1's flagship regression),
  and "children's hospital needs icu coverage" (children→PED fold blocks the adult-ICU cell,
  upgrade path resolves pediatric critical care where intended).
- No specialty survives → `parsed.specialty = null` → existing null/manual-escalation flow.

### Escalation must survive refinement (NEW — live-today bug, red-team design-breaking)
`initFactors` runs `refineSpecialtyFromContext` AFTER mapSpecialty; refine keys on
`internal medicine` — which is also the escalation sentinel — so an escalated
"Radiation Oncology" posting whose text mentions ICU flips to a confident critical-care
quote, escaping the hatch. **Fix: skip refine when `specialty.source === 'default'`.**
One line + test; ships with the resolver (it also hardens today's engine).

## 3. Signature/parity contract
- `SpecialtyFactor`/`FuzzySpecialtyMatch` shapes, `source`/`matchKind` literals unchanged
  ('exact' = canonical full match; 'substring' retained as the "non-exact" literal so
  parser `corrections` behavior is stable).
- Table-driven identity suite: every alias resolves to its target; every key to itself.
- Golden master: expected flips are ENUMERATED and each needs Zach sign-off, notably
  `fuzzyMatchSpecialty('np/pa') → np/pa (surgery)` (today's shortest-key artifact) →
  `np/pa (primary care)`. Wrong→right flips are the point; right→broken = design defect.
- Escalation rate guard: the LocumSmart corpus (goldenMaster parse cases + parser tests) must
  show ZERO new escalations outside the enumerated wrong→right set.

## 4. Data tables the implementation ships (all first-class, unit-tested)
FOLD rules + irregular map · NOISE · TRANSPARENT_QUALIFIERS · EXTRA_MODIFIERS ·
provider-class table · parity aliases (anes/anesth/cardio/gastro/pulm-cc-medicine).

## 5. Red-team corpus (locked as the RED test table)
The 37-verifier workflow (run `wf_2b3b49e4-745`, full findings in the session transcript)
contributed ~40 concrete cases now pinned as tests, including: Radiation Oncology (+ reversed
"Oncology - Radiation" freetext) · Endovascular Surgery · Pediatric ICU / Pedatric ICU (typo)
/ Pediatrics ICU · Pediatric Anesthesiologist · Gynecological Oncology · REI · Urogynecologist
· OB-GYN · Women's Health - OB/GYN · Virtual Neurology · Nurse - CRNA · Pulmonary Disease and
Critical Care Medicine · Pulmonary Critical Care Medicine · General Cardiology · Invasive /
Non-invasive Cardiology · Cardiac Cath Lab · Medical/Surgical ICU · Interventional Pain ·
Pediatric General Surgery · General Surgery - Trauma · Peds EM · NP - Psychiatry · Psychiatric
Nurse Practitioner · Primary Care NP · CRNA in Dallas TX (freetext consumption) · children's
hospital ICU (freetext synonym) · anes / anesth / cardio / gastro · orthopaedic surgery ·
Cardiothoracic Surgery · Obstetric Anesthesia.

## 6. Open questions for Zach (unchanged + new)
- Escalation copy: name the unrecognized phrase in the manual-escalation UI?
- Missing cells that keep appearing in real postings: radiation oncology, endovascular
  variants, transplant surgery — add curated bands (sourced) or keep escalating?
- Sign off the enumerated golden-master flips (esp. np/pa → primary care).
