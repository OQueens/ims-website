# Brief 19 — Data-Source Expansion (widening the anchorable source universe)

> Deep-dive brief, 2026-07-03. Pillar: DATA-SOURCE EXPANSION (extends WS1).
> Read together with `docs/rate-simulator/deep-dive/maps/04-scraper-pipeline.md` (pipeline),
> `maps/03-market-posterior-bridge.md` (anchor gate), `maps/06-data-model.md` (taxonomy seam).
> All repo paths absolute under `C:/Users/oclou/QueenClaude/`.
> OBSERVED = read from code or a live fetch (cited file:line or URL). ESTIMATED/STATED =
> secondhand (search snippet, memory, vendor marketing) — flagged, and every $ figure is in
> `claims_to_verify` for the fact-checker.

---

## Summary

The live anchor gate (`ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/marketRates.ts:419-422, 473-512`) promotes a cell to a live quote anchor only when the primary bucket is market-typed (`actual_paid_locum` / `advertised_clinician_pay`) AND `n_distinct >= 4` AND >= 2 independent source families. Today's source universe cannot clear that bar for more than a handful of cells:

- The marketing-page path (6 TUNED + 18 GENERIC sources, `agent-sdk/agents/rate_scraper/sources.py:135-231`) is mostly article-class (`scraped_article_estimate`) — context-only, never anchors.
- The posting path — where advertised per-job $/hr actually lives — has exactly ONE verified family live: AMN (`agent-sdk/agents/rate_scraper/posting_sources.py:90-112`, `verified=True`; DocCafe / Physemp / emCareers / LocumJobsOnline all `verified=False` STAGED).
- One family can never satisfy the >= 2-family gate. **The binding constraint on live-anchored coverage is independent-family count per cell, not observation volume.**

The good news (WS1 discovery, live-verified 2026-06-30): at least 4-6 genuinely independent corporate families publish scrapable per-job locum $/hr spanning every common specialty (AMN, Cross Country, LocumTenens.com/Jackson, Vivian-recovered agencies, gaswork for anesthesia, Aya), plus a tier of JSON-LD aggregator boards (DocCafe, Physemp, LocumJobsOnline) that RECOVER pay for otherwise pay-opaque families (CHG/Weatherby, Medicus, Tandym, Consilium). Wiring these — in the wire-order below, with the family-recovery seam already built (`agent-sdk/agents/rate_scraper/dedup.py`, wired 2026-07-01) — is the single highest-yield accuracy move available.

**But four co-blockers cap the ROI of any source expansion and must be scheduled with it, not after it:**
1. **The 19/152 taxonomy seam** (map 06 §3.4): only 19 producer-canonical names survive the bridge's engine-key allowlist. A perfectly scraped CRNA / cardiology / OB-GYN / general-surgery / ortho observation is discarded as `unknownSpecialties` before RTDB today. Source expansion without the mapping layer buys almost nothing for those cells.
2. **IronDome band coverage** (29 `PLAUSIBLE_RANGES` keys vs 152 canonical cells, `agent-sdk/core/iron_dome.py:16-53`): the no-tight-bound guard (`agent.py:522-524`) hard-blocks the posting path for any specialty without a vetted band — band expansion is the specialty-coverage bottleneck.
3. **The DAY/WEEK unit drop** (`agent.py:491-495`): a large share of newly reachable supply (surgical day rates, weekly-quoted hospitalist/neurohospitalist postings) is dropped at the unit gate — a systematic bias against exactly the call-heavy specialties with the thinnest data.
4. **Unapplied migration `20260701000000`** (`ias-dashboard/supabase/migrations/20260701000000_add_aggregator_estimate_rate_type.sql`): one `aggregator_estimate` row 23514s the whole single-statement batch insert (`agent-sdk/core/supabase_client.py:77-86`). Hard prerequisite before flipping any aggregator source.

A secondary, underused lever: **state pay-transparency laws** (17 states as of early 2026; Colorado/Washington/New York/Illinois/California the strictest) now force compensation ranges into postings — including specialty-society boards (the ACR Career Center mandates salary disclosure for ALL postings). Scraping transparency-state-filtered listings both (a) pries per-job $ out of otherwise pay-opaque families and (b) yields **state-keyed** rows for the v2 tree's state dimension, which is 100% `national` today (map 03 §S7).

---

## Findings (cited)

### F1. The current source universe, precisely (OBSERVED)

| Path | Sources | rate_type | Anchorable? |
|---|---|---|---|
| Firecrawl marketing pages | 6 TUNED: locums_com, locumstory, comphealth, barton_associates, weatherby, jackson_coker (`sources.py:135-198`) + 18 GENERIC incl. gasworks, vista_staffing, aya_locums, amn_healthcare, global_medical, medicus, allstar_healthcare, integrity_locums, cross_country, locum_leaders, physicians_thrive, beckers, modern_healthcare, nalto, 3× reddit, sdn (`sources.py:204-231`) | per-source 3-tuple from `shared/rate_type_url_patterns.json`; agency rate-table pages are the only market-typed ones; forums/news are article/crowd class | Mostly NO (article-class); the agency rate-TABLE pages are periodically-updated blog content, not per-job postings |
| SerpAPI fan-out | one query (`sources.py:246`), rate_type per destination URL | mostly `scraped_article_estimate`, confidence hardcoded `low` (`agent.py:876`) | NO |
| Scrapling postings | **AMN only live** (18 specialty slugs, `posting_sources.py:69-88`); DocCafe/Physemp/emCareers/LJO staged `verified=False` | AMN = `advertised_clinician_pay`; LJO = `aggregator_estimate` (never anchors, precedence 0 — `marketRates.ts` BUCKET_PRECEDENCE per map 03 §S2) | AMN YES — but it is ONE family |
| Never-anchor exclusions | ZipRecruiter + Adzuna families (`src/lib/rate-engine/sourceFamily.ts:118-121`), excluded at bridge admission | modeled/W2-blended job-board numbers | NEVER (the CRNA spike: ZipRecruiter's published CRNA average $124.86/hr ≈ half the real locum band — code comment `sourceFamily.ts:105-107`, independently corroborated by ZipRecruiter's own current CRNA pages showing $91-189/hr model output) |

Consequence (OBSERVED at the 2026-06-30 Move #1 deploy, map 03 §5.3): **0 cells promoted** — no cell in prod currently clears n>=4 + 2 families with market-typed data.

### F2. Where per-job locum $/hr actually lives (the anchorable supply)

Advertised locum pay lives in per-job POSTING cards and schema.org JSON-LD `baseSalary`, not in marketing rate tables (WS1 catalog conclusion, `docs/ws1-scrapling-scraper-PLAN.md:26-48`; live-verified evidence below). Candidate families, with verification status:

**Tier A — direct-agency boards (board IS the family), publish per-job $/hr:**
| Family | Evidence (status) | Mechanics |
|---|---|---|
| AMN | OBSERVED live 2026-06-30: radiology listing → HTTP 200, 12 `div.card-pay-ammount` cards `$291–315`, regex `$306 per hour` (WS1 memory; end-to-end 77 cards → 10 IronDome-passing observations). Public listing pages currently headline e.g. EM "$289 hourly", nocturnist "$200 hourly" (amnhealthcare.com listing pages, search-snippet — re-verify) | static Fetcher, per-specialty slug URLs, cards on listing. LIVE today |
| Cross Country | OBSERVED live 2026-06-30 (WS1 catalog): `crosscountry.com/jobs/results?keyword={specialty}` + detail shows `$270-280/Hourly` | static; needs catalog entry + selector confirm. Family `cross_country` already in `KNOWN_FAMILY_OVERRIDES` (`sourceFamily.ts:90-91`) |
| LocumTenens.com (Jackson) | OBSERVED live 2026-06-30 (WS1 catalog): mobile subdomain `m.locumtenens.com/.../JobDetails?jId={id}` shows `$290/Hr` | static mobile endpoint; family must collapse to `jackson` (jackson_coker already maps — `sourceFamily.ts:87-88`) |
| gaswork (anesthesia/CRNA only) | gaswork.com self-describes as the largest anesthesia employment resource since 1996; WS1 catalog: ~13.8K CRNA+anesthesiologist postings, RSS feed `gaswork.com/search-rss/{Title}/Job`, **has a 1099/W2 flag column** (STATED — re-verify live) | static RSS; the single best CRNA/anesthesia supply + arrangement labels. 5th independent family for anesthesia cells |
| Aya Locums | job pages publish pay but **DAILY-quoted** (`ayalocums.com/job/...`, WS1 catalog) | blocked by the DAY-unit drop today (F5); family `aya` mapped (`sourceFamily.ts:94-95`) |

**Tier A' — aggregator boards emitting JSON-LD `baseSalary` + `hiringOrganization` (family = RECOVERED agency, seam already wired `dedup.py:121-147`):**
| Board | Evidence (status) | Recovers |
|---|---|---|
| Physemp | OBSERVED live 2026-06-30: `/physician/jobs/2235817` → `baseSalary {value:375, unitText:HOUR}` + `hiringOrganization:"Tandym Health"` (a pay-opaque agency, recovered) | Tandym + others |
| DocCafe | STAGED (`posting_sources.py:118-133`); board self-reports ~130K physician jobs incl. a locum-tenens vertical (doccafe.com — no per-job $ verified yet; list URLs 404'd on guesses) | AMN, Aya re-lists (dedup collapses) |
| LocumJobsOnline (TrackFive) | listings carry per-job ranges labeled ESTIMATED, e.g. neurohospitalist Spokane $6,030–6,460/wk; OB-GYN Elko NV $200–250/hr; plastic surgery Flagstaff $1,800–2,000/day; EM North Adams MA $300–340/hr (locumjobsonline.com, search-snippets 2026-07-03 — re-verify live) | CHG/Weatherby, Medicus, Consilium, VISTA — **but rate_type = `aggregator_estimate`, NEVER anchors** (correct; it is the board's guess, not the agency's ad) |
| Vivian Health | OBSERVED live 2026-06-30 (WS1 catalog): `vivian.com/job/{id}/` JSON-LD `$87/HR unitText:Hour`, recovers hidden agencies (e.g. Floyd Lee) | pay-opaque agencies; stealth tier + sitemap. ⚠ heavy nursing/allied mix — specialty gate load-bearing |

**Tier A'' — specialty-society / niche boards (long-tail + geo coverage):**
| Board | Evidence (status) | Specialty |
|---|---|---|
| ACR Career Center | **ACR REQUIRES all employers to disclose salary ranges on every posting** (acr.org Career Center policy, citing the 17-state transparency wave) — a mandated-disclosure board incl. contract/locum listings (`jobs.acr.org/jobs/job_type/contract/`) | radiology |
| JAMA Career Center | WS1 catalog: Aya cards with $X/hr + $X/day (STATED — selector unconfirmed) | multi-specialty |
| emCareers | staged (`posting_sources.py:155-173`); page shows "Pay: $X per hour" text, selector unconfirmed | emergency medicine |
| radworking | WS1 catalog: $/hr + $/wRVU + $/shift (STATED — unverified) | radiology |
| Health eCareers | rates are blended all-inclusive (stipends folded in) — WS1 honesty caveat (`docs/ws1-scrapling-scraper-PLAN.md:82`); usable only with a "blended" flag, arguably never anchor | multi |
| Moonlight (moonlightphysicians.com) | locum/moonlighting marketplace — rate transparency UNVERIFIED — needs a source | multi (candidate only) |

**Pay-opaque (DO-NOT-SCRAPE for pay; recover via aggregators):** CHG own boards (CompHealth/Weatherby/Global Medical), Jackson+Coker, Medicus, Hayes, MPLT, Fusion, Tandym, Floyd Lee, Trinity (`docs/ws1-scrapling-scraper-PLAN.md:48`; Weatherby listings still show "Competitive weekly pay (inquire for details)" per current search snippets). Note a crack in the wall: CompHealth's Colorado pages now show ranges — but ANNUAL (e.g. psychiatry "$305,000 to $720,000/yr", Colorado Springs) i.e. perm/locums-to-perm postings; the unit gate would correctly reject them. Watch for hourly-quoted locum postings appearing on CHG transparency-state pages (F6).

### F3. Independence math — what actually clears the bar per cell

From the WS1 catalog run (families × specialties, fetched live 2026-06-30): EM, radiology, anesthesiology, hospitalist, psychiatry, neurology, family/internal medicine, urology, OB-GYN, GI, cardiology each have **3-4 independent Tier-A families with n>=4 per listing page** once AMN + Cross Country + LocumTenens.com + (Vivian or gaswork) are live. CRNA is thinner (AMN folds CRNA into anesthesiology; leans gaswork + Vivian + Aya). Long-tail subspecialties (T4 tier, 47 cells) will NOT reach 2 families from these sources — they stay on curated priors + shrinkage (the honest outcome).

The family-collapse registry must grow in lockstep or the new boards fake independence: `KNOWN_FAMILY_OVERRIDES` today covers chg/amn/jackson/cross_country/aya (+ never-anchor zip/adzuna) (`sourceFamily.ts:73-103`). Needed additions from the WS1 plan (`docs/ws1-scrapling-scraper-PLAN.md:50`): trackfive (LJO), communitybrands (JAMA + ACR share one engine), madgex (emCareers), ingenovis (VISTA), tandym, consilium, medicus, `CRNAjobs→jackson`, `Medical Doctor Associates→cross_country`, `Wellhart→barton`, `Onyx→caliber`. ⚠ The registry lives in THREE copies (python `dedup.py`, bridge `sourceFamily.ts`, live-engine `sourceFamily.ts`) with no shared machine-readable registry (map 04 seam #1) — every family addition is a 3-file lockstep edit.

**Independence nuance for society boards:** JAMA and ACR share the Community-Brands engine but host DIFFERENT hiring orgs' ads. With the JSON-LD/hiring-org recovery seam, family should key on the recovered AGENCY, not the board engine — collapsing them to one `communitybrands` family (WS1 plan's simple approach) is over-conservative once org recovery works. Decide per-board: org-recovered ⇒ agency family; no org ⇒ `unattributed` (already the safe default, `dedup.py:26-33`).

### F4. The taxonomy seam caps everything (map 06 §3.4 — OBSERVED)

Only **19 of 152** producer-canonical names are engine keys, so the bridge discards the rest as `unknownSpecialties` before RTDB. The producer rewrites `crna → nurse anesthetist`, `cardiology → internal medicine - cardiology` at INSERT — neither is an engine key. Every gaswork CRNA row, every cardiology row from a new board, is structurally discarded today. The canonical tiers show where the market volume is: T1 (n>=50) includes `nurse anesthetist`, `internal medicine - cardiology`, `obstetrics and gynecology`, `surgery - general`, `orthopaedic surgery` — i.e., **5 of the 15 highest-volume cells are on the wrong side of the seam** (`agent-sdk/shared/specialty_canonical_list.json`, tiers T1=15/T2=16/T3=16/T4=47/APP=58). Source expansion sequenced before the mapping layer wastes most of its yield.

### F5. Unit mix: the DAY/WEEK drop discards a large share of the new supply

The posting path inserts HOUR rows only (`agent.py:491-495`, counted `rows_rejected_by_posting_unit_unsupported`). But the newly reachable supply is heavily day/week-quoted: Aya (daily-only), LJO examples above (weekly + daily + hourly), surgical/call postings generally. WEEK isn't even a typed unit (extractors accept HOUR/DAY, reject YEAR/WEEK/MONTH/RVU — `jsonld_parser.py:31-40`, `card_extractor.py:37-42`). Honest options short of a fabricated conversion: persist DAY rows into a separate day-rate channel feeding the call-only `CALL_RATE_DATA` refresh problem (map 05 seam #1 — that table can only decay today), keeping HOUR-only for the hourly band. This turns a coverage bias into a second product surface instead of a reject counter.

### F6. Geo lever: pay-transparency laws + mandated-disclosure boards (web-verified 2026-07-03)

- 17 states have active pay-transparency posting laws as of early 2026; Colorado, Illinois, New York, Washington require min+max compensation in postings (Colorado fines $500-$10,000 per violating posting; CO applies to any job performable in CO incl. remote) — paycor.com/govdocs.com compliance guides; cdle.colorado.gov (Equal Pay for Equal Work Act).
- The ACR Career Center adopted a blanket rule: every posting must disclose salary range (acr.org). Expect (and verify) the same drift on other YM-Careers/Madgex society boards.
- Two exploitable consequences: (a) otherwise pay-opaque agencies must publish ranges on postings targeting those states — scrape state-filtered listing pages of CHG/Weatherby/Medicus boards for CO/WA/NY/IL/CA and only those; (b) rows arrive **state-attributed** (structured "City, ST" via `_state_from_posting_location`, `agent.py:456-464`), directly populating the v2 state dimension that is 100% `national` today.
- ⚠ Legal applicability to 1099 locum postings is NOT settled — most statutes cover "employment"; agencies may argue contractor postings are exempt (several still hide pay). Treat as empirical: scrape what is published, never infer that absence = violation. UNVERIFIED — needs counsel-grade review if this becomes a stated strategy.

### F7. Survey / registry / gov layer (context rungs — never anchor, correctly)

| Source | What it publishes | rate_type (existing discipline) |
|---|---|---|
| Marit Health (marithealth.com) | crowd-sourced clinician salaries incl. a locums vertical with per-specialty AND per-state $/hr pages (e.g. "Locum Tenens Physician $290/hr avg"; "Locum FM $156/hr avg"; state pages like /o/locums/physician/salary/fl) — 20K+ salaries claimed | `crowd_survey` — the only per-state locum grid any survey source publishes; a geo PRIOR, not an anchor |
| Physician Side Gigs (physiciansidegigs.com) | locum rate database (avg ~$215/hr across specialties), specialty/location/employer breakdowns | `crowd_survey` — ⚠ database access requires joining their physicians-only Facebook group: scraping it violates both FB ToS and the community's access terms. Use only their PUBLIC summary pages |
| LocumTenens.com annual "Physician and Advanced Practice Salary Report" (locumtenens.com/resource-center/salary-survey-reports/) | annual self-reported comp survey | `crowd_survey` / `scraped_article_estimate`; annual refresh cadence |
| CHG "State of Locum Tenens" report (chghealthcare.com) | annual market/rates trend report | `scraped_article_estimate` |
| AANA CRNA survey, BLS OEWS | already wired (`external_specialty_surveys` table; `bls_oews*` → `permanent_wage_proxy` short-circuit, `shared/rate_type_classifier.py`) | unchanged |
| Gov procurement (SAM.gov / USASpending: VA + IHS physician-staffing awards; GSA CALC labor rates) | awarded contract rates for locum staffing — but these are **agency BILL rates to the government**, not clinician pay | `agency_bill_rate` (never renderable) — useful ONLY for the dormant cap/bill axis (`cap-rates` tree). Feasibility UNVERIFIED: award docs don't reliably expose $/hr; exploratory only |

### F8. Freshness: the 7-day cliff makes cadence a correctness property, not an ops nicety

Bridge read window and reader gate are both 7 days (`bridge-rate-intelligence.ts:101`, `marketRates.ts:136`). Any source scraped less than weekly contributes nothing durable; one week of fleet outage silently reverts every promoted anchor to curated with no operator signal (map 03 §S11). Posting churn helps rather than hurts (fresh `date_scraped` on every run; Stage-1 dedup kills cadence inflation — same URL+value collapses to latest, `aggregateBridge.ts:286-379`). JSON-LD `datePosted` should be captured into `published_at` where present (postings currently always use the scrape-date floor, `agent.py:581-583` — honest but coarser than available data).

### F9. ToS / risk table (flag, per standing scraping discipline `~/.claude/rules/rate-scraper.md`)

| Risk | Sources affected | Posture |
|---|---|---|
| Board ToS prohibit scraping | DocCafe, Vivian, LJO, Health eCareers likely have anti-scrape clauses (UNVERIFIED per-board — review each before flipping `verified=True`) | Public non-authed pages only; hiQ v. LinkedIn (9th Cir.) weakened CFAA exposure for public data but breach-of-contract exposure survives — flag, throttle, obey robots where feasible, never login/paywall |
| Walled community data | Physician Side Gigs (FB group), MGMA/SullivanCotter/AMGA (paid W2 surveys — already pruned as over-budget DON'T-ADOPT, `sources.py:215-222`) | DO NOT scrape; public summary pages only |
| Fake independence | aggregator re-lists (same Aya req on DocCafe+JAMA); LJO→Talent/SimplyHired syndication | already engineered: cross-board dedup (`dedup.py:174-198`) + recovered-family seam + `unattributed` constant; UNEXERCISED by live data until fleet run (map 04 seam #8) |
| Poisoned/estimated numbers | LJO "estimated" badges; ZipRecruiter/Adzuna/Glassdoor models; Health eCareers blended rates | rate_type discipline holds: `aggregator_estimate` precedence 0, never-anchor set, blended-rate flag needed for HeC |
| Batch-abort on new enum | any aggregator row before migration `20260701000000` applied | HARD prerequisite (Zach, prod Supabase) |
| Cloudflare-challenge pages as data | stealth-tier boards (LJO, Vivian, gaswork per WS1) | `content_ok` guard already requires >=1 in-band typed pay observation, else page dropped (`scrapling_fetch.py:96-151`) |

---

## Recommendations

Ordered by (impact on cells clearing the anchor bar) ÷ effort. Wire order matters: prerequisites first.

| # | Recommendation | Impact | Effort |
|---|---|---|---|
| R1 | **Apply migration `20260701000000` to prod** (Zach-only), then run the fleet + bridge once with AMN-only to validate the end-to-end path before any expansion | high (unblocks everything) | low |
| R2 | **Build the canonical→engine specialty mapping layer** (152 producer names → 88 engine keys; explicit table, no fuzzy at bridge time) so scraped CRNA/cardiology/OB-GYN/gen-surg/ortho stop being discarded. Without this, R3-R6 yield ~19/152 cells max | high (the cap on all other work) | medium |
| R3 | **Flip the staged boards after live selector verification** (refute-by-default): Physemp (JSON-LD proven), DocCafe, emCareers. Physemp+AMN = 2 families on shared specialties → first real promotions | high | low-medium |
| R4 | **Wire the 3 net-new direct families**: Cross Country, LocumTenens.com (mobile endpoint), gaswork (RSS; anesthesia/CRNA). With AMN this yields 3-4 independent families across ~11 high-volume specialties (F3) | high | medium |
| R5 | **Expand IronDome `PLAUSIBLE_RANGES` cite-or-block**: for each specialty a new source can reach, add a cited band (agency postings/audit docs) BEFORE enabling it on the posting path; keep the no-tight-bound guard as the forcing function. Add the named coverage assertion (delta canonical-list vs bands) so the gap is quantified in CI (`agent.py:519-521` names it) | high | medium |
| R6 | **Vivian JSON-LD aggregator** (stealth + sitemap) — the biggest hidden-pay recovery surface; exercises the recovered-family seam on real rows. Gate: strict specialty allowlist (nursing/allied flood) + org-recovery required | high | medium |
| R7 | **DAY-rate capture channel**: persist unit=DAY posting rows (typed, separate from the hourly band; no DAY→HR conversion) to feed a future call/day-band refresh — turns the highest-variance comp surface from static-only to observable. Add WEEK as a typed-but-rejected unit with its own counter so the discard is measured | medium-high | medium |
| R8 | **Transparency-state geo scrapes**: add CO/WA/NY/IL/CA state-filtered listing URLs for the wired boards AND for pay-opaque agency boards (CHG et al.) — expect hourly locum ranges to appear there first; rows arrive state-attributed → first real state-keyed v2 cells | medium | low |
| R9 | **Marit Health as the crowd_survey geo prior** (per-specialty × per-state $/hr pages) + annual-cadence ingestion of the LocumTenens.com salary report and CHG State of Locum Tenens as labeled context rungs | medium | low |
| R10 | **Society-board sweep behind the ACR precedent**: ACR (mandated disclosure) first, then JAMA Career Center; audit other YM-Careers/Madgex boards (ACEP, SHM, APA, AAFP) for salary-required policies before building parsers | medium | low-medium |
| R11 | **Freshness/ops hardening**: schedule every verified source >= 2×/week (7-day cliff headroom); alert when the count of anchor-promoted cells drops run-over-run (today it can go 6→0 silently); capture JSON-LD `datePosted` into `published_at` | medium | low |
| R12 | **Single machine-readable family registry** (one JSON consumed by python dedup + both sourceFamily.ts copies) before the family list grows past ~15 entries; add trackfive/communitybrands/madgex/ingenovis/tandym/consilium/medicus + the WS1 alias set in lockstep | medium (prevents silent independence drift) | medium |
| R13 | **Per-board ToS review checklist** as a `verified=True` flip precondition (robots, ToS clause, throttle plan) — documented in `posting_sources.py` per entry | medium (risk control) | low |
| R14 | Exploratory only: SAM.gov/USASpending VA staffing awards for the BILL/cap axis (`agency_bill_rate`, never renderable) — do not spend fleet time until the cap-rates tree has a reader | low | medium |

**Named losing sides:** R2's mapping layer risks mis-mapping (e.g., `internal medicine - cardiology` → engine `cardiology` conflates invasive/non-invasive; keep `interventional cardiology` distinct — both exist on both sides). R7 stores day rates it cannot yet quote from (storage without a consumer — same shelf-ware class as `cap-rates`) — acceptable because CALL_RATE_DATA decay is the alternative. R8's legal footing for 1099 postings is unsettled (F6 caveat).

---

## Open questions

1. **Does DocCafe render per-job $ on public pages, or only behind login?** WS1 list-URL guesses 404'd (`posting_sources.py:126`). If login-gated → drop from Tier A' (no-login discipline).
2. **gaswork ToS + RSS stability**: the ~13.8K-posting figure and the 1099/W2 flag column are STATED from the WS1 catalog run — re-verify live, and confirm RSS exposes rates or only titles.
3. **Do transparency statutes bind 1099 locum postings?** (F6). Empirically scrapeable either way, but if IMS ever cites "mandated disclosure" publicly, get a real legal read.
4. **Vivian physician inventory depth**: the verified example was $87/HR (likely APP) — how many PHYSICIAN locum postings does Vivian actually carry? If thin, its value is APP-cell coverage (58 APP_fan_out cells) — which is moot until R2 (taxonomy) and APP IronDome bands exist.
5. **Health eCareers blended rates**: is the blend documented anywhere on-site (to justify a `blended` flag), or is it folk knowledge? If undocumentable → exclude entirely.
6. **Should org-recovered society boards (JAMA/ACR) count as the recovered agency family or the board engine family?** (F3 nuance). Proposal: agency when recovered, `unattributed` otherwise — confirm with a bridge re-run on real rows.
7. **Where does the fleet run from and how is cadence enforced?** EC2 cron 04:00 UTC is code-comment-verified only (map 03 header, flagged UNVERIFIED) — confirm the actual schedule before R11 alerting is designed.
8. **CHG transparency-state postings**: are any locum (hourly) CHG postings now publishing ranges in CO/WA, or only perm annual ones? Determines whether R8 recovers the single biggest pay-opaque family directly.

---

*Written by the data-sources research agent, 2026-07-03. Every $ figure and behavioral claim above is enumerated in the workflow's claims_to_verify for independent fact-checking.*
