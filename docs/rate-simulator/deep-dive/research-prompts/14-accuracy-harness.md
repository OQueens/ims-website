# Research Prompt — Continuous Accuracy Harness (refreshes brief 14)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/14-accuracy-harness.md`.

## Scope
Design/refresh the system that PROVES quotes stay accurate over time: regression, invariants,
canaries, per-quote provenance, benchmark reconciliation, CI gates. Inventory what exists (golden
master, overlay suite, gate-2 suites, bridge tests, scraper partition, IronDome, dormant audit
engines) and what does NOT (nothing gates a deploy; no data-path canaries; no quote provenance
chain; benchmarks age silently).

## Code anchors to re-verify
- `.github/workflows/ci.yml` (ias-website — `build`+`verify` only, no vitest); ias-dashboard (no CI); `agent-sdk/.github/workflows/preflight-a1.yml` (subtree-only)
- `src/lib/hub/rate-engine-parity.test.ts:50` (`>=150` floor — should be exact 207)
- `src/lib/rate-engine/__tests__/{goldenMaster.json,marketBucketsOverlay.test.ts}`
- `bridge-rate-intelligence.ts:1172-1183` (partition invariants asserted by NOTHING at runtime) + `verify_phase3_telemetry.cjs` (manual)
- 4 divergent plausibility tables: `specialties.ts`, `iron_dome.py:16-53`, `rate_auditor/agent.py:30-96`, `blsSanityCheck.ts:220-224`
- Benchmark vintages: `blsOewsBaseline.ts` (May-2024; May-2025 shipped 2026-05-15), GSA FY2026 (stale 2026-10-01)

## Questions to refresh
1. Current CI/deploy config (does CF Pages gate on tests? — needs Zach/CF config).
2. Property-testing tooling (fast-check + @fast-check/vitest; Hypothesis already a py dep).
3. Latest BLS OEWS + GSA FY vintages vs what's vendored.
4. rate_validator/rate_auditor scheduling status (revive vs retire).
5. `bridge_runs`/`rate_intelligence` retention horizon (bounds provenance replay).

## Known claims to re-check
Golden master is 207 on disk (docs say "208"); ~957 src/lib + ~873 py green (re-run to confirm);
RTDB deployed-rules parity (S5).

## Deliverable
Rewrite brief 14 + update BACKLOG rows for CI gate, property suite, canaries+drift, provenance
object, benchmark reconciliation, golden-master extension, bridge fail-closed + rules drift check.
