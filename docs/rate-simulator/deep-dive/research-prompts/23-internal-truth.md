# Research Prompt — Internal Ground Truth (refreshes brief 23)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/23-internal-truth.md`.
> Actual-paid observations as the highest-trust rung. **Foundational fact (Zach-confirmed):** IMS
> does NOT document what it actually pays ("we have the BILL rate but not what we PAID… it changes
> and we don't document that"). So `actual_paid_locum` cannot be backfilled for pay — it must be
> born at deal-close going forward; the bill side CAN be backfilled from LocumSmart.

## Code anchors to re-verify
- `src/pages/api/locumsmart-events.ts:54-119` (`ls_events` lossless, zero rate columns), `locumsmart-webhook-logic.ts:42-97`
- `ims-ls-tap/*` + `ls-analytics.ts` (Sisense KPI tap — aggregates only, bill-side)
- `ias-dashboard/supabase/migrations/20260422173200_sisense_rs0.sql` (RS-0 schema built) + `scripts/sisense/` (10-byte stubs)
- `marketRates.ts:119-124,419-422` (`actual_paid_locum` rank-4 anchorable), `:784-995` (calibration loop, 0 hub callers)
- `hco-contract-caps-WORKSHEET.csv` (Atrium CRNA pay/bill 0.862 — the one internal observation)
- Recon: `docs/locumsmart-recon/artifacts/sisense-cube-schemas.json` (`Fact_ProposedChanges` rate axes)

## Live questions to refresh (Supabase-gated — need Zach)
1. `SELECT event_type, count(*) FROM ls_events GROUP BY 1` + inspect a Timesheet/Invoice raw_payload.
2. The 3 LS-semantics questions: distinct `confirmationAgreementId` ≡ one placement? fill-rate
   denominator? `totalMarkup`/`totalExpense` = bill vs margin vs expense?
3. Are the `Fact_ProposedChanges` rate axes bill-to-HCO (vendor↔HCO), not physician pay?
4. Was RS-0 migration applied to prod? Retention of `ls_events`/`rate_intelligence`?
5. External margin ranges (staffing markup 30-75%, locum agency 15-50%) — the pay/bill ratio is a
   per-HCO learned parameter, not a constant (reconcile the 0.80/0.22/0.35 conventions).

## Deliverable
Rewrite brief 23 (the designed loop diagram) + update BACKLOG rows for feedback writer, bill
registry, internal rung gate, bill-bound clamp, quote-vs-paid KPI, pay-doc gap, margin reconcile,
confidentiality contract.
