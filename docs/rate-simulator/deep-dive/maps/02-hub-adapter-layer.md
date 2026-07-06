# Map 02 — The LIVE Hub Adapter Layer (imstaffing.ai/hub Rate Simulator)

> **Scope**: how the live hub UI wires the vendored engine (`src/lib/rate-engine/`) to the RTDB overlay, and how controls become a quote. Repo: `ias-website` worktree `feat-ims-phase-1-plan`, branch `redesign/v5-reskin`, mapped 2026-07-02.
>
> **Topology (Zach-confirmed 2026-07-02)**: ONE live engine — the vendored copy inside `ias-website`, served at imstaffing.ai/hub. The `ias-dashboard` APP (`ias-hub-dashboard.web.app`) is DEAD; its `src/features/rate-simulator/` is a legacy/canonical-source directory, NOT a live surface. The bridge (`ias-dashboard/scripts/data-refresh/`) + scraper (`agent-sdk/agents/rate_scraper/`) ARE live — they write the RTDB the hub reads.

All paths below are relative to `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/` unless prefixed with a repo name.

---

## 1. Surface: route, guard, CSP

| Piece | Where | What |
|---|---|---|
| Page | `src/pages/hub/index.astro:148` | SSR page (`prerender = false`, line 25) renders 4 views; `<SimulatorView latestJobs={overview.latestJobs} />` is the simulator |
| Auth | `src/pages/hub/index.astro:33-38` + middleware hub guard | Google `@iastaffing.com` session cookie; sim is auth-gated |
| Client bundle | `src/pages/hub/index.astro:155-157` | one `<script>` imports `src/components/hub/hub-client.ts` |
| CSP (hub-only widening) | `src/middleware-logic.ts:59` (`HUB_RTDB_ORIGINS = "https://*.firebaseio.com wss://*.firebaseio.com"`), tested at `src/middleware.test.ts:315-335` | `connect-src` allows Firebase RTDB **only on /hub**; marketing CSP must NOT contain `firebaseio.com`. Wildcard needed because RTDB WebSockets redirect to regional hosts (`s-gke-*.firebaseio.com`) |
| WebSocket forcing | `src/lib/hub/hub-firebase.ts:44` (`forceWebSockets()`) | RTDB long-poll fallback injects `<script>` tags (governed by `script-src 'self'`, blocked) → without this the overlay silently no-ops (browser-verified 2026-06-26 per file comment) |

## 2. File inventory (the adapter layer, `src/lib/hub/`)

| File | Role |
|---|---|
| `sim-adapter.ts` | THE bridge UI⇄engine. Controls model, region→state mapping, factors builder, quote shaper (`quoteFromFactors`), bill-rate calculator math, specialty/shift/urgency option lists, job-slug→specialty resolver. **No rate math of its own** — quotes go through `calculateRate`/`calculateCallRate` |
| `sim-live.ts` | Phase-2 live-market wiring, client-only. The ONLY hub module importing `../rate-engine/index.phase2` (the barrel that value-imports `firebase/database`). Single-flight `initLiveMarket()` = `configureEngine({db}) + loadMarketBucketRates()` |
| `hub-firebase.ts` | Read-only RTDB client for project `weekly-sync-451e2`, `databaseURL: https://weekly-sync-451e2-default-rtdb.firebaseio.com` (`hub-firebase.ts:21`). Mirrors the dashboard's firebase config exactly (no-silent-fork guard: `hub-firebase.test.ts:13-15`) |
| `sim-render.ts` | Pure HTML-string builders for the result panel (pills, waterfall, market bar, cap notes, call-only card, bill calc). Shared by SSR first paint AND client re-render → byte-identical markup |
| `rate-engine.ts` | Façade: thin re-export of `sim-adapter`. `SimulatorView.astro` / `OverviewView.astro` / `hub-data.ts` import ONLY this — never the vendored engine directly (`rate-engine.ts:10-11`) |
| `hub-data.ts` | `aggregateHub(ims_jobs)` → Overview + "Latest 5 jobs"; maps job slugs onto real engine keys via `simSpecialtyKeyForSlug` (`hub-data.ts:98`) |
| `rate-engine-parity.test.ts` | ⭐ golden-master gate: every vendored-engine case must equal the canonical corpus (≥150 cases asserted at line 50) |
| `sim-live.test.ts`, `sim-adapter.test.ts`, `sim-confidence.test.ts`, `sim-render.test.ts`, `rate-engine-gate2-*.test.ts` | behavior locks for overlay anchoring, confidence honesty, render, and the phase-2 engine surface |

UI side: `src/components/hub/SimulatorView.astro` (SSR first paint + control markup), `src/components/hub/hub-client.ts:184-536` (the `simulator()` IIFE — all interaction wiring).

## 3. End-to-end data flow

```
PRODUCER (live pipeline, ias-dashboard repo + agent-sdk — NOT this repo)
  agent-sdk/agents/rate_scraper/*  (Scrapling fetch → jsonld/card extract → dedup)
        │ writes rows
        ▼
  Supabase rate_intelligence (7-day read window)
        │ daily 04:00 UTC EC2 cron (ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:7-13)
        ▼  aggregateBridge → aggregateCell (MAD+IVW posterior, family collapse-then-cap)
  Firebase RTDB weekly-sync-451e2
        rate-simulator/market-rates-v2   ← the v2 posterior tree (live anchor source)
        rate-simulator/market-rates      ← legacy min/max/p70 (RETIRED from hub init)
        rate-simulator/feedback          ← calibration entries (engine-supported, hub-UNWIRED)

CONSUMER (the LIVE hub, this repo)
  SSR: pages/hub/index.astro → SimulatorView.astro:37-38
       quoteFromControls(defaultControls())  ← STATIC curated SPECIALTIES (no overlay server-side)
        │ first paint = real engine numbers, curated band
        ▼
  Client: hub-client.ts simulator() (line 184)
        ├─ lazy import('../../lib/hub/sim-adapter')  (engine stays out of main bundle, line 190-192)
        └─ fire-and-forget import('../../lib/hub/sim-live') (line 529)
              → initLiveMarket()  (sim-live.ts:43)
                  configureEngine({ db: getHubFirebaseDb() })   (runtime.ts DI seam)
                  loadMarketBucketRates()                        (marketRates.ts:557)
                      loadMarketBuckets(): get('rate-simulator/market-rates-v2') (marketRates.ts:319)
                      applyMarketBucketsOverlay(): MUTATES the SPECIALTIES singleton in place
              → .then(() => update())  → re-quote; hero now reflects the live anchor (line 534)
```

**Singleton contract** (`sim-live.ts:12-17`): `sim-adapter` (via `../rate-engine/index`) and `sim-live` (via `../rate-engine/index.phase2`) must resolve to the ONE `specialties.ts` module instance, so the overlay's in-place mutation reaches the adapter's reads. Verified against the prod bundle 2026-06-26 (file comment); a `manualChunks`/alias split would silently no-op the overlay.

**Failure posture**: `loadMarketBuckets` swallows every fetch/parse error → `{specialties:{}, fellBackToLegacy:true}` (`marketRates.ts:371-374`); `initLiveMarket` never throws (`sim-live.ts:33-36`). Offline/slow RTDB ⇒ every cell stays on its audited curated band. No fabrication path.

## 4. Controls → factors mapping (`sim-adapter.ts`)

`SimControls` (`sim-adapter.ts:38-46`): `specialtyKey · region · stateCode · shift · urgency · weeks · marginPct`. Defaults (`:48-50`): anesthesiology, National, day, Standard, 12 wks, 22% margin.

| Control | Engine factor | Mechanism (file:line) |
|---|---|---|
| Specialty | `factors.specialty` + `baseRate = spec.p70` | `factorsFromControls` reads the (possibly live-overlaid) `SPECIALTIES` singleton at build time (`sim-adapter.ts:128,144`) |
| Region button | `factors.state.code` | Region → **representative state** = the real state whose `STATE_MULT` is nearest the region mean (`sim-adapter.ts:75-81`); National → `null` (no geo). Honest: never a fabricated regional multiplier |
| PDF/freetext state | `factors.state.code` (exact) | exact parsed state always beats the region approximation (`geoStateCode`, `sim-adapter.ts:96-99`) |
| Shift | `factors.shift.key` | 1:1 onto engine `SHIFT_MULT` keys: day/night/weekend_day/weekend_night/holiday (`sim-adapter.ts:445`) |
| Urgency + weeks | `factors.duration.key` | Emergent→`emergency`, Priority→`short`, else weeks≥26→`long`, ≤6→`short`, else `standard` (`durationKey`, `sim-adapter.ts:104-110`) |
| Margin | NOT an engine factor | bill = `roundUp5(pay/(1-m))` — engine invariant (`sim-adapter.ts:298-301`) |
| (fixed) | facility=`community`, rural=false, no call, no holiday, cap=null | neutral dashboard-manual-quote defaults (`sim-adapter.ts:138-148`) |

**Confidence honesty** (`sim-adapter.ts:256-278`): displayed confidence = the **weaker** of `scoreConfidence(factors)` (identification: specialty+geo) and the specialty's data tier (`spec.confidence`), with an honest one-liner naming the limiting factor. A National quote scores Medium max (`state.source:'default'`, `sim-adapter.ts:133-136`).

**Parse paths** (both null-safe, never fabricate): PDF → in-browser pdfjs text extraction (`hub-client.ts:447-467`) → `simParseAssignment` → `initFactors(parseLocumsmartAssignment(text))` (`sim-adapter.ts:185-199`); freetext → `simParseFreetext` → `buildParsedFromFreetext` (`:203-218`). A successful parse stores FULL engine factors in `pendingFactors` (`hub-client.ts:210,377`) so facility/call/holiday/call-only fidelity survives even though the coarse controls can't express them; any manual control change clears it (margin change keeps it).

## 5. Quote shaping (`quoteFromFactors`, `sim-adapter.ts:305-377`)

- **Hourly**: `calculateRate(factors)` → hero = `r.payRate` (clinician hourly pay); waterfall = running product base→geo→rural→shift→facility→duration→call→holiday (`hourlyWaterfall`, `:283-296`); band = `computeAdjustedSpecRange` (engine); `marketMaxApplied`/`capped` disclosures ride through to `sim-render.ts:79-89`.
- **Percentile chips are SYNTHETIC**: `percentiles = [25,50,70,75,90].map(p => adjustedMin + (adjustedMax-adjustedMin)*(p/100))` (`sim-adapter.ts:254,372`) — a **linear interpolation across the researched band**, not observed distribution quantiles. Directly relevant to the "where does this sit in the market distribution" north star (see Seams).
- **Call-only**: `calculateCallRate` → daily stipend ÷ coverage hrs; `insufficientData:true` renders the honest "quote manually" card, never $0 (`sim-render.ts:103-113`). Call-only bill uses the dashboard's FIXED 20% margin (`roundUp5(pay/0.80)`, `sim-adapter.ts:318-321`), NOT the hourly slider — deliberate parity.
- **Bill calculator**: markup ladder [20…40]%, REC band 25–32%, slider clamp 15–45% (`sim-adapter.ts:389-393`); every row recomputes `roundUp5(pay/(1-m))` fresh (never scales a pre-rounded bill — Codex C-2).

## 6. The live overlay: Move #1 trust ladder (`marketRates.ts`)

`initLiveMarket()` calls ONLY `loadMarketBucketRates()` — the crude legacy `loadMarketRates()` (raw min/max/p70, breakdown-point-zero extrema) is **RETIRED from init** but retained/tested (`marketRates.ts:399-404`, `sim-live.ts:38-42`).

Anchor gates in `applyMarketBucketsOverlay` (`marketRates.ts:469-551`) — a cell's quote anchor is promoted to the v2 posterior only when ALL hold:
1. D-39 primary bucket exists, coverage tier `primary`, rate_type ∈ `DEFAULT_ANCHORABLE_RATE_TYPES` = {`actual_paid_locum`, `advertised_clinician_pay`} (`:419-422`) — crowd_survey/scraped_article are priors-only, never anchor.
2. Renderable posterior: finite `weighted_mean > 0` (null = bimodal sentinel → skip), valid confidence tier, `n_distinct` positive integer, **fresh ≤ 7 days** (`isRenderableBucket`, `:220-230`; `RATE_READ_WINDOW_MS`, `:136`).
3. Corroboration: `n_distinct ≥ 4` AND ≥ 2 distinct, trimmed+lowercased source families (`:473-512`) — whitespace/case variants of one family can't fake two votes.

On promotion: `spec.p70 = round(weighted_mean)`; band from frozen `STATIC_SPECIALTY_RANGES` (`specialties.ts:219-225`), widened down to contain the anchor; ceiling: anchor ≥ curated max ⇒ geometric re-scale `max = round(anchor * (range.max/range.p70))` so shift/geo premiums keep headroom (the 2026-07-02 premium-erasure fix, `marketRates.ts:524-540`); `provenance='live'`; confidence ceiling by rate type — market-typed may read `high`, everything else caps at `medium` (`bucketConfidenceCeiling`, `:448-456`).

Reader safety in `loadMarketBuckets` (`:317-375`): m6 reader-strip (only `RENDERABLE_RATE_TYPES` survive — `agency_bill_rate` can never reach a consumer), D-39a national-first state ladder, honest `insufficient_data`/`unclassified_only` tiers, single pinned `now` per pass.

## 7. Deliberately NOT wired in the live hub

| Capability | Engine support | Hub status |
|---|---|---|
| Supabase CRNA cell envelope (BLS-anchored sanity floor) | `crnaCellLookup.ts` / `blsSanityCheck.ts`, exported via `index.phase2.ts:17` | NOT injected — `sim-live.ts:19-23` states the quote path consumes only the RTDB overlay; no Supabase creds reach the browser |
| Recruiter-feedback calibration | `loadSpecialtyCalibration` / `computeDisplayedRate` / `applyCalibration` (`marketRates.ts:784-995`, RTDB `rate-simulator/feedback`, 50%-dampened, clamp 0.85–1.15, min 3 entries) | ZERO hub callers (grep: only engine files + gate2 test reference these) — the observed-feedback loop is dormant on the live surface. This is Move #4 in the improvement program |
| Legacy market overlay | `loadMarketRates()` (`marketRates.ts:676-778`) | retired from init; still exported/tested |
| Rate-cap path (`rate-simulator/cap-rates`) | routed/skipped defensively (`marketRates.ts:698-705`) | no `loadCapRates()` exists yet |

## 8. Vendoring & parity mechanism

- Vendored engine = `src/lib/rate-engine/` (22 modules + goldenMaster.json), every file bannered `⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard … src/features/rate-simulator/engine/`.
- Sync: `scripts/sync-rate-engine.mjs` — wholesale copy from `../../../ias-dashboard/src/features/rate-simulator/engine` (or `RATE_ENGINE_SRC`), source-validated (≥10 .ts files) before destroying the dest, brings `goldenMaster.json` along (`sync-rate-engine.mjs:17-66`).
- Gate: `src/lib/hub/rate-engine-parity.test.ts` recomputes every golden-master case (hourly/call/parse/fuzzy/codec; ≥150 asserted) through the vendored copy. **Limitation**: it compares the vendored copy against the vendored corpus — both arrive in the same sync, so it catches hand-edits of the vendored dir, NOT canonical-side drift that was never synced (see §9-10).
- Phase-1 barrel (`rate-engine/index.ts:39-45`) keeps `firebase` out of the SSR/build closure; `index.phase2.ts` is the only firebase-value-importing surface, consumed solely by `sim-live.ts`.

## 9. The DEAD legacy copy — and the LIVE couplings into it

`ias-dashboard/src/features/rate-simulator/` (RateSimulatorPage.tsx, components/, engine/, lib/) is NOT a live surface — do not reconcile against its UI. **But the live data pipeline still imports the engine modules from that directory tree** (relative imports, dashboard repo):

| Live pipeline file | Imports from the dashboard engine dir |
|---|---|
| `ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:52,58,59` | `MarketBucketData` (type), `SPECIALTIES`, `firebaseSafeKey` |
| `ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts:25-27` | `MarketRateData`/`MarketBucketData` (types), **`aggregateCell`**, **`sourceFamily`, `isNeverAnchorSource`** |
| dev/audit scripts (`dump-state-mult.mjs:12`, `check-compound-drift.mjs:22-23`, `probe-state-mult-with-override.mjs:23`) | `STATE_MULT`, `calculateRate`/`calculateCallRate`, `SPECIALTIES`, COLI/demand tables |

So the dashboard engine dir plays TWO roles at once: (a) the **canonical source** the ias-website copy is vendored from, and (b) a **live library for the producer** (bridge). The dead part is only the React app around it. Portability takeaway: extracting ONE headless core means giving the bridge and the hub the SAME package — today they consume two differently-versioned snapshots of one directory.

## 10. CONFIRMED two-way divergence TODAY (checked file-by-file 2026-07-02)

`diff` of canonical (`ias-dashboard` @ `e8e8bd8c`, branch `feat/rate-engine-extract-2026-06-22`) vs the vendored live copy: **2 files differ — `marketRates.ts` and `sourceFamily.ts` — in BOTH directions**:

- **Canonical has, vendored lacks** (WS1, dormant by design): `aggregator_estimate: 0` in `BUCKET_PRECEDENCE` (canonical `marketRates.ts:128`) + WS1 family-registry entries (trackfive/locumjobsonline/tandym/communitybrands…) in `sourceFamily.ts`. Zero live-quote impact today (non-anchorable, and the vendored reader strips the unknown rate_type to an honest `insufficient_data` rung).
- **Vendored has, canonical LACKS** (the 2026-07-02 Zach-authorized fixes, commit `6d9edb1` here): the **premium-erasure fix** (geometric max re-scale, vendored `marketRates.ts:538-540`) and the **whitespace/case family-normalization gate** (vendored `:505-511`). Canonical still carries the bug: `spec.max = Math.max(range.max, anchor)` at canonical `marketRates.ts:523` — a hot anchor ≥ curated max collapses max onto p70 and flattens every shift/geo premium.
- **Consequence**: running `node scripts/sync-rate-engine.mjs` right now would **REGRESS the live premium-erasure fix** (the sync `rm -rf`s the vendored dir and copies canonical over it), and the parity gate would NOT catch it (the golden master doesn't exercise the overlay). The fixes must be back-ported to canonical before the next sync. This is the sharpest single risk in this layer.

## 11. Seams & smells

1. **Sync direction can destroy live fixes** (§10). The "canonical" repo is the dead app's repo; the live surface is the copy. Any fix landed vendored-first is one `sync-rate-engine.mjs` away from silent reversion. Mitigation: back-port `6d9edb1`'s marketRates changes to canonical, or add an overlay case to the golden master.
2. **Parity gate scope gap**: covers only the pure Phase-1 surface (its own comment, `rate-engine-parity.test.ts:10-14`); `applyMarketBucketsOverlay` — the function that now sets the live anchor — has unit tests (`src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts`, 22 cases) but no cross-repo parity contract.
3. **Synthetic percentiles**: the pXX chips and the "premium tier p90" marker are linear scale points of `[adjustedMin, adjustedMax]` (`sim-adapter.ts:372`, `sim-render.ts:50-76`), not observed quantiles — the v2 posterior carries only mean/variance/median, no distribution. For the north star (true market-percentile positioning) this is a modeling gap, not just cosmetics.
4. **Frozen `baseRate` on parsed assignments**: `pendingFactors` captures `baseRate = spec.p70` at parse time (`rateCalculator.ts:901`); if the RTDB overlay resolves AFTER a parse, subsequent re-quotes keep the pre-overlay base while `spec.min/max/confidence` read live (mixed vintage). Narrow window (overlay fires at module init, `hub-client.ts:529`) — but real on slow RTDB.
5. **Overview quick-check is a second, static quote path**: `hub-client.ts:107-123` inlines `min(p70×mult, max)` from SSR-baked `data-p70`/`data-max` attributes (`SimulatorView.astro:94`) — those attributes never see the live overlay, so Overview ballpark ≠ simulator hero for a promoted cell.
6. **Region = one representative state**: honest per-state engine value, but "West" is priced as the single state nearest the region's mean multiplier (`sim-adapter.ts:75-81`) — a recruiter pricing a specific CA job from the region button gets the representative state, not CA. (PDF/freetext state entry avoids this.)
7. **Firebase config duplicated by design** (`hub-firebase.ts` vs dashboard `src/config/firebase.ts`), pinned by a string-literal test (`hub-firebase.test.ts:13-15`) — a guard, but a manual one; a coordinated backend move must touch both repos.
8. **Freshness coupling**: reader window 7 days (`marketRates.ts:136`) vs bridge cadence daily 04:00 UTC EC2 cron (`bridge-rate-intelligence.ts:7-13`). >7 days of bridge failure silently reverts every promoted cell to curated (safe, but unmonitored from the hub side — no staleness telemetry surfaces in the UI).
9. **Feedback loop dormant** (§7): the only observed-outcome calibration mechanism the engine has is uncalled on the live surface, and RTDB `feedback` is empty per program memory — the sim currently learns nothing from closed placements.

## 12. Rates quoted in this doc (all READ from code)

- Anesthesiology curated band $300–$400/hr, CRNA $190–$250/hr (`specialties.ts:58-59`); 88 curated specialty entries counted in `_SPECIALTIES_RAW`; `p70 = round(min + (max-min)*0.70)` (`specialties.ts:179`).
- Header-cited curated sources: LocumStory 2025 (CHG), OnCall Solutions 2024, TheLocumGuy, ResidencyAdvisor 2025, FastRVU 2026 (`specialties.ts:4-5`) — publicly self-published, several CHG-correlated; a starting estimate, **not observed paid rates** (`specialties.ts:26-28`).
- Legacy call-daily classification floor $1,000 (`marketRates.ts:598`), justified in-code by "hourly tops out ~$400–425/hr per Locumstory 2025 / CompHealth public data" (`marketRates.ts:594-596`) — that justification itself is a curator claim, flagged for verification below.
