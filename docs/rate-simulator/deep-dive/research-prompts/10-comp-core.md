# Research Prompt — Core Pay Structure (refreshes brief 10)

> Follow the shared guardrails in `README.md` (north star, topology, no-fabrication, OBSERVED vs
> ESTIMATED, output discipline). This prompt refreshes `../briefs/10-comp-core.md`.

## Scope
How locum physician pay is STRUCTURED — the unit and arrangement of the number itself: **hourly,
daily/worked-day, per-shift, call-period stipend, $/wRVU production**, under one arrangement axis
(**W2-locum vs 1099-locum**) and two floor mechanisms (**minimum-hour guarantees, overtime**). For
each: where the market uses it, cited ranges, and exactly what the LIVE engine does (first-class,
partial, dropped, or rejected).

## Code anchors to re-verify
- `src/lib/rate-engine/specialties.ts:16` (bands are HOURLY locum pay), `:179` (p70 formula)
- `src/lib/rate-engine/rateCalculator.ts:656-726` (hourly formula), `:673-675` (call/holiday mults)
- `src/lib/rate-engine/marketRates.ts:562-609` (`rateMode` hourly vs call_daily, LEGACY_CALL_DAILY_FLOOR)
- `agent-sdk/agents/rate_scraper/agent.py:491-495` (DAY-unit drop), `card_extractor.py:37-42,67-73` (unit gates, wRVU reject)
- `src/lib/rate-engine/blsSanityCheck.ts:73-89` (LOCUM_MULTIPLIER), `crnaCellLookup.ts:652-660` (arrangement priors)
- `src/lib/rate-engine/liveCalibration.ts:9-14,34` (observed OT caps, dormant)
- `src/lib/hub/sim-adapter.ts:139-148` (manual factor hardcodes), `:389-413` (bill margin split)

## External questions to refresh
1. Current cited hourly ranges per specialty (CompHealth, Physician Side Gigs, ResidencyAdvisor,
   locumpayguide) — note CompHealth ranges derive from **Locumstory (CHG)** (not independent).
2. Daily/worked-day and per-shift structures + example rates (ResidencyAdvisor, SalaryDr, NALTO).
3. W2-locum vs 1099-locum same-assignment premium: the **worthwhile** premium starts ~**+20%**
   (Locumstory floor); 5-10% is the break-even "not worth it" zone (ResidencyAdvisor). SE-tax
   mechanics (15.3%; 2026 SS wage base). NO hardcoded multiplier.
4. $/wRVU teleradiology (locumpayguide $45/wRVU advertised, effective $450-500/hr *contingent*).
   The "$35/$38 per-wRVU day/night" figures are **UNVERIFIED — keep out** (unit conflation).
5. Minimum-hour guarantees + overtime norms (Physician Side Gigs 5-8h minimums; FLSA physician
   exemption 29 CFR 541.304 for the exempt-status framing only).

## Known claims to re-check
CompHealth↔Locumstory non-independence; the +20% floor framing; wRVU "$35/$38" stays UNVERIFIED;
Hanover/CHG "$32.45/hr" is CHG-commissioned; SalaryDr benefit components are internally inconsistent.

## Deliverable
Rewrite brief 10 + update BACKLOG rows for R1 pay_unit, R2 worked-day, R3 arrangement bucket,
R4 guarantees, R5 OT, R6 wRVU, R7 per-unit percentile honesty.
