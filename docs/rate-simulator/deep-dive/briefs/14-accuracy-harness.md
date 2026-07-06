# Brief 14 — Continuous Accuracy Harness ("constantly test ourselves")

> Deep-dive brief, 2026-07-03. Pillar: design a system that PROVES the rate simulator's
> quotes stay accurate over time — regression, invariants, canaries, provenance, benchmark
> reconciliation, CI gates — anchored to the live topology (imstaffing.ai/hub served by
> `ias-website` `src/lib/rate-engine` + `src/lib/hub`; still-live pipeline = `agent-sdk`
> scraper → Supabase → `ias-dashboard/scripts/data-refresh` bridge → RTDB).
>
> Paths relative to `C:/Users/oclou/QueenClaude/` unless obviously in-repo. `ias-website`
> below always means the live worktree `ias-website/.worktrees/feat-ims-phase-1-plan`.
> Labels: **OBSERVED** = read from code/artifacts this session (file:line cited).
> **ESTIMATED/UNVERIFIED** = flagged inline and listed in claims_to_verify.

---

## Summary

The project already owns an unusually strong *point-in-time* accuracy arsenal: a
deterministic 207-case golden master with a byte-equality parity gate, a 22-case overlay
suite pinning the Move #1 anchor gate, seven gate-2 suites, ~130 bridge test cases, a
fail-closed accounting partition in the scraper, IronDome plausibility bands, and three
dormant-but-built audit engines (BLS sanity verdicts, rate_validator manipulation rules,
rate_auditor band cross-reference). What it does NOT have is a *continuous* harness:

1. **None of these tests gate anything.** The ias-website CI workflow runs `build` +
   `verify` only — `vitest` never runs in CI — and prod deploys are Cloudflare-Pages
   auto-builds on push to main. A red parity gate would deploy anyway. ias-dashboard
   (the bridge) has **no CI workflow at all**, and agent-sdk's preflight workflow only
   activates in the published subtree repo, not the monorepo where work happens.
2. **The regression net covers code, not data.** The golden master freezes engine *code*
   behavior; nothing continuously checks that the *numbers flowing through RTDB* stay
   sane (no canary cells, no promoted-cell-count monitor, no rate-surface diff). The
   bridge's three telemetry partition invariants are documented but asserted only by a
   manual one-shot script run by hand on EC2.
3. **A quote cannot yet explain itself.** The engine exposes clamps and multiplier
   provenance, and the bridge writes `__meta__` freight the reader never reads — but no
   per-quote object stitches "this $287" back to (bridge run → bucket → n_distinct →
   families → observation rows with source URLs), even though every link in that chain
   already exists in some table.
4. **Benchmarks age silently.** The BLS OEWS baseline is May-2024 vintage while May-2025
   estimates shipped 2026-05-15; the GSA FY2026 table will be stale on 2026-10-01; and
   three unlinked reference-band tables (engine SPECIALTIES, IronDome PLAUSIBLE_RANGES,
   rate_auditor SPECIALTY_REFERENCE) have already diverged from each other.
5. Even the folklore drifts: memory and the vendoring commit message say "208-case
   golden master"; the artifact has said `"count": 207` since the commit that introduced
   it. Harmless today — but the parity test only asserts `>= 150` cases, so up to 57
   cases could silently vanish and CI (if it ran) would stay green.

The build plan below turns the existing arsenal into a harness in five phases, mostly by
*wiring and extending what is already built* rather than inventing new machinery.

---

## Findings (cited)

### F1 — The golden master: real, deterministic, 207 cases — and its count is folklore-drifted

- Artifact: `ias-website/src/lib/rate-engine/__tests__/goldenMaster.json` — header reads
  `"version": 1, "generatedFrom": "ias-dashboard", "count": 207` (OBSERVED; grep of
  `"id":` = 207 entries; file is 337,124 bytes).
- Generator: `ias-dashboard/scripts/rate-engine/gen-golden-master.ts`. Matrix (OBSERVED):
  every SPECIALTIES key at p70 (line 55), every shift/facility/duration/rural/holiday
  branch (61-65), every STATE_MULT key + `''`/`null` (68-71), cap clamps + a 1.75-ceiling
  stress (74-81), call-only for 4 specialties × 3 day-types (84-89), 5 fixed freetext
  parses (92-98), fuzzy boundaries (101-104), codec round-trips (107-110). Deterministic
  by construction — "no 'asap', no wall-clock" (header lines 5-8).
- Parity gate: `ias-website/src/lib/hub/rate-engine-parity.test.ts` recomputes every case
  through the vendored engine and asserts `toEqual` (lines 46-58). Scope is explicitly
  the **pure Phase-1 surface only**: "the async live paths (evaluateBlsSanityCheck …,
  marketRates overlays, cellAggregation) are Phase 2" (lines 10-14) — i.e. the golden
  master does NOT cover the market overlay, the posterior math, or the hub adapter.
- **Defect (count pin):** the corpus-size assertion is `expect(corpus.length).toBeGreaterThanOrEqual(150)`
  (line 50). A regeneration that silently dropped 57 cases would pass.
- **Folklore drift (OBSERVED via git):** commit `2c72c67` is titled "vendor @ias/rate-engine
  + golden-master parity gate (208/208 byte-identical)" but `git show 2c72c67:…goldenMaster.json`
  already reads `"count": 207`; HEAD reads 207; project memory repeatedly says "208".
  Nothing broke — but this is exactly the silent-drift class an exact-count CI pin kills.

### F2 — CI gates: the tests exist; the pipeline never runs them (highest-leverage defect)

- `ias-website/.github/workflows/ci.yml` (OBSERVED, 19 lines): `npm ci` → `npm run build`
  → `npm run verify`. `verify` = `node scripts/verify-build.mjs && node scripts/voice-lint.mjs`
  (`package.json:13`) — SEO/design/voice invariants, **zero vitest**. `npm test` (`vitest run`,
  `package.json:16`) is never invoked in CI.
- Consequence: the 207-case parity gate, the 22-case overlay suite, and all ~44 test
  files under `src/lib/` (OBSERVED via glob) run only when a developer runs them locally.
  Per project memory, prod = CF Pages auto-deploy on push to origin/main (~45s)
  [UNVERIFIED here — needs the CF Pages build config]; there is no test gate between a
  commit and the live hub.
- `ias-dashboard` (bridge repo): **no `.github/workflows/` directory exists** (OBSERVED:
  `ls` returns nothing) despite 5 bridge test files with ~130 `it(` cases
  (`scripts/data-refresh/__tests__/bridgeAggregation.test.ts`, `bridgeIntegration.test.ts`,
  `bridgeFallbackErrorRow.test.ts`, `bridgeTimeout.test.ts`, `sourceReliability.test.ts`).
- `agent-sdk`: `.github/workflows/preflight-a1.yml` exists but its own header says it is
  discovered **only in the subtree-published repo**, not the QueenClaude monorepo
  (lines 7-16: "in the monorepo it sits at `agent-sdk/.github/workflows/` which GitHub
  Actions does NOT discover"); the authoritative gate is a manual operator script.
- Test-count claims "957 src/lib green" and "873 py green" come from project memory
  (2026-07-01/02) — plausible but UNVERIFIED this session.

### F3 — Runtime invariants: the scraper fails CLOSED, the bridge fails OPEN

- Scraper (exemplary): the A.1 partition `rows_attempted == rows_inserted + Σ rows_rejected_by_*`
  is enforced with an explicit `raise AssertionError` **before** the Supabase insert —
  "a violated partition refuses to persist" (`agent-sdk/agents/rate_scraper/agent.py:1432-1442`,
  1299-1307; map 04 §5). Sub-partitions (rate_type, state, published_at) each have their
  own hard sum-check, plus a negative-control test (V-21) proving the gates fire.
- Bridge (gap): the three telemetry partition invariants — DEDUP
  (`rows_read_market = distinct_observations_total + rows_collapsed_by_content_hash +
  rows_collapsed_by_dedup_group`), BUCKET (`buckets_written_total = Σ buckets_by_rate_type_*`),
  CONFIDENCE (`buckets_written_total = Σ cells_*`) — are documented at
  `ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:1172-1183` with the
  note "**the bridge asserts none of these at runtime** — they hold by construction and
  are verified on the live bridge_runs row in Task 7". The verifier is
  `verify_phase3_telemetry.cjs` — a **one-shot manual script** ("Run on EC2 with
  SUPABASE_DB_URL … checks the latest triggered_by='manual' bridge_runs row", header
  lines 1-6). So a code regression that unbalances a partition would write a poisoned
  RTDB tree and only be caught if someone remembers to run the script.
- Alerting: `bridge-cron-wrapper.sh` Slack-alerts on **exit code 2 (crash) only**;
  exit 3 (lock skip) is silent by design (header lines 11-15). Nothing alerts on
  *semantic* regressions: promotions dropping 6 → 0 (the S11 7-day cliff, map 03),
  a partition violation, or a wild posterior.

### F4 — Plausibility layers exist in FOUR unlinked copies (canary raw material, divergence risk)

1. Engine curated bands: `SPECIALTIES` — 88 keys, min/max/p70, confidence tags, zero
   'high' since the 2026-06-30 honesty pass (`ias-website/src/lib/rate-engine/specialties.ts:56-166`;
   map 01 §3).
2. IronDome: `PLAUSIBLE_RANGES` — 29 hourly bands (e.g. anesthesiology 200–600, crna
   120–250, EM 150–450 — OBSERVED `agent-sdk/core/iron_dome.py:16-51`), `DEFAULT_RANGE`
   60–700 (line 53), canonical-alias augmentation that **raises at import** on conflicts
   (73-92). Coverage delta vs the full canonical allowlist is "unquantified in code"
   (map 04 §3, fleet-phase item at agent.py:519-521).
3. rate_auditor: `SPECIALTY_REFERENCE` — 43 specialties with (min, max, confidence)
   (`agent-sdk/agents/rate_auditor/agent.py:30-96`). **Already diverged:** it carries
   anesthesiology (200, 600, "high") (line 34) while the engine's curated band is
   300–400 'medium' (specialties.ts per map 01 §3) and 'high' tags were retired
   engine-side on 2026-06-30. Same number, three meanings: IronDome's 200–600 is a
   *plausibility* band, the auditor reuses it as a *reference rate* band, the engine's
   300–400 is the *quote* band.
4. BLS ceilings: `MAX_HOURLY_CEILING` in `blsSanityCheck.ts:220-224` is "mirrored 1:1"
   with IronDome's CRNA ceiling **by convention only** (iron_dome.py:21; map 04 seam 6).

### F5 — Audit engines already built, all dormant or manual

- **BLS sanity verdicts** (dormant in hub): `evaluateBlsSanityCheck` produces
  `aligned | soft | hard | unavailable` verdicts with ±25/±40% band-aware thresholds,
  a 1.5× mean-fallback cap, and a ceiling escalation that can only tighten
  (`ias-website/src/lib/rate-engine/blsSanityCheck.ts:241, 448-455, 559-570, 210,
  226-236`). Exported, tested (gate-2 suites), **zero hub call sites** (map 01 §9).
- **rate_validator** (agent-sdk): 100% deterministic manipulation detection — outlier
  SD 2.0/3.0, source concentration 0.60/0.80, round-number modulus $50, temporal shift
  0.15/0.25, cross-source divergence 0.30/0.50, anchoring 20% (`agents/rate_validator/agent.py:22-45`),
  writing confidence-scored proposals to `agent_proposals`. Scheduling status UNVERIFIED.
- **rate_auditor**: cross-references live Firebase jobs against its reference table into
  `rate_audit_log` (`agents/rate_auditor/agent.py:1-8`). Scheduling status UNVERIFIED.
- **rate_observer VERIFY**: the deterministic anti-hallucination trust boundary (literal
  substring, single-currency-token, hour-marker, locum-proof, IronDome band checks —
  `agents/rate_observer/verify.py:10-24`) — the strongest existing pattern for
  "never trust an upstream claim without re-derivation".
- **check-compound-drift.mjs**: a *manual* pre/post-refresh compare of representative
  (specialty, state, mode) tuples that flags compound moves beyond ±25% and logs both
  capped and uncapped pay (`ias-dashboard/scripts/data-refresh/check-compound-drift.mjs`
  header + TUPLES). This is the embryo of the rate-surface snapshot monitor (H3 below).

### F6 — No property-based testing anywhere in the rate path

- ias-website: no `fast-check` in devDependencies (`package.json`), zero matches for
  `fast-check|fc.assert` under `src/` (OBSERVED grep).
- agent-sdk: `hypothesis` IS already used — but only in `tests/test_knowledge_graph.py`
  and `tests/test_learning.py` (OBSERVED grep), never on the rate pipeline
  (extractors, dedup, partition, IronDome).
- All engine/bridge tests are example-based. The invariants that hold the system together
  (monotonicity, bounds, idempotence, permutation-invariance of the posterior) are
  enforced by *specific* examples only. External tooling exists and is mature:
  fast-check + `@fast-check/vitest` for the TS side (fast-check.dev; npm
  `@fast-check/vitest` — reproducible randomized runs on top of vitest), and Hypothesis
  (already a test dep) supports property + stateful testing on the Python side
  (hypothesis.readthedocs.io). [External claims — see claims_to_verify.]

### F7 — Per-quote provenance: every link exists; the chain is never assembled

- What a quote already carries (OBSERVED): per-factor `source` tags
  (`pdf|inferred|default|manual|typed`, types.ts:187-202 per map 01 §2); the full
  multiplier decomposition + `combinedMult`/`cappedMult` ("read this, don't recompose",
  `ias-website/src/lib/rate-engine/types.ts:298-310`); clamp flags `capped`,
  `payRateCapped`, `marketMaxApplied`, `uncapped` (types.ts:311-319; SimQuote at
  `src/lib/hub/sim-adapter.ts:222-252`); band provenance `curated|live` + confidence
  tier + honest `confidenceReason` (sim-adapter.ts:228-230).
- What is missing to answer "explain this exact number": WHICH live anchor
  (weighted_mean, rateType, n_distinct, source_families, bucket lastUpdated) promoted the
  band, WHICH bridge run produced the bucket, and WHICH observation rows fed the cell.
- The raw material exists at every hop: the bridge writes `__meta__` per specialty that
  the live reader **never reads** ("write-only freight", map 03 seam S3 — bridge
  :1058-1083 vs reader `selectPrimary` recomputing client-side); `bridge_runs` carries
  the full run telemetry (bridge :443-520); every `rate_intelligence` row carries
  `source`, `source_url`, `rate_type`, `content_hash`, `dedup_group_id`, `date_scraped`
  (map 03 §1). Replay is possible today by hand (run window query + re-run
  aggregateBridge); it is just not stitched or persisted per cell.

### F8 — Benchmark reconciliation is a stale-by-default surface

- BLS: the engine's baseline is **OEWS May 2024** (`blsOewsBaseline.ts`, 18,955 lines —
  map 01 appendix). BLS released the **May 2025** OEWS estimates on **2026-05-15**
  (bls.gov news release USDL-26-0725; release delayed by the 2025 appropriations lapse
  per bls.gov/oes/update.htm) — the dormant sanity layer is one vintage stale, and
  nothing detects that.
- GSA: `GSA_STANDARD = { lodging: 110, mie: 68, total: 178 }` + ~120 city overrides,
  cited "GSA Per Diem Rates FY2026" (`ias-website/src/lib/rate-engine/callRates.ts:378-404,413`).
  Externally confirmed: FY2026 standard CONUS = $110 lodging / $68 M&IE / $178 total,
  effective 2025-10-01 → 2026-09-30, unchanged from FY2025 (gsa.gov news release
  2025-08-15). The table goes stale on **2026-10-01** (FY2027) with no refresh mechanism
  (map 05 §3 smell 3) — currently dead code in the hub, but a wrong-number source the
  day it is wired in.
- Curated bands: the call-rate table's research snapshot is the 2026-06-03 deep-research
  PDF (callRates.ts:4-7 per map 05); specialty bands cite 2025-2026 industry sources
  (specialties.ts:3-5 per map 01). No `lastReviewed` field, no review-age alarm.

### F9 — Live-data trust boundary: reader hardening is good; monitoring of it is absent

- The reader/overlay already rejects: non-finite means, non-integer or <4 `n_distinct`,
  <2 normalized families (whitespace-faking closed 2026-07-02, commit `6d9edb1`), stale
  (>7d) or missing timestamps, unknown/bill rate types, bimodal null means
  (`ias-website/src/lib/rate-engine/marketRates.ts:220-230, 469-551`; 22-case suite
  `__tests__/marketBucketsOverlay.test.ts:14-19`).
- RTDB rules (repo copy, OBSERVED `ias-dashboard/database.rules.json:26-47`):
  `market-rates`, `market-rates-v2`, `cap-rates` are `.read: true / .write: false`
  (admin-SDK-only writes — the S5 forged-node scenario requires the admin credential);
  **`rate-simulator/feedback` is `.read: true / .write: true`** with only
  "has specialty + timestamp children" validation — world-writable. Any future
  calibration consumer (improvement-plan Move #4) must treat feedback as hostile input.
  Whether the DEPLOYED rules match this file is UNVERIFIED (S5 audit still open).
- Nothing continuously compares deployed rules to the repo file, and nothing monitors
  the promoted-cell count (the day the fleet pauses 7 days, every promotion silently
  reverts to curated with zero operator signal — map 03 S11).

### F10 — What "accurate" is measured against today: nothing external, post-deploy

- The 2026-06-30 Move #1 deploy was validated by a hand-run before/after diff (0
  promotions + 6 cells reverting legacy→curated; EM −21.2% etc. — project memory /
  map 03 §5.3). That was a one-off. There is no standing backtest, no acceptance-outcome
  stream (feedback node EMPTY — improvement plan Move #4, `docs/rate-simulator-IMPROVEMENT-PLAN.md:31`),
  and no scheduled reconciliation against BLS/GSA/curated citations. The improvement
  plan's Move #8 (ADWIN/CUSUM drift monitors on residual streams,
  `docs/rate-simulator-IMPROVEMENT-PLAN.md:35`) presumes exactly the monitoring
  substrate this brief specifies.

---

## Recommendations

Each tagged **[impact / effort]**. Ordered by leverage.

### R1 — Wire the existing tests into CI and gate the deploy [high / low]

1. Add `- run: npm test` to `ias-website/.github/workflows/ci.yml` (before `verify`).
   This alone puts the 207-case parity gate, the overlay suite, and all `src/lib` tests
   between every PR and main.
2. Pin the golden-master corpus **exactly**: change `toBeGreaterThanOrEqual(150)` →
   `toBe(207)` in `rate-engine-parity.test.ts:50` (update the literal on regeneration;
   regeneration is deliberate, silent shrink is not).
3. Give the bridge a CI: new `ias-dashboard/.github/workflows/ci.yml` running
   `npm run test` (vitest) on PRs touching `scripts/data-refresh/**` or
   `src/features/rate-simulator/engine/**` (the bridge's live shared modules — map 03 S1).
4. Monorepo Python gate: a root-level workflow (or pre-push hook) running
   `pytest agent-sdk/tests -k "rate or iron or dedup or posting or classifier"` —
   the subtree `preflight-a1.yml` never fires in the monorepo (its own header,
   lines 7-16).
5. Deploy gating decision (Zach): either move the CF Pages deploy behind GitHub Actions
   (wrangler deploy after green tests) or add `npm test` to the CF Pages build command.
   Until then a red parity gate still ships to prod. [Requires CF config access —
   flagged, not assumed.]

### R2 — Property-based + invariant suite (fast-check TS, Hypothesis py) [high / medium]

Add `fast-check` + `@fast-check/vitest` to ias-website devDependencies. One new file
`src/lib/rate-engine/__tests__/engineProperties.test.ts` with an arbitrary-`RateFactors`
generator over the closed enums (88 specialties × 50+ states+null × 5 shifts × 12
facilities × 4 durations × bools × cap ranges). Properties (each is a real invariant of
the current code — cites in parentheses):

- **No-NaN / totality:** `calculateRate` returns finite, non-negative `payRate`/`billRate`
  for every generated input; `parseFreetextInput` never throws on arbitrary strings and
  always yields enum-valid factors.
- **Bounds:** `payRate ≤ spec.max` (clamp 3, rateCalculator.ts:704-707); `payRate ≤ uncapped`;
  `cappedMult = min(combinedMult, 1.75)` (679); `billRate % 5 === 0` and
  `billRate ≥ payRate` (roundUp5, :716).
- **Monotonicity (survives the clamps because they are `min` with constants):** payRate
  is non-decreasing in `baseRate`, in shift multiplier rank (day→night→weekend_night→holiday),
  and in `STATE_MULT` value; billRate non-decreasing in the margin slider
  (sim-adapter.ts:298-301, 409).
- **Call-only honesty:** `insufficientData === true ⇒ dailyPay === 0` (rateCalculator.ts:790-805);
  quotable ⇒ `pay ≤ band.max` and `coverageHrs > 0`.
- **Overlay safety (the 6d9edb1 regression class, generalized):**
  `applyMarketBucketsOverlay` is idempotent for arbitrary bucket sets; non-anchorable
  rate types NEVER mutate SPECIALTIES; forged shapes (float `n_distinct`, blank/whitespace
  families, ±Inf/NaN means, negative timestamps) never anchor; post-overlay
  `min ≤ p70 ≤ max` always; hot-anchor promotion preserves the curated `max/p70`
  premium geometry (marketRates.ts:538-540).
- **Posterior math** (in the bridge repo, `cellAggregation` — same vendored file both
  sides): permutation invariance (shuffle observations ⇒ identical output); scale
  equivariance (rates ×c ⇒ mean ×c); `weighted_mean` within [min, max] of admitted
  observations; adding ONE wild outlier to n≥5 in-band observations moves the mean by a
  bounded amount (MAD z>3.5 rejection, cellAggregation.ts:313-320); bimodal ⇒
  `weighted_mean === null` (never a number).
- **Dedup/family:** `n_distinct ≤ n_raw` (aggregateBridge invariant :971-975);
  collapse idempotence; family collapse never *increases* voice count.

Python side (Hypothesis is already installed — grep F6): properties on
`card_extractor.parse_rate_text` / `jsonld_parser` (any accepted output lies inside the
magnitude bands $60–900/hr, $400–12,000/day — card_extractor.py:72-73,
jsonld_parser.py:39-40; adversarial "sign-on bonus"/"$230k"/"per RVU" strings yield
nothing), on `canonicalise_url` (idempotence), on `recovered_source_family` (never blank;
aggregator-without-org always folds to `'unattributed'` — dedup.py:26-33), and a
generated-stream partition property (any sequence of candidates keeps
`attempted == inserted + Σ rejected`).

### R3 — Canary cells + drift alerts on the LIVE data path [high / medium]

The nightly bridge is the natural heartbeat. Build `scripts/data-refresh/canary-quotes.ts`
(runs inside `bridge-cron-wrapper.sh` after the bridge, reusing its `send_slack_alert`):

1. **Canary matrix (~15 cells), each with a cited, versioned known-good band** in one
   `canary-cells.json` (band + citation + lastReviewed). Seed bands = intersection of the
   engine's curated band and IronDome's plausibility band for that specialty (both
   OBSERVED tables; never invent a number). Cells should cover the load-bearing surface:
   the 6 Move-#1-affected specialties (EM, radiology, psychiatry, anesthesiology,
   hospitalist, urology — the deploy-diff set), CRNA (the historical over-quote case,
   rateCalculator.ts:660-669 rural fix), one call-only beeper (neurosurgery weekday,
   cited band callRates.ts:73-82), one worked-day (anesthesiology, callRates.ts:139-146),
   one stacked-premium hourly (holiday × CAH × emergency — exercises the 1.75 ceiling),
   and one thin/modeled specialty.
2. Each night: compute the quote for every canary **through the same engine + live RTDB
   overlay** the hub uses (this is the first consumer of the headless-core extraction —
   portability pillar), assert hero ∈ band, and post ONE Slack line: promoted-cell count,
   canaries in/out of band, biggest day-over-day hero move.
3. **Monitors that alert (all currently silent failure modes):**
   - promoted-cell count delta (yesterday 6 → today 0 = the S11 cliff);
   - any specialty hero moving > X% day-over-day *without* a promotion state change
     (X seeded from check-compound-drift.mjs's ±25% compound threshold — a documented
     internal convention, not a market fact);
   - bridge_runs partition invariants — run `verify_phase3_telemetry.cjs`'s three checks
     in-wrapper post-run and alert on violation (today: manual only, F3);
   - RTDB freshness: newest `lastUpdated` older than 48h while cron reports success.
4. **Rate-surface snapshot:** persist all-88-specialties default-factor quotes (hourly +
   call-only, national) per night to a `rate_surface_snapshots` table. This is the
   substrate for Move #8's ADWIN/CUSUM monitors and for any future backtest — cheap to
   start collecting NOW even before the analysis exists.

### R4 — Per-quote provenance object ("explain this exact number") [high / medium-high]

1. **Stamp the run:** bridge writes `__meta__.bridgeRunId = bridge_runs.id` (it already
   writes `__meta__` — S3's "write-only freight" becomes the provenance carrier instead
   of getting deleted). Reader (`loadMarketBuckets`) carries `bridgeRunId` + the bucket's
   `n_distinct`/`source_families`/`lastUpdated` through `MarketBucketsResult`.
2. **Assemble at quote time:** `quoteFromFactors` returns a `QuoteProvenance`:
   `{engineVersion (build sha injected at build time), factors (with per-field source
   tags — already exist), band: {min,max,p70, provenance: curated|live, confidenceTier},
   liveAnchor?: {anchor, rateType, nDistinct, sourceFamilies, bucketLastUpdated,
   bridgeRunId}, multipliers + clampsFired (already on CalculatedRate), marginPct}`.
   Render as a "Why this number?" expandable in the hub sim; attach the JSON to every
   feedback event when Move #4 lands (calibration becomes auditable for free).
3. **Deep replay recipe (document + script):** `bridgeRunId` → `bridge_runs` row →
   re-run the 7-day window query (`date_scraped` ordering is deterministic, bridge
   :306-314) → `aggregateBridge` is pure → byte-identical bucket reproduction, with
   every contributing `rate_intelligence` row's `source_url` listable. Optional phase 2:
   persist per-cell observation-id lists (the bridge already computes cellObservations —
   map 03 §3.3) to a `bridge_cell_observations` table so replay needs no recompute and
   survives the 7-day window.
4. Retention prerequisite: confirm `bridge_runs` / `rate_intelligence` retention ≥ the
   audit horizon (UNVERIFIED — open question).

### R5 — Automated benchmark reconciliation [medium / medium]

1. **Run the dormant BLS verdict engine in batch, on a schedule** — not in the UI. A
   monthly GitHub Actions job computes `evaluateBlsSanityCheck` for all 88 specialties'
   default quotes and publishes the aligned/soft/hard histogram; any `hard` verdict on a
   canary specialty fails the job. All machinery exists (blsSanityCheck.ts:373, verdicts
   :448-455); this is wiring, not modeling. Verdicts on non-canary cells are advisory
   (the LOCUM_MULTIPLIERs are self-labeled non-cited estimates, blsSanityCheck.ts:70-89 —
   treat as smoke, not truth).
2. **Vintage tripwires:** assert-in-CI that `blsOewsBaseline.ts` vintage matches the
   latest published OEWS (May 2025 out since 2026-05-15 — refresh via the existing
   `extract-bls-oews.mjs` path) and that the GSA table's FY matches the current federal
   FY (goes stale 2026-10-01).
3. **One band registry to rule the four copies (fixes F4 + map 03 S4):** a single
   machine-readable `specialty-bands.json` (per specialty: quote band + plausibility
   band + citations + lastReviewed + confidence), generated-into or consumed-by:
   engine SPECIALTIES audit test, IronDome PLAUSIBLE_RANGES, rate_auditor
   SPECIALTY_REFERENCE, blsSanityCheck ceilings. Plus one cross-repo test pinning the
   specialty key-sets equal between the bridge's `knownSpecialties` source and the live
   hub's SPECIALTIES (today: dashboard vs website copies, unpinned — map 03 S4, direct
   north-star coverage risk).
4. **Review-age alarm:** every curated band and canary carries `lastReviewed`; CI warns
   at >180 days (the call-rate research snapshot is already 2026-06-03 — callRates.ts:4-7).

### R6 — Golden-master extension + canonical inversion [medium / low-medium]

1. Move `gen-golden-master.ts` into the live repo (ias-website / the future headless
   core) and regenerate there; the dashboard becomes the consumer. Today the generator
   imports from the DEAD app's engine (`ias-dashboard/scripts/rate-engine/gen-golden-master.ts:14-18`) —
   the vendor arrow inversion named in map 01 smell 1.
2. Extend the corpus with the surfaces the parity gate explicitly excludes (its header,
   lines 10-14): overlay golden cases (pure `applyMarketBucketsOverlay` on fixed bucket
   fixtures → frozen mutated bands), SimQuote-level goldens (quoteFromFactors × margin
   sweep — pins the hub adapter math: percentiles, waterfall, confidence blend),
   `initFactors` goldens over a PDF-text fixture corpus (the 11 inference functions are
   the least-pinned high-risk surface), and call-only insufficientData surfaces.
3. Add a **bridge golden master**: fixed `rate_intelligence` row fixtures →
   `aggregateBridge` full-output JSON frozen (fixtures dir already exists;
   `bridgeIntegration.test.ts` is the seam). This catches cross-module drift the unit
   tests can't.

### R7 — Bridge fail-closed + RTDB rules drift check [medium / low]

1. Assert the three partition invariants **inside `runBridge()` before the RTDB
   `update()`** — mirror the scraper's `raise`-before-persist discipline (F3). A
   violated partition should abort the write and Slack-alert, not ship a tree.
2. CI job that exports the deployed RTDB rules (firebase CLI) and diffs against
   `ias-dashboard/database.rules.json` — closes S5 permanently instead of once.
3. Before Move #4 wires feedback into calibration: add shape/rate-limit validation on
   the world-writable `feedback` node (F9) and treat it as hostile input in the
   calibration reader (clamps already exist: [0.85, 1.15] + n≥3, marketRates.ts:849-854).

---

## Concrete build plan (phased, with files)

| Phase | Days | Deliverables | Files (create/edit) |
|---|---|---|---|
| **0 — CI gates** | 1 | vitest in CI; exact corpus pin; bridge CI; monorepo pytest job | edit `ias-website/.github/workflows/ci.yml`, `src/lib/hub/rate-engine-parity.test.ts:50`; new `ias-dashboard/.github/workflows/ci.yml`; new monorepo workflow or hook |
| **1 — Property suite** | 3-5 | fast-check arb + ~12 TS properties; ~6 Hypothesis properties on extractors/dedup/partition | new `src/lib/rate-engine/__tests__/engineProperties.test.ts`, `…/overlayProperties.test.ts`; bridge `__tests__/cellAggregation.properties.test.ts`; agent-sdk `tests/test_extractor_properties.py` |
| **2 — Canaries + alerts** | 3-5 | canary-cells.json (cited bands); nightly canary run + 4 monitors + Slack line; rate-surface snapshot table | new `ias-dashboard/scripts/data-refresh/canary-quotes.ts`, `canary-cells.json`; edit `bridge-cron-wrapper.sh`; fold `verify_phase3_telemetry.cjs` checks into wrapper; new Supabase migration `rate_surface_snapshots` |
| **3 — Provenance** | 5-8 | `__meta__.bridgeRunId`; QuoteProvenance through reader→adapter→UI; replay recipe doc; feedback events carry provenance | edit `bridge-rate-intelligence.ts` (meta write), `marketRates.ts` (reader carry), `sim-adapter.ts` (assemble), `sim-render.ts` + hub-client (display); doc `docs/rate-simulator/provenance-replay.md` |
| **4 — Reconciliation** | 5-8 | monthly BLS batch verdict job; vintage tripwires; unified band registry + cross-repo key-set pin; review-age alarm | new scheduled workflow; new `specialty-bands.json` + consumers in 3 repos; new cross-repo test |
| **5 — Golden extension** | 3-5 | generator inversion; overlay/SimQuote/initFactors/bridge goldens | move+edit `gen-golden-master.ts`; new fixture corpora; new bridge golden test |

Sequencing note: Phase 0 is a same-day win and should precede ANY further engine work —
it converts every existing test from advisory to load-bearing. Phase 2's canary runner is
also the first concrete consumer of the headless-core extraction (portability pillar) —
build them together to avoid a throwaway harness-only engine entry point.

Definition of "constantly testing ourselves" once built:
- **every merge** — golden master (exact count), property suite, overlay/adapter tests,
  bridge tests, scraper pytest: all green or no deploy;
- **every night** — bridge partition invariants fail-closed; canaries in cited bands;
  promoted-cell count + surface diff monitored; one Slack heartbeat line;
- **every month** — BLS verdict histogram; vintage + review-age tripwires;
- **every quote** — a provenance object that names its anchor, its bridge run, and its
  clamps, replayable down to source URLs.

---

## Open questions

1. **Deployed RTDB rules parity (S5):** does prod match `database.rules.json` (repo copy
   shows market-rates-v2 write:false, feedback write:true)? Needs a rules export.
2. **CF Pages gating:** is Zach willing to move the prod deploy behind GH Actions (or add
   `npm test` to the Pages build command)? Without one of these, R1 improves signal but
   still doesn't BLOCK a red deploy.
3. **rate_validator / rate_auditor scheduling:** do these agents run anywhere today
   (docker-compose/orchestrator/EC2 cron)? If yes, their outputs (`agent_proposals`,
   `rate_audit_log`) should feed the nightly Slack heartbeat instead of building new
   detectors; if no, decide revive-vs-retire before the band-registry unification.
4. **Retention:** how long are `bridge_runs` and `rate_intelligence` rows retained? The
   provenance replay guarantee is bounded by this.
5. **Test-count ground truth:** memory says 957 src/lib + 873 py green (2026-07-01/02);
   re-run both suites and record actual counts when Phase 0 lands.
6. **Golden-master 207 vs "208":** confirm with Zach that no 208th case was ever intended
   (commit `2c72c67` message says 208/208; artifact says 207 at that same commit) — then
   pin 207 and correct the folklore.
7. **Canary thresholds:** the ±25% compound-drift threshold and any per-cell alert band
   need Zach's sign-off as operating conventions (they are internal choices, not market
   facts — mislabeling them would violate the no-fabrication rule).
