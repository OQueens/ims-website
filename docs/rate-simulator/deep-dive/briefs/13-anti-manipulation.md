# Brief 13 — Anti-Manipulation Threat Model & Defenses (North-Star Pillar)

> Deep-dive brief, 2026-07-03. Scope: every way the LIVE rate simulator's quote
> (imstaffing.ai/hub, served by `ias-website` `src/lib/rate-engine` + `src/lib/hub`)
> could be manipulated, drifted, or poisoned — planted sources, template inflation,
> aggregator fake-independence, W2-proxy leak, stale/echo data, single-source promotion,
> selection bias, agency self-inflation — mapped 1:1 to the REAL guard that defends it
> (cited file:line) and the residual GAP + a concrete hardening.
>
> Read alongside map 03 (`maps/03-market-posterior-bridge.md`), map 04
> (`maps/04-scraper-pipeline.md`), map 01 (`maps/01-engine-core.md`), map 05
> (`maps/05-comp-factors-today.md`). Every `$` figure and corporate/behavioral claim
> asserted here is listed in the fact-checker queue at the end.
>
> Paths absolute-relative to `C:/Users/oclou/QueenClaude/`. `WEB` = ias-website worktree
> `ias-website/.worktrees/feat-ims-phase-1-plan`, `DASH` = `ias-dashboard`, `SDK` = `agent-sdk`.

---

## Summary

The engine is unusually well-armed against fabricated data: the whole pipeline is
organized around ONE decision — may a scraped posterior **anchor a real quote** (override
the curated band)? — and that decision is gated by `market-typed rate_type ∧ n_distinct ≥ 4
∧ ≥ 2 independent corporate families` (`WEB/src/lib/rate-engine/marketRates.ts:469-551`).
Ten distinct, individually-cited guards sit in front of that gate: canonical-view agent
allowlist, IronDome plausibility bands, `content_ok` challenge-page guard, unit gates,
two-stage dedup, aggregator family-recovery, never-anchor exclusion, family collapse-then-cap,
non-locum filter, and the reader-side freshness/strip/anchor stack. The design idiom is
**exclusion-by-absence** (a distrusted class is never admitted to the voting set, so the
posterior math never has to "know" about it — `sourceFamily.ts:105-121`, `aggregateBridge.ts:810-813`).

The threat model nonetheless has **12 real gaps**, ranked by leverage:

1. **The RTDB trust boundary is credential-strength, not logic-strength.** I verified the
   rules (`DASH/database.rules.json`): `market-rates-v2` / `market-rates` / `cap-rates` are
   `.read:true, .write:false` unconditionally (rules :35-46; asserted in
   `DASH/__tests__/database.rules.rate-simulator.test.ts:79-91`). Good — the forged-node
   attack the map flagged as "UNVERIFIED, highest leverage" (map 03 §S5) is **defended at
   the rule layer**. BUT (a) `rate-simulator/feedback` is `.read:true, .write:true` with a
   validate that only requires `specialty`+`timestamp` children (rules :27-34) — a
   **publicly writable** subtree, and (b) whoever holds the bridge's firebase-admin
   credential (EC2) or the scraper's `SUPABASE_SERVICE_ROLE_KEY` (`SDK/core/supabase_client.py:25`)
   can write anything, bypassing every logic guard. Manipulation resistance ≈ credential hygiene.
2. **`advertised_clinician_pay` is anchorable and reads 'high'** — advertised is not paid.
3. **Two colluding/parallel agencies both inflating advertised pay clear the ≥2-family gate.**
4. The independence registry lives in **3 language copies** that must agree token-for-token.
5. **Selection bias is entirely unmodeled** — the pipeline trusts whatever the fleet fetched.
6. Single-statement batch insert = **one poisoned row silently reverts a whole specialty** to curated (a cheap denial-of-accuracy).
7. The 7-day cliff **silently reverts** promoted cells with no operator alarm.
8. `n_distinct ≥ 4` is a **thin** corroboration bar for a live quote anchor.
9. National-only cells → **geo is unobserved** (multiplier-manipulation surface).
10. The dormant **feedback-calibration** path (Move #4) would consume the publicly-writable feedback tree.
11. IronDome bands are **hand-tuned, uncited, and cover only 29 specialties** — the plausibility ceiling that stops inflation is itself unverified.
12. `advertised`/article rate provenance is **agency-published** — the source of most rows is the party being priced.

Nothing here is a live fabrication today (the fleet's live source universe is
tavily/exa/serpapi/locums_com with the agency brands still dormant — `sourceFamily.ts:19-27`),
but every gap becomes load-bearing the moment the Scrapling posting fleet + the
`aggregator_estimate` migration land.

---

## Findings (cited)

### Threat → Defense → Gap matrix

| # | Manipulation vector | Current defense (cited) | Residual gap |
|---|---|---|---|
| T1 | **Planted / astroturfed source** (fabricate a page/post with an inflated rate) | Canonical-view agent allowlist (`agent_id ∈ {rate_scraper,rate_researcher}`, `DASH/.../20260521203841_...a2.sql:709-716`); IronDome plausibility band per specialty (`SDK/core/iron_dome.py:16-51,132-139`); curated-band `spec.max` clamp on the final quote (`WEB/.../rateCalculator.ts:704-707`); `content_ok` guard rejects challenge/interstitial pages (`SDK/.../scrapling_fetch.py:96-151`) | A single planted page inside plausibility, market-typed, still counts as 1 family/1 obs — needs T2/T3 collusion to anchor, but **contributes context + a family vote**. No provenance-trust scoring, no domain reputation. |
| T2 | **Template inflation** (one number stamped across many cards on one board) | Cross-board dedup key = (specialty, family, location, $5-bucket, unit) (`SDK/.../dedup.py:150-165`); Stage-1 content_hash + Stage-2 dedup_group_id collapse (`DASH/.../aggregateBridge.ts:286-379`); `evidence_weight=1.0` invariant — raw multiplicity never inflates weight (`aggregateBridge.ts:433`, D-36) | Dedup key includes **location** and **$5 rate-bucket**: the SAME templated rate posted at 10 cities = 10 distinct observations (different `location`) → inflates `n_distinct` toward the ≥4 bar from ONE template. Only the family gate (≥2) then stops it, not the n gate. |
| T3 | **Aggregator fake-independence** (one agency req re-listed on N boards = N "families") | `recovered_source_family()` re-attributes an aggregator row to its `hiring_org` before family counting (`SDK/.../dedup.py:121-147`); un-attributable aggregator rows collapse to constant `'unattributed'` (one family, `dedup.py:135-137`); `AGGREGATOR_SOURCES` set (`dedup.py:46-51`); family collapse-then-cap in the bridge (`aggregateBridge.ts:527-599`) | **Seam is UNEXERCISED by live data** (posting fleet dormant, `SDK/.../posting_sources.py:36-38`). Depends on `hiring_org` being captured correctly; a board that hides the agency → all rows become `'unattributed'` (fails gate — safe) OR a board that mislabels the agency → wrong family (unsafe). No test on live recovered rows yet. |
| T4 | **W2 salary-proxy leak** (permanent comp bleeds into the locum band) | `permanent_wage_proxy` excluded from `BUCKET_PRECEDENCE` + `DEFAULT_ANCHORABLE_RATE_TYPES` (`marketRates.ts:119-124,419-422`); unit gates reject YEAR/MONTH/WEEK at parse (`SDK/.../jsonld_parser.py:31-40`, `card_extractor.py:37-42`); non-locum legacy-band filter (`isNonLocumWageRow`, `aggregateBridge.ts:712-715`); `RateObservation` makes `isLocum:true` a compile-time invariant (`WEB/.../rateObservation.ts:38-46`) | The non-locum filter is `permanent_wage_proxy OR evidence_employment_arrangement==='permanent'` — an untagged W2 page classified `scraped_article_estimate` with `arrangement='unknown'` is **KEPT** as context (by design, `aggregateBridge.ts:130`). Scraped-article prose blending perm+locum pay is the hard, unsolved case; it can't anchor (not market-typed) but pollutes the displayed context band. |
| T5 | **Stale / echo data** (recycle an old number; re-scrape cadence inflation) | 7-day read window both sides (`aggregateBridge` `RATE_READ_WINDOW_DAYS=7`; reader `RATE_READ_WINDOW_MS`, `marketRates.ts:136,154-159`); Stage-1 dedup collapses same-URL re-scrapes across dates to latest (`aggregateBridge.ts:296-318`); missing/0 `lastUpdated` treated as stale, never epoch-fresh (`marketRates.ts:154-158`) | **7-day cliff is silent**: one week of fleet outage reverts every promoted cell to curated with **no hub-facing alarm** (map 03 §S11). `bridge_runs` telemetry is the only detector; nothing pages on "promotions 6→0". An attacker who can suppress the fleet for a week neutralizes all live anchoring. |
| T6 | **Single-source overlay promotion** (one source sets the price) | Anchor gate requires **≥ 2 normalized-distinct families** (`marketRates.ts:505-512`); whitespace/case-faking hole (`['exa',' exa ']`) closed 2026-07-02 commit `6d9edb1` (`marketRates.ts:499-512`); legacy `loadMarketRates` single-source suppression (`sourceCount<2 → continue`, `marketRates.ts:725`); production trigger documented (CRNA tavily p70=298.5 override, `marketRates.ts:718-724`) | Family gate reads `source_families[]` **verbatim from RTDB** — trust rests on the bridge computing it honestly + the RTDB write rule. Two families is a low bar (see T7/T8). |
| T7 | **Selection bias / survivorship** (only high-rate pages get scraped) | None explicit. Partial: SERP fan-out confidence hardcoded `'low'` → never anchors (`SDK/agent.py:876`); article/survey types are priors-only (`marketRates.ts:419-422`) | **No modeling of what was NOT fetched.** The fleet scrapes a fixed source catalog (`SDK/.../sources.py`, `posting_sources.py`); if agencies advertising high pay are over-represented in that catalog, the posterior is biased up and every guard passes. No inverse-propensity / coverage weighting. Direct north-star risk (accuracy of the percentile position). |
| T8 | **Agency self-reported inflation** (advertised pay > actual paid; marketing puffery) | `actual_paid_locum(4) > advertised_clinician_pay(3)` precedence (`marketRates.ts:119-124`) so a paid corroborant wins; IronDome band + curated `spec.max` clamp bound the number; family collapse = one agency one vote | **`advertised_clinician_pay` IS anchorable AND reads `'high'`** (`bucketConfidenceCeiling`, `marketRates.ts:448-456`). Two agencies each publishing inflated "up to $X" advertised pay across ≥4 postings/≥2 families **anchor the quote up and badge it 'high'** — with zero actual-paid corroboration. Advertised ≠ paid is the single biggest accuracy/manipulation subtlety. |
| T9 | **Never-anchor job-board modeled numbers** (ZipRecruiter/Adzuna W2-blended) | `isNeverAnchorSource()` drops the row BEFORE grouping (`WEB/.../sourceFamily.ts:137-154`; `aggregateBridge.ts:810-813`); excluded by absence from family count, quorum, posterior; surfaced to `invalidRows` | Hardcoded 2-source denylist (`NEVER_ANCHOR_SOURCE_IDS={ziprecruiter,adzuna}`, `sourceFamily.ts:118-121`). Any OTHER modeled job-board aggregator (Glassdoor, Indeed, SimplyHired, Talent.com) is not on the never-anchor list — it's handled only by rate_type classification (`glassdoor→permanent_wage_proxy`, `rate_type_url_patterns.json:296-302`), which is URL-pattern-dependent and misses un-catalogued hosts. |
| T10 | **RTDB node forge** (write a fake posterior directly) | `market-rates-v2`/`market-rates`/`cap-rates` are `.write:false` unconditionally (`DASH/database.rules.json:35-46`); anon AND authenticated writes proven to fail (`DASH/__tests__/database.rules.rate-simulator.test.ts:79-91`) | **`rate-simulator/feedback` is `.write:true`** (rules :27-34) — publicly writable, validate only checks 2 fields exist. Harmless TODAY (calibration reader is dormant, map 01 §9) but arms T11. Also: firebase-admin credential compromise = full quote control (no logic guard behind the credential). |
| T11 | **Feedback-calibration poisoning** (flood the feedback tree to bias the adjustment) | Dormant: `loadSpecialtyCalibration` reads `rate-simulator/feedback`, dampens 50%, clamps `[0.85,1.15]`, n≥3 gate, `isCalibrationEntry` type guard (`marketRates.ts:784-866,621-639`); cap-margin-leak guard drops positive calibration at cap (`marketRates.ts:956-963`) | The read source is the **publicly writable** feedback subtree (T10). If Move #4 wires calibration into the live hub (named in memory as the top follow-on), an attacker POSTing crafted `{specialty,simulatedRate,acceptedRate,timestamp}` entries can push any specialty ±15% (the clamp bound) with only ~n≥3 forged rows. Must be closed **before** Move #4 ships. |
| T12 | **Bimodal / mixed-population masking** (blend two distinct pay regimes into one mean) | `detectBimodal` (var_high>4·var_low, n≥6) + `detectModalEscape` (≥3 same-side rejected outliers) → `weighted_mean=null`, `confidence='manual_review_bimodal'` → cannot anchor (`WEB/.../cellAggregation.ts:195-263`, `marketRates.ts:491`); MAD z>3.5 outlier rejection (`cellAggregation.ts:313-320`); bucket split never averages state/rate_type populations (`aggregateBridge.ts:916-967`) | Bimodal floor is n≥6; below that a 2-mode cell can pass as unimodal. National-only bucketing (T14) is itself a population-mixing surface (a cheap state blended with an expensive one). |
| T13 | **Bill-rate contamination** (agency bill/ceiling leaks in as pay) | `agency_bill_rate` absent from precedence + anchorable sets; reader-strip `RENDERABLE_RATE_TYPES` drops it (`marketRates.ts:144-148,303-308`); write-side `V2_MARKET_TREE_EXCLUDED_RATE_TYPES`; quarantine of cap-capable agent emitting `market` (`aggregateBridge.ts:790-798`); D-12 | Defense-in-depth is solid. Residual: the classifier must correctly type bill rates; a bill figure mislabeled `advertised_clinician_pay` at the source would bypass all three strips (classification is the single point). |
| T14 | **Geo manipulation** (exploit unobserved state dimension) | State multiplier from BEA COLI + HRSA density + demand class (`WEB/.../stateData.ts:149-173`), clamped [0.88,1.38] | **100% of live cells are `stateKey='national'`** (state NULL on live rows, map 03 §S7) — there are no observed state posteriors, so all geo differentiation is the static multiplier. The v2 schema materializes state but it's empty. Geo is unfalsifiable by data today. |
| T15 | **Batch-insert denial-of-accuracy** (one poisoned row aborts the whole run) | IronDome pre-rejects empty specialty/source (`iron_dome.py:109-119`); enum enforcement; migration `20260701000000` prerequisite; hard partition sum-check runs BEFORE the write (`SDK/agent.py:1432-1442`) | Single-statement batch insert = **all-or-nothing** (`supabase_client.py:82`; map 04 §S4). Any NEW db-side constraint without a matching producer guard = total silent run loss → the whole fleet's day is dropped → specialties silently revert to curated at the 7-day cliff. A cheap denial-of-accuracy if an attacker can get one constraint-violating row into a batch. |
| T16 | **Independence-registry divergence** (add a family override in one repo, not the others) | `sourceFamily`/`KNOWN_FAMILY_OVERRIDES` is one shared module by intent (`WEB/.../sourceFamily.ts:1-28`); parity test gates vendored drift (`WEB/src/lib/hub/rate-engine-parity.test.ts`); tests lock cases both sides (`sourceFamily.test.ts`) | The semantics live in **3 places that must agree token-for-token**: Python `dedup._norm_org_underscore` (`dedup.py:75-90`), bridge TS `sourceFamily.ts`, live-engine TS `sourceFamily.ts` (map 04 §S8.1). No single machine-readable cross-language registry. An override added in one → silent independence-count change (over- or under-counts families → wrong anchor decision). |
| T17 | **Challenge-page-as-data** (scrape a Cloudflare 200 interstitial as a rate) | `content_ok` requires ≥1 in-band, correctly-typed observation via the SAME extractor the caller runs; closed reason vocab; biased to drop (`SDK/.../scrapling_fetch.py:96-151`) | Guard is sound; residual is coverage — a challenge page that happens to contain an in-band number (rare) could pass. Low severity. |
| T18 | **Specialty-key coverage gap** (rows land where nothing anchors, or never bridge) | Bridge admits per `DASH` SPECIALTIES; hub anchors per `WEB` SPECIALTIES (map 03 §S4) | No cross-repo test pins the two key sets equal; a specialty in one and not the other silently never bridges or never anchors. Direct north-star coverage risk. |

### Deeper detail on the highest-leverage findings

**F-A. The trust boundary is the RTDB write rule + the two service credentials, not the
overlay logic.** I read the actual rules export (`DASH/database.rules.json`): root is
`.read:false/.write:false`; the three rate trees are read-open, write-closed
(:35-46); the rules unit-test suite explicitly asserts both anonymous and authenticated
client writes to `market-rates-v2/<spec>` **fail** (`DASH/__tests__/database.rules.rate-simulator.test.ts:79-91`)
and that admin-context writes succeed (mirroring the bridge, :114-120). This **closes the
S5 "forged node" concern** map 03 raised as UNVERIFIED — a public client cannot forge
`{n_distinct:9, source_families:['a','b'], rate_type:'actual_paid_locum'}`. The residual
surface is exactly two secrets: the bridge's firebase-admin service account (EC2) and the
scraper's `SUPABASE_SERVICE_ROLE_KEY` (`SDK/core/supabase_client.py:23-26`), which bypasses
Postgres RLS entirely. Everything downstream trusts that these two credentials are clean.
There is no second-signal cross-check (e.g. the reader does not sanity-band the posterior
against the curated range before anchoring — it trusts a market-typed, n≥4, ≥2-family node
outright, `marketRates.ts:486-547`).

**F-B. `advertised_clinician_pay` anchors AND badges 'high'.** `DEFAULT_ANCHORABLE_RATE_TYPES`
= {`actual_paid_locum`, `advertised_clinician_pay`} (`marketRates.ts:419-422`), and
`bucketConfidenceCeiling` returns `'high'` for **both** (:448-456). Advertised pay is the
agency's own marketing number (e.g. AMN card ranges, `posting_sources` = `advertised_clinician_pay`,
map 04 §4). Advertised locum ranges skew to the top of the plausible band (a "$250-330/hr"
ad sells better than "$210"). So the live quote can be anchored — at 'high' confidence — on
corroborated *advertising*, never on a single dollar the agency actually paid a physician. The
curated `spec.max` clamp and IronDome band bound the absolute number, but within the band the
quote drifts to the advertised top. This is the gap most directly at odds with the north star
("the rate we would actually pay the physician").

**F-C. The ≥2-family bar is real but shallow, and advertised-pay collusion clears it.**
Family collapse means one corporate parent = one vote (CHG's 4 brands → 1, `sourceFamily.ts:73-95`),
which is the strong protection. But the anchor only needs **two** independent families and
**four** observations (`minFamilies=2, minDistinct=4`, `marketRates.ts:473-474`). Two agencies
independently (or collusively) advertising inflated pay, each posting 2+ reqs, clears both bars.
With template inflation (T2) counting one templated rate across cities as multiple `n_distinct`,
a single agency could approach the n bar alone, leaving only the 2-family gate — a genuinely low
barrier for a number that moves real placement pricing.

**F-D. Selection bias is the unmodeled elephant.** Every guard validates rows that *arrived*;
none reasons about the sampling frame. The fleet fetches a curated catalog
(`SDK/.../sources.py` 6 tuned + 18 generic; `posting_sources.py` AMN + staged boards). If that
catalog over-represents high-advertising agencies (it is, by construction, a list of locum
*staffing* marketers — the sell-side), the posterior is systematically biased toward the
sell-side's advertised numbers. There is no inverse-propensity weighting, no buy-side (facility
bill-rate) counterweight in the *pay* posterior (cap-rates are a separate, unread tree,
`marketRates.ts:698-705`). The percentile position — the north-star's second half — is computed
by linear interpolation over a curated [min,max] (`WEB/.../sim-adapter.ts:372`,
`rateCalculator.ts:50-53`), i.e. a *fabricated-shape* distribution, so "where the rate sits" is
not an observed distribution at all (map 01 §S2).

**F-E. Denial-of-accuracy is cheaper than inflation.** Because the batch insert is
all-or-nothing (`supabase_client.py:82`) and the read windows are a hard 7 days, the *easiest*
manipulation is not to inflate a number but to **suppress the fleet** (poison one row to abort
a batch, or DoS a source) for 7 days — every promoted cell silently reverts to the curated
prior with no hub alarm (`marketRates.ts:371-374`, map 03 §S11). Curated is the honest fallback,
so this degrades gracefully, but "silently stopped learning" is invisible to recruiters pricing
off the tool.

---

## Recommendations (impact + effort)

- **R1 — Rotate + vault the two write credentials; treat them as the trust boundary.**
  Confirm the firebase-admin service account and `SUPABASE_SERVICE_ROLE_KEY` are least-privilege
  (write-only to `rate-simulator/*` if RTDB granularity allows; scoped Postgres role for the
  scraper) and rotated. Document that quote integrity == these two secrets. **(impact: high,
  effort: low)**

- **R2 — Lock down `rate-simulator/feedback` BEFORE wiring Move #4 calibration.** Today it is
  `.write:true` with a 2-field validate (`database.rules.json:27-34`). Add server-timestamp +
  rate-plausibility validates, or route feedback through an authenticated write path / Cloud
  Function, so the dormant calibration reader (`marketRates.ts:784-866`) can never be fed forged
  entries. This is a **prerequisite** for Move #4, not a nice-to-have. **(impact: high, effort: medium)**

- **R3 — Split advertised from paid in the anchor + confidence.** Either (a) require an
  `actual_paid_locum` corroborant before an `advertised_clinician_pay`-only cell anchors, or (b)
  cap advertised-only anchors at `'medium'` confidence and anchor at a **discount** to the
  advertised posterior (advertised→paid haircut, sourced not guessed). Removes the F-B "high on
  advertising" defect. **(impact: high, effort: medium)**

- **R4 — Fix template inflation in the n count.** Make `n_distinct` count distinct *(family,
  rate-bucket)* pairs, not distinct *(family, location, rate-bucket)*, OR cap per-family
  observation contribution to `n_distinct` (one family can add at most k to n). Stops one
  templated rate across many cities from climbing the ≥4 bar. **(impact: high, effort: medium)**

- **R5 — Add a reader-side sanity cross-check before anchoring.** Before promoting, reject a
  posterior that sits outside the IronDome/curated plausible band (e.g. anchor > curated max ×
  1.5 or < curated min × 0.5) → route to `manual_review` instead of anchoring. Defense-in-depth
  behind the credential boundary (F-A) — a compromised-credential forged node inside the band
  still can't produce an absurd quote. **(impact: high, effort: medium)**

- **R6 — Alarm on the 7-day cliff and on promotion-count deltas.** Emit a `bridge_runs`-driven
  alert when promoted-cell count drops sharply (e.g. 6→0) or when the fleet hasn't inserted for
  >48h. Turns silent denial-of-accuracy (F-E) into a paged event. **(impact: medium, effort: low)**

- **R7 — One machine-readable family registry across languages.** Extract
  `KNOWN_FAMILY_OVERRIDES` + `AGGREGATOR_SOURCES` + `NEVER_ANCHOR_SOURCE_IDS` into a single JSON
  (like `rate_type_url_patterns.json` already is) consumed by both the Python producer and the TS
  bridge/engine, with a checksum. Closes T16 divergence structurally, not by test discipline.
  Do this as part of the headless-core extraction. **(impact: medium, effort: medium)**

- **R8 — Generalize never-anchor from a denylist to a class.** Replace the 2-entry
  `NEVER_ANCHOR_SOURCE_IDS` with a rule: any `source_legal_class`/host classified as a modeled
  salary aggregator (ZipRecruiter, Glassdoor, Indeed, SimplyHired, Talent, Adzuna, Vivian W2
  listings) is never-anchor. Covers T9's uncatalogued-host gap. **(impact: medium, effort: low)**

- **R9 — Chunk/partition the Supabase insert with per-row error capture.** Replace the
  single-statement batch (`supabase_client.py:82`) with a chunked upsert that isolates a bad row
  to its chunk, so one poisoned/constraint-violating row can't drop the whole fleet's day (T15/F-E).
  **(impact: medium, effort: medium)**

- **R10 — Raise the anchor bar for high-variance / high-stakes specialties.** Make `minDistinct`
  and `minFamilies` a function of the specialty's dollar variance (call-heavy, surgical specialties
  need n≥6/3 families before a live anchor moves the quote). Ties directly to the north-star
  "unbelievably accurate for EVERY specialty." **(impact: medium, effort: low)**

- **R11 — Pin the two SPECIALTIES key sets equal with a cross-repo test.** A CI check that
  `DASH` SPECIALTIES keys == `WEB` SPECIALTIES keys (or an explicit, reviewed delta) closes T18's
  silent coverage gap. **(impact: medium, effort: low)**

- **R12 — Publish a source-provenance trust score and require ≥1 non-agency corroborant for
  'high'.** Most rows originate from the sell-side (agencies pricing their own product, F-D).
  Give the anchor a "at least one buy-side or neutral corroborant" requirement before it may badge
  'high', and surface the provenance mix in the confidence sentence. **(impact: high, effort: high)**

---

## Open questions

1. **Who holds, and how is rotation done for, the firebase-admin service account and
   `SUPABASE_SERVICE_ROLE_KEY`?** These two secrets *are* the trust boundary (F-A). Are they
   scoped least-privilege? [Needs the EC2 / secrets config — not in the repos I can read.]
2. **Does the live `market-rates-v2` tree today contain only `national` cells?** Map 03 §S7
   asserts state is 100% NULL; confirm against the live RTDB export before designing state-level
   posteriors (T14). [Needs an RTDB read — Firebase creds.]
3. **Is `advertised_clinician_pay`-only anchoring actually firing on any live cell today, or
   only `actual_paid_locum`?** The 2026-06-30 deploy showed 0 promotions (map 03 §5.3); confirm
   whether any advertised-only cell has ever anchored (F-B severity depends on this).
4. **When the posting fleet runs, does `hiring_org` reliably populate for aggregator boards?**
   T3's whole defense (family recovery) is unexercised by live data (`posting_sources.py:36-38`).
   A verification sample is required before flipping any aggregator `verified=True`.
5. **Should the curated band be treated as a hard plausibility gate on the anchor (R5), or only
   as the fallback?** Trade-off: a hard gate blocks a genuinely hot market from ever anchoring
   above the researched ceiling; no gate trusts the credential boundary alone.
6. **Is there any buy-side (facility bill-rate / LocumSmart `rateRequirements`) signal that could
   counterweight the sell-side selection bias (F-D)?** `liveCalibration.ts` observed-cap profiles
   exist but are dormant (map 05 §2.10); could they anchor a *ceiling* sanity check?

---

## claims_to_verify (every $ figure + corporate/behavioral claim asserted above)

1. Locum-tenens CRNA hourly pay is ~$190–$250/hr (center ~$200–215); a "~$125/hr" figure is a
   W2/full-time blend, not the locum 1099 rate. (Anesthesia OnCall 2025 guide; code cite
   `iron_dome.py:18-24`.)
2. ZipRecruiter's CRNA figure of ~$124.86/hr is roughly half the real locum $200–250, i.e. a
   W2-blended modeled number (code-cited production observation, `sourceFamily.ts:105-107`;
   `aggregateBridge.ts:801-802`).
3. CHG Healthcare operates LocumStory and owns CompHealth, Weatherby Healthcare, and Global
   Medical Staffing (`sourceFamily.ts:52-54`).
4. AMN Healthcare owns Staff Care (+ Medefis, B.E. Smith) (`sourceFamily.ts:55-59`).
5. Jackson Healthcare owns Jackson & Coker (`sourceFamily.ts:60-63`); Cross Country Healthcare
   operates Cross Country Locums (`:64-68`); Aya Healthcare owns Aya Locums (`:69-71`).
6. Aggregator job boards (DocCafe, Physemp, JAMA Career Center, LocumJobsOnline, TrackFive,
   Talent.com, SimplyHired, Jooble, Adzuna, Vivian, HealtheCareers, ACR, emCareers, MaritHealth)
   re-list other agencies' postings, so one agency req on N boards would fake N independent
   families absent recovery (`dedup.py:42-51,121-147`).
7. Glassdoor/Doximity/Medscape/MGMA publish permanent-wage (W2) proxy data, not locum pay
   (`rate_type_url_patterns.json:196-217,296-302`).
8. Advertised locum pay ranges systematically skew higher than actual paid rates (marketing
   puffery). [Behavioral claim asserted in F-B — needs an external source or internal paid-vs-advertised comparison.]
9. The locum staffing source catalog is predominantly sell-side (agencies marketing their own
   placements), biasing a naive pay posterior upward (F-D). [Structural claim — verify against the
   actual live source mix in `sources.py`/`posting_sources.py`.]
10. Robust spread (MAD-based) is mathematically unavailable below n=4 (Rousseeuw & Verboven 2002),
    the basis for `minDistinct=4` (`marketRates.ts:426-427`, cited in code).
11. `rate-simulator/market-rates-v2`, `market-rates`, and `cap-rates` are unconditionally
    write-closed at the RTDB rule layer, while `rate-simulator/feedback` is publicly writable with
    only a 2-field validate (`DASH/database.rules.json:27-46`; asserted by
    `DASH/__tests__/database.rules.rate-simulator.test.ts:79-91,98-112`).
12. The scraper writes `rate_intelligence` using `SUPABASE_SERVICE_ROLE_KEY`, which bypasses
    Postgres RLS (`SDK/core/supabase_client.py:23-26,82`).
13. The Supabase insert is a single all-or-nothing batch statement; one constraint-violating row
    aborts the entire run's write (`supabase_client.py:82`; map 04 §S4).
14. IronDome plausibility bands cover 29 specialties with hand-tuned, comment-provenance-only
    bounds (e.g. crna 120–250, emergency medicine 150–450, neurosurgery 250–650), DEFAULT_RANGE
    60–700 (`iron_dome.py:16-53`).
15. The live source universe today is tavily_research / exa_semantic / serpapi_google / locums_com
    (+ bls_oews on the dormant CRNA path); the agency-brand family registry has zero live firings
    (`sourceFamily.ts:19-27`).
