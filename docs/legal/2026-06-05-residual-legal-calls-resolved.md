# Residual Legal Judgment Calls — RESOLVED (2026-06-05)

**Scope:** the 5 residual attorney-judgment items left open on `/privacy`, `/terms`, `/cookies`
(`LEGAL_CONTENT` in `src/components/sections/LegalPage.astro`), carried over from
`2026-06-02-legal-research-findings.md` and `2026-06-03-residual-legal-research.md`.

**How resolved:** Zach delegated these calls ("do your own due diligence and make the
judgment calls"). Researched against primary sources (TX statutes, 13 CFR, 45 CFR, HHS,
2025 case law, SBA tables). **Not legal advice** — well-researched best-judgment; the one
item that still benefits from a licensed-TX-attorney glance is flagged.

## Outcome: NO live-copy changes required. 4 of 5 finalizable now; item 1 = light attorney glance.

| # | Item | Call | Attorney sign-off still needed? |
|---|------|------|-------------------------------|
| 1 | Liability cap ($100 floor, ALL-CAPS, express-negligence) | **Keep as-is. Keep $100 (NOT $250).** | Light — inherent "a court decides enforceability" caveat; drafting is correct |
| 2 | Retention (~4yr base + 18/24-mo sub-windows) | **Keep as-is** — already the corrected, statute-grounded copy | No |
| 3 | Arbitration clause | **Keep OFF the website** | No (for the website) |
| 4 | HIPAA posture ("generally not CE/BA, no PHI via site") | **Keep as-is** (keep the "generally" hedge) | No |
| 5 | SBA small-business size (TDPSA exemption) | **Confirmed qualifies** — threshold $34.0M, IMS far below | No |

---

### 1 — Liability cap. KEEP AS-IS; keep $100.
Current copy caps aggregate liability at the greater of US$100 or fees paid in the prior 12
months, ALL-CAPS, reaching IMS's own ordinary negligence, carving out fraud/willful
misconduct/gross negligence/PI-or-death-by-negligence/anything non-excludable. This is the
correct construction: ALL-CAPS satisfies (over-satisfies) TX fair-notice/conspicuousness
(*Dresser Indus. v. Page Petroleum*, 853 S.W.2d 505 (Tex. 1993); Tex. Bus. & Com. Code
§1.201(b)(10)); a **non-zero $100 floor** defeats the "$0 cap = no cap = full recovery"
attack and is the conventional floor (—$250 offers no enforceability gain, only more
downside); "fees only" (no floor) is inferior because site visitors pay $0; carve-outs are
complete. **Residual:** ultimate enforceability vs. a given plaintiff is fact-specific
(unconscionability), so a licensed TX attorney *should* glance — a final polish, not a blocker.

### 2 — Retention. KEEP AS-IS.
The live copy is already the corrected version (the earlier "+7yr per healthcare-staffing
norms" claim was removed 2026-06-03). Windows are statute-grounded: EEOC 1-yr floor (29 CFR
§1602.14, extended to final disposition on a charge); federal payroll/tax ~4yr; FLSA 3yr; I-9
later-of-3yr-after-hire/1yr-after-end (the **agency** owns the I-9 for its payroll workers);
TX's longest binding driver = **4-yr contract SOL** (Tex. Civ. Prac. & Rem. Code §16.004).
No federal mandate fixes a credentialing-file retention period for a staffing *intermediary*
(NCQA/CMS 36-mo re-cred cycles + state Medicaid 5–6yr bind the facility/provider, not IMS;
HIPAA's 6-yr doc rule binds CE/BAs, not IMS). "Anything longer = our own conservative policy"
framing is correct. **Real residual = operational:** confirm IMS actually *executes* the
deletions (a stated window that's never enforced is the risk, not the number).

### 3 — Arbitration. KEEP OFF the website.
A public, no-clickwrap site forms at most browsewrap → courts routinely refuse to enforce it
(2025 trend tightened: *Chabolla v. ClassPass*, 9th Cir. Feb 27 2025, refused even sign-in-wrap
arbitration). So a website arbitration clause would be legally inert (false confidence). And if
made enforceable via clickwrap, it exposes IMS to AAA mass-arbitration cost (May-2025 rules:
$8,125 initiation + ~$325/case) — wrong risk profile for a boutique firm with no consumer base.
TX Arbitration Act needs writing + mutual assent + consideration, which a browsed ToS lacks.
The existing State-of-Texas forum-selection + good-faith-first + 2-yr-limitations structure is
the correct enforceable approach. **Out-of-scope follow-up (not website):** any arbitration term
belongs in the signed clinician/facility placement contracts, where there's real assent.

### 4 — HIPAA. KEEP AS-IS.
Verified against 45 CFR 160.103: IMS is not a covered entity (not a plan/clearinghouse/
transacting provider) and not a business associate (credentialing data is about the *clinician*,
not patient PHI; a placed clinician is the *facility's* workforce). The "generally" hedge is
appropriate — keep it. **BA trigger (internal note, do NOT clutter the public page):** IMS
becomes a Business Associate — needing a signed BAA + HIPAA Security/Privacy/Breach compliance —
**the moment it creates/receives/maintains/transmits *patient* PHI on behalf of a covered-entity
facility** (e.g., handling patient charts/scheduling/billing/claims/QA for a facility through
its own systems). Holding clinician credentials does NOT trip it; touching patient PHI for the
facility does. If that ever happens, this notice must be rewritten.

### 5 — SBA size / TDPSA exemption. CONFIRMED.
Per **13 CFR §121.201**, the receipts-based size standard is **$34.0M** (5-yr avg) for BOTH
NAICS 561311 (Employment Placement Agencies) and 561320 (Temporary Help Services). A 2022-founded
boutique locum firm is orders of magnitude below → unambiguously a "small business" → TDPSA
small-business exempt (Tex. Bus. & Com. Code ch. 541). Keep the page free of the dollar figure
(self-updates). **Maintenance only:** SBA proposed a rule (Aug 22 2025, comments closed Oct 21
2025) raising 200+ receipts standards *upward* — would only widen IMS's headroom; re-check the
§121.201 table if/when it finalizes. Conclusion won't change for a boutique firm.

---

## Net
The live legal pages are in strong shape and require **no wording changes**. Items 2/3/4/5 are
final. Item 1 (liability cap) is the single item worth an eventual brief licensed-TX-attorney
eyeball — and even there the current ALL-CAPS / $100-floor / express-negligence drafting is the
recommended construction. Two standing operational watch-items: (a) actually execute the stated
retention deletions; (b) re-open the HIPAA notice + re-confirm the analysis only if IMS ever
begins handling patient PHI for a facility.
