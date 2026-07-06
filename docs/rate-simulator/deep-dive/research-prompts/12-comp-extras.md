# Research Prompt — Stipends, Gratis & Extras (refreshes brief 12)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/12-comp-extras.md`.

## Scope
Every non-base-rate comp element: sign-on/completion/retention bonuses, travel/mileage/parking,
housing/lodging, rental car, malpractice + tail, CME, licensing/credentialing, meal per-diem
(M&IE), and gratis/pro-bono. For each: is it separate-by-norm or part of effective rate; what the
engine does (display-only / dead code / dormant / destroyed at parse); and the manipulation-vector
implications.

## Code anchors to re-verify
- `agent-sdk/agents/rate_scraper/card_extractor.py:37-42,88-103` (`_DOLLAR_REJECT_UNIT` destroys stipend/bonus $)
- `src/lib/rate-engine/callRates.ts:378-404` (GSA FY2026 table — zero hub consumers), `rateCalculator.ts:643-653` (`lookupGsa`)
- `src/lib/rate-engine/liveCalibration.ts:40,56` (`insuranceProvidedBy` dormant), `:39,58` (credentialing time)
- `src/lib/rate-engine/rateCalculator.ts:606-618,834,857` (gratisHrs/callback carried, never priced)
- `src/lib/hub/sim-adapter.ts:318-321` (fixed 20% call bill; travel/housing block absent)

## External questions to refresh
1. Agency-pays-extras norm for 1099 physician locums (Locumstory, Weatherby, Barton, CompHealth
   malpractice terms $1M/$3M + tail) — the fact that makes a rate-only sim roughly like-for-like.
2. Malpractice tail cost basis (AMN: ~100-200% of annual premium — UNVERIFIED %) and its
   specialty/state variance (why NO flat multiplier).
3. Travel-nursing wage-recharacterization precedent (Clarke v. AMN Services, 9th Cir. 2021) — the
   disguise vector the 1099 physician norm mostly closes.
4. Completion-bonus prevalence/magnitude in locums (no named survey quantifies it — AMN's $38,315
   signing figure is PERM only; flag).
5. GSA FY table currency (goes stale 2026-10-01 → FY2027) — refresh mechanism needed if wired.

## Known claims to re-check
GSA FY2026 $110/$68/$178 standard (audit-verified); tail 100-200% of premium (UNVERIFIED); ERA
$3-5k bill vs $1.5-3k pay day bands (UNVERIFIED); "many locum contracts include CME" (UNVERIFIED,
conflicts with the no-benefits 1099 norm).

## Deliverable
Rewrite brief 12 + update BACKLOG rows for side-channel extras capture, GSA logistics panel,
expected-callback band, malpractice flag, headline-inflation bit, bill-honesty label, sub-floor counter.
