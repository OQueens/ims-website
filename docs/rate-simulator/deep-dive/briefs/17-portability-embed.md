# Brief 17 — Portability: Own-ATS Embed + Hosted Rate API / npm SDK

> Deep-dive research brief, 2026-07-03. Pillar: PORTABILITY (embed + API). Companion to
> brief 15 (headless `@ims/rate-engine` core extraction) and brief 16 (Discord/Slack
> adapters) — this brief assumes brief 15's pure core as a prerequisite and designs the
> two delivery vehicles on top of it: (a) the engine embedded in a future in-house ATS,
> fully independent of the marketing site, and (b) a hosted rate API + npm SDK so any
> present or future surface calls ONE source of truth.
>
> Paths are relative to `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/`
> unless prefixed with a repo name. All rates/limits stated here are either READ from code
> (cited file:line) or cited to a named external source; anything else is flagged
> UNVERIFIED and listed in claims_to_verify.

---

## Summary

The live engine is closer to API-ready than its packaging suggests. It is already split
into a pure Phase-1 barrel (zero backend imports) and a Phase-2 barrel whose ONLY value
dependency on `firebase` is one import in `marketRates.ts` (`index.ts:39-45`,
`marketRates.ts:9`), behind an explicit DI seam (`runtime.ts:24-27`). Critically, the
Phase-1 engine **already executes server-side on the Cloudflare Workers runtime in
production**: the hub page is SSR (`src/pages/hub/index.astro:25` `prerender = false`) and
the first paint is a real engine quote computed on the server
(`SimulatorView.astro:38` `quoteFromControls(init)`). Deployability of the calc core to a
Workers-hosted API is therefore an observed fact, not a bet.

Three things block a hosted API today, and none of them is rate math:

1. **Global mutable state.** The market overlay mutates the `SPECIALTIES` module
   singleton in place (`marketRates.ts:469-551`; singleton contract documented at
   `sim-live.ts:12-17`), and `configureEngine` stores clients in module globals
   (`runtime.ts:21-27`). Correct for a single-user browser tab; wrong for a multi-tenant
   server where concurrent requests must each see one immutable snapshot vintage.
   Brief 15's pure-function overlay is the prerequisite.
2. **The market-read transport.** The hub reads RTDB via the Firebase web SDK over
   forced WebSockets (`hub-firebase.ts:44`) with a hub-only CSP widening
   (`src/middleware-logic.ts:59,99`). That transport does not carry to a Worker
   (firebase-admin does not run on Workers — community-documented, see F5), but RTDB has
   a documented REST surface (append `.json` to the database URL — Firebase docs), and
   `rate-simulator/*` is public-read by rule (`ias-dashboard/database.rules.json:26-47`,
   per map 06 §2.1), so a Worker can read the v2 posterior tree with plain `fetch` today
   and cache it in KV on a Cron Trigger.
3. **Auth.** The hub's HMAC-sealed first-party session cookie (`src/lib/hub/session.ts:1,69`)
   cannot authenticate a cross-origin ATS or a server-to-server SDK; the API needs
   per-client keys. The repo already contains the right primitive — constant-time secret
   comparison in a production endpoint (`src/pages/api/locumsmart-events.ts:78`).

The strongest argument for API-first is already visible in this repo's history: the
vendored-copy model has produced a **confirmed two-way divergence today** (map 02 §10 —
canonical has WS1 `aggregator_estimate` precedence the live copy lacks; the live copy has
the premium-erasure fix canonical lacks, and running the sync script would regress a live
production fix). Every additional embedded copy (ATS, Discord, Slack, clinician agent)
multiplies that failure mode linearly; a hosted API holds it constant at one.

---

## Findings (cited)

### F1 — The engine's package boundary already exists; it is just not published

- Phase-1 barrel `src/lib/rate-engine/index.ts` re-exports calc/parse/specialty/geo/call
  surfaces and is deliberately firebase-free: "Excluding it here keeps index.ts's import
  closure free of firebase, so the IMS hub builds Phase 1 with NO firebase install"
  (`index.ts:39-45`). Grep confirms exactly ONE value import of `firebase/database` in the
  whole engine (`marketRates.ts:9`); `runtime.ts:18-19` imports firebase/supabase types
  only.
- Phase-2 barrel `index.phase2.ts:10-17` adds the RTDB overlay + Supabase CRNA surface
  behind `configureEngine({db, supabase})`.
- The engine is 25,332 lines across 23 files, of which 18,955 lines are the
  `blsOewsBaseline.ts` data table serving a layer that is **dormant in the live hub**
  (map 01 §0, §9). An API bundle should exclude or lazy-load it — it is ~75% of the
  engine's code weight for zero live-quote contribution.

### F2 — The calc core is proven on the target runtime (workerd), in production, today

- `src/pages/hub/index.astro:25` (`export const prerender = false`) makes the hub SSR on
  Cloudflare Pages Functions; `SimulatorView.astro:38` computes the first-paint quote with
  `quoteFromControls(init)` — "SSR-computed by the real engine" (comment on that line).
- Adapter: `@astrojs/cloudflare` (`package.json:20`; `astro.config.mjs:13`), Node 22
  engine floor (`package.json:5-7`).
- Consequence: no runtime-compatibility research is needed for the pure quote path — the
  Phase-1 engine (curated bands, multipliers, parser, fuzzy) has been executing in workerd
  since the hub shipped. Only the Phase-2 RTDB read path needs a new transport (F5).

### F3 — The repo already runs production API endpoints on the same infra; a v0 API is a routes-folder away

- `src/pages/api/locumsmart-events.ts` is a live Astro `APIRoute` on CF Pages: env via
  `locals.runtime.env` with dev fallback (`:41-52`), constant-time bearer-secret check
  (`:78`), retry-aware status policy (5xx retried, 4xx dropped, `:14-17`).
- `zod` is already a devDependency (`package.json:38`) for input validation.
- So "hosted API v0" can ship inside this repo as `/api/v1/rates/*` routes with zero new
  infrastructure — same deploy pipeline (CF Pages push-to-main auto-deploy, per project
  memory), same env-var mechanism, same middleware. The trade-off (coupling to the
  marketing-site deploy cadence) is why v1 should graduate to a dedicated Worker (D6).

### F4 — Two engine idioms are server-hostile and must be refactored before multi-tenant hosting

- **Singleton mutation:** `applyMarketBucketsOverlay()` mutates `SPECIALTIES[key]` in
  place (`marketRates.ts:469-551`), and correctness depends on the bundler never
  duplicating `specialties.ts` (`sim-live.ts:12-17`: "Do NOT add a manualChunks rule …
  that would silently make this a no-op"). In a Worker, isolates persist across requests:
  a mutated global would bleed one snapshot vintage into later requests and make quote
  reproducibility (engine version + snapshot hash → same number) impossible to guarantee.
- **Global DI:** `configureEngine` stores `_db`/`_supabase` in module globals
  (`runtime.ts:21-27`). Fine for one browser tab; on a server the market snapshot must be
  an explicit argument, not ambient state.
- Both are exactly what brief 15's headless core removes: `quote(input, {table, snapshot})
  → {rate, band, confidence, provenance}` as a pure function. This brief treats that as a
  prerequisite and designs the API contract around it.

### F5 — The market-data refresh path: today browser-pull WebSockets; for the API, RTDB REST + KV + Cron Trigger

Today (map 03 §0): agent-sdk scraper → Supabase `rate_intelligence` → EC2 bridge cron
daily 04:00 UTC (`ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts:7-29`)
→ ONE atomic RTDB write to `rate-simulator/market-rates-v2` → the hub's browser client
reads it via the Firebase JS SDK with `forceWebSockets()` (`hub-firebase.ts:44`) under a
hub-only CSP widening (`middleware-logic.ts:59,99`).

For a Worker-hosted API:

- firebase-admin does not run on Cloudflare Workers — it relies on Node internals
  unavailable in the Workers runtime; the community norm is REST wrappers
  ([firebase-admin-node issue #2069](https://github.com/firebase/firebase-admin-node/issues/2069),
  [firebase-admin-rest](https://github.com/Moe03/firebase-admin-rest)). UNVERIFIED for
  the current `nodejs_compat` flag state — verify against
  [Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).
- But no SDK is needed: "any Firebase Realtime Database URL can be used as a REST
  endpoint. All you need to do is append .json"
  ([Firebase RTDB REST docs](https://firebase.google.com/docs/database/rest/start)). The
  read is one GET:
  `https://weekly-sync-451e2-default-rtdb.firebaseio.com/rate-simulator/market-rates-v2.json`
  (database URL READ from `hub-firebase.ts:21`; note the code comment `:13-14` — this
  project's RTDB resolves on `firebaseio.com`, not `firebasedatabase.app`).
- `rate-simulator/*` is public-read by rule (`ias-dashboard/database.rules.json:26-47`,
  map 06 §2.1), so the GET needs no credential today. (That public-read posture is itself
  flagged as adversarial risk S5 in map 03 — if it is ever tightened, the Worker switches
  to a Google OAuth2 access token or a database secret on the same REST call, per the
  same Firebase REST docs.)
- Freshness economics are mild: the bridge writes **once daily**; the reader gate already
  tolerates 7 days (`marketRates.ts:136` `RATE_READ_WINDOW_MS`). A Workers Cron Trigger
  refreshing a KV-cached snapshot every 15–60 min is over-provisioned by an order of
  magnitude. KV's eventual consistency (up to ~60s propagation —
  [Cloudflare KV docs](https://developers.cloudflare.com/kv/)) is irrelevant at a daily
  producer cadence. Pattern:
  [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) +
  [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) +
  KV, exactly the documented "periodically cache API responses" pattern
  ([worked example](https://dev.classmethod.jp/en/articles/cloudflare-workers-cron-kv-api-cache/)).
- **The reader gate stack must move server-side intact**: shape/enum/n>0 validation,
  7-day freshness, m6 rate-type strip, D-39 precedence, and the Move #1 anchor gates
  (market-typed ∧ n_distinct≥4 ∧ ≥2 normalized families) — `marketRates.ts:220-248,
  317-375, 469-551`. Centralizing these in the API is a security upgrade over today:
  the trust boundary stops being "whatever JS the client bundle shipped" and becomes one
  audited server path (directly mitigates map 03 seam S5).

### F6 — Auth: the hub's cookie session cannot serve an ATS or SDK; per-client keys can

- Hub auth = Google OAuth (`@iastaffing.com`) + HMAC-SHA256 sealed HttpOnly cookie
  (`session.ts:1` "HMAC-SHA256 sealed cookie value via Web Crypto (Cloudflare Workers +
  Node 22)"; cookie name `hub_session`, `session.ts:69`). First-party only — a
  cross-origin ATS frontend or a server-to-server SDK call cannot present it.
- Working precedent for machine auth in this repo: `constantTimeEquals(payload.key,
  env.LOCUMSMART_WEBHOOK_SECRET)` (`locumsmart-events.ts:78`).
- Sensitivity: the QUOTE is internal pricing intelligence (recruiters price real
  placements off it — north star). The raw v2 posterior tree is already public-read
  (S5), but the API adds the pieces that are actually proprietary: curated bands, gate
  logic, blended confidence, provenance. It must therefore be authenticated from day one
  — there is no anonymous tier.
- A hub RBAC design already exists and should be aligned with rather than duplicated:
  `docs/superpowers/specs/2026-06-18-hub-rbac-design.md` (status per memory: awaiting
  review).

### F7 — Vendored-copy drift is the anti-pattern the API eliminates — and it has already bitten

- Confirmed two-way divergence TODAY (map 02 §10, checked file-by-file 2026-07-02):
  canonical (`ias-dashboard` engine dir) has WS1 `aggregator_estimate: 0` in
  `BUCKET_PRECEDENCE` that the live vendored copy lacks; the live copy has the
  premium-erasure fix + family-normalization gate (commit `6d9edb1`) that canonical
  lacks. Running `scripts/sync-rate-engine.mjs` right now would `rm -rf` the vendored dir
  (`sync-rate-engine.mjs:38`) and **regress a live production fix**, and the parity gate
  would not catch it (golden master does not exercise the overlay —
  `rate-engine-parity.test.ts:10-14` scope note, map 06 §4).
- Generalization: with N embedded copies (hub + ATS + Discord + Slack + clinician agent),
  every engine fix must be synced N ways and each sync can silently regress another
  surface. With one hosted API, N surfaces are thin clients and the count of number-producing
  code paths stays 1. This is the core "why API-first future-proofs everything" argument,
  grounded in an observed failure rather than principle.

### F8 — A ready-made conformance contract exists: the 207-case golden master

- `src/lib/rate-engine/__tests__/goldenMaster.json` — `"version": 1`, `"count": 207`
  (map 06 §4; note docs sometimes say 208 — 207 is the on-disk number). The parity test
  (`src/lib/hub/rate-engine-parity.test.ts`) recomputes every case, floor-asserted ≥150.
- Repurposing: the API's CI replays the corpus through `POST /v1/quote` and asserts
  byte-equality with the engine's direct output. This converts the golden master from an
  intra-repo drift gate into a **cross-surface conformance suite** — any SDK/API version
  that changes a number fails CI before deploy. Gap to close: the corpus covers only the
  pure Phase-1 surface; add overlay cases (the 22-case
  `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts` is the seed) so snapshot-
  anchored quotes are also pinned.

### F9 — The telemetry tables the API should write already exist, unwired

- `quote_events` / `quote_outcomes` (Supabase migration
  `ias-dashboard/supabase/migrations/20260604000000_quote_regret_telemetry.sql:123-165`):
  append-only quote log + 6-value outcome enum (`won/lost/pushed_back/walked/adjusted/
  abandoned`), RLS default-deny service-role only (map 06 §1.5). Nothing writes them
  today.
- A hosted API is the natural single choke point to populate them: every quote logs
  (input tuple, engine version, snapshot hash, output) → the quote-vs-subsequently-paid
  accuracy KPI (brief 23's loop) and Move #4 feedback calibration get their denominator
  for free. Client-embedded copies fragment this: each surface would need its own
  telemetry plumbing and service-role credential, which is exactly what should never ship
  into an ATS frontend.

### F10 — ATS context: greenfield, previously deferred, so the embed can be API-first from day one

- The in-house ATS is a stated ambition, not a system: Phase 1.9 backlog "ATS
  integration" (`docs/plans/2026-05-06-ims-website-phase-1-plan.md:40`), and the design
  spec left "Bullhorn / JobDiva / none" explicitly undecided
  (`docs/specs/2026-05-05-ims-website-design.md:115`). No ATS code exists in the repos.
- Consequence: there is no legacy embed constraint. The ATS should be born as an API
  client, and the "embed the engine directly" mode (D7 mode iii) should exist only as an
  offline-degradation story, not the primary integration.

### F11 — A framework-free widget layer nearly exists already

- `src/lib/hub/sim-render.ts` builds the entire result panel as pure HTML strings
  (pills, waterfall, market bar, call-only card), shared byte-identically between SSR and
  client re-render (map 02 §2). No React/DOM dependency. Packaging `sim-render` +
  `sim-adapter` shapes as `@ims/rate-widgets` gives the ATS a drop-in visual component
  over the SDK with near-zero new UI code — while keeping the API as the number source.

### F12 — The API contract must exceed the hub's expressiveness, not copy it

- The hub's manual controls hardcode `facility: 'community'`, `call: false`,
  `holiday: false` (`sim-adapter.ts:139-148`) — CAH (+22%), rural trauma (+30%), call
  (+10%) are reachable only via PDF/freetext parse (map 01 seam 4; map 05 seam 10). This
  is a recognized coverage defect for recruiters pricing real placements.
- The engine itself accepts full `RateFactors` (`types.ts:187-202`) including facility,
  call, holiday, callOnly, dayType, rateCap. The API should therefore accept the FULL
  factor vocabulary (with safe defaults), making the ATS the first surface where a
  recruiter can express a CAH night-call assignment without pasting a PDF.

---

## Design

### D1 — API surface (v1)

Hosted at `api.imstaffing.ai` (dedicated Worker, D6). All endpoints authenticated (F6).
JSON in/out. Input validation with zod (already in devDeps, `package.json:38`).

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/quote` | POST | THE quote. Body = full factor vocabulary (specialty or alias, state, shift, facility, duration, call, holiday, callOnly, dayType, marginPct, rateCap). Server resolves aliases/fuzzy exactly like `simSpecialtyKeyForSlug`/`fuzzyMatchSpecialty` (`sim-adapter.ts:464-478`). |
| `/v1/parse` | POST | Freetext or PDF-extracted text → resolved factors + quote (wraps `buildParsedFromFreetext`/`parseLocumsmartAssignment` + `initFactors`). Returns `null`-style honest failure when no specialty resolves (`sim-adapter.ts:185-218` behavior). |
| `/v1/specialties` | GET | The 88-key catalog with labels, categories, band, confidence tier, provenance (`curated` vs `live`). ETag/If-None-Match cacheable. |
| `/v1/market/{specialty}` | GET | Context: the cell's v2 buckets (post reader-strip), coverage tier, snapshot vintage, anchor status + which gate failed if not promoted — the "explain this number" surface. |
| `/v1/feedback` | POST | Accepted-vs-quoted calibration entries → writes `quote_outcomes` (service-role, server-side only). Requires idempotency key. Replaces the world-writable RTDB `feedback` path (map 06 seam 4) with an authenticated, attributable channel. |
| `/v1/health` | GET | Engine version, snapshot vintage + age, bridge-staleness flag (surfaces map 03 seam S11's silent 7-day cliff as an operator signal). |

Response envelope (every number-bearing response):

```json
{
  "quote": { "payRate": 0, "billRate": 0, "band": {"min":0,"max":0,"p70":0},
             "confidence": "Medium", "confidenceReason": "…",
             "provenance": "curated|live",
             "waterfall": [], "percentiles": [],
             "flags": {"capped":false,"marketMaxApplied":false,"insufficientData":false} },
  "meta": { "apiVersion": "v1", "engineVersion": "x.y.z",
            "snapshot": {"vintage": "<bridge lastUpdated>", "hash": "<sha256 of snapshot>"},
            "goldenMasterVersion": 1 }
}
```

(Field set mirrors `SimQuote`, `sim-adapter.ts:222-252` — no new number semantics are
invented; the shape is the proven hub shape plus reproducibility metadata.)

The `meta.snapshot.hash` makes every quote replayable: (engine version, snapshot hash,
input) → deterministically the same output. That tuple is what `/v1/quote` logs to
`quote_events` (F9) and what the accuracy harness (brief 14) replays.

### D2 — Versioning: two independent axes, never conflated

1. **Contract version** (`/v1/` in the path): major = breaking. Within a major, changes
   are additive-only, following the industry-standard backward-compatible change list
   (new endpoints, new OPTIONAL request params, new response properties — Stripe's
   published definition: [Stripe API upgrades](https://docs.stripe.com/upgrades),
   [Stripe versioning](https://docs.stripe.com/api/versioning)). If per-client pinning is
   ever needed, adopt Stripe's date-pinned header model
   ([stripe.com/blog/api-versioning](https://stripe.com/blog/api-versioning)) — but do
   not build it for v1; with ~1 first-party consumer (the ATS) URL-major is sufficient.
2. **Data vintage** (`meta.snapshot.vintage` + `hash`): the market snapshot changes daily
   without any API version change. Numbers may legitimately move day-to-day; the contract
   does not. Every consumer that caches or screenshots a quote has the vintage stamped on
   it — this is the honesty analog of the hub's `provenance: 'live'` chip.

The golden master is the version gate (F8): a PR that changes any corpus output requires
either a major bump or an explicit, reviewed regeneration of the corpus (the same
discipline the engine repo uses today).

### D3 — Auth, scoping, rate limits

- **Per-client API keys**, stored as salted hashes in the Worker's KV/D1 (never
  plaintext), presented as `Authorization: Bearer ims_live_…`. Constant-time comparison
  (pattern proven at `locumsmart-events.ts:78`). Prefixed keys (`ims_live_` / `ims_test_`)
  for operator hygiene.
- **Scopes**: `quote:read`, `market:read`, `feedback:write`. The ATS backend gets all
  three; a Slack bot gets `quote:read` only; nothing gets a scope that exposes raw
  observations (the observation spine stays behind the bridge, as today).
- **Rate limiting**: per-key counters (KV or Durable Object) + Cloudflare WAF rules on
  the custom domain. Purpose is less about capacity (quotes are sub-ms pure compute) and
  more about anti-scraping: a competitor with a leaked key must not be able to bulk-dump
  the band table. Alert on anomalous per-key volume.
- **No browser-held keys.** Browser surfaces (ATS frontend widget) call their own backend
  which holds the key, or reuse the hub's session-gated same-origin routes. This mirrors
  the existing posture that no privileged credential ships to the client
  (`sim-live.ts:19-23`).

### D4 — Caching

- **Market snapshot** (the only IO the quote path has): KV entry
  `snapshot:v2:current` = the post-gate, post-validation parsed tree + computed anchor
  set, refreshed by a Cron Trigger (F5). Each refresh stores `{vintage, hash, tree}` and
  keeps the previous entry as `snapshot:v2:prev` for instant rollback. Worker requests
  read KV (edge-local, ~ms) — the RTDB is touched only by the cron path, so RTDB
  availability ceases to be a per-request dependency.
- **Quotes are NOT cached.** `calculateRate`/`calculateCallRate` are pure functions over
  (input, snapshot) — recomputing is cheaper and safer than cache invalidation. The
  response carries `Cache-Control: no-store` so intermediaries never serve a stale
  vintage.
- **Catalog endpoints** (`/v1/specialties`): strong ETag = hash(engineVersion +
  snapshotHash); clients revalidate with If-None-Match. This is what lets an SDK keep a
  local catalog without re-downloading.
- **Failure posture** (mirrors the hub's, `marketRates.ts:371-374` / `sim-live.ts:33-36`):
  cron fetch fails → keep serving the last-good KV snapshot until the reader's own 7-day
  gate expires it, then serve curated-only with `provenance:'curated'` and a
  `snapshotStale: true` flag in `meta`. Never fabricate, never 500 a quote because market
  data is late.

### D5 — Market-data refresh path: evolution without touching the producer

- **Phase A (ship first):** bridge unchanged (EC2 cron 04:00 UTC → RTDB). API Worker
  cron-pulls the RTDB REST snapshot into KV. Zero changes to the still-live pipeline;
  RTDB remains the single hand-off point; the hub keeps its current browser path.
- **Phase B (after the API is the primary consumer):** the bridge dual-writes the
  snapshot to the API's own store (KV via API ingest endpoint, or R2 object) alongside
  RTDB. The hub then migrates to the API (or to the same KV-backed same-origin route),
  the browser Firebase SDK + hub CSP widening (`middleware-logic.ts:59,99`) and the
  WebSocket-forcing workaround (`hub-firebase.ts:44`) become deletable, and RTDB's
  public-read exposure of the posterior tree (S5) can finally be closed.
- Invariant across both phases: **exactly one writer** (the bridge) and **one gate
  stack** (the reader gates, now server-side in the API). No consumer ever re-derives
  posteriors.

### D6 — Deployment

- **v0 (days):** `/api/v1/…` routes inside this repo (F3 pattern: `APIRoute`,
  `prerender=false`, env via `locals.runtime.env`). Proves the contract with the ATS
  prototype and the Slack/Discord bots. Cost: coupled to marketing-site deploys.
- **v1 (target):** dedicated Cloudflare Worker `ims-rate-api` on `api.imstaffing.ai`,
  own repo/package pipeline, importing `@ims/rate-engine` (brief 15's package) as a
  normal dependency. Independent deploy cadence, independent rollback, no marketing-site
  blast radius. Cron Trigger + KV bindings in its wrangler config
  ([Cron Triggers docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/)).
- **Bundle discipline:** exclude `blsOewsBaseline.ts` (18,955 lines, dormant layer — F1)
  from the API bundle unless/until the sanity layer is wired; Workers have per-script
  size limits (verify current figures against
  [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/) —
  UNVERIFIED here).
- **SDK (`@ims/rate-sdk`):** thin, isomorphic `fetch` wrapper — zero runtime deps, types
  generated from the same TS types the engine exports (`SimQuote`-shaped responses), so
  the ATS gets compile-time safety identical to the hub adapter's. Publish to a private
  npm scope or GitHub Packages (the org already uses GitHub — `OQueens/...` mirrors,
  `sync-rate-engine.mjs:3`). Optionally generate an OpenAPI 3 spec from the zod schemas
  so future non-TS consumers self-serve.

### D7 — The ATS embed: three modes, one recommended

| Mode | What | When |
|---|---|---|
| **(i) Server-to-server SDK** (RECOMMENDED) | ATS backend calls `@ims/rate-sdk` → hosted API. Key server-held. ATS UI renders from its own backend response. | Default for all ATS quote/pricing flows; the only mode that centralizes telemetry + snapshot vintage. |
| **(ii) Browser widget** | `@ims/rate-widgets` (packaged `sim-render` HTML builders, F11) mounted in the ATS UI, data via the ATS backend (mode i under the hood). | When the ATS wants the hub's exact visual quote panel without rebuilding it. |
| **(iii) Full offline embed** | `@ims/rate-engine` + a periodically synced snapshot file inside the ATS itself. | ONLY as a degraded/offline mode or for air-gapped demos. Every copy re-creates the F7 drift risk and fragments telemetry — do not make it the primary path. |

The decisive detail for mode (i): the ATS is where quote → placement outcome linkage
lives (assignment confirmed, actual pay agreed). Routing its quotes through the API means
`quote_events` rows can later be joined to outcomes (`quote_outcomes` enum already
models this — F9), which is the north-star accuracy KPI ("the rate we would actually
pay") measured continuously rather than estimated.

### D8 — Why API-first future-proofs every other surface (the argument, compressed)

1. **One number everywhere.** Same request at the same second returns the same payRate on
   hub, ATS, Slack, Discord — because there is one gate stack and one snapshot vintage.
   Today that guarantee does not even hold between the hub's Overview quick-check and the
   simulator (map 02 seam 5).
2. **Drift becomes structurally impossible** instead of process-managed: the confirmed
   two-way vendored divergence (F7) cannot recur between surfaces that don't own engine
   code.
3. **Fixes deploy once.** The premium-erasure class of bug (`6d9edb1`) gets fixed at the
   API and every surface is healed simultaneously — no N-way sync, no "which copy has the
   fix" audits.
4. **Central telemetry** turns every surface into a sensor for the accuracy loop (F9)
   instead of a fork of it.
5. **Security posture improves**: gates run server-side (S5 mitigated), credentials never
   ship to clients, per-key revocation exists.
6. **New surfaces get cheap.** Brief 16's Discord/Slack bots, the job-board chatbot
   backlog item, and the clinician agent all reduce to "parse intent → call `/v1/quote`
   → format reply."
7. The named cost (state the losing side): a network hop + an availability dependency
   where today's hub degrades gracefully offline. Mitigations: D4's last-good-snapshot
   posture, and mode (iii) as an explicit degraded fallback — but the default is the API.

---

## Recommendations

| # | Recommendation | Impact | Effort |
|---|---|---|---|
| R1 | Land brief 15's pure core first: overlay as a pure function `(staticTable, snapshot) → quotedTable`, snapshot passed as an argument (kills the `SPECIALTIES` singleton + `configureEngine` globals for server use). Prerequisite for everything below. | high | medium |
| R2 | Ship API v0 as `/api/v1/quote` + `/v1/specialties` routes in this repo using the `locumsmart-events.ts` pattern (env via `locals.runtime.env`, zod validation, constant-time key check). Golden-master conformance test in CI from day one. | high | low |
| R3 | Build the snapshot path: Cron-Triggered Worker job GETs the RTDB REST `.json` of `market-rates-v2`, runs the full reader gate stack server-side, stores `{vintage, hash, tree}` in KV with a `prev` rollback slot. | high | low |
| R4 | Stamp every response with `meta.{engineVersion, snapshot.vintage, snapshot.hash}` and log every quote to `quote_events` (tables exist, unwired — migration `20260604000000`). This is the reproducibility + accuracy-KPI foundation. | high | low |
| R5 | Graduate to a dedicated `ims-rate-api` Worker on `api.imstaffing.ai` with per-key auth (hashed keys, scopes, per-key rate limits) once the ATS prototype consumes v0. | high | medium |
| R6 | Publish `@ims/rate-sdk` (zero-dep fetch wrapper, engine-derived types) + optional `@ims/rate-widgets` (packaged `sim-render` builders) for the ATS UI. | medium | low |
| R7 | Make the API contract accept FULL `RateFactors` (facility/call/holiday/callOnly/dayType) — do not replicate the hub's hardcoded-neutral controls defect (`sim-adapter.ts:139-148`). | high | low |
| R8 | Extend the conformance corpus with overlay/anchored cases (seed: the 22-case `marketBucketsOverlay.test.ts`) so snapshot-anchored quotes are version-pinned, closing the F7/F8 gap the golden master leaves. | medium | low |
| R9 | Replace the world-writable RTDB `feedback` path with authenticated `POST /v1/feedback` → `quote_outcomes` before wiring Move #4 calibration to any live surface. | medium | low |
| R10 | Phase B only after the API is primary: bridge dual-write to the API store, migrate the hub off the browser Firebase SDK, then close RTDB public-read (S5) and delete the hub CSP widening + WebSocket workaround. | medium | medium |

Sequencing note: R1→R2→R3→R4 is the critical path; R5–R9 parallelize behind it; R10 is
deliberately last (never break the working hub path while the API earns trust).

---

## Open questions

1. **Workers runtime fit for the full engine bundle**: does the API bundle (engine minus
   `blsOewsBaseline.ts`) fit comfortably under current Workers script-size limits, and
   does anything in the parser (`pdfjs` is hub-client-side only — confirmed
   `hub-client.ts` does extraction in-browser per map 02 §4) leak into the server
   closure? Needs a real `wrangler deploy --dry-run` measurement.
2. **Where does PDF extraction live for the ATS?** The hub extracts PDF text in-browser
   (pdfjs) and sends text to the parser. For the ATS, either the same client-side
   extraction feeds `POST /v1/parse`, or the API grows a `multipart/form-data` PDF
   endpoint (server-side pdf.js in Workers is nontrivial). Recommend: keep extraction
   client-side, parse server-side.
3. **Key management operations**: who issues/rotates/revokes API keys, and where is the
   audit log? (Aligns with the pending hub RBAC spec,
   `docs/superpowers/specs/2026-06-18-hub-rbac-design.md`.)
4. **Does the RTDB public-read posture change before or after Phase B?** Closing it early
   breaks the current hub browser path; closing it late leaves the posterior tree
   world-readable. Sequencing decision for Zach.
5. **Snapshot semantics for call rates**: `CALL_RATE_DATA` is static (no live overlay
   path exists — map 05 seam 1). Should `/v1/quote` responses for call-only mark
   `provenance:'curated'` at the band level to make that asymmetry visible to ATS users?
   (Recommended: yes.)
6. **Multi-tenant future**: if the API is ever offered to external partners (agencies)
   rather than only internal surfaces, per-tenant snapshot isolation, pricing, and a
   formal SLA become requirements — out of scope here, but the key/scope model should not
   preclude it.
7. **207 vs 208**: docs/memories disagree on the golden-master count (on-disk says 207,
   map 06 §4). Re-pin before the corpus becomes the API conformance contract.

---

## Sources

External (all accessed 2026-07-03):
- Firebase RTDB REST: [firebase.google.com/docs/database/rest/start](https://firebase.google.com/docs/database/rest/start), [reference](https://firebase.google.com/docs/reference/rest/database), [retrieve-data](https://firebase.google.com/docs/database/rest/retrieve-data)
- firebase-admin on Workers: [firebase-admin-node#2069](https://github.com/firebase/firebase-admin-node/issues/2069), [firebase-admin-node#2377](https://github.com/firebase/firebase-admin-node/issues/2377), [firebase-admin-rest](https://github.com/Moe03/firebase-admin-rest), [Workers Node.js compat](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- Cloudflare: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [Workers KV](https://developers.cloudflare.com/kv/), [cron+KV cache pattern](https://dev.classmethod.jp/en/articles/cloudflare-workers-cron-kv-api-cache/)
- API versioning: [Stripe API versioning](https://docs.stripe.com/api/versioning), [Stripe upgrades](https://docs.stripe.com/upgrades), [Stripe blog: APIs as infrastructure](https://stripe.com/blog/api-versioning)

Internal maps: `docs/rate-simulator/deep-dive/maps/01-engine-core.md`, `02-hub-adapter-layer.md`, `03-market-posterior-bridge.md`, `05-comp-factors-today.md`, `06-data-model.md`.
