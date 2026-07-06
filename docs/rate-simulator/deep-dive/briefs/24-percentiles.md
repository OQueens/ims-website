# Brief 24 — Percentiles & Distributions: from point-plus-band to honest distributional answers

> Deep-dive research brief, 2026-07-03. Pillar: "what the going percentile is."
> Scope: the LIVE rate simulator (imstaffing.ai/hub, served by `ias-website`) — engine
> `src/lib/rate-engine/`, hub adapter `src/lib/hub/` — plus the still-live pipeline
> (`agent-sdk` scraper → Supabase `rate_intelligence` → `ias-dashboard/scripts/data-refresh`
> bridge → RTDB `market-rates-v2`). Read together with maps 03 (posterior/bridge), 05
> (comp factors), 06 (data model) in `docs/rate-simulator/deep-dive/maps/`.
>
> All repo paths are relative to `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/`
> unless prefixed with another repo root. OBSERVED = read from code (file:line).
> ESTIMATED = labeled inference. External $ figures are cited and ALSO listed in the
> fact-check queue at the end.

---

## Summary

The north star says the simulator must answer two questions per cell: **the rate we would
pay** and **where that rate sits in the market distribution**. Today the first question is
answered by a robust posterior point + a curated band; the second question is answered by a
**fabricated uniform-distribution assumption**. Every "percentile" the recruiter sees —
the p25/p50/p70/p75/p90 chips on the market-position bar, the "Recommended (market median)"
legend, the curated `p70`, the legacy band's `p70` — is a **linear interpolation between two
band endpoints**, not a percentile of any observed distribution (Findings 1–2). No store on
the live path holds a real quantile of locum rates (map 06 seam 3 / map 03 seam S6).

The good news: the raw ingredients already exist and are unusually strong.
The bridge already computes a variance-weighted, MAD-robust posterior per
(specialty, state, rate_type) cell with per-observation dedup and family collapse
(map 03 §3); a **true per-state percentile table (BLS OEWS p10–p90) is already vendored**
in the engine (`blsOewsBaseline.ts`); a real interpolated-quantile function already runs on
**observed** LocumSmart bid ceilings (`liveCalibration.ts`); and Supabase already has an
external-survey envelope whose columns are explicitly typed as 25th/50th/75th percentiles
(AANA CRNA). What's missing is (a) a `RateDistribution` object computed honestly from
small-n cells via shrinkage toward parent pools and external **shape** priors, (b) an
additive RTDB/data-model slot for it that keeps the band API intact, and (c) the
recruiter-facing "this offer sits at ~p35 — counter with $X to reach p60" surface, with
every quantile provenance-tagged and interval-widened when n is tiny.

One hard external truth shapes the whole design: **no public source publishes a locum-rate
percentile table for physicians.** Locum agencies publish ranges and averages only; the
percentile-publishing sources (BLS OEWS, MGMA, SullivanCotter, AMGA, AAPA) are
permanent/W2-comp surveys — usable as **shape** priors (quantile ratios), never as level
anchors — and BLS's physician upper percentiles are top-coded away (Finding 6, OBSERVED in
the vendored file). The distributional moat therefore has to be built from our own
observation spine + LocumSmart data, which is exactly what the pipeline already collects.

---

## Findings (cited)

### F1 — Every displayed "percentile" is a linear interpolation of band endpoints (fabricated shape)

- The hub quote carries `percentiles: Array<{ p: number; value: number }>`
  (`src/lib/hub/sim-adapter.ts:238`) computed as
  `WF_PERCENTILES.map((p) => ({ p, value: Math.round(adjustedMin + (adjustedMax - adjustedMin) * (p / 100)) }))`
  with `WF_PERCENTILES = [25, 50, 70, 75, 90]` (`sim-adapter.ts:254`, `:372`).
  `adjustedMin/adjustedMax` are just the researched band `[spec.min, spec.max]`
  (`src/lib/rate-engine/rateCalculator.ts:747-753`, `computeAdjustedSpecRange` returns the
  unscaled range). So "p90" is literally `min + 0.9·(max−min)` — the 90th percentile **of a
  uniform distribution the data never claimed**.
- The renderer displays these as percentile chips — `` `p${p.p}: ${usd(p.value)}` `` with
  p70 highlighted — and a premium zone "p75 → top of the researched range … marked at p90"
  (`src/lib/hub/sim-render.ts:43-76`, chips at `:57-59`). The marker legend says
  **"Recommended (market median)"** (`sim-render.ts:67`) even though the marker is the
  multiplier-chain output anchored at the p70 *slot* — on a live-anchored cell that slot
  holds a weighted **mean** (`marketRates.ts:514,522`), and on a curated cell it holds the
  70%-interpolation. Neither is a median of anything observed.
- The same interpolation exists in three more places:
  `getPercentileRate()` — "Linearly interpolates between min and max"
  (`rateCalculator.ts:50-53`, exported at `src/lib/rate-engine/index.ts:16`);
  the curated `p70 = Math.round(min + (max-min)*0.70)` at build time
  (`src/lib/rate-engine/specialties.ts:179`); and the bridge's legacy band
  `p70 = min + 0.7·(max−min)` over raw extrema
  (`ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts:717-750`; map 03 §4).
- **Why this is a defect, not a nicety:** real wage/rate distributions are right-skewed —
  observable even inside our own vendored BLS table (e.g. AK chiropractors mean $53.08 >
  median $47.87, `blsOewsBaseline.ts:47-50`), and in crowdsourced physician comp (Marit:
  mean $465,575 vs median $414,000 — external, see F6). Under right skew, a uniform
  interpolation **overstates** mid percentiles and **understates** where a high offer really
  sits; the "p90 premium tier" chip is a geometry artifact. A recruiter pricing off "p75 of
  the band" is not pricing off p75 of the market.

### F2 — The stored posterior cannot yield percentiles: spread is discarded at write time

- `MarketBucketData` (the ONLY live per-cell market object) carries
  `weighted_mean, weighted_variance, median, confidence, n_distinct, n_raw,
  source_families, family_capped, lastUpdated` (`src/lib/rate-engine/marketRates.ts:84-94`)
  — no quantiles, no MAD, no observed min/max, no per-observation values.
- `weighted_variance = 1/ΣW` is the **estimator's standard error, not population spread**
  (`cellAggregation.ts:357-358`); the overlay comment says exactly this and that a
  mean±k·SE band would collapse to zero width on `zero_spread` cells
  (`marketRates.ts:406-411`). Correct diagnosis — and it means the current schema cannot
  answer "where does $X sit" even in principle.
- `aggregateCell` internally computes the median and MAD (`cellAggregation.ts:302-305`) and
  the per-survivor values, but the bridge persists only the aggregate; the sorted
  observation vector dies inside the bridge run. Distribution-shape evidence is destroyed
  at two points: dedup collapse to the median member
  (`aggregateBridge.ts` `makeObservation`, map 03 §3.2) and the aggregate-only RTDB write
  (map 03 §4). Nothing downstream can reconstruct a quantile.
- Also note each raw observation is itself an **interval** (`rate_low`,`rate_high` —
  `rate_intelligence` DDL, map 06 §1.1) collapsed to `rate_mid` before aggregation
  (`cellAggregation.ts:76`). A "$180–240" posting is a poster-stated range, not a point
  draw; interval-censored observations are usable for distribution fitting but are
  currently flattened.

### F3 — n is tiny and the coverage is thin: empirical percentiles would be dishonest today

- The anchor gate requires `n_distinct ≥ 4` and ≥2 families (`marketRates.ts:473-474,498,505-512`);
  the deploy-time observation was **0 promotions** and 6 cells reverting to curated (map 03
  §5.3). Every v2 bucket today is `stateKey='national'` (map 03 seam S7; map 06 seam 9).
  Only ~19 of 152 producer specialty names survive the bridge's engine-key allowlist
  (map 06 §3.4), so most cells have **no** live observations at all.
- Order-statistics floor: an empirical p90 needs the 90th-percentile order statistic to be
  interior, i.e. n ≥ 9 at absolute minimum, and its sampling error at n≈10 spans tens of
  dollars for these spreads. The code already cites Rousseeuw & Verboven 2002 for "robust
  spread is mathematically unavailable below n=4" (`marketRates.ts:396-397`). Conclusion:
  **per-cell empirical quantiles are off the table for the foreseeable data volume; the
  design must be shrinkage-first**, with widening as n falls — exactly the posture the
  improvement plan already names for Moves #2/#3 (`docs/rate-simulator-IMPROVEMENT-PLAN.md:42-48,103-104`).

### F4 — Real percentile machinery already exists in the codebase (three unwired assets)

1. **BLS OEWS per-state percentile table, already vendored.**
   `OewsPercentiles { meanHourly, p10Hourly, p25Hourly, medianHourly, p75Hourly, p90Hourly }`
   per SOC per state, May 2024 release (`src/lib/rate-engine/blsOewsBaseline.ts:29-40`;
   source comment "bls.gov/oes (May 2024 release; published April 2025)", `:3-7`).
   Used today only by the sanity-check layer (`blsSanityCheck.ts:548-550` compares p25/p75
   × multiplier). This is a REAL, government-published quantile table sitting one import
   away from the quote path.
2. **A real interpolated-quantile function on OBSERVED data.**
   `quantile()` (`src/lib/rate-engine/liveCalibration.ts:73-83`) computes
   `rateCapP25 / rateCapMedian / rateCapP75` over LocumSmart Partner-API
   `rateRequirements.maxRegular` bid ceilings, per HCO and per specialty
   (`liveCalibration.ts:198-200, 229-231`). These are **observed bid-ceiling quantiles**
   (bill-side upper bounds, NOT pay — `liveCalibration.ts:9-13`), exported but with zero
   hub consumers (map 05 §2.10). As a *censoring bound distribution* it is directly usable:
   pay percentile claims can be sanity-bounded by "the p75 ceiling clients will even accept."
3. **A survey envelope whose columns are already percentile-typed.**
   `external_specialty_surveys` defines `rate_low NUMERIC -- 25th pct hourly OR pct10 if
   reported`, `rate_median -- 50th pct`, `rate_high -- 75th pct OR pct90`
   (`ias-dashboard/supabase/migrations/20260507000000_external_specialty_surveys.sql:34-36`),
   seeded for CRNA (`aana_2025`, `ias_internal_2026`, `bls_oews_29_1151_2024` — map 06
   §1.5). The CRNA path consumes BLS p50 as its spine (`crnaCellLookup.ts:13,364`) but is
   explicitly NOT injected into the hub sim (`src/lib/hub/sim-live.ts:19-23`).

### F5 — The band conflates market spread with comp-factor spread; a percentile claim must pick a conditioning

The curated `[min,max]` band spans BOTH "same job, different market position" AND
"different job" (night/CAH/holiday premiums). The renderer even documents the upper band as
where "premium agencies and urgent / subspecialty assignments land" (`sim-render.ts:45-49`)
— i.e., today's band is a **mixture**, and a percentile computed on it is a percentile of
that mixture, not of comparable offers. Meanwhile the engine prices comp factors explicitly
via the multiplier chain and exposes `combinedMult`/`cappedMult` on every quote
(`rateCalculator.ts:708-714`). The honest design: hold the distribution **per cell in
base-rate terms** (specialty × geo-cell × rate_type × unit), and normalize an offer into
base terms (`offer / cappedMult`) before asking "what percentile" — with the named losing
side that multiplier error now shifts percentile position (see D4).

### F6 — External landscape: who actually publishes percentiles (and who doesn't)

**Publish real percentile tables:**

| Source | What | Percentiles | Locum? | Access |
|---|---|---|---|---|
| **BLS OEWS** (bls.gov/oes, May 2024) | Per-state hourly wage distribution per SOC | p10/p25/p50/p75/p90 | No — W2 wage | Free; ALREADY VENDORED (`blsOewsBaseline.ts`) |
| **MGMA DataDive / Provider Compensation** | Perm physician total comp by specialty | 10th–90th (outside range = custom paid) | No | Paid license. 2024 report (2023 data) example, primary care: p25 $256,853 / p50 $312,427 / p75 $377,553 / p90 $463,654 — **UNVERIFIED, needs the report** |
| **SullivanCotter** Physician Comp & Productivity Survey | Perm comp, 541 orgs / ~215,400 practitioners (self-stated) | percentile benchmarks | No | Paid |
| **AMGA** Medical Group Comp Survey | Perm comp, ~185,000 providers / 482 groups (2025, self-stated) | percentiles | No | Paid |
| **AAPA Salary Report** (2026 ed.) | PA comp | reports p25/p50/p75/p90 style stats (e.g. median $140,000 for 2025) | No | Paid summary/free flyer |
| **AANA** CRNA survey | CRNA comp | already enveloped in our `external_specialty_surveys` as p25/p50/p75 (`aana_2025`) | No (perm-heavy) | Association |
| **Marit Health** (marithealth.com) | **Crowdsourced, locum-specific hourly** (e.g. "Locum Tenens Physician $290/hr avg", per-specialty/state pages) plus salary percentile displays (physician median $414,000, p25 $310,000, p75 $572,000, p90 $750,000) | p25/p50/p75/p90 displayed | **YES — the only public locum-typed percentile-shaped source found** | Free but give-to-get gated; scraping/ToS question open |

**Do NOT publish percentiles (ranges/averages only):** Locumstory/CHG 2025 trends,
Locums.com 2025 pay-rates blog, CompHealth, LocumTenens.com salary report (averages;
methodology annualizes ~2,000 hr/yr), Weatherby, AllStar, Wapiti — all publish
min–max ranges or single averages per specialty. (Search pass 2026-07-03; sources listed in
claims_to_verify.) **Implication:** external sources can seed *level* priors for the band
(already how `specialties.ts` was curated) and *shape* priors for the distribution, but no
external table can be pasted in as "the locum percentiles." The distribution itself must be
estimated from our spine — which is a moat, not a bug.

### F7 — BLS OEWS shape priors are top-code-broken exactly for high-pay physician cells (OBSERVED)

In the vendored table, Anesthesiologists (29-1211) have `medianHourly: null, p75Hourly:
null, p90Hourly: null` in essentially every state (e.g. `blsOewsBaseline.ts:556-565`
mean $155.74 but p25→p90 all null; `:2788-2797` mean $142.29, median+ null; `:3512-3521`,
`:3914-3922` p90 null even where p75 exists). CRNAs (29-1151) retain p25–p75 in many states
but frequently lose p90 (`:526-535` p90 null; `:878-887` full through p90 in one state).
This is the documented BLS suppression/top-coding policy (the extract stores suppressed
cells as null — `blsOewsBaseline.ts:25-27`; BLS top-codes hourly wages above ≈$115/hr /
$239,200 annual — **UNVERIFIED exact figure, needs bls.gov citation**). **Consequence:**
OEWS quantile-ratio priors are usable for APP cells (NP/PA, and partially CRNA) and
lower-paid physician cells, but the physician upper tail must come from elsewhere (MGMA/
SullivanCotter shape ratios under license, or our own pooled data).

### F8 — Governance & plumbing constraints the design must respect (all OBSERVED)

- The v2 tree is written as one whole-node replace per specialty per run and read by an
  untrusting reader that validates specific fields (`isRenderableBucket`,
  `marketRates.ts:220-230`) — **extra keys inside a bucket are ignored, so an additive
  `distribution` field is deploy-safe in both directions** (old reader + new writer, new
  reader + old tree).
- The golden master covers only the pure Phase-1 surface (`src/lib/hub/rate-engine-parity.test.ts:10-14`
  per map 06 §4) — a distribution layer beside `aggregateCell` (D-33 untouched) does not
  perturb it.
- `manual_review_bimodal` cells return `weighted_mean: null` and must never collapse to one
  number (`cellAggregation.ts:380-395`) — a bimodal cell must therefore never emit a single
  distribution either.
- RTDB `rate-simulator/*` is public-READ (`ias-dashboard/database.rules.json:26-47`; map 06
  §2.1): anything we persist (e.g. sorted observation vectors) is world-readable. The
  Supabase spine is *also* still anon-readable (map 06 seam 6), so quantile vectors add
  little new exposure — but it's a named tradeoff.
- Call-only daily stipends have **no live distribution path at all**: DAY-unit rows are
  dropped pre-insert (`agent-sdk/agents/rate_scraper/agent.py:491-493`; map 05 §1). The
  percentile UX must be hourly-path-only at launch, with the call-only surface keeping its
  honest cite-or-suppress cards.
- `quote_events` / `quote_outcomes` tables already exist for the ground-truth loop
  (`20260604000000_quote_regret_telemetry.sql`; map 06 §1.5) — the natural home for
  interval-coverage backtesting.

---

## Design — the distributional upgrade

### D1 — Data model: `RateDistribution` (band → distribution, additively)

New object, computed by the bridge (pure, beside `aggregateCell` — never inside it),
persisted additively inside each v2 bucket:

```ts
/** Per-cell rate distribution. EVERY field is provenance-backed; a null quantile
 *  means "honestly suppressed", never "zero". */
export interface RateDistribution {
  /** $/hr at p10/p25/p50/p75/p90. null = suppressed (insufficient basis). */
  q: { p10: number|null; p25: number|null; p50: number|null; p75: number|null; p90: number|null }
  /** Uncertainty on the quantiles themselves — at minimum p50 and p90 bands.
   *  Widened explicitly as n falls (see D2). Absent ⇒ method === 'prior_shape'. */
  q_ci?: { p50: [number, number]; p90: [number, number] }
  /** How q was produced — the honesty discriminator the UI must surface. */
  method: 'empirical_weighted'   // n >= EMPIRICAL_FLOOR, weighted quantiles + bootstrap CI
        | 'lognormal_shrunk'     // 4 <= n < EMPIRICAL_FLOOR, shrunk sigma (D2)
        | 'prior_shape'          // n < 4: external/parent SHAPE on the curated/anchored level
  /** Shrinkage bookkeeping: lambda in [0,1] (0 = all cell data, 1 = all prior),
   *  and WHICH parent pool / external shape was used. */
  shrink: { lambda: number; parent: string } | null
  n_used: number                 // distinct observations that informed q
  /** Provenance of the shape prior when method !== 'empirical_weighted',
   *  e.g. 'pool:category=Anesthesia|rate_type=advertised_clinician_pay'
   *  or 'oews:29-1151:national-ratios:2024-05'. */
  prior_ref: string | null
  top_capped: boolean            // true if any input quantile source was top-coded (F7)
  computed_at: number
}
```

Placement: `market-rates-v2/{spec}/{state}/buckets/{rate_type}.distribution` — additive on
`MarketBucketData` (safe per F8). The band API (`SpecialtyRate {min,max,p70}`,
`specialties.ts:38-47`) is untouched: Move #1's overlay keeps anchoring `p70` from
`weighted_mean` and taking the band from `STATIC_SPECIALTY_RANGES` exactly as shipped
(`marketRates.ts:514-546`). The distribution is a **parallel display/positioning layer
first**, quote-driving later (this sequencing keeps the golden master, Move #1's 22-case
overlay suite, and the honesty deploys of 6d9edb1/5d6ce34 intact).

### D2 — Estimation: shrinkage-first, widen-when-thin, never fake tight

Three tiers, gated by `n_distinct` of the SAME post-dedup, family-collapsed, MAD-survivor
observation set the posterior already uses (no new counting rules):

1. **Tier E — `empirical_weighted` (n ≥ ~20, aspirational today):** weighted quantiles
   (Harrell-Davis or weighted type-7 — same interpolation family as
   `liveCalibration.ts:73-83`) over survivor `rate_mid`s, evidence_weight-weighted;
   `q_ci` from a Bayesian bootstrap. No cell qualifies today (F3) — this tier exists so the
   system automatically graduates as the fleet scales.
2. **Tier S — `lognormal_shrunk` (4 ≤ n < 20):** fit on log-rates.
   - Center: `μ = ln(weighted_mean)` — reuse the existing IVW posterior center
     (`cellAggregation.ts:357`), no new center estimator.
   - Spread: `σ̂_cell = 1.4826 · MAD(log rate_mid)` (the same Iglewicz–Hoaglin scaling the
     engine already uses, `cellAggregation.ts:259`), then **shrink toward the parent pool**:
     `σ² = (n·σ̂²_cell + k·σ²_parent) / (n + k)` with pooling constant `k` (start ~8–12;
     TUNABLE, to be fixed by backtest — an engineering constant like the 5% CV floor,
     ESTIMATED and labeled, never presented as fitted).
   - Parent pool ladder: (cell) → (same specialty, all states, same rate_type) →
     (same `category` from `specialties.ts:56-166` — Anesthesia/Surgery/etc., same
     rate_type) → (all physicians, same rate_type). First pool with ≥ 20 pooled log-rate
     observations wins; `shrink.parent` records which.
   - Quantiles: `q_p = exp(μ + t_{p,ν} · σ · √(1 + 1/n))` with ν = n−1 — the
     **t-predictive inflation is the explicit widening**: at n=4 the p90 is meaningfully
     wider than at n=15 by construction, so thin cells CANNOT emit tight percentiles.
   - Lognormal is the standard right-skew wage model and matches the skew we can observe
     (F1); if a cell's survivors reject lognormality later (backtest), swap the family per
     cell — the object's `method` field makes that a data change, not a schema change.
3. **Tier P — `prior_shape` (n < 4, or no live data — MOST cells today):** take the
   **level** from what the trust ladder already chose (live anchor if promoted, else
   curated p70) and the **shape** from an external/pooled quantile-ratio prior:
   `q_p = level · R_p` where `R_p = extQ_p / extQ_50` from (in preference order)
   (a) pooled Tier-E/S sibling cells, (b) OEWS ratios where un-top-coded (APP cells — F7),
   (c) licensed MGMA/SullivanCotter ratios if acquired (F6). `q_ci` is ABSENT and the UI
   must render "modeled shape" — never a bare "p90: $X". This is the honest analog of
   today's chips, minus the uniform-distribution lie.

**Hard refusals (carry the codebase's existing doctrine forward):**
- `manual_review_bimodal` ⇒ NO distribution object at all (mirror of the null-mean rule,
  `marketRates.ts:75-79`): the UI shows the two-population card, never one percentile axis.
- A quantile whose basis is suppressed (e.g. top-coded prior upper tail with no pooled
  substitute) is `null` and renders as "insufficient data above p75" — the same
  cite-or-suppress posture as `CALL_RATE_DATA` (`rateCalculator.ts:790-805`).
- Never extrapolate beyond stored quantiles: an offer beyond q.p90 reports "≥ p90", below
  q.p10 reports "≤ p10" — no invented p97s.

### D3 — Seeding priors from external percentile tables (cited, transform-only)

- **OEWS (free, vendored):** use **ratios only** (`p90/p50`, `p25/p50` …) per SOC — never
  levels, so the uncited `LOCUM_MULTIPLIER` estimates (`blsSanityCheck.ts:70-89`,
  self-labeled "NOT primary-source-cited") stay out of the percentile math. Honor the
  existing SOC-fallback contract (29-1229/29-1249 aggregates, `blsOewsBaseline.ts:13-23`)
  and set `top_capped: true` whenever a needed upper quantile was null (F7).
- **AANA / external_specialty_surveys:** the p25/p50/p75 envelope rows
  (`20260507000000_external_specialty_surveys.sql:34-36`) are ready-made shape rows for
  CRNA; wiring requires the deliberate hub↔Supabase decision (`sim-live.ts:19-23`
  currently forbids it) — or routing the envelope THROUGH the bridge into the bucket's
  `distribution` (cleaner: keeps the hub Supabase-free).
- **MGMA / SullivanCotter / AMGA (paid):** a licensing decision for Zach. Value: physician
  upper-tail shape where OEWS is top-coded. Constraint from project memory: benchmark
  NUMBERS are unverifiable → ingest as shape ratios with `prior_ref` naming the edition,
  never hardcoded W2→1099 level multipliers.
- **Marit Health (crowdsourced locum):** classify as `crowd_survey` (context rung —
  `BUCKET_PRECEDENCE` rank 2, never anchorable, `marketRates.ts:119-124`, `:419-422`).
  It is the only public locum-typed percentile-shaped source found; ToS/give-to-get gating
  makes ingestion a legal/ethical question to resolve BEFORE any scraping (flagged, not
  assumed).
- **Own moat (strongest eventual seed):** LocumSmart bid-ceiling quantiles
  (`liveCalibration.ts:198-200`) as an upper-censoring check on every pay quantile
  (`q.p90` of PAY should sit below the p75–p90 of accepted BILL ceilings for the same
  specialty after margin — a cheap cross-axis sanity gate), and the Sisense
  actual-placement tables (map 06 §1.5) as future `actual_paid_locum` distribution truth.

### D4 — Recruiter-facing UX: "this offer sits at ~p35 — here's the counter"

New pure engine module `src/lib/rate-engine/distribution.ts` (vendor-synced like siblings):

- `quantileOf(dist: RateDistribution, p: number): number|null` — monotone interpolation
  between the 5 stored quantiles (linear in log-rate), clamped at the ends per D2's
  no-extrapolation rule.
- `percentileOfRate(dist, rate): { lo: number; hi: number }` — inverse CDF returning a
  **range, not a point**: width from `q_ci` when present, else a fixed method-tier width
  (e.g. ±10 percentile points for `lognormal_shrunk`, ±20 for `prior_shape` — TUNABLE,
  labeled). The UI says "≈ p25–p45", never "p35" from a shrunk cell.
- **Normalization (the F5 conditioning):** the offer is converted to base terms before
  positioning: `baseEquivalent = offer / r.cappedMult` using the engine-exposed chain
  (`rateCalculator.ts:714`), so a night-CAH offer is compared against the cell's base-rate
  distribution, not against a mixture. Named losing side: multiplier misestimation now
  shifts the percentile readout; mitigation is the existing 1.75× ceiling + researched-max
  clamp (`rateCalculator.ts:677-707`) plus showing the normalization in the tooltip.
- Panel spec (replaces the current chips row in `sim-render.ts:50-76`):
  1. Distribution strip (p10–p90 ticks, real dollars from `q`), offer marker with its
     percentile RANGE badge, anchor marker labeled by what it actually is
     ("live anchor (weighted mean, n=6, 3 families)" or "curated p70 slot") — killing the
     "market median" mislabel (F1).
  2. Counter line: "To reach p50: $X · p75: $Y" — both straight reads of `q`, both
     provenance-chipped (`method` + `n_used` + `prior_ref`).
  3. Method chip: "observed (n=23)" / "estimated from 6 observations + Anesthesia pool" /
     "modeled shape on curated level" — the three tiers verbatim, mirroring the existing
     honest-confidence chip language (`sim-adapter.ts:256-278`).
- Call-only path: NO percentile strip (F8); keep the existing per-day-type band cards.

### D5 — Migration path (band API keeps working end-to-end)

- **Phase 0 (honesty patch, ship independently):** stop labeling interpolations as
  percentiles. Rename the chips to band fractions or drop the `p` prefix
  (`sim-render.ts:57-59`), change "Recommended (market median)" to "Recommended (anchor)"
  (`sim-render.ts:67`), and add the uniform-assumption caveat to `getPercentileRate`'s
  JSDoc + deprecate it toward `bandInterpolate` (`rateCalculator.ts:50-53`). Zero math
  change; pure label truth.
- **Phase 1 (write side):** bridge computes `RateDistribution` per market bucket
  (pure function in `aggregateBridge.ts` beside the cell loop; `aggregateCell` untouched —
  D-33 preserved) + persists additively. Old readers ignore it (F8). Add the three
  telemetry partitions' sibling counter (`buckets_with_distribution`) to `bridge_runs`.
  Also persist the **sorted survivor `rate_mid` vector (capped at, say, 50 values)** per
  bucket so Tier-E graduation and audits don't require a re-scrape — accepting the
  public-read exposure named in F8, or gating that subtree with a new read rule.
- **Phase 2 (read side, display-only):** `loadMarketBuckets` passes `distribution` through
  (shape-validate like everything else — untrusted RTDB); `sim-adapter` fills
  `SimQuote.percentiles` from `q` when present and labels the fallback; new
  offer-positioning panel (D4). The `percentiles` field keeps its exact
  `Array<{p,value}>` shape (`sim-adapter.ts:238`) so hub rendering degrades gracefully.
- **Phase 3 (quote-adjacent):** counter-guidance + percentile-of-offer in the recruiter
  flow; `q_ci`-driven "Volatility" chip (improvement-plan action #6).
- **Phase 4 (validation loop):** log `interval_shown`/`percentile_shown` into
  `quote_events`, backtest interval coverage against later-observed market + recruiter
  outcomes (`quote_outcomes`), and only then consider letting the distribution drive the
  displayed band (band = [q.p10, q.p90] projection) — the final retirement of the
  interpolated band, gated on measured coverage.

### D6 — Provenance invariant (how every percentile claim stays backed)

A quantile may render ONLY with: `method` + `n_used` + (`prior_ref` when not empirical) +
freshness (inherits the bucket's `lastUpdated` 7-day gate, `marketRates.ts:136,154-159`).
The rendering rule is mechanical: `empirical_weighted` → "observed", `lognormal_shrunk` →
"estimated (shrunk)", `prior_shape` → "modeled" — the same three-word honesty ladder the
static table already uses for confidence (`specialties.ts:6-15`). A distribution object
missing any of these fields is treated like a corrupted bucket: skipped, next rung serves
(`isRenderableBucket` posture, `marketRates.ts:204-230`).

---

## Recommendations (impact / effort)

1. **[impact: HIGH / effort: LOW] Phase-0 honesty patch now.** The chips + "market median"
   legend are the only place the live product asserts percentile semantics it doesn't have
   (`sim-adapter.ts:254,372`; `sim-render.ts:57-59,67`). Relabel before any recruiter
   prices a counter off "p75". This is a defect fix under the north star, independent of
   everything else.
2. **[impact: HIGH / effort: MEDIUM] Add `RateDistribution` to the bridge + RTDB (D1/D2).**
   Additive, D-33-safe, deploy-safe both directions (F8). Start with Tier S/P only; Tier E
   activates itself as n grows. Include the `bridge_runs` counter.
3. **[impact: HIGH / effort: MEDIUM] Ship `distribution.ts` + offer-positioning UX (D4).**
   `percentileOfRate` returning a RANGE + counter dollars is the pillar's recruiter payoff
   ("offer sits at ~p35, counter $X for p50") and is pure-function testable like the rest
   of the engine.
4. **[impact: MEDIUM / effort: LOW] Wire OEWS quantile-RATIOS as shape priors for APP +
   sub-top-code cells (D3), with `top_capped` honesty for the rest.** The table is already
   vendored (`blsOewsBaseline.ts`); this is transform code, not data acquisition.
5. **[impact: MEDIUM / effort: LOW] Wire LocumSmart bid-ceiling quantiles as the
   cross-axis sanity bound (D3).** `observedHcoProfile`/`observedSpecialtyProfile` already
   compute p25/p50/p75 from observed data (`liveCalibration.ts:198-200,229-231`) and have
   zero consumers — cheapest observed-data win in the codebase.
6. **[impact: MEDIUM / effort: MEDIUM] Decide the paid-benchmark license question
   (MGMA/SullivanCotter/AMGA) for physician upper-tail shape (F6/F7).** Without one, Tier-P
   physician upper tails rest on pooled internal data only — acceptable but wider. Business
   call for Zach; ingest as ratios + edition-named `prior_ref` only.
7. **[impact: MEDIUM / effort: MEDIUM] Persist the capped survivor-value vector per bucket
   (D5 Phase 1)** so distributions are auditable/regradable; resolve the public-read
   exposure question explicitly (new RTDB read rule vs accept — `database.rules.json:26-47`).
8. **[impact: HIGH / effort: HIGH — dependency, owned by the taxonomy workstream] The
   19/152 taxonomy chasm (map 06 §3.4) caps everything.** Percentiles inherit the same
   ceiling as anchors: most cells stay Tier P until producer names map onto engine keys.
   Called out here as the binding constraint, not re-designed here.
9. **[impact: LOW / effort: LOW] Backtest hooks:** log shown quantiles into `quote_events`
   and add the interval-coverage check to the improvement plan's validation battery
   (`docs/rate-simulator-IMPROVEMENT-PLAN.md:103-107`).

---

## Open questions

1. **Pooling constant k and the method-tier percentile widths (D2/D4)** are engineering
   constants until the first backtest — who signs off on the initial values, and do we
   gate Phase 2 display on a first coverage check against held-out observations?
2. **Marit Health ingestion** — legally/ethically usable (give-to-get wall, ToS)? If yes,
   it's the only external locum-typed distribution seed; if no, drop it from the design.
3. **Paid benchmark license** (MGMA vs SullivanCotter vs neither) — needed only for
   physician upper-tail shape; is the spend justified vs waiting for our own pooled data?
4. **Where does the CRNA/Supabase envelope route** — through the bridge into
   `distribution` (keeps hub Supabase-free) or via lifting the `sim-live.ts:19-23`
   injection ban? Bridge route recommended; confirm.
5. **Geo dimension:** distributions are national-only today (S7). When state cells
   materialize, does the state distribution shrink toward national (recommended: yes,
   same ladder) — and does STATE_MULT then become a residual check instead of the primary
   geo signal?
6. **Does the band eventually BECOME the distribution** (band = [p10,p90] projection,
   Phase 4) — or stay a separate curated artifact forever? Recommend deciding after two
   quarters of coverage telemetry, not now.
7. **DAY-unit ingestion** (map 05 seam 1) — the call-only market can't get distributions
   until the fleet persists daily-rate observations; is that unblocked in the WS1 fleet
   phase?

---

## Fact-check queue (every external $ / corporate / behavioral claim above)

- MGMA DataDive reports percentiles 10th–90th; outside that range requires paid custom
  analysis. (mgma.com/datadive/provider-compensation; FAQ)
- MGMA 2024 report (2023 data) primary-care total comp: p25 $256,853 / p50 $312,427 /
  p75 $377,553 / p90 $463,654. (mgmatraining.com ProviderSpecialtyRollUps2024.pdf)
- SullivanCotter Physician Comp & Productivity Survey: 541 orgs / ~215,400 practitioners;
  publishes percentile benchmarks (e.g. p25 family medicine $191,683). (sullivancotter.com)
- AMGA 2025 survey: ~185,000 providers, 482 groups, 183 physician+APP specialties. (amga.org)
- AAPA 2026 Salary Report: median PA comp $140,000 (2025) up from $134,000 (2024); reports
  p25/p75/p90 breakdowns. (aapa.org news, May 2026)
- Marit Health: locum tenens physician average $290/hr; physician salary mean $465,575 /
  median $414,000 / p25 $310,000 / p75 $572,000 / p90 $750,000 (20,317 salaries, June
  2026); locum FM $156/hr; locum NY physician $330/hr. (marithealth.com)
- Behavioral claim: locum agencies (Locumstory/CHG, Locums.com, CompHealth,
  LocumTenens.com, Weatherby, AllStar, Wapiti) publish ranges/averages only, no percentile
  tables. (their 2025 rate pages; LocumTenens.com methodology annualizes ~2,000 hr/yr)
- BLS OEWS May 2024 publishes p10/p25/p50/p75/p90 hourly per SOC per state; hourly top-code
  ≈$115.00 (annual $239,200) suppresses physician upper percentiles. (bls.gov/oes — the
  top-code FIGURE needs the primary citation; the null pattern is OBSERVED in
  `blsOewsBaseline.ts`)
- 2025 locum ranges quoted by agency sources (context only, not used in math):
  anesthesiology $300–400/hr, EM $200–300/hr, cardiology $250–350/hr, FM $120–145/hr,
  "average $200–225/hr". (locums.com 2025, wapitimedical.com 2025, locumstory.com 2025)
- Rousseeuw & Verboven 2002 — robust scale estimation floor at n=4 (already cited in code,
  `marketRates.ts:396-397`).
