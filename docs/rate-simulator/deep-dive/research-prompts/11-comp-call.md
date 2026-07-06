# Research Prompt — Call Pay (refreshes brief 11)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/11-comp-call.md`.

## Scope
Call pay as a top source of quote error. Enumerate every call construct in the locum market
(unrestricted/beeper, restricted/in-house, worked-day-during-call, callback/activation, gratis
hours, weekend/holiday differentials, frequency/burden ratio), cite real ranges, and map each to
the engine — flagging what is FIRST-CLASS, PARTIAL, or a GAP.

## Code anchors to re-verify
- `src/lib/rate-engine/types.ts:229-250` (`CallCompModel`, `CallRateBand` w/ `coverageHrs`)
- `src/lib/rate-engine/callRates.ts:34-353` (CALL_RATE_DATA — count entries / quotable bands / gratisHrs / callback)
- `src/lib/rate-engine/rateCalculator.ts:766-875` (`calculateCallRate`), `:673` (flat 1.10× hourly call), `:572-603` (`detectCallOnly`), `:444-501` (`inferDayType`)
- `src/lib/hub/sim-adapter.ts:141,145` (manual `hasCall:false`/`isCallOnly:false`), `:317-321` (fixed 20% call bill)
- `agent.py` `_POSTING_UNIT_UNSUPPORTED_COUNTER` (DAY drop kills call daily observations)

## External questions to refresh
1. Restricted (in-house) vs unrestricted (beeper) premium — Becker's 11-factors, Pinnacle, Coker,
   SullivanCotter On-Call survey. LOCUM-side spread (only one internal pair on file: Bright Line
   anesthesia in-house $3,500/12h vs pager $1,500/12h).
2. Per-24-hr call stipend ranges by specialty (Physician Side Gigs on-call DB; the engine's own
   28-source 2026-06-03 research). Keep locum vs employed-FMV strictly separate.
3. Callback $/hr + gratis-hour norms (2-4h) per surgical/procedural specialty.
4. Weekend/holiday call daily stipends — historically the sparsest field (holiday = 0/88 today).
5. Trauma-designation premium (~15-25%); call frequency (1:N, q2) pricing evidence.

## Known claims to re-check
Neurosurgery beeper $4,200-4,800 (callRates.ts:73-82); anesthesiology worked-day $2,675-3,900;
the uncited flat 1.10× call multiplier; the trauma $2,500 "beeper" possible label mismatch; the
20% fixed call-only margin (uncited convention).

## Deliverable
Rewrite brief 11 + update BACKLOG rows for split CallRateEntry, DAY funnel/call overlay, manual
call control, cite/replace 1.10×, expected-callback scenario, feedback call_daily, SullivanCotter prior.
