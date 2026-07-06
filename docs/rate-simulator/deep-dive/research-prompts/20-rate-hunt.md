# Research Prompt — Known-Pain Rate Hunt (refreshes brief 20)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/20-rate-hunt.md`.
> "Specific rates feel wrong." Audit curated cells against cited public locum 1099 comparators.
> Nothing here changes code — it produces a flagged, cited hit-list for the cited-audit process.

## Method
"Engine default quote" = the band's p70 (`specialties.ts:179`) — exactly what the hub quotes for a
National / day / community / standard manual request. For each cell: READ the engine band
(file:line), gather cited external comparators by quality tier, flag TOO-HIGH / TOO-LOW / ALIGNED /
UNVERIFIED. Comparator tiers: T1 agency locum pages (Barton, LocumStory/CHG, AnesthesiaOnCall), T2
community (Physician Side Gigs), T3 advertised aggregates (AMN, Marit), T4 derived (AllStar),
POISONED (ZipRecruiter, Sermo hourly, salary.com — contamination evidence only).

## Code anchors to re-verify
- `src/lib/rate-engine/specialties.ts:56-166` (88 bands), `:179` (p70)
- `src/lib/rate-engine/callRates.ts` (internal cross-checks, e.g. pathology worked-day implies $185-215/hr)
- `agent-sdk/core/iron_dome.py:16-53` (CRNA 120-250 rejects the cited $275-325 surge; allergy 200 < curated 215)

## Questions to refresh
1. Re-fetch LocumStory 2025 trends + Barton/PSG/AnesthesiaOnCall/AllStar/Marit per flagged cell.
2. Re-flag the too-high set (pediatrics, OB/GYN, endocrinology, family-medicine top) and the
   too-low set (GI ~$365, pathology max).
3. The systemic p70-as-default question (Finding 8) — quote sits at p70 of a premium-topped band.
4. Watch T1 pages laundering poisoned data (Barton's newer guides cite ZipRecruiter/Sermo).
5. The ~55 curation-only cells — which now have a clean public comparator?

## Deliverable
Rewrite brief 20 (flagged table + corroborated table + unverified list) + update BACKLOG rows for
cited re-audit, ingestion-ceiling fixes, fleet-at-divergence-cells, pathology max, per-band
citations, default-position decision, missing keys, poisoned-comparator list, feedback loop.
