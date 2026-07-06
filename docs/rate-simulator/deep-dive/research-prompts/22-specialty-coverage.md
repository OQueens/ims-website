# Research Prompt — Full-Specialty Coverage (refreshes brief 22)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/22-specialty-coverage.md`.
> "Every single specialty in the locums world." No rates proposed — coverage gaps, mislabel
> mechanics, demand signals, seeding sources only.

## Scope
The engine quotes 88 cells; the locum universe is ~140-160. Three defect classes in fix order:
(1) the **taxonomy chasm** (152 producer names ↔ 88 engine keys, 19-name intersection), (2) missing
cells **fail dangerously** into wrong bands (default → `internal medicine`), (3) band quality is
thin (0 static 'high', 19/88 quotable call).

## Code anchors to re-verify
- `src/lib/rate-engine/specialties.ts:56-166` (88 keys + confidence distribution), aliases `:243-381`
- `agent-sdk/shared/specialty_canonical_list.json` (152 cells, 5 tiers) + `specialty_canonical.py:75-119`
- `bridge-rate-intelligence.ts:1477` (`knownSpecialties` = engine keys), `aggregateBridge.ts:833-840` (`unknownSpecialties` drop)
- `rateCalculator.ts:77-94` (`mapSpecialty` — the silent IM default + substring mis-folds)
- `callRates.ts` (19/88 quotable), `iron_dome.py:16-53` (29 bands — band coverage co-blocker)

## Questions to refresh
1. Re-verify the 19-name intersection (set-compare the two vocabularies).
2. Universe count (ABMS 38+89; LocumTenens.com 155-name tree; IAS SPECIALTY_UNIVERSE.md ~140 cells ≥3 bookings).
3. Missing-with-demand cells (radiation oncology 41, PA-CV surgery 68, CNM 16, etc. from IAS bookings).
4. Demand signals (AAPPR/AMA locum-usage %, AMN 2026 list, CompHealth top-12, SIA market size).
5. **Live telemetry:** `bridge_runs.errors_json` unknown-specialty mix for the last 30 days (ranks the mapping rows).

## Deliverable
Rewrite brief 22 (gap table with priority + seed source per cell) + update BACKLOG rows for mapping
layer, kill-IM-default, add P1 cells, refresh universe + collapse anti-test, pin taxonomy tests,
extend call-band coverage.
