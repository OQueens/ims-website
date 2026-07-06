# 06 — Data Model: rate_intelligence, the canonical view, the RTDB trees, the cell taxonomy, and the golden master

> Scope: the data layer under the LIVE rate simulator (imstaffing.ai/hub, served by `ias-website`).
> Repos referenced (all absolute):
> - `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan` — live engine (`src/lib/rate-engine`) + hub adapter (`src/lib/hub`)
> - `C:/Users/oclou/QueenClaude/ias-dashboard` — canonical engine source, Supabase migrations, EC2 bridge (`scripts/data-refresh`)
> - `C:/Users/oclou/QueenClaude/agent-sdk` — scraper fleet + shared producer taxonomy (`shared/`)
> - `C:/Users/oclou/QueenClaude/medical-staffing` — original DDL for `rate_intelligence` (historical)
>
> OBSERVED = read from code/DDL in these repos (cited file:line). ESTIMATED/STATED = a number quoted inside a migration comment or memory doc, not re-verified against the live DB — flagged as such.

---

## 0. Where "truth" lives — the four layers

There is no single source of truth; the quote is a **layered override chain**. Each layer lives in a different store:

| Layer | Store | What it is | Who writes | Who reads at quote time |
|---|---|---|---|---|
| **1. Curated prior** | Compiled into the JS bundle: `ias-website/.../src/lib/rate-engine/specialties.ts` (88 keys), `callRates.ts`, `stateData.ts`, `blsOewsBaseline.ts` | Analyst-researched hourly bands (min/max/p70), call-rate daily bands, state multipliers, BLS OEWS baselines | Analysts via commits | **Always** — the default quote when no live anchor fires |
| **2. Observation spine** | Supabase Postgres (prod project `gbakzhibzotugfyktcrt`): `rate_intelligence` + `canonical_rate_intelligence` view | Raw scraped/researched rate observations, typed + dedup-keyed + cited | agent-sdk producers (`rate_scraper`, `rate_researcher`, `rate_observer`), Sisense writer, BLS extract script | **Never directly** — only the bridge reads it |
| **3. Aggregated posterior** | Firebase RTDB (`weekly-sync-451e2`): `rate-simulator/market-rates-v2` (+ legacy `market-rates`, `cap-rates`, `source-reliability`, `feedback`) | Per-(specialty, state, rate_type) robust posteriors (MAD+IVW), written daily by the EC2 bridge | `bridge-rate-intelligence.ts` cron (04:00 UTC, EC2 54.145.175.182) | **The live hub** — `sim-live.ts initLiveMarket()` overlays `SPECIALTIES` in place |
| **4. Behavior contract** | `goldenMaster.json` (207 cases, both repos) | Frozen engine outputs — math truth, not data truth | `ias-dashboard/scripts/rate-engine/gen-golden-master.ts` | CI parity tests only |

The Move #1 trust ladder (`marketRates.ts:377-412`, ias-website copy) formalizes the override rule: a **market-typed** posterior (`actual_paid_locum` / `advertised_clinician_pay`, n_distinct ≥ 4, ≥ 2 independent families) ANCHORS the quote; otherwise the curated band is the quote; survey/article/aggregator posteriors are context-only; the crude legacy min/max/p70 overlay is RETIRED (retained but unwired).

---

## 1. Supabase schema (Postgres, project `gbakzhibzotugfyktcrt`)

### 1.1 `rate_intelligence` — the observation spine

**Born** in `C:/Users/oclou/QueenClaude/medical-staffing/agent_tables_setup.sql:62-75` (not in `ias-dashboard/supabase/migrations` — the base DDL predates that repo's migration chain). Grown additively in four waves. Full column inventory:

| Column | Type | Added by | Notes |
|---|---|---|---|
| `id` | UUID PK | agent_tables_setup.sql:63 | `gen_random_uuid()` |
| `specialty` | TEXT NOT NULL | :64 | Producer-canonical name (see §3) |
| `rate_low`, `rate_high` | DECIMAL(10,2) | :65-66 | Observed band endpoints ($/hr). pg returns numerics as strings; bridge coerces (`bridge-rate-intelligence.ts:316-318`) |
| `source` | TEXT NOT NULL | :67 | e.g. `gasworks`, `bls`, scraper source ids |
| `source_url` | TEXT | :68 | |
| `state` | TEXT | :69 | 2-letter or NULL (NULL ⇒ "national") |
| `facility_type` | TEXT | :70 | |
| `date_scraped` | DATE NOT NULL DEFAULT CURRENT_DATE | :71 | The bridge's freshness axis. **There is NO `created_at` column** (verified empirically per a2 migration comment `20260521203841...sql:77-90`) |
| `confidence` | TEXT CHECK high/medium/low | :72-73 | Producer self-label |
| `validated` | BOOLEAN DEFAULT FALSE | :74 | |
| `value_type` | TEXT NOT NULL DEFAULT 'market' CHECK ('market','cap') | `ias-dashboard/migrations/2026-05-02-rate-intelligence-value-type-agent-id-and-bridge-runs.sql:11-13` | Discriminates pay observations from bill/ceiling rows |
| `agent_id` | TEXT NOT NULL DEFAULT 'unknown_legacy' | same file :23-24 | Writer identity; `unknown_legacy` = pre-May-2026 rows |
| `rate_type` | TEXT, named CHECK `rate_intelligence_rate_type_chk` | `supabase/migrations/20260521203841_evidence_canonicalization_a2.sql:449-458` | 6-value enum (see below); **7th value pending** (§1.6) |
| `source_legal_class` | TEXT CHECK 4 values | a2:460-467 | `public_seo_indexed` / `crowd_survey` / `trade_association_paid` / `community_forum` |
| `evidence_employment_arrangement` | TEXT CHECK 5 values | a2:469-477 | `locum_tenens` / `permanent` / `locums_to_perm` / `transition_mgmt` / `unknown` |
| `content_hash` | TEXT | a2:479-480 | Exact-dup key, computed at INSERT by `agent-sdk/shared/content_hash.py` — the bridge NEVER recomputes (`aggregateBridge.ts:219-232`) |
| `dedup_group_id` | TEXT | a2:482-483 | Near-dup group key (`agent-sdk/shared/dedup_group_id.py`) |
| `published_at` | DATE | a2:485-486 | Recency fallback when `date_scraped` unparseable (`aggregateBridge.ts:239-247`) |
| `cited_text`, `char_range_start`, `char_range_end`, `employment_evidence_span` | TEXT/INT/INT/TEXT | `20260602000000_rate_source_chunks_and_cited_columns.sql:201-211` | Observe-and-Cite verbatim span + offsets + locum-evidence span. Producer-populated; bridge read-path threading DEFERRED to Phase 8 (`aggregateBridge.ts:57-66`) |

**`rate_type` — the trust-class enum** (the single most load-bearing column). Values and their standing, per the bridge precedence map (`bridge-rate-intelligence.ts:77-90`) and reader mirror (`marketRates.ts` BUCKET_PRECEDENCE):

| rate_type | Precedence | Anchorable? | Meaning |
|---|---|---|---|
| `actual_paid_locum` | 4 | YES | Directly observed paid locum rate |
| `advertised_clinician_pay` | 3 | YES | Advertised pay on a posting |
| `crowd_survey` | 2 | no (context) | Self-reported survey |
| `scraped_article_estimate` | 1 | no (context) | Editorial prose estimate — also the conservative-truthful classifier fallback (`agent-sdk/shared/rate_type_classifier.py:17-20`) |
| `aggregator_estimate` | 0 | no (context) | Aggregator's self-labeled guess for a hidden-pay posting (LJO/TrackFive), WS1 2026-07-01 |
| `permanent_wage_proxy` | — absent | NEVER | W2 salary proxy (incl. all `bls_oews*` rows via classifier short-circuit, `rate_type_classifier.py:12-16`) — context only |
| `agency_bill_rate` | — absent | NEVER | Bill/ceiling class; excluded from the v2 market tree entirely (`bridge-rate-intelligence.ts:915-917`) |
| NULL → `null_unclassified` | — absent | NEVER | Unclassified evidence; never imputed |

**RLS posture**: `rate_intelligence` is **anon-readable** (`agent_tables_setup.sql:142` `public_read_rates USING (true)`), service-role write (:150). This is deliberate per D-28 (a2 migration comment :283-287) but is now the *outlier* — every newer relation is REVOKE-anon.

**Row counts (STATED, not re-verified)**: 55,375 pre-Phase-1 rows, of which ~29,640 have garbage specialties (a2 migration :43-44, :110-113); 55,764 rows snapshotted into `rate_intelligence_pre_a2_backup` (`.planning/.../02-01-SUMMARY.md:220`).

### 1.2 `canonical_rate_intelligence` — the quarantine view (the bridge's ONLY read source)

Defined at `20260521203841_evidence_canonicalization_a2.sql:709-716`:

```sql
CREATE OR REPLACE VIEW public.canonical_rate_intelligence
WITH (security_invoker = true) AS
SELECT * FROM public.rate_intelligence
 WHERE (date_scraped >= '2026-05-20'::date
        AND agent_id IN ('rate_scraper', 'rate_researcher'))
    OR (specialty IN (SELECT canonical_name FROM public.specialty_canonical_view)
        AND agent_id != 'unknown_legacy');
```

- Clause 1 admits every post-Phase-1 producer row unconditionally (Phase-1 deploy boundary 2026-05-20T13:26:06Z, truncated to date).
- Clause 2 salvages pre-Phase-1 rows that happen to carry a canonical specialty AND a real agent_id.
- `SELECT *` ⇒ new columns (cited_text etc.) auto-appear (asserted by `20260602000000...sql:103-105,213-215`).
- `security_invoker = true` is load-bearing (T-2-02 privilege-escalation mitigation, a2:687-707). Authenticated-only + REVOKE anon (a2:892-893); the EC2 bridge reads it via the postgres role (BYPASSRLS).
- Consumed at `bridge-rate-intelligence.ts:306-314`: `SELECT ... FROM canonical_rate_intelligence WHERE date_scraped >= (NOW() - INTERVAL '7 days')::date ORDER BY date_scraped ASC, id ASC` — the 7-day window mirrors the reader's staleness gate.

### 1.3 `specialty_canonical_view` — the 152-cell allowlist (a TABLE, despite the name)

- DDL + verbatim 152-row seed: a2 migration :502-665 (`canonical_name TEXT PRIMARY KEY`, alphabetical; from `anesthesiologist assistant` to `vascular surgery-integrated`).
- Source of the seed: `C:/Users/oclou/QueenClaude/agent-sdk/shared/specialty_canonical_list.json` (`metadata.cell_count_total = 152`). Tier structure (OBSERVED from the JSON): T1_n_ge_50 = 15, T2_n_20_to_49 = 16, T3_n_10_to_19 = 16, T4_long_tail = 47, APP_fan_out = 58 → 152 total; `alias_to_canonical` = 178 aliases; plus `manual_escalation_default`.
- ⚠ Checksum drift: the migration header (a2:39) pins the JSON at `sha256=4f0c1f92...`, but the current JSON's own metadata says `checksum_sha256: b97cdb1341937460...`, `built_at: 2026-07-02T02:58:27Z`, `built_from_audit_commit: 32e0b9fd`. Same count (152), but set-equality vs the live DB table needs the sync test (`tests/test_specialty_canonical_view_sync.py`, referenced a2:510) re-run against prod.
- RLS: REVOKE anon, GRANT authenticated + explicit `FOR SELECT TO authenticated USING(true)` policy (a2:840-853).
- Growth convention: additive sub-migrations `..._specialty_canonical_view_<reason>.sql` with `ON CONFLICT DO NOTHING` (a2:167-177).

### 1.4 `bridge_runs` — pipeline telemetry

Created `ias-dashboard/migrations/2026-05-02-...-and-bridge-runs.sql:29-44` (id, started_at, ended_at, status running/success/partial/error, rows_read, rows_written_market/cap, rows_quarantined, specialties_market/cap_count, errors_json JSONB, triggered_by). Extended:
- `2026-05-02-bridge-runs-add-ec2-cron-trigger.sql` — adds `ec2-cron` to the trigger CHECK (mirrored by `ALLOWED_TRIGGERS`, `bridge-rate-intelligence.ts:180-185`).
- a2 :733-761 — 10 columns: `rows_by_rate_type_{actual_paid_locum,advertised_clinician_pay,agency_bill_rate,permanent_wage_proxy,scraped_article_estimate,crowd_survey,null}`, `rows_state_specific`, `rows_state_national`, `canonical_view_active BOOLEAN DEFAULT NULL` (NULL = pre-Phase-2 row; true = canonical-view-aware run).
- `20260531011455_phase3_bridge_runs_counters.sql` — Phase-3 aggregation counters; the bridge probes for them at runtime (`phase3ColumnsExist`, `bridge-rate-intelligence.ts:413-419`) and degrades to the Phase-2 UPDATE shape when absent (the D-42 apply-before-deploy trap).
- Locked down by `20260513200000_secure_bridge_runs.sql`.

Every error row carries `errors_json.crash.stage` from a closed discriminator (`bridge-rate-intelligence.ts:150-174`).

### 1.5 Satellite tables (context, not quote-path)

| Table | Migration | Role |
|---|---|---|
| `rate_source_chunks` (chunk_id PK, url, source_id, fetched_at, text) | `20260602000000...sql:144-155` | Observe-and-Cite fetch-once-reuse-many store of raw page chunks; anon-DENY (raw scraped text; :176-190) |
| `external_specialty_surveys` | `20260507000000_external_specialty_surveys.sql:7+` | B.7.1 CRNA survey envelope (`aana_2025`, `ias_internal_2026`, `bls_oews_29_1151_2024`; `employment_arrangement` incl. `locum_1099`; census 9-division fallback). Feeds `crnaCellLookup.ts` BLS-anchored floor — **not wired into the hub sim** (`sim-live.ts:19-23` explicitly omits Supabase) |
| `gov_cms_pfs_gpci`, `gov_hrsa_shortage`, `gov_bea_rpp`, `gov_census_acs`, `gov_fred_ppi` | `20260602010000_gov_backbone_proxy_tables.sql:113-226` | Gov backbone proxies (geo cost/shortage indices) |
| `quote_events` / `quote_outcomes` | `20260604000000_quote_regret_telemetry.sql:123-165` | Append-only quote telemetry + 6-value outcome enum (`won/lost/pushed_back/walked/adjusted/abandoned`); RLS default-deny, service-role only (:179-186). The future ground-truth loop |
| `sisense_*` (bids, agreements, bid_rate_history, market_masked...) | `20260422173200_sisense_rs0.sql` | LocumSmart Sisense tap — the cap/bill-rate side; `sisense_rate_writer` is the sole cap-capable agent (`aggregateBridge.ts:215-217`) |
| `rate_audit_log` | `medical-staffing/agent_tables_setup.sql:85-95` | Simulated-vs-actual drift backtesting (simulator_output JSONB, actual_rate_cap, drift_pct) |

### 1.6 ⚠ Pending write-side migration (apply-before-fleet blocker)

`20260701000000_add_aggregator_estimate_rate_type.sql:26-38` re-creates `rate_intelligence_rate_type_chk` with the 7th value `aggregator_estimate`. Authored, **not yet applied to prod** (operator-OAuth step; per the file header :20-21 and WS1 memory). Because `insert_rate_intelligence` writes each run as ONE batch (`agent-sdk/core/supabase_client.py:77-86`), a single 23514 CHECK violation aborts the entire batch — total silent data loss for that run. Must be applied before flipping LJO/TrackFive sources to verified in the fleet.

---

## 2. The RTDB trees (Firebase `weekly-sync-451e2`)

### 2.1 Security rules — `C:/Users/oclou/QueenClaude/ias-dashboard/database.rules.json`

```
rate-simulator/
  feedback        .read: true   .write: true   (validate: hasChildren + specialty + timestamp)  ← WORLD-WRITABLE
  market-rates    .read: true   .write: false  (only firebase-admin bypasses)
  market-rates-v2 .read: true   .write: false
  cap-rates       .read: true   .write: false
locumsmart/
  jobs            .read: true   .write: only uid 29S9o8z4QOWtMMiRzOJGaeuIXBF2
```
(`database.rules.json:26-47`, `:5-10`). Note `source-reliability` has **no explicit rule** → inherits root `.read: false` — written by admin SDK, unreadable by the anon client (display consumer must be authed or it silently gets nothing).

### 2.2 `rate-simulator/market-rates/{safeSpecialty}` — LEGACY band (D-40 back-compat)

Shape = `MarketRateData` (`marketRates.ts:53-66`, ias-website copy): `{ min, max, p70?, sources: string[], lastUpdated: msEpoch, valueType?: 'market'|'cap' }`.
- Written every run per specialty (`bridge-rate-intelligence.ts:345-347`); `min`/`max` = raw extremes over the cell's distinct observations, `p70 = min + (max-min)*0.7` (`aggregateBridge.ts:723-746`) — a linear interpolation, NOT an observed percentile.
- Non-locum filter: proven-W2 rows (`rate_type='permanent_wage_proxy'` OR `evidence_employment_arrangement='permanent'`) are excluded from this band (`aggregateBridge.ts:711-715`); a specialty whose cell was ALL-permanent gets its node **null-cleared** (`bridge-rate-intelligence.ts:348-357`).
- Reader `loadMarketRates()` (`marketRates.ts:676-778`): 7-day staleness gate, cap-row skip, ≥2 non-empty sources (Fix A), family-based confidence (Fix B). **RETIRED from the live quote path** by Move #1 — `sim-live.ts` no longer calls it; the retired dashboard app is its remaining consumer.

### 2.3 `rate-simulator/market-rates-v2/{safeSpecialty}` — the versioned posterior tree (what the live hub actually reads)

Written as ONE whole-node replace per specialty per run (`bridge-rate-intelligence.ts:884-907`, `979-1050`):

```
rate-simulator/market-rates-v2/{firebaseSafeKey(specialty)} = {
  __meta__: { lastUpdated: msEpoch,
              primaryRateType: string|null,          // D-39 precedence pick
              coverageTier: 'primary'|'unclassified_only'|'insufficient_data' },
  {stateKey}: {                                       // 'national' today (100% of rows)
    buckets: {
      {rateTypeKey}: MarketBucketData                 // incl. 'null_unclassified'
    }
  }
}
```

`MarketBucketData` (`marketRates.ts:82-92`): `{ weighted_mean: number|null, weighted_variance: number|null, median, confidence: 'multi_source'|'single_source'|'zero_spread'|'manual_review_bimodal', n_distinct, n_raw, source_families: string[], family_capped: boolean, lastUpdated }`. `weighted_mean === null ⇔ manual_review_bimodal` — consumers must check confidence before using the mean.

Invariants (OBSERVED in write code):
- `agency_bill_rate` buckets are never persisted here (`V2_MARKET_TREE_EXCLUDED_RATE_TYPES`, `bridge-rate-intelligence.ts:915-917`).
- Sentinel literals: `state IS NULL → 'national'`, `rate_type IS NULL → 'null_unclassified'` (`aggregateBridge.ts:134-148`); RTDB-unsafe segments are skipped, never mangled (`bridge-rate-intelligence.ts:1011-1016`).
- A specialty fully absent from a run is left untouched (not deleted); the READER's ≤7-day `isFreshBucket` gate (`marketRates.ts:221-235`) is what prevents stale render.
- Empty-run guard: an empty `updates` map skips the write entirely so `{}` never clobbers the tree (`bridge-rate-intelligence.ts:372-378`).

Reader: `loadMarketBuckets()` (`marketRates.ts:317-375`) — national-preferred state ladder, m6 reader-strip (only renderable rate_types survive), D-39 `selectPrimary`, and honest coverage tiers. Anchor promotion: `applyMarketBucketsOverlay` (`marketRates.ts:469-551`) mutates `SPECIALTIES[key]` in place — `p70 = round(weighted_mean)`, band from frozen `STATIC_SPECIALTY_RANGES` (widened/geometry-rescaled only if the anchor ≥ curated max, preserving premium headroom — the premium-erasure fix, :524-540), `provenance='live'`, confidence ceiling `high` for market-typed / `medium` for everything else (:448-456).

### 2.4 Other RTDB paths

| Path | Shape | Writer / Reader |
|---|---|---|
| `rate-simulator/cap-rates/{safeSpecialty}` | `AggregatedRateData` with `valueType:'cap'` (from `sisense_rate_writer` rows) | Bridge writes (`bridge-rate-intelligence.ts:358-360`); **no reader exists** — `loadCapRates()` is a documented future (`marketRates.ts:696-705`). Dormant data |
| `rate-simulator/source-reliability/{family}` | `{ bootstrap_reliability, stability, cross_source_agreement: number|null, computed_at }` (`lib/sourceReliability.ts:83-93`) — keyed by corporate FAMILY, not brand (`bridge-rate-intelligence.ts:1150-1163`) | Bridge writes; display-only, explicitly NOT weight-bearing (D-38b) |
| `rate-simulator/feedback/{pushId}` | `CalibrationEntry` (`marketRates.ts:564-589`): specialty, state, rateMode?, simulatedRate, acceptedRate, accuracy, submittedBy, notes, timestamp, quoteCapBound? | ANY client may write (rules above); read by `loadSpecialtyCalibration` (`marketRates.ts:784+`) merged with localStorage, shape-guarded by `isCalibrationEntry`, legacy entries mode-classified by the $1000 magnitude floor (:598). STATED empty in prod as of 2026-06-30 (improvement-plan finding) — verify |
| `locumsmart/jobs/{id}` | `FirebaseJob` (`recentJobsBridge.ts:5-24`): requestNumber, specialty, facilityState, practiceSetting, callType, coverageType, scheduleDetails... | LocumSmart webhook/backfill writes (uid-gated); hub sim converts to `ParsedAssignment` via `buildParsedFromJob` (:30-49) to pre-fill the simulator from a real job |

### 2.5 Key codec

`firebaseSafeKey` / `firebaseUnsafeKey` (`firebaseKeyCodec.ts:28-35`): percent-encode `%` then `/` (RTDB path separator). 10 of the 88 engine keys need it (OBSERVED): `ob/gyn`, `hematology/oncology`, `allergy/immunology`, and the seven `np/pa (...)` keys → e.g. node `rate-simulator/market-rates-v2/ob%2Fgyn`. Encode-on-write in the bridge, decode-on-read in both readers.

---

## 3. The specialty / cell taxonomy — **two vocabularies, thinly bridged**

### 3.1 Producer taxonomy (write side): 152 canonical cells

- Source of truth: `agent-sdk/shared/specialty_canonical_list.json` (152 names in 5 tiers + 178 aliases), enforced at INSERT by `normalize_specialty_canonical()` (`agent-sdk/shared/specialty_canonical.py:75-119`) — returns a canonical name or None (row rejected), NEVER a raw string.
- Mirrored into Postgres as the `specialty_canonical_view` 152-row table (§1.3) so the canonical view can gate salvaged legacy rows.
- Names are long-form lowercase: `nurse anesthetist`, `internal medicine - cardiology`, `obstetrics and gynecology`, `surgery - general`, `orthopaedic surgery`…

### 3.2 Consumer taxonomy (quote side): 88 curated engine keys

- `specialties.ts` `_SPECIALTIES_RAW` — **88 keys** (OBSERVED by parse; gen-golden-master.ts:54 says "full 88+ table"). Short-form: `crna`, `cardiology`, `ob/gyn`, `general surgery`, `orthopedic surgery`…
- Confidence distribution (OBSERVED): 18 `medium`, 5 `low`, 65 default `modeled`; **zero static `high`** (the 2026-06-30 honesty downgrade — only live-corroborated posteriors may earn `high` at runtime).
- `p70 = Math.round(min + (max-min)*0.70)` computed at build (`specialties.ts:173-186`) — a fixed interpolation, not a fitted percentile.
- Frozen snapshots `STATIC_CONFIDENCE` + `STATIC_SPECIALTY_RANGES` (`specialties.ts:190-210`) guard against overlay ratchet.
- A separate alias map inside `specialties.ts` (~line 280+) serves free-text parsing (`fuzzyMatch.ts`), e.g. `'crna'` is itself a key, `'certified registered nurse anesthetist' → 'crna'` on the parse path.

### 3.3 Cell keys in flight

| Stage | Cell key | Where |
|---|---|---|
| Bridge legacy grouping | `${specialty}\|${value_type}` | `aggregateBridge.ts:843` |
| Bridge v2 buckets | `${specialty}\|${stateKey}\|${rateTypeKey}` (sentinels `national`, `null_unclassified`) | `aggregateBridge.ts:181-189` |
| aggregateCell cell_id (free-form) | e.g. `crna\|TX\|locum_1099`, `emergency medicine\|national\|advertised_clinician_pay` | `cellAggregation.ts:13-15,72` |
| RTDB node path | `market-rates-v2/{safeSpecialty}/{stateKey}/buckets/{rateType}` | §2.3 |

### 3.4 🔴 THE SEAM: only **19 of 152** producer names survive the bridge

- The bridge's allowlist is the ENGINE table: `knownSpecialties: new Set(Object.keys(SPECIALTIES))` (`bridge-rate-intelligence.ts:1477`), and any row whose `specialty` isn't in it is dropped as `unknownSpecialties` (`aggregateBridge.ts:833-840`) — surfaced in telemetry but **excluded from both the legacy band and the v2 buckets**.
- Measured intersection (OBSERVED, 2026-07-02, set-intersection of the two vocabularies): **19 names** — `anesthesiologist assistant, anesthesiology, dermatology, emergency medicine, family medicine, hospitalist, internal medicine, interventional cardiology, maternal-fetal medicine, medical genetics, neurology, ophthalmology, otolaryngology, pediatric hospitalist, pediatrics, plastic surgery, psychiatry, radiology, urology`.
- Concretely: the producer REWRITES `crna → nurse anesthetist` at INSERT (`specialty_canonical_list.json` alias map), and `nurse anesthetist` is NOT an engine key — so a freshly scraped CRNA observation can never reach the RTDB `crna` node through the current bridge. Same for `internal medicine - cardiology` (≠ `cardiology`), `obstetrics and gynecology` (≠ `ob/gyn`), `surgery - general` (≠ `general surgery`), `orthopaedic surgery` (≠ `orthopedic surgery`), all 58 APP_fan_out cells, etc.
- Impact on the north star: live-signal coverage is structurally capped at ~19/152 producer cells and ~19/88 quote cells until a canonical→engine mapping layer exists. Everything else quotes purely off the curated prior. (Historical RTDB nodes like `crna` came from pre-Phase-1 writers that used engine keys directly.) Verify against live `bridge_runs.errors_json`/unknown-specialty telemetry before building the fix.

---

## 4. Golden-master test files — the cross-repo math contract

| Artifact | Path | Facts (OBSERVED) |
|---|---|---|
| Canonical corpus | `C:/Users/oclou/QueenClaude/ias-dashboard/src/features/rate-simulator/engine/__tests__/goldenMaster.json` | `"version": 1`, `"generatedFrom": "ias-dashboard"`, **`"count": 207`**, 207 case objects |
| Vendored corpus | `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/rate-engine/__tests__/goldenMaster.json` | Same shape, 207 cases (currently modified in the worktree per git status) |
| Generator | `C:/Users/oclou/QueenClaude/ias-dashboard/scripts/rate-engine/gen-golden-master.ts` | Deterministic matrix: every SPECIALTIES key at p70 (:55-58), every shift/facility/duration/rural/holiday branch (:61-65), every STATE_MULT key + ''/null (:68-71), cap clamps + 1.75× ceiling stress (:74-81), call-only × day-type for 4 specialties (:84-89), 5 fixed parser strings (:92-98), fuzzy + codec cases. No wall-clock anywhere |
| Parity gate (hub) | `ias-website/.../src/lib/hub/rate-engine-parity.test.ts` | Recomputes every case through the vendored engine, `toEqual` (deliberately not `toStrictEqual` — JSON drops undefined keys, :16-20); floor assertion `>= 150` cases (:50) |
| Self-parity (canonical) | `ias-dashboard/.../engine/__tests__/goldenMaster.selfparity.test.ts` | Canonical repo re-checks itself |

**Scope caveat (important):** the golden master covers ONLY the pure Phase-1 surface — `calculateRate`, `calculateCallRate`, parser, fuzzy, codec (`rate-engine-parity.test.ts:10-14`). The live-data path (marketRates overlays, `aggregateCell`, CRNA envelope) is covered by separate gate-2 suites (`src/lib/hub/rate-engine-gate2-*.test.ts`, `src/lib/rate-engine/__tests__/marketBucketsOverlay.test.ts` — 22 cases) that are per-repo, not a shared frozen corpus. So overlay-logic drift between the two repos is NOT caught by the golden master.

Note: several memory/docs references say "208 golden-master parity"; both JSON files on disk say 207. Treat 207 as the observed number.

---

## 5. End-to-end data flow

```
[agent-sdk fleet, Docker/EC2]
 rate_scraper / rate_researcher / rate_observer
   ├─ normalize_specialty_canonical()  → 152-name vocabulary (reject non-canonical)
   ├─ classify_rate_type(source,url)   → 7-value enum + decision_path
   ├─ content_hash / dedup_group_id / state_attribution / published_at (shared/)
   └─ supabase.insert_rate_intelligence(batch)          core/supabase_client.py:77
        ▼
[Supabase gbakzhibzotugfyktcrt]
 rate_intelligence  ──(quarantine predicate)──▶  canonical_rate_intelligence (view)
        ▼  (daily 04:00 UTC EC2 cron, pg advisory lock 0x7261746573)
[bridge  ias-dashboard/scripts/data-refresh/bridge-rate-intelligence.ts]
 SELECT 7-day window → coerce numerics → aggregateBridge():
   validity guard → never-anchor source drop (ZipRecruiter/Adzuna, aggregateBridge.ts:800-813)
   → unknown-specialty gate (88 engine keys!) → group (specialty|value_type)
   → 2-stage dedup (content_hash exact, dedup_group_id near; evidence_weight=1.0/distinct)
   → family collapse + ≤60% family weight cap (D-37)
   → aggregateCell() MAD outlier rejection + inverse-variance weighting per (spec,state,rate_type)
   → legacy band (min/max/p70, non-locum filtered) + v2 bucket posteriors + reliability scores
 → ONE atomic firebase-admin update():
     market-rates/{spec} (+ null-clears) | cap-rates/{spec} | market-rates-v2/{spec} | source-reliability/{family}
 → close bridge_runs row (17-counter telemetry, stage-tagged errors)
        ▼
[Firebase RTDB weekly-sync-451e2, public-read]
        ▼  (browser, lazily-loaded client chunk)
[live hub  ias-website src/lib/hub/sim-live.ts]
 initLiveMarket(): configureEngine({db}) → loadMarketBucketRates()
   = loadMarketBuckets() (≤7d fresh, reader-strip, D-39 primary select)
   + applyMarketBucketsOverlay() (anchor iff market-typed ∧ n≥4 ∧ ≥2 families) — mutates SPECIALTIES in place
        ▼
 sim-adapter quote path → calculateRate()/calculateCallRate() off the (possibly anchored) band
   × STATE_MULT (BEA RPP + HRSA AHRF + demand class, stateData.ts:7) × shift/facility/duration/call/holiday
   → clamp 1.75× mult ceiling + researched-range max + optional HCO rate cap
 feedback: rate-simulator/feedback + localStorage → loadSpecialtyCalibration (±15% display calibration)
```

---

## 6. Seams & smells

1. **Taxonomy chasm (highest impact).** 152-name producer vocabulary vs 88-key engine table with a 19-name intersection; bridge drops the rest as `unknownSpecialties` (§3.4). All fresh live signal for CRNA, cardiology, OB/GYN, general surgery, ortho, and every APP cell is structurally discarded before RTDB. No mapping table exists anywhere in the three repos.
2. **Unapplied 7th-enum migration = batch-abort trap.** `20260701000000` authored but pending operator apply; one `aggregator_estimate` row 23514s the entire batch INSERT (§1.6).
3. **Percentile story is thin for the north star.** Nothing in any store holds a real distribution percentile: curated `p70` and legacy-band `p70` are both `min + 0.7*(max-min)` interpolations; v2 buckets store mean/variance/median only. "Where this sits in the market distribution" cannot currently be answered from stored data.
4. **`rate-simulator/feedback` is world-writable** (`database.rules.json:27-33`) with only shape validation — an unauthenticated poisoning vector into the ±15% display calibration. Mitigations are client-side only (`isCalibrationEntry`, magnitude classing, cap-suppression).
5. **Vendoring direction has inverted.** Every `src/lib/rate-engine/*.ts` header says "VENDORED — DO NOT EDIT. Canonical: ias-dashboard", but live fixes now land in ias-website first (worktree `marketRates.ts` = 1059 lines vs dashboard 1042) and are cherry-picked back. The parity gate covers only the pure surface (§4), so overlay drift is gated by convention, not CI. The stated portability plan (extract ONE headless core from ias-website) resolves this — until then this is the top drift risk.
6. **`rate_intelligence` is still anon-readable** (`public_read_rates`) while every sibling relation was REVOKE-anon'd — inconsistent posture; competitors can read the raw observation spine with the public anon key.
7. **Dormant / asymmetric nodes.** `cap-rates` is written but has no reader (`marketRates.ts:696-705`); `source-reliability` is written but unreadable by anon clients under current rules (§2.1) — both are silent shelf-ware until wired.
8. **Doc-vs-disk count drifts.** Golden master 207 on disk vs "208" in several memories/docs; canonical-list checksum `4f0c1f92…` (migration header) vs `b97cdb13…` (current JSON). Neither breaks anything today; both erode trust in written claims — re-pin.
9. **State dimension is 100% national.** The v2 tree materializes `{stateKey}` for forward-compat, but every bucket is `national` today (`bridge-rate-intelligence.ts:967-972`); all geographic pricing rides on the derived `STATE_MULT` formula (`stateData.ts:7` — clamp((COLI)^0.30 × (density)^0.30 × demand^0.40, 0.88, 1.38)), not observed state rates. Percentile/geo accuracy claims should be caveated accordingly.
10. **Three-repo sprawl for one data model.** Base DDL in `medical-staffing`, migrations split across `ias-dashboard/migrations/` (raw, un-timestamped) and `ias-dashboard/supabase/migrations/` (timestamped), taxonomy in `agent-sdk/shared/`, live consumer in `ias-website`. A schema change touches up to four checkouts; nothing enforces cross-repo consistency except convention and the sync tests that exist only for the canonical list and the engine parity.
