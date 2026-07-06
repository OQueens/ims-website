# Research Prompt — Geo Granularity Below the State Level (refreshes brief 26)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/26-geo-granularity.md`.
> Geography today is one number — a static `STATE_MULT` (0.88-1.38) on a national band. No sub-state
> dimension on the live path; every live bucket is `stateKey='national'`.

## Scope
Metro/rural differentials, state attractiveness factors, metro-level data sources, and a `geo_tier`
design for the cell key with an explicit shrinkage ladder. Key domain truth: the rural premium is
**specialty-heterogeneous and sometimes inverts**; physician pay **inverts against COL** (within-
state-visible, which a state multiplier cannot express).

## Code anchors to re-verify
- `stateData.ts:149-176` (STATE_MULT formula), `:94-118` (hand-curated demand class — dominant 0.40 exponent, least reproducible)
- `rateCalculator.ts:660-669` (rural neutralized to 1.0 after Kokomo audit), `multipliers.ts:23-36` (CAH 1.22 / rural_trauma 1.30 — manual sim never sets)
- `marketRates.ts:286-295` (reader prefers national → first-key state cell — arbitrary), `469-551` (mutates one national band)
- `blsOewsBaseline.ts:42` (state-level only; MSA/nonmetro files unused), `crnaCellLookup.ts:37-46,266-286` (the census-division shrinkage ladder precedent)
- `agent-sdk/shared/state_attribution.py` (state or NULL — no city/county/metro attempt)

## External questions to refresh
1. Rural premium sign per specialty (CompHealth, NEJM CareerCenter 5-10% perm, MGMA 2018 surgical inversion).
2. COL inversion (Doximity 2025 metros — directional, W2).
3. Federal sub-state machinery (Medicare geographic-HPSA 10% bonus, GPCI 109 localities + frontier
   floor, CAH certification list) — reproducible priors replacing the hand-curated demand class.
4. Metro data sources (BLS OEWS MSA/nonmetro ~530 areas; USDA RUCC 2023 county codes; HRSA HPSA files).
5. State factors (IMLC roster churn, CON 35 states, malpractice premium tiers) — context, not multipliers.

## Deliverable
Rewrite brief 26 (3-tier taxonomy + shrinkage ladder) + update BACKLOG rows for state-attribution
coverage, state-aware reader, HPSA demand class, OEWS tier ratios, expose CAH control, geo_tier
schema + attribution module, census-division ladder generalization, state-factor panel, retire METRO_CITIES.
