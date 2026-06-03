# IMS legal pages — 2026-06-03 residual deep-research pass

**What this is.** A second, deeper research pass on the residual attorney-judgment items left after the
2026-06-02 rewrite (see [`2026-06-02-legal-research-findings.md`](./2026-06-02-legal-research-findings.md)),
plus a missing-clause audit. Method: a 14-agent workflow — 7 dimensions, each researched against
primary/secondary 2025–2026 sources, then **adversarially verified** by a second agent that tried to refute
the conclusion and re-checked the citations. **Engineering/communications work grounded in research — NOT
legal advice.**

Result: **4 of 7 dimensions yielded clear, safe copy fixes (applied 2026-06-03)**; **3 are genuine
attorney/founder judgment calls (surfaced below).**

> **🔭 UPDATE — 2026-06-03 (Zach's independent attorney-style review folded).** Zach ran our ChatGPT
> deep-research prompt and the result (a 11-page cited Texas-law review, saved to Downloads) **converged
> with this analysis** and supplied vetted clause language. We then folded the FULL set into LegalPage.astro:
> **the DRAFT / "under legal review" banner was REMOVED** (the reviewer's #1 call — a draft banner on live
> Terms undermines assent); the liability cap is now **ALL-CAPS, reaches IMS's own ordinary negligence, $100
> floor**; sale/share, retention (category-based, no 7-yr-statute claim), HIPAA ("generally"+no-PHI), and GDPR
> (US-intent) reframed; and we **ADDED** IP/anti-scraping, acceptable-use, suspension, third-party-links, a
> **2-year** limitations period (reviewer confirmed 1-yr is VOID per Tex. CPRC §16.070), a **narrow**
> misuse-indemnity, children's/COPPA, breach-notice, accessibility, Do-Not-Track, and general boilerplate.
> **Still licensed-counsel judgment calls:** keep arbitration OFF the public site (both analyses agree);
> exact cap floor ($100 vs $250); placed-clinician retention years (4/6/7); whether any future workflow makes
> IMS a HIPAA business associate; and re-checking the live SBA size-standard table if IMS nears the receipts
> cutoff. The pages are now presented as final (no DRAFT banner); these residual items are refinements, not blockers.

---

## ✅ Applied 2026-06-03 (safe accuracy fixes, folded into LegalPage.astro)

| # | Dimension | What changed | Why (cited) |
|---|---|---|---|
| 1 | **Liability cap** | `$0` → "greater of (a) fees paid for site access in 12 mo, or **(b) US$100**"; added a bold **"Limitation of liability."** lead-in; added a sentence that the **site** cap does NOT govern signed clinician/facility staffing contracts. | TX courts **split** on whether a nominal/$0 cap is "effectively no cap" (full recovery) — a $100 floor defeats that reading. Bold satisfies TX conspicuousness (Tex. Bus. & Com. Code §1.201(b)(10); *Dresser v. Page Petroleum*, 853 S.W.2d 505) — **ALL-CAPS not required**. Carve-outs (gross negligence/fraud/willful misconduct/PI-death) kept. |
| 2 | **Data "sale"/"share"** | Tightened the no-sale line to name the **carve-out logic in plain English** (disclose only to named sub-processors acting for us + to facilities/clinicians to carry out an engagement *you* direct). Noted Plausible is **EU-hosted**. Added an engineer guard-comment by the Plausible tag: **never add GA/Meta/ad pixels** (would falsify the notice + risk the exemption). | TDPSA "sale" = monetary **or other** valuable consideration but **statutorily excludes** processor + consumer-requested-service disclosures (TX Bus.&Com. §541.001); CCPA service-provider + consumer-direction exceptions mirror it. Code audit: only Plausible loads; CSP locks script/connect-src. |
| 3 | **Retention** | Rewrote the operational-records line: it no longer claims a **7-year statute**. Now names the **real floors** (IRS 4yr, FLSA 3yr, I-9 later-of-3/1yr, TX 4-yr contract SOL) and frames 7 yr as **IMS's own conservative policy** in line with credentialing practice. | **No** TX employment/tax statute reaches 7 yr; the longest binding driver is the 4-yr contract SOL (Tex. CPRC §16.004). The genuine 7-yr anchors (22 TAC §163.2; Medicare) bind **providers for patient records**, not a staffing intermediary — so 7 yr is policy, not law. (EEOC floor = 1 yr, 29 CFR §1602.14.) |
| 4 | **Privacy scope (2025–26)** | Softened HIPAA to "we **do not collect** patient health records (PHI)" (credentialing files can include health attestations). Future-proofed the state-law list ("California + the **roughly twenty** other states, TX included") and added that even **Connecticut's 2026** amendments reach only people acting as **consumers**, not job applicants/business contacts. | HIPAA BA test needs a CE customer **and** patient PHI — IMS has neither. CTDPA (eff. Jul 1 2026) lowers the threshold to 35k + a no-volume sensitive-data trigger, **but** its "consumer" definition still **excludes** employment/commercial-context individuals → analysis unchanged. ~20 state laws in effect 2026 (IN/KY/RI live Jan 1 2026). |

---

## ⚖️ Genuine attorney / founder judgment calls (NOT applied — your decision)

1. **Arbitration + class-action waiver — recommend KEEP IT OFF the website.** On a free, no-clickwrap
   informational site, a browsewrap arbitration clause is **unenforceable** for lack of assent (*Chabolla v.
   ClassPass*, 9th Cir. Feb 2025; *Godun v. JustAnswer*, Apr 2025; TX Arbitration Act needs writing + mutual
   assent + consideration) — so it gives false confidence; and if you *did* make it enforceable via clickwrap,
   it becomes a **mass-arbitration cost magnet** (AAA: $8,125 business filing fee + ~$325/case for the first
   500, auto-applies at 25+ demands) for a firm with no consumer base. The right home for any arbitration term
   is the **signed clinician/facility contract** (real assent + consideration) — a counsel drafting task, not
   website copy. A model clause is in the research output **for your attorney to evaluate only**.

2. **Missing-clause adds — recommended, but they're new legal sections → attorney sign-off.** Worth adding
   (all low-risk, all stay DRAFT until signed off):
   - **Tier 1:** E-SIGN electronic-communications consent; a not-directed-to-children (COPPA) line;
     a combined "General" boilerplate block (entire-agreement, no-waiver, assignment, force-majeure,
     third-party-links).
   - **Tier 2:** a TX data-breach-notification reference (**Tex. Bus. & Com. Code §521.053** — binds IMS
     regardless of the TDPSA exemption); a website **accessibility / ADA** statement + accommodation contact
     (no small-business exemption; ~3,948 web-accessibility suits in 2025, mostly small firms).
   - **Tier 3 (optional):** an explicit Do-Not-Track / Global-Privacy-Control line in the Cookies notice.
   - **Deliberately OMITTED (do not add):** any **sub-2-year** contractual limitations period — **VOID** under
     Tex. CPRC §16.070; a user-facing **indemnification** clause (unenforceable browsewrap + off-brand); an
     account-termination clause (no accounts exist).

3. **Signed-contract liability cap + final DRAFT-banner removal.** The limitation-of-liability provision in the
   **signed** clinician/facility agreements (outside this repo) is the one item the website can't resolve — a
   licensed TX attorney should own it. The Terms keep the "under legal review" **DRAFT** banner until sign-off.

### Confirmed correct as-is (no change)
- **Governing law + forum:** "State of Texas" governing law + State-of-Texas **forum-selection** clause (with
  the consumer-protection carve-out) is enforceable and correctly does **not** pin a binding county venue
  (Tex. CPRC §15.020). Do **not** add a 1-year limitations clause (§16.070 voids it).
- **Registered address** display on /privacy, /terms, /cookies is publish-safe and good practice.
- **TDPSA small-business exemption, CCPA/other-state non-applicability, GDPR scope-out, cookies** — all
  re-confirmed against 2025–26 sources.

*Full citations per dimension are in the workflow output; key statutes/cases are listed in the table above.*
