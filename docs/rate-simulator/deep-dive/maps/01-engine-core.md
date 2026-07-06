# Engine Core Map — how one quote is produced (`src/lib/rate-engine`)

> Deep-dive map 01. Scope: the CALCULATION engine of the LIVE rate simulator (imstaffing.ai/hub, served by this repo).
> All paths relative to `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/` unless noted.
> Every file in `src/lib/rate-engine/` carries a `⚠ VENDORED — DO NOT EDIT` header (canonical source: ias-dashboard `src/features/rate-simulator/engine/`; drift gated by `src/lib/hub/rate-engine-parity.test.ts`).

---

## 0. Topology (confirmed 2026-07-02)

- **Live engine**: `src/lib/rate-engine/` (25,332 lines across 23 .ts files; 18,955 of those are the `blsOewsBaseline.ts` data table).
- **Live adapter/orchestration**: `src/lib/hub/sim-adapter.ts` (quote shaping), `src/lib/hub/sim-live.ts` (Firebase overlay init), `src/components/hub/hub-client.ts` + `src/components/hub/SimulatorView.astro` (UI).
- `C:/Users/oclou/QueenClaude/ias-dashboard/src/features/rate-simulator/` is the **retired twin** (reference only). The **still-live data pipeline** writing the RTDB this engine reads is `C:/Users/oclou/QueenClaude/ias-dashboard/scripts/data-refresh/` (bridge) + `C:/Users/oclou/QueenClaude/agent-sdk/agents/rate_scraper/` (scraper).

---

## 1. End-to-end data flow for a single quote

```
                         ┌──────────────── ENTRY PATHS ────────────────┐
 (A) Manual controls      (B) LocumSmart PDF text        (C) Freetext ("CRNA nights in Houston, TX")
 SimControls              parseLocumsmartAssignment()     buildParsedFromFreetext()   [parser.ts]
 {specialty, region/      → ParsedAssignment              → ParsedAssignment
  state, shift, urgency,          │                               │
  weeks, margin}                  └────────── initFactors(parsed) ─┘   rateCalculator.ts:878
        │                                     (11 inference functions → RateFactors)
        │ factorsFromControls()  sim-adapter.ts:127
        ▼
   RateFactors  (types.ts:187 — specialty, state, rural, shift, facility, duration,
        │        call, holiday, rateCap, baseRate, callOnly, dayType, includedHours, callbackRate)
        │
        ├─ callOnly.isCallOnly = false → calculateRate(f)      rateCalculator.ts:656  (hourly $/hr)
        └─ callOnly.isCallOnly = true  → calculateCallRate(f)  rateCalculator.ts:766  (per-diem $/day)
        │
        ▼
   quoteFromFactors(factors, marginPct)   sim-adapter.ts:305
   → SimQuote {payRate, billRate, waterfall, marketMin/Max/Marker, percentiles, confidence…}
        │
        ▼
   hub-client.ts:248 update() → render()   (SSR first paint = quoteFromControls in SimulatorView.astro:38)

 ASYNC, once per session (client only):
   hub-client.ts:529 → import('sim-live') → initLiveMarket()   sim-live.ts:43
   → configureEngine({db: weekly-sync-451e2 RTDB})             runtime.ts:24
   → loadMarketBucketRates()                                   marketRates.ts:557
     → loadMarketBuckets()  reads RTDB `rate-simulator/market-rates-v2`   marketRates.ts:317
     → applyMarketBucketsOverlay()  MUTATES the SPECIALTIES singleton in place  marketRates.ts:469
   → re-quote (hub-client.ts:534) — same formula, now anchored on the live posterior where promoted.
```

Key fact: **the market overlay does not run inside `calculateRate`**. It mutates the shared `SPECIALTIES` table (`specialties.ts:188`) before/between quotes; `calculateRate` always reads whatever `SPECIALTIES[key]` currently holds. Bundler-dedup of `specialties.ts` into ONE module instance is a load-bearing invariant (documented sim-live.ts:12-17).

---

## 2. Inputs — the `RateFactors` record and where each field comes from

`RateFactors` (types.ts:187-202). Every factor carries a `source: 'pdf' | 'inferred' | 'default' | 'manual' | 'typed'` provenance tag that feeds confidence scoring.

| Factor | Manual path (sim-adapter.ts:127 `factorsFromControls`) | Parsed path (rateCalculator.ts:878 `initFactors`) |
|---|---|---|
| `specialty.key` | control value (must exist in SPECIALTIES, else throw sim-adapter.ts:129) | `mapSpecialty` (rateCalculator.ts:77: exact key → alias → word-boundary short-alias → substring scan; **falls back to `internal medicine` w/ source 'default'**) then `refineSpecialtyFromContext` (rateCalculator.ts:105: IM/FM+ICU→critical care, IM+inpatient→hospitalist, EM+nights→em nocturnist, etc.) |
| `state.code` | region → representative state (sim-adapter.ts:96 `geoStateCode`; National → `null`) | `inferStateEnhanced` (rateCalculator.ts:137: facility state → airport "…, ST" → license field → `(ST)` paren → "City, ST" regex → state-name scan; else `null`) |
| `rural.isRural` | `false` (hard-coded) | `inferRural` (rateCalculator.ts:165) — **display-only; multiplier neutralized** (see §5) |
| `shift.key` | control (validated against SHIFT_MULT, else 'day') | `inferShiftEnhanced` (rateCalculator.ts:213: 24hr→night, weekend+night, holiday(s), night, weekend, day) |
| `facility.key` | **`'community'` hard-coded** — the manual hub UI has no facility control | `inferFacilityTypeEnhanced` (rateCalculator.ts:239: academic → asc → freestanding_ed → cah → va → correctional → fqhc → psych → telehealth → rural_trauma → outpatient → bed-count (≤25→cah, >25→community) → community) |
| `duration.key` | `durationKey(urgency, weeks)` (sim-adapter.ts:104: Emergent→emergency, Priority→short, ≥26wk→long, ≤6wk→short, else standard) | `inferDuration` (rateCalculator.ts:302: end−start days ≤7→emergency, ≤28→short, ≤56→standard, else long; ASAP→emergency; ongoing/TBD→long) |
| `call.hasCall` | **`false` hard-coded** — no call toggle in manual hub UI | `hasCall` (rateCalculator.ts:323: "Call Type" section, else on-call/pager/beeper regex) |
| `holiday.hasHoliday` | `false` hard-coded | `hasHoliday` (rateCalculator.ts:360: Holiday Coverage / Allowed Holidays / Holidays sections with worked-vs-allowed split; inference fallback with named-holiday+verb pairing) |
| `rateCap` | `{cap: null}` | `extractBillRateCap` (rateCalculator.ts:504: "rate cap"/"NTE"/"max rate"/"capped at" patterns + unit hint hour/day/shift/unknown) |
| `baseRate` | `spec.p70` | `spec.p70` |
| `callOnly.isCallOnly` | `false` | `detectCallOnly` (rateCalculator.ts:572: explicit "Call Only" section → coverage-type → beeper/home-call w/o clinical hours → "call only" text → 24hr-call w/o clinical duties) |
| `dayType.key` | `'weekday'` | `inferDayType` (rateCalculator.ts:444) — **only consulted on the call-only path** |
| `includedHours` / `callbackRate` | 0 / 0 | `detectIncludedHours` (rateCalculator.ts:606) or band `gratisHrs`; callback = researched band midpoint (rateCalculator.ts:887) |

**Request-type** maps onto two axes: `callOnly.isCallOnly` (hourly vs per-diem engine) and `shift.key`/`dayType.key` (which premium/band applies).

---

## 3. Base-rate table — `SPECIALTIES` (specialties.ts)

- **88 specialty keys** in `_SPECIALTIES_RAW` (specialties.ts:56-166), each `{min, max, category, confidence?}` in **hourly locum PAY dollars** ("2025-2026 Locum Tenens Market Data"; header cites LocumStory 2025 (CHG), OnCall Solutions 2024, TheLocumGuy, ResidencyAdvisor 2025, FastRVU 2026, cross-referenced per RATE_RESEARCH.md — specialties.ts:3-5). These are CURATED/ESTIMATED analyst bands, **not observed paid rates** (explicit in the `Provenance` docstring, specialties.ts:20-36).
- `p70 = round(min + (max − min) × 0.70)` computed at build (specialties.ts:179). p70 is the quote base.
- Examples (READ from specialties.ts:58-165 — curated, confidence as tagged): anesthesiology 300–400 (medium), CRNA 190–250 (medium), emergency medicine 200–300 (medium), hospitalist 145–240 (medium), neurosurgery 330–480 (modeled — no confidence tag), radiology 185–330 (medium), psychiatry 180–255 (medium), np/pa (primary care) 70–95 (modeled).
- **Confidence tiers** (specialties.ts:18): `high | medium | low | modeled`. As of the 2026-06-30 honesty downgrade, **no static entry is tagged 'high'** — grep confirms zero `confidence: 'high'` in `_SPECIALTIES_RAW`; 'high' can only be earned at runtime by the market-typed overlay (marketRates.ts:448-456). `modeled` renders as "research-derived" (specialties.ts:231-236).
- `STATIC_CONFIDENCE` (specialties.ts:195) and deep-frozen `STATIC_SPECIALTY_RANGES` (specialties.ts:219) snapshot the curated values at module load so runtime overlays can never ratchet or corrupt the baseline.
- ~140 `SPECIALTY_ALIASES` (specialties.ts:243-381), incl. the FACTOR-04 neurosurgery guard ("neurological surgery" must not resolve to neurology, specialties.ts:269-279).

---

## 4. Multipliers

### 4a. Geography — `STATE_MULT` (stateData.ts, derived at module load)

Formula (stateData.ts:149-173, `deriveStateMultipliers`):

```
STATE_MULT[st] = round2( clamp( (100 / COLI_st)^0.30 × (304 / density_st)^0.30 × demandWeight_st^0.40 , 0.88, 1.38 ) )
```

- `STATE_COLI` = BEA Regional Price Parities 2024, US avg = 100 (stateData.ts:28-43; source bea.gov SARPP).
- `STATE_PHYS_DENSITY` = HRSA AHRF 2024-25 physicians per 100K (ACS 5-yr PUMS methodology, stateData.ts:45-83); `NATIONAL_AVG_DENSITY = 304` (population-weighted, stateData.ts:92).
- `STATE_DEMAND_CLASS` (stateData.ts:100-110) → `DEMAND_WEIGHTS` (stateData.ts:112-118): critical 1.30, high 1.15, moderate 1.05, adequate 0.95, surplus 0.90. This 0.40-weight demand class is itself an ANALYST CLASSIFICATION ("derived from HRSA HPSA designations, rural hospital density, physician age demographics" — stateData.ts:94-97; no per-state citation).
- Hub region buttons map to the state whose multiplier is closest to the region mean (`representativeState`, sim-adapter.ts:75-81); an exact PDF state always overrides (sim-adapter.ts:96-99). National = no geo (mult 1.0).

### 4b. Shift / Facility / Duration — `multipliers.ts` (all values below READ from multipliers.ts:13-44)

| SHIFT_MULT | | FACILITY_MULT | | DURATION_MULT | |
|---|---|---|---|---|---|
| day | 1.00 | academic | 0.85 | emergency | 1.20 |
| night | 1.20 | community | 1.00 | short (1-4wk) | 1.10 |
| weekend_day | 1.15 | asc | 0.90 | standard (4-8wk) | 1.00 |
| weekend_night | 1.30 | outpatient | 0.90 | long (3mo+) | 0.95 |
| holiday | 1.35 | cah | 1.22 | | |
| | | va | 0.85 | | |
| | | correctional | 0.92 | | |
| | | fqhc | 0.88 | | |
| | | psych | 1.12 | | |
| | | rural_trauma | 1.30 | | |
| | | freestanding_ed | 1.08 | | |
| | | telehealth | 0.75 | | |

Provenance is **comment-level only** ("Night: +10-25% (nocturnist hospitalists $179-200 vs $140-160 day)… CompHealth/Weatherby", multipliers.ts:11-12, 21-22, 38) — no per-value citation. ESTIMATED, medium-at-best confidence.

### 4c. Conditional multipliers (rateCalculator.ts:673-675)

- `callMult = 1.10` iff `f.call.hasCall` — flat +10%, **no cited source in code**.
- `holidayMult = 1.10` iff `f.holiday.hasHoliday` AND `f.shift.key !== 'holiday'` (anti-double-count with the 1.35 holiday shift).
- `ruralMult = 1.0` **always** (rateCalculator.ts:669): the old +20% rural premium was removed 2026-06-01 because STATE_MULT already prices rural scarcity (density + demand terms) — the comment documents the CRNA Kokomo IN over-quote ($309 vs researched max $250) that motivated it. Rural remains a display/confidence factor only.

---

## 5. Hourly formula — `calculateRate` (rateCalculator.ts:656-726), with every bound

```
base         = f.baseRate || spec.p70                       // both entry paths set baseRate = spec.p70
combinedMult = geoMult × 1.0(rural) × shiftMult × facilityMult × durationMult × callMult × holidayMult
cappedMult   = min(combinedMult, 1.75)                      // CLAMP 1 (rateCalculator.ts:679)
payRate      = base × cappedMult
payRate      = min(payRate, f.rateCap.cap × 0.80)           // CLAMP 2 — PDF bill-rate cap, only if unit ∈ {hour, unknown} (ts:689-692)
payRate      = min(payRate, spec.max)                       // CLAMP 3 — researched-range ceiling (ts:704-707) → marketMaxApplied
payRate      = Math.round(payRate)
billRate     = roundUp5(payRate / 0.80)                     // engine invariant: 20% margin, rounded UP to $5 (ts:716, roundUp5 ts:46)
```

Complete inventory of places a number is bounded/adjusted on the hourly path:

1. **Geo clamp [0.88, 1.38]** — baked into `STATE_MULT` derivation (stateData.ts:170).
2. **Combined-multiplier ceiling 1.75×** (rateCalculator.ts:679). Hardcoded literal, duplicated on the call-only path (ts:781).
3. **PDF rate-cap × 0.80** (ts:689-692) — applies only for `hour`/`unknown` units; `day`/`shift` caps on hourly = parse mismatch, dropped with `hasWarning`. The 0.80 encodes the assumed 20% margin between bill cap and pay.
4. **Researched-range ceiling `spec.max`** (ts:704-707) — the quote can never exceed the specialty's current band max (curated, or overlay-adjusted per §7). Flagged `marketMaxApplied`, deliberately separate from `capped` so it doesn't suppress feedback calibration (comment ts:693-703).
5. **Rounding** — pay `Math.round`; bill `roundUp5` (always up).
6. Downstream (hub): margin slider clamp 0–95% in `bill()` (sim-adapter.ts:298-301), 15–45% in `billAtMargin` (sim-adapter.ts:409). Hub bill = `roundUp5(pay/(1−m))`, default margin 22% (sim-adapter.ts:49); the engine's own `billRate` field (fixed 20%) is superseded by the hub's slider for the hourly display.
7. **Dormant clamps** (exported, NOT wired in the live hub — see §9): feedback calibration `adjustment` clamp [0.85, 1.15] + 50% dampening + n≥3 gate (marketRates.ts:849-854), and `computeDisplayedRate`'s cap/market-max re-clamps (marketRates.ts:934-985).

The waterfall shown in the UI (`hourlyWaterfall`, sim-adapter.ts:283-296) is the running product base → geo → rural → shift → facility → duration → call → holiday, with mult==1.0 rows hidden. Note the waterfall's last row is `r.payRate`, so clamps 2-3 silently compress the "Holiday" step.

**Market-position bar**: `computeAdjustedSpecRange` (rateCalculator.ts:747-753) now returns the UNSCALED `[spec.min, spec.max]`; the marker is the clamped payRate. Displayed percentiles (sim-adapter.ts:254, 372) are `[25, 50, 70, 75, 90]` computed by **linear interpolation across [min, max]** — a uniform-distribution assumption, not an observed distribution. Same for `getPercentileRate` (rateCalculator.ts:50-53). This is the engine's only "percentile" concept: ESTIMATED shape, not data-derived.

---

## 6. Call-only / per-diem path — `calculateCallRate` (rateCalculator.ts:766-875) + `callRates.ts`

Data: `CALL_RATE_DATA` (callRates.ts:34-353) — **38 specialty entries; only 19 carry at least one quotable daily band**; 3 more (crna, psychiatry, neonatology) carry `adjacentHourly` context only; the other 50 of 88 specialties fall to an all-null `getCallRateEntry` fallback (callRates.ts:361-376). Bands are `{min, max, typical, compModel: '24hr-beeper-call'|'worked-day-clinic', coverageHrs}` cited to `docs/rate-simulator/call-rate-research-2026-06-03-deep-research.pdf` (28 sources; FACTOR-05 cite-or-suppress). Examples READ from the table: neurosurgery beeper 4,200–4,800/day typical 4,500 (Lancesoft OH + Ascend AR postings, callRates.ts:73-82); anesthesiology worked-day 2,675–3,900 typical 3,300 over 12h (callRates.ts:137-145); urology beeper weekday 2,500–3,500 typical 3,150 (callRates.ts:277-286).

Formula (ts:790-798):

```
band     = entry[dayType]                      // weekday | weekend | holiday
combined = geoMult × 1.0 × facilityMult × durationMult    // NO shift/call/holiday mults — baked into the band
capped   = min(combined, 1.75)
pay      = band.typical × capped
pay      = min(pay, band.max)                  // CLAMP: researched daily ceiling → marketMaxApplied
pay      = min(pay, rateCap.cap × 0.80)        // only day/shift units (getCallOnlyPayCap ts:555-561); hour/unknown dropped
band == null → insufficientData: pay = 0, NO fabricated daily (ts:790-791, 805)
```

- **Every `holiday` band in the table is `null`** → any call-only assignment resolved to a holiday dayType is always `insufficientData` (honest zero, no quote).
- Callback differential = researched band midpoint, **deliberately NOT geo-scaled** (cited flat contract rate, ts:825-834).
- Hero $/hr in the hub = `dailyPay / coverageHrs` (sim-adapter.ts:315-316) — 24 for beeper, shift length for worked-day (the honest divisor, types.ts:344-349).
- Call-only bill = fixed `roundUp5(pay/0.80)` (20%), NOT the margin slider (sim-adapter.ts:317-321).

---

## 7. Market overlay — the Move #1 trust ladder (marketRates.ts)

**Live wiring** (sim-live.ts:43-50): `initLiveMarket()` → `loadMarketBucketRates()` is the SOLE overlay. The crude legacy `loadMarketRates()` (marketRates.ts:676-778, min/max/p70 straight overwrite with ≥2-source + 7-day gates) is **RETIRED/unwired** — kept for tests and the (dead) dashboard.

### 7a. Read — `loadMarketBuckets` (marketRates.ts:317-375)

Reads RTDB `rate-simulator/market-rates-v2` (written by the ias-dashboard bridge's `aggregateCell` MAD+IVW posterior). Per specialty cell:

- Prefer the `national` state cell, else first real state cell (`readCellBuckets`, ts:279-309).
- **Reader-strip**: only rate types in `RENDERABLE_RATE_TYPES` survive — `agency_bill_rate` and unknown types can never reach a consumer (ts:144-148, 303-308).
- **Renderability** (`isRenderableBucket`, ts:220-230): finite `weighted_mean`, integer-positive `n_distinct`, valid confidence enum, AND `lastUpdated` ≤ **7 days** (`RATE_READ_WINDOW_MS`, ts:136).
- **Primary selection** by D-39 precedence (ts:119-124): `actual_paid_locum` (4) > `advertised_clinician_pay` (3) > `crowd_survey` (2) > `scraped_article_estimate` (1). `permanent_wage_proxy` / `null_unclassified` are context rungs, never primary.
- Coverage tier: `primary` | `unclassified_only` | `insufficient_data` (ts:351-365). Any fetch error → `{fellBackToLegacy: true}` with zero mutations (curated bands keep serving).

### 7b. Apply — `applyMarketBucketsOverlay` (marketRates.ts:469-551)

A cell's posterior ANCHORS the quote only when ALL gates pass:

1. rate type ∈ `DEFAULT_ANCHORABLE_RATE_TYPES` = {actual_paid_locum, advertised_clinician_pay} (ts:419-422) — surveys/articles are priors-only, never anchor;
2. `weighted_mean` finite and > 0 (bimodal `null` mean never anchors, ts:491);
3. `n_distinct` is a positive INTEGER ≥ 4 (robust-spread floor, Rousseeuw & Verboven 2002, ts:498);
4. ≥ 2 DISTINCT source families after trim+lowercase normalization (whitespace-faking guard, ts:505-512).

On promotion (ts:514-547):

```
anchor   = round(weighted_mean)
spec.p70 = anchor
spec.min = min(STATIC min, anchor)
spec.max = anchor < STATIC max ? STATIC max                                  // anchor inside researched band
           : round(anchor × STATIC_max / STATIC_p70)                         // hot market: rescale band GEOMETRY
spec.provenance = 'live';  spec.confidence = 'high' (market-typed) / 'medium' cap (indirect)
```

The hot-anchor rescale (ts:538-540) is the 2026-07-02 premium-erasure fix (`6d9edb1`): without it, anchor ≥ max collapsed max onto p70 and clamp 3 (§5) flattened every shift/geo/facility premium back to the anchor. Because the overlay rewrites `spec.max`, it **directly moves the researched-range ceiling** that bounds every subsequent quote.

---

## 8. Confidence & the displayed quality signals

- **Identification confidence** `scoreConfidence` (rateCalculator.ts:621-640): `High` = specialty AND state non-default; `Medium` = specialty known; `Low` = specialty fell to default. (Note: the `supporting >= 2` branch at ts:636 is dead code — both Medium branches return 'Medium'.)
- **Data-tier confidence** = `spec.confidence` (curated tier, or overlay-earned 'high').
- Hub displays `weakerConfidence(identification, dataTier)` (sim-adapter.ts:263-270) plus an honest limiting-factor sentence (`confidenceReasonFor`, ts:272-278). Since no static band is 'high', a manual quote can read at most **Medium** until a live market-typed posterior promotes the cell.
- Provenance chip: `curated` vs `live` (specialties.ts:36).

---

## 9. Dormant layers (exported by the engine, NOT called anywhere in the live hub quote path)

Verified by grep: no call sites in `src/` outside the engine itself and tests.

| Layer | Entry | What it would do | Status |
|---|---|---|---|
| BLS OEWS sanity check | `evaluateBlsSanityCheck` (blsSanityCheck.ts:373) | expected $/hr = BLS May-2024 state median (SOC via 88-key `SPECIALTY_TO_SOC`, ts:101-203) × `LOCUM_MULTIPLIER` per 15 SOC families (1.35–3.50, ts:73-89 — "observation-derived midpoints, NOT primary-source-cited"); verdict aligned/soft/hard on ±25/±40% (band-aware widening via p25/p75; mean-fallback cap 1.5×; ts:207-210, 545-570) | Exported in Phase-1 barrel (index.ts:27); **unwired in hub** — was the dashboard MarketContext chip |
| CRNA envelope | `getCrnaCellEnvelope` dispatch inside the sanity check (blsSanityCheck.ts:376-381) + `MAX_HOURLY_CEILING = {crna: 250}` hard verdict (ts:220-224) | Supabase-backed BLS-spine × empirical-IAS CRNA envelope, UHC −15% cut | Unwired in hub (Supabase deliberately not injected, sim-live.ts:19-23) |
| Feedback calibration | `loadSpecialtyCalibration` / `computeDisplayedRate` (marketRates.ts:784, 934) | last-10 accepted-vs-simulated ratio, 50% dampened, clamp [0.85, 1.15], n≥3 gate; margin-leak guard drops positive calibration at cap | Unwired in hub; RTDB `feedback` path is the read source. Wiring it is improvement-plan Move #4 |
| Observed cap profiles | `observedHcoProfile` / `observedSpecialtyProfile` (liveCalibration.ts:180, 214) | median/p25/p75 of LocumSmart `rateRequirements.max*` — **bid CEILINGS, not market rates** (header warning ts:9-14), n≥5 gate | Unwired in hub quote path |
| GSA per-diem | `lookupGsa` (rateCalculator.ts:643) + `GSA_OVERRIDES` FY2026 table (callRates.ts:378-404) | travel stipend context (lodging+M&IE) | Not part of the quote; dashboard display only |

---

## 10. Seams & smells

1. **Vendored-copy discipline is the #1 structural risk.** 18 engine files are locally modified in this worktree (git status) while the DO-NOT-EDIT header says canonical = ias-dashboard. The parity test + `scripts/sync-rate-engine.mjs` gate drift, but the "canonical" repo's app surface is dead — the vendor arrow now points from a retired app to the live one. Portability work should invert this: make ONE headless core canonical here.
2. **Percentiles are fabricated-shape.** All displayed percentiles (and `getPercentileRate`) linearly interpolate min→max (sim-adapter.ts:372; rateCalculator.ts:50-53). Against the north star ("where the rate sits in the market distribution"), there is **no real distribution anywhere in the quote path** — the v2 posterior has `weighted_variance` but the overlay deliberately discards it (marketRates.ts:406-411, Moves #2/#3 pending).
3. **Global mutable singleton as the overlay mechanism.** `applyMarketBucketsOverlay` mutates `SPECIALTIES` in place; correctness depends on Vite never splitting `specialties.ts` into two instances (sim-live.ts:12-17). A headless-core extraction should make the overlay a pure function of (static table, posterior) → quoted table.
4. **Manual hub UI can't express real comp factors.** `factorsFromControls` hard-codes facility='community', call=false, holiday-worked=false (sim-adapter.ts:139-142) — CAH (+22%), rural trauma (+30%), call (+10%) etc. are reachable only via PDF/freetext parse. For recruiters pricing real placements, that's a coverage defect, not a UI nicety.
5. **Uncited conditional multipliers.** `callMult = 1.10` (rateCalculator.ts:673) and `holidayMult = 1.10` (ts:675) have no source comment at all; SHIFT/FACILITY/DURATION values have only aggregate comment-level citations. UNVERIFIED — needs sources.
6. **Magic 1.75 ceiling duplicated** in `calculateRate` (ts:679) and `calculateCallRate` (ts:781); deliberately not exported (types.ts:306-310 says "read cappedMult, don't recompute") but still two literals to keep in sync. Also note 1.38(geo) × 1.35(holiday) × 1.22(CAH) ≈ 2.27 means the 1.75 cap binds frequently on stacked-premium quotes — premium compression is silent except for the `capped` flag.
7. **The 0.80 margin constant is scattered**: engine `billRate` (ts:716), rate-cap pay conversion (ts:691, 558), call-only bill (sim-adapter.ts:321) all assume 20%, while the hub hourly bill uses the 15–45% slider — two margin regimes in one panel.
8. **Dead code / dormant honesty layers**: `scoreConfidence`'s `supporting>=2` branch is unreachable (rateCalculator.ts:636-637); the entire BLS sanity + calibration + observed-caps stack (§9) is built, tested, and unused in the live surface — accuracy machinery that exists but doesn't protect the live quote.
9. **Call-only coverage gap**: 19/88 specialties have a quotable daily band; all holiday bands null; weekend bands exist for only 10. Honest (insufficientData) but a large blind spot for a call-heavy locum book.
10. **Confidence semantics straddle two scales**: engine `ConfidenceLevel` ('High/Medium/Low', identification) vs specialty `Confidence` ('high/medium/low/modeled', data tier), blended only in the hub adapter. Any new consumer (Discord/Slack/API port) must re-implement the blend or silently overclaim.
11. **Region approximation**: hub region buttons quote the representative state's multiplier (sim-adapter.ts:75-81) — honest per-state value, but a "West" quote is really "whichever western state is nearest the mean" and the user is not told which.
12. **`inferDayType` default 'weekday'** on the call-only path means an unparsed weekend beeper request quotes the (usually cheaper) weekday band silently.

---

## 11. OBSERVED vs ESTIMATED ledger (what class of number each stage is)

| Number | Class | Confidence |
|---|---|---|
| `SPECIALTIES` min/max/p70 (curated) | ESTIMATED — analyst-curated from self-published industry sources | medium/low/modeled per tag; none high |
| STATE_MULT inputs (COLI, density) | OBSERVED (BEA 2024, HRSA AHRF 2024-25) | high for the inputs |
| STATE_MULT formula weights (0.30/0.30/0.40), demand classes, clamp 0.88–1.38 | ESTIMATED — analyst-set | low; unvalidated |
| SHIFT/FACILITY/DURATION/call/holiday multipliers | ESTIMATED — comment-cited ranges only | low-medium |
| CALL_RATE_DATA bands | OBSERVED (cited public postings, per-entry notes) but thin (1–5 sources/entry) | per-entry |
| market-rates-v2 posteriors (when promoted) | OBSERVED (post-dedup, family-capped scrape/paid data; ≥4 obs, ≥2 families) | 'high' by definition of the gate |
| Displayed percentiles | ESTIMATED — linear interpolation, no distribution | low |
| BLS baselines (dormant) | OBSERVED (BLS OEWS May 2024) × ESTIMATED locum multipliers | mixed |

---

## Appendix — file inventory (src/lib/rate-engine/, lines)

| File | Lines | Role |
|---|---|---|
| rateCalculator.ts | 909 | inference + hourly/call-only calculation (the formula) |
| marketRates.ts | 1059 | v2 posterior reader + trust-ladder overlay; retired legacy overlay; calibration (dormant) |
| specialties.ts | 381 | 88-key curated band table + aliases + frozen snapshots |
| stateData.ts | 176 | geo multiplier derivation (BEA/HRSA/demand) |
| multipliers.ts | 44 | shift/facility/duration tables |
| callRates.ts | 414 | 38-entry call/per-diem band table + GSA FY2026 |
| blsSanityCheck.ts | 584 | BLS sanity verdict engine (dormant in hub) |
| blsOewsBaseline.ts | 18,955 | BLS OEWS May-2024 state×SOC wage data |
| crnaCellLookup.ts / crnaAggregation.ts | 686 / 15 | Supabase CRNA envelope (dormant in hub) |
| cellAggregation.ts | 411 | MAD+IVW cell math (consumed by bridge-side aggregation logic) |
| types.ts | 453 | factor/result shapes |
| parser.ts | 403 | PDF/freetext → ParsedAssignment |
| fuzzyMatch.ts / sourceFamily.ts / firebaseKeyCodec.ts / liveCalibration.ts / recentJobsBridge.ts / runtime.ts | 138/212/35/244/49/43 | support: fuzzy input, corporate-family collapse, RTDB key codec, cap profiles, job bridge, DI seam |
| index.ts / index.phase2.ts | 54 / 17 | Phase-1 (pure) vs Phase-2 (Firebase/Supabase) barrels |

Hub layer: `src/lib/hub/sim-adapter.ts` (479), `sim-live.ts` (56), `src/components/hub/hub-client.ts` (quote render §1), `SimulatorView.astro` (SSR first paint).
