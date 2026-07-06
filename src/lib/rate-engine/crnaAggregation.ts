// ⚠ CANONICAL LIVE COPY. This is the rate engine imstaffing.ai/hub serves; edit it here. The ias-dashboard twin is DEAD.
// Do NOT re-sync (scripts/sync-rate-engine.mjs is retired). Behavioral parity vs the frozen golden master: src/lib/hub/rate-engine-parity.test.ts.
// === Phase 3 (A.3, AGG-04, D-33) — re-export shim ===
// The MAD outlier-rejection + IVW aggregation logic that previously lived in this
// file was EXTRACTED VERBATIM into ./cellAggregation.ts so that BOTH the bridge
// (scripts/data-refresh/) and the CRNA path (crnaCellLookup.ts) consume ONE shared
// pure implementation — no copy-paste fork (D-33 single-implementation invariant).
//
// This file is now a compatibility shim: `export *` re-exports every VALUE and TYPE
// (aggregateCell, MIN_VARIANCE, MIN_WEIGHT, MAX_RATE_MID, Observation, OutlierRejection,
// AggregateConfidence, CellAggregate) so existing importers resolve unchanged:
//   - crnaCellLookup.ts            : import { aggregateCell, ... } from './crnaAggregation'
//   - __tests__/crnaAggregation.test.ts : import { aggregateCell, ... } from '../crnaAggregation'
// The untouched regression test (39 cases) staying green is the D-33/D-41 zero-math-drift proof.
export * from './cellAggregation'
