# Research Prompt — Competitor Teardown (refreshes brief 18)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/18-competitors.md`.

## Scope
Every tool a physician/recruiter/facility could use instead of the hub sim — data source,
granularity, transparency, what it gets right, the gap an accuracy-first provenance-backed
everywhere-embeddable locum engine exploits. Five archetypes: agency content-marketing pages, W2
salary surveys, verified crowdsourced platforms, job-board transparency, clinician calculators.

## Code anchors (our positioning, cite)
- `specialties.ts:3-5,20-36` (curated prior cites LocumStory/CHG — the circularity risk)
- `marketRates.ts:119-124,419-422` (W2 `permanent_wage_proxy` never anchors), `469-551` (anchor gate)
- `sourceFamily.ts:73-121` (family collapse; ZipRecruiter/Adzuna never-anchor)
- `sim-adapter.ts:372` (our percentiles are ALSO fabricated-shape today)
- `liveCalibration.ts`, `quote_events`/`quote_outcomes` (proprietary feeds no competitor has)

## External questions to refresh (all STATED → claims_to_verify)
1. **Marit Health** (the credible threat): locum hourly pages + per-specialty/state n, methodology,
   funding. Watch/partner as `crowd_survey`, not build-target.
2. LocumStory/CHG, CompHealth, Weatherby, Barton "salary tools" — methodology (none), ranges.
3. W2 surveys (Doximity, Medscape, MGMA DataDive — the only day-type on-call percentiles, paid+perm).
4. SalaryDr NPI-verification pattern; Resolve contract-verified data; Vivian/Ivy posting transparency.
5. Any public locum-rate API (negative claim — attempt to falsify: Medicus, Hayes, AMN Passport).

## Deliverable
Rewrite brief 18 (keep the differentiation table current) + update BACKLOG rows for provenance
panel, observed percentiles, DAY/call overlay, side-channel extras, weaponize internal feeds,
API/embed, break circularity, methodology page, Marit-as-partner.
