# Brief 21 — Innovation / Net-New Moat

> Deep-dive brief, 2026-07-03. Pillar: **differentiators nobody in locum staffing offers**, ranked by
> moat strength × feasibility. Grounded in the LIVE simulator (imstaffing.ai/hub, `ias-website`
> `src/lib/rate-engine` + `src/lib/hub`) and the still-live pipeline (`agent-sdk/agents/rate_scraper`,
> `ias-dashboard/scripts/data-refresh`). Builds on maps 01–06 and the 9-move improvement plan
> (`docs/rate-simulator-IMPROVEMENT-PLAN.md`) — this brief does not re-litigate those moves; it asks
> what NET-NEW product surfaces they unlock and which are defensible.
>
> Labeling: **OBSERVED** = read from code (file:line) or a fetched/search-verified external page.
> **ESTIMATED/UNVERIFIED** = flagged inline and listed in the claims register at the end.
> No $ figure below is invented; every one is code-cited or externally attributed.

---

## Summary

The single most important finding: **most of the "innovation wishlist" is already 50–80% built in this
codebase and lying dormant.** Confidence-scored quotes are live; provenance capture (verbatim cited
spans with char offsets) exists in the Supabase schema but is deliberately unthreaded ("Phase 8"
deferral); the recruiter-feedback calibration loop is fully coded on the consumer side and consumes an
empty RTDB node; the quote-outcome telemetry tables (`quote_events` / `quote_outcomes`) are designed,
migrated, append-only, and unwired. The competitive scan confirms the whitespace is real: locum
tenens has **no Vivian, no Levels.fyi, no Marit-grade percentile tool with receipts** — agencies
publish static content-marketing ranges, and the two crowdsourced players (Marit Health, Physician
Side Gigs) are annual-salary-first communities without per-assignment factor modeling, call-comp
typing, provenance citations, or recruiter-side outcome calibration.

The durable moat is NOT any single UI feature. It is the compounding stack nobody can scrape:
**(1) proprietary placement outcomes** (won/lost/adjusted per quote — only a real staffing operation
has these), **(2) provenance-backed anti-gaming rails** (the 16-gate stack from dedup to the ≥4-obs /
≥2-family anchor gate), and **(3) the cite-or-suppress honesty culture** (insufficient-data cards
instead of fabricated numbers). Every ranked recommendation below either surfaces one of those three
assets as product, or removes a blocker (synthetic percentiles, hourly-only pipeline, manual-controls
factor gaps) that would make the surfaced feature dishonest.

Top three by moat × feasibility: **(A)** wire the outcome loop (quote logging + outcome labels →
calibration + a publishable accuracy scorecard), **(B)** ship "Explain this rate" — a provenance
drawer that shows the verbatim cited span behind a live anchor plus the factor waterfall and which
clamp fired, **(C)** the negotiation readout ("this offer is X% below the corroborated anchor for
EM · TX · nights"), gated on honest intervals (improvement-plan Move #2) so the percentile claim is
real, not the current linear interpolation.

---

## 1. Competitive landscape — what exists today (external, OBSERVED via search/fetch unless flagged)

| Player | What they offer | What they DON'T offer (the gap) |
|---|---|---|
| **Marit Health** (marithealth.com) | Anonymous give-to-get physician salary sharing; founded with ex-Glassdoor team; $3.2M seed (PRNewswire, 2025); publishes locum-specific pages — search snippet showed "Locum Tenens Physician Salary (2026) – $290/hr Avg" and "~20,466 salaries" for the physician page (direct fetch returned 403 — **UNVERIFIED at page level**, in claims register) | Annual-comp-first; self-reported, unverified against postings or placements; no per-assignment factors (shift/call/facility/duration), no call comp-model typing, no confidence scoring, no provenance citations, no recruiter-side bill/margin view |
| **Physician Side Gigs** | Crowdsourced locum comp database; search-verified average "~$215/hour" across their database | Members-only averages; same gaps as Marit; no API |
| **Vivian Health** (travel nursing, adjacent market) | Marketplace-enforced pay transparency on every listing; monthly travel-RN wage trend reports for all 50 states | Nursing, not physician locums; blended-rate opacity acknowledged in their own materials; no negotiation delta per offer |
| **Doximity Salary Map** | County-level physician comp map; 2025 report drawn from ~37,000 surveys (their claim) | **W2/permanent comp** — explicitly the wrong economic population for a 1099 locum quote (this engine's whole `permanent_wage_proxy` exclusion class exists because of that) |
| **Levels.fyi** (tech, the pattern to copy) | Percentile benchmarking, paid negotiation coaching ("$100M+ negotiated" — their claim), and a **data API/MCP/CLI product "from $800/mo"** (their pricing page, search-verified) | Tech only. Proves both the negotiation-service and the API-as-product business models on crowdsourced comp data |
| **Agencies** (CHG/locumstory, CompHealth, Weatherby, Barton, AllStar, AIMS) | Static annual "locum rates by specialty" content-marketing pages/reports (the same pages this pipeline scrapes as `scraped_article_estimate` / TUNED_SOURCES, `agent-sdk/agents/rate_scraper/sources.py:135-198`) | No interactivity, no factors, no confidence, no provenance, updated ~annually; structurally conflicted (their quote IS their margin) |
| **LocumTenens.com** | Facility-facing "ROI / cost-comparison calculator" (locums vs perm employment cost) | Not a market-positioning tool; no pay-side percentile, no live data |
| **VMS/MSP rate cards** (e.g. healthcare VMS platforms) | Internal bill-rate benchmarking for facilities | Closed, facility-side, bill-rate-only; nothing physician- or recruiter-facing on pay |

**Whitespace statement (the pitch):** nobody in locum staffing offers a per-cell (specialty × state ×
comp-model) quote with (a) a corroboration-gated live anchor, (b) a citation you can click, (c) an
honest confidence label with the limiting factor named, and (d) an offer-vs-market delta. Every
ingredient exists in this codebase; none is fully surfaced.

---

## 2. Findings — the dormant-moat inventory in the codebase (all OBSERVED, file:line)

### F1. Confidence-scored quotes are ALREADY LIVE — the only one of its kind we found
- Displayed confidence = the **weaker** of identification confidence and data-tier confidence, with
  an honest limiting-factor sentence (`sim-adapter.ts:256-278`; `weakerConfidence` :263-270), rendered
  as a pill with tooltip (`sim-render.ts:15-26`).
- Since the 2026-06-30 honesty downgrade, **zero curated bands are 'high'** — 'high' is earned only by
  a live market-typed posterior passing the anchor gate (`marketRates.ts:448-456`; memory-confirmed).
- Gap that keeps this from being a marketable differentiator: the confidence is one composite chip.
  Improvement-plan Move #6 (split into Input / Market-coverage / Volatility chips) is the productized
  version.

### F2. Provenance is captured end-to-end but surfaced nowhere — "Explain this rate" is one threading pass away
- Supabase `rate_intelligence` already has `cited_text`, `char_range_start`, `char_range_end`,
  `employment_evidence_span` (migration `20260602000000_rate_source_chunks_and_cited_columns.sql:201-211`),
  plus a fetch-once chunk store `rate_source_chunks` for the raw page text.
- The bridge types these columns but the read-path threading is **explicitly deferred**: "The bridge
  SELECT projection, MarketBucketData threading, and UI surfacing are DEFERRED to Phase 8 (PROV-04)"
  (`ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts:57-66`).
- The hub already renders provenance crumbs — `provenance: 'curated' | 'live'` chip
  (`specialties.ts:36`), call-only source counts + notes (`sim-render.ts:106`), clamp disclosures
  (`maxNoteHTML`/`capNoteHTML`, `sim-render.ts:79-89`), and the factor waterfall
  (`sim-render.ts:29-41`). What's missing is the last mile: "this anchor = weighted posterior of N
  observations from families [X, Y]; here is one verbatim cited span."

### F3. The outcome loop is designed, migrated, and dark — the highest-moat asset in the system
- `quote_events` (append-only, one row per logged quote, with D-10 engine-state snapshot: confidence,
  is_call_only, comp_model, market_max_applied, calibration_applied, raw_pay) and `quote_outcomes`
  (6-value CHECK enum `won|lost|pushed_back|walked|adjusted|abandoned`, re-labeling accretes rows)
  exist in prod migrations (`20260604000000_quote_regret_telemetry.sql:123-168`), RLS default-deny,
  service-role edge functions planned (log-quote / label-outcome / list-quotes).
- The engine-side consumer is also built: `loadSpecialtyCalibration` / `computeDisplayedRate` /
  `applyCalibration` — last-10 accepted-vs-simulated ratio, 50% dampened, clamped [0.85, 1.15], n≥3
  gate (`marketRates.ts:784-995`) — and has **zero hub callers** (map 02 §7).
- Nothing writes: RTDB `rate-simulator/feedback` is empty (program memory), and — a blocker to fix
  BEFORE wiring — that node is **world-writable** (`ias-dashboard/database.rules.json:26-47`:
  `.write: true` with only shape validation). Promoting feedback to anything weight-bearing without
  locking that rule would hand adversaries a quote-moving pen.
- Why this is the moat: won/lost/adjusted outcomes per quoted cell are **unscrapable**. Marit/PSG/
  agencies can copy a UI; only an operating staffing firm generates outcome ground truth. This is
  also the enabling asset for improvement-plan Moves #4, #7 (interval calibration), #8 (drift), #9
  (bandit), and for a publishable accuracy scorecard (F8).

### F4. The negotiation readout is one honest-interval away — and today's percentile is synthetic
- The market-position bar + percentile chips exist (`sim-render.ts:50-76`) but percentiles are
  **linear interpolation across [min, max]** (`sim-adapter.ts:254,372`; `rateCalculator.ts:50-53`) — a
  uniform-distribution assumption, not observed quantiles (map 01 seam 2; map 03 S6). A "your offer is
  at p38" claim built on this would be fabricated shape.
- The v2 posterior carries `weighted_mean/median/weighted_variance/n_distinct/source_families`
  (`marketRates.ts:84-94`) — enough for an honest "offer vs corroborated anchor" DELTA today
  ("$X is 8% below the anchor for this cell, which is corroborated by N observations from ≥2
  families"), even before Move #2 ships real intervals. Percentile language must wait for Move #2/#3.

### F5. Call comp-model typing is a unique data asset — and the live pipeline starves it
- No public tool distinguishes 24-hr beeper vs worked-day call economics. The engine does, first-class:
  `CallCompModel` (`types.ts:229-233`), per-day-type bands with `coverageHrs` as the honest $/hr
  divisor (`rateCalculator.ts:811-812`), cite-or-suppress per specialty (`callRates.ts:34-353`), and an
  honest insufficient-data card (`sim-render.ts:107-113`).
- But only 19/88 specialties have a quotable daily band, all holiday bands are null (map 01 §6), and
  the scraper drops every DAY-unit observation before persistence (`agent-sdk/agents/rate_scraper/agent.py:491-493`)
  while the overlay mutates hourly `SPECIALTIES` only — **there is no call-band overlay path even
  designed** (map 05 seam 1). The most differentiated quote surface has no live-corroboration route.

### F6. Total-comp breakdown is carried but never priced
- `gratisHrs`, `callbackRate`, `includedHrs` ride the type system and renderer but change no dollar
  (`rateCalculator.ts:836-874`; map 05 §2.2). GSA FY2026 lodging/M&IE tables ship in the bundle with
  **zero hub consumers** (`callRates.ts:378-404`; map 05 §2.3). Sign-on/completion bonuses are
  actively filtered as noise, never captured (`card_extractor.py:88-90`). A "base + call stipend +
  expected callback + travel context" per-factor quote — the anti-"blended rate" pitch that Vivian's
  own materials concede is opaque in travel nursing — is therefore net-new work on mostly-existing
  rails.

### F7. The anti-gaming gate stack is a certifiable trust asset
- The full chain (canonical view allowlist → quarantine → never-anchor sources → validity → two-stage
  dedup at evidence_weight 1.0 → family collapse-then-cap ≤60% → MAD z>3.5 + IVW + bimodal-null →
  reader shape/freshness/m6 strip → anchor gate market-typed ∧ n≥4 ∧ ≥2 families) is enumerated in
  map 03 §7 with file:line for every rung. Competitors publish numbers; none can publish a
  gaming-resistance argument. This is marketable as-is (a "how our quotes can't be bought" page) —
  with ONE prerequisite: the RTDB write-rules audit (map 03 S5) so the claim is true at the trust
  boundary, and noting `rate-simulator/feedback` is currently world-writable (F3).

### F8. "Quote-regret" accuracy scorecard — the migration already names the concept
- `20260604000000_quote_regret_telemetry.sql:11-16` frames quote_events as "the only fast outcome
  signal IAS controls." Plus `rate_audit_log` (simulated-vs-actual drift backtesting,
  `medical-staffing/agent_tables_setup.sql:85-95`) exists from the earliest DDL. A monthly published
  "simulator vs booked" error stat (MAPE per specialty tier) would be the industry's first
  accuracy-audited rate tool. Nobody in the table in §1 publishes accuracy.

### F9. Portability is architecturally pre-paid
- The Phase-1 barrel is pure (no firebase value-imports; `index.ts` vs `index.phase2.ts` split, map 01
  appendix); `quoteFromFactors` is a pure shaping function (`sim-adapter.ts:305-377`); rendering is
  pure HTML-string builders (`sim-render.ts`). The one anti-pattern for a headless core is the
  SPECIALTIES singleton mutation as the overlay mechanism (`sim-live.ts:12-17`; map 01 seam 3).
  Extraction cost is real but bounded — and the bridge's shared modules physically living inside the
  dead dashboard app (map 03 S1) must move in the same pass.

### F10. Geo story: honest but modeled; observed geo is empty
- STATE_MULT is derived from OBSERVED inputs (BEA RPP 2024, HRSA AHRF 2024-25 density) with
  ESTIMATED analyst weights (`stateData.ts:149-173`; map 01 §11). Every live v2 bucket today is
  `stateKey='national'` (map 03 S7). A heatmap is render-cheap, but an honest one must be two-layer:
  "modeled geo multiplier" (all 50 states) vs "observed state anchor" (currently none) — or it
  becomes exactly the fabricated-precision trap the engine's culture forbids.

---

## 3. Ranked differentiators (moat strength × feasibility)

Scoring: moat = how hard for a competitor (agency, Marit, a VMS) to replicate within ~12 months;
feasibility = how much of it already exists in this codebase. 1–5 each.

| # | Differentiator | Moat | Feas. | Product one-liner | Blockers |
|---|---|---|---|---|---|
| 1 | **Outcome-calibrated quotes + accuracy scorecard** (F3, F8) | 5 | 4 | "The only rate tool calibrated on real placements — and we publish our error rate." | Lock world-writable feedback node; recruiter workflow buy-in; needs months of volume before scorecard is publishable |
| 2 | **"Explain this rate" provenance drawer** (F2, F7) | 4 | 4 | "Click the number, see the receipts: cited span, source families, which gate fired, which clamp bound it." | Phase-8 threading (bridge SELECT → MarketBucketData → hub); PII/ToS review on showing verbatim scraped spans |
| 3 | **Offer-benchmark negotiation readout** (F4) | 4 | 3 | "Paste the offer: 8% below the corroborated anchor for EM·TX·nights; here's the band and why." | Honest intervals (Move #2/#3) before ANY percentile language; delta-vs-anchor version shippable sooner |
| 4 | **Locum Rate Index** — weekly per-specialty trend feed from the posterior tree (Vivian's monthly report, done better) | 3 | 4 | "The first weekly locum rate index, corroboration-gated." | Only publish cells passing the anchor gate; thin-cell suppression to avoid leaking noise as trend; SEO/brand play, also seeds API demand |
| 5 | **Rate API-as-product** (F9; Levels.fyi precedent at "$800/mo") | 4 | 3 | "Confidence + provenance + comp-model typing in a JSON payload; Discord/Slack/ATS first, external later." | Headless-core extraction (portability pillar); antitrust/legal review before selling rate data to other staffing firms (see Open Questions); anti-manip gates must travel with the core |
| 6 | **True total-comp / per-factor quote** (F5, F6) | 4 | 2 | "Base + call stipend + expected callback + travel context — no blended-rate fog." | DAY-unit ingestion (`agent.py:491-493` deliberate deferral); call-band overlay path doesn't exist; GSA table refresh mechanism; expected-callback utilization model must be observed, not invented |
| 7 | **Scenario comparison + shareable quote permalink** | 2 | 5 | "Pin quote A (TX, nights, 12wk) next to quote B (NM, days, 26wk); send the link." | None — pure functions make this UI-only; permalink doubles as the quote_events capture hook (synergy with #1) |
| 8 | **Anti-manipulation certification page** (F7) | 3 | 5 | "Why our quotes can't be gamed — the 16-gate stack, published." | RTDB write-rules audit first (map 03 S5) or the claim is false at the boundary |
| 9 | **Geo heatmap (two-layer honest)** (F10) | 2 | 3 | "Modeled state multipliers today; observed state anchors light up as the fleet covers them." | State attribution on live rows is 100% NULL today; must not imply observed geo where none exists |
| 10 | **Physician give-to-get rate sharing (Marit-for-locums)** | 4* | 2 | "Share your last locum rate, unlock the market." | *Network-effect moat only if it reaches critical mass; Marit is funded and already publishing locum pages; channel conflict (IMS is an agency — physicians may distrust an agency-run give-to-get); classify as WATCH/PARTNER, not build-now |

Reading the table: #1 and #2 are the moat; #7 and #8 are the cheap wins that make the moat visible;
#3–#5 are the growth surfaces; #6 is the deepest accuracy differentiator but sits behind pipeline
work; #9–#10 are deliberately deprioritized with reasons.

---

## 4. Recommendations (each tagged impact + effort)

**R1. Wire the outcome loop end-to-end — capture UI → `quote_events`/`quote_outcomes` → calibration →
scorecard.** [impact: HIGH | effort: MEDIUM]
Sequence: (a) lock `rate-simulator/feedback` write rules (it is `.write: true` today,
`database.rules.json:26-47`) or bypass RTDB feedback entirely and write through the planned
service-role edge functions to Postgres; (b) add a one-tap "Log this quote" + later outcome label in
the hub result panel (the D-10 snapshot columns are already designed to be captured "free now,
impossible to backfill later" — migration comment :116-118); (c) only then enable
`computeDisplayedRate` calibration with its existing 0.85–1.15 clamp; (d) after ≥1 quarter of volume,
publish the accuracy scorecard (F8). This is improvement-plan Move #4 reframed as the moat product,
not just instrumentation.

**R2. Ship "Explain this rate": thread `cited_text`/char-ranges through the bridge into
`MarketBucketData` and render a provenance drawer.** [impact: HIGH | effort: MEDIUM]
The deferral is explicitly marked (`aggregateBridge.ts:57-66`). Drawer contents, all existing data:
anchor value + n_distinct + source_families (already in the bucket), one-to-three verbatim cited
spans with source URLs, the factor waterfall (exists), which clamp fired (`capped` /
`marketMaxApplied` / `payCap` — exists), and the confidence limiting-factor sentence (exists). Legal
pass on republishing verbatim scraped snippets (fair-use posture, ToS) before launch.

**R3. Negotiation readout v1 (delta-vs-anchor), v2 (percentile) gated on Move #2 intervals.**
[impact: HIGH | effort: MEDIUM (v1) / HIGH (v2)]
v1 needs no new math: input an offered rate → render distance from the cell's quote anchor + band,
with the confidence chip and "corroborated by N observations / M families" line — every term
code-backed. v2 (true "you're at p38") REQUIRES observed quantiles or shrunken intervals
(improvement-plan Moves #2/#3); do not ship percentile language on the current linear interpolation
(`sim-adapter.ts:372`) — that would violate the no-fabrication rule the whole system is built on.

**R4. Fix the manual-controls factor gap so the flagship features are credible.** [impact: HIGH |
effort: LOW-MEDIUM]
The manual sim hard-codes `facility: community`, `call: false`, `holiday: false`
(`sim-adapter.ts:139-142`) — a recruiter pricing a CAH (+22%) with q4 call cannot express either
(map 05 smell 10). Every recommendation above quotes a cell; if the recruiter can't specify the
cell's real factors, the negotiation delta and the explanation drawer inherit the error. Add
facility + call + holiday controls to the hub UI (engine already prices them).

**R5. Launch the weekly Locum Rate Index as content + API seed.** [impact: MEDIUM-HIGH | effort:
LOW-MEDIUM]
A cron artifact off the existing posterior tree: per specialty passing the anchor gate, publish
anchor + week-over-week delta + n/family counts; suppress everything else. Vivian's monthly RN wage
report is the proven pattern in the adjacent market; nobody does it for locums. Doubles as the
public demo of the data pipeline and the top of the API funnel.

**R6. Headless core extraction, then API — internal consumers first.** [impact: MEDIUM-HIGH |
effort: HIGH]
Order: extract the pure core (kill the SPECIALTIES-mutation overlay in favor of a pure
(staticTable, posterior) → quotedTable function — map 01 seam 3), move the bridge's shared modules
out of the dead app (map 03 S1), THEN expose Discord/Slack/ATS consumers (already-scoped portability
targets), THEN price an external API. Do not sell externally before the antitrust question (Open
Questions #2) is resolved.

**R7. Open the DAY-unit / call-band live path.** [impact: HIGH | effort: HIGH]
This is the deepest accuracy-and-differentiation unlock (F5): persist DAY-unit observations (the
deliberate deferral at `agent.py:491-493`), add a call-band overlay path parallel to
`applyMarketBucketsOverlay`, and only then market the beeper-vs-worked-day typing as a headline
feature. Until then, call-only quotes decay on a static 2026-06-03 research snapshot
(`callRates.ts:4-7`).

**R8. Publish the anti-manipulation page after the RTDB rules audit.** [impact: MEDIUM | effort: LOW]
Marketing artifact from map 03 §7's gate stack. Prerequisite: verify `rate-simulator/*` write rules
match the documented posture (map 03 S5) and fix the feedback node. A trust claim that fails a pen
test is worse than no claim.

**R9. Geo heatmap only in the two-layer honest form.** [impact: MEDIUM | effort: MEDIUM]
Layer 1: modeled STATE_MULT choropleth, labeled "modeled from BEA/HRSA inputs." Layer 2: observed
state anchors, which today is an empty set (map 03 S7) — the empty layer is itself honest roadmap
signaling ("state-level observation coverage: 0% → watch it fill"). Skip until after R5 unless a
sales need appears.

**R10. Treat Marit as a watch/partner item, not a build target.** [impact: MEDIUM | effort: LOW]
Their locums surface (search-verified pages; $ figures unfetched/403) makes give-to-get-for-locums a
contested space with a funded, Glassdoor-pedigree incumbent — and an agency-run clone has an
inherent trust handicap. Consider instead: Marit/PSG data as a `crowd_survey`-class context source
(never anchorable — the rate_type taxonomy already handles exactly this class,
`shared/rate_type_classifier.py:59-67`), or a data partnership.

---

## 5. Open questions

1. **RTDB write-rules ground truth (blocker for R1/R8).** `database.rules.json` in the repo says
   market trees are admin-write-only but `feedback` is world-writable; is the DEPLOYED ruleset
   identical? Needs the live rules export (map 03 S5 flagged the same).
2. **Antitrust posture for selling rate data to other staffing firms (R5/R6).** Compensation-data
   exchange among competitors is a regulated area; the old DOJ/FTC healthcare safe-harbor guidance on
   wage surveys (aggregation, data age, contributor minimums) was withdrawn in 2023 per our
   recollection — **UNVERIFIED, needs counsel + a source** before any external API or index publishes
   agency-attributable rates. The index/API design should assume aggregated, multi-source,
   non-attributable cells only (the family-collapse machinery already enforces the shape).
3. **Verbatim-span republication (R2).** Can `cited_text` spans from scraped agency pages be shown to
   authed recruiters (internal tool) vs publicly? Likely different answers; needs a legal read.
4. **Physician-facing vs recruiter-facing tension.** The same transparency that wins physician trust
   (offer deltas, provenance) exposes the pay/bill spread recruiters manage. Decide the audience
   boundary per surface BEFORE building R3's physician mode: hub (recruiter, full bill/margin view)
   vs any public surface (pay-side only, no margin math). The bill calculator (`sim-render.ts:142-174`)
   must never leak to a public surface.
5. **Outcome-label incentive design (R1).** `quote_outcomes` only compounds if recruiters label
   consistently. What's the workflow hook — LocumSmart webhook auto-labeling
   (`confirmationAgreementId` = confirmed, per memory) vs manual? Auto-labeling from the existing
   webhook is the durable path and needs a design pass.
6. **Marit data quality/n for locums.** If their locum cells are thin, they're a citation-class
   context source at best; if deep, a partnership target. Needs an actual fetch/count (their pages
   403 basic fetchers).
7. **When does the accuracy scorecard become publishable?** Define the minimum n per specialty tier
   and the error metric (MAPE vs interval-coverage) before marketing writes checks the data can't
   cash.

---

## Claims register (for the fact-checker)

External / $ / corporate claims asserted above, each needing independent confirmation:

1. Marit Health locum pages state ~$290/hr average locum physician pay (search snippet; page fetch
   returned 403).
2. Marit Health raised a $3.2M seed round led by Define Ventures with Rich Barton participating
   (PRNewswire release, 2025).
3. Marit physician salary page claims ~20,466 shared salaries with median $414K (search snippet,
   June 2026).
4. Physician Side Gigs' crowdsourced locum database average is ~$215/hr.
5. Vivian Health requires transparent pay on listed jobs and publishes monthly travel-RN wage trend
   reports covering all 50 states.
6. Doximity's 2025 Physician Compensation Report is based on ~37,000 surveys (2024 collection) and
   reported a 3.7% average comp increase 2023→2024; its salary map is county-level and W2-oriented.
7. Levels.fyi sells compensation data/API access "from $800/mo" and claims "$100M+ in negotiated
   increases" for its negotiation service.
8. LocumTenens.com's public interactive tool is a facility-facing locums-vs-employment cost
   comparison calculator (not a pay-percentile tool).
9. CHG/locumstory publishes an annual locum-tenens compensation-trends report (content marketing,
   not interactive).
10. DOJ/FTC withdrew the healthcare antitrust policy statements (including the wage/comp-survey
    safe-harbor guidance) in 2023 — UNVERIFIED from this session; needs a primary source and counsel
    review before R5/R6 external launch.
11. "No locum-tenens competitor currently offers confidence-scored, provenance-cited, per-assignment
    interactive quotes or an offer-vs-market negotiation readout" — a negative claim based on this
    session's search coverage; a fact-checker should attempt to falsify it (check: Medicus, Hayes
    Locums, Interimity, LocumsMart/Aya Locums, Wapiti, AMN's Passport-style tools).

Internal figures cited to file:line (e.g., 19/88 call-band coverage, 0.85–1.15 calibration clamp,
$800/mo is external not internal, 16-gate stack) are code-OBSERVED and verifiable by opening the
cited lines; they do not require external fact-checking.
