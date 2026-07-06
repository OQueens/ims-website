# Map 04 — Scraper / Ingestion Pipeline (agent-sdk `rate_scraper` + IronDome)

> Deep-dive map, 2026-07-02. Repo topology (Zach-confirmed): the LIVE simulator is
> `imstaffing.ai/hub`, served by **ias-website** (`src/lib/rate-engine` + `src/lib/hub`).
> This pipeline (agent-sdk scraper → Supabase `rate_intelligence` → ias-dashboard bridge →
> Firebase RTDB `rate-simulator/market-rates-v2/*`) is the **still-live data path** that
> feeds the RTDB overlay the live hub engine reads. The ias-dashboard *app* is dead;
> its `src/features/rate-simulator` engine is referenced here only because the bridge
> imports `sourceFamily.ts` from it.

All paths absolute. `agent-sdk` = `C:/Users/oclou/QueenClaude/agent-sdk`,
`ias-dashboard` = `C:/Users/oclou/QueenClaude/ias-dashboard`,
`ias-website` = `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan`.

---

## 1. End-to-end data flow (one screen)

```
EXTERNAL WEB                                   agent-sdk/agents/rate_scraper/
┌─────────────────────────┐
│ A. Marketing rate pages │─Firecrawl──▶ scrape_firecrawl (agent.py:753)
│   6 TUNED + 18 GENERIC  │              └▶ parse_rates (agent.py:613)  [regex]
│ B. Google SERP snippets │─SerpAPI────▶ scrape_serpapi (agent.py:780) [2 regex blocks]
│ C. Per-job POSTINGS     │─Scrapling──▶ scrape_postings (agent.py:974)
│   AMN live; DocCafe/    │              ├▶ scrapling_fetch.fetch (static/stealth)
│   Physemp/emCareers/LJO │              ├▶ content_ok guard (scrapling_fetch.py:96)
│   STAGED                │              ├▶ card_extractor / jsonld_parser
└─────────────────────────┘              ├▶ dedup_cross_board (dedup.py:174)
                                         └▶ build_posting_records (agent.py:467)
        every candidate row ──▶ gates: unit → equal-bound → specialty allowlist
                                → no-tight-bound → rate_type classify → IronDome
                                        │
                     IronDome.validate_rate_record (core/iron_dome.py:102)
                     PLAUSIBLE_RANGES per-specialty $ bands (iron_dome.py:16)
                                        │
     execute() (agent.py:1101): RUN_SUMMARY + HARD partition sum-check
     rows_attempted == rows_inserted + Σ rows_rejected_by_*   (agent.py:1432-1442)
                                        │
     Supabase `rate_intelligence` batch INSERT
     (core/supabase_client.py:77-86; ONE statement — a single bad row aborts ALL)
                                        │
     BRIDGE (still live): ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts
     reads WHERE date_scraped >= NOW()-7d (line 312, RATE_READ_WINDOW_DAYS=7 line 101)
     ├▶ dedup_group_id collapse → distinct observations
     ├▶ sourceFamily(source) family collapse + ≤60% cap
     │   (lib/aggregateBridge.ts:27 imports ias-dashboard/src/features/rate-simulator/
     │    engine/sourceFamily.ts; collapseThenCap at aggregateBridge.ts:527)
     ├▶ independent_family_count = new Set(source_families).size
     │   (bridge-rate-intelligence.ts:1124)
     └▶ writes RTDB rate-simulator/market-rates-v2/{specialty} (line 906)
                                        │
     LIVE CONSUMER: ias-website/src/lib/rate-engine/marketRates.ts
     applyMarketBucketsOverlay (marketRates.ts:469) — anchor gate:
     market-typed rate_type ∈ {actual_paid_locum, advertised_clinician_pay}
     (marketRates.ts:419) AND n_distinct ≥ 4 AND ≥ 2 independent families
     (marketRates.ts:473-512). Anything else = curated prior wins.
```

**Why the pipeline is built the way it is:** every anti-fabrication guard exists to
protect ONE downstream decision — whether a live scraped posterior may **anchor a real
quote** (overriding the curated band). The gate is `n_distinct ≥ 4` + `≥ 2 independent
source families` + market-typed rate. So the scraper's job is not just extraction; it is
making sure n and family counts are **honest** (no duplicate posting counted twice, no
board masquerading as an agency, no challenge page scraped as data).

---

## 2. Entry paths (how external rate data enters)

### 2a. Firecrawl marketing-page path (legacy core, live)
- Catalog: `agent-sdk/agents/rate_scraper/sources.py` — 6 `TUNED_SOURCES` with
  per-source regexes (locums_com, locumstory, comphealth, barton_associates, weatherby,
  jackson_coker; sources.py:135-198) + 18 `GENERIC_SOURCES` on 5 `UNIVERSAL_PATTERNS`
  (sources.py:204-240). 4 sources pruned (staffcare dead-404; doximity/medscape/mgma
  over-budget W2 — sources.py:4-7, 215-222).
- Fetch: `scrape_firecrawl` (agent.py:753-778), Firecrawl `/v1/scrape` → markdown,
  behind a `BudgetGuard` reservation (est. $0.005/call, agent.py:66) — the circuit
  breaker for paid calls.
- Parse: `parse_rates` (agent.py:613-743) — regex over markdown; per match:
  attempted++ → markdown-link/URL/overlong reject → structural reject → equal-bound
  drop (low==high, agent.py:686) → canonical-specialty gate
  (`normalize_specialty_canonical`, returns None for anything not allowlisted —
  `shared/specialty_canonical.py:75`) → in-run dedup on `spec|low|high` (agent.py:700).

### 2b. SerpAPI fan-out path (live)
- `scrape_serpapi` (agent.py:780-964): one Google query
  (`SERPAPI_QUERY`, sources.py:246) → for each organic result, Block 1 regex
  ("Specialty … $X–$Y per hour", agent.py:829) and Block 2 regex ("$X–$Y/hr" +
  `detect_specialty_from_text` context detection, agent.py:892-911). Same gates
  (canonical specialty, equal-bound, dedup). Confidence hardcoded `"low"`
  (agent.py:876). rate_type resolved per **destination URL** (fan-out;
  `fixed_default=None` → URL-pattern lookup, agent.py:861).

### 2c. Scrapling posting path (WS1 — per-job advertised pay; AMN live, rest STAGED)
- Catalog: `posting_sources.py:90-196`. Only `verified=True` entries run
  (`verified_posting_sources()`, posting_sources.py:244). Today that is **AMN only**
  (18 per-specialty slugs, posting_sources.py:69-88; `diagnostic-radiology`
  live-verified 2026-06-30). DocCafe/Physemp/emCareers/LocumJobsOnline are
  `verified=False` (selectors/list-URLs unconfirmed; LJO also needs the CF bypass).
- Fetch: `scrapling_fetch.fetch` (scrapling_fetch.py:29) — `static` tier
  (curl_cffi TLS impersonation) or `stealth` tier (Camoufox; optional
  `RATE_SCRAPER_BYPASS_PROXY` env, scrapling_fetch.py:63). No BudgetGuard —
  self-hosted, ~zero marginal cost (the Firecrawl cost-cap removal).
- Three fetch modes routed by `_collect_posting_candidates` (agent.py:1011):
  `listing_cards` (AMN: pay cards on per-specialty listing; specialty from URL slug),
  `listing_cards_1s` (single-specialty listing), `listing_jsonld` (listing → detail
  URLs, capped at 60/deduped → JSON-LD `baseSalary`; agent.py:1065-1099).
- Extractors (pure, stdlib):
  - `card_extractor.parse_rate_text` (card_extractor.py:83) — unit-first parse;
    rejects $-figures attached to YEAR/WEEK/MONTH/RVU units (W2/non-locum,
    card_extractor.py:37-42); hour↔day cross-unit leak guard (card_extractor.py:48-53,
    118-121); in-band filter hourly $60–900 / daily $400–12,000
    (card_extractor.py:72-73) so a "$5,000 sign-on bonus" can't poison a range.
  - `jsonld_parser.parse_jsonld_jobposting` (jsonld_parser.py:146) — schema.org
    JobPosting `baseSalary`; accepts ONLY HOUR/DAY `unitText` (YEAR/MONTH/WEEK =
    permanent/W2, rejected — jsonld_parser.py:31-40); magnitude bands hourly
    $60–900 / daily $400–12,000 (jsonld_parser.py:39-40); captures
    `hiringOrganization` (the recovered agency) + location; `@graph` double-yield
    fix so one posting never counts twice (jsonld_parser.py:115-143).

---

## 3. Validation layers (in firing order, posting path)

| # | Guard | Where | What it stops |
|---|-------|-------|---------------|
| 0 | `content_ok` page guard | scrapling_fetch.py:96-151 | HTTP-200 Cloudflare-challenge/404/interstitial pages scraped as "success" → fabricated anchor. Requires ≥1 in-band, correctly-typed pay observation via the SAME extractor the caller will run. Closed reason vocab: `no_page / http_<status> / no_jsonld_rate / no_card_rate / bad_expect`. Deliberately biased to drop (false negative = lost breadth, recoverable; false positive = false anchor, unrecoverable). Page-level metric `posting_pages_dropped_validation` (agent.py:1360-1362) — NOT part of the row partition. |
| 1 | Unit gate (HOUR only) | agent.py:491-495 | DAY/other units can't be checked against IronDome's hourly bands; lossy DAY→HR conversion deliberately deferred (no-fake-data). Counted `rows_rejected_by_posting_unit_unsupported`. |
| 2 | Equal-bound drop (low==high) | agent.py:504-505 (postings); agent.py:686 (parse_rates); agent.py:851, 926 (serpapi) | Single-point rates manufactured into a "range" (SC3 fabrication); also the bridge rejects `rate_high <= rate_low`, so inserting would be a phantom insert. Phase-2 plan: reintroduce as `evidence_type='point_estimate'`. |
| 3 | Canonical-specialty allowlist gate | `extract_specialty` / `normalize_specialty_canonical` (shared/specialty_canonical.py:75,157); call sites agent.py:507-510, 695, 836, 915 | Raw non-allowlisted strings ever reaching the DB (the deleted `SPECIALTY_MAP.get(raw, raw)` fallback was "the ~54% garbage path", sources.py:35-37). URL-slug specialties inside links are stripped first (specialty_canonical.py:168-173). |
| 4 | No-tight-bound guard | agent.py:522-524 | A specialty NOT in `PLAUSIBLE_RANGES` would fall to `DEFAULT_RANGE` $60–700 (iron_dome.py:53) — wide enough that an inflated APP/NP posting (e.g. $650) could pass and become a FALSE ANCHOR. Drop-and-count until a vetted per-cell band exists. Drops nothing on AMN's live slugs today; makes STAGED boards safe-by-construction. |
| 5 | Cross-board dedup | dedup.py:174-198, called agent.py:529 | The SAME physical posting re-listed on N boards counted as N observations (fake n≥4). Key = (specialty, family, location, $5-bucketed low/high, unit) (dedup.py:150-165). Survivor by provenance rank: `jsonld_posted(3) > card_posted(2) > aggregator_estimate(1)` (dedup.py:57). |
| 6 | rate_type enum enforcement | `classify_rate_type` + `_enforce_rate_type` (shared/rate_type_classifier.py:90-107); call sites agent.py:284-293, 550-552 | Arbitrary strings leaking into `rate_intelligence.rate_type`; closed 7-value enum. |
| 7 | IronDome record validation | core/iron_dome.py:102-141; call sites agent.py:585, 1185, 1227, 1263 | Missing fields; empty specialty/source (would insert NULL → NOT-NULL constraint aborts the WHOLE batch, iron_dome.py:109-119); non-numeric rates; low≤0 or low>high; out-of-plausible-range $ per specialty. |
| 8 | Hard partition sum-checks | agent.py:1432-1519 | Silent drops / phantom inserts (see §5). Runs BEFORE the Supabase write — a violation refuses to persist. |
| 9 | DB CHECK constraint | ias-dashboard/supabase/migrations/20260701000000_add_aggregator_estimate_rate_type.sql | Write-side enum backstop. ⚠ MUST be applied to prod BEFORE flipping locumjobsonline `verified=True` — an `aggregator_estimate` row would raise 23514 and, because `insert_rate_intelligence` is ONE batch statement (supabase_client.py:82), abort the entire run's write. |

### IronDome `PLAUSIBLE_RANGES` (core/iron_dome.py:16-51) — OBSERVED from code
Per-specialty hourly USD bands (min–max), e.g.: anesthesiology 200–600, **crna 120–250**
(ceiling tightened 350→250 Phase-4 OBS-03, mirrored 1:1 with `MAX_HOURLY` in the engine's
`blsSanityCheck.ts` — iron_dome.py:18-23), emergency medicine 150–450, hospitalist
100–350, internal/family medicine 80–250, neurosurgery 250–650, cardiology 200–550,
psychiatry 130–350, radiology 150–450, ob/gyn 120–400, urology 170–400, med-onc &
heme-onc 300–600, urgent care 100–250, allergy/immunology 80–200 (29 keys total).
`DEFAULT_RANGE` = 60–700 (iron_dome.py:53). `_augment_with_canonical_aliases`
(iron_dome.py:73-92) registers every band under BOTH legacy and canonical spellings and
**raises at import** on a conflicting alias collision — a canonicalized name silently
falling to DEFAULT_RANGE was a real regression (CRNA $120-350 → $60-700) caught by
Codex review (iron_dome.py:55-72).

**Coverage defect (north-star relevant):** 29 bands vs. the full locums specialty
universe. Any canonical specialty WITHOUT a tight band is (a) blocked entirely on the
posting path (guard #4) and (b) validated only against $60–700 on the article/serpapi
paths. No APP/CRNA-subspecialty/day-rate bands exist. The full canonical allowlist lives
in `agent-sdk/shared/specialty_canonical_list.json`; the delta between it and
PLAUSIBLE_RANGES is unquantified in code (an IronDome coverage assertion is named as a
fleet-phase item at agent.py:519-521).

---

## 4. Classification: `rate_type` (trust ladder input)

- Closed 7-value enum (shared/rate_type_classifier.py:59-67):
  `actual_paid_locum, advertised_clinician_pay, agency_bill_rate,
  permanent_wage_proxy, scraped_article_estimate, crowd_survey, aggregator_estimate`.
- Resolution (`classify_rate_type`, decision paths at rate_type_classifier.py:28-33):
  1. **source_default** — direct-scrape sources carry a per-source 3-tuple
     `{rate_type, source_legal_class, evidence_employment_arrangement}` loaded from
     `shared/rate_type_url_patterns.json` (single source of truth; sources.py:308-340;
     hard cardinality asserts 6+18=24 at sources.py:351-365).
  2. **url_override:<name>** — fan-out sources (serpapi_google) match destination-URL
     patterns; pruned sources' overrides retained so a stray doximity/medscape/mgma URL
     still classifies `permanent_wage_proxy` (sources.py:219-222).
  3. **source_bls_oews** prefix short-circuit → `permanent_wage_proxy` (BLS rows come
     from ias-dashboard `scripts/data-refresh/extract-bls-oews.mjs`, not this agent).
  4. **fallback** → `scraped_article_estimate` (conservative-truthful: lowest
     reliability weight, rate_type_classifier.py:71-73).
- Posting sources carry `rate_type` in their catalog entry (validated at import,
  posting_sources.py:208-241): AMN = `advertised_clinician_pay` (anchorable),
  LJO/TrackFive = `aggregator_estimate` (self-labeled estimates; NEVER anchors —
  excluded from the live engine's `DEFAULT_ANCHORABLE_RATE_TYPES`, ias-website
  marketRates.ts:419-422, and absent from `BUCKET_PRECEDENCE`, marketRates.ts:119-124).
- Downstream precedence (live engine, marketRates.ts:119-124): `actual_paid_locum(4) >
  advertised_clinician_pay(3) > crowd_survey(2) > scraped_article_estimate(1)`;
  `permanent_wage_proxy` labeled-context-only; `agency_bill_rate` never renderable.

Other per-row enrichment (all counted; agent.py:345-436):
`state` (`shared/state_attribution.extract_state`, 4 decision paths — postings instead
use structured "City, ST" via `_state_from_posting_location`, agent.py:456-464),
`content_hash`, `dedup_group_id` (the bridge's collapse key), `published_at`
(`shared/published_at`, honest scrape-date floor when no date found; postings always
use the scrape-date floor, agent.py:581-583).

---

## 5. The partition / accounting invariant (the "no fake data" tripwire)

**A.1 total partition** (agent.py:161-197, enforced at agent.py:1432-1442):
every candidate (regex match OR posting candidate) increments `_ROWS_ATTEMPTED_COUNTER`
exactly once, then lands in EXACTLY ONE terminal bucket. At run end:

```
rows_attempted == rows_inserted + Σ (every metrics key starting with "rows_rejected_by_")
```

- Reject buckets (metrics block agent.py:1324-1356): specialty_gate, equal_bound,
  pattern_no_match, iron_dome, no_candidate, dedup, no_specialty_context,
  invalid_range(=0 NA), single_pattern_drop(=0 NA), posting_unit_unsupported,
  posting_equal_bound, posting_specialty_gate, posting_no_tight_bound, posting_dedup.
- Enforced with an explicit `raise AssertionError` (NOT `assert`) so `python -O`
  can't strip it (agent.py:1421-1442); runs BEFORE the Supabase insert so a
  violated partition refuses to persist (agent.py:1299-1307).
- Buckets are deliberately never merged/aliased (per-site-class separation,
  agent.py:96-159); all counters are list-wrapped module state reset at
  `execute()` start (agent.py:1107-1156).
- **A.2 sub-partitions** (independent totals, each with its own hard sum-check):
  rate_type `source_default + url_override + fallback == classified`
  (agent.py:1464-1477); state attribution `url + full_name + 2letter + national ==
  total` (agent.py:1485-1499); published_at 5 buckets == total (agent.py:1503-1519).
  Totals are decoupled so an exception between two resolver calls can't produce
  phantom cross-partition failures (agent.py:222-229). A negative-control test (V-21)
  freezes a bucket counter to prove the gates actually fire.
- Posting-path exception safety: each dedup survivor's whole record-build is wrapped
  so ANY raise becomes a counted IronDome-style reject — one malformed row can never
  unbalance the partition or abort a good run (agent.py:536-588).
- `RUN_SUMMARY` JSON emitted to stdout + logger BEFORE the sum-check and before the
  zero-rows RuntimeError (agent.py:1411-1419) — operators always get the accounting,
  especially when everything was rejected.
- Page-level drops (`content_ok` fails) yield ZERO rows and are tracked separately in
  `posting_metrics.posting_pages_dropped_validation` (agent.py:1357-1362) — they are
  intentionally NOT in the row partition.
- Post-insert attribution check: every row carries `agent_id='rate_scraper'`
  (underscore literal, NOT BaseAgent's hyphenated `self.name` — by design,
  agent.py:69-94; logged a1_integrity at agent.py:1534-1539).

---

## 6. Insertion & the bridge handoff

- `execute()` appends validated rows from all four producers into `all_records`,
  then ONE batch insert: `supabase.insert_rate_intelligence(all_records)`
  (agent.py:1523-1524 → core/supabase_client.py:77-86,
  `client.table("rate_intelligence").insert(records).execute()`).
  **Single-statement batch = all-or-nothing**: one constraint-violating row loses the
  whole run's data. This is why IronDome pre-rejects empty specialty/source
  (iron_dome.py:109-119) and why migration `20260701000000` is a hard prerequisite
  for the LJO flip.
- Posting records are appended WITHOUT re-validation (already IronDome'd inside
  `build_posting_records`; re-validating would double-count — agent.py:1285-1297).
- Bridge (live, ias-dashboard): `scripts/data-refresh/bridge-rate-intelligence.ts`
  reads `rate_intelligence WHERE date_scraped >= NOW() - 7 days` (line 312), collapses
  by `dedup_group_id`, resolves each distinct observation's corporate family via
  `sourceFamily()` (`lib/aggregateBridge.ts:27,404`), runs `collapseThenCap`
  (aggregateBridge.ts:527: one family = one voice; single voice ≤60% of cell weight),
  computes variance-weighted posteriors per (specialty, state, rate_type) bucket, and
  writes whole-node `rate-simulator/market-rates-v2/{specialty}` RTDB updates
  (bridge-rate-intelligence.ts:906,956) with
  `independent_family_count = new Set(source_families).size` (line 1124).

### Aggregator family-recovery seam (the independence fix)
- Problem: the bridge counts independence via `sourceFamily(source)`. If aggregator
  rows persisted `source` = the BOARD (doccafe/jama/...), one agency's req re-listed
  on two boards = two "families" = fake corroboration (dedup.py:1-35).
- Fix (wired 2026-07-01): `build_posting_records` persists
  `source = recovered_source_family(row)` (agent.py:568 → dedup.py:121-147):
  - Aggregator board + `hiring_org` present → underscore-normalized agency
    (`'Aya Locums'→'aya_locums'`→ sourceFamily `'aya'`;
    `'Weatherby Healthcare'→'weatherby_healthcare'`→`'weatherby'`→`'chg'` via
    `KNOWN_FAMILY_OVERRIDES` longest-prefix walk — live engine copy at
    ias-website `src/lib/rate-engine/sourceFamily.ts`, bridge copy at
    ias-dashboard `src/features/rate-simulator/engine/sourceFamily.ts:73,194-207`).
  - Aggregator board, NO `hiring_org` → constant `'unattributed'`: all un-attributable
    rows share ONE family so they can never satisfy the ≥2-family gate by themselves
    (dedup.py:26-33, Codex CRITICAL fix).
  - Direct-agency board (AMN — not in `AGGREGATOR_SOURCES`, dedup.py:46-51) → keeps
    `source` verbatim (board IS the family; live DB value byte-identical).
  - Board provenance survives in `source_url`. Org normalization strips ONLY corporate
    legal suffixes (inc/llc/corp/…), never meaningful words like "health"/"medical"
    (over-collapse guard, dedup.py:62-64). Locked by tests on both sides:
    `agent-sdk/tests/test_posting_records.py` + engine `sourceFamily.test.ts`.

### Live-engine consumption gate (what all this feeds)
`applyMarketBucketsOverlay` (ias-website `src/lib/rate-engine/marketRates.ts:469-514`):
a cell's posterior anchors the quote ONLY if primary bucket rate_type ∈
`{actual_paid_locum, advertised_clinician_pay}` AND `Number.isInteger(n_distinct) &&
n_distinct ≥ 4` AND ≥2 distinct non-blank trimmed/lowercased families (whitespace-faking
hole closed, marketRates.ts:499-512). Otherwise the curated prior band stands. Indirect
types cap at 'medium' confidence (`bucketConfidenceCeiling`, marketRates.ts:448-456).
Reader enforces a 7-day freshness window matching the bridge (marketRates.ts:129-136).

---

## 7. Tests (where the behavior is locked)

`agent-sdk/tests/`: `test_rate_scraper.py` (partition + counters + catalog cardinality),
`test_posting_records.py` (posting partition + family-recovery seam),
`test_scrapling_content_guard.py` (content_ok), `test_iron_dome.py` /
`test_iron_dome_agent.py`, `test_rate_type_classifier.py`, `test_dedup_group_id.py`.
Engine side: ias-website `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts`
(22 cases incl. O12 asserting anchorable set is exactly the two market types) +
`sourceFamily.test.ts` (both repos). Memory: 873 py + vitest green as of 2026-07-01.

---

## 8. Seams & smells (coupling / duplication / risk)

1. **Cross-language, cross-repo family-key duplication (highest divergence risk).**
   The independence semantics live in THREE places that must agree token-for-token:
   Python `dedup._norm_org_underscore`/`recovered_source_family` (dedup.py:75-147),
   bridge TS `sourceFamily.ts` + `KNOWN_FAMILY_OVERRIDES` (ias-dashboard
   src/features/rate-simulator/engine/sourceFamily.ts), and the live-engine copy
   (ias-website src/lib/rate-engine/sourceFamily.ts). A new override added in one repo
   but not the other silently changes independence counting. Tests lock today's cases,
   but there is no single machine-readable registry shared across languages.
2. **The bridge imports from the DEAD app's tree.** `lib/aggregateBridge.ts:27` imports
   `../../../src/features/rate-simulator/engine/sourceFamily` — the retired
   ias-dashboard app's engine directory is load-bearing for the LIVE pipeline. Anyone
   "cleaning up the dead app" breaks the bridge. Portability extraction should pull
   `sourceFamily` into the headless core and repoint the bridge.
3. **Two magnitude-band copies.** Hourly $60–900 / daily $400–12,000 duplicated in
   `jsonld_parser.py:39-40` and `card_extractor.py:72-73` (plus IronDome's separate
   per-specialty bands). A tighten in one file won't propagate.
4. **Single-statement batch insert = all-or-nothing.** supabase_client.py:82. Guards
   exist (IronDome empty-field reject, enum enforcement, the migration), but any NEW
   constraint added DB-side without a matching producer-side guard = total silent run
   loss. A per-row or chunked upsert with error partitioning would be more robust.
5. **DAY-rate observations are dropped, not converted** (agent.py:491-495). Honest,
   but surgical/call-heavy specialties are advertised per-day disproportionately —
   a systematic coverage bias against exactly the specialties with the thinnest data.
   (Deliberate deferral; conversion needs a vetted hours-per-day model, not a guess.)
6. **PLAUSIBLE_RANGES coverage gap + hand-tuned bounds.** 29 specialties with
   code-comment provenance only (no citation registry). The no-tight-bound guard makes
   missing bands a hard blocker for the posting path — so band coverage is now the
   bottleneck for expanding specialty coverage. Also equal bounds must stay in lockstep
   with the engine's `blsSanityCheck.ts` MAX_HOURLY by convention only (iron_dome.py:21).
7. **agent.py is an 85KB monolith** with ~30 module-level list-wrapped counters and
   plan-archaeology comments dwarfing code. The counter-reset block (agent.py:1107-1156)
   must enumerate every counter by hand — forgetting one on the next feature leaks
   state across runs (the exact bug class the resets exist to prevent). A counter
   registry (dict of buckets, reset in one loop, summed by prefix) would collapse
   ~200 lines and remove the forget-a-reset failure mode.
8. **STAGED sources are config-guessed.** doccafe/physemp/emcareers/LJO selectors and
   list URLs are unverified guesses (posting_sources.py:125,141,162 marked STAGED;
   `list_urls: []`). Guard-protected (content_ok + verified=False), so safe — but the
   aggregator family-recovery seam is UNEXERCISED by live data until a fleet run
   confirms selectors and the bridge is re-run on real recovered rows
   (posting_sources.py:36-38 names this as the remaining step).
9. **Firecrawl + Scrapling coexist.** Marketing-page path still pays Firecrawl per
   scrape while the posting path is self-hosted. The tooling decision
   (docs/scraper-tooling-decision.md) is to downgrade Firecrawl to fallback — the
   marketing-page fetches have not yet been migrated to Scrapling.
10. **serpapi Block-1/Block-2 double-mention risk is accepted, not eliminated.** The
    same snippet can produce a Block-1 row (specialty in-pattern) and a Block-2 row
    (context-detected) with identical numbers; in-run `seen` dedup catches identical
    (spec,low,high) but cross-block near-misses land as distinct rows and are only
    collapsed later by the bridge's dedup_group_id. Low severity (serpapi rows are
    confidence 'low' and mostly `scraped_article_estimate` → never anchor).

---

## 9. What is OBSERVED vs ESTIMATED in this pipeline

- **OBSERVED (inserted as-is, provenance-tagged):** regex-extracted $/hr ranges from
  named marketing pages; SERP snippet ranges; AMN card ranges; JSON-LD baseSalary.
  Every row carries source, source_url, rate_type, confidence, date_scraped,
  published_at (scrape-date floor when unknown — an honest upper bound, not a guess).
- **ESTIMATED (never inserted):** nothing. The pipeline fabricates no numbers: no
  DAY→HOUR conversion, no widening of single points, no raw-specialty passthrough,
  no LLM extraction anywhere (structured extractors only — the tooling decision
  explicitly bans LLM-extracted rates as false-anchor risk).
- **Trust labeling is downstream:** rate_type + n_distinct + independent_family_count
  drive the live anchor gate; `aggregator_estimate` and `permanent_wage_proxy` can
  never move a quote.
