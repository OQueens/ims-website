// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// RateObservation — the default-deny / Proof-Carrying-Numbers type (Phase 4 OBS-04).
//
// An observed locum rate is UNREPRESENTABLE without its citation: there is NO
// `observed: true` variant that lacks `citedText` / `charRange` / `employmentEvidenceSpan`.
// A downstream caller therefore CANNOT construct an uncited observed rate — it is a `tsc`
// compile error (default-deny). The `observed: false` arm is payload-free (the "insufficient
// data" / suppressed case). Discriminant = `observed`, mirroring the engine's existing
// discriminated-union style (CalculatedRate's `isCallOnly`, StorageRead's `ok`).
//
// Pure, framework-free: lives in engine/, imports NOTHING from firebase/db. `export type`
// is required (verbatimModuleSyntax). The verbatim `citedText` is the span the non-AI VERIFY
// stage (verify.py) proved a literal substring of the stored chunk; `charRange` is the
// char/block-index range; `employmentEvidenceSpan` is the span proving LOCUM (1099/contract).
export type RateObservation =
  // The false ("insufficient data" / suppressed) arm is PAYLOAD-FREE. The observed-arm
  // fields are pinned to `?: never` so an object carrying a rate/citation cannot be assigned
  // to the false arm even through a variable — excess-property checks alone only catch fresh
  // literals, not variable indirection (Codex 04-04 Task3 r1).
  | {
      observed: false
      rate?: never
      unit?: never
      isLocum?: never
      sourceUrl?: never
      citedText?: never
      charRange?: never
      employmentEvidenceSpan?: never
      scope?: never
      sourceId?: never
      fetchedAt?: never
    }
  | {
      observed: true
      rate: number
      unit: '$/hr'
      /** A W2 / annual number can never be an observed locum rate — always true here. */
      isLocum: true
      sourceUrl: string
      /** The verbatim cited span (VERIFY-proven a literal substring of the stored chunk). */
      citedText: string
      /** char range, or block-index range for custom-content document blocks. */
      charRange: [number, number]
      /** The span proving the rate is LOCUM (1099 / contract), not annual / W2. */
      employmentEvidenceSpan: string
      scope: 'state' | 'region' | 'national'
      sourceId: string
      fetchedAt: string
    }
