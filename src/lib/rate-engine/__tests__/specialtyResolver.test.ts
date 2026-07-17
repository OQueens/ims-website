// =============================================================================
// specialtyResolver.test.ts — THE RED TABLE for the v2 specialty resolver
// (docs/superpowers/specs/2026-07-13-specialty-resolver-design.md).
//
// §5 red-team corpus (37-verifier workflow wf_2b3b49e4-745) pinned as tests,
// plus the §3 auto-generated alias/key identity suites and the refine-hijack
// fix. The win condition (§1): misroutes → escalation; routine quotes stay
// quotes. Over-escalation of normal inputs is the v1 failure mode v2 kills —
// several cases below exist purely to pin "this must KEEP quoting".
//
// Zach §6 answers (2026-07-13): missing cells (radiation oncology,
// endovascular, transplant) KEEP ESCALATING; the escalation carries the
// unrecognized phrase (SpecialtyFactor.unresolvedRaw) so the UI can name it;
// golden-master flips are wrong→right only, each enumerated.
// =============================================================================

import { describe, it, expect, vi } from 'vitest'

// Importing the engine pulls firebase/database at module load — resolve it
// without a real client (same posture as marketBucketsOverlay.test.ts).
vi.mock('firebase/database', () => ({ ref: vi.fn(), get: vi.fn() }))

import { mapSpecialty, initFactors, refineSpecialtyFromContext } from '../rateCalculator'
import { fuzzyMatchSpecialty } from '../fuzzyMatch'
import { parseFreetextInput, buildParsedFromFreetext } from '../parser'
import { SPECIALTIES, SPECIALTY_ALIASES } from '../specialties'
import type { ParsedAssignment } from '../types'

const ESCALATE = { key: 'internal medicine', source: 'default' }

// =============================================================================
// §5 corpus — FIELD path (mapSpecialty: the whole string is the specialty)
// =============================================================================

describe('field resolve — §1 misroutes now escalate (missing cells stay escalating per Zach §6)', () => {
  const escalations: string[] = [
    'Radiation Oncology', // today: medical oncology ($350-500) — modifier "radiation" blocks
    'Endovascular Surgery', // today: endocrinology ('endo' ⊂ "endovascular") — nothing matches
    'Transplant Surgery', // missing cell — keep escalating (Zach §6)
    'Invasive Cardiology', // interventional-priced; plain cardiology would under-quote
    'Non-invasive Cardiology',
    'Pedatric ICU', // Lev-1 typo guard: BLOCKS, never quotes adult critical care
  ]
  for (const raw of escalations) {
    it(`escalates "${raw}" and names the phrase`, () => {
      const f = mapSpecialty(raw)
      expect(f).toMatchObject(ESCALATE)
      expect(f.unresolvedRaw).toBe(raw.trim())
    })
  }

  it('empty input stays the byte-compatible default with NO phrase', () => {
    const f = mapSpecialty('')
    expect(f).toMatchObject(ESCALATE)
    expect(f.unresolvedRaw).toBeUndefined()
  })

  it('prototype-chain tokens never resolve (constructor/__proto__/hasOwnProperty)', () => {
    for (const evil of ['constructor', '__proto__', 'hasOwnProperty', 'toString']) {
      expect(mapSpecialty(evil)).toMatchObject(ESCALATE)
      expect(fuzzyMatchSpecialty(evil)).toBeNull()
    }
  })
})

describe('field resolve — §1 misroutes now route to the RIGHT cell', () => {
  const cases: Array<[string, string]> = [
    ['Pediatric ICU', 'pediatric critical care'], // today: adult critical care
    ['Pediatrics ICU', 'pediatric critical care'], // plural family fold
    ['Pediatric Anesthesiologist', 'pediatric anesthesiology'], // today: anesthesiology
    ['Gynecological Oncology', 'gynecologic oncology'], // today: medical oncology
    ['Reproductive Endocrinology & Infertility', 'reproductive endocrinology'], // today: endocrinology
    ['OB-GYN', 'ob/gyn'], // C13: today null/default
    ['Urogynecologist', 'urogynecology'], // today: default (no substring hits)
    ['Peds EM', 'pediatric emergency medicine'], // alias upgrade: em + pediatric
    ['Obstetric Anesthesia', 'obstetric anesthesiology'], // alias upgrade: anesthesia + ob
  ]
  for (const [raw, key] of cases) {
    it(`routes "${raw}" → ${key}`, () => {
      expect(mapSpecialty(raw)).toMatchObject({ key, source: 'inferred' })
    })
  }
})

describe('field resolve — routine decorated inputs KEEP QUOTING (v1 over-escalation killed)', () => {
  const cases: Array<[string, string]> = [
    ['General Cardiology', 'cardiology'], // transparent qualifier
    ["Women's Health - OB/GYN", 'ob/gyn'], // unknown decorations downgrade, never block
    ['Virtual Neurology', 'neurology'],
    ['Cardiac Cath Lab', 'interventional cardiology'], // leftover 'cardiac' downgrades
    ['Interventional Pain', 'pain management'], // 'interventional' is NOT a blocking modifier here
    ['Nurse - CRNA', 'crna'],
    ['Pulmonary Disease and Critical Care Medicine', 'critical care'],
    ['Pediatric General Surgery', 'pediatric surgery'], // transparent 'general' demoted in tie-break
    ['General Surgery - Trauma', 'trauma surgery'], // non-transparent coverage wins
    ['Orthopaedic Surgery', 'orthopedic surgery'], // -paed- fold
    ['Cardiothoracic Surgery', 'thoracic surgery'], // parity with today's substring route
    ['Virtual Psychiatry Position', 'telepsychiatry'], // existing alias profile + noise token
  ]
  for (const [raw, key] of cases) {
    it(`quotes "${raw}" → ${key} (inferred)`, () => {
      expect(mapSpecialty(raw)).toMatchObject({ key, source: 'inferred' })
    })
  }

  it('new curated aliases resolve as exact ("pdf") matches', () => {
    expect(mapSpecialty('Pulmonary Critical Care Medicine')).toMatchObject({ key: 'critical care', source: 'pdf' })
    expect(mapSpecialty('REI')).toMatchObject({ key: 'reproductive endocrinology', source: 'pdf' })
    expect(mapSpecialty('Medical/Surgical ICU')).toMatchObject({ key: 'critical care', source: 'pdf' }) // med/surg ICU is adult critical care
  })
})

describe('field resolve — provider-class pass runs FIRST (two-axis np/pa family)', () => {
  const cases: Array<[string, string]> = [
    ['NP - Psychiatry', 'np/pa (psychiatry)'],
    ['Psychiatric Nurse Practitioner', 'np/pa (psychiatry)'],
    ['Primary Care NP', 'np/pa (primary care)'],
    ['PA - Emergency Medicine', 'np/pa (emergency)'], // generic maximality would misroute to EM physician
    ['Hospitalist PA', 'np/pa (hospitalist)'],
    ['Surgical PA', 'np/pa (surgery)'],
    ['Critical Care NP', 'np/pa (specialty)'], // known-taxonomy token → specialty cell, not primary care
    ['Neonatal Nurse Practitioner', 'np/pa (neonatology)'],
    ['CRNA - Cardiac', 'cardiac anesthesiology'], // exact alias today; provider pass agrees
    ['np/pa', 'np/pa (primary care)'], // field path parity (short-alias word boundary today)
  ]
  for (const [raw, key] of cases) {
    it(`routes "${raw}" → ${key}`, () => {
      expect(mapSpecialty(raw).key).toBe(key)
    })
  }
})

// =============================================================================
// Sol R1 hardening (2026-07-13 adversarial gate) — unconsumed clinical-axis
// tokens must never be silently absorbed on the FIELD path, the provider pass
// must honor the modifier guard, and noise-stripped profiles must never turn
// 'physician assistant' into a bare 'assistant' wildcard.
// =============================================================================

describe('Sol R1 — field-path clinical-axis leftovers block', () => {
  const escalations = [
    'Neonatal Surgery', // 'surgery' leftover on the neonatology cell — unpriced subspecialty
    'Pediatric Cardiac Surgery', // pediatric surgery tie/leftover — unpriced subspecialty
    'Radiation Oncology NP', // provider pass must honor EXTRA_MODIFIERS
    'Transplant Surgery PA',
    'Medical Assistant', // must NOT hit a noise-stripped 'physician assistant' wildcard
    'Certified Medical Assistant',
  ]
  for (const raw of escalations) {
    it(`escalates "${raw}"`, () => {
      const f = mapSpecialty(raw)
      expect(f).toMatchObject(ESCALATE)
      expect(f.unresolvedRaw).toBe(raw.trim())
    })
  }

  const quotes: Array<[string, string]> = [
    ['Surgical ICU', 'critical care'], // curated alias — SICU is adult critical care
    ['Medical ICU', 'critical care'],
    ['MICU', 'critical care'],
    ['SICU', 'critical care'],
    ['Pediatric Orthopedic Surgery', 'pediatric orthopedics'], // Sol F5: was a 3-way tie escalation
    ['CRNA Cardiac', 'cardiac anesthesiology'], // token path (no dash) through the provider pass
    ['Anesthesia - Cardiac', 'cardiac anesthesiology'], // alias upgrade consumes the cardiac axis
  ]
  for (const [raw, key] of quotes) {
    it(`still quotes "${raw}" → ${key}`, () => {
      expect(mapSpecialty(raw).key).toBe(key)
    })
  }

  it('physician assistant remains fully intact through freetext', () => {
    const r = parseFreetextInput('physician assistant opening in dallas')
    expect(r.specialty).toMatchObject({ key: 'np/pa (primary care)' })
    expect(r.city?.city).toBe('dallas')
  })
})

describe('workflow-confirmed regressions — routine forms keep quoting', () => {
  const cases: Array<[string, string]> = [
    ['Physical Medicine & Rehabilitation', 'physical medicine & rehab'], // '&' form must match the 'and'-bearing alias
    ['Physical Medicine and Rehabilitation', 'physical medicine & rehab'],
    ['Rehabilitation Medicine', 'physical medicine & rehab'],
    ['Pediatrician', 'pediatrics'], // -ician professions (today: default — wrong→right)
    ['Obstetrician', 'ob/gyn'],
    ['Obstetrician/Gynecologist', 'ob/gyn'],
  ]
  for (const [raw, key] of cases) {
    it(`quotes "${raw}" → ${key}`, () => {
      expect(mapSpecialty(raw).key).toBe(key)
    })
  }
})

describe('workflow-confirmed — freetext ER/provider windows', () => {
  it('pediatric er → pediatric emergency medicine (was a ~2x underquote to pediatrics)', () => {
    const r = parseFreetextInput('pediatric er coverage in dallas, tx')
    expect(r.specialty).toMatchObject({ key: 'pediatric emergency medicine' })
    expect(r.state?.code).toBe('TX')
    const r2 = parseFreetextInput('peds er locums in texas')
    expect(r2.specialty).toMatchObject({ key: 'pediatric emergency medicine' })
  })

  it('specialty mentions around a PROVIDER window are the setting, not competing cells', () => {
    expect(parseFreetextInput('crna emergency department coverage').specialty).toMatchObject({ key: 'crna' })
    expect(parseFreetextInput('crna icu call coverage in texas').specialty).toMatchObject({ key: 'crna' })
    expect(parseFreetextInput('crna er call coverage in texas').specialty).toMatchObject({ key: 'crna' })
  })

  it('np fuses with an adjacent specialty in freetext (order-independent np/pa cells)', () => {
    expect(parseFreetextInput('hospitalist np in ohio').specialty).toMatchObject({ key: 'np/pa (hospitalist)' })
    expect(parseFreetextInput('np hospitalist in ohio').specialty).toMatchObject({ key: 'np/pa (hospitalist)' })
  })
})

describe('Sol R3 — opposing-axis, mixed-role, and plural-cap guards', () => {
  it('an explicit adult marker defeats the pediatric merge (Sol R3 counterexample)', () => {
    const r = parseFreetextInput('adult critical care physician covering pediatric consults')
    expect(r.specialty).toMatchObject({ key: 'critical care' })
  })

  it('mixed provider/physician role phrases escalate rather than pick the cheaper cell', () => {
    expect(parseFreetextInput('anesthesiologist supervising crna coverage').specialty).toBeNull()
    expect(parseFreetextInput('emergency medicine physician supervising crna').specialty).toBeNull()
  })

  it('provider windows still absorb setting words when no physician role is named', () => {
    expect(parseFreetextInput('crna emergency department coverage').specialty).toMatchObject({ key: 'crna' })
  })

  it('patient-cap metadata never becomes child psychiatry (plural-fold floor + cap strip)', () => {
    expect(parseFreetextInput('18 patient caps in ohio').specialty).toBeNull()
    const r = parseFreetextInput('hospitalist position with patient caps')
    expect(r.specialty).toMatchObject({ key: 'hospitalist' })
  })

  it('Adult Critical Care field stays on the adult cell', () => {
    expect(mapSpecialty('Adult Critical Care')).toMatchObject({ key: 'critical care' })
  })
})

describe('Sol R4 — compound provider titles, provider plurals, scoped adult marker, reversed caps', () => {
  it('compound provider titles resolve to np/pa cells, never physician cells', () => {
    expect(mapSpecialty('Emergency Medicine Physician Assistant').key).toBe('np/pa (emergency)')
    expect(mapSpecialty('Cardiology Physician Assistant').key).toBe('np/pa (specialty)')
    const r = parseFreetextInput('emergency medicine physician assistant position')
    expect(r.specialty).toMatchObject({ key: 'np/pa (emergency)' })
  })

  it('technician/clinician are not physician-role evidence', () => {
    expect(parseFreetextInput('crna with anesthesia technician support').specialty).toMatchObject({ key: 'crna' })
  })

  it('provider plurals keep provider identity (NPs/PAs/APRNs)', () => {
    expect(mapSpecialty('NPs Psychiatry').key).toBe('np/pa (psychiatry)')
    expect(mapSpecialty('PAs Emergency Medicine').key).toBe('np/pa (emergency)')
    expect(parseFreetextInput('nps psychiatry in ohio').specialty).toMatchObject({ key: 'np/pa (psychiatry)' })
  })

  it('requirement-side adult (ACLS etc.) does not cancel pediatric evidence', () => {
    const r = parseFreetextInput("children's hospital needs icu coverage adult acls certification required")
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care' })
  })

  it('population-side adult still defeats the pediatric merge (R3 pin holds)', () => {
    const r = parseFreetextInput('adult critical care physician covering pediatric consults')
    expect(r.specialty).toMatchObject({ key: 'critical care' })
  })

  it('reversed cap phrases stay metadata', () => {
    expect(parseFreetextInput('cap of 18 patients in ohio').specialty).toBeNull()
    expect(parseFreetextInput('hospitalist coverage cap of 18 patients').specialty).toMatchObject({ key: 'hospitalist' })
  })
})

describe('Sol R5 — adjacency, person-form vocabulary, adult span, cap-strip boundary', () => {
  it('conjunction-separated roles never fabricate a compound title (escalate)', () => {
    expect(parseFreetextInput('emergency medicine physician and assistant coverage').specialty).toBeNull()
  })

  it('geriatrician/internist count as physician roles in mixed-role phrases', () => {
    expect(parseFreetextInput('geriatrician supervising np coverage').specialty).toBeNull()
    expect(parseFreetextInput('geriatrician supervising crna coverage').specialty).toBeNull()
  })

  it('adult-only / adult population still defeat the pediatric merge', () => {
    expect(
      parseFreetextInput("children's hospital needs adult-only critical care coverage").specialty,
    ).toMatchObject({ key: 'critical care' })
    expect(parseFreetextInput('adult population critical care coverage').specialty).toMatchObject({
      key: 'critical care',
    })
  })

  it('CAP before a hyphenated facility descriptor stays the child-psychiatry specialty', () => {
    const r = parseFreetextInput('CAP at 18-bed inpatient psychiatric facility in Ohio')
    expect(r.specialty).toMatchObject({ key: 'child psychiatry' })
  })
})

describe('Sol R6 — field adjacency, supervision verbs, credential spans, hyphenated caps', () => {
  it('field path requires adjacency for multiword provider titles', () => {
    expect(mapSpecialty('Emergency Medicine Physician and Assistant')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Emergency Medicine Physician Assistant').key).toBe('np/pa (emergency)') // pin holds
  })

  it('supervision verbs mark mixed roles (title juxtaposition still fuses)', () => {
    expect(parseFreetextInput('hospitalist supervising nps coverage').specialty).toBeNull()
    expect(parseFreetextInput('intensivist leading np team coverage').specialty).toBeNull()
    expect(parseFreetextInput('hospitalist np in ohio').specialty).toMatchObject({ key: 'np/pa (hospitalist)' }) // pin holds
  })

  it('adult-and-pediatric credential phrases do not erase pediatric evidence', () => {
    const r = parseFreetextInput("children's hospital needs icu coverage requiring adult and pediatric cpr certification")
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care' })
  })

  it('hyphenated cap qualifiers stay metadata; unqualified CAP stays the specialty', () => {
    expect(parseFreetextInput('patient-cap at 18-bed inpatient psychiatric facility').specialty).toMatchObject({
      key: 'psychiatry',
    })
    expect(parseFreetextInput('CAP at 18-bed inpatient psychiatric facility in Ohio').specialty).toMatchObject({
      key: 'child psychiatry',
    }) // pin holds
  })
})

describe('Sol R7 — supervised PA, credential precedence, bed counts, multi-family providers', () => {
  it('a supervision verb makes bare pa provider evidence (blocks, never Pennsylvania)', () => {
    expect(parseFreetextInput('hospitalist supervising pa coverage in ohio').specialty).toBeNull()
    expect(parseFreetextInput('hospitalist in pa').specialty).toMatchObject({ key: 'hospitalist' }) // pin holds
  })

  it('direct clinical adjacency beats credential lookahead for the adult marker', () => {
    const r = parseFreetextInput("children's hospital adult critical care unit acls certification required")
    expect(r.specialty).toMatchObject({ key: 'critical care' })
    const r2 = parseFreetextInput("children's hospital needs icu coverage requiring adult and pediatric cpr certification")
    expect(r2.specialty).toMatchObject({ key: 'pediatric critical care' }) // R6 pin holds
  })

  it('space-separated bed counts do not strip the CAP specialty', () => {
    expect(parseFreetextInput('CAP at 18 bed inpatient psychiatric facility in Ohio').specialty).toMatchObject({
      key: 'child psychiatry',
    })
    expect(parseFreetextInput('cap of 18 patients in ohio').specialty).toBeNull() // R5 pin holds
  })

  it('multiple provider families escalate; credential decorations do not', () => {
    expect(mapSpecialty('CRNA/CAA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('NP and CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('CRNA, APRN').key).toBe('crna') // credential listing is not a second family
  })
})

describe('Sol R8 — freetext credentials, credential-vs-adjacency precedence, provider conflicts', () => {
  it('NP credentials resolve to np/pa cells through FREETEXT too', () => {
    expect(parseFreetextInput('aprn psychiatry in ohio').specialty).toMatchObject({ key: 'np/pa (psychiatry)' })
    expect(parseFreetextInput('pmhnp psychiatry in ohio').specialty).toMatchObject({ key: 'np/pa (psychiatry)' })
    expect(parseFreetextInput('fnp opening in dallas').specialty).toMatchObject({ key: 'np/pa (primary care)' })
  })

  it('direct clinical adjacency beats credential lookahead WITHOUT a spacer word', () => {
    const r = parseFreetextInput("children's hospital adult critical care acls certification required in ohio")
    expect(r.specialty).toMatchObject({ key: 'critical care' })
  })

  it('conflicting provider families/axes escalate; credential decorations do not', () => {
    expect(mapSpecialty('CRNA and PMHNP')).toMatchObject(ESCALATE)
    expect(mapSpecialty('CAA/NNP')).toMatchObject(ESCALATE)
    expect(mapSpecialty('NP emergency and psychiatry')).toMatchObject(ESCALATE)
    expect(mapSpecialty('CRNA, APRN').key).toBe('crna') // pin holds
    expect(mapSpecialty('Psychiatry - PMHNP').key).toBe('np/pa (psychiatry)') // pin holds
  })
})

describe('Sol R9 — freetext provider conflicts, credential plurals/phrases, multi-credential cells', () => {
  it('freetext provider windows run the shared conflict/axis classifier', () => {
    expect(parseFreetextInput('crna and pmhnp in ohio').specialty).toBeNull()
    expect(parseFreetextInput('np emergency and psychiatry in ohio').specialty).toBeNull()
    expect(parseFreetextInput('aprn cardiology in ohio').specialty).toMatchObject({ key: 'np/pa (specialty)' })
    expect(parseFreetextInput('pmhnp psychiatry in ohio').specialty).toMatchObject({ key: 'np/pa (psychiatry)' }) // pin holds
    expect(parseFreetextInput('crna emergency department coverage').specialty).toMatchObject({ key: 'crna' }) // pin holds
    expect(parseFreetextInput('hospitalist np in ohio').specialty).toMatchObject({ key: 'np/pa (hospitalist)' }) // pin holds
  })

  it('short credential plurals keep provider identity', () => {
    expect(mapSpecialty('FNPs Primary Care').key).toBe('np/pa (primary care)')
    expect(mapSpecialty('NNPs Neonatology').key).toBe('np/pa (neonatology)')
  })

  it('expanded life-support credentials are metadata, not adult population evidence', () => {
    const r = parseFreetextInput(
      "children's hospital needs icu coverage requiring adult and pediatric advanced life support certification",
    )
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care' })
  })

  it('competing credential-implied cells escalate; same-cell combos do not', () => {
    expect(mapSpecialty('FNP and PMHNP')).toMatchObject(ESCALATE)
    expect(mapSpecialty('NNP and PMHNP')).toMatchObject(ESCALATE)
    expect(mapSpecialty('ACNP/AGACNP').key).toBe('np/pa (specialty)') // same cell — no conflict
  })
})

describe('Sol R11 — unconsumed physician beside a provider marker escalates', () => {
  it('Physician/PA and Physician-or-PA coordination escalates; the contiguous title resolves', () => {
    expect(mapSpecialty('Emergency Medicine Physician/PA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Emergency Medicine Physician or PA')).toMatchObject(ESCALATE)
    expect(parseFreetextInput('emergency medicine physician or pa coverage').specialty).toBeNull()
    expect(mapSpecialty('Emergency Medicine Physician Assistant').key).toBe('np/pa (emergency)') // pin holds
    expect(mapSpecialty('Physician Assistant - Psychiatry').key).toBe('np/pa (psychiatry)')
  })

  it('plural Doctors coordination escalates too (R12)', () => {
    expect(mapSpecialty('Emergency Medicine Doctors/PAs')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Doctors/CRNA')).toMatchObject(ESCALATE)
  })

  it('MD/DO labels are physician-role evidence beside a provider (R13)', () => {
    expect(mapSpecialty('MD/CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('DO/CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('MDs/CRNAs')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Emergency Medicine MD/PA')).toMatchObject(ESCALATE)
    expect(parseFreetextInput('md and crna coverage in ohio').specialty).toBeNull()
    expect(mapSpecialty('Emergency Medicine MD').key).toBe('emergency medicine') // single role stays priced
  })

  it('punctuated/abbreviated physician labels coordinate exactly like MD/DO (R14)', () => {
    expect(mapSpecialty('M.D./CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('D.O./CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('M.D.s/CRNAs')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Emergency Medicine D.O./PA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Dr./PA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Drs./PAs')).toMatchObject(ESCALATE)
    expect(mapSpecialty('CRNA and MD')).toMatchObject(ESCALATE) // field path keeps the coordinator word
    expect(parseFreetextInput('need an m.d./crna in tx').specialty).toBeNull()
  })

  it('MD-the-state and credential suffixes are NOT role coordination (R14)', () => {
    const inMd = parseFreetextInput('crna in md')
    expect(inMd.specialty?.key).toBe('crna')
    expect(inMd.state?.code).toBe('MD')
    const paInMd = parseFreetextInput('physician assistant in md')
    expect(paInMd.specialty?.key).toBe('np/pa (primary care)')
    expect(paInMd.state?.code).toBe('MD')
    // a person's credential suffix away from the provider marker stays priced
    expect(parseFreetextInput('crna coverage contact john smith md').specialty?.key).toBe('crna')
  })

  it('coordinator runs, role-axis gaps, and apostrophe plurals coordinate too (R15)', () => {
    expect(mapSpecialty('MD and/or CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('MD/Emergency Medicine PA')).toMatchObject(ESCALATE)
    expect(mapSpecialty("M.D.'s/CRNAs")).toMatchObject(ESCALATE)
    expect(mapSpecialty("MD's/CRNAs")).toMatchObject(ESCALATE)
  })

  it('honorifics and non-terminal md-compounds do NOT read as coordination (R15)', () => {
    // 'dr' beside a NAME is an honorific, not a second priced role
    expect(parseFreetextInput('crna coverage contact dr john smith').specialty?.key).toBe('crna')
    expect(mapSpecialty('Dr. Smith - CRNA').key).toBe('crna')
    // terminal 'in md' + duration keeps Maryland
    const dur = parseFreetextInput('crna in md 8 weeks')
    expect(dur.specialty?.key).toBe('crna')
    expect(dur.state?.code).toBe('MD')
    // non-terminal 'in md-…' skips the Maryland rewrite AND the attached
    // 'led' suppresses coordination — quote survives, live parity (state md
    // stays today-parity from the lone-token state pass)
    expect(parseFreetextInput('crna in md-led care team').specialty?.key).toBe('crna')
    // 'near md <name>' falls through to the token path: name breaks the
    // coordination walk, so the quote survives (state = today-parity md)
    expect(parseFreetextInput('crna near md anderson').specialty?.key).toBe('crna')
  })

  it('coordination survives count syntax and phrase coordinators (R16)', () => {
    expect(mapSpecialty('1 MD / 2 CRNAs')).toMatchObject(ESCALATE)
    expect(mapSpecialty('MD as well as CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('MD and also CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('M.  D./CRNA')).toMatchObject(ESCALATE) // multi-space dotted OCR form
  })

  it('attached names/facilities and possessives suppress coordination (R16)', () => {
    // trailing facility name after the credential: the PA cell keeps quoting
    expect(mapSpecialty('PA - Emergency Medicine Department - MD Anderson').key).toBe('np/pa (emergency)')
    // preposed honorific bound to a name keeps quoting
    expect(parseFreetextInput('crna for dr john smith').specialty?.key).toBe('crna')
    // possessive md ("md's office") never takes the Maryland rewrite; the
    // credential lands beside the provider and escalates — the SAFE direction
    // (live priced crna + a fabricated MD state here)
    expect(parseFreetextInput("crna in md's office").specialty).toBeNull()
    // 'for <duration>' keeps the Maryland reading
    const forDur = parseFreetextInput('crna in md for 8 weeks')
    expect(forDur.specialty?.key).toBe('crna')
    expect(forDur.state?.code).toBe('MD')
  })

  it('ordinary role descriptors cannot hide an explicit two-role request (R17)', () => {
    expect(mapSpecialty('MD and experienced CRNAs both needed for coverage')).toMatchObject(ESCALATE)
    expect(parseFreetextInput('md and experienced crnas both needed for coverage').specialty).toBeNull()
  })

  it('articles are grammatical glue, not name evidence, in the field path (R18)', () => {
    expect(mapSpecialty('MD and an experienced CRNA both needed for coverage')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Both an MD and a CRNA are needed')).toMatchObject(ESCALATE)
    expect(parseFreetextInput('md and an experienced crna both needed').specialty).toBeNull()
  })

  it("'along with' coordinates; bare 'with' does not (R19)", () => {
    expect(mapSpecialty('Coverage requires an MD along with a CRNA')).toMatchObject(ESCALATE)
    expect(parseFreetextInput('coverage requires an md along with a crna').specialty).toBeNull()
    // supervised single-role postings keep quoting: 'with' alone is not
    // coordination in the field path
    expect(mapSpecialty('CRNA with MD supervision').key).toBe('crna')
  })

  it('supervision the NOUN is an arrangement, not a second role (R20)', () => {
    expect(parseFreetextInput('crna with md supervision').specialty?.key).toBe('crna')
    expect(parseFreetextInput('np coverage, md supervision provided').specialty?.key).toBe('np/pa (primary care)')
    // active verb forms still mark mixed roles
    expect(parseFreetextInput('md supervising crna coverage').specialty).toBeNull()
    expect(parseFreetextInput('hospitalist supervising nps coverage').specialty).toBeNull() // R6 pin holds
  })

  it("a verb describing the provider's OWN duties keeps quoting (R21)", () => {
    const duties = parseFreetextInput('np manages primary-care patients in ohio')
    expect(duties.specialty?.key).toBe('np/pa (primary care)')
    expect(duties.state?.code).toBe('OH')
    expect(parseFreetextInput('crna managing anesthesia cases').specialty?.key).toBe('crna')
    // positional mixed-role forms still escalate (person-role opposite a provider)
    expect(parseFreetextInput('hospitalist supervising pa coverage in ohio').specialty).toBeNull() // R7 pin holds
  })

  it('PA followed by a licensure word is the state, not the provider (R26)', () => {
    const lic = parseFreetextInput('pa-licensed and board-certified hospitalist needed')
    expect(lic.specialty?.key).toBe('hospitalist')
    expect(lic.state?.code).toBe('PA')
    const req = parseFreetextInput('pa license required, hospitalist needed')
    expect(req.specialty?.key).toBe('hospitalist')
    expect(req.state?.code).toBe('PA')
    // the reverse order stays a provider: true coordination escalates
    expect(parseFreetextInput('hospitalist and licensed pa needed').specialty).toBeNull()
  })

  it('the licensure shield holds on every provider-evidence path (R27)', () => {
    // person-form roleContext must not re-enable a shielded pa
    const anes = parseFreetextInput('pa license required, anesthesiologist needed')
    expect(anes.specialty?.key).toBe('anesthesiology')
    expect(anes.state?.code).toBe('PA')
    // genuinely mixed roles stay escalated even with a shielded pa present
    expect(parseFreetextInput('pa-licensed hospitalist supervising nps').specialty).toBeNull()
  })

  it('the shield also covers the whole-field provider classifier (R28)', () => {
    const fwd = parseFreetextInput('pa license required, crna needed')
    expect(fwd.specialty?.key).toBe('crna')
    expect(fwd.state?.code).toBe('PA')
    const rev = parseFreetextInput('crna needed, pa license required')
    expect(rev.specialty?.key).toBe('crna')
    expect(rev.state?.code).toBe('PA')
    expect(parseFreetextInput('crna/pa coverage').specialty).toBeNull() // true mix holds
  })

  it("comma role lists with 'both' evidence escalate; comma locations survive (R29)", () => {
    expect(parseFreetextInput('crna, pa both needed for coverage').specialty).toBeNull()
    const loc = parseFreetextInput('crna in pittsburgh, pa')
    expect(loc.specialty?.key).toBe('crna')
    expect(loc.state?.code).toBe('PA')
    expect(loc.city?.city).toBe('pittsburgh')
    // semicolon form exercises the fieldFold shield without the comma path
    const semi = parseFreetextInput('crna needed; pa license required')
    expect(semi.specialty?.key).toBe('crna')
    expect(semi.state?.code).toBe('PA')
  })

  it('auxiliary both-forms are role lists too (R31)', () => {
    expect(parseFreetextInput('crna, md are both needed for coverage').specialty).toBeNull()
    expect(parseFreetextInput('crna, pa both are needed').specialty).toBeNull()
  })

  it('spelled-out ACNP/AGACNP titles land on the specialty cell (R34)', () => {
    expect(mapSpecialty('Acute Care Nurse Practitioner').key).toBe('np/pa (specialty)')
    expect(mapSpecialty('Adult-Gerontology Acute Care Nurse Practitioner').key).toBe('np/pa (specialty)')
    const ft = parseFreetextInput('acute care nurse practitioner needed in ohio')
    expect(ft.specialty?.key).toBe('np/pa (specialty)')
    expect(ft.state?.code).toBe('OH')
    expect(mapSpecialty('ACNP').key).toBe('np/pa (specialty)') // abbreviation control holds
  })

  it('an explicit job axis beats the acute-title fallback (R35)', () => {
    expect(mapSpecialty('Acute Care Nurse Practitioner - Hospitalist').key).toBe('np/pa (hospitalist)')
    expect(mapSpecialty('ACNP - Hospitalist').key).toBe('np/pa (hospitalist)')
    expect(parseFreetextInput('acute care nurse practitioner hospitalist coverage').specialty?.key).toBe('np/pa (hospitalist)')
  })

  it('a role-list comma carries coordination into physician windows too (R32)', () => {
    expect(parseFreetextInput('hospitalist, pa are both needed for coverage').specialty).toBeNull()
    // physician specialty + generic MD credential is ONE role (an
    // anesthesiologist IS an MD) — matches the 'Emergency Medicine MD'
    // precedent, never a second priced cell
    expect(parseFreetextInput('anesthesiologist, md both needed').specialty?.key).toBe('anesthesiology')
  })

  it('counted roles before a City, PA location keep their geography (R33)', () => {
    const phl = parseFreetextInput('two hospitalists in philadelphia, pa are both needed for coverage')
    expect(phl.specialty?.key).toBe('hospitalist')
    expect(phl.state?.code).toBe('PA')
    expect(phl.city?.city).toBe('philadelphia')
    const pit = parseFreetextInput('two crnas in pittsburgh, pa are both needed')
    expect(pit.specialty?.key).toBe('crna')
    expect(pit.state?.code).toBe('PA')
  })

  it("shift-'both' never flips a comma location into a role list (R30)", () => {
    const phl = parseFreetextInput('in philadelphia, pa hospitalist needed for both day and night shifts')
    expect(phl.specialty?.key).toBe('hospitalist')
    expect(phl.state?.code).toBe('PA')
    const pit = parseFreetextInput('crna in pittsburgh, pa both day and night shifts')
    expect(pit.specialty?.key).toBe('crna')
    expect(pit.state?.code).toBe('PA')
  })

  it('coordination survives articles and known descriptors in the gap (R25)', () => {
    expect(parseFreetextInput('a hospitalist and a nurse practitioner are needed in ohio').specialty).toBeNull()
    expect(parseFreetextInput('hospitalists and experienced nps needed in ohio').specialty).toBeNull()
    expect(parseFreetextInput('hospitalists and experienced pas needed in ohio').specialty).toBeNull()
  })

  it('spelled-out coordinated titles and &-coordination escalate; fusion holds (R24)', () => {
    expect(parseFreetextInput('hospitalists and nurse practitioners needed in ohio').specialty).toBeNull()
    expect(parseFreetextInput('hospitalists and physician assistants needed').specialty).toBeNull()
    expect(parseFreetextInput('hospitalists & nps needed in ohio').specialty).toBeNull()
    // no coordinator → the title keeps fusing
    expect(parseFreetextInput('hospitalist nurse practitioner in ohio').specialty?.key).toBe('np/pa (hospitalist)')
  })

  it('an elided coordinator beside pa is role evidence; direct-hire is not a verb (R23)', () => {
    expect(parseFreetextInput('hospitalists and pas needed in ohio').specialty).toBeNull()
    expect(parseFreetextInput('hospitalist in pa').specialty?.key).toBe('hospitalist') // R7 pin holds
    expect(mapSpecialty('Hospitalist PA').key).toBe('np/pa (hospitalist)') // R10 title fusion holds
    const hire = parseFreetextInput('np direct hire for a hospitalist position in tx')
    expect(hire.specialty?.key).toBe('np/pa (hospitalist)')
    expect(hire.state?.code).toBe('TX')
    expect(parseFreetextInput('hospitalist to direct np coverage').specialty).toBeNull()
  })

  it('base-form verbs mark mixed roles positionally too (R22)', () => {
    expect(parseFreetextInput('hospitalists manage nps coverage').specialty).toBeNull()
    expect(parseFreetextInput('hospitalist to manage np coverage').specialty).toBeNull()
    // base forms in single-role postings have no person-role counterpart
    const will = parseFreetextInput('np will manage primary-care patients in ohio')
    expect(will.specialty?.key).toBe('np/pa (primary care)')
    expect(parseFreetextInput('lead crna position in tx').specialty?.key).toBe('crna')
    expect(parseFreetextInput('crna direct hire in tx').specialty?.key).toBe('crna')
  })

  it('prepositional PA is Pennsylvania, not a second provider family (R17)', () => {
    const inPa = parseFreetextInput('crna in pa')
    expect(inPa.specialty?.key).toBe('crna')
    expect(inPa.state?.code).toBe('PA')
    const nearPa = parseFreetextInput('caa near pa')
    expect(nearPa.specialty?.key).toBe('anesthesiologist assistant')
    expect(nearPa.state?.code).toBe('PA')
    const paInPa = parseFreetextInput('physician assistant in pa')
    expect(paInPa.specialty?.key).toBe('np/pa (primary care)')
    expect(paInPa.state?.code).toBe('PA')
    // Idaho path was already correct — pinned so it stays that way
    const inId = parseFreetextInput('crna in id')
    expect(inId.specialty?.key).toBe('crna')
    expect(inId.state?.code).toBe('ID')
    // true CRNA/PA coordination still escalates
    expect(parseFreetextInput('crna/pa coverage').specialty).toBeNull()
  })
})

describe('Sol R10 — coordinated physician/provider roles escalate', () => {
  it('a fully-named physician cell beside a provider marker is a conflict', () => {
    expect(mapSpecialty('Anesthesiologist/CRNA')).toMatchObject(ESCALATE)
    expect(mapSpecialty('Hospitalist/CRNA')).toMatchObject(ESCALATE)
    expect(parseFreetextInput('anesthesiology and crna coverage').specialty).toBeNull()
  })

  it('cell-axis phrases are NOT conflicts (title/credential fusion pins hold)', () => {
    expect(mapSpecialty('Emergency Medicine Physician Assistant').key).toBe('np/pa (emergency)')
    expect(mapSpecialty('Family Medicine - FNP').key).toBe('np/pa (primary care)')
    expect(mapSpecialty('Hospitalist PA').key).toBe('np/pa (hospitalist)')
    expect(mapSpecialty('Critical Care NP').key).toBe('np/pa (specialty)')
  })
})

describe('Sol R2 — routine supported forms keep quoting (zero-new-escalation guard)', () => {
  const cases: Array<[string, string]> = [
    ['Pulmonary Disease', 'pulmonology'],
    ['Pulmonary Medicine', 'pulmonology'],
    ['Emergency Medicine Physicians Needed', 'emergency medicine'],
    ['Hospitalists', 'hospitalist'], // vocabulary-aware plural fold
    ['CRNAs', 'crna'],
    ['Intensivists', 'critical care'],
    ['Cardiology - Electrophysiology', 'electrophysiology'], // curated alias kills the 2-key tie
  ]
  for (const [raw, key] of cases) {
    it(`quotes "${raw}" → ${key}`, () => {
      expect(mapSpecialty(raw).key).toBe(key)
    })
  }
})

describe('Sol R2 — provider credentials resolve to np/pa cells, typos escalate', () => {
  const cases: Array<[string, string]> = [
    ['Family Medicine - FNP', 'np/pa (primary care)'],
    ['Psychiatry - PMHNP', 'np/pa (psychiatry)'],
    ['PMHNP', 'np/pa (psychiatry)'],
    ['NNP', 'np/pa (neonatology)'],
    ['ACNP', 'np/pa (specialty)'],
    ['APRN - Cardiology', 'np/pa (specialty)'],
  ]
  for (const [raw, key] of cases) {
    it(`routes "${raw}" → ${key}`, () => {
      expect(mapSpecialty(raw).key).toBe(key)
    })
  }

  it('a Lev-1 specialty typo on the provider axis escalates ("Cardiolgy NP")', () => {
    expect(mapSpecialty('Cardiolgy NP')).toMatchObject(ESCALATE)
  })

  it('CNM (no midwifery cell) escalates rather than guessing a cell', () => {
    expect(mapSpecialty('CNM')).toMatchObject(ESCALATE)
  })
})

describe('Sol R2 — whole-field upgrade is bounded; merge semantics are pinned', () => {
  // MERGE SEMANTICS (documented Sol R2 F3 partial-adoption): when a freetext
  // names BOTH a base cell and a family modifier that our taxonomy prices as
  // one intersection cell (critical care + pediatric → pediatric critical
  // care), the resolver quotes the intersection — this is the SAME §2.3
  // upgrade that routes the spec-pinned children's-hospital case, and the two
  // shapes are formally indistinguishable to a token model. When NO
  // intersection cell exists, the mutual compatible-alternative discard
  // escalates instead (next test). Upgrade FUEL is bounded to pre-window +
  // adjacent-post tokens as extra conservatism.
  it('pediatric mention beside critical care merges to the intersection cell', () => {
    const r = parseFreetextInput('critical care in Dallas, TX occasional pediatric patients')
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care' })
    expect(r.state?.code).toBe('TX')
  })

  it('two cells with NO intersection cell mutually discard → escalate (the ambiguity hatch)', () => {
    const r = parseFreetextInput('icu unit in dallas serving pediatric patients')
    // 'icu' window is discarded by the 'pediatric' alternative and vice versa;
    // the icu ALIAS cannot inject target tokens, so no merge is reachable here.
    expect(r.specialty).toBeNull()
  })

  it("children's-hospital pre-modifier upgrade still works (pinned corpus case)", () => {
    const r = parseFreetextInput("children's hospital needs icu coverage")
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care' })
  })
})

// =============================================================================
// §3 identity suites — auto-generated over the live tables. Every key resolves
// to itself and every alias to its target, as exact ('pdf') matches, through
// BOTH resolvers. This is the table-driven parity floor.
// =============================================================================

describe('identity — every SPECIALTIES key maps to itself', () => {
  for (const key of Object.keys(SPECIALTIES)) {
    it(`mapSpecialty("${key}") → itself (pdf)`, () => {
      expect(mapSpecialty(key)).toMatchObject({ key, source: 'pdf' })
    })
    it(`fuzzyMatchSpecialty("${key}") → itself (exact)`, () => {
      expect(fuzzyMatchSpecialty(key)).toMatchObject({ key, matchKind: 'exact' })
    })
  }
})

describe('identity — every SPECIALTY_ALIASES entry maps to its target', () => {
  for (const [alias, target] of Object.entries(SPECIALTY_ALIASES)) {
    it(`mapSpecialty("${alias}") → ${target} (pdf)`, () => {
      expect(mapSpecialty(alias)).toMatchObject({ key: target, source: 'pdf' })
    })
    it(`fuzzyMatchSpecialty("${alias}") → ${target} (exact)`, () => {
      expect(fuzzyMatchSpecialty(alias)).toMatchObject({ key: target, matchKind: 'exact' })
    })
  }
})

// =============================================================================
// Phrase path (fuzzyMatchSpecialty) — golden-pinned shorthands + the enumerated
// np/pa flip + full-consumption semantics.
// =============================================================================

describe('phrase resolve — golden-master parity pins', () => {
  it('prefix shorthands stay routed with matchKind substring (golden fuzzy-spec pins)', () => {
    expect(fuzzyMatchSpecialty('anes')).toMatchObject({ key: 'anesthesiology', matchKind: 'substring' })
    expect(fuzzyMatchSpecialty('anesth')).toMatchObject({ key: 'anesthesiology', matchKind: 'substring' })
    expect(fuzzyMatchSpecialty('cardio')).toMatchObject({ key: 'cardiology', matchKind: 'substring' })
    expect(fuzzyMatchSpecialty('gastro')).toMatchObject({ key: 'gastroenterology', matchKind: 'substring' })
  })

  it('nonsense stays null', () => {
    expect(fuzzyMatchSpecialty('xyz')).toBeNull()
    expect(fuzzyMatchSpecialty('')).toBeNull()
  })

  it('ENUMERATED FLIP #1 — np/pa: shortest-key artifact → primary care (Zach-approved wrong→right)', () => {
    expect(fuzzyMatchSpecialty('np/pa')).toMatchObject({ key: 'np/pa (primary care)', matchKind: 'substring' })
  })

  it('full consumption only: a phrase with unconsumable tokens does NOT match', () => {
    expect(fuzzyMatchSpecialty('crna dallas tx')).toBeNull() // subset direction would swallow city/state
    expect(fuzzyMatchSpecialty('radiation oncology')).toBeNull()
  })

  it('upgrade rule works in the phrase path', () => {
    expect(fuzzyMatchSpecialty('pediatric icu')).toMatchObject({ key: 'pediatric critical care', matchKind: 'substring' })
  })
})

// =============================================================================
// Freetext window path (parser) — exact token-set equality + whole-field guard.
// =============================================================================

describe('freetext — precise consumption preserves location extraction (golden parse parity)', () => {
  it('CRNA in Dallas TX nights — the golden case stays byte-stable', () => {
    const r = parseFreetextInput('CRNA in Dallas TX nights')
    expect(r.specialty).toMatchObject({ key: 'crna', matchKind: 'exact' })
    expect(r.state?.code).toBe('TX')
    expect(r.city?.city).toBe('dallas')
    expect(r.shift).toBe('night')
    expect(r.corrections).toEqual([])
  })

  it('general surgery rural critical access wyoming — bare "critical" (no "care") does not block', () => {
    const r = parseFreetextInput('general surgery rural critical access wyoming')
    expect(r.specialty).toMatchObject({ key: 'general surgery', matchKind: 'exact' })
    expect(r.state?.code).toBe('WY')
  })

  it('Emergency Medicine California weekend — parity', () => {
    const r = parseFreetextInput('Emergency Medicine California weekend')
    expect(r.specialty).toMatchObject({ key: 'emergency medicine', matchKind: 'exact' })
    expect(r.state?.code).toBe('CA')
  })

  it('hospitalist in pa — two-letter alias tokens (state-ambiguous) never block or fuse in freetext', () => {
    const r = parseFreetextInput('hospitalist in pa')
    expect(r.specialty).toMatchObject({ key: 'hospitalist' })
    expect(r.state?.code).toBe('PA')
  })

  it('CRNA cardiovascular surgery — non-taxonomy decoration neither blocks nor fuses (facility-suite parity)', () => {
    const r = parseFreetextInput('CRNA cardiovascular surgery')
    expect(r.specialty).toMatchObject({ key: 'crna' })
  })

  it('rate-cap jargon never reaches the specialty stream (cap ≠ child psychiatry)', () => {
    const r = parseFreetextInput('ob/gyn locum in new york, rate cap of $300/hr')
    expect(r.specialty).toMatchObject({ key: 'ob/gyn', matchKind: 'exact' }) // golden parse parity
    const r2 = parseFreetextInput('hospitalist rate cap 250 in ohio')
    expect(r2.specialty).toMatchObject({ key: 'hospitalist' })
    expect(r2.state?.code).toBe('OH')
  })
})

describe('freetext — whole-field modifier guard + window upgrade (red-team cases)', () => {
  it('right-side modifier discards the window: "oncology - radiation therapy" → no specialty', () => {
    const r = parseFreetextInput('oncology - radiation therapy')
    expect(r.specialty).toBeNull()
    expect(buildParsedFromFreetext('oncology - radiation therapy')).toBeNull()
  })

  it("children's hospital needs icu coverage → pediatric critical care (fold + upgrade)", () => {
    const r = parseFreetextInput("children's hospital needs icu coverage")
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care' })
  })

  it('pediatric icu in miami → pediatric critical care with a correction, city preserved', () => {
    const r = parseFreetextInput('pediatric icu in miami')
    expect(r.specialty).toMatchObject({ key: 'pediatric critical care', matchKind: 'substring' })
    expect(r.corrections).toContainEqual({ field: 'specialty', from: 'pediatric icu', to: 'pediatric critical care' })
    expect(r.city?.city).toBe('miami')
  })
})

// =============================================================================
// Escalation must survive refinement (the refine-hijack fix — live-today bug).
// =============================================================================

describe('refine-hijack — source:default must never be refined into a confident quote', () => {
  const icuContext: ParsedAssignment = {
    assignmentNumber: '',
    specialty: 'Radiation Oncology',
    status: '',
    hco: '',
    startDate: '',
    endDate: '',
    facilities: [],
    sections: [{ title: 'Details', items: [{ label: 'Schedule', value: 'ICU coverage, intensivist support' }] }],
    notes: 'micu and sicu rotation',
    _rawText: 'Radiation Oncology posting. micu sicu intensivist.',
  }

  it('an escalated unknown specialty with ICU-mentioning text STAYS escalated through initFactors', () => {
    const f = initFactors(icuContext)
    expect(f.specialty).toMatchObject(ESCALATE) // NOT critical care
  })

  it('refineSpecialtyFromContext still refines NON-default internal medicine in ICU context (parity)', () => {
    const im = refineSpecialtyFromContext({ key: 'internal medicine', source: 'pdf' }, icuContext)
    expect(im).toMatchObject({ key: 'critical care', source: 'inferred' })
  })
})
