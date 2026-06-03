# IMS legal-copy research & decisions — 2026-06-02

**Scope.** A grounded rewrite of the legal copy in
[`src/components/sections/LegalPage.astro`](../../src/components/sections/LegalPage.astro)
(the `LEGAL_CONTENT` map → `/privacy`, `/terms`, `/cookies`) so the page states only
what actually binds **Innovative Medical Staffing (IMS)** — a small, 2022-founded
boutique locum-tenens / healthcare-staffing firm that is **fully remote** — founded in
**Fort Worth, Texas** in 2022 (origin only; **no office or HQ anywhere**) — with a US-only audience.

**Method.** Each legal dimension was researched against primary/authoritative sources
(statutes, AG/regulator/SBA pages, reputable law-firm summaries) by a dedicated agent,
then **adversarially verified** by a second agent that tried to refute the applicability
conclusion and spot-checked the citations. All eight conclusions held at **high
confidence**. This is engineering/communications work grounded in research, **not legal
advice** — the residual items flagged ⚖️ below are genuine attorney judgment calls.

> **Status: DRAFT pending Zach's attorney sign-off.** `UPDATED` bumped to **June 2, 2026**.

> **🔧 2026-06-03 CORRECTION + VERIFICATION (Zach ground truth + adversarial panel).** IMS is
> **fully remote — no staffed office/HQ anywhere.** Fort Worth is the **2022 founding origin**, and
> IMS's **registered legal address is 12650 N Beach St, Ste 114 #7022, Fort Worth, TX 76244** — a
> commercial registered-agent / mailbox address **in Tarrant County** (county VERIFIED via USPS ZIP
> record + Tarrant Appraisal District parcel APN 41373677). Decisions: governing law = **State of
> Texas**; the **registered address is now shown** in the legal contact block (publish-safe — a CMRA
> + public TX-SOS record, and good privacy-notice practice); but the dispute venue stays a
> **State-of-Texas forum-selection clause, NOT a binding Tarrant County venue.** A 3-lens panel found
> a contractual county venue is **unenforceable** in Texas absent a $1M+ "major transaction"
> (Tex. CPRC 15.020), and a registered-agent mailbox is not a "principal office" (CPRC 15.001) — so
> naming Tarrant County as binding venue would be legally inert. `UPDATED` → **June 3, 2026**.
> Marketing stays "Founded in Fort Worth, TX" (no office claim); legal (registered address) +
> marketing (founding origin) coexist. ⚖️ Attorney options: keep the clean State-of-Texas forum
> clause (recommended), OR name Tarrant County only as a non-binding *preference* with a lawful
> fallback if Zach wants it explicit.

---

## TL;DR of changes shipped to the copy

| Area | Before | After |
|---|---|---|
| **US state privacy laws** | "If you reside in CA/CO/CT/UT/VA you **have additional rights** … we honor requests **within 45 days**" (presented as binding) | Accurate scope statement: IMS is a small TX business that meets **none** of the thresholds and **does not sell data**; rights offered **voluntarily**. |
| **Texas TDPSA** | (not mentioned) | Added: IMS is **SBA small-business exempt**; only universal rule (no selling **sensitive** data w/o consent) is met by not selling at all. |
| **GDPR** | "**IMS acts as the data controller**" + legal-basis recitation + enumerated rights + "lodge a complaint" | Scoped down to **"Where we operate"**: US-only, doesn't target EU/UK, GDPR doesn't generally apply; soft contact offer. |
| **HIPAA** | (silent) | Added one accurate, conditional clarification: IMS is **neither a covered entity nor a business associate**; credentialing data ≠ patient PHI. |
| **Cookies** | Rationale pinned on **"Under EU PECR"** | Leads with the actual cookie profile (`__cf_bm` strictly-necessary, Plausible cookieless) + **US notice-and-opt-out scope**; PECR demoted to a confirmatory aside. |
| **Retention** | "+7 years, **per healthcare-staffing record-retention norms**" (unsupported) | Attributed to its **real driver** (TX employment-record & tax statutes of limitation); 18mo/12mo framed as **internal policy** (EEOC floor is 1 yr). |
| **Dispute venue** | **Travis County** (Austin) | **State of Texas** (forum-selection, enforceable). Registered address (12650 N Beach St, Fort Worth = **Tarrant County**, verified) is shown for legal service, but a binding county venue is void in TX for a free site visitor (CPRC 15.020), so no county is pinned. |
| **Liability cap** | carve-outs: gross negligence, willful misconduct | carve-outs completed (+ **fraud, personal injury/death by negligence**); operative cap sentence bolded for conspicuousness. |

---

## Findings by dimension

### 1. Texas Data Privacy & Security Act (TDPSA) — *small-business EXEMPT*
- TDPSA (Tex. Bus. & Com. Code ch. 541, eff. **July 1, 2024**) is unique: **no revenue or
  data-volume threshold**. It applies to anyone who (a) does business in TX / serves TX
  residents, (b) processes or sells personal data, **and (c) is _not_ an SBA-defined small
  business**.
- The SBA size standard for IMS's industry — **NAICS 561311** (Employment Placement
  Agencies) / **561320** (Temporary Help Services) — is **$34.0M average annual receipts**
  (13 CFR 121.201). A boutique 2022 firm is far below this ⇒ **small business ⇒ exempt**
  from the operative requirements.
- The **only** rule that survives the small-business exemption (§541.107): a small business
  may not **sell** personal data that is **sensitive** without prior consent. IMS doesn't
  sell data at all (facilities pay for a *service*; credentialing disclosures to a facility's
  MSO are transfers to deliver the requested service, not a "sale") ⇒ satisfied.
- Enforcement: **TX AG only**, 30-day cure, up to $7,500/violation, **no private right of action**.
- **Copy:** state the exemption + "we don't sell data"; do **not** claim "full TDPSA
  compliance" or imply built-out consumer-rights machinery.
- Sources: [TDPSA ch. 541](https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm) ·
  [TX State Law Library](https://www.sll.texas.gov/spotlight/2024/07/texas-data-privacy-and-security-act/) ·
  [Fisher Phillips FAQ](https://www.fisherphillips.com/en/insights/insights/faqs-businesses-texas-data-privacy-law) ·
  [§541.107](https://tdpsa.org/section-541-107-requirements-for-small-businesses/) ·
  [13 CFR 121.201 (SBA size standards)](https://www.law.cornell.edu/cfr/text/13/121.201) ·
  [TX AG — TDPSA](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/texas-data-privacy-and-security-act)
- ⚖️ Attorney note: the "not a sale" determination is fact-dependent — re-confirm if IMS ever
  shares clinician data with third parties for consideration.

### 2. California CCPA/CPRA — *does NOT apply*
- A for-profit is a CCPA "business" only if it does business in CA **and** meets ≥1 of three
  thresholds: **>$26,625,000** gross annual revenue (CPI-adjusted, eff. Jan 1 2025; next
  adjustment Jan 1 2027); **OR** buys/sells/shares PI of **100,000+** CA consumers/households
  per year; **OR** **50%+** of revenue from selling/sharing PI. Meeting **none** ⇒ not a
  "business" ⇒ CCPA doesn't apply.
- IMS plausibly meets none. (Note: the 100k prong is "buys, sells, or shares" — **not**
  "collects" — so a data-heavy *collector* that doesn't monetize/transfer at scale still clears it.)
- **Copy:** reframe CA rights as a **voluntary courtesy**, not a legal obligation. Keep "we do
  not sell" but do **not** broaden to "never share" (IMS necessarily shares applicant data with
  the hiring facility to make placements).
- Sources: [CPPA — CPI threshold adjustment](https://cppa.ca.gov/regulations/cpi_adjustment.html) ·
  [CPPA FAQ](https://cppa.ca.gov/faq.html) ·
  [Jackson Lewis CCPA FAQs](https://www.jacksonlewis.com/insights/navigating-california-consumer-privacy-act-30-essential-faqs-covered-businesses-including-clarifying-regulations-effective-1126)

### 3. Other ~20 state privacy laws (CO/CT/VA/UT + 2024-26 wave) — *none apply*
- Four independent, compounding reasons each defeat applicability:
  1. **Volume** — CO/CT/VA/UT/OR/TN/IA/NJ/MN/IN/KY require **100,000+** residents/yr; MT 50k;
     DE/NH/MD/RI 35k. A boutique firm doesn't approach even the lowest bar.
  2. **No data sales** — the lower "25,000 + X% of revenue from the *sale* of data" limb is
     structurally unreachable (IMS earns from placement fees, 0% from selling data).
  3. **Revenue floors** — UT needs $25M+; FL needs **$1B+** global revenue + ad-tech criteria.
  4. **SBA small-business exemption** — TX and NE exempt SBA small businesses outright.
  5. **Employment/B2B carve-out** (cross-cutting) — every comprehensive law **except California**
     excludes individuals acting as **job applicants** or **business contacts**, so most of IMS's
     clinician-applicant + facility-contact data sits outside "consumer" regardless of thresholds.
- **Copy:** remove the enumerated "you have rights under X/Y/Z" list as if binding; state the
  scope honestly + offer access/correct/delete voluntarily.
- Sources: [CO AG — CPA](https://coag.gov/resources/colorado-privacy-act/) ·
  [Feroot — thresholds](https://www.feroot.com/blog/when-do-u-s-state-privacy-laws-apply-scope-and-thresholds/) ·
  [ZeroDay Law — 2026 roster](https://www.zerodaylaw.com/blog/us-state-privacy-acts) ·
  [TrueVault — TX small business](https://www.truevault.com/learn/texas-privacy-law-what-is-a-small-business) ·
  [Littler — employment/B2B carve-out](https://www.littler.com/news-analysis/asap/new-year-new-data-protection-laws-what-employers-should-know) ·
  [White & Case — FL DBR](https://www.whitecase.com/insight-alert/florida-enacts-digital-bill-rights-joining-growing-privacy-landscape)
- Out-of-scope reminder: all states have **separate breach-notification** statutes that *do*
  apply regardless of size — the copy is correctly limited to *comprehensive* privacy laws.

### 4. GDPR — *does NOT apply; old copy OVER-committed*
- Art. 3 reaches a US firm only via an **EU establishment** (3(1) — IMS has none) or by
  **targeting** EU data subjects / monitoring their behaviour (3(2)). Per **Recital 23** and
  **EDPB Guidelines 3/2018**, mere website accessibility / an email address / English-language
  use is **insufficient** — you need *intentional* targeting (EU language+currency+ordering,
  EU-customer mentions, etc.). IMS is US-only and doesn't target EU/UK.
- Hosting a **sub-processor** (Plausible) in the EU does **not** make IMS a GDPR *controller*;
  controller status turns on *who decides purpose/means* (Art. 4(7)), not where a vendor's
  servers sit.
- The old line **"IMS acts as the data controller"** + legal-basis recitation + enumerated
  rights + "lodge a complaint" manufactured obligations the law doesn't impose here.
- **Copy:** scoped down to "Where we operate" — soft, non-binding, with a contact offer.
- Sources: [GDPR Art. 3](https://gdpr-info.eu/art-3-gdpr/) ·
  [Recital 23](https://gdpr-info.eu/recitals/no-23/) ·
  [EDPB Guidelines 3/2018](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines_3_2018_territorial_scope_after_public_consultation_en_1.pdf) ·
  [IAPP — territorial scope (US view)](https://iapp.org/news/a/territorial-scope-of-the-gdpr-from-a-us-perspective)
- Verifier hygiene note: the "EU-hosted vendor ≠ controller" point should be cited to GDPR
  Art. 4(7) / EDPB Guidelines 07/2020 (not gdpr.eu); substance is correct either way.

### 5. HIPAA — *neither covered entity nor business associate*
- **Covered entity** (45 CFR 160.103) = health plan, clearinghouse, or provider transmitting
  health info electronically in a standard transaction. IMS is a staffing intermediary — none of these.
- **Business associate** = creates/receives/maintains/transmits **PHI** for a covered entity.
  IMS holds **provider credentialing** data (license, certs, references, work history) — about the
  *clinician*, **not** a patient — which is **not PHI**. Also, a placed clinician under the
  facility's direct control is part of the **facility's workforce**, so placement alone creates no BAA.
- **Contingency:** IMS would tip into BA status only if it begins routing **patient** charts /
  billing / scheduling through its systems. Not today's fact pattern.
- **Copy:** was silent (defensible). Added one accurate, *conditional* clarification for clinicians;
  did **not** claim IMS is "HIPAA compliant"/"covered."
- Sources: [45 CFR 160.103](https://www.law.cornell.edu/cfr/text/45/160.103) ·
  [HHS — Covered Entities & BAs](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html) ·
  [Holland & Hart — avoiding BAAs / workforce](https://www.hollandhart.com/avoiding-business-associate-agreements)

### 6. Cookies / PECR — *no banner required (conclusion correct; framing fixed)*
- Site sets exactly one cookie, **`__cf_bm`** (Cloudflare bot-management, 30-min, no PII in body,
  not cross-site) — Cloudflare itself classifies it **strictly necessary**. Analytics is **Plausible**
  (cookieless, daily-rotating salted hash). ⇒ zero consent-requiring cookies.
- The old copy made **"Under EU PECR"** the *governing* rationale — but PECR has **no
  extraterritorial reach** over a US-only firm that doesn't target the EU/UK. US state laws gate
  consent/opt-out to **sale** + **targeted advertising**, not essential cookies.
- **Copy:** lead with the actual cookie/analytics profile + US scope; keep PECR/EDPB only as a
  confirmatory aside; avoid flatly asserting TDPSA "applies to us" given the small-business exemption.
- Sources: [Cloudflare cookies policy (`__cf_bm` = strictly necessary)](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/) ·
  [EDPB Guidelines 2/2023 (Art. 5(3) scope)](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf) ·
  [ICO — PECR territorial scope](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-pecr-rules/) ·
  [Venable — state cookie enforcement](https://www.venable.com/insights/publications/2025/04/state-privacy-law-enforcement-coordination-cookie) ·
  [Plausible data policy](https://plausible.io/data-policy)

### 7. Retention — *windows OK as policy; attribution was unsupported*
- **No** federal or TX law mandates a retention period for staffing-agency recruiting/credentialing
  records *as such*. The clear floor that binds is **EEOC/Title VII (29 CFR 1602.14) = 1 year**.
- I-9 (3yr-after-hire/1yr-after-term) and payroll (~4yr) attach only to people IMS **employs** on
  W-2 — most locums are 1099, so they don't cleanly justify a clinician "+7 years."
- **TX Labor Code Ch. 93** (Temporary Employment Services — the chapter fitting IMS) imposes **no**
  retention requirement. (The 2-yr rule in Ch. 92 is only for licensed common-worker labor halls.)
- The real basis for "+7 years" is the **TWC / employment-attorney best practice** to outlast Texas
  common-law statutes of limitation — a *general employment-law* rationale, **not** a "healthcare-
  staffing record-retention norm" (that phrase was unsupported and has been removed).
- **Copy:** keep the conservative windows; present 18mo/12mo as **internal policy** and tie "+7yr"
  to TX employment-record/tax statutes of limitation.
- Sources: [EEOC — recordkeeping (1 yr)](https://www.eeoc.gov/employers/summary-selected-recordkeeping-obligations-29-cfr-part-1602) ·
  [EEOC — coverage of employment agencies](https://www.eeoc.gov/laws/guidance/section-2-threshold-issues) ·
  [TWC — recordkeeping (~7 yr best practice)](https://efte.twc.texas.gov/general_recordkeeping_requirements.html) ·
  [TX Labor Code ch. 93](https://statutes.capitol.texas.gov/Docs/LA/htm/LA.93.htm) ·
  [USCIS — I-9 retention](https://www.uscis.gov/i-9-central/form-i-9-resources/handbook-for-employers-m-274/100-retaining-form-i-9)

### 8. Venue + liability cap (Terms)
- **Venue (factual fix):** Fort Worth is the county seat of **Tarrant County** (est. 1849). Travis
  County's seat is Austin, ~175 mi away. "Travis County" was a drafting error ⇒ changed to **Tarrant County**.
- **Liability cap:** a fees-paid cap (commonly 12 months) with carve-outs is **ordinary, widely-used**
  US website-ToS boilerplate; a $0 result for non-paying visitors is the natural consequence. The live
  clause's carve-outs were incomplete (missing **fraud** and **personal injury/death by negligence**) —
  completed. Operative cap sentence **bolded** for Texas fair-notice conspicuousness.
- Sources: [Tarrant County (official)](https://www.tarrantcountytx.gov/en/county/about-tarrant.html) ·
  [Tarrant County (Wikipedia)](https://en.wikipedia.org/wiki/Tarrant_County,_Texas) ·
  [Cole Law — TX liability limitations](https://thecolefirm.com/understanding-liability-limitations-in-texas-service-agreements/) ·
  [TermsFeed — SaaS liability caps](https://www.termsfeed.com/blog/saas-limitation-liability/)

---

## ⚖️ Residual items for Zach / attorney (judgment calls — copy left in DRAFT)

1. **Liability-cap enforceability** *(the one genuine attorney call)* — the $0/fees-paid cap with
   carve-outs is standard, but ultimate enforceability (Texas **conspicuousness** sufficiency,
   unconscionability, scope of mandatory carve-outs) is a lawyer's call. I used **bold** for
   conspicuousness to preserve the page's plain-English design; an attorney may prefer full
   **ALL-CAPS**. Confirm.
2. **Venue** — confirm no registered-agent / litigation-counsel reason requires a county other than
   Tarrant. (Default Tarrant = Fort Worth HQ.)
3. **"We don't sell data" / "not a sale"** — the TDPSA/CCPA exemptions lean on IMS not *selling*
   personal data. Confirm IMS never shares clinician/applicant data with third parties for monetary
   or other valuable consideration. (Disclosing to the hiring facility/MSO to deliver the placement
   is *not* a sale — but a data-broker-style arrangement would change the analysis.)
4. **HIPAA note (new content)** — added a short, accurate clarification where the page was silent.
   If IMS ever routes **patient** PHI through its systems, it becomes a business associate and needs
   a BAA + Security/Privacy/Breach compliance — and this note must change. Confirm it's wanted.
5. **Retention windows are real practice?** — 18mo / 12mo / engagement+~7yr are presented as IMS's
   own policy. Confirm these match what IMS actually does (and that deletion is actually executed).
6. **EU/UK reference at all** — kept a soft "if you're in the EU/UK, email us" courtesy line. An
   attorney may prefer to drop any EU/UK mention entirely since IMS doesn't target there. Confirm.
7. **DRAFT callout** — the Terms page still shows the "under legal review" banner. Remove it only
   after attorney sign-off.
