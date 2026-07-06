# Research Prompt — Data-Source Expansion (refreshes brief 19)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/19-data-sources.md`.
> Standing scraping discipline: `~/.claude/rules/rate-scraper.md` (respect rate limits, circuit
> breakers on paid APIs, no fabrication, per-board ToS review).

## Scope
Widen the anchorable source universe. The binding constraint is **independent-family count per
cell** (anchor gate needs ≥2 families; the posting path has ONE verified today: AMN). Catalog
scrapable per-job $/hr families (direct-agency boards + JSON-LD aggregators that recover
pay-opaque agencies) and schedule the four co-blockers WITH expansion.

## Code anchors to re-verify
- `agent-sdk/agents/rate_scraper/posting_sources.py` (AMN live; DocCafe/Physemp/emCareers/LJO staged), `sources.py:135-231` (6 tuned + 18 generic)
- `dedup.py:121-147` (family-recovery seam), `sourceFamily.ts:73-121` (registry + never-anchor)
- `iron_dome.py:16-53` (29 bands vs 152 canonical), `agent.py:491-495` (DAY/WEEK drop), `522-524` (no-tight-bound guard)
- `marketRates.ts:419-422,473-512` (anchor gate) — the bar every source must clear
- Migration `20260701000000` (apply-before-any-aggregator prerequisite)

## Questions to refresh (live-verify selectors before flipping `verified=True`)
1. Direct-agency boards: AMN, Cross Country, LocumTenens.com mobile, gaswork (anesthesia/CRNA, has
   1099/W2 flag), Aya (daily-quoted). Independence math per specialty.
2. JSON-LD aggregators: Physemp (proven), DocCafe, LJO (`aggregator_estimate`, never anchors), Vivian.
3. Society boards (ACR mandated disclosure; JAMA/emCareers/radworking) + pay-transparency laws (17
   states) as a geo lever for state-attributed rows.
4. Family registry additions (trackfive/communitybrands/madgex/ingenovis/tandym/consilium/medicus).
5. Per-board ToS/robots posture; 1099-posting legal applicability of transparency statutes (counsel-grade if cited publicly).

## Deliverable
Rewrite brief 19 (Tier A/A'/A'' catalog + wire order) + update BACKLOG rows for migration, mapping
layer, staged-board flips, net-new families, IronDome expansion, Vivian, DAY channel, transparency
scrapes, Marit prior, society sweep, freshness, family registry, ToS checklist.
