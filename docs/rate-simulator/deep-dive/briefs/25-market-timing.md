# Brief 25 — Market Timing / Temporal Dynamics

> Deep-dive research brief, 2026-07-03. Pillar: **rates are a time series, not a constant.**
> Scope: seasonality, demand-surge events, secular trends, staleness decay — the external
> evidence that these effects exist, and the concrete mapping onto the LIVE engine
> (imstaffing.ai/hub, served by `ias-website` — `src/lib/rate-engine` + `src/lib/hub`) and the
> still-live pipeline (agent-sdk scraper → Supabase `rate_intelligence` → ias-dashboard bridge
> → RTDB `market-rates-v2`).
>
> Labeling discipline: **OBSERVED** = read from code (file:line) or a named external source.
> **ESTIMATED** = derived/engineering value, labeled. **UNVERIFIED — needs a source** where noted.
> Every external $ / % claim is also listed in the fact-checker queue (claims_to_verify).

---

## Summary

The engine today models time as a **binary 7-day cliff**: an observation inside the window
carries full weight, outside it ceases to exist. There is **no recency weighting, no trend
detection, no seasonality concept, no surge machinery, and no staleness story for the curated
priors at all** (live data has a hard 7-day SLA; curated bands have an *infinite* SLA and no
as-of metadata). Meanwhile the raw material for temporal modeling already exists and is being
thrown away twice: Supabase `rate_intelligence` retains every dated observation (no TTL) but
the bridge reads only the trailing 7 days, and the RTDB posterior tree is whole-node-replaced
daily so **no posterior time series is retained anywhere**.

External evidence says the timing pillar is real and material: locum *demand* seasonality is
consistently documented (winter respiratory season, summer PTO/vacation gaps, holiday
coverage, the July academic-year turnover boundary); demand-surge events move temporary
staffing pay by **2–3×** (documented for strike nursing and the 2022 pediatric tripledemic —
the closest quantified analogs to physician locums); and secular specialty trends are large
and fast — CHG's 2025 State of Locum Tenens report has **anesthesiology demand +55% YoY** while
EM *declined* 8%, and published locum rate bands moved **+3% to +22% YoY** by specialty from
2024→2025, with a documented *downward* correction regime in the adjacent travel-nurse market
(bill rates **−20% YoY** 2022→2023). Direction and rough magnitude of demand effects are
citable; **the month-by-month amplitude of locum *rate* seasonality is not published anywhere
I could find** — it must be measured from our own observation spine, which means the single
highest-leverage move is to **start accumulating posterior history now** (a one-table,
one-INSERT bridge change) so that trend and seasonality work has data under it in 6–12 months.

The near-term buildable set (no new data needed): daily posterior snapshots; exponential
recency decay through the already-designed-but-unused `evidence_weight` hook with an
**effective-n** (Kish) version of the anchor gate; a per-cell freshness SLA with an alert on
promotion-count drops (closing seam S11); and honest "as-of" surfaces in the hub UI for both
live anchors and curated snapshot dates. Trend detection per cell becomes feasible on the
first ~19 bridged cells after ~3–6 months of snapshots; a measured seasonal adjustment needs a
full annual cycle (~mid-2027) or must remain a labeled demand-context flag driven by external
proxies (CDC FluView), never a fabricated rate multiplier.

---

## Findings

### A. What the engine does with time today (OBSERVED from code)

**A1. The 7-day binary cliff, enforced twice.**
The bridge reads `canonical_rate_intelligence WHERE date_scraped >= NOW() - 7 days`
(`ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:99-101` `RATE_READ_WINDOW_DAYS = 7`;
SELECT at `:306-314`). The live reader independently enforces the same window:
`RATE_READ_WINDOW_MS = 7 * 86400000`
(`ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/marketRates.ts:136`) via
`isFreshBucket()` (`marketRates.ts:154-158`) — a missing/zero `lastUpdated` is treated as
stale, never epoch-fresh (`marketRates.ts:150-151`). Inside the window an observation has
weight 1.0; one second outside, weight 0. There is no intermediate state.

**A2. The posterior is time-blind; the decay hook already exists but is never used.**
Every distinct observation enters `aggregateCell()` at flat `evidence_weight = 1.0` (D-36 —
"Raw multiplicity NEVER inflates weight", `ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts:92,130-131`).
The only temporal computation in the whole aggregation path is `recencyKey()`
(`aggregateBridge.ts:239-246`, `date_scraped` with `published_at` fallback), used solely as a
latest-wins tie-break in Stage-1 dedup. Yet the shared aggregation module *documents a
temporal weight hook that nothing exercises*:
`evidence_weight: number // post-dedup; usually 1.0 unless multi-day-confirmed`
(`ias-website/.../src/lib/rate-engine/cellAggregation.ts:79`) and "production weights are 1.0
typical, multi-day-confirmed up to ~3.0" (`cellAggregation.ts:118`). The IVW math
(`w = evidence_weight / variance`, `cellAggregation.ts:341`) would accept non-flat weights
today with zero algorithm change — the same property the family cap (D-33/D-37) already
relies on. **A recency-decay scheme can ride the existing hook without touching the posterior
math.**

**A3. Repeat-confirmation signal is partially destroyed by design.**
Stage-1 dedup collapses the same URL + same value across **different dates** to the latest
observation (the "cadence-inflation kill", `aggregateBridge.ts:267-281` per Map 03 §3.2). This
is correct for independence honesty, but it means "this rate has persisted for 6 weeks" — the
exact evidence the `multi-day-confirmed` weight hook was designed for — is discarded before
aggregation. Cross-URL re-observations on different dates *do* survive as distinct
observations (dedup_group_id folds `date_key`, so different-date near-dups get different
groups — `agent-sdk/shared/dedup_group_id.py:43-85` per Map 03 §1). Persistence evidence
therefore exists in the raw Supabase rows but never reaches the posterior.

**A4. History exists in exactly one place and is read by nothing.**
`rate_intelligence` retains every row indefinitely (`date_scraped DATE NOT NULL DEFAULT
CURRENT_DATE`, `medical-staffing/agent_tables_setup.sql:71`; no TTL/cleanup anywhere in the
migrations — Map 06 §1.1; ~55k rows STATED in migration comments). The bridge reads only the
trailing 7 days. The RTDB v2 tree is a **whole-node replace per specialty per run**
(`bridge-rate-intelligence.ts:884-907`), so no posterior history is retained; `bridge_runs`
stores telemetry *counters*, not posterior values. **Consequence: today we could reconstruct a
cell's rate time series only by re-running aggregation over Supabase history — nothing stores
the daily posterior, and the observation spine only goes back to 2026-05-20** (canonical view
boundary, `20260521203841_evidence_canonicalization_a2.sql:709-716`). Every month of delay in
snapshotting posteriors is a month of trend history lost.

**A5. The only recency-aware component in the live engine is the (empty) feedback
calibration.** `loadSpecialtyCalibration()` sorts feedback entries by timestamp descending and
computes the adjustment from the **last 10 entries** with 50% dampening and a ±15% clamp
(`marketRates.ts:828-853`). Note this is a *count* window, not a *time* window: if only 10
entries exist and they are six months old, they carry full weight. The prod feedback tree is
empty as of 2026-06-30 (STATED, improvement-plan finding — verify), and the tree is
world-writable (`ias-dashboard/database.rules.json:27-33`, Map 06 seam 4), so any temporal use
of this stream must also solve poisoning.

**A6. Temporal-adjacent statics that DO price, and what they are not.**
- `SHIFT_MULT.holiday = 1.35` (`src/lib/rate-engine/multipliers.ts:18`) is a **day-type
  premium** for working a holiday shift — not calendar seasonality (it fires per-assignment
  regardless of what month the quote is made in).
- `DURATION_MULT.emergency = 1.20 / short 1.10 / long 0.95` (`multipliers.ts:39-44`) is the
  engine's only demand-urgency lever — assignment-scoped, ESTIMATED (research-derived band
  midpoints, no inline citation), and static. It encodes "this fill is urgent," not "this
  market is surging."
- `STATE_DEMAND_CLASS` is a static analyst classification carrying **0.40 weight** in the geo
  multiplier formula (`src/lib/rate-engine/stateData.ts:7,100,154-167`) — a frozen snapshot of
  secular demand with no refresh cadence or as-of stamp.

**A7. Curated priors have no staleness metadata anywhere.**
`specialties.ts` cites "2025-2026 Locum Tenens Market Data … LocumStory 2025 (CHG), OnCall
Solutions 2024, TheLocumGuy, ResidencyAdvisor 2025, FastRVU 2026" in a header comment only
(`specialties.ts:3-5`); `CALL_RATE_DATA`'s research snapshot is the 2026-06-03 deep-research
PDF (`callRates.ts:4-7`, per Map 05); the GSA per-diem table is hardcoded FY2026
(`callRates.ts:379-404`). **No `asOf` field exists on any curated band**, and the hub renderer
surfaces only "N public sources · note" (`src/lib/hub/sim-render.ts:106-111`) — a recruiter
cannot see how old the number they are pricing off is, for either curated or live data (no
data-age display found anywhere in `src/lib/hub`, grep OBSERVED). Given locumstory's own
2024→2025 band moves of +3% to +22% (Finding B4), a curated band left un-audited for 12 months
is plausibly off by double digits for hot specialties.

**A8. The 7-day cliff has a silent failure mode (seam S11, Map 03 §6).**
Bridge window = reader gate = 7 days, so **one week of fleet/bridge outage silently reverts
every promoted cell to its curated band** with no operator-facing signal. Nothing alerts on
"promotions went 6 → 0." Any staleness-decay redesign should ship with this alert regardless.

**A9. Observation dating is biased toward "when we saw it," not "when the market priced it."**
`published_at` uses an honest scrape-date floor when the page has no date, and posting-path
rows *always* use the scrape-date floor (`agent-sdk/agents/rate_scraper/agent.py:581-583`, Map
04 §4). A 90-day-old stale posting scraped today therefore looks fresh. Honest as an upper
bound, but it systematically *underestimates observation age* — any decay scheme keyed on
`date_scraped` inherits this bias, and job boards are full of stale reposts. (The Stage-1
dedup kills *re-scrapes of the same URL*, not *old content freshly scraped*.)

**A10. Zero seasonality anywhere.** Grep for season/flu/surge/trend/decay concepts across
`src/lib/rate-engine`, `src/lib/hub`, and the scraper finds no calendar logic of any kind
(OBSERVED — the only "holiday" is the shift type; the only "stale" is cache/freshness
plumbing).

### B. External evidence: the temporal effects are real (cited)

**B1. Demand seasonality — direction well documented; rate amplitude NOT published.**
- Winter respiratory season measurably multiplies demand in ED/hospitalist/peds/urgent-care:
  influenza-like-illness ED visits ran ~**2× the non-holiday median during Christmas/New Year
  weeks** (median 42.5 vs 24 visits/day) and up to **+61% during Christmas week** vs the week
  before, in a 2004–2014 Edmonton ED study
  ([PMC5155650](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5155650/)).
- Agency-side (direction, agency-blog tier): fall/winter flu season and the holiday PTO block
  are peak locum demand; early spring is the documented trough; summer brings PTO-driven
  coverage gaps plus trauma/travel volume
  ([MPLT Healthcare](https://www.mplthealthcare.com/solving-seasonal-staffing-shortages-locum-tenens/),
  [TheraEx Locums](https://theraexlocums.com/2024/08/09/seasonal-trends-in-locum-tenens-understanding-peak-times-and-slow-periods/),
  [CompHealth summer specialties](https://comphealth.com/resources/top-locum-specialties-summer-2026),
  [Locums National holiday coverage](https://www.locumsnational.com/blog/100006/maximize_holiday_coverage__with_locum_tenens)).
- July academic turnover: the residency-transition boundary is real and large — the 2026 Main
  Residency Match was the largest on record (44,344 positions offered, 41,482 filled; family
  medicine fill rate 84%, ~900 unfilled positions — NRMP figures via
  [Locumpedia Digest #117](https://www.locumpedia.com/news/locums-digest-117/)). Physicians
  overwhelmingly start/leave jobs around July 1 and academic coverage rotates; agencies market
  summer as a predictable stress point. **The magnitude of a July locum-rate effect
  specifically is UNVERIFIED — needs a source.**
- **Negative finding (load-bearing):** no public source I found quantifies locum *rate*
  seasonality (e.g., "EM hourly rates run +X% in January vs June"). Demand seasonality is
  documented; **price seasonality must be measured from our own data** — attempting to ship a
  seasonal rate multiplier from public sources today would be fabrication.

**B2. Demand-surge events — documented 2–3× pay effects in the closest quantified analogs.**
- **Strikes (nursing analog):** NYC hospitals paid replacement nurses up to **$9,000/week,
  ≈3× the typical average**, during the January 2023 strike
  ([KFF Health News](https://kffhealthnews.org/morning-breakout/ny-hospitals-woo-replacement-nurses-with-9000-a-week-pay-during-strike/));
  strike nursing "pays significantly more than standard travel assignments — often 2× or
  more" ([Wanderly](https://www.wanderly.us/blog/strike-nursing/)); 2026 strike assignments in
  Oregon listed up to **$12,250/week**
  ([Nurse.org strike list](https://nurse.org/articles/nurse-strikes-list/)). Physician strikes
  are rare in the US, so nursing is the quantified proxy; **a US physician-strike locum
  premium magnitude is UNVERIFIED — needs a source.**
- **Epidemic surge:** during the 2022 "tripledemic," pediatric ED visits and hospitalizations
  ran **nearly 3× typical values** for the season
  ([PMC11246698](https://pmc.ncbi.nlm.nih.gov/articles/PMC11246698/)), with children's
  hospitals deploying temporary staff
  ([NPR](https://www.npr.org/2022/10/24/1130764314/childrens-hospitals-rsv-surge)).
- **Urgent-fill premium (steady-state micro-surge):** facilities facing immediate gaps "often
  pay premium rates **20–40% above standard compensation** to secure emergency locum coverage"
  ([All Star Healthcare Solutions](https://allstarhealthcaresolutions.com/blog/emergency-medicine-salary-guide/)
  — agency-blog claim). Notably this bracket brackets the engine's static
  `DURATION_MULT.emergency = 1.20` (`multipliers.ts:40`) — the one urgency number we ship is
  at the *bottom* of the claimed market band.
- **The full boom-bust envelope (COVID travel nursing):** average weekly travel-nurse pay went
  **$1,706 (Dec 2019) → $3,290 (Dec 2021)**, ≈+93% in 24 months
  ([Health Affairs Forefront](https://www.healthaffairs.org/do/10.1377/forefront.20220125.695159/));
  US travel-nurse revenue roughly **tripled to ~$11.8B in 2021** (SIA, via
  [Healthcare Dive](https://www.healthcaredive.com/news/hospital-lobbies-congress-FTC-travel-nurse-rate-caps-COVID/618194/)).
  This is the existence proof that temporary clinical staffing rates can double inside two
  years under a demand shock.

**B3. Rates also go DOWN — decay/trend design must be two-sided.**
The post-COVID correction: average travel-nurse **bill rates fell from $133.47 (2022) to
$106.78 (2023), −20% YoY** (SIA/NATHO benchmarking, via
[Staffing Industry Analysts](https://www.staffingindustry.com/editorial/healthcare-staffing-report/after-pandemic-boom-travel-nursing-finds-new-footing)).
A stale observation from a peak regime overprices the market a year later by ~20% — exactly
the failure the north star ("the rate we would actually pay") cannot tolerate. Any recency
scheme that only *promotes* fresh-high observations (ratchet) would have quoted 2022 prices
into 2023.

**B4. Secular specialty trends are large, fast, and divergent by specialty.**
- CHG's 2025 State of Locum Tenens report: organizations' actual locum utilization ran **25%
  higher than anticipated** going into 2024; **anesthesiology demand +55% YoY — while
  emergency medicine demand *declined* 8% YoY**; ~80% of facilities expect flat-or-increasing
  usage in 2025; one physician vacancy ≈ **$2.6M/yr** lost revenue
  ([CHG newsroom](https://chghealthcare.com/newsroom/locum-tenens-2025-usage-jumps),
  [Business Wire 2025-10-29](https://www.businesswire.com/news/home/20251029104102/en/Report-Locum-Tenens-Usage-Jumps-25-as-Health-Systems-Combat-Physician-Shortages-and-$2.6M-Revenue-Gaps),
  [full report PDF](https://chghealthcare.com/documents/State_of_Locum_Tenens_2025_Full_Report.pdf)).
  Demand trend **sign differs by specialty in the same year** — a single global drift term is
  wrong by construction; trend must be per-cell.
- Published locum rate bands, 2024 → 2025
  ([locumstory 2025 compensation trends](https://locumstory.com/spotlight/locum-tenens-compensation-trends), CHG):
  anesthesiology **$275–325 → $300–400/hr** (midpoint ≈ +16.7%); orthopedic surgery
  **$150–210 → $200–240** (midpoint ≈ +22%); EM **$125–300 → $200–300** (floor +60%, midpoint
  ≈ +18%); internal medicine **$100–140 → $120–145**; family medicine **$115–140 → $120–145**;
  psychiatry **$180–210 → $185–220**; pediatrics **$100–120 → $105–130**; OB-GYN
  **$150–200 → $150–225**; medical oncology mixed (**$410–475 → $375–500** — band widened,
  midpoint roughly flat). Caveat: locumstory is CHG — the **same corporate family as several
  of our curated-prior sources** (`specialties.ts:3-5` header names LocumStory), so these
  moves corroborate the *existence and scale* of drift, not independent truth.
- Structural anesthesia shortage (multi-year driver): HRSA projects a shortage of **8,450
  anesthesiologists by 2037** (via
  [Medicus](https://medicushcs.com/locum-tenens-agency/resources/the-anesthesia-provider-shortage);
  UNVERIFIED against the primary HRSA projection — needs the primary source). Cardiac
  anesthesia locum rates quoted **$450–475/hr** in 2026
  ([locums.one](https://locums.one/blog/cardiac-anesthesia-locums) — agency-blog tier).
- Market size trend: locum tenens market projected **$10.2B (2025) → $14.6B (2030), 7.6% CAGR**
  (via [locums.one](https://locums.one/blog/cardiac-anesthesia-locums) — secondary,
  UNVERIFIED; SIA is the authoritative series).

**B5. What this implies quantitatively for staleness (ESTIMATED, derived from B3/B4).**
In a normal regime, specialty midpoints moved roughly +3% to +22% per year (B4) → an
observation loses roughly **0.3–2% of accuracy per month** depending on the cell. In a
surge/correction regime (B2/B3), the market moved **±20% inside 12 months and ~+90% inside
24** — i.e., staleness cost is regime-dependent by an order of magnitude. Design consequence:
a *fixed* half-life is defensible as a default, but the half-life should shorten when a cell's
own measured velocity is high (trend-aware decay). These derived monthly figures are
ESTIMATED (arithmetic on cited annual figures), not observed monthly data.

### C. Mapping to the engine — design (what to build, in dependency order)

**C1. Persist the posterior time series (the unlock for everything else).**
The bridge already computes every cell aggregate daily (STEP 5) and then throws away
yesterday's values (whole-node replace, `bridge-rate-intelligence.ts:884-907`). Add one
Supabase table (e.g., `rate_posterior_history`: run_id FK → bridge_runs, specialty, state_key,
rate_type, weighted_mean, median, n_distinct, n_raw, family_count, confidence, computed_at)
and one INSERT in STEP 6/7. Append-only, service-role-only like `quote_events`
(`20260604000000_quote_regret_telemetry.sql` posture). Costs almost nothing; without it, trend
and seasonality work in 2027 will have no history because we deleted it in 2026. **Buildable
NOW.**

**C2. Recency decay through the existing weight hook + an honest effective-n gate.**
Replace the binary window with exponential decay *in the bridge*, not the reader:
`evidence_weight = exp(-ln(2) · age_days / H)` with age from `recencyKey()` (already
implemented, `aggregateBridge.ts:239-246`), applied AFTER dedup and BEFORE family
collapse-then-cap, preserving D-36's real invariant (multiplicity never *inflates*; age only
*deflates*). Widen `RATE_READ_WINDOW_DAYS` (e.g., 7 → 45–90) so the posterior sees more
history at reduced weight. Then the anchor gate must stop counting raw heads: replace
`n_distinct ≥ 4` (`marketRates.ts:473,498`) with **Kish effective sample size**
`n_eff = (Σw)² / Σw² ≥ 4` — a cell full of stale observations then honestly fails promotion
instead of anchoring on decayed evidence, and a fleet outage produces *graceful degradation*
(anchor weakens over weeks) instead of the S11 cliff (all-or-nothing at day 7). Half-life `H`
is an engineering constant until measured: a defensible ESTIMATED default is **H ≈ 30 days for
market-typed observations** (so a 90-day-old row carries 12.5% weight), justified only by the
B5 drift bounds — label it ESTIMATED in code, and plan to fit it from the C1 history
(autocorrelation of cell medians) within 2 quarters. Two hard cautions: (a) keep a hard max
age (e.g., 120d) — decay alone never expires a lone stale observation in a dead cell; (b) the
A9 scrape-date bias means true ages are older than measured — H should err short.
**Buildable NOW; touches `aggregateBridge.ts`, `marketRates.ts` anchor gate, and both repos'
overlay tests (22-case `marketBucketsOverlay.test.ts` + golden-master-adjacent gate-2 suites).**

**C3. Freshness SLA per cell + the missing outage alert.**
Define an explicit staleness SLA by cell class instead of one implicit global 7d:
- *Hot cells* (anchored cells + specialties with measured high velocity — anesthesiology, EM,
  CRNA per B4): data ≤ 7d, alert if the anchor lapses.
- *Warm cells* (bridged but unanchored): ≤ 30d for context display.
- *Cold cells* (curated-only — today 69 of 88 engine keys, given the 19-name taxonomy
  intersection, Map 06 §3.4): a **curated re-audit SLA** (e.g., re-cite every 180d; hot
  specialties every 90d) — the only staleness control possible where no live signal exists.
Ship the S11 alert regardless of everything else: `bridge_runs` already records enough to
derive promotions-per-run; alert when promoted-cell count drops ≥50% run-over-run.
**Buildable NOW; effort low.**

**C4. Show the recruiter the age of what they're pricing off.**
Add `asOf` metadata to curated tables (`specialties.ts`, `callRates.ts` — currently header
comments only, A7) and surface both ages in the sim UI next to the existing
sources/confidence line (`sim-render.ts:106-111`): "anchored on live market data through
{date}" vs "curated band, last audited {date}". This converts staleness from a hidden defect
into a visible confidence input, consistent with the honest-confidence doctrine already
shipped (zero static 'high', `specialties.ts` confidence tiers :6-15). **Buildable NOW;
effort low.**

**C5. Per-cell trend detection ("EM in TX is moving up — quote ahead of the curve").**
Once C1 accumulates ~8–13 weekly points per cell: robust slope per (specialty, state,
rate_type) via **Theil–Sen** over rolling windows (consistent with the engine's
median/MAD-not-mean house style, `cellAggregation.ts`), flagged as trending when the slope's
sign is stable across windows and |slope| exceeds a floor (e.g., 1%/month — ESTIMATED, to be
fit). Two consumption modes, in trust order:
1. **Display-only flag first** (no fabrication risk): "this cell moved +2.1%/mo over the last
   quarter" badge next to the quote — recruiters price ahead of the curve themselves.
2. **Anchor nowcast later** (needs backtests): shift the anchor by `slope × (median observation
   age)` — a *bias correction* (the decayed-weight posterior lags a moving market by roughly
   its mean observation age), not a forecast. Gate it behind the existing backtest
   infrastructure (`rate_audit_log` was built for simulated-vs-actual drift,
   `medical-staffing/agent_tables_setup.sql:85-95`) and never let a nowcast exceed, say, ±5%
   without manual review.
Coverage reality check: trend detection inherits the **taxonomy chasm** — only ~19 producer
names survive the bridge today (Map 06 §3.4), so per-cell trend is capped at those cells until
the canonical→engine mapping lands (cross-pillar dependency). Internal streams can extend
depth: `sisense_*` bid history and `quote_events`/`quote_outcomes`
(`20260604000000_quote_regret_telemetry.sql:123-165`) are dated and specialty-keyed — worth
auditing as a second trend source predating the scraper spine. **Needs 3–6 months of C1 data.**

**C6. Surge flags (event-driven, honest).**
Two detectors, neither of which invents a number:
- *Internal:* week-over-week jump detector on cell medians (e.g., >10% WoW with n_eff support
  on both sides — thresholds ESTIMATED, to be fit from C1 history). Emits a `surge` flag on
  the cell; UI badge "market moving — recent observations are running well above trailing
  levels"; optionally shortens the decay half-life for that cell (older observations lose
  relevance faster in a surge — B2/B3 evidence).
- *External (curated):* a manually-maintained event table (strike announced at facility/system
  X, declared emergency in state Y, epidemic surge per CDC FluView/NREVSS indices) that flags
  affected (specialty, state) cells. Strike/disaster events are public and datable; the
  2–3× nursing analog (B2) justifies flagging, but **no physician-specific surge multiplier
  should be shipped without observed data** — the flag changes *labels and decay*, not the
  quote.
**Plumbing buildable NOW; useful firing depends on state-level data (today 100% of buckets are
'national' — Map 03 seam S7 — so geo-scoped surges can't land in the right cell yet; another
cross-pillar dependency).**

**C7. Seasonality — measure, don't model (yet).**
Given B1's negative finding (no published locum rate amplitude), the honest sequence is:
1. NOW: log external demand covariates alongside posterior snapshots (weekly CDC FluView ILI
   %, NREVSS positivity — free, public, dated) so the seasonal analysis in 2027 has aligned
   demand context for EM/hospitalist/peds/urgent-care cells.
2. After ~12 months of C1 history (first full annual cycle ≈ mid-2027): estimate per-cell-class
   seasonal amplitude (winter respiratory cells; summer FM/EM vacation cells; Q4 holiday-call
   cells) and only then decide whether a seasonal adjustment earns its way into the quote.
3. Interim recruiter value without fabrication: a *calendar context* card ("winter respiratory
   season historically raises ED/hospitalist demand" with the B1 citations) — qualitative,
   labeled, no number.
**Do NOT ship a seasonal rate multiplier now — there is no citable amplitude to put in it.**

**C8. Fix the observation-age bias at the source (supports C2).**
Extract posting dates where structurally available — schema.org `JobPosting.datePosted` is a
standard sibling of the `baseSalary` field the JSON-LD parser already reads
(`jsonld_parser.py:146` path) — instead of always flooring `published_at` to scrape date on
the posting path (`agent.py:581-583`). Reduces the A9 bias that makes stale reposts look
fresh; effort is small and additive (new optional field, no gate changes).

**C9. Time-decay the calibration window.** When feedback data eventually exists, replace the
last-10-count window (`marketRates.ts:841`) with the same exponential decay as C2 so a
6-month-old correction cannot steer today's quote at full weight. Trivial once C2's decay
helper exists; meaningless until the feedback loop (improvement-plan Move #4) ships.

### D. Buildable NOW vs needs data (explicit split)

| Item | Status |
|---|---|
| C1 posterior snapshots + demand covariate logging | **NOW** (one table + one INSERT) |
| C2 recency decay + effective-n anchor gate | **NOW** (H is ESTIMATED until fit; label it) |
| C3 freshness SLA + S11 promotions-drop alert | **NOW** |
| C4 as-of surfaces + curated `asOf` metadata | **NOW** |
| C8 `datePosted` extraction | **NOW** (additive scraper field) |
| C5 trend flags (display-only) | **~3–6 months** of C1 history; capped by taxonomy chasm |
| C5 anchor nowcast | **6–12 months** + rate_audit_log backtests |
| C6 surge detectors | plumbing NOW; internal detector needs C1 history; geo-scoped needs state-level cells (S7) |
| C7 measured seasonality | **~12+ months** (first full cycle ≈ mid-2027) |
| C9 calibration decay | gated on feedback loop existing at all |

---

## Recommendations

1. **R1 — Persist daily posterior snapshots (`rate_posterior_history`) + weekly FluView/NREVSS covariates.**
   The pillar's entire future depends on history we are currently deleting daily.
   *(impact: high, effort: low)*
2. **R2 — Exponential recency decay via `evidence_weight` + Kish effective-n (n_eff ≥ 4) in the anchor gate; widen the bridge window; keep a hard max age.**
   Replaces the 7-day cliff with graceful, honest degradation; rides the designed-but-unused hook (`cellAggregation.ts:79,118`) with zero posterior-math change. Half-life ESTIMATED (≈30d) until fit from R1 data.
   *(impact: high, effort: medium)*
3. **R3 — Freshness SLA per cell class + alert on promotion-count drop (close seam S11).**
   One week of fleet outage must page someone, not silently revert 6 cells to curated.
   *(impact: medium, effort: low)*
4. **R4 — Surface data age in the hub sim (live anchor as-of date; curated band `asOf` audit date) and add `asOf` metadata to curated tables.**
   Staleness becomes a visible confidence input; also creates the forcing function for R5's re-audit cadence.
   *(impact: medium, effort: low)*
5. **R5 — Curated re-audit cadence policy: re-cite hot specialties every 90d, others every 180d.**
   Curated bands currently have an infinite SLA while the market moves +3–22%/yr (B4); GSA FY table and callRates snapshot will silently rot.
   *(impact: medium, effort: low ongoing)*
6. **R6 — Per-cell Theil–Sen trend flags (display-only first), fed by R1; anchor nowcast only after rate_audit_log backtests.**
   CHG's +55% anesthesiology vs −8% EM in the same year proves trend must be per-cell, and the display-only-first ladder keeps the no-fabrication line intact.
   *(impact: high, effort: medium)*
7. **R7 — Surge flags: internal WoW jump detector + curated external event table (strikes, declared emergencies, epidemic indices); flags change labels and decay, never the quote number.**
   *(impact: medium, effort: medium)*
8. **R8 — Extract `datePosted` from JSON-LD postings to reduce the scrape-date-floor age bias.**
   *(impact: medium, effort: low)*
9. **R9 — Defer any seasonal rate multiplier; ship the qualitative calendar-context card only, and revisit after the first full year of R1 history.**
   *(impact: low now / high in 2027, effort: low)*
10. **R10 — Add time decay to the feedback calibration window when the feedback loop ships.**
    *(impact: low, effort: low)*

---

## Open questions

1. **How deep is the per-cell history really?** Rows/week per specialty in
   `rate_intelligence` since 2026-05-20 determines when R6 becomes feasible per cell. Needs a
   prod query (Supabase access is Zach-gated in this environment).
2. **Can internal streams backfill trend history?** `sisense_*` bid history and
   `quote_events`/`quote_outcomes` are dated — do they have enough per-specialty density to
   compute trend before the scraper spine matures? (Also the only *paid-rate* time series we
   could ever own.)
3. **What half-life?** H≈30d is an engineering default. Fit from R1 data (autocorrelation /
   held-out prediction error of cell medians) — and decide whether H should be per-rate_type
   (advertised postings likely stale faster than survey aggregates).
4. **Nowcast policy (Zach call):** may a measured trend ever *move* the anchor, or is
   display-only the permanent posture? Display-only is the no-fabrication-safe default; the
   B3 correction regime shows lagging quotes are also a real error, so this is a genuine
   tradeoff, not a free choice.
5. **Geo-scoped surges are blocked on the state dimension** (100% of buckets 'national', seam
   S7) — does the timing pillar's surge work wait for state-level cells, or ship
   national-only first?
6. **RTDB rules audit (seam S5)** — any decay/trend metadata added to the public-read tree is
   consumed by the same trust boundary; the write-rule audit named in Map 03 remains the
   prerequisite adversarial check.
7. **Curated-source correlation:** several curated priors and the YoY trend evidence share
   the CHG family (LocumStory). For trend *validation*, prioritize non-CHG sources (SIA,
   AMN, Medicus, NALTO surveys) to avoid confirming our priors with our priors' author.

---

## Sources

- [PMC5155650 — ILI-related ED visits, Christmas/New Year peaks, Edmonton 2004–2014](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5155650/)
- [PMC11246698 — Children's hospital resource utilization, 2022 viral respiratory surge](https://pmc.ncbi.nlm.nih.gov/articles/PMC11246698/)
- [KFF Health News — NY hospitals woo replacement nurses with $9,000-a-week pay](https://kffhealthnews.org/morning-breakout/ny-hospitals-woo-replacement-nurses-with-9000-a-week-pay-during-strike/)
- [Wanderly — Strike nursing](https://www.wanderly.us/blog/strike-nursing/)
- [Nurse.org — 2026 nurse strikes list](https://nurse.org/articles/nurse-strikes-list/)
- [Health Affairs Forefront — COVID-19's impact on nursing shortages, travel nurses, price gouging](https://www.healthaffairs.org/do/10.1377/forefront.20220125.695159/)
- [Healthcare Dive — Staffing firms defend traveling nurse rates](https://www.healthcaredive.com/news/hospital-lobbies-congress-FTC-travel-nurse-rate-caps-COVID/618194/)
- [Staffing Industry Analysts — After pandemic boom, travel nursing finds new footing](https://www.staffingindustry.com/editorial/healthcare-staffing-report/after-pandemic-boom-travel-nursing-finds-new-footing)
- [CHG Healthcare — Locum tenens usage jumps 25% (newsroom)](https://chghealthcare.com/newsroom/locum-tenens-2025-usage-jumps) · [Business Wire release](https://www.businesswire.com/news/home/20251029104102/en/Report-Locum-Tenens-Usage-Jumps-25-as-Health-Systems-Combat-Physician-Shortages-and-$2.6M-Revenue-Gaps) · [2025 State of Locum Tenens full report PDF](https://chghealthcare.com/documents/State_of_Locum_Tenens_2025_Full_Report.pdf)
- [locumstory (CHG) — Locum tenens pay trends by specialty, 2025 report](https://locumstory.com/spotlight/locum-tenens-compensation-trends)
- [All Star Healthcare Solutions — Emergency medicine salary guide 2026](https://allstarhealthcaresolutions.com/blog/emergency-medicine-salary-guide/)
- [Medicus — The anesthesia provider shortage](https://medicushcs.com/locum-tenens-agency/resources/the-anesthesia-provider-shortage)
- [locums.one — Cardiac anesthesia locums 2026](https://locums.one/blog/cardiac-anesthesia-locums)
- [Locumpedia Digest #117 — Summer coverage / 2026 Match figures](https://www.locumpedia.com/news/locums-digest-117/)
- [MPLT Healthcare — Solving seasonal staffing shortages](https://www.mplthealthcare.com/solving-seasonal-staffing-shortages-locum-tenens/)
- [TheraEx Locums — Seasonal trends in locum tenens](https://theraexlocums.com/2024/08/09/seasonal-trends-in-locum-tenens-understanding-peak-times-and-slow-periods/)
- [CompHealth — Top locum specialties, summer 2026](https://comphealth.com/resources/top-locum-specialties-summer-2026)
- [Locums National — Maximize holiday coverage with locum tenens](https://www.locumsnational.com/blog/100006/maximize_holiday_coverage__with_locum_tenens)
- [NPR — Children's hospitals grapple with nationwide RSV surge (2022)](https://www.npr.org/2022/10/24/1130764314/childrens-hospitals-rsv-surge)
