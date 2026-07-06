// RETIRED 2026-07-06 (rate-sim Plan 1D). This script used to vendor the ias-dashboard
// engine over src/lib/rate-engine/, rmSync-ing the live dir FIRST. That direction is now
// WRONG: the live ias-website copy is CANONICAL. Running it would (1) revert the live-only
// premium-erasure fix (marketRates.ts:538-540 -> legacy Math.max) and (2) permanently delete
// src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts. The parity gate imports only the
// Phase-1 barrel (excludes marketRates.ts) so it would NOT catch either regression.
//
// The engine is now edited in place; behavioral parity vs the frozen golden master is gated by
// src/lib/hub/rate-engine-parity.test.ts. If you truly need to re-vendor FROM the dead twin,
// resurrect this from git history deliberately and know it reverts the premium fix.
console.error(
  '✗ sync-rate-engine.mjs is RETIRED. The live src/lib/rate-engine copy is canonical; ' +
  'a sync would revert the premium-erasure fix and delete the overlay guard test. Aborting.',
);
process.exit(1);
