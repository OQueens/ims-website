# Map 03 — The Market-Intelligence Bridge & the market-rates-v2 Posterior (Accuracy Core)

> Deep-dive map, 2026-07-02. Covers: how a raw scraped rate row becomes the quote anchor on
> imstaffing.ai/hub. Producer (agent-sdk scraper) → Supabase `rate_intelligence` →
> `canonical_rate_intelligence` view → bridge (`bridge-rate-intelligence.ts` + `lib/aggregateBridge.ts`)
> → Firebase RTDB `rate-simulator/market-rates-v2` → live hub reader (`marketRates.ts`
> `loadMarketBuckets` + Move #1 trust-ladder overlay) → `SPECIALTIES` mutation → quote.
>
> **Topology (Zach-confirmed 2026-07-02):** the LIVE consumer is the ias-website repo
> (`src/lib/rate-engine`, `src/lib/hub`). The ias-dashboard *app* is dead, BUT the bridge
> (`ias-dashboard/scripts/data-refresh`) and scraper (`agent-sdk`) are the STILL-LIVE data
> pipeline, and the bridge's shared modules physically live inside the dead app's engine
> directory (`ias-dashboard/src/features/rate-simulator/engine/`). See Seams §S1/S2.

All paths below are absolute-repo-relative to `C:/Users/oclou/QueenClaude/`.

---

## 0. One-screen data flow

```
agent-sdk scraper fleet (rate_scraper / rate_researcher, Python)
  │  per row at INSERT: rate_type classifier + content_hash + dedup_group_id + state attribution
  ▼
Supabase (prod gbakzhibzotugfyktcrt)  table: rate_intelligence
  │  VIEW canonical_rate_intelligence  (agent_id allowlist + canonical-specialty salvage)
  ▼
EC2 cron 04:00 UTC daily (54.145.175.182, bridge-cron-wrapper.sh)      [UNVERIFIED live — code comment]
  bridge-rate-intelligence.ts :: runBridge()
  │  STEP 1-3  stale-run cleanup · pg advisory lock 0x7261746573 · bridge_runs open row
  │  STEP 4    SELECT 7-day window (RATE_READ_WINDOW_DAYS=7), ORDER BY date_scraped, id
  │  STEP 5    aggregateBridge(rows, knownSpecialties)          ← THE ACCURACY CORE (pure)
  │              gates → dedup-collapse ×2 → non-locum legacy filter → bucket split
  │              → family collapse-then-cap → aggregateCell (MAD + IVW posterior)
  │  STEP 6    ONE atomic firebase update():
  │              rate-simulator/market-rates/{spec}        (legacy band, D-40 back-compat; null-clears suppressed)
  │              rate-simulator/cap-rates/{spec}           (bill/ceiling axis — no live reader today)
  │              rate-simulator/market-rates-v2/{spec}     (whole-node replace: __meta__ + {state}/buckets/{rate_type})
  │              rate-simulator/source-reliability/{family} (display-only bootstrap score)
  │  STEP 7    bridge_runs close (Phase-2 + Phase-3 telemetry counters, 3 partition invariants)
  ▼
Firebase RTDB weekly-sync-451e2   (rate-simulator/* is public-READ per hub design)
  ▼
LIVE HUB (imstaffing.ai/hub, ias-website repo)
  src/components/hub/hub-client.ts → src/lib/hub/sim-live.ts :: initLiveMarket()
  → src/lib/rate-engine/marketRates.ts :: loadMarketBucketRates()
      loadMarketBuckets()            reader gates: shape · confidence enum · n_distinct>0 · 7-day freshness · m6 strip
      applyMarketBucketsOverlay()    MOVE #1 ANCHOR GATE: market-typed rate_type ∧ n_distinct≥4 ∧ ≥2 families
  → mutates SPECIALTIES[key] in place (p70=anchor, band from frozen curated range, provenance='live')
  → sim-adapter / rateCalculator quote path prices off the mutated band
```

Everything left on the floor at each stage is **surfaced, never silent**: quarantined /
invalidRows / unknownSpecialties → `bridge_runs.errors_json`; excluded-non-locum and
suppressed-specialty counts → console + output counters.

---

## 1. Producer half (agent-sdk, Python) — the dedup keys are computed at INSERT, never in TS

The bridge **never recomputes hashes** (aggregateBridge.ts:219-232 — a TS re-implementation
would byte-diverge on URL edge cases and silently bifurcate collapse keys). It only groups on
the stored strings. The producer contracts:

| Artifact | File | Contract |
|---|---|---|
| `content_hash` | `agent-sdk/shared/content_hash.py:74-87` | SHA-256 hex over `canonicalise_url(url)` (lowercase scheme+netloc, sort query params, drop `utm_*`, drop fragment, path case preserved; :37-71). `None` for empty URL. **Hash of the URL only, not the page body.** |
| `dedup_group_id` | `agent-sdk/shared/dedup_group_id.py:43-85` | First 16 hex of SHA-256 over `canonical_url \| value_bucket \| state_key \| date_key`. `value_bucket = int(r//10)*10` on each bound; `date_key = (published_at or scrape_date).isoformat()`. Encodes **state but NOT rate_type**, and folds in **date**. |
| `rate_type` | `agent-sdk/shared/rate_type_classifier.py:1-60` | Hybrid D-16: per-source fixed default → URL-pattern override for fan-out sources (serpapi/tavily/exa) → `bls_oews*` prefix short-circuits to `permanent_wage_proxy` → conservative fallback `scraped_article_estimate`. 7-value enum since WS1 added `aggregator_estimate` (2026-07-01). |
| Canonical view | `ias-dashboard/supabase/migrations/20260521203841_evidence_canonicalization_a2.sql:709-716` | `canonical_rate_intelligence` = rows with `date_scraped >= '2026-05-20' AND agent_id IN ('rate_scraper','rate_researcher')` OR (canonical specialty AND `agent_id != 'unknown_legacy'`). `security_invoker = true` (RLS load-bearing). **This is why BLS/gov rows never reach the bridge** — `gov_data_syncer`/`unknown_legacy` are excluded upstream (aggregateBridge.ts:680-690: 0 BLS rows in view vs 483 in base table, live-verified 2026-06-29). |

WS1 seam (dormant, 2026-07-01): the scraper's aggregator dedup carries
`recovered_source_family` so a hidden-pay aggregator posting is re-attributed to the real
agency family; rows insert as `aggregator_estimate`. **Blocked on Zach applying migration
`20260701000000` to prod** (else the CHECK constraint 23514s the whole batch) — per project
memory, not yet applied.

---

## 2. Bridge entrypoint — `ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts`

Ops posture (header, :7-29): daily 04:00 UTC EC2 cron via `bridge-cron-wrapper.sh`; single
`pg.Client` session because **Postgres advisory locks are session-scoped** (:31-39). Exit
codes: 0 success, 2 caught crash, 3 lock-held skip.

| Mechanism | Where | Behavior |
|---|---|---|
| Advisory lock | :94-97, :272-289 | `pg_try_advisory_lock(0x7261746573)` ('rates'). Fail → skip-row insert + exit 3 (no Slack alert). |
| Stale-run cleanup | :239-249 | `bridge_runs status='running' AND started_at < NOW()-1h` → flipped to error (crashed prior runs). |
| Read window | :99-101, :306-314 | `RATE_READ_WINDOW_DAYS = 7` — deliberately matches the reader's 7-day staleness gate ("the bridge can't write rows older than the reader would accept"). Ordered `date_scraped ASC, id ASC` so dedup encounter-order is deterministic. |
| Numeric coercion | :632-644 | pg NUMERIC arrives as string; `coerceCell` collapses null/NaN/±Inf → null at the IO boundary. |
| Overall timeout | :103-139, :1473-1482 | `BRIDGE_TIMEOUT_MS = 10min` — firebase-admin retries a bad WebSocket forever; without the ceiling cron firings queue on the advisory lock. |
| Crash telemetry | :150-174, :550-604, :1340-1363 | Unified `errors_json.crash.stage` discriminator across main()-fallback + runBridge rows. |
| Phase-3 column probe | :651-705 | `phase3ColumnsExist()` probes `information_schema.columns` before the close UPDATE names the 18 Phase-3 counters; degrades to the Phase-2 shape rather than flipping a data-shipped run to 'error' (D-42 false-positive trap). |

### RATE_TYPE_PRECEDENCE (producer side) — :77-90

```
actual_paid_locum: 4  >  advertised_clinician_pay: 3  >  crowd_survey: 2
  >  scraped_article_estimate: 1  >  aggregator_estimate: 0
```

Exclusion-by-ABSENCE is the load-bearing idiom: `permanent_wage_proxy` (W2 salary proxy,
context-only), `agency_bill_rate` (D-12 — a bill/ceiling figure, opposite trust class), and
`null_unclassified` (bottom rung) are **deliberately absent from the map** so
`pickPrimaryRateType` (:925-936) can never select them. Three independent copies of this
ladder exist — see Seams §S3.

---

## 3. The accuracy core — `ias-dashboard/scripts/data-refresh/lib/aggregateBridge.ts` (pure, no IO)

### 3.1 Row-admission gates (in order, per raw row) — `aggregateBridge()` :788-850

1. **Quarantine** (:790-798): a cap-capable agent (`CAP_CAPABLE_AGENT_IDS = {'sisense_rate_writer'}`, :215-217) emitting `value_type='market'` = silent default mislabel → `quarantined[]`, never aggregated.
2. **NEVER-ANCHOR exclusion** (:810-813): `isNeverAnchorSource(row.source)` — ZipRecruiter/Adzuna modeled/W2-blended job-board numbers dropped BEFORE grouping (the CRNA spike: ZipRecruiter $124.86/hr ≈ half the real locum $200-250 — figure is a code-cited production observation, sourceFamily.ts:105-107; flag for re-verification). Exclusion-by-absence: never a DistinctObservation, never a family vote, never in the ≥2-family quorum. Surfaced to `invalidRows` as `never_anchor_source_excluded`.
3. **Validity guard** (:816-831): `rate_low`/`rate_high` present, `rate_low > 0`, `rate_high > rate_low`; typed reject reasons.
4. **Unknown specialty** (:834-840): not in `knownSpecialties` (= `Object.keys(SPECIALTIES)` from the **dashboard's** specialties.ts, bridge-rate-intelligence.ts:58,:1477) → dropped, surfaced.
5. **Group** by `${specialty}|${value_type}` (:843-849).

### 3.2 Two-stage dedup-collapse — `dedupCollapseCell()` :286-379

- **Stage 1 (exact-artifact, content_hash):** key = `content_hash + (state, rate_type, value_bucket)` where value_bucket mirrors the producer's `int(r//10)*10` rounding on the STORED numerics (:315-318). Same URL + same value across **different dates** collapse to the latest (cadence-inflation kill); genuinely distinct claims from one page ($180-240 vs $260-320) stay distinct. `dedup_group_id` is excluded from this key because it folds in date. Latest-wins tie-break = `recencyKey` (:239-247): `date_scraped`, falling back to `published_at` only when date_scraped doesn't parse (NOT max of the two). NULL content_hash rows pass through untouched.
- **Stage 2 (near-dup, dedup_group_id):** key = `dgid + (state, rate_type)` (:358) — dgid encodes state but NOT rate_type, so composing keeps a collapse strictly within one bucket. A multi-member group collapses to ONE observation centered on the **median `rate_mid`**, bounds from the median member (`makeObservation` :387-435), and advertises a synthetic source `${dgid}__collapsed` (:414-415).
- **D-36 invariant:** every distinct observation carries `evidence_weight = 1.0` (:433). Raw scrape multiplicity NEVER inflates weight.
- **m1/D5-2 family capture** (:404, :113-124): `family = sourceFamily(rep.source)` is resolved from the REAL representative brand BEFORE the `__collapsed` rename, because `sourceFamily('${dgid}__collapsed')` would resolve to the dgid prefix and fake an independent family. Downstream family collapse AND the reliability scorer group on this carried `family`, never re-derive.

### 3.3 Non-locum legacy-band filter (Roadmap step 2, 2026-06-26/29) — :666-715, :893-914

- Predicate `isNonLocumWageRow` (:712-715): `rate_type === 'permanent_wage_proxy'` **OR** `evidence_employment_arrangement === 'permanent'` (either signal alone suffices). Exclusion-by-PROVEN-non-locum on purpose — NULL/'unknown' arrangement (the untagged legacy majority) is KEPT.
- Scope: **legacy `market` min/max/p70 band only.** The v2 buckets, cellObservations, cap band, dedup telemetry are computed over the FULL observation set (permanent_wage_proxy survives in v2 as labeled context; v2's `lastUpdated` reuses the full-cell band so the filter never makes a v2 bucket look staler, :877-882, :1005-1014).
- Mechanics: filter RAW rows then **re-dedup within the locum subset** (:902-904) so a permanent re-scrape can't re-inflate the band's sources list. If EVERY observation in a market cell is proven-permanent, no legacy band is written and the specialty lands in `legacyMarketSuppressedSpecialties` (:905-914) — the bridge writer then writes **null** to `rate-simulator/market-rates/{spec}` (bridge :348-357) to delete the stale prior-run node immediately instead of waiting out the reader's 7-day gate.
- Live verification (comment :680-690): the real vector is scraped W2 compensation-survey rows (Doximity/Medscape/MGMA), which pass the canonical view because rate_scraper/rate_researcher are allowlisted; 0 such rows in the 7-day window as of 2026-06-29 → the guard is currently a no-op-by-construction, not a number-mover.
- `agency_bill_rate` is NOT in this filter because it has no scraper→market vector; it is separately excluded from the v2 WRITE (`V2_MARKET_TREE_EXCLUDED_RATE_TYPES`, bridge :909-917) and stripped by the reader (m6).

### 3.4 Bucket split — :916-967

Each market cell's distinct observations split into `(specialty, stateKey, rateTypeKey)`
buckets: NULL state → literal `'national'` (D-34/D-19), NULL rate_type →
`'null_unclassified'` (never imputed — Pitfall 4). `dimensionCollisionReason` (:470-485)
drops a value that collides with a sentinel or contains `|` rather than mis-bucketing it
(impossible on today's closed enums; counted in `dimensionCollisionsDropped` so
`distinctObservationsTotal = Σ bucket.n_distinct + dropped` stays exact). `n_raw` per bucket
is the **pre-dedup** valid-row count (:932-939), guaranteed ≥ `n_distinct` (:971-975).

### 3.5 Family collapse-then-cap (D-37) — `collapseThenCap()` :527-599, `capFamilyWeights()` :617-645

- **Step 1 collapse:** group by the carried `family`; a family with >1 member collapses to ONE clustered voice at the family's robust center (median rate_mid, bounds from median member), `evidence_weight = 1.0`, synthetic source `${fam}__clustered`. **One corporate family = one independent voice** — adding sub-brands never adds votes (gaming-proof because collapse precedes any weight counting).
- **Step 2 cap:** `FAMILY_CAP_FRACTION = 0.6` (:446). Any voice > 60% of total weight is set to exactly the ceiling, excess redistributed proportionally to the other voices (total conserved). **Honest no-op contract** (:607-616): under flat post-collapse weights, k≥2 voices ⇒ max share 1/k ≤ 50%, so the cap cannot fire on today's data; and k=1 has no redistribution target (single-source is honestly single_source). The COLLAPSE is the real fake-consensus protection; the cap arms a future non-flat reliability-weighting model. `family_cap_fired` is therefore truthful SC3 evidence.
- Family registry: `sourceFamily()` + `KNOWN_FAMILY_OVERRIDES` (vendored copy at `ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/sourceFamily.ts:73-103,194-212`) — longest-prefix match, CHG = {locumstory, comphealth, weatherby, global_medical}, plus AMN/jackson/cross_country/aya. Header note (:19-27): registry has ZERO firings on today's live source universe (tavily_research / exa_semantic / serpapi_google / locums_com only) — forward-looking infrastructure. [UNVERIFIED against current live rows — re-check when the fleet runs.]

### 3.6 The posterior — `aggregateCell()` (shared, D-33 zero-drift)

Canonical: `ias-dashboard/src/features/rate-simulator/engine/cellAggregation.ts`; vendored
live copy `ias-website/.../src/lib/rate-engine/cellAggregation.ts:286-411`. Pure MAD + IVW:

1. Validate observations (`rate_mid ∈ (0, 1e6]`, `evidence_weight ≥ 1e-6`); n=1 → `single_source` (variance = source_variance or `max((rate_mid·0.05)², MIN_VARIANCE)`).
2. `median = quickselect(p=0.5)`; `MAD`; MAD=0 → `zero_spread` (≥50% identical values; a lone outlier is swallowed — property of MAD's 50% breakdown point, documented :20-31).
3. Outlier rejection: `z = 0.6745·(x−median)/MAD`, reject `|z| > 3.5` (:313-320).
4. **IVW:** `w = evidence_weight / variance` where variance = source_variance if usable else empirical floor `max(MAD², (rate_mid·0.05)², 1e-4)` (:333-345). Scraped rows always carry `source_variance: null` (a scraped "$150-425" range is two biased endpoint claims, not a CI — aggregateBridge :96-99), so the family cap rides purely on `evidence_weight` and the math needed zero change (D-33).
5. **Bimodal honesty:** `detectBimodal` (var_high > 4·var_low across sorted halves, floor n≥6, :195-216) OR `detectModalEscape` (≥3 same-side rejected outliers forming a tight cluster, gap > 4·sd, :234-263) ⇒ `weighted_mean = null`, `confidence = 'manual_review_bimodal'` — consumers must route to a labeled rung, never collapse a bimodal cell to one number.
6. Result: `weighted_mean = ΣwX/Σw`, `weighted_variance = 1/Σw` (**estimator SE, not population spread** — this is why the consumer band does NOT use it), `confidence ∈ {multi_source, single_source, zero_spread, manual_review_bimodal}`.

The 5% CV empirical floor and the 3.5 z-cutoff are documented engineering constants
(ALGORITHMS.md §1), not fitted parameters — ESTIMATED, labeled as such.

---

## 4. The RTDB write — one atomic multi-location `update()` (bridge :333-378)

| Path | Value | Notes |
|---|---|---|
| `rate-simulator/market-rates/{safeSpec}` | legacy `{min, max, p70, sources, lastUpdated, valueType:'market'}` | D-40 parallel write; p70 = `min + 0.7·(max−min)` (aggregateBridge :743-750) — a linear interpolation of extrema, **not a true percentile**. Null-written for all-permanent cells. |
| `rate-simulator/cap-rates/{safeSpec}` | same shape, `valueType:'cap'` | Sisense bill/ceiling axis. **No live reader exists** (`loadCapRates()` is still a comment — marketRates.ts:698-705). |
| `rate-simulator/market-rates-v2/{safeSpec}` | `{ __meta__:{lastUpdated, primaryRateType, coverageTier}, {stateKey}:{ buckets:{ {rateType}: MarketBucketData } } }` | **Whole-node replace** per specialty (M2, :888-904) so stale state cells / rate_type leaves from prior runs are cleared; a specialty fully absent this run is left untouched and dies at the reader's 7-day gate. `agency_bill_rate` never written (:915-917, m6). RTDB-unsafe segments skipped, never mangled (:1005-1015). |
| `rate-simulator/source-reliability/{family}` | bootstrap stability score | Display-only, NOT weight-bearing (D-38b, sourceReliability.ts:24-28). Keyed per corporate FAMILY (m1/D5-2). Honest label locked to "source stability" via grep-gated `RELIABILITY_LABEL` (sourceReliability.ts:34-41). |

Empty-tree guard (:372-378): a genuinely empty 7-day window produces `updates = {}` and the
write is skipped — the existing tree is never overwritten with nothing.

`MarketBucketData` per bucket (marketRates.ts:84-94): `weighted_mean, weighted_variance,
median, confidence, n_distinct, n_raw, source_families[], family_capped, lastUpdated`.
`n_distinct` and `source_families` are exactly what the consumer's anchor gate reads.

Telemetry invariants written to `bridge_runs` (bridge :1168-1214), each an independent partition:
- DEDUP: `rows_read_market = distinct_observations_total + rows_collapsed_by_content_hash + rows_collapsed_by_dedup_group`
- BUCKET: `buckets_written_total = Σ buckets_by_rate_type_*`
- CONFIDENCE: `buckets_written_total = cells_single_source + cells_zero_spread + cells_multi_source + cells_manual_review_bimodal`

---

## 5. The LIVE consumer — trust ladder + anchor gate (ias-website worktree)

File: `ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/marketRates.ts`
(⚠ VENDORED from ias-dashboard; sync = `scripts/sync-rate-engine.mjs`, drift gated by
`src/lib/hub/rate-engine-parity.test.ts`).

### 5.1 Reader — `loadMarketBuckets()` :317-375

Reads `rate-simulator/market-rates-v2`, treats every child as UNTRUSTED:

- `isRenderableBucket` (:220-230): finite `weighted_mean`, integer-ish `n_distinct > 0`, `confidence` ∈ the 4-value enum, AND `isFreshBucket` (:154-159) — `lastUpdated` finite, > 0, ≤ 7 days old (`RATE_READ_WINDOW_MS`, :136). A missing/0 timestamp is stale, never epoch-fresh. One pinned `now` per read pass (:329).
- `readCellBuckets` (:279-309): prefer the `'national'` cell, fall to the first real state cell (m4 ladder); **m6 reader-strip** — only `RENDERABLE_RATE_TYPES` (:144-148 = the 4 precedence types + `permanent_wage_proxy` + `null_unclassified`) survive; `agency_bill_rate` and unknown types are stripped so a bill rate can never reach a consumer even on a write-side regression. A cell that existed but stripped empty still registers as honest `insufficient_data` (never silently vanishes, :339-343).
- `selectPrimary` (:236-248): highest `BUCKET_PRECEDENCE` (:119-124) among renderable buckets. Coverage tier: `primary` / `unclassified_only` (null bucket has a finite number — labeled bottom rung, never promoted) / `insufficient_data` (:351-365). **The reader recomputes selection and does NOT read the bridge's `__meta__`** (see Seams §S3).
- Any fetch/parse failure → `{specialties:{}, fellBackToLegacy:true}` — curated statics keep serving (:371-374).

### 5.2 Move #1 — the trust-ladder ANCHOR gate — `applyMarketBucketsOverlay()` :469-551

The 4-rung ladder (:377-412): (1) market-typed posterior, corroborated → **ANCHOR**;
(2) curated researched band → the prior; (3) crowd_survey / scraped_article_estimate →
context only; (4) crude legacy min/max/p70 overlay → **RETIRED** (raw extrema have breakdown
point zero — `loadMarketRates` is tested but unwired; `initLiveMarket` calls only
`loadMarketBucketRates`, sim-live.ts:43-50).

Gate stack per specialty (every check must pass, else the cell keeps its curated band):

1. Specialty exists in `SPECIALTIES` (:480).
2. `coverageTier === 'primary'` with a non-null primary (:481).
3. **Rate-type gate:** `primary.rateType ∈ DEFAULT_ANCHORABLE_RATE_TYPES = {actual_paid_locum, advertised_clinician_pay}` (:419-422, :486) — indirect signals never override the curated band even when corroborated (test O3d/O3e/O3f pins `aggregator_estimate` non-anchorable, `__tests__/marketBucketsOverlay.test.ts:184-192`).
4. `weighted_mean` finite and > 0 (bimodal null-mean can never anchor, :491).
5. **n gate:** `Number.isInteger(n_distinct) && n_distinct ≥ 4` (`minDistinct` default 4, :473,:498) — robust spread is mathematically unavailable below n=4 (cited: Rousseeuw & Verboven 2002); a fractional n_distinct = corrupted RTDB node → reject.
6. **Family gate:** count of DISTINCT, non-blank, trim+lowercase-NORMALIZED `source_families` ≥ 2 (`minFamilies` default 2, :505-512) — the whitespace-faking hole (`['exa',' exa ']` = 2 fake families) was closed 2026-07-02 (commit 6d9edb1).

On promotion (:514-547):
- `p70 = round(weighted_mean)` — the posterior's robust central estimate becomes the quote anchor.
- Band from the **frozen** `STATIC_SPECIALTY_RANGES` snapshot (never the mutated live spec): `min = min(range.min, anchor)`; `max` keeps the audited curated ceiling when the anchor is inside the band, and **rescales the curated max/p70 geometry onto the anchor** (`round(anchor · range.max/range.p70)`) when the anchor ≥ curated max — the premium-erasure fix (pre-fix, a hot anchor collapsed max onto p70 and flattened every night/weekend/holiday/CAH premium back to the base; fixed in 6d9edb1).
- `provenance = 'live'`; `confidence = bucketConfidenceCeiling(rateType)` (:448-456): market-typed → `'high'`, everything else caps at `'medium'` (never display article-derived data as high).
- `weighted_variance` is deliberately NOT used for the band (:406-411): it is the estimator's SE (1/ΣW), 0 for zero_spread cells — a mean±k·SE band would collapse. Honest intervals + shrinkage for thin cells are Moves #2/#3 (open).

### 5.3 Hub wiring

`src/components/hub/hub-client.ts` → `src/lib/hub/sim-live.ts::initLiveMarket()` (:43-50):
single-flight memoised; `configureEngine({db: getHubFirebaseDb()})` then
`loadMarketBucketRates()`. Depends on the **SPECIALTIES-singleton contract** (:12-17): the
sim-adapter and index.phase2 must resolve to ONE `./specialties` module instance or the
in-place mutation silently no-ops (verified against the prod bundle 2026-06-26; a
manualChunks/alias change could break it invisibly). Real observed effect at deploy
(3d9dbd8, 2026-06-30): 0 promotions + 6 cells reverting legacy→curated (EM −21.2%,
radiology −22.2%, psychiatry −18%, anes −4.4%, hosp +2.9%, uro +2.1%).

---

## 6. Seams & smells (coupling / duplication / risk)

- **S1 — The bridge's canonical modules live inside the DEAD app.** `bridge-rate-intelligence.ts` imports `marketRates`, `specialties`, `firebaseKeyCodec` from `ias-dashboard/src/features/rate-simulator/engine/` (:52-59) and `aggregateBridge` imports `cellAggregation` + `sourceFamily` from the same directory (aggregateBridge.ts:25-27). The "legacy copy" is NOT dead code — it is a live production dependency of the still-live pipeline. Deleting/archiving the dead app breaks the nightly bridge. Any headless-core extraction must move these shared modules first.
- **S2 — Three-repo vendoring with a live divergence already caught.** The live engine (`ias-website/src/lib/rate-engine/*`) is a vendored snapshot of the dashboard engine. Confirmed drift TODAY: canonical `ias-dashboard/.../marketRates.ts:124-128` has `aggregator_estimate: 0` in BUCKET_PRECEDENCE (renderable-as-context, WS1); the vendored live copy (:119-124 + RENDERABLE_RATE_TYPES :144-148) does **not** — the live hub will strip `aggregator_estimate` buckets entirely (a sole-aggregator specialty renders `insufficient_data` instead of labeled context). Dormant until the WS1 fleet + prod migration land, then it becomes silent context loss on the live surface. The parity test gates byte-drift of vendored files, but the worktree currently has 18 modified rate-engine files uncommitted/unsynced — re-sync discipline is manual.
- **S3 — The precedence ladder exists in 3 copies + 1 unread artifact.** Bridge `RATE_TYPE_PRECEDENCE` (writer __meta__), dashboard `BUCKET_PRECEDENCE`, website `BUCKET_PRECEDENCE` — already diverged once (S2). Meanwhile the bridge computes `__meta__.primaryRateType`/`coverageTier` per specialty (:1058-1083) that the live reader **never reads** (it recomputes `selectPrimary` client-side). `__meta__` is write-only freight on the live path today. Consolidate or delete.
- **S4 — `knownSpecialties` comes from the dashboard's SPECIALTIES, the quote reads the website's.** The bridge admits/drops rows per `ias-dashboard` `specialties.ts` keys (bridge :1477); the hub anchors per `ias-website` `specialties.ts`. A specialty added to one and not the other either never gets bridged (coverage gap: rows land in `unknownSpecialties` forever) or gets bridged but never anchored. No cross-repo test pins the key sets equal. Direct north-star risk (coverage of EVERY locum specialty).
- **S5 — The anchor gate lives ONLY on the consumer, and the consumer trusts RTDB values.** `n_distinct`/`source_families` are read verbatim from a **public-read** RTDB tree; the overlay validates shape (integer n, normalized families) but the trust boundary is RTDB write rules. If `rate-simulator/*` is writable by anything beyond the bridge's admin credential, a forged node with `n_distinct:9, source_families:['a','b'], rate_type:'actual_paid_locum'` would anchor live quotes. Write-rule audit is the single highest-leverage adversarial check. [UNVERIFIED — needs the RTDB rules export.]
- **S6 — No true percentile anywhere on this path.** Legacy p70 is `min + 0.7·(max−min)` over extrema; the anchor is a weighted MEAN placed into the p70 slot; the band is curated geometry. The north star ("where the rate sits in the market distribution") is currently answered by a posterior point + a curated envelope, not an observed distribution. Move #2 (honest intervals) is the named gap.
- **S7 — National-only cells.** Every bucket today is `stateKey='national'` (state is 100% NULL on live rows — bridge :966-972 comment). Geo differentiation comes entirely from the engine's static state multipliers, not from observed state-level posteriors. The v2 schema already materializes the state level, so this is a data-coverage gap, not a schema gap. [Verify: current v2 tree contains only 'national' cells.]
- **S8 — Non-locum filter mostly protects a RETIRED path.** The legacy band is unwired on the live hub (Move #1 retired it), yet the filter/suppression/null-clear machinery (Roadmap step 2) guards that band. It still matters for (a) any stale SPA bundle reading legacy and (b) the dashboard app if ever resurrected — but the effort/coverage asymmetry is worth knowing before extending it.
- **S9 — `cap-rates` is a write-only tree.** Written every run, no reader (`loadCapRates` never built). Cheap to keep, but it is unaudited freight in the atomic update.
- **S10 — Minor normalization asymmetry in the reliability scorer.** `computeReliabilityFromOutput` counts `independent_family_count = new Set(agg.data.source_families).size` (bridge :1124) WITHOUT the trim/lowercase normalization the overlay's family gate applies. Display-only today (D-38b), but if reliability ever becomes weight-bearing (V2-04), the same whitespace-faking class re-opens there.
- **S11 — 7-day cliff.** Bridge window and reader gate are both 7 days: one week of fleet outage silently reverts every promoted cell to its curated band with no operator-facing signal on the hub (honest, but invisible). `bridge_runs` telemetry is the only detection surface; nothing alerts on "promotions went 6 → 0".

---

## 7. Quick reference — the full gate stack for one observation

```
canonical view (agent allowlist)            → bars gov/legacy writers
quarantine (cap-capable × market)           → bars mislabeled Sisense rows
never-anchor (ZipRecruiter/Adzuna family)   → bars W2-blended job boards
validity (low>0, high>low)                  → bars malformed rows
known specialty (dashboard SPECIALTIES)     → bars unmapped cells
Stage-1 dedup (URL×state×type×value)        → kills re-scrape cadence inflation
Stage-2 dedup (dgid×state×type)             → collapses near-dups to 1 vote @1.0
non-locum filter (legacy band only)         → bars W2 salary proxies from the crude band
bucket split (state, rate_type)             → never averages economic populations
family collapse (sourceFamily)              → 1 corporate family = 1 voice
family cap ≤60%                             → arms future non-flat weights
aggregateCell (MAD z>3.5, IVW, bimodal→null)→ the posterior
—— RTDB ——
reader shape/enum/n>0 validation            → bars corrupted nodes
7-day freshness gate                        → bars stale posteriors
m6 reader-strip                             → bars bill rates / unknown types
D-39 precedence                             → picks the most defensible rate_type
ANCHOR gate: market-typed ∧ n≥4 ∧ ≥2 fams   → only then does live data move the quote
band re-level (frozen curated geometry)     → preserves premium headroom
```
