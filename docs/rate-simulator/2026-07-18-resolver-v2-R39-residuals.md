# Resolver v2 — R39 SHIP-WITH-RESIDUALS: the accepted residuals register

Sol (GPT-5.6) adversarial gate, rounds R1–R39 (2026-07-13 → 2026-07-18): 39 rounds, 65
findings, every repro runtime-verified before and after its fix, all pinned in
`src/lib/rate-engine/__tests__/specialtyResolver.test.ts`. Final verdict R39:
**SHIP-WITH-RESIDUALS — no material findings**, with the twelve residuals below accepted
under the gate criteria (a defect = wrong PRICED result on a plausible phrasing, over-escalation
on a common phrasing, or a pin regression; everything below is safe-direction escalation,
today-parity, or long-tail vocabulary).

| # | Residual | Class |
|---|----------|-------|
| 1 | Unknown adjectives outside `ROLE_DESCRIPTORS` break the coordination walk ("MD and board-eligible CRNAs" prices the provider) | safe direction |
| 2 | Comma-form D.O.: `crna, d.o. coverage in ohio` prices crna+OH via the live comma cleanup (outcome identical to pre-resolver live) | today-parity |
| 3 | Bare spaced `M D/CRNA` not normalized (unpunctuated initials are name evidence; normalizing risks real names) | accepted risk |
| 4 | Possessive MD (`md's office`), bare `crna md`, and verb-`do` beside a provider over-escalate | safe direction |
| 5 | `near md anderson` state=MD and freetext `PA - Emergency Medicine` → EM + PA-state | today-parity |
| 6 | State codes other than md/pa are not pre-consumed after `in\|near` (they never block classification; the later state pass handles them) | by design |
| 7 | Stale-quote-after-escalation UI (today's null-parse UX) | deferred follow-up |
| 8 | Rare coordinators (`in addition to`, `coupled with`, `accompanied by`) and arrangement nouns (`oversight`, `direction`) | long tail |
| 9 | `np under physician supervision` escalates via the pre-existing person-form rule | safe direction |
| 10 | Past-participle supervision (`nps supervised by hospitalist` → np/pa (hospitalist)) — arguably the correct cell | accepted |
| 11 | Field-path `Hospitalists and PAs` fuses (field values are labels; the sentence form lives in freetext, which escalates) | by design |
| 12 | Comma-role-list permutations outside the covered plain/copular five-verb grammar (`will both be needed`, `both urgently needed`, other verbs/adverbs, role words outside the anchor list) | long tail |

Shipped to prod 2026-07-18: branch commits `9de85b4`+`6c0f8f7`+`fe8d9b9`+`87efbdb`+`7c6a12f`+
`843d929` → main `426ac5d..804558b`; served bundle `parser.BeO5AxPf.js` verified live.
Round-by-round history: memory topic `project_ims_r14_fix_writer_ident_despam_2026-07-16` and
the git log of this file's directory.
