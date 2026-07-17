// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// ============================================================
// specialtyResolver.ts — token-consumption specialty matching with escalation
// (design: docs/superpowers/specs/2026-07-13-specialty-resolver-design.md, v2 —
// red-team hardened, 37-verifier workflow wf_2b3b49e4-745).
//
// Replaces the consumption-blind matchers (mapSpecialty's substring scan,
// fuzzyMatchSpecialty's one-way includes): both matched while IGNORING the
// tokens that change the price cell ("Radiation Oncology" → medical oncology,
// "endo" ⊂ "endovascular" → endocrinology). The win condition (§1): misroutes
// → escalation; routine quotes stay quotes.
//
// Three entry points, one core:
//   resolveSpecialtyField  — mapSpecialty path (the whole string IS the
//                            specialty phrase; leftovers may downgrade/block)
//   resolveSpecialtyPhrase — fuzzyMatchSpecialty path (full consumption only)
//   resolveFreetextWindow  — parser window scan (exact token-set equality +
//                            whole-field upgrade + whole-field modifier guard)
// ============================================================

import { SPECIALTIES, SPECIALTY_ALIASES } from './specialties'
import type { SpecialtyFactor, FuzzySpecialtyMatch, FuzzyMatchKind } from './types'

/** Own-property table lookup — plain-object tables must never resolve
 *  prototype members ('constructor', '__proto__', …) as table hits. */
function ownEntry<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

// =============================================================================
// §4 data tables — all first-class, all unit-tested via the resolver corpus.
// =============================================================================

/** Tokens that carry no specialty signal. Excluded from candidate profiles and
 *  from leftover accounting — they can never block and never downgrade. */
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  'locum', 'locums', 'tenens', 'physician', 'provider', 'md', 'do', 'board',
  'certified', 'bc', 'be', 'needed', 'coverage', 'position', 'job',
  'opportunity', 'dept', 'department', 's',
  // medical glue: "Pulmonary Disease and Critical Care Medicine" — 'disease'
  // and 'and' ride along with real phrases and must neither block nor
  // downgrade (dropping 'and' also lets the '&' and 'and' spellings of
  // "physical medicine & rehab" land on one profile).
  'disease', 'and',
])

/** Demoted genericizers: never block, never count in the tie-break's
 *  non-transparent coverage ("Pediatric General Surgery" → pediatric surgery,
 *  "General Surgery - Trauma" → trauma surgery). 'medical' earns its slot via
 *  "Medical/Surgical ICU" — it genericizes exactly like 'general'/'clinical'
 *  (its only key use, 'medical oncology'/'medical genetics', still matches on
 *  the full profile). */
const TRANSPARENT_QUALIFIERS: ReadonlySet<string> = new Set(['general', 'clinical', 'medical'])

/** Tokens that name a GENERIC cell axis rather than a clinical identity. Used
 *  twice, same distinction both times: (1) an UPGRADE may drop these from its
 *  base without changing what the base means (np/pa (primary care) → np/pa
 *  (psychiatry) drops 'primary care'); (2) the provider-class pass routes
 *  these to the np/pa primary-care cell rather than a specialty cell. */
const GENERIC_AXIS_TOKENS: ReadonlySet<string> = new Set([
  'primary', 'care', 'family', 'internal', 'medicine', 'general', 'practice',
])

/** Out-of-taxonomy CLINICAL modifiers — a leftover from this list means the
 *  posting is a cell we don't price (radiation oncology, endovascular,
 *  transplant…) and quoting the base cell would be a live misquote → BLOCK
 *  (escalate). Curated; per Zach §6 (2026-07-13) these KEEP escalating rather
 *  than gaining curated bands. */
const EXTRA_MODIFIERS: ReadonlySet<string> = new Set([
  'radiation', 'endovascular', 'transplant', 'robotic', 'bariatric',
  'invasive', 'noninvasive', 'aesthetic', 'cosmetic', 'mohs',
])

/** Golden-master-pinned prefix shorthands the token model cannot derive
 *  (fuzzy-spec pins: anes/anesth/cardio → matchKind 'substring'). Matched as
 *  candidates but ALWAYS reported as non-exact ('substring' / 'inferred'). */
const PARITY_SHORTHANDS: Readonly<Record<string, string>> = {
  anes: 'anesthesiology',
  anesth: 'anesthesiology',
  cardio: 'cardiology',
  gastro: 'gastroenterology',
}

/** Irregular fold map — family unifications + synonyms, applied to BOTH sides
 *  (candidates and input). Consistency > linguistics: what matters is that a
 *  key's tokens and an input's tokens land on the SAME canonical form. */
const FOLD_IRREGULAR: Readonly<Record<string, string>> = {
  // pediatric family (+ children/kids synonyms — "children's hospital").
  // 'pediatric' maps to ITSELF: without the identity entry the -iatric→-iatry
  // suffix rule would fold bare 'pediatric' to 'pediatry' while the family
  // entries below emit 'pediatric' — two canonicals for one family, and the
  // key profiles silently stop matching each other.
  pediatric: 'pediatric', pediatrics: 'pediatric', peds: 'pediatric',
  child: 'pediatric', children: 'pediatric', childrens: 'pediatric', kids: 'pediatric',
  // -ician professions (suffix rules cover -ologist/-iatrist only)
  pediatrician: 'pediatric', obstetrician: 'ob',
  // rehab family — "Physical Medicine & Rehabilitation" must land on the
  // 'physical medicine & rehab' key profile
  rehabilitation: 'rehab',
  // opposing-axis marker (Sol R3): 'adult' next to a specialty phrase
  // suppresses pediatric-family blocking/upgrading — see resolveFreetextWindow
  adults: 'adult',
  // provider-role/credential plurals (Sol R4/R9): below the generic plural
  // fold's 4-char singular floor
  nps: 'np', pas: 'pa', aprns: 'aprn', fnps: 'fnp', nnps: 'nnp',
  // 'doctor'/'md'/'do' are in no key/alias so the vocabulary plural fold
  // misses them, but the mixed-role guard keys on them ("Doctors/CRNA",
  // "MDs/CRNAs" — Sol R12/R13). 'dr'/'drs' deliberately do NOT fold to
  // 'doctor': the honorific beside a NAME must keep quoting ("contact Dr.
  // John Smith"), so they join md/do under the scoped coordination
  // predicate instead (Sol R14/R15).
  doctors: 'doctor', mds: 'md', dos: 'do',
  // orthopedic family
  orthopedics: 'orthopedic', ortho: 'orthopedic',
  // OB/GYN families (keys tokenize to {ob, gyn} via the '/' boundary)
  obstetric: 'ob', obstetrics: 'ob',
  gynecologic: 'gyn', gynecological: 'gyn', gynecology: 'gyn',
  // misc synonyms the corpus pins
  psych: 'psychiatry',
  neonatal: 'neonatology',
  pulmonary: 'pulmonology', // "Pulmonary Disease"/"Pulmonary Medicine" quote today
  surgeon: 'surgery', surgeons: 'surgery',
  // 'cardiac' unifies with the cardiology family so a leftover 'cardiac' next
  // to a cardiology cell reads as REDUNDANT (Cardiac Cath Lab keeps quoting)
  // while 'Pediatric Cardiac Surgery' still shows a real unconsumed axis.
  // NOTE 'surgical' deliberately does NOT fold to 'surgery': med/surg ICU
  // wording must not manufacture a surgery-axis leftover.
  cardiac: 'cardiology',
  // cardiothoracic surgery prices as the thoracic surgery cell (parity with
  // today's substring route; no key contains 'cardiothoracic' so no collision)
  cardiothoracic: 'thoracic',
}

/** Suffix folds, applied when no irregular rule hit. Longest-first. */
const FOLD_SUFFIXES: ReadonlyArray<[string, string]> = [
  ['ologists', 'ology'], ['ologist', 'ology'],
  ['ological', 'ology'], ['ologic', 'ology'],
  ['iatrists', 'iatry'], ['iatrist', 'iatry'],
  ['iatrics', 'iatry'], ['iatric', 'iatry'],
]

/** Raw (unfolded) vocabulary of every key/alias token — powers the plural
 *  fold below WITHOUT a circular dependency on the folded candidate index.
 *  "Hospitalists"/"CRNAs"/"Intensivists" are routine posting plurals that the
 *  substring matcher used to absorb for free. */
const RAW_TOKEN_VOCAB: ReadonlySet<string> = new Set(
  [...Object.keys(SPECIALTIES), ...Object.keys(SPECIALTY_ALIASES)].flatMap((k) =>
    k
      .toLowerCase()
      .replace(/&/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  ),
)

/** Fold one lowercase token to its canonical form. */
export function foldToken(token: string): string {
  let t = token
  if (t.includes('paed')) t = t.replace('paed', 'ped') // orthopaedic/paediatric
  const irregular = ownEntry(FOLD_IRREGULAR, t)
  if (irregular) return irregular
  for (const [suffix, repl] of FOLD_SUFFIXES) {
    if (t.length > suffix.length && t.endsWith(suffix)) {
      const folded = t.slice(0, -suffix.length) + repl
      // Re-check the irregular map so suffix output reaches the family
      // canonical ('gynecologist' → 'gynecology' → 'gyn'). One re-check, no
      // recursion — the irregular map's values are already fixed points.
      return ownEntry(FOLD_IRREGULAR, folded) ?? folded
    }
  }
  // Vocabulary-aware plural: strip a trailing 's' ONLY when the singular is a
  // known key/alias token of ≥4 chars and the plural itself is not
  // ('hospitalists' → 'hospitalist', 'crnas' → 'crna'; 'pediatrics' never
  // reaches here — irregular above). The 4-char floor keeps short-alias
  // homonyms out: 'caps' (patient caps) must never become the child-psych
  // 'cap' alias, 'pas'/'ids' must never become providers/ID (Sol R3).
  if (
    t.endsWith('s') &&
    t.length >= 5 &&
    !RAW_TOKEN_VOCAB.has(t) &&
    RAW_TOKEN_VOCAB.has(t.slice(0, -1))
  ) {
    return t.slice(0, -1)
  }
  return t
}

/** Dotted physician credentials split into single letters under the
 *  non-alphanumeric tokenizer ('M.D.' → m,d) and slip past the md/do
 *  coordination guard — rewrite them to their bare tokens BEFORE splitting.
 *  Shared by the field path and the freetext cleaner (Sol R14). */
export function normalizeDottedCredentials(lower: string): string {
  return lower
    .replace(/(^|[^a-z0-9])m\.\s*d\.?(s?)(?![a-z0-9])/g, '$1md$2')
    .replace(/(^|[^a-z0-9])d\.\s*o\.?(s?)(?![a-z0-9])/g, '$1do$2')
}

/** lowercase → '&' to space → split on non-alphanumerics → fold each token. */
export function tokenizeAndFold(raw: string): string[] {
  return normalizeDottedCredentials(raw.toLowerCase())
    .replace(/&/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map(foldToken)
}

// =============================================================================
// Candidate index — every SPECIALTIES key and SPECIALTY_ALIASES entry becomes a
// token profile. Aliases are matched as candidates but NEVER inject their
// target key's tokens into the input (v1's rewrite-injection broke the NP/PA
// family — red-team design-breaking finding).
// =============================================================================

/** The only alias strings that collide with USPS state codes ('pa' =
 *  physician assistant vs Pennsylvania; 'id' = infectious disease vs Idaho).
 *  These participate in multi-token freetext windows/phrases neither as
 *  matches nor as blockers — a lone-window 'pa' is a provider; a 'pa' next to
 *  'hospitalist' is Pennsylvania. The OTHER two-letter aliases (np, em, er,
 *  gi, ir, aa, fm, im) are NOT state codes and fuse normally ('peds er' →
 *  pediatric emergency medicine, 'hospitalist np' → np/pa (hospitalist)). */
const STATE_AMBIGUOUS_ALIASES: ReadonlySet<string> = new Set(['pa', 'id'])

/** Compound PROVIDER-TITLE aliases whose tokens must be lexically ADJACENT in
 *  freetext to match ("physician assistant" the title vs "physician and
 *  assistant" two roles — filler elision must not fabricate the title; Sol R5). */
const ADJACENCY_REQUIRED_ALIASES: ReadonlySet<string> = new Set([
  'physician assistant',
  'nurse practitioner',
  'nurse anesthetist',
  'anesthesiologist assistant',
])

interface Candidate {
  /** The raw key/alias text this candidate was built from. */
  text: string
  /** Folded token profile that must be ⊆ the input to match. */
  profile: ReadonlySet<string>
  /** The SPECIALTIES key this candidate resolves to. */
  target: string
  kind: 'key' | 'alias' | 'shorthand'
  /** True for STATE_AMBIGUOUS_ALIASES — see that table's contract. */
  shortLone: boolean
}

// Profiles keep EVERY folded token, noise included: stripping 'physician'
// from the 'physician assistant' alias would index it as a bare 'assistant'
// wildcard and route "Medical Assistant" to an np/pa cell (Sol R1 F4). Noise
// is dropped only on the LEFTOVER side, never from what a candidate demands.
function buildProfile(text: string): Set<string> {
  return new Set(tokenizeAndFold(text))
}

function buildCandidates(): Candidate[] {
  const out: Candidate[] = []
  const push = (text: string, target: string, kind: Candidate['kind']) => {
    const profile = buildProfile(text)
    if (profile.size === 0) return
    out.push({ text, profile, target, kind, shortLone: STATE_AMBIGUOUS_ALIASES.has(text) })
  }
  for (const key of Object.keys(SPECIALTIES)) push(key, key, 'key')
  for (const [alias, target] of Object.entries(SPECIALTY_ALIASES)) push(alias, target, 'alias')
  for (const [short, target] of Object.entries(PARITY_SHORTHANDS)) push(short, target, 'shorthand')
  return out
}

const CANDIDATES: ReadonlyArray<Candidate> = buildCandidates()

/** Every non-noise token appearing in any key/alias profile — the Lev-1 typo
 *  guard's vocabulary and the provider-class "known specialty token" test.
 *  NOISE is excluded so a plural/typo of a noise word ('physicians') can
 *  never read as a clinical typo and block a routine posting. */
const TAXONOMY_TOKENS: ReadonlySet<string> = new Set(
  CANDIDATES.filter((c) => c.kind !== 'shorthand')
    .flatMap((c) => [...c.profile])
    .filter((t) => !NOISE_TOKENS.has(t)),
)

const KEY_PROFILES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CANDIDATES.filter((c) => c.kind === 'key').map((c) => [c.target, c.profile]),
)

/** Clinical-axis vocabulary for the FIELD path's leftover rule (Sol R1 F1):
 *  tokens that appear in a KEY profile (i.e. name a cell distinction we price)
 *  minus everything generic. An unconsumed axis token on the field path means
 *  the phrase names a cell we DON'T price ("Neonatal Surgery") → escalate.
 *  'interventional' is exempted by the spec ("interventional pain" quotes
 *  pain management; "Cardiology - Interventional" consumes it anyway). */
const KEY_AXIS_TOKENS: ReadonlySet<string> = new Set(
  [...KEY_PROFILES.values()]
    .flatMap((p) => [...p])
    .filter(
      (t) =>
        !NOISE_TOKENS.has(t) &&
        !TRANSPARENT_QUALIFIERS.has(t) &&
        !GENERIC_AXIS_TOKENS.has(t) &&
        t !== 'interventional',
    ),
)

// =============================================================================
// Provider-class pass (FIELD path only, §2 step 1) — np/pa/crna/caa are a
// two-axis family (provider × specialty); generic maximality demonstrably
// misroutes it ("PA - Emergency Medicine" would tie-break to the EM physician
// cell). Freetext windows deliberately skip this pass: bare 'pa'/'np' tokens
// in freetext are state-ambiguous.
// =============================================================================

const PROVIDER_PROFILES: ReadonlyArray<{ family: 'crna' | 'caa' | 'nppa'; tokens: ReadonlyArray<string> }> = [
  { family: 'crna', tokens: ['crna'] },
  { family: 'crna', tokens: ['nurse', 'anesthetist'] },
  { family: 'caa', tokens: ['caa'] },
  { family: 'caa', tokens: ['aa'] },
  { family: 'nppa', tokens: ['np'] },
  { family: 'nppa', tokens: ['pa'] },
  { family: 'nppa', tokens: ['nurse', 'practitioner'] },
  { family: 'nppa', tokens: ['physician', 'assistant'] },
]

/** NP credential tokens that IMPLY a cell by themselves (Sol R2 F1 — these
 *  fail-open into physician cells otherwise: "Family Medicine - FNP" priced
 *  the physician). The credential is family evidence PLUS a default cell; an
 *  explicit specialty-axis token still wins (NPPA_CELLS runs first). CNM is
 *  deliberately ABSENT — no midwifery cell exists, so CNM escalates. */
const NPPA_CREDENTIAL_CELLS: Readonly<Record<string, string>> = {
  fnp: 'np/pa (primary care)',
  pmhnp: 'np/pa (psychiatry)',
  nnp: 'np/pa (neonatology)',
  acnp: 'np/pa (specialty)',
  agacnp: 'np/pa (specialty)',
  whnp: 'np/pa (specialty)',
  // aprn is a CREDENTIAL, not a family marker: "CRNA, APRN" is one CRNA with
  // a credential listing, never a second provider family (Sol R7).
  aprn: 'np/pa (primary care)',
}

/** Every single token that marks a provider mention — used by the positional
 *  supervision-verb check (Sol R21) to ask "is there a provider on the other
 *  side of the verb?". */
const PROVIDER_MARK_TOKENS: ReadonlySet<string> = new Set([
  ...PROVIDER_PROFILES.flatMap((p) => p.tokens),
  ...Object.keys(NPPA_CREDENTIAL_CELLS),
])

/** np/pa cell routing by specialty-axis token (checked in order). */
const NPPA_CELLS: ReadonlyArray<{ cell: string; tokens: ReadonlySet<string> }> = [
  { cell: 'np/pa (psychiatry)', tokens: new Set(['psychiatry', 'behavioral', 'mental']) },
  { cell: 'np/pa (emergency)', tokens: new Set(['emergency', 'em', 'er']) },
  { cell: 'np/pa (hospitalist)', tokens: new Set(['hospitalist']) },
  { cell: 'np/pa (neonatology)', tokens: new Set(['neonatology', 'nicu']) },
  { cell: 'np/pa (surgery)', tokens: new Set(['surgery', 'surgical']) },
  // 'acute' = the spelled-out ACNP/AGACNP axis ("Acute Care Nurse
  // Practitioner") — must land on the SAME specialty cell as the credential
  // abbreviations, never the primary-care fallback (Sol R34).
  { cell: 'np/pa (specialty)', tokens: new Set(['acute']) },
]

/** Tokens that mean the np/pa PRIMARY CARE cell rather than a specialty cell. */
const NPPA_PRIMARY_TOKENS: ReadonlySet<string> = GENERIC_AXIS_TOKENS

/** Provider-pass result: a resolved cell, an explicit BLOCK (the specialty
 *  axis carries an out-of-taxonomy modifier — "Radiation Oncology NP" must
 *  escalate, not quote the generic specialty cell; Sol R1 F2), or null
 *  (no provider tokens — fall through to the generic passes). */
/** Words that read as role coordination between two provider mentions when
 *  they survive tokenization ("MD and CRNA", "Physician or PA", "MD as well
 *  as CRNA", "MD needed for CRNA rates" — Sol R15/R16). Freetext strips
 *  'and'/'as'/'for' as fillers (leaving the roles adjacent); the field path
 *  keeps them. */
const ROLE_COORDINATORS: ReadonlySet<string> = new Set([
  'and', 'or', 'plus', 'vs', 'versus', 'as', 'well', 'also', 'for', 'both',
  // 'along with' / 'alongside' — phrase coordination ("an MD along with a
  // CRNA"; Sol R19). Bare 'with' is deliberately NOT here: "CRNA with MD
  // supervision" is one priced role — the walk admits 'with' only directly
  // after 'along'.
  'along', 'alongside',
])

/** Ordinary posting adjectives that decorate a role without naming anything
 *  ("MD and EXPERIENCED CRNAs both needed") — transparent in the coordination
 *  walk so a routine descriptor cannot convert an explicit two-role request
 *  into a single-role price (Sol R17). Deliberately short; unknown adjectives
 *  remain walk-breaking (name evidence) — the SAFE direction for quotes. */
const ROLE_DESCRIPTORS: ReadonlySet<string> = new Set([
  'experienced', 'licensed', 'qualified', 'skilled', 'seasoned',
  'senior', 'junior', 'additional', 'multiple', 'several',
])

type ProviderResolution = { key: string } | { blocked: true } | null

function resolveProviderClass(tokenList: ReadonlyArray<string>): ProviderResolution {
  const tokens: ReadonlySet<string> = new Set(tokenList)
  // Multi-token provider profiles must be ADJACENT in the field (Sol R6):
  // "Physician and Assistant" is two roles, not the physician-assistant title.
  const adjacentRun = (profile: ReadonlyArray<string>): boolean => {
    if (profile.length === 1) return tokens.has(profile[0])
    for (let i = 0; i + profile.length <= tokenList.length; i++) {
      if (profile.every((t, k) => tokenList[i + k] === t)) return true
    }
    return false
  }
  let family: 'crna' | 'caa' | 'nppa' | null = null
  const consumed = new Set<string>()
  let credentialCell: string | null = null
  const familiesPresent = new Set<'crna' | 'caa' | 'nppa'>()
  for (const p of PROVIDER_PROFILES) {
    if (adjacentRun(p.tokens)) {
      familiesPresent.add(p.family)
      // crna/caa are more specific than the generic np/pa markers — first hit
      // wins and the array is ordered accordingly.
      if (family === null) family = p.family
      if (family === p.family) p.tokens.forEach((t) => consumed.add(t))
    }
  }
  // Distinct provider families are DIFFERENT priced cells ("CRNA/CAA",
  // "NP and CRNA") — never silently pick the first; escalate (Sol R7).
  if (familiesPresent.size > 1) return { blocked: true }
  const credentialsPresent = Object.keys(NPPA_CREDENTIAL_CELLS).filter((cred) => tokens.has(cred))
  // Competing credential-implied cells ("FNP and PMHNP") are a conflict, not a
  // declaration-order pick; same-cell combinations ("ACNP/AGACNP") are fine.
  const credentialCells = new Set(credentialsPresent.map((cred) => NPPA_CREDENTIAL_CELLS[cred]))
  if (credentialCells.size > 1) return { blocked: true }
  for (const cred of credentialsPresent) {
    if (family === null) family = 'nppa'
    if (family === 'nppa') {
      consumed.add(cred)
      credentialCell = credentialCell ?? NPPA_CREDENTIAL_CELLS[cred]
    }
  }
  // An UNCONSUMED 'physician'/'doctor' beside a provider marker is explicit
  // role coordination ("Emergency Medicine Physician/PA", "Doctors/CRNA") —
  // only the contiguous 'physician assistant' title consumes its word (Sol
  // R11/R12). The -ologist/-ist roles fold into their key tokens and are
  // caught by physicianConflict below instead. The CREDENTIAL forms 'md'/
  // 'do'/'dr'/'drs' are the same role evidence ONLY when a walk from the
  // credential reaches a provider marker across nothing but TRANSPARENT
  // tokens — coordinators ("MD and/or CRNA"), noise ('s from apostrophe
  // plurals, 'needed', …), and specialty-axis vocabulary ("MD/Emergency
  // Medicine PA"). A foreign token breaks the reading: a person's name or
  // facility word means Maryland, a credential suffix, or an honorific
  // ("CRNA coverage contact John Smith MD", "Dr. Smith - CRNA" keep
  // quoting; Sol R13/R14/R15). Known residual: verb-'do' right beside a
  // provider still over-escalates ("crnas do locum work") — the SAFE
  // direction.
  if (family !== null) {
    const physicianWord = tokenList.some(
      (t, i) => (t === 'physician' || t === 'doctor') && tokenList[i + 1] !== 'assistant',
    )
    const isTransparent = (t: string, at: number): boolean =>
      ROLE_COORDINATORS.has(t) ||
      ROLE_DESCRIPTORS.has(t) ||
      NOISE_TOKENS.has(t) ||
      GENERIC_AXIS_TOKENS.has(t) ||
      TAXONOMY_TOKENS.has(t) ||
      t === 'a' || t === 'an' || t === 'the' || // grammatical glue the field path keeps ("MD and an experienced CRNA"; Sol R18)
      (t === 'with' && tokenList[at - 1] === 'along') || // ONLY the 'along with' phrase — bare 'with' stays foreign (Sol R19)
      /^\d+$/.test(t) // role counts: "1 MD / 2 CRNAs" (Sol R16)
    const walksToMarker = (start: number, step: -1 | 1): boolean => {
      for (let j = start + step; j >= 0 && j < tokenList.length; j += step) {
        if (consumed.has(tokenList[j])) return true
        if (!isTransparent(tokenList[j], j)) return false
      }
      return false
    }
    const coordinatedCredential = tokenList.some((t, i) => {
      if (t !== 'md' && t !== 'do' && t !== 'dr' && t !== 'drs') return false
      // A DIRECTLY ATTACHED foreign token names a person or facility, not a
      // second role: "Dr. John Smith", "MD Anderson", "md-led" — the
      // credential binds to the name, so coordination is off for this
      // instance ("PA - Emergency Medicine Department - MD Anderson" keeps
      // quoting; Sol R16).
      const next = tokenList[i + 1]
      if (next !== undefined && !consumed.has(next) && !isTransparent(next, i + 1)) return false
      return walksToMarker(i, -1) || walksToMarker(i, 1)
    })
    if (physicianWord || coordinatedCredential) return { blocked: true }
  }
  // An NP credential next to a crna/caa marker is a CONFLICTING second family
  // ("CRNA and PMHNP", "CAA/NNP") — except the bare APRN decoration on a CRNA
  // ("CRNA, APRN": every CRNA is an APRN; Sol R7/R8).
  if (
    (family === 'crna' || family === 'caa') &&
    credentialsPresent.some((cred) => !(family === 'crna' && cred === 'aprn'))
  ) {
    return { blocked: true }
  }
  if (family === null) return null

  const rest = [...tokens].filter((t) => !consumed.has(t) && !NOISE_TOKENS.has(t))
  // The modifier + typo guards apply to the provider family exactly as to the
  // generic passes: an unpriced clinical modifier (radiation, transplant, …)
  // or a Lev-1 typo of a modifier/taxonomy token on the specialty axis blocks
  // the quote ("Cardiolgy NP" must escalate, never price primary care).
  for (const t of rest) {
    if (EXTRA_MODIFIERS.has(t)) return { blocked: true }
    for (const w of EXTRA_MODIFIERS) {
      if (w.length >= 6 && isLev1(t, w)) return { blocked: true }
    }
    for (const w of TAXONOMY_TOKENS) {
      if (w.length >= 6 && isLev1(t, w)) return { blocked: true }
    }
  }
  // Coordinated physician cells are a CONFLICT (Sol R10): a fully-named
  // physician key ("Anesthesiologist/CRNA", "Hospitalist/CRNA") beside a
  // provider marker must escalate — UNLESS the key is the provider cell's own
  // axis phrase ("Emergency Medicine Physician Assistant": the EM tokens ARE
  // the np/pa (emergency) axis) or is built purely from generic-axis words
  // ("Family Medicine - FNP": family medicine IS the FNP credential's axis).
  const physicianConflict = (cellAxis: ReadonlySet<string>): boolean => {
    for (const [k, profile] of KEY_PROFILES) {
      if (k === 'crna' || k === 'anesthesiologist assistant' || k.startsWith('np/pa')) continue
      if (!isSubset(profile, tokens)) continue
      if ([...profile].every((t) => GENERIC_AXIS_TOKENS.has(t) || TRANSPARENT_QUALIFIERS.has(t))) continue
      if ([...profile].some((t) => cellAxis.has(t))) continue
      return true
    }
    return false
  }

  if (family === 'crna') {
    const axis = new Set(rest.includes('cardiology') ? ['cardiology'] : [])
    if (physicianConflict(axis)) return { blocked: true }
    return { key: axis.size > 0 ? 'cardiac anesthesiology' : 'crna' }
  }
  if (family === 'caa') {
    if (physicianConflict(new Set())) return { blocked: true }
    return { key: 'anesthesiologist assistant' }
  }
  // Collect EVERY matching np/pa axis: two competing priced axes ("NP
  // emergency and psychiatry") are a conflict, never a first-match pick.
  const matchedCells = NPPA_CELLS.filter(({ tokens: cellTokens }) => rest.some((t) => cellTokens.has(t)))
  if (matchedCells.length > 1) return { blocked: true }
  if (matchedCells.length === 1) {
    const axis = new Set(rest.filter((t) => matchedCells[0].tokens.has(t)))
    if (physicianConflict(axis)) return { blocked: true }
    return { key: matchedCells[0].cell }
  }
  // A known-taxonomy specialty token outside the primary-care bucket means a
  // specialty NP/PA ("Critical Care NP", "APRN - Cardiology"); else the
  // credential's own default cell; else the primary care cell.
  const specialtyAxis = rest.filter((t) => !NPPA_PRIMARY_TOKENS.has(t) && TAXONOMY_TOKENS.has(t))
  if (specialtyAxis.length > 0) {
    if (physicianConflict(new Set(specialtyAxis))) return { blocked: true }
    return { key: 'np/pa (specialty)' }
  }
  if (physicianConflict(new Set())) return { blocked: true }
  return { key: credentialCell ?? 'np/pa (primary care)' }
}

// =============================================================================
// Core generic matcher — subset candidates + alias UPGRADE + deterministic
// tie-break (§2 steps 2-4).
// =============================================================================

interface Match {
  key: string
  /** Input tokens this match accounts for. */
  consumed: ReadonlySet<string>
  kind: Candidate['kind']
}

function isSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const t of a) if (!b.has(t)) return false
  return true
}

/** UPGRADE (§2 step 3): after an alias match, a key whose profile fits inside
 *  (aliasTarget profile ∪ leftover input tokens) wins — this is what routes
 *  `pediatric icu` → pediatric critical care. Constraints (red-team):
 *  the upgraded key must CONSUME ≥1 leftover token (else it adds nothing) and
 *  must PRESERVE every strong (non-generic, non-transparent) base token —
 *  semantic preservation: 'pediatrics' cannot hijack an icu→critical-care
 *  match (drops 'critical'), 'general surgery' cannot hijack a trauma-surgery
 *  match (drops 'trauma'), while np/pa (psychiatry) may upgrade the
 *  np→primary-care default (drops only the generic axis). A base with NO
 *  strong tokens never upgrades. Never recursive. Deterministic pick: most
 *  leftover consumed, then largest profile; a tie across different keys
 *  upgrades nothing. */
function bestUpgrade(
  baseProfile: ReadonlySet<string>,
  leftover: ReadonlySet<string>,
): { key: string; extraConsumed: Set<string> } | null {
  const strongBase = [...baseProfile].filter(
    (t) => !GENERIC_AXIS_TOKENS.has(t) && !TRANSPARENT_QUALIFIERS.has(t),
  )
  if (strongBase.length === 0) return null
  const pool = new Set([...baseProfile, ...leftover])
  let best: { key: string; extraConsumed: Set<string>; size: number } | null = null
  let tied = false
  for (const [key, profile] of KEY_PROFILES) {
    if (!isSubset(profile, pool)) continue
    const extra = new Set([...profile].filter((t) => leftover.has(t)))
    if (extra.size === 0) continue
    if (!strongBase.every((t) => profile.has(t))) continue
    if (
      best === null ||
      extra.size > best.extraConsumed.size ||
      (extra.size === best.extraConsumed.size && profile.size > best.size)
    ) {
      tied = best !== null && extra.size === best.extraConsumed.size && profile.size === best.size
      best = { key, extraConsumed: extra, size: profile.size }
    } else if (extra.size === best.extraConsumed.size && profile.size === best.size && key !== best.key) {
      tied = true
    }
  }
  return best === null || tied ? null : { key: best.key, extraConsumed: best.extraConsumed }
}

/** Collect every candidate match over the input token set (KEY pass + ALIAS
 *  pass with upgrade + shorthand pass). `allowShortLone` gates the two-letter
 *  lone aliases (np/pa/em/…) out of multi-token freetext windows. */
function collectMatches(
  tokens: ReadonlySet<string>,
  allowShortLone: boolean,
  candidateFilter?: (c: Candidate) => boolean,
): Match[] {
  const matches: Match[] = []
  for (const c of CANDIDATES) {
    if (c.shortLone && !allowShortLone) continue
    if (candidateFilter && !candidateFilter(c)) continue
    if (!isSubset(c.profile, tokens)) continue
    if (c.kind === 'key' || c.kind === 'shorthand') {
      matches.push({ key: c.target, consumed: c.profile, kind: c.kind })
      continue
    }
    // ALIAS: try the upgrade before settling on the target.
    const leftover = new Set([...tokens].filter((t) => !c.profile.has(t) && !NOISE_TOKENS.has(t)))
    const targetProfile = KEY_PROFILES.get(c.target) ?? c.profile
    const up = leftover.size > 0 ? bestUpgrade(targetProfile, leftover) : null
    if (up) {
      matches.push({ key: up.key, consumed: new Set([...c.profile, ...up.extraConsumed]), kind: 'alias' })
    } else {
      matches.push({ key: c.target, consumed: c.profile, kind: 'alias' })
    }
  }
  return matches
}

/** Deterministic tie-break (§2 step 4): (a) strict-superset consumption wins;
 *  (b) more non-TRANSPARENT tokens covered wins; (c) key beats alias beats
 *  shorthand; (d) still tied across different keys → null (caller escalates). */
function pickWinner(matches: Match[]): Match | null {
  if (matches.length === 0) return null
  // (a) drop matches whose consumed set is a strict subset of another's.
  let survivors = matches.filter(
    (m) => !matches.some((o) => o !== m && m.consumed.size < o.consumed.size && isSubset(m.consumed, o.consumed)),
  )
  // (b) maximal non-transparent coverage.
  const nonTransparent = (m: Match) => [...m.consumed].filter((t) => !TRANSPARENT_QUALIFIERS.has(t)).length
  const maxNT = Math.max(...survivors.map(nonTransparent))
  survivors = survivors.filter((m) => nonTransparent(m) === maxNT)
  // (c) key > alias > shorthand.
  const rank = (m: Match) => (m.kind === 'key' ? 0 : m.kind === 'alias' ? 1 : 2)
  const minRank = Math.min(...survivors.map(rank))
  survivors = survivors.filter((m) => rank(m) === minRank)
  // (d) all survivors must agree on the key.
  const keys = new Set(survivors.map((m) => m.key))
  if (keys.size !== 1) return null
  // Merge consumed sets of same-key survivors (e.g. 'neuro surgery' matches
  // two alias spellings of neurosurgery with different profiles).
  const consumed = new Set<string>()
  for (const m of survivors) m.consumed.forEach((t) => consumed.add(t))
  return { key: survivors[0].key, consumed, kind: survivors[0].kind }
}

// =============================================================================
// Leftover blocking (§2 step 5) — the narrow rule that separates "unknown
// decoration → downgrade" from "price-changing signal → escalate".
// =============================================================================

/** Levenshtein distance ≤ 1 check, specialized (early exits; blocking only). */
function isLev1(a: string, b: string): boolean {
  if (a === b) return false // distance 0 is "the token itself", not a typo
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  // classic DP is overkill for ≤1 — walk to first mismatch, compare tails
  let i = 0
  while (i < Math.min(la, lb) && a[i] === b[i]) i++
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) // substitution
  const [shorter, longer] = la < lb ? [a, b] : [b, a]
  return shorter.slice(i) === longer.slice(i + 1) // insertion/deletion
}

/** True iff leftover token `t` BLOCKS the resolved match (→ escalate/discard):
 *  (i) a curated out-of-taxonomy modifier; (ii) part of a compatible
 *  alternative — a candidate FULLY present in the input whose target differs
 *  from the matched key (real ambiguity); (iii) a Levenshtein-1 typo of a
 *  modifier/taxonomy token ≥6 chars — used for BLOCKING only, never to
 *  fabricate a match ("Pedatric ICU" escalates, never quotes adult critical
 *  care). Two-letter lone aliases never block (state-code ambiguity). */
function isBlockingLeftover(
  t: string,
  inputTokens: ReadonlySet<string>,
  matchedKey: string,
  skipAlternatives = false,
  /** A supervision verb disambiguates the state-ambiguous aliases: bare 'pa'
   *  after "supervising" is a provider, not Pennsylvania (Sol R7). */
  includeShortLone = false,
): boolean {
  if (EXTRA_MODIFIERS.has(t)) return true
  for (const c of CANDIDATES) {
    if (skipAlternatives) break
    if (c.shortLone && !includeShortLone) continue
    if (c.target === matchedKey) continue
    if (c.profile.has(t) && isSubset(c.profile, inputTokens)) return true
  }
  for (const w of EXTRA_MODIFIERS) {
    if (w.length >= 6 && isLev1(t, w)) return true
  }
  for (const w of TAXONOMY_TOKENS) {
    if (w.length >= 6 && isLev1(t, w)) return true
  }
  return false
}

function leftoverOf(tokens: ReadonlySet<string>, consumed: ReadonlySet<string>): string[] {
  return [...tokens].filter(
    (t) => !consumed.has(t) && !NOISE_TOKENS.has(t) && !TRANSPARENT_QUALIFIERS.has(t),
  )
}

// =============================================================================
// Entry point 1 — FIELD resolve (mapSpecialty path).
// =============================================================================

const ESCALATION_KEY = 'internal medicine'

export function resolveSpecialtyField(raw: string): SpecialtyFactor {
  if (!raw) return { key: ESCALATION_KEY, source: 'default' }
  const lower = raw.toLowerCase().trim()
  // Exact canonical forms stay byte-compatible with today ('pdf' source).
  if (ownEntry(SPECIALTIES, lower)) return { key: lower, source: 'pdf' }
  const aliasTarget = ownEntry(SPECIALTY_ALIASES, lower)
  if (aliasTarget) return { key: aliasTarget, source: 'pdf' }

  const escalate = (): SpecialtyFactor => ({
    key: ESCALATION_KEY,
    source: 'default',
    // Zach §6 (2026-07-13): the escalation UI names the unrecognized phrase.
    unresolvedRaw: raw.trim() || undefined,
  })

  const tokenList = tokenizeAndFold(raw)
  if (tokenList.length === 0) return escalate()
  const tokens: ReadonlySet<string> = new Set(tokenList)

  // §2 step 1 — provider-class first (two-axis np/pa/crna/caa family). A
  // blocked provider resolution (modifier on the specialty axis) escalates.
  const provider = resolveProviderClass(tokenList)
  if (provider) {
    return 'blocked' in provider ? escalate() : { key: provider.key, source: 'inferred' }
  }

  // §2 steps 2-4 — generic subset matching with upgrade + tie-break.
  const winner = pickWinner(collectMatches(tokens, true))
  if (!winner) return escalate()

  // §2 step 5 — leftover accounting: EXTRA_MODIFIERS / compatible-alternative /
  // Lev-1 typos block; unknown decorations downgrade to 'inferred', never block.
  const leftover = leftoverOf(tokens, winner.consumed)
  if (leftover.some((t) => isBlockingLeftover(t, tokens, winner.key))) return escalate()
  // Field-only clinical-axis rule (Sol R1 F1): the whole string IS the
  // specialty phrase here, so an unconsumed token that names a cell axis we
  // price ("Neonatal SURGERY") means the phrase is a cell we DON'T price —
  // escalate rather than silently absorb it. Redundant restatements of the
  // matched cell ('cardiac' next to a cardiology key) are exempt. The
  // freetext window guard deliberately does NOT use this rule — freetext
  // carries context words ("crna for cardiac surgery unit") that would
  // mass-discard real matches.
  const keyProfile = KEY_PROFILES.get(winner.key)
  if (leftover.some((t) => KEY_AXIS_TOKENS.has(t) && !(keyProfile?.has(t) ?? false))) {
    return escalate()
  }

  return { key: winner.key, source: 'inferred' }
}

// =============================================================================
// Entry point 2 — PHRASE resolve (fuzzyMatchSpecialty path): full consumption
// only; a phrase with unconsumable tokens ("crna dallas tx") does NOT match.
// =============================================================================

export function resolveSpecialtyPhrase(raw: string): FuzzySpecialtyMatch | null {
  if (!raw) return null
  const lower = raw.toLowerCase().trim()
  if (ownEntry(SPECIALTIES, lower)) return { key: lower, distance: 0, matchKind: 'exact' }
  const aliasTarget = ownEntry(SPECIALTY_ALIASES, lower)
  if (aliasTarget) return { key: aliasTarget, distance: 0, matchKind: 'exact' }

  const rawTokenCount = lower.split(/\s+/).filter((t) => t.length > 0).length
  const tokenList = tokenizeAndFold(raw)
  if (tokenList.length === 0) return null
  const tokens: ReadonlySet<string> = new Set(tokenList)

  // Single raw tokens ('np/pa') may fuse their two-letter parts; multi-token
  // phrases may not (state-code ambiguity — 'hospitalist pa').
  const winner = pickWinner(collectMatches(tokens, rawTokenCount === 1))
  if (!winner) return null
  if (leftoverOf(tokens, winner.consumed).length > 0) return null // full consumption

  return { key: winner.key, distance: 0, matchKind: 'substring' }
}

// =============================================================================
// Entry point 3 — FREETEXT window resolve (parser path): exact token-set
// equality inside the window, then whole-field UPGRADE, then whole-field
// modifier guard (replaces v1's left-peek; catches "oncology - radiation").
// =============================================================================

export interface FreetextWindowMatch {
  key: string
  matchKind: FuzzyMatchKind
  /** Indices OUTSIDE the window consumed by the whole-field upgrade (the
   *  parser must remove these tokens too — precise consumption is what keeps
   *  city/state extraction intact). */
  extraConsumed: number[]
}

/** Words that mark 'adult' as CREDENTIAL metadata rather than a patient
 *  population ("adult ACLS certification") — such an 'adult' never cancels
 *  pediatric evidence. */
const CREDENTIAL_WORDS: ReadonlySet<string> = new Set([
  'acls', 'bls', 'als', 'pals', 'cpr', 'certification', 'certifications', 'certified', 'cert',
  // expanded life-support phrases ("advanced life support") — 'advanced'
  // itself stays NEUTRAL in the adult walk (it is taxonomy via 'advanced
  // practice'); 'life'/'support' collide with nothing clinical
  'life', 'support',
])

/** Relational verbs that mark TWO roles rather than a compound title
 *  ("hospitalist SUPERVISING NPs" is a physician posting or ambiguous;
 *  "hospitalist np" is an np/pa-cell title — Sol R6). */
// The NOUN 'supervision' is deliberately absent: "CRNA with MD supervision" /
// "NP — physician supervision provided" describe the ARRANGEMENT of one
// priced role, not a second role — routine posting language that must keep
// quoting (Sol R20). Active verb forms remain the mixed-role signal.
// Base forms ('manage', 'lead', 'oversee', 'direct') are included for
// plural-subject/infinitive grammar ("hospitalists MANAGE nps"; Sol R22) —
// safe ONLY because the positional verbMixedRole test requires a person-role
// word opposite a provider: "Lead CRNA position" and "CRNA direct hire" have
// no person-role counterpart and keep quoting.
const SUPERVISION_WORDS: ReadonlySet<string> = new Set([
  'supervising', 'supervises', 'supervise',
  'leading', 'leads', 'lead', 'overseeing', 'oversees', 'oversee',
  'managing', 'manages', 'manage', 'directing', 'directs', 'direct',
])

export function resolveFreetextWindow(
  tokens: ReadonlyArray<string>,
  start: number,
  len: number,
  /** Original pre-filler positions of `tokens` (parser supplies them so
   *  compound-title adjacency can see elided conjunctions — Sol R5). */
  origIdx?: ReadonlyArray<number>,
  /** The pre-filler token stream itself (parser supplies it so coordinator
   *  words the filler pass elides — 'hospitalists AND pas' — can still count
   *  as role evidence for the state-ambiguous 'pa'; Sol R23). */
  rawTokens?: ReadonlyArray<string>,
): FreetextWindowMatch | null {
  const windowRaw = tokens.slice(start, start + len)
  const phrase = windowRaw.join(' ')
  const lower = phrase.toLowerCase()
  const exactKeyString = ownEntry(SPECIALTIES, lower) ? lower : ownEntry(SPECIALTY_ALIASES, lower)

  // Noise tokens stay IN the window set (profiles demand them — 'physician
  // assistant'); they are ignored on the leftover side by leftoverOf.
  const windowFold = new Set(windowRaw.flatMap(tokenizeAndFold))
  if ([...windowFold].every((t) => NOISE_TOKENS.has(t))) return null

  // Noise tokens STAY in the rest-fold: candidate profiles keep noise
  // ('physician assistant'), so the guard's full-profile-present test needs
  // the complete picture — noise is excluded later, at guard/fuel selection.
  const restIdx = tokens.map((_, i) => i).filter((i) => i < start || i >= start + len)
  const restFoldByIdx = restIdx.map((i) => ({ i, folded: tokenizeAndFold(tokens[i]) }))
  const restFold = new Set(restFoldByIdx.flatMap((r) => r.folded))

  // Opposing-axis marker (Sol R3, scoped R4, span-widened R5): 'adult' counts
  // as a POPULATION marker when a specialty-vocabulary token sits within a
  // short forward span (or immediately before) — "adult critical care",
  // "adult-only critical care", "adult population critical care" — but not
  // when it heads a credential clause ("adult ACLS certification").
  const foldOf = (raw: string | undefined) => (raw === undefined ? [] : tokenizeAndFold(raw))
  const hasAdult = tokens.some((raw, k) => {
    if (!foldOf(raw).includes('adult')) return false
    if (foldOf(tokens[k - 1]).some((t) => TAXONOMY_TOKENS.has(t))) return true
    // Ordered forward walk (Sol R8): whichever comes FIRST decides — a
    // non-pediatric taxonomy token binds 'adult' to the specialty phrase
    // ("adult critical care ACLS" is a population marker even though ACLS
    // follows), a credential word marks the phrase as requirement metadata
    // ("adult ACLS", "adult and pediatric CPR certification"). The paired
    // population words themselves are neutral in the walk.
    for (const d of [1, 2, 3, 4]) {
      const folds = foldOf(tokens[k + d])
      if (folds.some((t) => CREDENTIAL_WORDS.has(t))) return false
      // neutral in the walk: the paired population words and 'advanced'
      // (taxonomy only via 'advanced practice', and the head of the expanded
      // 'advanced life support' credential phrase)
      if (
        folds.some(
          (t) => t !== 'pediatric' && t !== 'adult' && t !== 'advanced' && TAXONOMY_TOKENS.has(t),
        )
      ) {
        return true
      }
    }
    return false
  })
  // Person-form role words name WHO is being hired and re-enable full
  // compatible-alternative blocking around provider windows ("anesthesiologist
  // supervising crna" escalates, "crna emergency department coverage" stays
  // CRNA). COMPOUND provider titles are not physician evidence: 'physician
  // assistant' / 'anesthesiologist assistant' / 'nurse practitioner' bigrams
  // — LEXICALLY ADJACENT in the original text (origIdx; filler elision must
  // not fabricate a title from "physician and assistant") — are neutralized
  // before the test. The vocabulary deliberately excludes bare '-ician'
  // (technician/clinician are staff mentions) and names the -ician physician
  // roles explicitly.
  const rawLower = tokens.map((r) => r.toLowerCase())
  const origAdjacent = (k: number) => (origIdx ? origIdx[k + 1] === origIdx[k] + 1 : true)
  const compoundIdx = new Set<number>()
  for (let k = 0; k < rawLower.length - 1; k++) {
    const a = rawLower[k]
    const b = rawLower[k + 1]
    if (
      origAdjacent(k) &&
      ((/^physicians?$/.test(a) && /^assistants?$/.test(b)) ||
        (/^anesthesiologists?$/.test(a) && /^assistants?$/.test(b)) ||
        (/^nurses?$/.test(a) && /^practitioners?$/.test(b)))
    ) {
      compoundIdx.add(k)
      compoundIdx.add(k + 1)
    }
  }
  const hasPersonForm = rawLower.some(
    (raw, k) =>
      !compoundIdx.has(k) &&
      (/(ologists?|iatrists?|surgeons?)$/.test(raw) ||
        /^(physicians?|doctors?|pediatricians?|obstetricians?|geriatricians?|internists?)$/.test(raw)),
  )

  // Positional mixed-role check for supervision VERBS (Sol R21): the verb is a
  // mixed-role signal ONLY when a person-role word (a physician person-form, a
  // physician-person noun like hospitalist/intensivist, or an md/do/dr/drs
  // credential) sits on one side of it and a provider marker on the other
  // ("hospitalist SUPERVISING nps", "MD supervising CRNA"). A verb describing
  // the provider's own duties has no person-role counterpart ("NP MANAGES
  // primary-care patients", "CRNA MANAGING anesthesia cases") and must not
  // discard the quote.
  const personRoleAt = rawLower.map(
    (raw, k) =>
      (!compoundIdx.has(k) &&
        (/(ologists?|iatrists?|surgeons?)$/.test(raw) ||
          /^(physicians?|doctors?|pediatricians?|obstetricians?|geriatricians?|internists?)$/.test(raw) ||
          /^(hospitalists?|intensivists?|nocturnists?|laborists?)$/.test(raw))) ||
      tokenizeAndFold(raw).some((t) => t === 'md' || t === 'do' || t === 'dr' || t === 'drs'),
  )
  // 'PA' immediately followed by a licensure word is the STATE qualifying a
  // license ("PA-licensed", "PA license required"), never the provider — the
  // reverse order ("licensed PA") stays a provider (Sol R26).
  const paLicenseShield = (k: number): boolean =>
    /^pas?$/.test(rawTokens?.[k] ?? '') &&
    /^(licensed?|licenses|licensure|certified|certifications?)$/.test(rawTokens?.[k + 1] ?? '')
  // True when every 'pa' in the field is licensure-shielded — then 'pa' must
  // stay OUT of provider evidence on EVERY path, including the leftover guard
  // under an independent person-form roleContext ("pa license required,
  // anesthesiologist needed" prices anesthesiology + PA; Sol R27).
  const shieldedOnlyPa =
    (rawTokens?.some((w, k) => /^pas?$/.test(w) && paLicenseShield(k)) ?? false) &&
    !(rawTokens?.some((w, k) => /^pas?$/.test(w) && !paLicenseShield(k)) ?? false)
  const providerMarkAt = rawLower.map(
    (raw, k) =>
      tokenizeAndFold(raw).some((t) => PROVIDER_MARK_TOKENS.has(t)) &&
      // a shielded 'pa' is the state, not a provider mark (Sol R27)
      !(/^pas?$/.test(raw) && origIdx !== undefined && paLicenseShield(origIdx[k])),
  )
  const verbMixedRole = rawLower.some((raw, v) => {
    if (!SUPERVISION_WORDS.has(raw)) return false
    // 'direct HIRE/placement' is staffing vocabulary, not supervision — "NP
    // direct hire for a hospitalist position" is one role (Sol R23).
    if (raw === 'direct' && /^(hir(e|es|ing)|placements?)$/.test(rawLower[v + 1] ?? '')) return false
    const roleBefore = personRoleAt.slice(0, v).some(Boolean)
    const roleAfter = personRoleAt.slice(v + 1).some(Boolean)
    const provBefore = providerMarkAt.slice(0, v).some(Boolean)
    const provAfter = providerMarkAt.slice(v + 1).some(Boolean)
    return (roleBefore && provAfter) || (provBefore && roleAfter)
  })

  // Coordinator-adjacency evidence from the PRE-FILLER stream (Sol R23): the
  // filler pass elides 'and'/'or', so "hospitalists AND pas" reaches the
  // resolver looking exactly like the title fusion "hospitalist pa". Only the
  // pre-filler stream can tell them apart.
  const personRoleRaw = (w: string | undefined): boolean =>
    w !== undefined &&
    (/(ologists?|iatrists?|surgeons?)$/.test(w) ||
      /^(physicians?|doctors?|pediatricians?|obstetricians?|geriatricians?|internists?)$/.test(w) ||
      /^(hospitalists?|intensivists?|nocturnists?|laborists?)$/.test(w) ||
      tokenizeAndFold(w).some((t) => t === 'md' || t === 'do' || t === 'dr' || t === 'drs'))
  const rawCoord = (w: string | undefined): boolean => w !== undefined && /^(and|or)$/.test(w)
  // A provider SPAN (abbreviation, credential, or the spelled-out multi-token
  // title — 'nurse practitioners', 'physician assistants'; Sol R24) with a
  // coordinator beside it and a person-role word just beyond = two roles,
  // never a title ("hospitalists and pas", "hospitalists and nurse
  // practitioners" escalate; "hospitalist np" and field "Hospitalist PA"
  // keep fusing).
  const providerSpanAt = (k: number): number => {
    const w = rawTokens?.[k] ?? ''
    const w2 = rawTokens?.[k + 1] ?? ''
    if (/^nurses?$/.test(w) && /^(practitioners?|anesthetists?)$/.test(w2)) return 2
    if (/^(physicians?|anesthesiologists?)$/.test(w) && /^assistants?$/.test(w2)) return 2
    if (/^pas?$/.test(w) && paLicenseShield(k)) return 0
    if (/^(pas?|nps?|crnas?|caas?|aprns?|fnps?|pmhnps?|nnps?|acnps?|agacnps?|whnps?)$/.test(w)) return 1
    return 0
  }
  // Gap tokens the coordination scan may walk across (Sol R25): articles,
  // known role descriptors, noise, counts — "a hospitalist and AN EXPERIENCED
  // nurse practitioner" still coordinates. Coordinators and person-role words
  // are checked FIRST ('and' is also a noise token) so they terminate the
  // walk instead of being skipped.
  const rawGapTransparent = (w: string | undefined): boolean =>
    w !== undefined &&
    !rawCoord(w) &&
    !personRoleRaw(w) &&
    (/^(a|an|the)$/.test(w) || ROLE_DESCRIPTORS.has(w) || NOISE_TOKENS.has(w) || /^\d+$/.test(w))
  const rawNextSignificant = (j: number, step: -1 | 1): number => {
    let k = j
    while (rawTokens && k >= 0 && k < rawTokens.length && rawGapTransparent(rawTokens[k])) k += step
    return rawTokens && k >= 0 && k < rawTokens.length ? k : -1
  }
  const spanSideMix = (edge: number, step: -1 | 1): boolean => {
    if (!rawTokens) return false
    const c = rawNextSignificant(edge, step)
    if (c < 0 || !rawCoord(rawTokens[c])) return false
    const r = rawNextSignificant(c + step, step)
    return r >= 0 && personRoleRaw(rawTokens[r])
  }
  const coordinatedProviderMix =
    rawTokens?.some((_, k) => {
      const span = providerSpanAt(k)
      if (span === 0) return false
      return spanSideMix(k - 1, -1) || spanSideMix(k + span, 1)
    }) ?? false
  // A coordinator within a transparent gap of 'pa' (either side) is role
  // evidence for the state-ambiguous alias even without a named person-role —
  // used by the leftover guard's roleContext below.
  const paCoordSide = (edge: number, step: -1 | 1): boolean => {
    if (!rawTokens) return false
    const c = rawNextSignificant(edge, step)
    return c >= 0 && rawCoord(rawTokens[c])
  }
  const coordinatedPa =
    rawTokens?.some(
      (w, k) =>
        /^pas?$/.test(w) &&
        !paLicenseShield(k) &&
        (paCoordSide(k - 1, -1) || paCoordSide(k + 1, 1)),
    ) ?? false

  // Adjacency-required provider aliases: the profile's token pair must occur
  // as lexically-adjacent raw tokens INSIDE this window.
  const windowHasAdjacentPair = (c: Candidate): boolean => {
    const parts = c.text.split(/\s+/)
    for (let k = start; k < start + len - 1; k++) {
      if (!origAdjacent(k)) continue
      const fa = foldOf(tokens[k])
      const fb = foldOf(tokens[k + 1])
      const pa = tokenizeAndFold(parts[0])
      const pb = tokenizeAndFold(parts[parts.length - 1])
      if (pa.every((t) => fa.includes(t)) && pb.every((t) => fb.includes(t))) return true
    }
    return false
  }
  const candidateFilter = (c: Candidate): boolean =>
    !ADJACENCY_REQUIRED_ALIASES.has(c.text) || windowHasAdjacentPair(c)

  // ---- window match: exact token-set equality (subset would swallow city/
  // state tokens — red-team: flips 4/5 golden parse cases), with the alias
  // UPGRADE allowed to consume window tokens ('pediatric icu').
  const allowShortLone = len === 1
  let matched: Match | null = null
  const winner = pickWinner(
    collectMatches(windowFold, allowShortLone, candidateFilter).filter((m) => {
      // full-window consumption: nothing non-noise/non-transparent left over
      return leftoverOf(windowFold, m.consumed).length === 0
    }),
  )
  if (winner) matched = winner
  if (!matched) return null

  // ---- whole-field UPGRADE, BOUNDED (Sol R2 F3): fuel comes only from
  // PRE-window tokens ("children's hospital needs icu coverage" — the
  // modifier precedes what it modifies) plus the single immediately-adjacent
  // post-window token ("np psychiatry"). A distant trailing mention
  // ("critical care … occasional pediatric patients") must NOT move the cell.
  let key = matched.key
  const extraConsumed: number[] = []
  const keyProfile = KEY_PROFILES.get(key)
  const fuelIdx = restFoldByIdx.filter((r) => r.i < start || r.i === start + len)
  const fuelFold = new Set(fuelIdx.flatMap((r) => r.folded))
  if (hasAdult) fuelFold.delete('pediatric') // opposing-axis: never fuel a pediatric flip
  if (keyProfile && fuelFold.size > 0) {
    const up = bestUpgrade(keyProfile, fuelFold)
    if (up) {
      key = up.key
      for (const r of fuelIdx) {
        if (r.folded.some((t) => up.extraConsumed.has(t))) extraConsumed.push(r.i)
      }
    }
  }

  // ---- whole-field modifier guard: any blocking token in the REMAINING text
  // (minus what the upgrade consumed) discards the window match entirely.
  // PROVIDER-CLASS windows (crna/caa/np-pa cells) skip the compatible-
  // alternative branch: physician-specialty words around a provider are the
  // assignment's SETTING, not a competing cell ("crna emergency department
  // coverage", "crna icu call" stay CRNA). Modifiers + typo blocks still apply.
  const providerCell =
    key === 'crna' || key === 'anesthesiologist assistant' || key.startsWith('np/pa')
  // A lone 'pa' window that is licensure-shielded ("PA-licensed …") is the
  // STATE, not a provider window — skip it so the real specialty window
  // resolves ("PA-licensed and board-certified hospitalist" prices the
  // hospitalist + PA; Sol R26).
  if (
    providerCell &&
    len === 1 &&
    /^pas?$/.test(rawLower[start] ?? '') &&
    origIdx !== undefined &&
    paLicenseShield(origIdx[start])
  ) {
    return null
  }
  // Mixed-role hard rule (Sol R5+R6, scoped R21): a provider-cell window with
  // a NON-COMPOUND physician-role word ("geriatrician supervising np") is
  // discarded outright; a supervision VERB discards only POSITIONALLY — a
  // person-role word on one side, a provider marker on the other ("hospitalist
  // SUPERVISING nps", "MD supervising CRNA"). A verb describing the provider's
  // own duties ("NP manages primary-care patients", "CRNA managing anesthesia
  // cases") keeps quoting. Plain title juxtaposition ("hospitalist np") still
  // fuses.
  // Shielded PA occurrences stay out of the whole-field classifier too — the
  // classifier would otherwise see a second provider FAMILY and reject the
  // real provider window ("PA license required, CRNA needed" prices crna+PA;
  // Sol R28).
  const fieldFold = tokens.flatMap((r, k) =>
    /^pas?$/.test(r) && origIdx !== undefined && paLicenseShield(origIdx[k])
      ? []
      : tokenizeAndFold(r),
  )
  if (providerCell && (hasPersonForm || verbMixedRole || coordinatedProviderMix)) return null
  // Shared conflict/axis classifier (Sol R9): a provider window resolves its
  // CELL from the whole field through the same classifier the field path uses
  // — "crna and pmhnp" conflicts escalate, "aprn cardiology" lands on the
  // specialty NP/PA cell instead of the alias default.
  if (providerCell) {
    const classified = resolveProviderClass(fieldFold)
    if (classified && 'blocked' in classified) return null
    if (classified) key = classified.key
  }
  const skipAlternatives = providerCell
  const consumedFold = new Set([...(KEY_PROFILES.get(key) ?? []), ...matched.consumed])
  const inputFold = new Set([...windowFold, ...restFold])
  const matchedProfile = KEY_PROFILES.get(key)
  const guardTokens = [...restFold].filter(
    (t) =>
      !consumedFold.has(t) &&
      !NOISE_TOKENS.has(t) &&
      !TRANSPARENT_QUALIFIERS.has(t) &&
      !(t === 'pa' && shieldedOnlyPa) && // licensure-shielded PA is the state on EVERY path (Sol R27)
      !(hasAdult && t === 'pediatric') && // opposing-axis: context, not a blocker
      // Redundancy exemption (mirrors the field rule): a token that is PART OF
      // the matched key's own profile restates the cell, it doesn't compete —
      // 'psychiatric facility' around a CAP (child psychiatry) match.
      !(matchedProfile?.has(t) ?? false),
  )
  // A POSITIONAL mixed-role verb OR a (non-compound) person-form role word
  // gives 'pa' its provider reading — "emergency medicine physician or pa"
  // must not resolve the physician cell around an exempted 'pa' (Sol R7/R11).
  // verbMixedRole (not the bag-level verb) so base forms like 'lead'/'direct'
  // in single-role postings ("Lead CRNA … in PA") can't flip Pennsylvania
  // into provider evidence (Sol R22). A COORDINATOR directly beside 'pa' in
  // the pre-filler stream is the same evidence — "hospitalists AND pas" is
  // two roles even after the filler pass elides the 'and', while
  // 'hospitalist in pa' (location 'in') keeps Pennsylvania (Sol R23).
  const roleContext = verbMixedRole || hasPersonForm || coordinatedPa
  if (guardTokens.some((t) => isBlockingLeftover(t, inputFold, key, skipAlternatives, roleContext))) return null

  return {
    key,
    // 'exact' only when the raw window string IS the canonical key/alias AND
    // the whole-field upgrade didn't move it to a different cell.
    matchKind: exactKeyString !== undefined && key === (ownEntry(SPECIALTIES, lower) ? lower : exactKeyString) ? 'exact' : 'substring',
    extraConsumed,
  }
}
