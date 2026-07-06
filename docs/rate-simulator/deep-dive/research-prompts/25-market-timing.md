# Research Prompt — Market Timing / Temporal Dynamics (refreshes brief 25)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/25-market-timing.md`.
> Rates are a time series; the engine models time as a **binary 7-day cliff** with no recency
> weighting, trend, seasonality, or curated-prior staleness metadata.

## Scope
Seasonality, demand-surge events, secular trends, staleness decay — the external evidence they
exist + the concrete mapping onto the engine. **Load-bearing negative finding:** no public source
quantifies locum *rate* seasonality amplitude → measure it from our own spine → persisting posterior
history NOW is the highest-leverage move.

## Code anchors to re-verify
- `bridge-rate-intelligence.ts:99-101,306-314` (7-day window), `marketRates.ts:136,154-158` (reader gate)
- `aggregateBridge.ts:92,130-131` (flat evidence_weight=1.0), `cellAggregation.ts:79,118,341` (the unused decay hook)
- `marketRates.ts:828-853` (calibration = last-10 COUNT window, not time)
- `multipliers.ts:18,39-44` (holiday/duration = per-assignment, NOT seasonality); `stateData.ts:100-118` (static demand class)
- Curated staleness: no `asOf` anywhere; `callRates.ts:4-7` (2026-06-03 snapshot), GSA FY2026

## External questions to refresh
1. Demand seasonality (winter respiratory, summer PTO, July turnover) — direction cited, rate
   amplitude UNVERIFIED.
2. Surge magnitudes (strike-nurse 2-3×; 2022 tripledemic peds ~3×; urgent-fill 20-40%).
3. Two-sided decay evidence (travel-nurse bill rates −20% YoY correction).
4. Secular per-specialty trends (CHG 2025: anesthesia +55% vs EM −8% same year; locum bands +3-22% YoY).
5. Prioritize NON-CHG trend sources (SIA, AMN, Medicus) to avoid confirming priors with priors' author.

## Deliverable
Rewrite brief 25 (buildable-now vs needs-data split) + update BACKLOG rows for posterior snapshots,
recency decay + effective-n, freshness SLA + alert, as-of surfaces, re-audit cadence, trend flags,
surge flags, datePosted extraction, defer-seasonal, calibration decay.
