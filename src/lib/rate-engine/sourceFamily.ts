// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// sourceFamily.ts — Shared corporate-family registry (Phase 3, A.3, Plan 03-02 / D-37)
//
// PROMOTED verbatim out of marketRates.ts so BOTH the engine (marketRates
// re-exports this and uses it in the loadMarketRates confidence gate) AND the
// bridge (aggregateBridge family collapse-then-cap) consume ONE implementation —
// a single source of truth (D-37). Pure + framework-free: NO firebase/db import,
// importable across the scripts/ ↔ src/ boundary (the same boundary aggregateCell
// crosses, D-33 shared-module rationale).
//
// The longest-prefix-match logic + the original CHG override entries are byte-
// preserved from marketRates.ts:54-109 (the marketRates.test.ts sourceFamily
// describe block + the new sourceFamily.test.ts both stay green against this).
// Task 1 (03-02) EXTENDS KNOWN_FAMILY_OVERRIDES with AMN / jackson / cross_country
// / aya per RESEARCH §6.
//
// REGISTRY-FIRING REALITY (RESEARCH §6 / A3): this registry has ZERO firings on
// today's live source universe — the only sources that appear are
// tavily_research / exa_semantic / serpapi_google / locums_com (+ bls_oews_* on
// the CRNA path, which does not flow through the bridge). The corporate-family
// collapse is FORWARD-LOOKING infrastructure for Phase 4 source expansion
// (SRC-04 adds the agency brands this registry targets). It is built correctly
// now so AGG-03's collapse-then-cap is structurally in place before the brands
// arrive; SC3 is proven on a fixture + the family_cap_fired counter, not a live
// firing.
// ============================================================

/** Explicit corporate-family map per
 *  `docs/rate-simulator/B-research-2026-05-05/F.1-scraper-sources.md §6.4` (CHG)
 *  + Phase 3 RESEARCH §6 (AMN / jackson / cross_country / aya): brands that share
 *  editorial or data lineage (one corporate parent) should collapse to ONE vote
 *  when counting independent confidence (engine) and to ONE clustered observation
 *  before weighting (bridge, D-37). The prefix heuristic in `sourceFamily()`
 *  doesn't infer these collapses from the source name alone (e.g. 'comphealth'
 *  and 'weatherby' have no shared prefix but both publish CHG-aggregated data),
 *  so we look them up here first and fall back to the prefix.
 *
 *  Keys can be SINGLE-SEGMENT (e.g. 'locumstory') OR MULTI-SEGMENT joined by
 *  underscores (e.g. 'global_medical'). The lookup tries progressively longer
 *  prefixes of the input source so multi-token brand IDs like
 *  'global_medical_2024_rates' correctly match the 'global_medical' key
 *  instead of being truncated to 'global' by the single-segment fallback
 *  (Codex r2 M1 fold — production source IDs for the CHG-owned brand are
 *  typed as `global_medical_*` in `agent-sdk/agents/rate_scraper/sources.py`).
 *
 *  BRAND→PARENT PROVENANCE (RESEARCH A4 — corporate ownership is a factual
 *  claim that needs a source; each mapping CONFIRMED against the actual
 *  `source_id` strings in `agent-sdk/agents/rate_scraper/sources.py`):
 *    - chg          : CHG Healthcare operates LocumStory + owns CompHealth,
 *                     Weatherby Healthcare, Global Medical Staffing.
 *                     source_ids CONFIRMED in sources.py: `locumstory`,
 *                     `comphealth`, `weatherby`, `global_medical`. ✓ all 4 exist.
 *    - amn          : AMN Healthcare owns Staff Care (+ Medefis, B.E. Smith).
 *                     source_ids CONFIRMED in sources.py: `amn_healthcare`,
 *                     `staffcare`. ✓ both exist. `medefis`/`b_e_smith` are NOT
 *                     yet emitted by sources.py — included as forward-looking
 *                     Phase-4 entries (real AMN brands, no source_id today).
 *    - jackson      : Jackson Healthcare owns Jackson & Coker (+ Jackson
 *                     Physician Search). source_id CONFIRMED: `jackson_coker`. ✓
 *                     `jackson_physician_search` NOT yet in sources.py —
 *                     forward-looking.
 *    - cross_country: Cross Country Healthcare operates Cross Country Locums.
 *                     source_id CONFIRMED: `cross_country`. ✓ The bare id IS the
 *                     family name (self-matching key) so the prefix fallback
 *                     alone would already collapse it; the explicit entry pins
 *                     the intent + future `cross_country_locums`.
 *    - aya          : Aya Healthcare owns Aya Locums. source_id CONFIRMED:
 *                     `aya_locums`. ✓ `aya_healthcare` NOT yet a source_id —
 *                     forward-looking.
 */
export const KNOWN_FAMILY_OVERRIDES: Record<string, string> = {
  // CHG (existing — preserved verbatim from marketRates.ts) ✓ all 4 in sources.py
  locumstory: 'chg',
  comphealth: 'chg',
  weatherby: 'chg',
  global_medical: 'chg', // multi-segment key — see lookup comment
  // AMN (NEW — D-37) — amn_healthcare + staffcare CONFIRMED in sources.py;
  // medefis + b_e_smith forward-looking (real AMN brands, no source_id today).
  amn_healthcare: 'amn',
  staffcare: 'amn',
  medefis: 'amn',
  b_e_smith: 'amn',
  // jackson (NEW — D-37) — jackson_coker CONFIRMED in sources.py;
  // jackson_physician_search forward-looking.
  jackson_coker: 'jackson',
  jackson_physician_search: 'jackson',
  // cross_country (NEW — D-37) — cross_country CONFIRMED in sources.py.
  cross_country: 'cross_country',
  cross_country_locums: 'cross_country',
  // aya (NEW — D-37) — aya_locums CONFIRMED in sources.py; aya_healthcare
  // forward-looking.
  aya_locums: 'aya',
  aya_healthcare: 'aya',
  // WS1 (2026-07-01) — FORWARD-LOOKING for the Scrapling posting scrape
  // (agent-sdk/agents/rate_scraper/posting_sources.py). These sources are STAGED
  // (verified:false) or their recovered-agency family is written by the fleet-
  // phase org-recovery, so — like medefis / jackson_physician_search above —
  // they do NOT fire on today's live universe. Keys cover BOTH the board id the
  // scraper writes today AND the underscore agency-org form a future org-recovery
  // will write, so independence counting stays correct once the aggregators go live.
  //   - trackfive : TrackFive operates LocumJobsOnline (aggregator_estimate; it
  //                 NEVER anchors regardless, but the family pins independence).
  trackfive: 'trackfive',
  locumjobsonline: 'trackfive',
  //   - tandym    : Tandym Health — a distinct agency recovered THROUGH JSON-LD
  //                 aggregators (runtime-seen on live Physemp 2026-06-30).
  tandym: 'tandym',
  tandym_health: 'tandym',
  //   - communitybrands : JAMA Career Center + ACR share the Community Brands
  //                 careers platform, so two board postings of ONE agency's req
  //                 must not fake two independent families. Only JAMA + ACR emit
  //                 pay on that platform today.
  communitybrands: 'communitybrands',
  jama: 'communitybrands',
  acr: 'communitybrands',
  // ziprecruiter / adzuna (NEW — Phase 4, OBS-05 NEVER-ANCHOR). Mapped to their own
  // single-brand families so a same-source second pull cannot fake two independent
  // votes BEFORE the never-anchor exclusion drops them entirely. The authoritative
  // exclusion is by ABSENCE from the voting set (see NEVER_ANCHOR_SOURCE_IDS /
  // isNeverAnchorSource below + the aggregateBridge admission filter), NOT this map.
  ziprecruiter: 'ziprecruiter',
  adzuna: 'adzuna',
}

/** NEVER-ANCHOR source ids (Phase 4, OBS-05). ZipRecruiter + Adzuna publish modeled /
 *  W2-blended job-board numbers that are NOT locum pay observations (the CRNA spike:
 *  ZipRecruiter $124.86 ≈ HALF the real locum $200-250). They must NEVER contribute a
 *  family VOTE to a cell's weighted mean — but the exclusion is by ABSENCE, the exact
 *  idiom RATE_TYPE_PRECEDENCE uses for permanent_wage_proxy / agency_bill_rate (the
 *  omitted key never votes). There is NO `never_anchor` boolean flag on a row: instead,
 *  a row whose source resolves to one of these ids is simply NOT ADMITTED into the
 *  observation set at the bridge's row-admission gate, so it is absent from family
 *  counting, quorum, and the posterior. The aggregateCell math is untouched (D-33).
 *
 *  Matching is by the SOURCE FAMILY (so `ziprecruiter_2025` / `adzuna_us` collapse to
 *  the family first, then match) — `isNeverAnchorSource()` is the single predicate the
 *  bridge consults. */
export const NEVER_ANCHOR_SOURCE_IDS: ReadonlySet<string> = new Set<string>([
  'ziprecruiter',
  'adzuna',
])

/** True when a source id is a NEVER-ANCHOR source (ZipRecruiter / Adzuna).
 *
 *  Resolves the source to its family FIRST (via `sourceFamily()`), so a suffixed id
 *  like `ziprecruiter_2025_crna` or `adzuna_us` is caught by its family. The bridge
 *  excludes any such row by ABSENCE from the voting set — it is never blended into a
 *  locum posterior, never counted toward the ≥2-independent-family quorum.
 *
 *  Producer-spelling robustness (Codex 04-05 r2 watchpoint): a real producer might emit
 *  `zip-recruiter`, `ZipRecruiter.com`, or a whitespace-padded id. We canonicalize the
 *  separators FIRST — lowercase + trim, then map hyphens / dots / spaces to underscores
 *  and drop a trailing TLD-ish segment (`.com`) — so all of those resolve to the
 *  `ziprecruiter` / `adzuna` family. The exclusion stays fail-SAFE: a never-anchor source
 *  must be caught regardless of punctuation, because letting one vote is the unsafe
 *  direction (the CRNA spike). `sourceFamily()` itself is unchanged (back-compat). */
export function isNeverAnchorSource(source: string): boolean {
  if (!source) return false
  // Canonicalize common producer separators. Drop a domain TLD first (ziprecruiter.com →
  // ziprecruiter), then try BOTH (a) the underscore form sourceFamily() keys on, and (b)
  // the separator-STRIPPED form — because a hyphenated `zip-recruiter` underscores to the
  // two-segment `zip_recruiter` (family `zip`), so we ALSO collapse separators entirely to
  // recover the single token `ziprecruiter`. Either form matching the never-anchor set is
  // enough (fail-SAFE: catch the source regardless of punctuation; the CRNA spike makes
  // letting one vote the unsafe direction).
  const deTld = source.toLowerCase().trim().replace(/\.(com|org|net|io|us)\b/g, '')
  const underscored = deTld.replace(/[-.\s]+/g, '_') // separators → single underscore
  const stripped = deTld.replace(/[-.\s_]+/g, '')    // separators removed entirely
  return (
    NEVER_ANCHOR_SOURCE_IDS.has(sourceFamily(source)) ||
    NEVER_ANCHOR_SOURCE_IDS.has(sourceFamily(underscored)) ||
    NEVER_ANCHOR_SOURCE_IDS.has(sourceFamily(stripped))
  )
}

/** Source-family extractor — checks `KNOWN_FAMILY_OVERRIDES` first (longest-
 *  prefix-match against the underscore-joined segments of the source), then
 *  falls back to the first underscore-separated segment of the source name,
 *  lowercased. Used (engine-side) to identify INDEPENDENT corroboration vs
 *  same-brand-different-suffix (or same-corporate-family) scrapes when deciding
 *  whether the live RTDB overlay can promote confidence to 'high', and (bridge-
 *  side, D-37) to collapse a correlated corporate family to one clustered
 *  observation before IVW weighting.
 *
 *  Examples:
 *    'locums_com'              → 'locums'
 *    'locums_com_2025'         → 'locums'   (same brand, different vintage)
 *    'locumstory_state_index'  → 'chg'      (override: single-segment key)
 *    'comphealth_pay_guide'    → 'chg'      (override: single-segment key)
 *    'weatherby_blog'          → 'chg'      (override: single-segment key)
 *    'global_medical_2024'     → 'chg'      (override: multi-segment key
 *                                            'global_medical' matched via
 *                                            longest-prefix scan; without
 *                                            that scan, prefix 'global'
 *                                            would miss the override and
 *                                            this brand would falsely vote
 *                                            independent of CHG family)
 *    'amn_healthcare'          → 'amn'      (override)
 *    'staffcare'               → 'amn'      (override — single-segment key)
 *    'jackson_coker'           → 'jackson'  (override)
 *    'aya_locums'              → 'aya'      (override)
 *    'tavily_research'         → 'tavily'
 *    'bls_oews_2023_permanent' → 'bls'
 *    'exa_semantic'            → 'exa'
 *    ''                        → 'unknown'
 *    null / undefined / blank  → 'unknown'  (defensive — caller filters first)
 *
 *  Production failure case this ships for (engine side): blocking single-source-
 *  family overlays (e.g. RTDB CRNA p70=298.5 with sources=['tavily_research'] on
 *  2026-05-15) from promoting to 'high' confidence and overriding the curated
 *  $190-250 static range. Bridge side (D-37): keeping a 4-brand CHG family from
 *  faking 4 independent votes — it collapses to ONE clustered observation, then
 *  is capped at ≤60% of cell weight. */
export function sourceFamily(source: string): string {
  const raw = (source || '').toLowerCase().trim()
  if (!raw) return 'unknown'

  // Progressive longest-prefix match against KNOWN_FAMILY_OVERRIDES. Walks
  // segments from longest-join down to single-segment so multi-token brand
  // IDs (e.g. `global_medical_2024_rates`) match a multi-segment override
  // key (`global_medical`) before the single-segment fallback kicks in.
  const segments = raw.split('_')
  for (let i = segments.length; i >= 1; i--) {
    const candidate = segments.slice(0, i).join('_')
    const override = KNOWN_FAMILY_OVERRIDES[candidate]
    if (override) return override
  }

  // Fall back to single-segment prefix (legacy behavior — sufficient for
  // independent brands without corporate-family collapse).
  return segments[0] || 'unknown'
}
