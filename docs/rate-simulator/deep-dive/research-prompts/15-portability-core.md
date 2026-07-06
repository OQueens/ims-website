# Research Prompt — Headless `@ims/rate-engine` Core (refreshes brief 15)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/15-portability-core.md`.

## Scope
Design/refresh the extraction of ONE framework-free, dependency-light rate-engine package so the
hub and every future surface (Discord/Slack/ATS/API) import the same core. Confirm the dependency
audit, the singleton-overlay hazard, the `MarketSource` REST port, the producer-repoint order, and
the migration path (each step independently green; hub live throughout).

## Code anchors to re-verify
- Grep `src/lib/rate-engine/*.ts` for non-relative value imports — expect ONE: `marketRates.ts:9` (`firebase/database`); `runtime.ts:18-19` types-only.
- `marketRates.ts:319,678,804` (3 `get(ref(...))` read sites → `MarketSource.read()`)
- `sim-live.ts:12-17` (singleton contract), `specialties.ts:195,219` (frozen snapshots for instance-scoping)
- `sim-adapter.ts:28` (barrel-bypass deep import), `:263-278` (confidence blend to absorb)
- `scripts/sync-rate-engine.mjs:17-66` (the backwards sync — tombstone target)
- Bridge imports from the dead app: `bridge-rate-intelligence.ts:52-59`, `aggregateBridge.ts:25-27`
- `02-hub-adapter-layer.md §10` (confirmed two-way drift — re-diff before any sync)

## Questions to refresh
1. RTDB rules export (public-read confirmation — load-bearing for the REST adapter).
2. Astro/Vite compiling a linked workspace TS package (spike; fallback `tsc` build).
3. Bridge delivery choice (source-vendor vs GitHub Packages) — EC2 credential appetite.
4. Cloudflare Workers script-size limits vs core bundle (~210 KB core; BLS table 476 KB subpath-only).
5. Re-run `src/lib` suite to confirm green before starting.

## Deliverable
Rewrite brief 15 + update BACKLOG rows for Step 0, package extract + MarketSource, quote façade,
instance-scoping, REST swap, bridge repoint + delete dead twin, first API surface, hygiene riders.
