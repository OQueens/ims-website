# Brief 15 — Portability: the headless `@ims/rate-engine` core

> Deep-dive brief, 2026-07-03. Pillar: PORTABILITY. Design for extracting ONE framework-free,
> dependency-light rate-engine package out of the LIVE ias-website engine, so the current hub and
> every future surface (Discord, Slack, ATS, API) import the same core.
>
> Topology baseline (Zach-confirmed 2026-07-02): the LIVE simulator = imstaffing.ai/hub served by
> `ias-website` (`src/lib/rate-engine/` + `src/lib/hub/`). The ias-dashboard APP is dead; its
> `src/features/rate-simulator/` is a legacy copy — but the bridge
> (`ias-dashboard/scripts/data-refresh/`) and scraper (`agent-sdk/agents/rate_scraper/`) are the
> still-live producer pipeline. There is ONE live engine; this brief is future-proofing, not a
> two-copy reconciliation.
>
> All paths relative to `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/`
> unless prefixed with a repo name. Companion maps: `docs/rate-simulator/deep-dive/maps/01-engine-core.md`,
> `02-hub-adapter-layer.md`, `03-market-posterior-bridge.md`.

---

## Summary

The engine is already ~95% of the way to a headless package: across all 23 modules
(~25.3k lines), the ONLY non-relative value import is `import { ref, get } from
'firebase/database'` at `src/lib/rate-engine/marketRates.ts:9` (verified by grep over the whole
directory; `runtime.ts:18-19` imports firebase/supabase **types only**). No React, no DOM APIs, no
`process.env`, no `require()`. The DI seam (`runtime.ts` `configureEngine({db, supabase})`)
already exists, and the two barrels (`index.ts` pure Phase-1, `index.phase2.ts` firebase-touching
Phase-2) already partition the dependency graph.

What is NOT portable today, and what this design fixes:

1. **The quote API is incomplete at the package boundary.** The real public quote
   (`quoteFromFactors → SimQuote`, `src/lib/hub/sim-adapter.ts:305-377`) lives in the HOST layer,
   deep-imports two engine functions the barrel doesn't export (`sim-adapter.ts:28`), and holds
   the confidence-honesty blend (`weakerConfidence`/`confidenceReasonFor`,
   `sim-adapter.ts:263-278`). A Discord bot importing today's barrel would have to re-implement
   that blend or silently overclaim confidence (map 01, seam 10).
2. **The market overlay mechanism is a global mutable singleton** —
   `applyMarketBucketsOverlay` mutates the shared `SPECIALTIES` table in place
   (`marketRates.ts:469-551`), and correctness depends on the bundler never splitting
   `specialties.ts` into two module instances (`src/lib/hub/sim-live.ts:12-17`). That contract is
   un-exportable to arbitrary hosts.
3. **The overlay's backend handle is a hard firebase-web-SDK dependency**, but the hub's live read
   is a ONE-SHOT `get()` of a **public-read** path (`sim-live.ts:22-23`; reads at
   `marketRates.ts:319,678,804`). A 2-method `MarketSource` port (injected fetcher) removes the
   firebase package from the core entirely — and since RTDB supports plain HTTPS GET with `.json`
   (Firebase REST docs, verified 2026-07-03), every headless surface (Node bot, Cloudflare
   Worker) can implement the port with `fetch()` and zero credentials.
4. **The producer (bridge) consumes the same logic from a different snapshot.** The still-live
   bridge imports `SPECIALTIES`, `firebaseSafeKey`, `aggregateCell`, `sourceFamily`,
   `isNeverAnchorSource` from the DEAD app's engine directory
   (`ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:52-59`,
   `lib/aggregateBridge.ts:25-27`). Until the bridge is repointed at the package, the dead copy
   cannot be deleted (map 03, S1), and confirmed two-way drift already exists (map 02, §10:
   canonical has WS1 `aggregator_estimate`; the vendored live copy has the 2026-07-02
   premium-erasure + family-gate fixes `6d9edb1` that canonical LACKS — running
   `scripts/sync-rate-engine.mjs` today would regress live fixes).

The plan: promote the vendored live copy to canonical, move it into a workspace package
`packages/rate-engine/` inside ias-website with a `createRateEngine(config)` instance API and a
`quote(input) → QuoteResult {rate, band, confidence, provenance}` façade, swap the firebase
import for the injected `MarketSource` port, repoint the bridge at the package (source-vendor or
private npm), then delete `ias-dashboard/src/features/rate-simulator/` and retire the sync
script. Each step keeps the live hub green behind the existing gates: golden-master parity
(≥150 cases asserted, `src/lib/hub/rate-engine-parity.test.ts:50`), the 22-case overlay suite
(`src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts`), and the gate-2 suites in
`src/lib/hub/`.

---

## Findings (cited)

### F1 — Dependency audit: one value import stands between the engine and zero-dependency

- Grep over `src/lib/rate-engine/*.ts` for non-relative imports returns exactly three lines:
  `marketRates.ts:9` (`import { ref, get } from 'firebase/database'` — VALUE),
  `runtime.ts:18` (`import type { Database } from 'firebase/database'` — type-only, erased),
  `runtime.ts:19` (`import type { SupabaseClient } from '@supabase/supabase-js'` — type-only).
  No `process.env`, no `require(` anywhere in the directory (verified by grep, 2026-07-03).
- The Supabase-backed CRNA envelope never imports the client package as a value either — it calls
  the injected handle (`crnaCellLookup.ts:185` `await getSupabase()`), so `@supabase/supabase-js`
  is compile-time-only for the core.
- The firebase handle is used at exactly 3 call sites, all the same shape
  `get(ref(getDb(), '<path>'))`: `marketRates.ts:319` (`rate-simulator/market-rates-v2`),
  `:678` (`rate-simulator/market-rates`, retired legacy), `:804` (`rate-simulator/feedback`,
  dormant Move #4). This is a textbook port seam: replace with
  `await config.market.read(path)`.
- One browser-global leak: the feedback-calibration backup reads `localStorage`
  (`marketRates.ts:653-655`), already guarded by `typeof localStorage === 'undefined'` — headless
  runtimes work today, but the port design should make the backup store injectable
  (`FeedbackStore` port) rather than ambient.
- `cellAggregation.ts` and `sourceFamily.ts` — the two modules the PRODUCER also needs — have
  **zero imports at all** (grep `^import ... from` returns nothing): fully pure, trivially
  shareable.

**Confidence: OBSERVED (grep + file reads this session).**

### F2 — The de-facto public API lives in the host, not the engine, and leaks through the barrel

- `src/lib/hub/sim-adapter.ts:28` imports `scoreConfidence` and `computeAdjustedSpecRange`
  directly from `../rate-engine/rateCalculator`, bypassing `index.ts` — the Phase-1 barrel
  (`src/lib/rate-engine/index.ts:16`) does not export them. Any packaged version with an
  `exports` map would break this import unless the package either exports them or (better)
  absorbs the code that needs them.
- The confidence-honesty logic every surface MUST replicate to avoid overclaiming — displayed
  confidence = the WEAKER of identification confidence and data-tier confidence, plus the honest
  limiting-factor sentence — is host code: `CONF_RANK`/`weakerConfidence`
  (`sim-adapter.ts:263-270`), `dataTierConfidence` (`:265-267`), `confidenceReasonFor`
  (`:272-278`). Map 01 seam 10 flags exactly this: "Any new consumer (Discord/Slack/API port)
  must re-implement the blend or silently overclaim."
- The same is true of: hourly waterfall shaping (`sim-adapter.ts:283-296`), the synthetic
  percentile chips (`:372` — linear interpolation over `[adjustedMin, adjustedMax]`, NOT observed
  quantiles), the bill invariants (`bill()` `:298-301`, `billLadder`/`billAtMargin`
  `:398-413` — all `roundUp5(pay/(1-m))`), region→representative-state geography
  (`representativeState`, `:75-81`), and the call-only ÷`coverageHrs` hero conversion
  (`:315-316`). All of it is pure math/shaping with no DOM dependency — it belongs in the core
  `quote()` façade so Discord/Slack/ATS/API surfaces get byte-identical numbers AND
  byte-identical honesty semantics.
- What is genuinely host-only and must stay out: `sim-render.ts` (HTML strings), `hub-client.ts`
  / `SimulatorView.astro` (UI), `hub-firebase.ts` (client construction + `forceWebSockets()` CSP
  workaround, `hub-firebase.ts:44` per map 02 §1), and the in-browser pdfjs text extraction
  (`hub-client.ts:447-467` per map 02 §4) — the core should accept extracted TEXT
  (`parseLocumsmartAssignment(text)`), never a PDF binary.

**Confidence: OBSERVED.**

### F3 — The singleton overlay contract is the #1 portability hazard

- `applyMarketBucketsOverlay` mutates `SPECIALTIES[key]` in place (`marketRates.ts:522-546`) and
  `sim-adapter` reads the same singleton at quote time (`sim-adapter.ts:128,144`,
  `quoteFromFactors` `:306`). The load-bearing invariant is documented at `sim-live.ts:12-17`:
  Vite/Rollup must dedup `specialties.ts` into ONE module instance; "Do NOT add a manualChunks
  rule, resolve.alias, or optimizeDeps entry that could split specialties.ts into two instances —
  that would silently make this a no-op."
- For a package consumed by N surfaces this contract is untenable: two bundlers, one Node
  process hosting two bots, or a test harness importing both barrels can each silently break it.
  A long-lived Node bot process also inherits a staleness bug the browser never sees: the browser
  re-runs the overlay every page load, but a Discord bot that mutates the module-global table once
  at boot would serve a >7-day-stale anchor forever (the reader's freshness gate,
  `RATE_READ_WINDOW_MS` `marketRates.ts:136`, runs at READ time, not at quote time).
- Fix in the core design: instance-scoped state. `createRateEngine()` deep-copies the static
  table (the frozen snapshot machinery already exists — `STATIC_CONFIDENCE`
  `specialties.ts:195` and deep-frozen `STATIC_SPECIALTY_RANGES` `specialties.ts:219` were built
  precisely so overlays can't corrupt the baseline); `refreshMarket()` applies the overlay to
  THE INSTANCE's table and records `lastRefresh`, and `quote()` can surface
  `marketStatus().stale` when the last successful refresh exceeds the read window. The hub keeps
  one module-level instance → identical behavior, contract gone.

**Confidence: OBSERVED (code) + design.**

### F4 — The market overlay's transport is over-specified: a one-shot GET of a public path

- The live wiring is a single-flight, once-per-session `get()` — `initLiveMarket()`
  (`sim-live.ts:43-50`) → `loadMarketBucketRates()` → `loadMarketBuckets()` one read of
  `rate-simulator/market-rates-v2` (`marketRates.ts:319`). No subscription, no realtime.
- The path is public-read by design: "RTDB `rate-simulator/*` is public-read, so no credentials
  reach the browser" (`sim-live.ts:22-23`). [The deployed rules themselves are UNVERIFIED this
  session — needs the rules export; also flagged as map 03 S5.]
- Firebase RTDB supports plain HTTPS `GET` on any path with a `.json` suffix, no SDK, and
  unauthenticated when rules allow public read (Firebase docs, "Retrieving Data" REST guide,
  fetched 2026-07-03). So a portable `MarketSource` for ANY fetch-capable runtime is:
  `fetch('https://weekly-sync-451e2-default-rtdb.firebaseio.com/rate-simulator/market-rates-v2.json')`
  (database URL from `src/lib/hub/hub-firebase.ts:21`).
- Consequence for the CURRENT hub, not just future surfaces: the entire firebase npm package
  (`firebase@^12.15.0`, ias-website `package.json`) exists in this repo ONLY for this chain —
  grep shows `firebase/` imports only in `hub-firebase.ts`, `marketRates.ts:9`, `runtime.ts:18`
  (type), and one test. A REST-based MarketSource would (a) delete the dependency, (b) delete the
  `forceWebSockets()` CSP workaround and let the hub CSP shrink from
  `https://*.firebaseio.com wss://*.firebaseio.com` (needed because RTDB WebSockets redirect to
  regional `s-gke-*.firebaseio.com` hosts, `src/middleware-logic.ts:59` per map 02 §1) to a
  single https origin, and (c) make the hub itself the first consumer of the portable port.
- For a future API surface on the existing Cloudflare Pages deployment, Workers bundle limits are
  3 MB gzip (free) / 10 MB gzip (paid) (Cloudflare Workers platform limits docs, fetched
  2026-07-03). Engine source totals ~800 KB with the two big data artifacts —
  `blsOewsBaseline.ts` 476 KB and `__tests__/goldenMaster.json` 330 KB (test-only); everything
  else sums to ~210 KB (file sizes listed this session). Even worst-case the core fits Workers
  easily, but the BLS table should still be a subpath export so bot/edge bundles that never call
  the sanity check don't carry 476 KB (see layout, F7).

**Confidence: OBSERVED (code, docs fetches); RTDB rules = UNVERIFIED.**

### F5 — The producer half pins the deletion order: bridge first, then the dead app

- Live-verified imports from the dead app's engine dir:
  `bridge-rate-intelligence.ts:52` (`type MarketBucketData` — deliberately type-only so the
  bridge pulls no firebase runtime dep from marketRates, per its own comment `:50-51`),
  `:58` (`SPECIALTIES` — the `knownSpecialties` row-admission gate), `:59` (`firebaseSafeKey`);
  `lib/aggregateBridge.ts:25-27` (`type MarketRateData/MarketBucketData`, **`aggregateCell`**,
  **`sourceFamily`, `isNeverAnchorSource`**). Plus dev/audit scripts (`dump-state-mult.mjs:12`,
  `check-compound-drift.mjs:22-23`, `probe-state-mult-with-override.mjs:23`) and the
  golden-master generator (`scripts/rate-engine/gen-golden-master.ts:18-19`).
- Everything the bridge needs is in the PURE subset (F1): `specialties.ts`, `firebaseKeyCodec.ts`,
  `cellAggregation.ts`, `sourceFamily.ts`, plus types from `marketRates.ts`. The bridge runs
  under Node via tsx-style direct-TS execution (imports carry `.ts` extensions,
  `bridge-rate-intelligence.ts:49-59`; dashboard `package.json` scripts use `tsx`), so it can
  consume the package either as installed JS or as vendored TS source with zero build step.
- This also fixes two accuracy-adjacent seams for free: S4 (bridge admits rows per the
  DASHBOARD's `SPECIALTIES` key set while the hub anchors per the WEBSITE's — no test pins them
  equal; one package = one key set) and S3 (the rate-type precedence ladder exists in 3 copies —
  bridge `RATE_TYPE_PRECEDENCE` `bridge-rate-intelligence.ts:77-90`, dashboard
  `BUCKET_PRECEDENCE`, website `BUCKET_PRECEDENCE` `marketRates.ts:119-124` — and has already
  diverged once, map 03 S2/S3).

**Confidence: OBSERVED.**

### F6 — The migration safety net already exists, and the current sync direction is a live hazard

- Gates that must stay green: `src/lib/hub/rate-engine-parity.test.ts` (recomputes every
  golden-master case through the engine; `expect(corpus.length).toBeGreaterThanOrEqual(150)` at
  `:50`; corpus = `src/lib/rate-engine/__tests__/goldenMaster.json`, 330 KB), the 22-case
  `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts`, the `rate-engine-gate2-*` suites
  in `src/lib/hub/`, and `sim-adapter/sim-live/sim-confidence/sim-render` behavior locks.
  (Project memory records 957 src/lib tests green as of 2026-07-02 — re-run to confirm before
  starting.)
- The vendor pipeline that must be RETIRED, carefully: `scripts/sync-rate-engine.mjs` `rm -rf`s
  `src/lib/rate-engine/` and copies from
  `../../../ias-dashboard/src/features/rate-simulator/engine` (`sync-rate-engine.mjs:17-20,38`).
  Because canonical currently LACKS the 2026-07-02 vendored-side fixes (`6d9edb1`: premium-erasure
  geometric max re-scale `marketRates.ts:538-540` + family-normalization gate `:505-511` — map 02
  §10 diffed both directions), running the sync today would silently regress live behavior, and
  the parity gate would not catch it (the golden master doesn't exercise the overlay). Extraction
  step 0 is therefore: **declare the vendored live copy canonical** (it is a superset of the fixes)
  after back-porting the two canonical-only WS1 bits (`aggregator_estimate: 0` precedence entry +
  WS1 `sourceFamily` registry entries, both dormant by design), then freeze/delete the sync script.
- The engine even names its own package aspiration: "public API barrel for @ias/rate-engine"
  (`src/lib/rate-engine/index.ts:3`).

**Confidence: OBSERVED (this repo) / map-cited (canonical-side diff).**

### F7 — Surface requirements: what Discord/Slack/ATS/API actually need from the core

Derived from the live quote path (map 01 §1-§8) — each surface needs, at minimum:

| Need | Where it exists today | Portable? |
|---|---|---|
| quote from structured input (specialty/state/shift/duration/facility/call/holiday/margin) | `factorsFromControls`+`quoteFromFactors` (`sim-adapter.ts:127-150,305-377`) | pure — move to core |
| quote from freetext ("CRNA nights in Houston, TX") | `simParseFreetext` (`sim-adapter.ts:203-218`) → `buildParsedFromFreetext`/`initFactors` (engine) | pure — move wrapper to core |
| quote from assignment-PDF TEXT | `simParseAssignment` (`sim-adapter.ts:185-199`); pdf→text stays host-side (pdfjs) | pure given text |
| call-only path + honest `insufficientData` (no fabrication) | `calculateCallRate` + `SimQuote.callOnly` (`sim-adapter.ts:312-351`) | pure |
| market band + marker + percentiles (labeled synthetic) | `computeAdjustedSpecRange` + `WF_PERCENTILES` map (`sim-adapter.ts:254,355,372`) | pure; MUST carry a method label so bots can't present linear-interp chips as observed percentiles (north-star honesty; map 01 seam 2) |
| confidence blend + limiting-factor sentence | host-side today (F2) | move to core |
| provenance (`curated` vs `live`) | `spec.provenance` (`specialties.ts:36`; set at `marketRates.ts:542`) | already core |
| live overlay refresh with trust-ladder gates | `loadMarketBucketRates(opts)` (`marketRates.ts:557-560`), gates `:469-551`, options `BucketOverlayOptions` `:424-437` | port the transport (F4), keep gates verbatim |
| bill/margin math (roundUp5 invariants, ladder, custom-bill reverse calc) | `sim-adapter.ts:298-301,389-421` | pure — move to core |
| specialty/shift/region option lists (so a Slack modal and the hub render the same choices) | `simSpecialtyOptions`/`simShiftOptions`/`simRegionOptions` (`sim-adapter.ts:83-92,436-460`) | pure — move to core |

Runtime constraints: Node ≥18 surfaces (Discord.js / Slack Bolt) get global `fetch` for the REST
MarketSource; a Cloudflare Workers API route (the natural first API surface — this site already
deploys on CF Pages, `@astrojs/cloudflare` in `package.json`) cannot sensibly run the firebase
web SDK but runs `fetch` natively; bundle budget is a non-issue at core size vs the 3/10 MB gzip
limits (F4).

**Confidence: OBSERVED (code) + cited docs; Discord/Slack runtime claims are general knowledge —
flagged in claims_to_verify.**

---

## The design

### D1 — Package boundary and module layout

New home: `packages/rate-engine/` inside **ias-website** (the live, tested repo), wired as an npm
workspace. Name it `@ims/rate-engine` (the site is IMS; `index.ts:3`'s old `@ias/` label predates
the brand flip — pick one and stop).

```
packages/rate-engine/
  package.json            # name @ims/rate-engine, "type":"module", "sideEffects": false,
                          # ZERO runtime dependencies; exports map below
  src/
    types.ts              # RateFactors, CalculatedRate, ... (verbatim from today's types.ts)
    calc/
      rateCalculator.ts   # verbatim (incl. scoreConfidence, computeAdjustedSpecRange — now EXPORTED)
      multipliers.ts
      callRates.ts
      stateData.ts
    data/
      specialties.ts      # static table + frozen snapshots + aliases
    parse/
      parser.ts
      fuzzyMatch.ts
    market/
      marketRates.ts      # reader + trust-ladder overlay, REWIRED to ports (D3);
                          # BUCKET_PRECEDENCE / RENDERABLE_RATE_TYPES live here — ONE copy
      cellAggregation.ts  # shared with the producer (pure)
      crnaAggregation.ts
      sourceFamily.ts     # shared with the producer (pure)
      keyCodec.ts         # rename of firebaseKeyCodec.ts (pure string codec; name was misleading)
    ports/
      marketSource.ts     # interface MarketSource { read(path): Promise<unknown> }  (D3)
      feedbackStore.ts    # interface FeedbackStore { load(): entries[]; append(e): void }  (dormant Move #4 seam)
      clock.ts            # () => number  — freshness gate testability (today: Date.now pinned per pass)
    quote/
      engine.ts           # createRateEngine(config) → RateEngine  (D2) — absorbs sim-adapter's
                          # quoteFromFactors, factorsFromControls, confidence blend, waterfall,
                          # percentiles(+method label), bill math, option lists, region mapping
    bls/
      blsOewsBaseline.ts  # 476 KB data table — subpath-only, never imported by src/index.ts
      blsSanityCheck.ts
    locumsmart/
      liveCalibration.ts  # observed-caps profiles (dormant)
      recentJobsBridge.ts
    crna/
      crnaCellLookup.ts   # Supabase envelope (dormant in hub) — supabase handle stays injected
    index.ts              # THE barrel: quote API + pure calc/parse/data (no bls, no crna)
    market.ts             # overlay barrel (loadMarketBuckets/applyMarketBucketsOverlay/refresh)
  adapters/               # in-repo reference adapters, NOT part of the core dependency graph
    market-rest.ts        # MarketSource over fetch() + RTDB .json REST (zero deps)
    market-firebase.ts    # MarketSource over an injected firebase web/admin Database handle
  test/
    goldenMaster.json     # moves here — the corpus travels WITH the canonical package
    parity.test.ts        # today's rate-engine-parity.test.ts, repointed
    overlay.test.ts       # today's 22-case marketBucketsOverlay.test.ts
    gate2-*.test.ts       # today's src/lib/hub/rate-engine-gate2-* suites (engine-level ones)
```

`package.json` exports map (keeps heavy data out of default consumers, enables tree-shaking):

```json
{
  "exports": {
    ".":        "./src/index.ts",
    "./market": "./src/market.ts",
    "./bls":    "./src/bls/blsSanityCheck.ts",
    "./crna":   "./src/crna/crnaCellLookup.ts",
    "./locumsmart": "./src/locumsmart/liveCalibration.ts",
    "./adapters/*": "./adapters/*.ts"
  }
}
```

(Ship TS source first — both consumers compile TS today: Vite/Astro in the hub, tsx on the
bridge. Add a `tsc` build + `dist/` dual export later only if a consumer appears that can't eat
TS. Verify Astro/Vite handles a linked-workspace TS package without extra config — Open question
O2.)

The Phase-1/Phase-2 barrel split (`index.ts` vs `index.phase2.ts`) **dissolves**: its entire
reason to exist is keeping the `firebase/database` value import out of the Phase-1 closure
(`index.ts:39-45`). Once `marketRates.ts` consumes the `MarketSource` port, there is no firebase
import anywhere, and `./market` is just a lazy-loadable feature barrel, not a dependency
firewall.

What deliberately stays OUT of the package: `sim-render.ts` (HTML), `hub-client.ts` /
`SimulatorView.astro` (UI), `hub-firebase.ts` (client construction; it becomes ~10 lines feeding
`adapters/market-firebase.ts` — or is deleted outright under the REST swap), pdfjs and all
PDF-binary handling, Astro/CSP/middleware concerns.

### D2 — Public API

```ts
// packages/rate-engine/src/quote/engine.ts
export interface RateEngineConfig {
  market?: MarketSource;              // absent → curated-only engine (still fully functional)
  overlay?: BucketOverlayOptions;     // minDistinct / minFamilies / anchorableRateTypes — EXISTS today (marketRates.ts:424-437)
  feedback?: FeedbackStore;           // dormant Move #4 seam; default: none
  now?: () => number;                 // freshness clock; default Date.now
}

export function createRateEngine(config?: RateEngineConfig): RateEngine;

export interface RateEngine {
  /** THE quote. Sync — all market state was applied at the last refreshMarket(). */
  quote(input: QuoteInput): QuoteResult;

  /** Parse helpers (text in, never binaries). Null = honest "couldn't read it". */
  parseFreetext(text: string): ParsedInput | null;       // wraps buildParsedFromFreetext + initFactors
  parseAssignmentText(text: string): ParsedInput | null; // wraps parseLocumsmartAssignment + initFactors

  /** One-shot market refresh via the injected MarketSource; single-flight; never throws
   *  (same failure posture as today: any error → zero mutations, curated keeps serving). */
  refreshMarket(): Promise<OverlayReport>;   // { promoted: number; fellBack: boolean; at: number }

  /** Honest operational state for consumers that must disclose staleness. */
  marketStatus(): { lastRefresh: number | null; promoted: number; stale: boolean };

  /** Option lists so every surface renders the same choices (Slack modal = hub dropdown). */
  specialties(): SpecialtyOption[];   // today's simSpecialtyOptions
  shifts(): Option[];
  regions(): RegionOption[];          // region → representative state, honest mult

  /** Bill math (engine invariants: roundUp5(pay/(1-m))). */
  billLadder(payRate: number): BillLadderRow[];
  billAtMargin(payRate: number, marginPct: number): BillMarginResult;
}

export type QuoteInput =
  | { kind: 'controls'; specialty: string; state?: string | null; region?: string;
      shift?: string; urgency?: string; weeks?: number; marginPct?: number }
  | { kind: 'factors';  factors: RateFactors; marginPct?: number }   // full-fidelity (parsed) path
  | { kind: 'freetext'; text: string; marginPct?: number };

export interface QuoteResult {
  rate: {
    unit: 'hour' | 'day';
    pay: number | null;               // null ⇔ flags.insufficientData (call-only, no band) — never 0-as-a-quote
    bill: number | null;
    marginPct: number;
  };
  band: { min: number; max: number; marker: number };   // today's marketMin/Max/Marker
  percentiles: Array<{ p: number; value: number }>;
  percentileMethod: 'linear_band_interpolation';        // HONEST method label — until Moves #2/#3
                                                        // land a real distribution, no consumer may
                                                        // present these as observed quantiles
  confidence: {
    level: 'High' | 'Medium' | 'Low';                   // blended (weaker-of) — moved INTO the core
    dataTier: 'high' | 'medium' | 'low' | 'modeled';
    reason: string;                                     // limiting-factor sentence
  };
  provenance: {
    band: 'curated' | 'live';                           // today's spec.provenance
    anchor?: { rateType: string; nDistinct: number; families: number; asOf: number }; // when live
  };
  flags: { capped: boolean; marketMaxApplied: boolean; insufficientData: boolean };
  waterfall: WaterfallStep[];
  callOnly?: { dayType: string; dailyPay: number; compModel: CallCompModel;
               coverageHrs: number; sources: number; note?: string };
}
```

Semantics are a REPACKAGING of `SimQuote` (`sim-adapter.ts:222-252`) — same numbers, same
honesty gates — with three deliberate upgrades: (1) the confidence blend moves inside so no
surface can skip it; (2) `percentileMethod` makes the synthetic-percentile caveat machine-readable
(north star: percentile positioning is a headline feature — until it's real, the API must label
it); (3) `provenance.anchor` surfaces WHAT anchored a live band (rate type, n, families, age) so
a bot/API response can print the same trust story the hub pills do.

### D3 — Config injection for the market overlay

Replace the global `configureEngine({db})` + `get(ref(getDb(), path))` with a 1-method port:

```ts
// ports/marketSource.ts
export type MarketPath = 'market-rates-v2' | 'market-rates' | 'feedback';
export interface MarketSource {
  /** Return the parsed JSON value at rate-simulator/<path>, or null. Throwing is allowed;
   *  the reader treats any throw as fellBackToLegacy (zero mutations). */
  read(path: MarketPath): Promise<unknown>;
}
```

Mechanical diff in `marketRates.ts`: 3 call sites (`:319,:678,:804`) become
`await source.read('market-rates-v2')` etc.; every downstream gate (`isRenderableBucket`,
7-day freshness, m6 reader-strip, D-39 precedence, anchor gates) is untouched — they already
treat the fetched tree as untrusted input (map 03 §5.1), which is exactly the right posture for
an injected transport.

Reference adapters (in-repo, ~10 lines each):

- `adapters/market-rest.ts` — `fetch(`${baseUrl}/rate-simulator/${path}.json`)`. Works in
  browsers, Node ≥18, Cloudflare Workers, Bun; zero credentials because `rate-simulator/*` is
  public-read (`sim-live.ts:22-23`; RTDB REST GET verified against Firebase docs 2026-07-03).
  This should become the HUB's adapter too: it deletes the firebase npm dependency (grep: no
  other consumer in the repo, F4), the `forceWebSockets()` workaround, and shrinks the hub CSP
  from the `*.firebaseio.com` + `wss:` wildcards (`src/middleware-logic.ts:59`) to one https
  origin. Note the CSP/test pair must move together (`src/middleware.test.ts:315-335` pins the
  current values).
- `adapters/market-firebase.ts` — wraps an injected web-SDK or firebase-admin `Database` handle
  for hosts that already have one (transitional; the bridge's writer keeps firebase-admin
  regardless — writing is the producer's job, not the core's).

`crnaCellLookup` keeps its injected Supabase handle (type-only import, F1) behind the `/crna`
subpath; it is dormant in the hub (`sim-live.ts:19-23`) and never blocks the core. Keep a
deprecated `configureEngine()` shim for one release that constructs a default engine instance —
so the migration commit doesn't have to touch every test at once.

### D4 — Migration path (each step independently green; hub live throughout)

- **Step 0 — settle canonicality (blocks everything).** Back-port the two dormant WS1
  canonical-only bits into the vendored copy (`aggregator_estimate: 0` in `BUCKET_PRECEDENCE` +
  WS1 `sourceFamily` registry entries — map 02 §10 / map 03 S2), regenerate nothing (golden
  master unaffected — these are overlay/reader concerns), and declare
  `ias-website/src/lib/rate-engine/` canonical. Delete or `exit 1`-tombstone
  `scripts/sync-rate-engine.mjs` so nobody can run the now-backwards sync. Gate: parity ≥150 +
  overlay 22 + full `src/lib` suite green.
- **Step 1 — in-repo package move (no behavior change).** Add `"workspaces": ["packages/*"]` to
  the root `package.json`; move the 23 modules into the D1 layout; leave
  `src/lib/rate-engine/index.ts` + `index.phase2.ts` as thin re-export shims of
  `@ims/rate-engine` (grep this session found ~35 hub import sites incl. tests — the shim means
  zero call-site churn in this step). Strip the `⚠ VENDORED — DO NOT EDIT` banners (they now lie).
  Gate: same suites, byte-identical golden-master results.
- **Step 2 — port seam.** `MarketSource` swap in `marketRates.ts` (D3); `sim-live.ts` builds
  `market-firebase` from `getHubFirebaseDb()` — behavior byte-identical, singleton still intact.
  Gate: `sim-live.test.ts` + gate2-buckets/market suites.
- **Step 3 — instance-scoping.** `createRateEngine()` clones the static table; `sim-adapter`
  and `sim-live` share one module-level instance (`export const engine = createRateEngine(...)`
  in a single hub module — the singleton becomes an EXPLICIT export instead of a bundler
  accident). Extend the 22-case overlay suite with a two-instance isolation case. This is the
  only step with real refactor risk — do it as its own PR, gate on the full 957-test suite plus
  a manual hub smoke (EM/psychiatry/radiology heroes unchanged vs prod).
- **Step 4 — hub goes REST (optional but recommended).** Swap `market-firebase` →
  `market-rest`; delete `hub-firebase.ts`, drop `firebase` from `package.json`, shrink hub CSP +
  its middleware tests together. Gate: browser-verify the overlay actually applies on the live
  hub (same verification style as the 2026-06-26 singleton check, map 02 §3).
- **Step 5 — producer repoint (the step that frees the dead app).** Two delivery options for
  the bridge (Node/tsx, F5):
  (a) **source-vendor INTO ias-dashboard** — copy `packages/rate-engine/src/{data/specialties.ts,
  market/{cellAggregation,sourceFamily,keyCodec}.ts, types}` to
  `ias-dashboard/scripts/data-refresh/vendor/rate-engine/` with a NEW sync script whose arrow
  points website→dashboard, plus the golden-master gate on the dashboard side (the generator
  `scripts/rate-engine/gen-golden-master.ts` repoints at the vendor dir). Low infra, matches
  existing practice, keeps tsx zero-build.
  (b) **private npm (GitHub Packages)** — `npm i @ims/rate-engine` in ias-dashboard; cleaner but
  adds registry auth to the EC2 box and a publish step to every engine change.
  Either way the bridge diff is import-path-only; `aggregateCell`/`sourceFamily` semantics are
  pinned by D-33/D-37 tests on both sides. EC2 rollout (git pull + npm i) is Zach-only.
  Recommend (a) now, (b) when a third consumer repo appears.
- **Step 6 — delete the dead twin.** Remove `ias-dashboard/src/features/rate-simulator/`
  (app + engine) and the dashboard's engine test mirrors; repoint the dev/audit scripts
  (`dump-state-mult.mjs` etc.) at the vendor dir. The dashboard repo shrinks to
  "bridge + scraper support" — which is what it actually is now.
- **Step 7 — first new surface as the proof.** `src/pages/api/rate-quote.ts` (Astro endpoint,
  CF Workers runtime): `createRateEngine({ market: restMarketSource(...) })`, per-isolate memoized
  `refreshMarket()` with a TTL ≤ the 7-day read window (Workers isolates are ephemeral; refresh
  cost is one JSON GET). Auth/rate-limiting per the hub-RBAC direction (separate spec). Discord/
  Slack bots then EITHER call this API (thin clients, one number source — recommended for
  anti-drift) or import the package directly if they need offline/latency independence.

### D5 — What extraction does NOT fix (scope honesty)

Portability packaging changes no math. The synthetic percentiles (`sim-adapter.ts:372`), the
uncited static multipliers (map 01 seam 5), call-only coverage gaps (19/88 specialties with quotable
daily bands, map 01 §6), and the hourly-only live pipeline (map 05 §3.1) all ride into the
package as-is — the API just labels them honestly (`percentileMethod`, `provenance`,
`insufficientData`). Those are Moves #2/#3/#4 and the accuracy pillar's briefs, not this one.

---

## Recommendations

1. **[impact: HIGH, effort: LOW] Step 0 now, independent of everything else:** back-port the WS1
   deltas, declare the live vendored copy canonical, tombstone `scripts/sync-rate-engine.mjs`.
   The current sync direction can silently revert the `6d9edb1` premium-erasure fix on the live
   surface (map 02 §10) — this is a standing landmine whether or not the package ever ships.
2. **[impact: HIGH, effort: MEDIUM] Extract `packages/rate-engine/` (Steps 1-2)** with the
   `MarketSource` port and the re-export shims. Zero behavior change, kills the
   barrel-bypass leak (`sim-adapter.ts:28`), and makes the engine consumable by any TS host.
3. **[impact: HIGH, effort: MEDIUM] Absorb the quote façade + confidence blend into the core
   (`quote()` per D2).** This is the single biggest anti-drift move for future surfaces: today
   every new consumer must re-implement `weakerConfidence`/`confidenceReasonFor`/percentile
   shaping or overclaim (F2). Ship `percentileMethod` and `provenance.anchor` in the result
   shape from day one.
4. **[impact: MEDIUM, effort: MEDIUM] Instance-scope the specialties table (Step 3)** to retire
   the bundler-dedup singleton contract (`sim-live.ts:12-17`) and the long-lived-process
   staleness hazard (F3). Own PR, full-suite gate, manual hub smoke.
5. **[impact: MEDIUM, effort: LOW] Swap the hub to the REST MarketSource (Step 4):** deletes the
   `firebase` npm dependency from ias-website (used nowhere else — grep, F4), deletes
   `forceWebSockets()`, and shrinks the hub CSP wildcard surface. Behavior-equivalent because the
   live read is a one-shot `get()` (F4). Requires the RTDB public-read rules confirmation first
   (Open question O1).
6. **[impact: HIGH, effort: MEDIUM] Repoint the bridge at the package via inverted source-vendor
   (Step 5a),** then delete `ias-dashboard/src/features/rate-simulator/` (Step 6). This closes
   S1/S3/S4 (map 03): one `SPECIALTIES` key set, one precedence ladder, one `aggregateCell` — and
   makes "specialty added ⇒ both producer and consumer see it" a package-version guarantee, which
   is a direct north-star (coverage) win. EC2 rollout is Zach-gated.
7. **[impact: MEDIUM, effort: MEDIUM] Ship `/api/rate-quote` on the existing CF Pages deploy as
   the first headless consumer (Step 7),** and route Discord/Slack through it rather than
   embedding the engine in each bot — one refresh cadence, one number source, no per-bot drift.
   Engine size vs Workers limits is a non-issue (≈210 KB core, 3/10 MB gzip budget, F4).
8. **[impact: LOW, effort: LOW] Hygiene riders during Step 1:** rename `firebaseKeyCodec.ts` →
   `keyCodec.ts`; settle `@ims/` vs `@ias/` naming; move `goldenMaster.json` into the package's
   test dir so the corpus travels with the canonical source; add `"sideEffects": false` for
   tree-shaking; keep `/bls` (476 KB) and `/crna` as subpath exports out of the default entry.

Sequencing note: 1 → 2 → 3 → (4 ∥ 5) → 6 → 7 → 8-as-rider. Steps 2-5 each leave the hub
deployable; nothing here requires a deploy freeze.

---

## Open questions

- **O1 — RTDB rules export.** Confirm `rate-simulator/*` is public-READ and bridge-only-WRITE in
  the deployed `weekly-sync-451e2` rules. Load-bearing for the REST adapter (read) and for map 03
  S5 (a forged `n_distinct:9, source_families:['a','b']` node would pass the anchor gate — the
  trust boundary is the write rules). The dashboard repo has a rules test harness
  (`test:rules` script, dashboard `package.json`) — extend it rather than eyeballing.
- **O2 — Astro/Vite × workspace TS package.** Verify Astro 5 compiles a linked workspace package
  shipped as TS source (expected: yes via Vite, possibly needing `vite.ssr.noExternal` for the
  SSR pass). Spike before committing to no-build delivery; fallback is a trivial `tsc` build.
- **O3 — Bridge delivery choice.** Source-vendor (5a) vs GitHub Packages (5b): does Zach want a
  registry credential on the EC2 box? 5a recommended until a third consumer repo exists.
- **O4 — Where does `refreshMarket()` cadence live for serverless surfaces?** Workers isolates
  are ephemeral; per-request refresh is one JSON GET (fine), but a shared KV/DO cache would cut
  p50 latency. Decide when the API surface is specced — the port makes either trivial.
- **O5 — Feedback write path (Move #4) port shape.** This brief defines `FeedbackStore` read-side
  only (matching today's dormant `loadSpecialtyCalibration`, `marketRates.ts:784-830` incl. the
  guarded `localStorage` merge). The write/instrumentation design belongs to the Move #4 brief —
  but the port should land WITH the extraction so Move #4 doesn't re-open the package boundary.
- **O6 — Does the ATS target need push (webhooks) rather than pull (quote API)?** If an ATS
  integration wants rate-change notifications, that's a producer-side concern (bridge emits
  events), not a core-engine concern — keep it out of the package either way.
- **O7 — goldenMaster regeneration ownership.** After Step 6 the dashboard's
  `gen-golden-master.ts` has no engine to point at; the generator must move into
  `packages/rate-engine/` in the same PR that deletes the dead twin, or the corpus can never be
  regenerated.

---

## Cited-figure ledger (every number in this brief)

| Figure | Source | Class |
|---|---|---|
| 23 engine modules, ~25.3k lines; blsOewsBaseline 18,955 lines | map 01 §0 + file listing this session | OBSERVED |
| File sizes: blsOewsBaseline.ts 476 KB; goldenMaster.json 330 KB; core-minus-BLS ≈210 KB | `ls` this session (KB, listed in F4) | OBSERVED |
| 1 firebase value import (`marketRates.ts:9`); 3 `getDb()` read sites (`:319,:678,:804`); type-only supabase (`runtime.ts:18-19`) | grep this session | OBSERVED |
| Parity gate ≥150 cases | `src/lib/hub/rate-engine-parity.test.ts:50` | OBSERVED |
| 22-case overlay suite | `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts` (map 02 §11) | OBSERVED |
| ~35 hub import sites of `../rate-engine/` | grep this session (`src/lib/hub/*`) | OBSERVED |
| Anchor gates: n_distinct ≥4, ≥2 families, market-typed only; 7-day read window | `marketRates.ts:419-437,473-512,136` | OBSERVED |
| CF Workers script size: 3 MB gzip free / 10 MB gzip paid (64 MB uncompressed) | developers.cloudflare.com/workers/platform/limits/ (fetched 2026-07-03) | EXTERNAL — verify |
| RTDB REST: HTTPS GET + `.json`, unauthenticated when rules allow | firebase.google.com/docs/database/rest/retrieve-data (fetched 2026-07-03) | EXTERNAL — verify |
| RTDB `rate-simulator/*` public-read | `sim-live.ts:22-23` code comment | UNVERIFIED — needs rules export (O1) |
| Bridge cadence daily 04:00 UTC EC2 (54.145.175.182) | `bridge-rate-intelligence.ts:7-13` header | UNVERIFIED live (code comment) |
| 957 src/lib tests green | project memory 2026-07-02 | UNVERIFIED this session — re-run |
| 19/88 specialties with quotable call bands | map 01 §6 | OBSERVED (map-cited) |

No dollar figures are asserted in this brief; rate examples were deliberately omitted (see maps
01/05 for the cited band values).
