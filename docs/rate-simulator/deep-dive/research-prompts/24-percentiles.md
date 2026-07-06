# Research Prompt — Percentiles & Distributions (refreshes brief 24)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/24-percentiles.md`.
> The north star's second half: "where the rate sits in the market distribution." Today every
> displayed percentile is a **linear interpolation of band endpoints** (fabricated uniform shape).

## Scope
Design/refresh the move from point+band to honest distributional answers: a `RateDistribution`
object computed shrinkage-first (empirical → lognormal-shrunk → prior-shape), an additive
RTDB/data-model slot, and a recruiter "offer sits at ~p35, counter $X for p50" surface — every
quantile provenance-tagged and interval-widened when n is tiny.

## Code anchors to re-verify
- `sim-adapter.ts:238,254,372` (fabricated percentiles), `sim-render.ts:57-67` ("market median" mislabel), `rateCalculator.ts:50-53` (`getPercentileRate`)
- `marketRates.ts:84-94` (`MarketBucketData` stores mean/variance/median, NO quantiles), `:406-411` (variance = SE, not spread)
- `blsOewsBaseline.ts:29-40` (vendored p10-p90 table — but physician upper percentiles top-coded null)
- `liveCalibration.ts:73-83` (real interpolated-quantile fn on observed bid ceilings — unwired)
- `external_specialty_surveys` migration `20260507000000:34-36` (percentile-typed envelope)

## External questions to refresh
1. Who publishes percentiles (BLS OEWS, MGMA DataDive, SullivanCotter, AAPA, AMGA — all W2/perm,
   usable as SHAPE ratios only); Marit (only locum-typed, crowd_survey, give-to-get gated).
2. BLS hourly top-code figure (~$115/hr / $239,200) — the physician-upper-tail suppression.
3. Paid-benchmark license decision (physician upper-tail shape where OEWS is top-coded).

## Deliverable
Rewrite brief 24 (D1-D6 design) + update BACKLOG rows for Phase-0 relabel, `RateDistribution`,
`distribution.ts` + offer UX, OEWS shape ratios, bid-ceiling sanity bound, paid-benchmark license,
survivor-vector persistence, taxonomy-chasm dependency, backtest hooks.
