export const meta = {
  name: 'rate-sim-deep-dive',
  description: 'Multi-agent deep-dive on the rate simulator: map it, research all improvement pillars (accuracy/anti-manipulation, comp-factor taxonomy, portability to Discord/Slack/ATS/API, competitors, data-source expansion, innovation), adversarially fact-check, and synthesize a master report + scored backlog.',
  phases: [
    { title: 'Cartography', detail: 'parallel code mappers document the engine as-is across 3 repos' },
    { title: 'Research', detail: 'parallel pillar agents (all Fable) write cited briefs' },
    { title: 'Verify', detail: 'adversarial fact-check of every $ / accuracy claim (no fabrication)' },
    { title: 'Synthesize', detail: 'weave maps + verified briefs into MASTER report + scored backlog' },
  ],
}

const ROOT = 'C:/Users/oclou/QueenClaude'
const WORKTREE = ROOT + '/ias-website/.worktrees/feat-ims-phase-1-plan'
const BASE = WORKTREE + '/docs/rate-simulator/deep-dive'
const WEBSITE_ENGINE = WORKTREE + '/src/lib/rate-engine'
const HUB_LIVE = WORKTREE + '/src/lib/hub'                              // LIVE hub UI/adapter (imstaffing.ai/hub, served by ias-website)
const LEGACY_DASHBOARD = ROOT + '/ias-dashboard/src/features/rate-simulator' // DEAD app (ias-hub-dashboard.web.app) — legacy reference only
const BRIDGE = ROOT + '/ias-dashboard/scripts/data-refresh'
const SCRAPER = ROOT + '/agent-sdk/agents/rate_scraper'
const IRON = ROOT + '/agent-sdk/core/iron_dome.py'

const GUARD = [
  'HARD RULES (this project forbids fabricated data):',
  '- NORTH STAR (Zach, 2026-07-02): recruiters price real placements off this simulator. It must be unbelievably accurate for EVERY specialty staffed in the locums world — the rate we would actually pay the physician AND where that sits in the market distribution (percentile). Treat specialty-coverage gaps, missing comp factors, and unquantified uncertainty as defects, not nice-to-haves.',
  '- NEVER invent a $ figure. Every rate/number you state must be either (a) READ from the codebase (cite file:line) or (b) cited to a real, named external source (agency/survey/gov). If you cannot cite it, write "UNVERIFIED — needs a source" and add it to claims_to_verify.',
  '- Distinguish OBSERVED vs ESTIMATED explicitly. Label confidence.',
  '- Be concrete and technical: name real files, functions, and cells. No hand-waving.',
  '- This is a locum-tenens (1099 physician contractor) rate tool. Do NOT confuse with W2 salary.',
  '- TOPOLOGY (Zach-confirmed 2026-07-02): the LIVE rate simulator = imstaffing.ai/hub, served by the ias-website repo — engine at ' + WEBSITE_ENGINE + ' + hub/adapter layer at ' + HUB_LIVE + '. The ias-dashboard APP (ias-hub-dashboard.web.app) is DEAD/RETIRED, so ' + LEGACY_DASHBOARD + ' is a LEGACY copy, NOT a live surface — reference it only for history / divergence-risk, never as a second live engine. BUT the bridge (' + BRIDGE + ') + scraper (' + SCRAPER + ') under ias-dashboard/agent-sdk ARE still the live data pipeline (they write the RTDB the live hub reads). Portability = extract ONE headless core from the LIVE ias-website engine; there are not two live copies to reconcile.',
].join('\n')

const DOC_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    doc_path: { type: 'string', description: 'absolute path of the .md file you wrote' },
    title: { type: 'string' },
    key_findings: { type: 'array', items: { type: 'string' }, description: '5-12 concrete findings' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          rec: { type: 'string' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['rec', 'impact', 'effort'],
      },
    },
    claims_to_verify: { type: 'array', items: { type: 'string' }, description: 'factual/$ claims a fact-checker must check; [] if none' },
  },
  required: ['doc_path', 'title', 'key_findings', 'recommendations', 'claims_to_verify'],
}

const VERDICTS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    brief_key: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] },
          evidence: { type: 'string' },
          correction: { type: 'string' },
        },
        required: ['claim', 'verdict', 'evidence'],
      },
    },
  },
  required: ['brief_key', 'verdicts'],
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    master_doc: { type: 'string' },
    backlog_doc: { type: 'string' },
    top_moves: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['master_doc', 'backlog_doc', 'top_moves', 'summary'],
}

// ---------------- PHASE 1: CARTOGRAPHY ----------------
phase('Cartography')
const CARTO = [
  { key: 'engine-core', file: 'maps/01-engine-core.md', focus:
    'The CALCULATION engine at ' + WEBSITE_ENGINE + ' (rateCalculator.ts, multipliers.ts, blsSanityCheck.ts, marketRates.ts, specialties.ts, stateData.ts, types.ts, index.ts). Trace end-to-end how a single quote is produced from (specialty, state, facility, request-type) inputs: every multiplier, clamp, and the market overlay. List the exact inputs, the formula, and every place a number is bounded or adjusted.' },
  { key: 'hub-adapter-layer', file: 'maps/02-hub-adapter-layer.md', focus:
    'The LIVE hub UI/adapter layer at ' + HUB_LIVE + ' (sim-live.ts, sim-adapter.ts, hub-firebase) — how the imstaffing.ai/hub simulator wires the ias-website engine (' + WEBSITE_ENGINE + ') to the live RTDB overlay + the controls->quote mapping. Then treat ' + LEGACY_DASHBOARD + ' as a DEAD/legacy copy (the ias-dashboard app is retired): do NOT map it as a live surface, but DO flag any place the LIVE data pipeline still imports from it (e.g. the bridge imports sourceFamily from the dashboard engine dir) as a real coupling/divergence risk. The portability takeaway is "one live engine (ias-website) + a dead legacy copy", not "two live copies to reconcile".' },
  { key: 'market-posterior', file: 'maps/03-market-posterior-bridge.md', focus:
    'The market-intelligence bridge at ' + BRIDGE + ' (bridge-rate-intelligence.ts, lib/aggregateBridge.ts) and the trust-ladder / market-rates-v2 posterior. Document how raw observations become the quote anchor: dedup-collapse, family collapse-then-cap (sourceFamily), the >=2-independent-family + n>=4 anchor gate, RATE_TYPE_PRECEDENCE, the non-locum legacy-band filter, and how it writes to RTDB market-rates. This is the accuracy core.' },
  { key: 'scraper-pipeline', file: 'maps/04-scraper-pipeline.md', focus:
    'The data ingestion pipeline at ' + SCRAPER + ' (agent.py, dedup.py, sourceFamily.ts consumer, posting_sources.py, card_extractor.py, jsonld_parser.py, scrapling_fetch.py) and IronDome at ' + IRON + '. Document how external rate data enters, is validated (IronDome PLAUSIBLE_RANGES, content_ok guard, aggregator family-recovery), classified (rate_type), and inserted. Note the partition/accounting invariant.' },
  { key: 'comp-factors-today', file: 'maps/05-comp-factors-today.md', focus:
    'How compensation FACTORS are (or are not) modeled today. Grep across ' + WEBSITE_ENGINE + ', ' + HUB_LIVE + ' (live hub adapter), and ' + SCRAPER + ' for handling of: call pay (beeper/in-house/worked-day), stipends, gratis, sign-on/completion bonuses, travel/housing/malpractice/CME, per-diem, W2-vs-1099, and RVU/daily/shift vs hourly. For EACH factor state: first-class-modeled / partially / IGNORED, with file:line evidence. This map anchors the comp-factor research pillars.' },
  { key: 'data-model', file: 'maps/06-data-model.md', focus:
    'The data model: the Supabase rate_intelligence table + canonical view (search migrations under ' + ROOT + '/ias-dashboard/supabase/migrations), the RTDB market-rates / market-rates-v2 tree, the specialty/cell taxonomy (152 cells), and the golden-master test files. Document the schema, the cell key structure, and where "truth" lives.' },
]
const maps = await parallel(CARTO.map(c => () => agent(
  'You are a codebase cartographer. ' + GUARD + '\n\nTASK: Produce a precise architecture map. FOCUS:\n' + c.focus +
  '\n\nUse Read/Grep/Glob (absolute paths; the code spans 3 sibling repos under ' + ROOT + '). Then WRITE your map as markdown to EXACTLY this path: ' + BASE + '/' + c.file +
  '\nThe doc must be detailed and skimmable (headers, file:line refs, a data-flow description, and a short "seams & smells" section noting coupling / duplication / risk). Then return the schema (doc_path = the path you wrote, claims_to_verify = any $ figures or behavioral claims worth checking).',
  { label: 'map:' + c.key, phase: 'Cartography', model: 'fable', agentType: 'general-purpose', schema: DOC_SCHEMA }
).catch(() => null)))
log('Cartography done: ' + maps.filter(Boolean).length + '/' + CARTO.length + ' maps written')

// ---------------- PHASE 2: RESEARCH ----------------
phase('Research')
const mapsCtx = 'Architecture maps were written to ' + BASE + '/maps/ by a prior phase — READ the relevant ones before you start (esp. 05-comp-factors-today.md and 03-market-posterior-bridge.md).'
const PILLARS = [
  { key: 'comp-core', file: 'briefs/10-comp-core.md', model: 'fable', verify: true, focus:
    'COMPENSATION TAXONOMY part 1 — CORE PAY STRUCTURE. Exhaustively enumerate how locum physician pay is structured and how each maps to an engine change: hourly vs daily/per-diem vs per-shift vs wRVU-based; the W2<->1099 relationship (why they differ, typical multiplier RANGES with citations, why the engine must NOT hardcode one); minimum guarantees; overtime. For EACH: definition, when it applies (per specialty/setting), a CITED typical range, and the concrete engine/data-model change to model it as first-class.' },
  { key: 'comp-call', file: 'briefs/11-comp-call.md', model: 'fable', verify: true, focus:
    'COMPENSATION TAXONOMY part 2 — CALL PAY (a top source of quote error). Enumerate every call type: beeper/home call, in-house call, worked-day-during-call, call-back, unrestricted vs restricted, weekend/holiday differentials. How call pay differs by specialty (e.g. surgery/OB/anesthesia/neurosurgery norms) and setting. CITE ranges. Map each to the engine (the memory notes a separate call-rate path exists — investigate ' + WEBSITE_ENGINE + ' and reconcile).' },
  { key: 'comp-extras', file: 'briefs/12-comp-extras.md', model: 'fable', verify: true, focus:
    'COMPENSATION TAXONOMY part 3 — STIPENDS, GRATIS & EXTRAS. Enumerate: sign-on/completion/retention bonuses, travel reimbursement, housing/lodging, rental car, malpractice + TAIL coverage, CME allowance, licensing/credentialing reimbursement, meal per-diem, and GRATIS / pro-bono / reduced-rate arrangements. For each: is it part of the effective rate or separate? how do agencies use it to obscure the true number? CITE. Map to engine + to the anti-manipulation model (extras used to disguise a low base).' },
  { key: 'anti-manip', file: 'briefs/13-anti-manipulation.md', model: 'fable', verify: true, focus:
    'ANTI-MANIPULATION THREAT MODEL + DEFENSES. Read map 03 + 04. Enumerate every way a rate could be manipulated or drift wrong: planted/astroturfed source, template inflation (one number across many cards), aggregator fake-independence, W2 salary-proxy leak, stale/echo data, single-source overlay promotion, selection bias, agency self-reported inflation. For EACH: how the current engine defends (cite the real guard: IronDome, dedup, family-recovery, never-anchor, RATE_TYPE_PRECEDENCE, non-locum filter, trust-ladder) and the GAP + a concrete hardening. This is a north-star pillar — be exhaustive.' },
  { key: 'accuracy-harness', file: 'briefs/14-accuracy-harness.md', model: 'fable', verify: true, focus:
    'CONTINUOUS ACCURACY HARNESS design ("constantly test ourselves"). Design a system that proves rates stay accurate over time: golden-master/regression (exists — extend it), property-based + invariant tests (monotonicity, bounds, no-NaN), canary cells with known-good ranges + drift alerts, a per-quote PROVENANCE / audit trail ("explain this exact number" -> which observations + priors), automated benchmark reconciliation, and CI gates. Reference the existing 208-case golden master + IronDome. Give a concrete build plan.' },
  { key: 'portability-core', file: 'briefs/15-portability-core.md', model: 'fable', verify: false, focus:
    'PORTABILITY — the headless @ims/rate-engine CORE. Read maps 01 + 02. TODAY there is ONE live engine (ias-website, serving imstaffing.ai/hub); the ias-dashboard copy is DEAD, so this is about future-proofing NEW surfaces, not reconciling two live copies. Design extracting the pure calc + market-posterior out of the live ias-website engine into a framework-free, dependency-light package (no React/DOM/firebase) that any surface (the current hub + future Discord/Slack/ATS/API) imports. Define the package boundary, the public API (quote(input) -> {rate, band, confidence, provenance}), config injection for the market overlay (RTDB handle passed in, not imported), and a migration path that keeps the live ias-website hub green (and lets the dead dashboard copy be deleted). Give a concrete module layout.' },
  { key: 'portability-chat', file: 'briefs/16-portability-chat.md', model: 'fable', verify: false, focus:
    'PORTABILITY — DISCORD + SLACK adapters over the headless core. Design "type a message in a channel -> it replies with a rate." For each: command/mention parsing (specialty + state + setting from natural language), the reply format (rate + band + confidence + a one-line why), auth/rate-limiting, hosting, and how thin the adapter is (it should be a shell over the core). Note the existing Slack MCP integration. Include example message->reply flows.' },
  { key: 'portability-embed', file: 'briefs/17-portability-embed.md', model: 'fable', verify: false, focus:
    'PORTABILITY — OWN ATS embed + hosted API/SDK. Design (a) embedding the engine standalone in an in-house ATS (fully independent of the marketing site) and (b) a hosted rate API + npm SDK so ANY surface (present or future) calls one source of truth. Cover: API shape/versioning, auth, caching, the market-data refresh path, and deployment. Explain why the API-first path future-proofs every other surface.' },
  { key: 'competitors', file: 'briefs/18-competitors.md', model: 'fable', verify: true, focus:
    'COMPETITOR TEARDOWN. Research what other locum/physician rate tools and salary tools actually do (e.g. LocumStory rate ranges, AMN/Vivian pay transparency, Marit Health, Physician Side Gigs, Doximity/Medscape salary tools, general comp calculators). For each: data source, granularity, transparency, what they get right, and the GAP we can exploit. End with a differentiation table: where an accuracy-first, provenance-backed, everywhere-embeddable locum rate engine wins.' },
  { key: 'data-sources', file: 'briefs/19-data-sources.md', model: 'fable', verify: true, focus:
    'DATA-SOURCE EXPANSION (extends the WS1 scraper). Read map 04. Propose widening the source universe so more of the 152 cells clear the n>=4 + >=2-independent-family anchor bar: additional advertised-pay agency families, marketplaces, survey/registry sources, geo-specific sources, and freshness strategy. Respect the existing rate_type discipline (advertised_clinician_pay / crowd_survey / aggregator_estimate never-anchor). CITE which sources publish per-job $/hr. Flag ToS/independence risks.' },
  { key: 'rate-hunt', file: 'briefs/20-rate-hunt.md', model: 'fable', verify: true, focus:
    'KNOWN-PAIN RATE HUNT ("specific rates feel wrong"). Read map 01 + the current curated bands (grep PLAUSIBLE_RANGES in ' + IRON + ' and the curated priors in ' + WEBSITE_ENGINE + '). For a spread of specialties, compare what the engine would quote against CITED published locum 1099 hourly ranges. Flag every cell that looks too high/low with the evidence and a proposed corrected band. NO fabrication — only flag where you have a real cited comparator; list cells you could NOT verify separately.' },
  { key: 'innovation', file: 'briefs/21-innovation.md', model: 'fable', verify: false, focus:
    'INNOVATION / NET-NEW MOAT. Brainstorm differentiators nobody in locum staffing offers: confidence-scored + provenance-backed quotes, real-time negotiation guidance ("this offer is 8% below market for your cell"), geo heatmaps, a recruiter feedback loop that tightens the posterior, "explain this rate" transparency, per-factor breakdown (base + call + stipends), scenario comparison, and API-as-product. Rank by moat strength x feasibility. Think end-to-end and outside the box.' },
  { key: 'specialty-coverage', file: 'briefs/22-specialty-coverage.md', model: 'fable', verify: true, focus:
    'FULL-SPECIALTY COVERAGE ("every single specialty in the locums world"). Read map 06 (data model / cell taxonomy) + map 01. First enumerate the COMPLETE universe of physician specialties and subspecialties actually staffed as locum tenens in the US (plus CRNA/advanced-practice where the engine already models them) — use recognized taxonomies (ABMS specialty/subspecialty list, major locum agency specialty trees e.g. CompHealth/Weatherby/LocumTenens.com) and CITE sources. Then DIFF that universe against the engine\'s current cell taxonomy: which specialties are missing entirely, which are collapsed/mislabeled (a subspecialty folded into a parent with materially different rates, e.g. interventional vs general cardiology), and which existing cells have curated-only bands vs live corroboration. Output a gap table (specialty | in-engine? | band quality | locum demand signal | priority) and a phased coverage-expansion plan naming which data source would seed each new cell. NO fabricated rates — coverage gaps and priorities only, with citations for demand claims.' },
  { key: 'internal-truth', file: 'briefs/23-internal-truth.md', model: 'fable', verify: true, focus:
    'INTERNAL GROUND TRUTH — the rates we ACTUALLY pay our doctors. The engine currently has NO wired internal pay truth (known gap), but internal data EXISTS: a LocumSmart webhook at /api/locumsmart-events (Grep under ' + WORKTREE + '/src for locumsmart-events) already captures Assignments + Timesheets + Invoices (confirmationAgreementId = confirmed placement) into Supabase; an EC2 Sisense tap pulls LocumSmart rows every 6h (artifacts at ' + ROOT + '/ims-ls-tap if readable); and there is a known ~138-placement historical rate-registry ambition. Map what actual-paid data exists TODAY (fields, quality, specialty/state coverage — cite file:line from the webhook handler + tap code), then DESIGN the calibration loop: actual-paid observations as the HIGHEST-trust rung of the trust ladder (above advertised pay), the bill-rate vs pay-rate vs margin distinction (recruiters need both sides), small-n discipline so one placement cannot swing a cell, confidentiality boundaries (internal actuals calibrate the posterior — NEVER exposed verbatim in a public quote), and quote-vs-subsequently-paid delta as the standing accuracy KPI / drift alarm. Anything you cannot read directly goes in claims_to_verify or open questions — do not guess schemas.' },
  { key: 'percentiles', file: 'briefs/24-percentiles.md', model: 'fable', verify: true, focus:
    'PERCENTILES & DISTRIBUTIONS ("what the going percentile is"). Read map 03. Today the quote is a point + band. Design the upgrade to distributional answers: per-cell rate distributions (p10/p25/p50/p75/p90), estimated HONESTLY from small-n observation sets (shrinkage toward pooled/parent-specialty distributions, the variance-weighted posterior the bridge already computes, explicit widening when n is tiny — NEVER fake tight percentiles from thin data), how external benchmark percentile tables can seed priors (CITE which locum/physician comp sources actually publish percentiles), and the recruiter-facing UX: "this offer sits at ~p35 for this cell" + what to counter with. Include the data-model change (band -> distribution object), a migration path that keeps the current band API working, and how every percentile claim stays provenance-backed.' },
  { key: 'market-timing', file: 'briefs/25-market-timing.md', model: 'fable', verify: true, focus:
    'MARKET TIMING / TEMPORAL DYNAMICS (rates are a time series, not a constant). Research + design: seasonality in locum demand and rates (flu season, summer coverage, residency-transition July effect, holiday call), demand-surge events that spike rates (strikes, disaster response, mass resignations, new-facility openings), secular trends (specialty shortages driving multi-year rate climbs), and staleness decay (how fast an observation should lose weight). CITE evidence that these effects exist and their rough magnitude where published. Then map to the engine: recency weighting in the posterior, trend detection per cell ("EM in TX is moving up — quote ahead of the curve, not behind it"), surge flags, and a freshness SLA per cell. Distinguish what is buildable NOW from what needs more data history.' },
  { key: 'geo-granularity', file: 'briefs/26-geo-granularity.md', model: 'fable', verify: true, focus:
    'GEO GRANULARITY below the state level. Today the cell key is state-level. Research + design: metro vs rural rate differentials (rural/critical-access premiums are a core locum reality — CITE evidence), cost-of-living vs rate correlation (and where it inverts: undesirable locations pay MORE), state factors that shift effective attractiveness and thus rates (malpractice environment, IMLC licensure compact membership and licensing friction, certificate-of-need, physician-density/shortage HPSA data), and metro-level data sources (BLS OEWS is metro-granular — the engine already touches blsOewsBaseline.ts, check it). Then map to the engine: a geo-tier dimension (metro / non-metro / rural-critical-access) on the cell key WITHOUT exploding sparsity past what the data supports — propose the shrinkage hierarchy (cell -> state -> census-division -> national). Be explicit about what the current data can and cannot support.' },
]
const briefs = await parallel(PILLARS.map(p => () => agent(
  'You are a domain + systems researcher for a locum-tenens rate engine. ' + GUARD + '\n\n' + mapsCtx +
  '\n\nRESEARCH PILLAR:\n' + p.focus +
  '\n\nUse Read/Grep/Glob on the code (absolute paths under ' + ROOT + ') AND WebSearch/WebFetch for external facts. Then WRITE a thorough, cited brief as markdown to EXACTLY: ' + BASE + '/' + p.file +
  '\nStructure: Summary / Findings (cited) / Recommendations (each tagged impact+effort) / Open questions. Then return the schema. Put EVERY $ figure or corporate/behavioral claim you assert into claims_to_verify so a fact-checker can confirm it.',
  { label: 'brief:' + p.key, phase: 'Research', model: p.model, agentType: 'general-purpose', schema: DOC_SCHEMA }
).catch(() => null)))
log('Research done: ' + briefs.filter(Boolean).length + '/' + PILLARS.length + ' briefs written')

// ---------------- PHASE 3: VERIFY ----------------
phase('Verify')
const toVerify = PILLARS
  .map((p, i) => ({ p, brief: briefs[i] }))
  .filter(x => x.p.verify && x.brief && Array.isArray(x.brief.claims_to_verify) && x.brief.claims_to_verify.length)
const verdicts = await parallel(toVerify.map(x => () => agent(
  'You are an adversarial fact-checker. Default to skepticism; a claim is only "confirmed" with real evidence. ' + GUARD +
  '\n\nThe brief "' + x.p.key + '" (' + BASE + '/' + x.p.file + ') asserts these claims. For EACH, verify via WebSearch/WebFetch (for external $/market facts) or Read/Grep (for code-behavior claims). Mark confirmed / refuted / uncertain with evidence, and give a correction if refuted or if the real value differs.\n\nCLAIMS:\n' +
  x.brief.claims_to_verify.map((c, i) => (i + 1) + '. ' + c).join('\n') +
  '\n\nReturn brief_key="' + x.p.key + '" and the verdicts array.',
  // model: opus. The adversarial fact-check is the quality gate. Was Fable, but the
  // Fable 5 credit limit was hit mid-run (2026-07-03) — Zach switched to Opus to finish.
  { label: 'verify:' + x.p.key, phase: 'Verify', model: 'opus', agentType: 'general-purpose', schema: VERDICTS_SCHEMA }
).catch(() => null)))
const cleanVerdicts = verdicts.filter(Boolean)
const refuted = cleanVerdicts.flatMap(v => (v.verdicts || []).filter(d => d.verdict === 'refuted'))
log('Verify done: ' + cleanVerdicts.length + ' briefs checked; ' + refuted.length + ' refuted claims flagged for correction')

// ---------------- PHASE 4: SYNTHESIZE ----------------
phase('Synthesize')
const mapList = maps.filter(Boolean).map(m => '- ' + m.title + ' (' + m.doc_path + ')').join('\n')
const briefList = briefs.filter(Boolean).map(b => '- ' + b.title + ' (' + b.doc_path + ')').join('\n')
const allRecs = briefs.filter(Boolean).flatMap(b => (b.recommendations || []).map(r => ({ src: b.title, ...r })))
const verdictJson = JSON.stringify(cleanVerdicts).slice(0, 12000)
const synth = await agent(
  'You are the lead synthesizer. ' + GUARD +
  '\n\nA fleet mapped the rate simulator and researched every improvement pillar. READ all the maps + briefs (they are on disk):\n\nMAPS:\n' + mapList + '\n\nBRIEFS:\n' + briefList +
  '\n\nFACT-CHECK VERDICTS (apply these — DROP or CORRECT any refuted claim; flag uncertain ones):\n' + verdictJson +
  '\n\nAll recommendations collected (dedupe + rank):\n' + JSON.stringify(allRecs).slice(0, 12000) +
  '\n\nWRITE TWO documents:\n' +
  '1. ' + BASE + '/00-MASTER-REPORT.md — the definitive report. Sections: Executive Summary; Current-State Architecture (from maps); The Accuracy & Anti-Manipulation Doctrine (comp-factor taxonomy + threat model + harness); Full-Specialty Coverage Plan (the gap table + expansion phases — the sim must cover every locum specialty); The Percentile & Ground-Truth Doctrine (distributional quotes + actual-paid calibration loop + quote-vs-paid accuracy KPI); Market Timing & Geo Granularity; Portability Blueprint (headless core -> Discord/Slack/ATS/API); Competitive Moat; Data-Source Roadmap; and a prioritized "Top 10 Moves" table (impact x effort, each linking its brief). Weave the briefs; do not just list them. Apply the fact-check verdicts so NO refuted/fabricated number survives.\n' +
  '2. ' + BASE + '/BACKLOG.md — every recommendation as a scored, checkbox backlog item (impact, effort, pillar, source brief), sorted by impact-then-effort.\n\n' +
  'Also write reusable deep-research prompts to ' + BASE + '/research-prompts/ (one .md per pillar that future sessions can re-run to refresh that research). Return master_doc, backlog_doc, top_moves (the ranked move titles), and a summary.',
  // model: opus. The master synthesis is the deliverable. Was Fable, but the Fable 5
  // credit limit was hit mid-run (2026-07-03) — Zach switched to Opus to finish.
  { label: 'synthesize-master', phase: 'Synthesize', model: 'opus', agentType: 'general-purpose', schema: SYNTH_SCHEMA }
)

return {
  maps_written: maps.filter(Boolean).length,
  briefs_written: briefs.filter(Boolean).length,
  briefs_verified: cleanVerdicts.length,
  refuted_claims: refuted.length,
  master: synth && synth.master_doc,
  backlog: synth && synth.backlog_doc,
  top_moves: (synth && synth.top_moves) || [],
}
