# IMS Rate Simulator — Deep-Research Diagnostic Brief

_A complete, self-contained description of the IMS locum rate simulator, written by the engineering agent that builds it, for an external deep-research self-diagnosis session._

## Mission

The IMS **rate simulator** is the pricing brain that IMS recruiters use to quote locum (temporary, contract) physician and CRNA (Certified Registered Nurse Anesthetist) compensation. Given a specialty (and optionally a state/region, shift type, urgency, and request type such as clinical worked-day vs. on-call/callback/per-diem), it returns an estimated **pay rate** to the clinician (hourly or daily) and a **bill rate** to the client facility, plus a confidence label and a market-position view. Recruiters lean on these numbers in live negotiations, so being wrong in either direction has a direct business cost: quote too low and IMS loses the placement or the clinician; quote too high and IMS erodes margin or wins business it cannot staff profitably.

The same engine powers **two applications that share one codebase**: an older internal React dashboard (`ias-dashboard`, `src/features/rate-simulator`) and the newer Astro-based IMS hub (`imstaffing.ai/hub`), into which the engine is vendored read-only (`src/lib/rate-engine`) as a faithful port. Golden-master parity is byte-identical across 208 cases, so the two apps quote identically; any accuracy problem is an *engine* problem, not a port problem.

We want this deep-research session to **diagnose the engine's pricing accuracy and self-improvement architecture** and propose concrete improvements. Specifically: scrutinize how a displayed quote is actually computed, where the data pipeline injects noise or bias, why the system does not currently learn from recruiter outcomes, and how a sparse, multi-source, partially-adversarial rate-evidence corpus should be aggregated into a defensible point estimate and range. The goal is the most accurate locum rate simulator possible, across every specialty and every request type, given a hard real-world constraint: **IMS has no internal ground-truth on what it actually paid clinicians** (only what it billed), so accuracy must be earned by observe-and-cite market evidence and by bounding pay from above using bill rates, not by fitting to internal payroll.

## How To Use This Brief

Ingest this entire document before forming any conclusions. It is the only context you have about this system; there is no codebase access, so treat the descriptions of the quote path, the data bridge, the canonical view filter, the agent fleet, and the live data state as authoritative ground truth and reason from them precisely.

Then do four things, in order:

1. **Independently assess strengths and weaknesses.** Do not merely restate what the brief says is wrong. Re-derive the failure modes yourself from the described architecture, and actively look for problems the brief has *not* flagged (silent biases, degenerate edge cases, aggregation pathologies, confidence mislabeling, feedback-loop hazards). Note where the system is actually sound and should be left alone, so that recommended changes are surgical rather than sweeping.
2. **Research external best practices.** Bring in established techniques for the two hard problems at the core of this system: (a) **sparse, multi-source, adversarial rate aggregation** (robust location/scale estimation, inverse-variance and reliability weighting, source-family de-duplication, outlier and fabrication resistance, small-sample shrinkage/empirical-Bayes priors, censored/bounded observations); and (b) **self-calibrating pricing** under delayed and biased outcome feedback (online calibration, contextual bandits, conformal prediction for honest intervals, win/loss and selection-bias correction, exploration vs. exploitation when quotes influence the outcomes you learn from).
3. **Return concrete, prioritized, technically specific recommendations.** Rank by accuracy impact against implementation blast radius (be explicit that some changes move *both* live apps' quotes). For each, specify the mechanism (formula, data structure, or wiring change), the expected effect, the failure mode it removes, and how to validate it (e.g., against the golden master, the cited audits, or a held-out backtest). Distinguish quick correctness guards from architectural upgrades.
4. **Be skeptical and cite sources.** Challenge the system's current design choices and your own proposals. Where you assert a best practice, cite primary or authoritative sources (papers, standards, well-documented implementations) and flag where evidence is thin or where a technique's assumptions may not hold for this sparse, no-internal-ground-truth setting. Prefer "here is the tradeoff and the losing side" over confident monoculture advice.

## TL;DR

The IMS rate simulator quotes locum physician and CRNA pay and bill rates from a static per-specialty band (`spec.min/max/p70`) fed through `calculateRate()`, identically across two apps (a React dashboard and an Astro hub) that share a byte-identical engine port. A daily EC2/PM2 bridge turns a fleet of citation-carrying scraper/researcher agents (writing to Supabase `rate_intelligence`, ~56.6k rows, read through the `canonical_rate_intelligence` view that already excludes all 483 BLS/government rows by agent id) into two Firebase RTDB surfaces: a **legacy crude min/max/p70 band** and a **v2 variance-weighted (MAD + inverse-variance) bucketed posterior**. The core problem is that **the displayed quote is priced off the crude, confidence-blind legacy band** — where a single low-confidence scraped estimate can set the floor of the shown range — while the statistically sound v2 posterior is computed but used only for a display-only surface and never for the quote itself. Compounding this, the self-learning machinery (calibration, dampened bias clamping) is fully built but **starved**: the RTDB feedback store has zero entries because no mechanism captures recruiter outcomes, so the sim cannot improve from real results; CRNA in particular has no live locum-tagged rows and stays on a static $190–250 band. The engine is otherwise well-researched (a 14-specialty cited audit found 11/14 bands accurate; an adversarial 26-specialty request-type audit rejected 13 of ~17 proposed changes as fabricated), so the highest-leverage fixes are architectural rather than corrective: confidence-weight the legacy floor, promote the v2 posterior to drive the quote, wire feedback capture to feed the dormant calibrator, enrich fleet tagging (arrangement/rate-type) plus CRNA sources, and extract LocumSmart bill rates to bound pay from above — the only internal signal available in a system with no ground-truth on what IMS actually paid.

---

## Table of Contents
1. System Overview & End-to-End Architecture
2. How a Rate Is Actually Computed (the Quote Engine + Request Types)
3. Accuracy Guardrails: Sanity Ceilings, Aggregation & Anti-Skew
4. Where the Numbers Come From: the Data Pipeline & Agent Fleet
5. The Market Overlay & the Legacy-vs-V2 Split (What Actually Feeds the Quote)
6. Is It Improving Itself? Self-Learning, Calibration & the Feedback Loop
7. Current Accuracy Scorecard: Strengths, Weaknesses & Good-But-Could-Be-Better
8. Known Gaps, Limitations & the Improvement / Innovation Backlog
9. Open Research Questions for This Deep-Research Session
10. Appendix: Constants, Thresholds, Schema & Live Data State

---

## System Overview & End-to-End Architecture

The IMS locum rate simulator is, in one sentence, a tool that takes a description of a locum-tenens job (a clinical specialty, a place, a shift pattern, possibly an uploaded LocumSmart PDF) and returns a recommended hourly pay rate for the clinician, a derived agency bill rate, a confidence label, and a market-position visualization. Underneath that single output sits a surprisingly deep pipeline: a fleet of scraping agents, a Postgres warehouse, a daily aggregation job, two distinct Firebase real-time-database trees, a deterministic pricing engine, and two separate front-end applications that share that engine byte-for-byte. This section maps the whole thing end to end and, most importantly, makes explicit which path actually sets the number a user sees versus which path is sophisticated-looking decoration.

### The two applications, one engine

There are two user-facing apps, and they run the *exact same* pricing engine code.

1. **The old dashboard** is a React single-page application (the internal IMS dashboard, repo `ias-dashboard`, feature folder `src/features/rate-simulator`). This is where the engine was originally written and where the richest UI lives (cited-observation panels, a v2 market-data panel, a feedback form).

2. **The new IMS hub** is an Astro site served at `imstaffing.ai/hub`. It does not re-implement the engine; it *vendors* the engine source read-only into `src/lib/rate-engine` and wraps it in a thin Astro/TypeScript UI layer (`src/lib/hub/sim-adapter.ts`, `sim-render.ts`, `sim-live.ts`). The hub is a faithful port: a 208-case "golden master" test suite produces byte-identical output in both apps, so any quote the hub shows is the same number the dashboard would show for the same inputs.

The practical consequence is that everything said below about "the quote" is true of *both* apps simultaneously. They share the same Firebase backend (project `weekly-sync-451e2`), the same Supabase database (project `gbakzhibzotugfyktcrt`), and the same engine logic. This is deliberate (forking the backends would break internal precedence rules), and it means any change to the quote path has a blast radius of both apps at once.

A subtle but important divergence: the hub deliberately wires in **only** the legacy market overlay (`loadMarketRates`), not the variance-weighted v2 posterior reader (`loadMarketBuckets`) and not the Supabase-backed CRNA sanity envelope. So the hub is at full parity with the *quote* the dashboard produces, but it omits two display-only / sanity surfaces the dashboard has. The hub is not a worse quote path; it is a leaner port that happens to skip surfaces that never fed the quote anyway.

### The full data-to-quote pipeline (the big picture)

Here is the entire flow from raw web data to a displayed number. Read it top to bottom; the critical fork happens at the very end.

```
                          THE PRODUCERS (upstream, Python, EC2/PM2)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  agent-sdk fleet (scheduled cron):                                         │
  │    rate_scraper      — Firecrawl, ~24-29 agency/article sources + SerpAPI  │
  │    rate_researcher   — Tavily (13 specialties) + Exa neural search         │
  │    rate_observer     — cite-or-suppress (BUILT BUT UNSCHEDULED — idle)     │
  │    gov_data_syncer   — BLS/CMS, W2->locum premium x1.25, tagged "permanent"│
  │    rate_validator / rate_auditor / iron_dome — sanity + proposals          │
  │  Discipline: >=2 independent source FAMILIES to go live; $90/mo breaker;   │
  │  hard "no-fake-data" sum-check before every insert.                        │
  └───────────────────────────────┬──────────────────────────────────────────┘
                                   │ INSERT typed rows
                                   v
                    ┌──────────────────────────────────────┐
                    │  SUPABASE  public.rate_intelligence   │
                    │  ~56,632 rows. The observation spine. │
                    │  Each row: specialty, rate_low/high,  │
                    │  source, state, date_scraped,         │
                    │  agent_id, rate_type, arrangement,    │
                    │  content_hash, dedup_group_id, ...    │
                    └──────────────────┬───────────────────┘
                                       │ the bridge reads a VIEW, not the table
                                       v
                    ┌──────────────────────────────────────────────────────┐
                    │  VIEW  canonical_rate_intelligence                     │
                    │  Admits a row WHERE                                     │
                    │   (date_scraped >= 2026-05-20 AND agent_id IN          │
                    │      (rate_scraper, rate_researcher))                  │
                    │   OR (specialty IN canonical AND agent_id !=           │
                    │      unknown_legacy)                                   │
                    │  => EXCLUDES all 483 BLS/government rows by agent_id.  │
                    │  (Live-verified 2026-06-29: 0 BLS rows in the view.)   │
                    └──────────────────┬─────────────────────────────────────┘
                                       │ daily 04:00 UTC cron (EC2/PM2)
                                       v
            ┌──────────────────────────────────────────────────────────────────┐
            │  THE BRIDGE  scripts/data-refresh/aggregateBridge.ts               │
            │  (pure fn) + bridge-rate-intelligence.ts (IO wrapper)              │
            │  7-day window. Per row: quarantine cap-agents, drop never-anchor   │
            │  sources (ZipRecruiter/Adzuna), validity guard, drop unknown       │
            │  specialty. Then two-stage DEDUP-COLLAPSE (content_hash exact,     │
            │  dedup_group_id near) -> DISTINCT observations at flat weight 1.0. │
            │  Then computes TWO PARALLEL PRODUCTS per cell:                     │
            └───────────────┬───────────────────────────────┬───────────────────┘
                            │                               │
              CRUDE LEGACY BAND                   V2 BUCKETED POSTERIOR
        (computeLegacyBand: raw            (per specialty/state/rate_type:
         min(rate_low), max(rate_high),     family-collapse, 60% cap,
         p70 = min+(max-min)*0.7;           aggregateCell = MAD outlier
         now non-locum filtered)            reject + inverse-variance-weighted
                            │                mean + bimodal->null)
                            v                               v
        ┌───────────────────────────┐   ┌────────────────────────────────────┐
        │ FIREBASE RTDB              │   │ FIREBASE RTDB                      │
        │ rate-simulator/            │   │ rate-simulator/                    │
        │   market-rates/{spec}      │   │   market-rates-v2/{spec}/{state}/  │
        │ (crude min/max/p70 band)   │   │     buckets/{rate_type}            │
        └────────────┬──────────────┘   │ (weighted_mean, weighted_variance, │
                     │                   │  median, confidence, family_capped)│
                     │                   └──────────────────┬─────────────────┘
                     │                                      │
        loadMarketRates()                          loadMarketBuckets()
        reads at app init,                         reads on demand,
        MUTATES the static                         feeds ONLY a display
        SPECIALTIES band IN PLACE                  panel (MarketDataView /
        (spec.min/max/p70)                         hub never reads it at all)
                     │                                      │
                     v                                      v
        ┌──────────────────────────────┐         ┌────────────────────────┐
        │  THE ENGINE / THE QUOTE       │         │  DISPLAY-ONLY CONTEXT  │
        │  calculateRate(factors)       │         │  "Market rate" panel,  │
        │  prices off spec.min/max/p70  │         │  coverage tier badge.  │
        │  => THE NUMBER THE USER SEES  │         │  NEVER touches the     │
        └──────────────────────────────┘         │  quote.                │
                                                  └────────────────────────┘
```

### The critical fork: which path actually prices the quote

This is the single most important thing to understand about the system, and it is counterintuitive, so it is worth stating bluntly and repeatedly.

**The displayed quote is priced off a crude, confidence-blind min/max/p70 band. The statistically sound number is computed, shipped to Firebase, and then used only for a side panel — it never touches the quote.**

Concretely, the bridge produces *two* products for every (specialty) cell and writes them to *two separate Firebase trees*:

- **`rate-simulator/market-rates` (the LEGACY crude band).** For each specialty this holds three numbers: `min` (the raw minimum of all scraped `rate_low` values in the 7-day window), `max` (the raw maximum of all `rate_high` values), and `p70 = min + (max - min) * 0.70` — a flat linear interpolation, *not* a real 70th percentile of observed pay. This is confidence-blind: a single low-confidence scraped estimate that merely clears the ">=2 source families" gate can set the displayed floor. (The live example is anesthesiology's $240 floor, which comes from one `exa_semantic` locum estimate with `arrangement=unknown` and low confidence.)

- **`rate-simulator/market-rates-v2` (the proper POSTERIOR).** For each (specialty, state, rate_type) bucket this holds a real variance-weighted aggregate: a `weighted_mean` and `weighted_variance` computed by `aggregateCell`, which rejects outliers by modified z-score (`|0.6745·(x − median)/MAD| > 3.5`), then inverse-variance-weights the survivors, collapses corporate brand families to one vote each, caps any one family at 60% of weight, and refuses to emit a number at all for bimodal cells (returns `null`, tagged `manual_review_bimodal`). This is the good number.

Now the punchline. At application startup, both apps call `loadMarketRates()`, which reads the **legacy** tree and, for each fresh (<7 day) multi-source row, **mutates the static `SPECIALTIES` band object in place** — literally `spec.min = market.min; spec.max = market.max; spec.p70 = market.p70`. The quote is then computed by `calculateRate(factors)`, which reads `spec.p70` as its anchor and `spec.max` as its ceiling. So the quote is priced *entirely* off the crude overlaid band.

Meanwhile `loadMarketBuckets()` reads the **v2** tree and hands its variance-weighted posterior to exactly one consumer: `MarketDataView`, a display panel on the dashboard. (The hub does not even wire this reader in.) That posterior is rendered as a "Market rate" context panel and is then thrown away as far as the quote is concerned. `calculateRate` never sees it.

The result is a system that computes a careful, robust-statistics market estimate, displays it as context, and then prices the actual headline number off a much cruder band sitting one layer away. This is the central architectural weakness, and adopting the v2 posterior *as* the quote anchor is described throughout the codebase as the single biggest available accuracy upgrade. It is deferred precisely because it has high blast radius: it would move live quotes in both apps and break the byte-identical golden-master parity, requiring a full re-baseline.

### Why the engine still produces sane numbers despite a crude anchor

The crude band is not as dangerous as it sounds, because the engine wraps it in deterministic guardrails:

- The base anchor is `spec.p70` (the 70th-percentile interpolation of the band).
- A chain of multipliers is applied: geography (`STATE_MULT`, clamped roughly 0.88–1.38), shift (day 1.00 … holiday 1.35), facility (academic 0.85 … CAH 1.22), duration, a call toggle (×1.10), and a holiday toggle (×1.10). The *combined* multiplier is capped at 1.75.
- The final pay rate is then clamped to `spec.max` — the researched maximum. This is a one-way safety valve: multipliers can only ever pull a quote *down* toward a documented ceiling, never invent an unsupported high.
- The bill rate is `roundUp5(payRate / 0.80)`, i.e. pay divided by (1 − 20% margin), rounded up to the nearest $5.

So even though the *anchor* is crude, the engine cannot fabricate a number above the highest publicly observed rate for that specialty. The numbers are auditable and bounded; they are just not as statistically refined as the v2 path the system already computes.

### What feeds the band, and what was deliberately excluded from it

A historical worry — that BLS/government wage data dilutes the legacy band downward — is **false for the current bridge**, and this is worth nailing down because it changes how one reasons about the floor:

- The `gov_data_syncer` agent does emit BLS-derived rows (BLS W2 wages multiplied by a 1.25 W2→locum premium, tagged `rate_type=permanent_wage_proxy`, `arrangement=permanent`). But it writes them under its own `agent_id`, and the **canonical view excludes every such row by `agent_id`**. Live verification on 2026-06-29 found 0 BLS rows in the view versus 483 in the base table. BLS data therefore feeds only the sanity-check layer (`blsSanityCheck`), never the band.

- A **non-locum filter** was added (staged, uncommitted at the time of writing) to close a latent gap: the legacy band lacked the `permanent_wage_proxy` exclusion that the v2 precedence ladder already had. The real risk vector is a *scraped* W2 compensation-survey row (Doximity/Medscape/MGMA) that the classifier tags `permanent_wage_proxy` via a URL override but which enters the view under a scraper `agent_id`. There are 0 such rows in current data, so the filter is a **no-op today** — a correctness guard analogous to the never-anchor (ZipRecruiter) exclusion, not an accuracy mover. `agency_bill_rate` was *not* added to this filter because no scraper produces a bill-rate→market vector.

### The live data state, honestly

As of 2026-06-29 the warehouse holds ~56,632 rows, but the *typed* signal in the canonical market view is thin:

| rate_type | count (canonical market view, all dates) |
|---|---|
| scraped_article_estimate | 454 |
| advertised_clinician_pay | 239 |
| null (untyped legacy) | 186 |
| crowd_survey | 2 |
| permanent_wage_proxy | 0 |
| agency_bill_rate | 0 |
| actual_paid_locum | 0 |

Two things follow. First, the precedence ladder (`actual_paid_locum 4 > advertised_clinician_pay 3 > crowd_survey 2 > scraped_article_estimate 1`) rarely engages, because most rows are `null` or `scraped_article_estimate`; the higher tiers are empty. Second, **CRNA has 0 locum-tagged and 0 rate-type-classified live rows**, so the bridge produces nothing for it and it stays frozen on its static $190–250 curated band. Anesthesiology, by contrast, does go live: its legacy band reads `min 240 / max 450 / p70 387` from sources `serpapi/tavily/exa`, with the $240 floor being a single low-confidence Exa locum estimate (not BLS).

### What this system does NOT do (two honesty caveats)

Two capabilities that an outsider would assume exist do not:

1. **There is no internal pay ground truth.** IMS knows the *bill* rate inside LocumSmart but does not know what it actually *paid* clinicians — `ls_events` and `ims_jobs` carry no rate columns. So the entire accuracy program is "observe-and-cite the open market, and bound pay from above by the bill," never "compare against what we really paid." The bill is the only internal signal, and it bounds pay from above (pay ≤ bill × margin); wiring LS invoice/timesheet bill extraction is a known, not-yet-done lever.

2. **The self-learning loop is empty.** The engine ships a complete calibration machine — `loadSpecialtyCalibration` reads recruiter feedback, computes the mean ratio of accepted-to-simulated rate over the last 10 entries, and (with ≥3 entries and >3% deviation) nudges future quotes by a dampened, clamped factor (50% of observed bias, clamped to 0.85–1.15, never above `spec.max`). Every piece exists and is unit-tested. But the Firebase node it reads, `rate-simulator/feedback`, has **0 entries**, and no mechanism is wired to populate it. So the calibration multiplier is permanently 1.0 and the simulator does **not** currently learn from recruiter outcomes. Wiring a feedback-capture path is the named unlock for real self-learning.

### Where the live overlay actually flows (init-time mutation)

One operational nuance ties the architecture together. The market overlay is not a per-quote lookup; it is a **one-time, init-time, in-place mutation of a shared singleton**. At app boot, `configureEngine({ db, supabase })` injects the backends, then a single `loadMarketRates()` call walks the legacy tree and rewrites the `SPECIALTIES` object that `calculateRate` reads. On the hub the same thing happens in an isolated lazy chunk (`sim-live.ts` → `index.phase2` barrel, the only place Firebase is imported, keeping it out of SSR and the main bundle); it calls `configureEngine` then `loadMarketRates`, and because the build dedupes `SPECIALTIES` to one module instance, the next re-quote reflects live data. Any failure (offline, slow RTDB, a single-source overlay that gets suppressed) degrades silently to the static curated band. This design is why the quote is "live" without any network call at quote time — the live data has already been baked into the band the engine reads. It is also why the v2 posterior's absence from the quote is so structural: switching to it would mean changing what the engine reads at its core anchor, not just adding a second network read.

---

## How a Rate Is Actually Computed (the Quote Engine + Request Types)

This section is a hand-computation manual. After reading it, a person with a calculator should be able to reproduce, to the dollar, the pay rate and bill rate the IMS rate simulator shows for any assignment, for both the standard hourly path and the non-hourly "request type" (call/per-diem) path. Every constant, multiplier, clamp, and rounding rule below is the actual value in the engine, not an illustration.

A few framing facts that govern everything below:

- The displayed quote is computed by a single deterministic function (`calculateRate` for hourly work, `calculateCallRate` for call-only work) off a **static, researched per-specialty band** — three numbers `min`, `max`, and `p70`. Live scraped market data, when present, overwrites those three numbers in place before the math runs, but the math itself is identical either way.
- The engine can only ever pull a quote **down** toward a documented ceiling. There is no path by which the math invents a number higher than the researched maximum for that specialty. Every multiplier compounds, but two hard clamps (a combined-multiplier cap of 1.75 and the researched `spec.max`) bound the result.
- When the engine cannot defensibly produce a number (an unknown call-only day-type, a specialty with no researched band), it emits a null / "insufficient data" state and shows an honest "we could not price this" surface. It never fabricates a daily stipend or a fallback dollar figure.

---

### 1. The factor model: turning an assignment into a `RateFactors` object

Before any arithmetic, the parsed assignment is converted into a structured set of **factors**. Think of factors as the dials the pricing formula reads. The orchestrator function `initFactors()` produces a `RateFactors` object with these fields:

- `specialty` — resolved to one of ~70 canonical specialties (with a `source` of either a real match or `default`).
- `state` — resolved to a US state (or `default` if none found).
- `rural` — boolean, but note: it is **neutralized to a multiplier of 1.0** regardless (explained below).
- `shift` — one of `day`, `night`, `weekend_day`, `weekend_night`, `holiday`.
- `facility` — one of ~12 facility types (academic, community, ASC, CAH, VA, etc.).
- `duration` — one of `emergency`, `short`, `standard`, `long`.
- `call` — boolean (does the assignment include call?).
- `holiday` — boolean (does it include a worked holiday, as distinct from PTO).
- `rateCap` — an optional cap extracted from a PDF (e.g. a stated maximum bill rate), with a unit (`hour`, `day`, `shift`, `unknown`).
- `baseRate` — set to `spec.p70` (the anchor; see §2).
- `callOnly` — a sub-object: `{ isCallOnly: boolean }`.
- `dayType` — `weekday` / `weekend` / `holiday` (only meaningful on the call-only path).
- `includedHours` (a.k.a. gratis hours) and `callbackRate` — call-only fields.

Each factor carries a `source`. If `source === 'default'`, that factor was not positively identified from the input; this matters for confidence scoring (§6).

**Specialty resolution** (`mapSpecialty`) tries, in order: (1) exact match against the specialty table keys; (2) exact match against an alias table; (3) a length-sorted alias scan where very short aliases (`id, em, er, gi, ir, aa, np, pa, fm, im, rad, ent, uro, cap, pmr`) require a whole-word regex match while longer aliases use plain substring `includes`; (4) a length-sorted substring scan of all specialty keys; (5) if all fail, **default to `internal medicine`**. A context-refinement pass (`refineSpecialtyFromContext`) then upgrades obvious cases: internal/family medicine in ICU text becomes `critical care`; in hospitalist/inpatient text becomes `hospitalist`; pediatrics becomes PICU or peds-hospitalist; EM/hospitalist in overnight text becomes `nocturnist`. Importantly, the text scanned for refinement is **values-only** — field labels like `ICU Coverage Required:` are stripped so that the word "ICU" in a label cannot mis-trigger a critical-care upgrade.

The silent default-to-internal-medicine on a miss is a real weakness: an unrecognized specialty is priced as internal medicine, and the only signal to the user is a Low confidence label.

---

### 2. Base anchoring: the p70 of a researched min/max band

Every specialty has a researched band `{ min, max }`. The anchor the formula starts from is `p70`, defined as:

```
p70 = round( min + (max - min) * 0.70 )
```

That is, p70 sits 70% of the way from the band floor to the band ceiling. It is **not** a true 70th percentile of observed pay — it is a flat linear interpolation. A more general helper exists for the market-position bar:

```
getPercentileRate(spec, pctl) = round( min + (max - min) * (pctl/100) )
```

`calculateRate` sets `base = f.baseRate || spec.p70` (in practice `baseRate` is itself `spec.p70`, so the anchor is the p70).

**Representative bands** (min – max, p70 in parentheses):

| Specialty | min | max | p70 |
|---|---|---|---|
| Anesthesiology | 300 | 400 | 370 |
| CRNA | 190 | 250 | 232 |
| Internal medicine | 130 | 200 | 179 |
| Hospitalist | 145 | 240 | 213 |
| Emergency medicine | 200 | 300 | 270 |
| Neurosurgery | 330 | 480 | 435 |
| Urology | 220 | 330 | 297 |
| Radiology | 185 | 330 | 287 |
| Psychiatry | 180 | 255 | ~233 |
| NP/PA (primary care) | 70 | 95 | ~88 |

(Internal medicine, urology, and radiology bands shown here are the audit-corrected, widened values.)

---

### 3. The multiplier chain (hourly path)

`calculateRate` multiplies the base by a chain of independent multipliers, each looked up from a flat table. The chain is:

```
combinedMult = geo × rural × shift × facility × duration × call × holiday
```

Each term's exact values:

**Geography (`STATE_MULT`)** — derived once at module load, per state, from cost-of-living, physician density, and demand. The formula is:

```
geo = clamp( (100 / COLI)^0.30 × (304 / density)^0.30 × demandWeight^0.40,  0.88, 1.38 )
```

rounded to two decimals. Constants: `AVG_COLI = 100`, `NATIONAL_AVG_DENSITY = 304`. Demand weights: critical 1.30, high 1.15, moderate 1.05, adequate 0.95, surplus 0.90. A missing/unresolved state yields **1.0** (no geo adjustment). The multiplier is clamped to the range **0.88–1.38**, so geography alone can move a quote at most −12% to +38%. Geography is **state-granular only** — there is no metro/MSA resolution feeding the multiplier (city detection only flips the rural boolean, which is itself neutralized).

**Rural (`ruralMult`)** — hard-coded to **1.0** always. Rural scarcity is considered already priced into the state-level geo demand weight; an explicit rural bump on top was double-counting and over-quoting (the in-code example cites a CRNA assignment in Kokomo, Indiana being over-quoted), so it was neutralized.

**Shift (`SHIFT_MULT`):** day 1.00, night 1.20, weekend_day 1.15, weekend_night 1.30, holiday 1.35.

**Facility (`FACILITY_MULT`):** academic 0.85, community 1.00, asc 0.90, outpatient 0.90, cah (critical-access hospital) 1.22, va 0.85, correctional 0.92, fqhc 0.88, psych 1.12, rural_trauma 1.30, freestanding_ed 1.08, telehealth 0.75.

**Duration (`DURATION_MULT`):** emergency 1.20, short 1.10, standard 1.00, long 0.95. (Longer assignments pay slightly less per hour; emergency/short fills pay a premium.)

**Call toggle:** `callMult = hasCall ? 1.10 : 1.00`.

**Holiday toggle:** `holidayMult = (hasHoliday && shift !== 'holiday') ? 1.10 : 1.00`. The `shift !== 'holiday'` guard prevents double-counting: if the shift is already the holiday shift (1.35), the separate holiday toggle does not also fire.

---

### 4. The clamps: 1.75 combined cap, the PDF rate-cap, and the researched-max ceiling

After computing `combinedMult`, three clamps apply in order.

**(a) Combined-multiplier cap of 1.75.** No matter how many premiums stack:

```
cappedMult = min( combinedMult, 1.75 )
payRate = base × cappedMult
```

A boolean `capped = (combinedMult > 1.75)` records whether this fired. This caps total uplift at +75% over the p70 anchor.

**(b) PDF rate-cap clamp (hourly).** If the assignment PDF stated a cap and its unit is `hour` or `unknown`:

```
capPay = stated_cap × 0.80
if (payRate > capPay) payRate = capPay
```

The ×0.80 converts a stated **bill** cap into an implied **pay** ceiling at the 20% margin. (Caps stated in `day` or `shift` units are dropped on the hourly path; they only apply on the call-only path.)

**(c) Researched-max ceiling.** Finally:

```
if (payRate > spec.max) { payRate = spec.max; marketMaxApplied = true; }
```

`marketMaxApplied` is deliberately kept as a **separate flag** from `capped`, because downstream calibration logic must be allowed to nudge a quote even when it has been clamped to the researched max — the two clamps mean different things and must not be conflated.

The practical consequence: a high-geography, premium-facility assignment frequently hits `spec.max` and renders at the far-right edge of the market-position bar. This is intended (it bounds over-quoting), but it also flattens differentiation — many "hot" assignments all pin to the same ceiling.

---

### 5. Bill rate: `roundUp5(pay / 0.80)`

The agency bill rate is derived from pay by a fixed 20% margin, then rounded **up** to the nearest $5:

```
roundUp5(v) = ceil(v / 5) * 5
billRate = roundUp5( payRate / 0.80 )
```

`payRate / 0.80` is `pay / (1 - margin)` with `margin = 0.20`. The 0.20 margin constant is used everywhere in the engine. Note: the bill is always recomputed fresh from pay and re-rounded; the engine never scales an already-rounded bill (which would compound rounding error).

In the hub UI the recruiter can move a margin slider (15–45%), in which case the displayed bill uses `roundUp5( pay / (1 - margin) )` at the chosen margin, but the **call-only** path always uses the fixed 20% margin regardless of the slider.

---

### 6. Confidence scoring

Confidence is **structural, not statistical** — it measures how many factors were positively identified, not how good the underlying market data is. `scoreConfidence` computes:

- `specKnown = (specialty.source !== 'default')`
- `stateKnown = (state.source !== 'default')`
- `supporting` = count of `{ shift, facility, duration, call, holiday, rural }` whose `source !== 'default'`

Then:

- **High** if `specKnown && stateKnown`.
- **Medium** if `specKnown` (specialty known but state unknown).
- **Low** otherwise (specialty itself was defaulted).

The hub layer additionally takes the **weaker** of this structural confidence and a per-specialty data-tier confidence (`high`/`medium`/`low`/`modeled`), so a perfectly-identified CRNA assignment reads **Medium** rather than High because the CRNA band itself is only lightly researched. This is an honesty refinement: identifying every field well does not make a thinly-sourced band trustworthy.

The weakness: "Medium" is the catch-all for almost every real quote (specialty is nearly always identifiable, even if only by defaulting), so confidence carries less signal than it appears to.

---

### 7. A full hand-computation worked example (hourly)

Assignment: **Emergency medicine, night shift, critical-access hospital (CAH), in a high-demand state whose geo multiplier resolved to 1.10, 8-week assignment (standard duration), no call, no holiday, no PDF cap.**

1. Base: EM band 200–300, p70 = round(200 + 100×0.70) = **270**.
2. Multipliers: geo 1.10 × rural 1.00 × shift(night) 1.20 × facility(cah) 1.22 × duration(standard) 1.00 × call 1.00 × holiday 1.00.
3. combinedMult = 1.10 × 1.20 × 1.22 = **1.6104**.
4. 1.6104 < 1.75, so no combined cap. payRate = 270 × 1.6104 = **434.81**.
5. Researched-max ceiling: spec.max for EM is 300. 434.81 > 300, so **payRate = 300**, `marketMaxApplied = true`.
6. Bill: roundUp5(300 / 0.80) = roundUp5(375) = **375**.

Result: pay **$300/hr**, bill **$375/hr**, and the quote is pinned at the EM ceiling (which is why it renders at the right edge of the market bar). This example shows the dominant real-world behavior: premium stacks routinely exceed `spec.max` and clamp.

A non-clamping example: **Internal medicine, day shift, community facility, standard duration, geo 1.05, no call/holiday.** Base p70 = 179. combinedMult = 1.05. payRate = 179 × 1.05 = 187.95 → under spec.max 200, no clamp. Bill = roundUp5(187.95/0.80) = roundUp5(234.94) = **235**. Pay **~$188/hr**, bill **$235/hr**.

---

### 8. The freetext / PDF parser

The quote can be driven from three input forms, all of which funnel into the same `ParsedAssignment` → `initFactors` pipeline:

- **A LocumSmart PDF.** Text is extracted (in the hub, in-browser via pdfjs with a same-origin worker), then run through `parseLocumsmartAssignment`, which pulls structured fields via `extractValue` / `extractBlock` / `parseSection` / `parseFacilities`. It reads specialty, facilities, sections, notes, and the raw text.
- **Free text** (a recruiter pasting a description). This goes through `buildParsedFromFreetext`, which uses fuzzy matching plus keyword tables to detect specialty, state, city, shift, facility, call, holiday, and duration.
- **A "recent jobs" record** from the live job feed, adapted into a `ParsedAssignment` for pre-fill.

**Fuzzy matching mechanics** (`fuzzyMatch.ts`): a minimum target length of **4** characters — tokens shorter than 4 require exact equality (so "id" won't loosely match). Matching is one-way substring (`candidate.includes(token)`), and when multiple keys match it returns the **shortest** matching key (heuristic for "most specific"). State matching is **exact-or-nothing** — a typo'd state name yields no state, hence geo 1.0.

**Keyword matching guard** (`matchesKeyword`): keyword detection uses a word-boundary regex `\b<keyword>\b` rather than naive substring. This closes a class of false positives: `asc` no longer matches "vascular", "cardiovascular", or "ascension"; `va` no longer matches "Pennsylvania" or "Nevada"; `clinic` no longer matches "clinical".

**Failure behavior:** if the parser cannot resolve a specialty (`specialty.source === 'default'`), the parse returns null and the UI shows an honest "could not read it" message and changes nothing — it does not silently price the input as internal medicine. A sequence guard prevents a stale parse (from an earlier drop) from overwriting a newer one.

The parser is robust but heuristic: holiday/call/rate-cap detection is regex over OCR-variable PDF text, so a novel LocumSmart layout can leak or miss a field.

---

### 9. The request-type / call-rate engine

A large share of locum work is not paid hourly. It is paid as **call coverage** (a daily stipend for being on-call), as a **worked clinical day** (a flat daily for showing up and working a defined shift), as a **callback differential** (an hourly figure that kicks in once you are actually called in), or it carries a **GSA travel per-diem**. These are priced by an entirely separate path: `calculateCallRate`, dispatched when `detectCallOnly()` flags the assignment as call-only.

**Dispatch.** `detectCallOnly()` inspects the parsed assignment for: a "Call Only" field, a coverage/call type indicating beeper or home call **without** scheduled clinical hours, "24hr call coverage" language without clinical duties — with a negation guard ("not call only") and the same values-only/label-strip hardening as specialty refinement. If call-only, the engine resolves a `dayType` (weekday / weekend / holiday) via `inferDayType()`. At the call site the dispatch is a single branch: `isCallOnly → calculateCallRate()`, else `→ calculateRate()`. The two return a discriminated union keyed on an `isCallOnly` literal so the UI renders the right surface.

**The static day-type band table.** Each specialty has a `CallRateEntry` with three nullable slots — `weekday`, `weekend`, `holiday` — each holding **one** `CallRateBand { min, max, typical, compModel, coverageHrs }` or null, plus shared `callback`, `gratisHrs`, `sources`, and a `note`. Bands are built by two factory helpers:

- `beeper(min, max, typical)` → `compModel = '24hr-beeper-call'`, `coverageHrs = 24`.
- `worked(min, max, typical, coverageHrs)` → `compModel = 'worked-day-clinic'`.

Here `typical` is the multiplier base, `max` is the researched clamp ceiling, `min` is contextual. The comp model determines the per-hour divisor at display time (below). These bands are **pure static research constants** — they do **not** consume the live RTDB market overlay or the v2 posterior, so live scraping never moves a call-only quote today.

**Call-only math.** `calculateCallRate` looks up the band for the resolved day-type and computes:

```
combinedMult = geo × rural(=1.0) × facility × duration       // NO shift/call/holiday term
cappedMult   = min(combinedMult, 1.75)
dailyPay     = typical × cappedMult
if (dailyPay > band.max) dailyPay = band.max                  // researched clamp
// then a day/shift PDF rate-cap if present: cap × 0.80
```

The reason there is **no shift/call/holiday multiplier** here is that the day-type itself (weekday vs weekend vs holiday band) already encodes that premium — applying a shift multiplier on top would double-count.

A **null band yields `dailyPay = 0`, `sufficient = false`, `insufficientData = true`**, and the UI renders a "CallInsufficientCard" while suppressing the market, bill, and feedback panels so a misleading $0 never leaks. The engine never derives a daily stipend from an hourly rate.

**The daily → $/hr conversion (display only).** The hero number shown is always a per-hour figure, computed at presentation time:

```
heroPay = round( dailyPay / coverageHrs )
```

where `coverageHrs` is **24 for a beeper-call** band and the scheduled shift length (8 / 10 / 12) for a worked-day band, with a floor of 1. Critically this divides by **coverage hours, not gratis hours**. Dividing a 24-hour beeper stipend by the 2–4 gratis hours before callback was the old bug that produced absurd ~$821/hr neurosurgery quotes; dividing by 24 is the honest denominator. The subline still shows the raw daily (`$X/day`), the comp-model label, the coverage hours, and the public source count.

**Callback.** The callback differential is the band's midpoint, `round((callback.min + callback.max) / 2)`, and is **not** geo-scaled — it is a cited flat contract rate, so scaling it would break provenance. `gratisHrs` (included free hours before callback applies) is carried alongside.

**Bill on the call-only path:** `roundUp5(dailyPay / 0.80)` — fixed 20% margin, never the hourly margin slider.

**Representative call bands** (illustrating the structure):

- OB/GYN: weekday `worked(3900, 4200, 4050, 12)` + weekend `beeper(1500, 1800, 1650)`.
- Neurosurgery: weekday & weekend `beeper(4200, 4800, 4500)`, callback 475, gratis 4.
- Anesthesiology: weekday `worked(2675, 3900, 3300, 12)`, callback 400–500.
- Neurology: weekday `worked(1800, 3500, 2750, 10)`.
- Urology: weekday `beeper(2500, 3500, 3150)`, weekend `beeper(2500, 3000, 3000)`, callback 350–450, gratis 4 (5 sources).
- Cardiology: `beeper(2500, 2500, 2500)`, callback 350 — and deliberately does **not** use the $3,200 worked-day figure as a beeper ceiling (comp models are not mixed).

**Worked call-only example:** anesthesiology, weekday, geo 1.05, community facility (1.0), standard duration (1.0). combinedMult = 1.05. dailyPay = 3300 × 1.05 = 3465, under band.max 3900, no clamp. Worked-day coverageHrs = 12, so heroPay = round(3465/12) = **$289/hr**, with subline "$3,465/day". Bill = roundUp5(3465/0.80) = roundUp5(4331.25) = **$4,335/day**.

**GSA per-diem** is a separate travel-stipend lookup (`lookupGsa(city, state)`) keyed against a hand-maintained `GSA_OVERRIDES` table with a `GSA_STANDARD` fallback. FY2026 values:

- Standard fallback: lodging 110, M&IE 68, total **178**.
- ~120 city overrides, e.g. Boston MA 349/92/441; New York/Manhattan 342/92/434; San Francisco 272/92/364; Park City UT 483/92/575; Key West FL 436/86/522; Aspen CO 407/92/499; Washington DC 276/92/368; Augusta GA 125/74/199.

The GSA table was audited correct in the 26-specialty request-type audit. Its weakness is that it is hand-maintained constants and silently goes stale at FY rollover.

---

### 10. The one-band-per-slot limit (the central structural weakness of the request-type engine)

Each `CallRateEntry[dayType]` slot holds **a single `CallRateBand | null`**. A specialty therefore cannot hold **both** a worked-day band **and** a beeper-call band for the same day-type. This is not a missing feature; it is a correctness ceiling:

- Anesthesiology currently carries only the **worked-day** band. A real anesthesiology assignment that is genuinely **beeper-call** gets priced against (or suppressed by) the worked-day band, because the slot physically cannot hold the beeper axis. This is exactly the kind of comp-model mismatch the rest of the engine works hard to avoid — and it is a deferred item precisely because fixing it requires a schema change (making each slot hold an array or a `{worked, beeper}` pair).
- Neonatology cannot add a daily band beside its existing adjacent-hourly figure for the same reason.
- `inferDayType()` only chooses among weekday / weekend / holiday — it has no axis to choose the **comp model** (worked vs beeper), so even if both existed, the engine has no selector for them.

Lifting this limit is described as the single biggest structural unlock available to the request-type engine.

Other request-type weaknesses worth stating plainly:

- **Sparse coverage.** Many specialties have all-null slots and fall to `insufficientData`. Many single-source bands are point estimates with `min == max == typical` (e.g. trauma, interventional cardiology, internal medicine, pediatrics) — they present as precise but are weakly supported (`sources: 1`).
- **Holiday almost always null.** Nearly every specialty's holiday slot is null, so a holiday call-only assignment usually resolves to insufficient-data even when weekday data exists.
- **Weekend frequently mirrors weekday or is null** — weekend premium is often unmodeled.
- **No live data, no learning ever reaches call/per-diem.** The call-only path is fully static; even when fleet scraping resumes, call quotes stay frozen on the table until rows are tagged by request type and a feedback loop is wired.
- **`detectCallOnly` is heuristic** over messy PDF text; a worked-clinical-day-plus-call assignment can be misrouted onto the call-only path (or vice-versa), and the two paths price very differently.

---

### 11. Putting it together: the full decision tree a human would follow

1. Parse the input (PDF / freetext / job record) into a `ParsedAssignment`.
2. Run `initFactors` → resolve specialty (default to internal medicine on miss), state, shift, facility, duration, call, holiday, rate-cap, and the call-only flag + day-type.
3. **Branch on `callOnly.isCallOnly`:**
   - **Hourly path** (`calculateRate`): base = p70 → multiply geo × rural(1.0) × shift × facility × duration × call × holiday → cap combined at 1.75 → apply hourly PDF cap (×0.80) → clamp to `spec.max` → bill = roundUp5(pay/0.80).
   - **Call-only path** (`calculateCallRate`): look up the day-type band; if null → insufficient data, stop. Else base = `band.typical` → multiply geo × rural(1.0) × facility × duration → cap at 1.75 → clamp to `band.max` → apply day/shift PDF cap (×0.80) → that is the daily; hero $/hr = daily / coverageHrs (24 beeper, 8/10/12 worked); bill = roundUp5(daily/0.80); callback = midpoint of callback band, not geo-scaled.
4. Score confidence structurally (High if specialty+state known; Medium if specialty known; Low otherwise), then in the hub take the weaker of that and the specialty's data tier.
5. Render: hero pay, derived bill, confidence, researched range, and a market-position bar with percentile chips (25/50/70/75/90) computed by linear interpolation across the adjusted band, plus a premium-tier overlay (p75→p90) — all of which are presentational and do not change the headline number.

The deepest honest caveat for anyone hand-computing: the number you reproduce is anchored to a **crude, confidence-blind researched band** (a single low-confidence scraped estimate that survives a two-source gate can set the displayed floor), and the more statistically defensible variance-weighted posterior the system also computes is shown only as context — it never feeds the quote. The math above is exact and reproducible; what it is anchored *to* is its main accuracy limitation.

---

## Accuracy Guardrails: Sanity Ceilings, Aggregation & Anti-Skew

This section documents the defensive verification and aggregation layer of the IMS locum rate simulator: the set of statistical and rule-based guardrails that catch implausible quotes, fuse noisy multi-source scraped evidence into a robust estimate, and exclude degenerate or correlated inputs before any number is allowed to influence a band. Two structural facts frame everything below and must be held in mind throughout:

1. **Most of this layer verifies and displays; it does not price the quote.** The displayed quote is computed by `calculateRate()` off a static researched band (`spec.min/max/p70`), optionally overlaid by a crude min/max/p70 derived from recent scraped rows. The high-quality statistical machinery described here (the variance-weighted posterior, the BLS sanity verdict, the CRNA envelope) sits *beside* that quote path. It grades, bounds, and informs, but with one critical exception (the researched-max clamp baked into the engine) it does not currently set the number a recruiter sees. This is the single most important honesty caveat in the entire section.

2. **The guardrails live in two physical places.** Some run inside the engine/data layer at read time (`blsSanityCheck.ts`, `crnaCellLookup.ts`, `cellAggregation.ts`, `sourceFamily.ts`). Others run inside the daily ETL bridge (`scripts/data-refresh/lib/aggregateBridge.ts`) that transforms raw Supabase scrape rows into the Firebase bands. Crucially, **the 60% corporate-family weight cap and the never-anchor row exclusion are enforced in the bridge, not in the engine** — the engine's `sourceFamily.ts` only *labels* families and *flags* never-anchor IDs; the bridge does the actual collapsing, capping, and exclusion-by-absence.

The rest of this section walks each guardrail, the exact numbers and formulas behind it, and — critically — what failure mode each one prevents.

---

### The BLS-OEWS Sanity Check: catching gross over/under-quotes against a wage floor

**What it is.** For any computed quote `(specialty, state, displayed hourly rate)`, the engine can independently ask "is this number even plausible given what this specialty earns as a salaried W2 employee in this state?" That question is answered by `blsSanityCheck.ts` against a frozen May-2024 BLS Occupational Employment and Wage Statistics (OEWS) snapshot embedded as a static module (`blsOewsBaseline.ts`).

**How it computes an expected locum hourly.** The flow is:

1. Map the simulator specialty to a federal SOC (Standard Occupational Classification) code via an **88-entry `SPECIALTY_TO_SOC` table**. (Example mappings: anesthesiology → 29-1211, family/internal medicine → 29-1216/29-1229 families, CRNA → 29-1151.)
2. Look up the state's BLS wage for that SOC, preferring the **median (p50)**, falling back to the **mean**, then to an aggregate physician code (29-1229 / 29-1249) if the specific SOC has no state cell.
3. Multiply that W2 wage by a **`LOCUM_MULTIPLIER`** keyed on a coarse "SocFamily" bucket to convert a salaried wage into an expected *locum* hourly. These multipliers range **1.35 to 3.50**:

   - NP_PA 1.45 · NP_PA_SPECIALTY 1.90 · NP_PA_HIGH 2.20 · ANESTHESIA_APP (CRNA) 3.50 · NURSE_ADVANCED 2.05
   - PHYSICIAN_LOW 1.35 · PHYSICIAN_CORE 1.95 · PHYSICIAN_HOSPITALIST 2.45 · PHYSICIAN_SUBSPECIALTY 2.35 · PHYSICIAN_EM_HIGH 2.45 · PHYSICIAN_PSYCH_HIGH 2.40 · PHYSICIAN_HIGH 2.35 · PHYSICIAN_HIGH_PREMIUM 3.10
   - SURGEON_CORE 1.70 · SURGEON_HIGH 2.20

   The result is `expectedHourly`.

4. Compute `deviationPct = (displayed - expected) / expected`.

**The verdict thresholds.** The deviation is bucketed into `aligned` / `soft` / `hard`:

- `FIXED_SOFT = 25` (a quote within ±25% of expected is *aligned*; beyond that is at least *soft*).
- `FIXED_HARD = 40` (beyond ±40% is *hard*).
- **Band-aware mode:** when the BLS cell carries p25/p75 percentiles, the engine replaces the fixed 25% soft floor with the *actual* half-band-width (as a percent of expected), and sets `hardThreshold = max(40, halfWidth + 25)` (`BAND_HARD_GAP = 25`). This adapts tolerance to the real observed wage dispersion of that specialty/state rather than a flat percentage — a tight-spread specialty gets a tight tolerance, a wide-spread one gets a wide one.
- **Mean-noise cap:** if the lookup fell back to the *mean* (noisier than a median), any `hard` verdict is demoted back to `soft` *unless* `|deviation| ≥ 1.5 × hardThreshold` (`MEAN_CAP_RATIO = 1.5`). This prevents a noisy mean from triggering false alarms.

**Honest-by-omission.** Call-only quotes, unknown state, unmapped specialty, and suppressed BLS cells all return verdict `unavailable` — the check is simply *hidden*, never fabricated. The simulator never invents a sanity verdict it cannot ground.

**What it prevents.** The BLS sanity check is the backstop against a *gross* mispricing — a quote that has drifted far from any defensible wage anchor (e.g. a parsing bug or an outlier scraped overlay pushing internal medicine to $400/hr, or under-quoting a surgeon at $90/hr). It is an independent second opinion grounded in federal wage data, computed from a completely different input path than the quote itself.

**Honest weaknesses.** (a) The output is currently consumed by a *display chip* in `MarketContext.tsx`, not by the quote — a `hard` over-quote verdict shows a warning but does **not** clamp or widen the number. (b) The `LOCUM_MULTIPLIER` values (1.35–3.50) are self-described as "observation-derived midpoints, NOT primary-source-cited" — they are the single largest lever on `expectedHourly`, and they are judgement, not evidence. A wrong multiplier silently biases every verdict for that family. (c) The May-2024 baseline is frozen in a static module; it ages silently with no automated freshness check. (d) Only CRNA has a per-specialty hard ceiling (see iron-dome below); every other specialty relies solely on the deviation bands for an over-quote backstop.

---

### The CRNA Cell Envelope and the UnitedHealthcare Cut

CRNA is special-cased because it is the simulator's most scrutinized specialty and because it sits in a market disrupted by a specific 2025 payer action. CRNA quotes route to a dedicated v4 envelope, `getCrnaCellEnvelope()` in `crnaCellLookup.ts`, instead of the generic sanity path.

**The envelope formula.**

```
expectedHourly = BLS_state_p50 × LOCUM_MULT_CRNA(state, arrangement) × (1 − UHC_cut)
```

- **`LOCUM_MULT_CRNA` is empirically derived** by `deriveLocumMultCrna()` from IAS booking rows via a 4-step fallback ladder: state-level multiplier if `n ≥ 5` bookings → census-division level if `n ≥ 10` → national if `n ≥ 50` → literature default. The literature defaults by employment arrangement are: `w2_employee 1.0`, `locum_w2 1.4`, `1099_independent 1.6`, `locum_1099 1.7`.
- **The UHC cut** models UnitedHealthcare's reimbursement reduction for nurse anesthesia: `UHC_CUT_PCT = 0.15` (a 15% haircut), applied only on/after `UHC_CUT_EFFECTIVE_DATE = 2025-10-01`, and only in **non-exempt states**. The exempt set is `{AR, CA, CO, HI, MA, NH, WY}`. The variance of the envelope scales by `(locumMult · uhcFactor)²` so the uncertainty propagates correctly through both adjustments.

**The 5-tier evidence-depth dispatch.** `assignTier()` honestly grades how much real evidence backs the envelope, rather than presenting every CRNA quote as equally certain:

- `HIGH` — `iasStateBookings ≥ 10` AND `distinctSources ≥ 2`
- `MULTI-SOURCE` — `sources ≥ 2` AND (`state bookings ≥ 5` OR an independent scraper agrees within ±15%)
- `DERIVED` — `iasDivisionBookings ≥ 10`
- `PUBLIC-HINT` — public data only
- `MANUAL-ESCALATION` — BLS cell suppressed, or evidence is bimodal; the caller then falls back to a legacy `BLS × 2.05` path.

**What it prevents.** The envelope prevents two CRNA-specific errors: (1) quoting a stale pre-cut CRNA rate in a market where UHC has cut reimbursement 15% (the cut is date- and state-gated so it applies exactly where and when it is real), and (2) over-stating evidence depth — the tier badge tells the user honestly whether the number is triangulated from real bookings or merely a BLS-times-prior estimate.

**Honest weakness — the tiers are aspirational today.** Per live data state, IAS RTDB has **0 actual paid CRNA rates** and CRNA has **0 locum-tagged, 0 rate-type-classified live rows**. Consequently `deriveLocumMultCrna` perpetually falls through to the *literature default*, and the dispatch caps at `PUBLIC-HINT`. The "5-tier triangulated model" is, in practice today, **BLS × literature-prior**, dressed in triangulation language. CRNA therefore stays on its static `$190–250` band. This is the clearest case in the system where the UI badge could overstate evidence depth, and it is honestly a risk worth flagging.

---

### `aggregateCell`: the MAD + IVW posterior, confidence tiers, and bimodal handling

`aggregateCell()` in `cellAggregation.ts` is the shared statistical core that fuses a list of scraped observations for one cell into a single robust posterior. It is used in two places — the bridge's v2 bucket computation and the CRNA triangulation — and is byte-identical across both (a 39-case regression suite proves it, satisfying the "single shared implementation, no copy-paste drift" decision D-33).

**Stage 1 — robust outlier rejection (median + MAD).** Rather than a mean (which a single bad scrape can drag arbitrarily), the engine uses the **median** and the **Median Absolute Deviation (MAD)**, which has a 50% breakdown point (half the data can be garbage before the estimate breaks). For each observation it computes a *modified z-score*:

```
modified_z = 0.6745 × (x − median) / MAD
```

and rejects any observation where `|modified_z| > 3.5`. (The `0.6745` constant rescales MAD to be consistent with the standard deviation of a normal distribution; `3.5` is the conventional Iglewicz–Hoaglin outlier cutoff.) If `MAD = 0` (all observations identical), the cell is tagged `zero_spread` with variance 0.

**Stage 2 — inverse-variance weighting (IVW).** Survivors are fused by weighting each by the inverse of its variance, so a tighter/more-reliable observation counts more:

```
empiricalVar  = max(MAD², (rate_mid × 0.05)², MIN_VARIANCE)     // 5% relative floor
weight w      = evidence_weight / variance
weighted_mean = Σ(w · x) / Σ(w)
weighted_variance = 1 / Σ(w)
```

**Confidence tiers** are emitted alongside the posterior:

- `multi_source` — several independent survivors fused.
- `single_source` — `n = 1`.
- `zero_spread` — all observations identical (`MAD = 0`).
- `manual_review_bimodal` — two modes detected; **`weighted_mean` is returned `null`** and the cell routes to manual review rather than collapsing.

**Two independent bimodal detectors — the key anti-skew defense.** MAD's 50% breakdown point hides a subtle failure: if observations split into *two distinct modes* (classically, a locum cluster and a permanent/W2 cluster mixed into one cell), MAD can eject one entire mode as "outliers" and confidently report the wrong single mean. Two detectors close this hole:

1. **Split-half variance ratio:** sort survivors, split into halves, and if `varHigh > 4 × varLow` (one half far more dispersed than the other), flag bimodal. A `survivors ≥ 6` floor guards this (raised from 4 after `[195, 198, 202, 205, 210]` false-positived — a perfectly tight cluster was wrongly flagged).
2. **Modal-escape detector:** if `≥ 3` outliers were ejected, all on the *same side* of the median, with a gap `> 4 × max(outlierMAD × 1.4826, 1)`, then MAD has ejected a whole mode wholesale — flag bimodal.

Either detector forces `weighted_mean = null` and `manual_review_bimodal`, so **a locum/permanent mixed cell is never silently collapsed into a meaningless average.**

**Numerical hardening.** `MIN_VARIANCE = 1e-4`, `MIN_WEIGHT = 1e-6`, `MAX_RATE_MID = 1e6`, plus per-iteration and final finite checks, guarantee the IVW math is unconditionally finite even on corrupt input — it degrades to a labeled tier rather than producing `NaN`/`Infinity` or throwing.

**What it prevents.** Median+MAD prevents a single bad scrape (a typo'd $1,200/hr, a half-rate $124 ZipRecruiter figure) from dragging the estimate. IVW prevents a wide, low-confidence observation from counting as much as a tight, reliable one. The bimodal detectors prevent the most insidious error in this domain — averaging a locum rate and a permanent salary-equivalent into a number that describes neither.

**Honest weaknesses.** (a) `evidence_weight` is **flat 1.0 today** — no observation actually dominates by reliability, so IVW reduces to a variance-weighted mean with no source-quality signal until reliability weighting is wired in. (b) The magic constants (`z > 3.5`, var-ratio `> 4`, survivors-floor `6`, the 5% relative variance floor) are engineering judgement; comments explicitly admit "no telemetry yet" — they are plausible but uncalibrated against outcomes. (c) **The whole posterior is display-only.** A perfect `aggregateCell` result feeds the v2 bucket tree that renders in `MarketDataView`, and it feeds CRNA triangulation, but it never reaches the quote — which is priced off the crude legacy min/max band. The single biggest latent accuracy upgrade in the entire system is adopting this posterior for the quote itself.

---

### Corporate-family collapse and the 60% weight cap: anti-collusion

**The problem this solves.** Large locum staffing companies operate many sub-brands. CHG Healthcare owns LocumStory, CompHealth, Weatherby, and Global Medical. AMN owns Staff Care, Medefis, and B.E. Smith. If the scraper harvests rate pages from all four CHG sub-brands, a naive aggregator would count **four "independent" votes** for what is really **one company's pricing position** — manufacturing false consensus and letting one corporate viewpoint dominate a cell.

**The collapse.** `sourceFamily.ts` maps each source ID to its true corporate family via `KNOWN_FAMILY_OVERRIDES`:

- **CHG:** locumstory, comphealth, weatherby, global_medical
- **AMN:** amn_healthcare, staffcare, medefis, b_e_smith
- **Jackson:** jackson_coker, jackson_physician_search
- **Cross-Country:** cross_country*
- **Aya:** aya_locums, aya_healthcare

In the bridge, the v2 path runs `collapseThenCap`: **Step 1** collapses every source family to *one clustered voice at weight 1.0* before any vote counting — so N sub-brands of one family can never fake N votes. **Step 2** caps any single voice above **60% of total cell weight** (`FAMILY_CAP_FRACTION = 0.6`) and redistributes the excess proportionally to the others.

**An honest nuance about the cap.** Under the current flat-1.0 weighting, after family collapse the maximum share any one of `k ≥ 2` families can hold is `1/k ≤ 50%`, which is already below 60% — so **the 60% cap is a no-op residual today.** The *collapse* (Step 1) is the real fake-consensus guard; the cap only begins to bind under a future non-flat (reliability-weighted) model. The cap is honest insurance against a heavier weighting scheme, not an active constraint right now.

**What it prevents.** Vote-stuffing by a single corporate parent. It guarantees that "two independent sources" means two genuinely independent *companies*, not two URLs from the same parent — which is exactly what the `≥ 2 independent source families` quorum (below) depends on to be meaningful.

**Honest weakness.** The family registry has **zero live firings today** — current live sources are only tavily/exa/serpapi/locums, none of which trip a `KNOWN_FAMILY_OVERRIDES` entry. Corporate-family collapse is forward-looking and unexercised on real data; it is correct insurance against a data future that has not arrived.

---

### Never-anchor exclusion: keeping W2-blended job-board numbers out

Some sources publish numbers that are *systematically* wrong for locum pricing — job boards that blend permanent W2 salaries, part-time, and locum into one "average" that anchors far too low. The canonical example: **ZipRecruiter lists CRNA at ~$124.86/hr**, roughly *half* the real locum range of $200–250.

`sourceFamily.ts` flags these via `NEVER_ANCHOR_SOURCE_IDS = {ziprecruiter, adzuna}`. The actual exclusion happens in the **bridge**, where `isNeverAnchorSource()` routes these rows to `invalidRows` — they are **excluded by absence**, meaning they never enter a cell and therefore never vote, never shift a median, never set a band floor. (The fleet's URL classifier reinforces this upstream: `ziprecruiter_state_pages → scraped_article_estimate`, a low-precedence type.)

**What it prevents.** A structurally-low job-board average from dragging down the floor of a real locum band. Because the exclusion is by absence rather than down-weighting, a never-anchor source has *exactly zero* influence — there is no residual contamination.

**Honest weakness.** Like family collapse, this is currently **unexercised** — no ZipRecruiter/Adzuna rows appear in the live canonical view. It is a correctness guard for a latent input vector, structurally identical in spirit to the staged `permanent_wage_proxy` exclusion (a scraped Doximity/Medscape/MGMA W2-survey row that the classifier tags `permanent_wage_proxy` and that would otherwise slip into the legacy band via a scraper agent_id) — both are zero-row no-ops today that exist so the band stays correct *if* such a row ever appears.

---

### The iron-dome ceiling: per-specialty plausible-range hard backstop

The "iron dome" is a hard plausibility ceiling that can only ever *escalate* a verdict, never relax one. `MAX_HOURLY_CEILING.crna = 250` is its single live entry: if a CRNA quote exceeds **$250/hr**, the sanity verdict is forced to `hard` regardless of what the band-aware thresholds said. This mirrors the Python fleet's `iron_dome` agent and its `PLAUSIBLE_RANGES` table (the same ~$250 CRNA ceiling is enforced at scrape time, and a `DEFAULT_RANGE` of `$60–700` bounds everything else upstream).

Critically, `applyCeiling()` runs **last**, after the mean-noise cap that demotes `hard → soft`. Because the ceiling runs after any relaxation step, **no later rule can demote a ceiling-tripped verdict** — it is a genuine one-way safety property. The escalate-only, applied-last ordering is the whole point: it is the layer you cannot accidentally turn off.

**What it prevents.** A catastrophic over-quote for the one specialty where the business is most exposed to scrutiny. If every other guardrail somehow let a $400 CRNA quote through, the iron dome still flags it `hard`.

**Honest weakness.** `MAX_HOURLY_CEILING` covers **only CRNA**. Every other specialty has *no* per-specialty hard over-quote backstop in this sanity layer — they rely entirely on the deviation bands and the engine's own `spec.max` clamp. Extending `PLAUSIBLE_RANGES` to all specialties (mirroring the fleet's `iron_dome.py`) is a named accuracy lever.

---

### The `≥ 2 independent-source-family` quorum: suppress single-source overlays

No specialty band goes live on the strength of a single source. Two independent gates enforce this:

1. **The legacy overlay gate** (`loadMarketRates`, the quote path): a scraped row only overlays `spec.min/max/p70` if it is `< 7 days` old, is not a cap value, and carries `≥ 2` valid (non-empty, trimmed) source strings. A single-source row is skipped (`continue`) — the static curated band stands. Further, the overlaid confidence is computed as: `uniqueFamilies = new Set(sources.map(sourceFamily)).size`; `≥ 2` distinct *families* → `'high'`, else `'medium'`, then `pickHigher(STATIC_CONFIDENCE[key], computed)` so an overlay can only *upgrade* confidence, never downgrade analyst-curated tiers.

2. **The bridge quorum:** because family collapse runs *before* vote counting, "2 sources" is forced to mean 2 genuinely independent corporate families, not 2 sub-brands or 2 scrapes of one URL (the two-stage dedup-collapse — content_hash exact, then dedup_group_id near — flattens repeated artifacts to weight 1.0 first).

**What it prevents.** A thin, single-source band going live and being read as market truth. It is the structural reason a lone low-confidence scrape cannot *by itself* create a live overlay — it must be corroborated by an independent family first.

**The honest hole this does NOT close.** The quorum gates whether an overlay *fires*, but **once two sources clear the gate, the resulting band is still confidence-blind.** `computeLegacyBand` (bridge) and the in-place overlay (engine) take raw `min(rate_low)` / `max(rate_high)` across the surviving rows, with `p70 = min + (max−min) × 0.70` as a flat linear interpolation — *not* a real percentile, *not* variance-weighted. So a single **low-confidence** scraped estimate that happens to clear the 2-source gate can still set the displayed **floor**. This is exactly the live anesthesiology case: the `$240` floor on the anesthesiology band comes from one `exa_semantic` locum scraped estimate (`arrangement=unknown`, confidence low) — not BLS, and not filtered out by the quorum, because the quorum counts sources but does not weight their quality. The variance-weighted posterior that *would* down-weight that estimate exists (`aggregateCell` → v2 buckets) but is display-only.

---

### How the guardrails compose, and what they collectively do *not* yet do

Putting it together, a scraped observation must survive this gauntlet before it can influence anything:

1. **Fleet-level** (scrape time): canonical specialty gate, Iron Dome `PLAUSIBLE_RANGES` bounds, observe-and-cite verification.
2. **Bridge row-level gates:** cap-capable-agent quarantine → never-anchor exclusion-by-absence → validity guard (positive, ordered bounds) → unknown-specialty drop.
3. **Bridge dedup-collapse:** content_hash exact-artifact collapse → dedup_group_id near-collapse to DISTINCT observations at flat weight 1.0 (raw multiplicity never inflates weight).
4. **Bridge family collapse → 60% cap.**
5. **`aggregateCell`:** MAD outlier rejection → IVW posterior → confidence tier → bimodal-null routing.
6. **Read-time sanity:** BLS-OEWS deviation verdict, CRNA envelope + UHC cut, iron-dome ceiling — all into a *display chip*, not the quote.

**The defining honest caveat.** This is a genuinely sophisticated, defense-in-depth, no-fabrication safety net — robust statistics (median/MAD/IVW), anti-collusion (family collapse), anti-contamination (never-anchor), and a one-way hard ceiling (iron dome). **But the bulk of it verifies and grades rather than prices.** The displayed quote is the crude, confidence-blind legacy band; a clean `aggregateCell` posterior, a green BLS verdict, and a `high`-tier badge can all coexist with a quote that ignores every one of them. The guardrails make the simulator *honest and bounded* — they make it very hard to ship a fabricated or wildly implausible number — but they do not yet make the *quote itself* statistically optimal. The two levers that would close that gap (adopt the v2 variance-weighted posterior as the quote anchor; confidence/quality-weight the legacy min/max floor) are known, designed, and deferred, because each shifts both apps' live quotes simultaneously and breaks golden-master byte-parity — a high-blast-radius change requiring a full re-baseline and re-port.

---

## Where the Numbers Come From: the Data Pipeline & Agent Fleet

Every dollar figure the rate simulator displays ultimately traces back to a row in one Postgres table, `public.rate_intelligence` (roughly 56,632 rows live as of 2026-06-29), which is filled by a small fleet of scheduled Python agents that scrape, search, and convert public market data into structured rate observations. This section explains where those observations come from, the rules that decide which ones are allowed to influence a quote, and which parts of the system are running today versus built but idle. The governing principle throughout is *observe-and-cite*: the simulator does not know what IMS actually pays clinicians, so it can only honestly report what the open market advertises, bounded from above by what IMS bills, and it refuses to fabricate a number it cannot ground in a source.

### The shape of the pipeline

The data flows in one direction, in two halves joined by a database:

1. **The Python fleet** (an internal framework called "agent-sdk," running on an EC2 server under the PM2 process manager) scrapes and searches the public web on a cron schedule and writes typed observation rows into Supabase Postgres (`rate_intelligence`).
2. **A nightly Node.js ETL job** (the "bridge," covered in detail elsewhere) reads a *filtered view* of that table, collapses and aggregates the rows, and publishes the results to Firebase Realtime Database, where the two apps' rate engines read them.

This section is about the first half — the fleet and the data it produces — plus the schema-level filters (the canonical view, the rate-type classifier) that decide what is even eligible to reach a quote. It is important to be precise about what the fleet does and does not do: **the fleet only deposits observations. It never computes a quote, and it has no feedback loop.** It does not learn whether a rate it produced turned out to be right.

### The agents, one by one

Every producer is a subclass of a common `BaseAgent`. Each one scrapes or searches, extracts dollar figures with regular expressions, runs each candidate through a chain of validity gates, and inserts the survivors into `rate_intelligence` stamped with an explicit `agent_id` (the underscore-named identifier that later determines admission). Here is the full roster.

**`rate_scraper`** (`agent_id = rate_scraper`) — the workhorse deterministic scraper. Despite being assigned to a cheap LLM tier, its rate extraction is 100% deterministic regex, no model in the loop. It pulls from 25 sources, structured as:
- **6 "tuned" sources** with source-specific extraction regex: `locums_com`, `locumstory`, `comphealth`, `barton_associates`, `weatherby`, `jackson_coker`.
- **18 "generic" sources** using five universal patterns: agency sites (gasworks, vista_staffing, aya_locums, amn_healthcare, global_medical, medicus, allstar, integrity_locums, cross_country, locum_leaders, physicians_thrive), trade/news outlets (beckers, modern_healthcare, nalto), three Reddit subreddits, and the Student Doctor Network forum.
- **1 SerpAPI Google query** ("locum tenens physician pay rates 2025 2026 hourly," 10 results), parsed in two passes: one for explicit "specialty + range" hits and one for "$range + context-inferred specialty."

The source catalog has hard import-time assertions (tuned == 6, generic == 18, combined defaults == 24) so an accidental edit fails loudly. Several sources were deliberately pruned: `staffcare` (a dead redirect) and the trio `doximity` / `medscape` / `mgma`, which are W2-compensation-survey sites that blew the budget and were placed on a "do not adopt" list — *but their URL-classification overrides were retained on purpose*, a subtlety that matters below.

**`rate_researcher`** (`agent_id = rate_researcher`) — a deterministic (no-LLM) search agent that runs 13 specialty-targeted Tavily "advanced" searches (CRNA, orthopedics, GI, anesthesiology, EM, hospitalist, cardiology, psychiatry, radiology, general surgery, neuro, dermatology, urology) plus one broad Exa neural search. It captures `$A–$B` ranges. A single bare `$NNN/hr` point figure is now a *counted drop*, not a written row: a single point would have to be stored as an equal-bound range (min == max), which is a soft form of fabrication, so it is suppressed and tallied instead.

**`gov_data_syncer`** (`agent_id = gov_data_syncer`) — the government-data agent, and the source of the most important provenance rule in the whole system. It emits 23 BLS OEWS (Bureau of Labor Statistics, Occupational Employment and Wage Statistics) wage rows. These are *permanent W2 employee* wages, so to make them comparable to locum rates it converts each one through a **W2→locum premium**:
- `PREMIUM_FACTOR = 1.25` (version-tagged `v1-2026-06-02`), constrained to stay within the band `[1.20, 1.35]`.
- The conversion: `rate_low = int(hourly * 1.25 * 0.9)`, `rate_high = int(hourly * 1.25 * 1.1)` — i.e. the W2 wage is marked up 25% and then spread ±10% to form a band.
- Raw input must satisfy `50 <= hourly <= 500` to be processed.
- Each row is tagged `rate_type = permanent_wage_proxy`, `evidence_employment_arrangement = permanent`, and a `source` string containing "government" (`bls_oews_may2025_government_premium_v1-2026-06-02`).

It also pulls GSA travel per-diem tables, NPPES provider counts, Treasury data, and five "$0 backbone proxy" government feeds (CMS, HRSA, BEA, Census, FRED) — but those last five are written to *their own isolated tables*, never to `rate_intelligence`. **The crucial fact: every one of these government rows is later excluded from the quote by the canonical view's agent filter (see below). They feed only the BLS sanity-check layer, never the displayed band.** This directly refutes an older internal belief that "BLS dilutes the legacy band" — live verification on 2026-06-29 found 0 BLS rows in the bridge's input view versus 483 in the base table.

**`rate_observer`** (`agent_id = rate_observer`) — **BUILT BUT UNSCHEDULED.** This is the designed crown jewel of data quality and the one piece of the fleet that is not actually running. It is the only LLM-using producer: a five-stage `GATHER → CITE → VERIFY → STRUCTURE → WRITE` pipeline that makes exactly one cheap-model "Citations" call per cell. Its purpose is to emit *Proof-Carrying Numbers* — rows that carry not just a rate but the verbatim source text it came from, character offsets into the stored source chunk, and a proven employment-arrangement span. Its `VERIFY` stage is a deterministic, non-AI trust boundary (described below). Because citation hallucination in LLMs is cited internally at 11–57%, the system deliberately never trusts the model for grounding — the verification is pure code. The consequence of `rate_observer` being unscheduled is significant and honestly acknowledged: **the highest-quality, locum-tagged, employment-verified evidence stream contributes zero production rows today.** It exists in code, with no entry in the scheduler config.

**`rate_validator`** — runs after the scraper in the daily pipeline and writes proposals to a separate `agent_proposals` table (a review queue, not the live rate table).

**`rate_auditor`** — an after-the-fact audit pass in the daily pipeline.

**`iron_dome`** — the plausibility sentinel. It enforces `PLAUSIBLE_RANGES` per specialty: any extracted rate outside a defensible bound is rejected before insertion. CRNA carries a hard hourly ceiling of about $250, a value mirrored downstream into the engine's BLS sanity-check so the same ceiling protects both the producer and the verifier.

### The schedules: what runs when, and what doesn't

All times US/Central:
- **Daily 05:00** — the rate pipeline: `rate_scraper` → `rate_validator` → `rate_auditor`.
- **Tuesday & Thursday 06:00** — `rate_researcher`.
- **Monday 05:00** — `gov_data_syncer`.
- **Daily 03:00** — `iron_dome`.
- **`rate_observer` — no schedule entry at all.** Built, tested, idle.

So the live evidence base grows mechanically: the deterministic scraper adds rows nightly, the researcher twice a week, the government sync weekly. There is no agent that detects a bad band and corrects it.

### The trust boundary: observe-and-cite, cite-or-suppress, Proof-Carrying-Numbers

Three related disciplines govern what is allowed to become a number.

**Observe-and-cite** is the overall stance: every rate must trace to an observed public source, organized into evidence tiers — Tier 1 (PhysicianSideGigs, Vivian, AANA), Tier 2 (scraped agency sites, with corporate sub-brands collapsed to one family), Tier 3 (BLS × the 1.20–1.35 locum premium), Tier 4 (modeled). To go live and influence a quote, a cell needs **at least two independent source families**; a single-source overlay is suppressed, which is what stops one scrape from setting a market band.

**Cite-or-suppress** means the system would rather show nothing than guess. The bare-point-figure drop in `rate_researcher`, the equal-bound suppression, and the engine's "insufficient data" path for call-only rates all express the same rule: no fabricated range, ever.

**Proof-Carrying-Numbers** is the strongest form, implemented in `rate_observer`'s `VERIFY` stage (deterministic, never the LLM). For a candidate to survive:
- (a) the cited span must be a literal substring of the stored source chunk;
- (b) the span must contain exactly one rate figure (a `$A–$B` range counts as one; more than one figure is rejected as W2/locum "bleed");
- (b2) an explicit hourly marker must be present;
- (c) the parsed number must match the span by substring *and* value (so "$230" cannot falsely verify against text reading "$2300");
- (d) **locum proof** must be present on the grounded chunk: a 1099/locum/contract marker, no hard W2 marker, and no negation token — a default-deny gate — plus a grounded employment-evidence span;
- (e) the rate must fall within the specialty's plausibility band.

This is the machinery that would make IMS's data genuinely cited and locum-specific. It is the machinery currently not running in production.

### Every producer runs a hard anti-fabrication check

Independent of the per-row gates, each agent executes a `RUN_SUMMARY` total-partition sum-check *before* writing to Supabase: `attempted == inserted + Σ(all reject buckets)`. If even one row vanished silently or appeared from nowhere, the partition fails and the agent raises an `AssertionError`. It uses an explicit `raise`, not Python's `assert` statement, specifically so that running Python in optimized mode (`-O`, which strips `assert`) cannot disable the guard. Combined with the canonical-specialty gate — every specialty string must normalize to one of 152 canonical names or be dropped and counted — this is how "no fake data" is structurally enforced rather than merely intended. The canonical gate alone eliminated a legacy path where roughly 54% of raw strings were garbage.

### The rate_type classifier and the permanent_wage_proxy URL overrides

Every row carries a `rate_type` drawn from a closed six-value enum (the "D-11" decision):
`actual_paid_locum`, `advertised_clinician_pay`, `agency_bill_rate`, `permanent_wage_proxy`, `scraped_article_estimate`, `crowd_survey`. The default when nothing else matches is `scraped_article_estimate`.

The classifier resolves a row's type through five decision paths: `source_default`, `source_bls_oews`, `url_override:<name>`, `fallback_no_url`, `fallback_unmatched_url`. There is a hard short-circuit: any source string beginning `bls_oews` is forced to `permanent_wage_proxy`.

The **URL overrides** (22 of them) are the interesting bit, because they encode the *latent risk* of a permanent-wage row sneaking into the market data through a scraper. The permanent-wage proxies are:
- `doximity_compensation` (matched on the path fragment "physician-compensation"),
- `medscape_general`,
- `mgma_data`,
- `glassdoor_salaries`

— each tagged `permanent_wage_proxy` + `arrangement = permanent`. Two more notable overrides: `ziprecruiter_state_pages` → `scraped_article_estimate` (and flagged as a "never-anchor" source, because ZipRecruiter blends W2 and locum into one misleading number — its CRNA figure of $124.86 is roughly half the real $200–250), and `aana_org` → `crowd_survey` + `permanent`.

Why retain the Doximity/Medscape/MGMA overrides when those sites were *pruned* from the scrape catalog? Because the classifier and the catalog are separate concerns. If a W2 compensation-survey page from one of those sites ever slips into the data through some scraper's `agent_id` (which would let it pass the canonical view), the override ensures it is correctly stamped `permanent_wage_proxy` so the downstream filters can exclude it. The override is a *correctness guard against a latent vector*, not an active data source.

This is exactly the role of a **non-locum filter staged this session** (uncommitted, in the canonical monorepo's bridge code). The bridge's crude "legacy band" historically lacked the `permanent_wage_proxy` exclusion that the v2 aggregation path already had. The fix filters out rows where `rate_type === permanent_wage_proxy` OR `evidence_employment_arrangement === permanent` before computing the legacy band. **On current data this is a no-op: there are 0 `permanent_wage_proxy` rows in the live market view.** It is a guard like the ZipRecruiter never-anchor exclusion — it does nothing today but prevents a future regression. (Note: `agency_bill_rate` was deliberately *not* added to this filter, because no scraper produces a `agency_bill_rate → market` vector; bill rates enter through a different, isolated path.)

### The canonical view: the admission rule by agent_id

The bridge does not read the raw `rate_intelligence` table. It reads a Postgres view, `canonical_rate_intelligence`, whose `WHERE` clause is the single most important admission gate in the pipeline (live-verified 2026-06-29):

```
WHERE (date_scraped >= '2026-05-20' AND agent_id IN ('rate_scraper','rate_researcher'))
   OR (specialty IN (canonical 152) AND agent_id != 'unknown_legacy')
```

Clause 1 admits all post-redesign rows from the two deterministic producers unconditionally. Clause 2 salvages older rows that happen to carry a canonical specialty and a real (non-`unknown_legacy`) agent. The decisive consequence: because `gov_data_syncer` writes an `agent_id` that is *not* in the clause-1 allowlist, **all 483 BLS/government rows are excluded from the bridge by agent identity** — 0 BLS rows in the view versus 483 in the base table. This is the structural reason BLS wages cannot dilute the displayed market band, and why the older "BLS dilutes the legacy band" concern is false for the bridge. Government wages still exist in the database (preserved, auditable, no destructive delete), but they reach only the BLS sanity-check verifier, never the quote.

### Cost and security: the $90/month circuit breaker

The fleet spends real money on paid scraping/search APIs, so it runs behind a fail-closed budget guard. Approximate per-call costs: Firecrawl $0.005, SerpAPI $0.015 per search, Tavily $0.015 (an "advanced" search costs 2 credits), Exa $0.007. Every paid call must first reserve budget through a `BudgetGuard`. The hard limit is `GLOBAL_WORKING_CEILING_USD = 90` — a working ceiling deliberately set *tighter* than the database-level `$100` reserve cap. If a projected spend (`global_month_to_date + estimated_cost`) would cross $90, the call is refused with reason `cap_exceeded:_global_working_ceiling_90`. On top of the dollar ceiling there are per-tool volume caps, so a run can exhaust, say, the SerpAPI quota while still under $90.

One honesty caveat on the breaker: for Firecrawl, SerpAPI, and Tavily the vendor responses do not expose a per-call cost, so the reservations "stand without reconciliation" — the $90 ceiling is enforced against *over-counted estimates*. Real spend can therefore drift *below* projection (the safe direction), but the ceiling is approximate rather than penny-exact.

### What is scheduled vs built-but-idle (honest status)

- **Scheduled and producing rows:** `rate_scraper` (daily), `rate_researcher` (Tue/Thu), `gov_data_syncer` (weekly, feeds sanity-check only), `iron_dome` (daily), `rate_validator`/`rate_auditor` (daily, in-pipeline).
- **Built but idle:** `rate_observer` — the entire observe-and-cite, Proof-Carrying-Numbers, locum-verified evidence stream. No scheduler entry. Activating it (a config entry plus an Anthropic API key provisioned on the fleet) is the single largest data-quality unlock the fleet can deliver.

### Honest coverage gaps and weaknesses

This is where the pipeline's real limits live, and they should be stated plainly:

**Most live rows are untyped.** The current rate-type distribution in the canonical *market* view (all dates) is: `advertised_clinician_pay` 239, `scraped_article_estimate` 454, `crowd_survey` 2, `null` 186, and — tellingly — `permanent_wage_proxy` 0, `agency_bill_rate` 0, `actual_paid_locum` 0. The classifier and the arrangement enrichment exist in code, but the bulk of historical rows predate them and are `null`. The downstream precedence ladder and locum filters therefore have little to act on; most rows fall into the unclassified bucket. Backfilling `rate_type` and `evidence_employment_arrangement` across the legacy `null` rows (re-running the classifier over history) is a known, not-yet-done lever.

**No CRNA locum sources.** CRNA has 0 live locum-tagged rows and 0 rate-type-classified rows. The fleet simply does not scrape any source that yields clean CRNA locum observations. As a result CRNA cannot leave its static curated band of roughly $190–250 — the live pipeline produces nothing for it, and nothing in the fleet flags the absence. Adding Tier-1 CRNA sources (PhysicianSideGigs, Vivian, AANA) and CRNA agency pages, under the $250 iron-dome ceiling, is the specific fix.

**No `actual_paid_locum` rows, ever.** This is the deepest limit. IMS knows the *bill* rate inside its staffing platform (LocumSmart) but does not know what it actually *paid* clinicians — the operational tables (`ls_events`, `ims_jobs`) carry no rate columns. So the highest-precedence rate type, `actual_paid_locum`, has zero rows and the system has no internal ground truth. Accuracy is bounded by *advertised* market signal, and the only internal check available is bounding pay from above by the known bill rate. Wiring LS invoice/timesheet bill extraction would add that single internal signal; it is not done.

**No self-learning in the fleet.** The agent configuration marks `rate_observer` as `learning_tier: observe`, `self_modify: false`. There is no path by which a recruiter outcome, or the downstream quote's accuracy, flows back to the agents. The Realtime Database feedback node the engine's calibration machinery would read (`rate-simulator/feedback`) is empty (0 entries), and no agent consumes it regardless. "Improvement over time" is purely additive and operator-driven: more rows accumulate as crons run, operators expand the source catalog and URL overrides (a checksum-guarded JSON catalog), and the W2→locum premium and per-source defaults are versioned parameters meant for periodic human review. The fleet grows its coverage mechanically; it never corrects itself.

**Several guards are no-ops on current data.** The corporate-family-collapse and never-anchor (ZipRecruiter/Adzuna) exclusions have zero live firings — only `tavily`, `exa`, `serpapi`, and `locums` sources appear in the data today, so those defenses are forward-looking and unexercised. The staged non-locum `permanent_wage_proxy` filter is likewise a no-op (0 such rows). They are correctness guards, not present-day accuracy movers.

**Freshness, not fabrication, on BLS.** The BLS figures are last-known wages re-tagged to a May-2025 vintage; a true refresh is operator-gated because bls.gov blocks bots. The risk is staleness, not invented data — and it is contained, because the canonical view keeps those rows out of the quote regardless.

**A subtle validate-vs-persist mismatch in the researcher.** `rate_researcher`'s Exa path validates a rate against `iron_dome`'s plausibility range using the *detected common term*, while persisting the *canonical* cell. Canonical names absent from the plausibility table fall back to a wide default range ($60–700), which can let a weak row through or wrongly reject a good one.

In short: the fleet is a disciplined, no-fake-data harvesting layer with strong cost and trust controls, but its best evidence stream (`rate_observer`) is idle, most rows are untyped, CRNA has no live coverage, there is no internal pay ground truth, and nothing in it learns. The numbers the simulator shows are honestly-sourced market *advertisements*, gated hard against fabrication — not measured paid rates, and not yet as cited or as locum-specific as the system was designed to make them.

---

## The Market Overlay & the Legacy-vs-V2 Split (What Actually Feeds the Quote)

This is the single most important thing to understand about how accurate the IMS rate simulator actually is. The system computes two different "market rate" numbers from the same scraped data: one crude and one statistically sound. The crude one prices the quote you see. The sound one is shown next to it as decoration and never touches the number. Everything below explains exactly how that happens, why, and what it costs in accuracy.

### The two products the bridge writes from one input

Every night, a single ETL job (the "bridge," `aggregateBridge.ts` + `bridge-rate-intelligence.ts`, running on EC2/PM2 cron at 04:00 UTC) reads the recent scraped rate observations out of Supabase (through the `canonical_rate_intelligence` view, over a rolling 7-day window) and writes them to Firebase Realtime Database (RTDB) in TWO parallel trees that the apps later read:

1. **`rate-simulator/market-rates`** — the **legacy crude band**. Per specialty, this is nothing more than `min = min(all rate_low)`, `max = max(all rate_high)`, and `p70 = min + (max - min) * 0.70`. It is a raw envelope over the surviving observations plus a flat 70% linear interpolation. No weighting, no variance, no outlier handling beyond the upstream dedup. It also carries a `sources` list and a `lastUpdated` timestamp.

2. **`rate-simulator/market-rates-v2`** — the **variance-weighted posterior**. Per `(specialty, state, rate_type)` bucket, this is the output of `aggregateCell`: a proper robust estimator that does median+MAD outlier rejection (rejects any point whose modified z-score `0.6745 * (x - median) / MAD` exceeds 3.5), then inverse-variance-weights the survivors into a `weighted_mean` and `weighted_variance = 1 / Σ(weights)`. It carries a confidence tier (`multi_source`, `single_source`, `zero_spread`, or `manual_review_bimodal`), the median, MAD, the number of distinct observations vs raw rows, the source families that contributed, and a `family_capped` flag. Bimodal cells (a locum/permanent mix, detected two independent ways) return `weighted_mean = null` and refuse to collapse into a single misleading number.

Both products are derived from the SAME survivors of the same dedup/family-collapse pipeline. The difference is purely in the final math: product (1) takes the raw extremes; product (2) computes a confidence-aware central estimate with a spread.

### Which number prices the quote (the crux)

**The displayed quote is priced off the crude legacy band. The v2 posterior is display-only.** This is true in BOTH apps (the old React dashboard and the new Astro hub), and because the engine is a byte-identical port with golden-master parity, they behave identically here.

The mechanism is a deliberate in-place mutation. At app init, the engine's `loadMarketRates()` reads `rate-simulator/market-rates`, and for each qualifying specialty row it **overwrites the static researched band in memory**:

```
spec.min = market.min
spec.max = market.max
spec.p70 = market.p70 || round(market.min + (market.max - market.min) * 0.70)
spec.provenance = 'live'
```

It mutates the shared `SPECIALTIES` singleton — the exact object that the pricing function `calculateRate()` reads when it anchors a quote (`base = spec.p70`, ceiling clamp at `spec.max`, market-position bar drawn from `spec.min..spec.max`). So once the overlay runs, the entire quote — the hero pay number, the researched range, the percentile chips — is computed off this crude min/max/p70 envelope.

The v2 posterior travels a completely separate, dead-end path. A different reader, `loadMarketBuckets()`, pulls `rate-simulator/market-rates-v2`, picks one primary bucket per cell by rate-type precedence, and hands it to exactly ONE consumer: the dashboard's `MarketDataView` display panel (a "Market rate" context card). It is never read by `calculateRate()`. On the hub it is even more isolated: the hub deliberately wires `loadMarketRates()` only and does not call `loadMarketBuckets()` at all.

So the situation is: the system does the hard statistical work (robust outlier rejection, inverse-variance weighting, bimodal detection, family-vote collapsing) to produce a defensible central estimate — and then prices the quote off the crude envelope instead, while showing the good number beside it as context.

### Why this matters: the displayed floor is whatever the single lowest scraped estimate is

Because the legacy band's floor is a literal `min(rate_low)` over surviving rows, **the displayed range floor is set by the single lowest scraped observation that clears the gates — regardless of how trustworthy that observation is.** The band is confidence-blind. One low-confidence scrape can define the bottom edge of the entire quote band.

The live example (verified 2026-06-29) is anesthesiology. Its live legacy band is `min 240 / max 450 / p70 387`, with sources `serpapi / tavily / exa`. The **$240 floor is a single `exa_semantic` locum-tagged scraped estimate with `arrangement = unknown` and low confidence** — it is not a BLS number, not corroborated, not weighted down for its weakness. It just happens to be the smallest `rate_low` among the survivors, so it becomes the visible floor. The variance-weighted posterior would have down-weighted or, if it were an outlier, rejected that point; the crude band cannot, by construction.

Contrast the two failure modes honestly:
- The **crude band** can be dragged down (or its top dragged up) by ONE endpoint observation. A lone low scrape sets the floor; a lone high scrape sets the ceiling. The interior (`p70`) is a flat geometric interpolation, not a real percentile of where observations actually cluster.
- The **posterior** resists exactly this: a 50%-breakdown median+MAD rejector plus inverse-variance weighting means a single weird point moves the central estimate very little, and a true bimodal cell refuses to emit a number at all.

This is why adopting the posterior for the quote is repeatedly flagged as the single biggest latent accuracy upgrade in the system — the better number already exists and already flows to RTDB nightly; only the reader wiring (and a golden-master rebaseline, since it would shift live quotes in both apps) stands between the system and a confidence-aware quote.

### The two gates that govern whether the overlay fires

The legacy overlay does not blindly trust every row. `loadMarketRates()` applies two hard gates before it will mutate a specialty's band:

1. **7-day staleness gate.** A row is ignored unless its `lastUpdated` age is `<= 7 * 86,400,000 ms` (7 days). This matches the bridge's own 7-day read window, so the freshest nightly aggregation is what survives; anything older falls back to the static curated band. (The v2 reader applies the identical `RATE_READ_WINDOW_MS = 7 days` gate.)

2. **`>= 2` source gate.** The overlay counts non-empty, trimmed source strings and `continue`s (skips the specialty entirely) if there are fewer than 2. This is the "no single-source overlay goes live" rule: a band built from one scrape is suppressed and the static curation stands. There are two more guards alongside it — the row's `valueType` must not be `'cap'` (cap/bill-context rows are routed away from the market band), and the merge only happens if `market.min > 0 && market.max > market.min` (a degenerate or inverted band is rejected).

When the overlay does fire, it also recomputes confidence: `uniqueFamilies = number of distinct source families` (after collapsing corporate sub-brands like CHG's Weatherby/CompHealth/LocumStory to one family). If `uniqueFamilies >= 2` the computed tier is `high`, else `medium`; the final tier is `pickHigher(static_curated_tier, computed)` so the overlay can only upgrade confidence, never ratchet a curated band down.

Two honest caveats about these gates. First, the 2-source gate counts source *strings*; the stronger "2 independent source *families*" quorum is what the confidence computation uses and what the bridge enforces upstream — the overlay's own gate is the weaker string-count version, with family-uniqueness only affecting the label. Second, neither gate is a *quality* filter: a row can clear "2 sources, <7 days, min<max" and still be two mediocre low-confidence scrapes that together set a too-low floor. The gates prevent single-source and stale overlays; they do not make the floor confidence-aware.

### The just-added non-locum filter: a correctness guard, not a number-mover today

This session, a `non-locum filter` was staged into the bridge's legacy-band computation (uncommitted, in the canonical monorepo's `scripts/data-refresh`). Understanding precisely what it does — and does not — do is important, because it is easy to mistake for an accuracy improvement.

**What it does.** The v2 bucketing path already respects a rate-type precedence ladder and deliberately excludes permanent-wage and bill-rate buckets from ever being the primary market number. The legacy crude band had no such protection — it simply took `min(rate_low)/max(rate_high)` across *all* surviving rows for a specialty, blending rate types. The new filter brings the legacy path partway in line: before computing the band for a market cell, it drops any observation where `rate_type === 'permanent_wage_proxy'` OR `evidence_employment_arrangement === 'permanent'`, then re-dedups within the locum-only subset and computes the band from that. If *every* observation for a specialty is proven-permanent, no band is written and the specialty is pushed to a suppression list (the writer then writes `null` to that legacy node, deleting any stale prior-run band so the static fallback re-engages immediately instead of waiting out the reader's 7-day gate).

**The specific latent threat it guards.** The concern is not BLS data. BLS/government rows (source `bls_oews_2023_permanent`, agent `gov_data_syncer`) are already excluded from the bridge entirely by the `canonical_rate_intelligence` view's `agent_id` filter — live-verified, 0 BLS rows in the view versus 483 in the base table. (The older memory note claiming "BLS dilutes the legacy band" is therefore **false** for the bridge; that vector is already closed by the view.) The real latent threat the new filter addresses is different: a **scraped W2 compensation-survey row** (Doximity / Medscape / MGMA) that the classifier tags `permanent_wage_proxy` via a `url_override`, but which enters under a *scraper* `agent_id` (`rate_scraper`/`rate_researcher`) and thus *passes* the canonical view. Such a row is permanent-comp data wearing a scraper's badge; without the filter it could slip into the locum legacy band and pull the floor toward W2 magnitudes. The filter catches it by `rate_type`/`arrangement`, not by `agent_id`.

**Why it is a no-op today.** In the current live data there are **0 `permanent_wage_proxy` rows** in the canonical market view (the verified rate-type distribution is: `advertised_clinician_pay` 239, `scraped_article_estimate` 454, `crowd_survey` 2, `null` 186, `permanent_wage_proxy` 0, `agency_bill_rate` 0, `actual_paid_locum` 0). With zero rows to filter, the filter removes nothing and the bands are byte-identical to before. It changes no displayed number today.

So it is precisely a **correctness guard, not an accuracy mover** — directly analogous to the existing never-anchor exclusion (ZipRecruiter/Adzuna job-board W2-blended numbers, which would roughly halve a real CRNA rate and are excluded *by absence* so they can never vote). Both are defenses against a class of bad row that isn't currently present but would silently corrupt the floor if it appeared. Note also a deliberate scope decision: `agency_bill_rate` was **not** added to this filter, because `agency_bill_rate` has no scraper→market ingestion vector in the first place (bill rates arrive on a separate `value_type='cap'` path, which the overlay already routes away from the band) — adding it would be guarding against a row that cannot reach this code path.

### Summary of the split's net effect on accuracy

- The quote in both apps is anchored to a **crude, confidence-blind min/max/p70 band**. Its floor is the lowest single surviving scrape; its `p70` is a linear interpolation, not an observed percentile.
- A **statistically sound variance-weighted posterior exists, is computed nightly, and is shipped to RTDB** — but it is wired only to a display panel (dashboard `MarketDataView`) and not to the hub quote at all. The best number the system produces is the one the quote ignores.
- Two gates (`>= 2` sources, `< 7` days, plus non-cap and `min<max` guards) keep single-source and stale overlays from going live, but they are **structural, not quality** filters — they do not make the floor confidence-aware.
- The new **non-locum filter** closes a real but currently-empty leak (scraper-badged W2 survey rows). It is a guard with **0 affected rows today**, so it moves no number now; its value is preventing a future silent floor-corruption, exactly like the never-anchor exclusion.
- BLS is **not** a dilution risk for the bridge — it is already excluded upstream by the canonical view's `agent_id` filter. Any prior claim otherwise is stale.

---

## Is It Improving Itself? Self-Learning, Calibration & the Feedback Loop

### The short answer

No. As of 2026-06-29 the rate simulator does **not** improve itself from outcomes. The machinery to do so is fully built, wired end-to-end, and unit-tested — but it is starved of inputs. The single Firebase node that would feed it, `rate-simulator/feedback`, contains **zero entries**, and no part of either application (the old React dashboard or the new Astro hub) actually writes a recruiter outcome back to it. Every quote you see today is the deterministic output of static research bands plus a daily-refreshed market overlay; none of it is the product of the engine having learned that a past quote was too high or too low.

There is exactly one form of "self-updating" that *is* live: the data-collection fleet re-scrapes the market every day and the bridge re-aggregates it, so the numbers can drift as the public market drifts. That is a refresh loop, not a learning loop. It tracks the *market*, not the simulator's own *accuracy*. The distinction is the entire subject of this section.

It is important to be precise about *why* it does not learn, because the reason is not "the feature is unbuilt" — it is "the feature has no fuel." That is a meaningfully different situation, and it changes what would be required to turn it on.

---

### Two loops that are easy to confuse

There are two completely separate mechanisms that both look like "the simulator getting smarter over time." Only one of them runs today, and it is the weaker of the two.

**Loop A — the market-data refresh (LIVE, but not learning).** Once per day at 04:00 UTC, a cron job on EC2 runs the bridge ETL. It reads the last 7 days of scraped market observations out of Supabase, aggregates them, and writes fresh bands into Firebase RTDB. At application startup, both apps read those bands and overlay them onto the static specialty table. So if locum anesthesiology rates visibly climb across the public web this week, next week's quotes can move with them. This is genuinely adaptive to the *external market*, and it is the only adaptation that actually fires in production. But it has **no memory of the simulator's own behavior**. It never asks "was the $370/hr we quoted last month actually accepted?" It cannot, because that question requires an outcome signal the system does not collect. Loop A is stateless: the same 7-day input window always produces the same output, by design, so cron runs are reproducible.

**Loop B — the outcome-calibration loop (BUILT, DORMANT).** This is the real self-learning machinery, and it is the subject of the rest of this section. The intended design is a closed loop: a recruiter runs a quote, the recruiter later learns what rate the clinician/client actually accepted, the recruiter submits that accepted rate back into the app, the engine compares accepted-vs-quoted across recent submissions, and it nudges future quotes for that specialty toward the observed truth. Every piece of this exists in code. It produces no effect whatsoever today because the input store is empty.

The honest one-line summary: **Loop A keeps the numbers fresh against the market; Loop B — the one that would make the tool genuinely self-correcting against reality — is wired but unfed.**

---

### The calibration machinery, in detail

When a quote is computed, the raw engine output (`calculateRate()` off the static band, or `calculateCallRate()` for call-only) is not necessarily what gets displayed. It passes through one final gate, `computeDisplayedRate()`, which can apply a learned per-specialty adjustment. That adjustment comes from `loadSpecialtyCalibration(specialty, rateMode)`. Here is exactly what that function does, including the numbers that govern it.

**Step 1 — read the feedback store.** It reads `rate-simulator/feedback` from Firebase and merges in a `localStorage` backup keyed `rateFeedback`. Each entry is a record of one past quote: the `simulatedRate` (what the app showed), the `acceptedRate` (what a recruiter later said was actually agreed), plus enough metadata to bucket it.

**Step 2 — bucket by rate mode.** Entries are split into `hourly` vs `call_daily` so that daily stipends never pollute hourly ratios. The split is a magnitude heuristic: `LEGACY_CALL_DAILY_FLOOR = 1000` — if either `simulatedRate >= 1000` or `acceptedRate >= 1000`, the entry is treated as a call/daily quote; otherwise hourly. (This heuristic exists because legacy entries may lack an explicit mode tag; it is a known edge-case risk.)

**Step 3 — compute the recent bias ratio.** Take the most recent 10 matching entries (`entries.slice(0,10)`), and compute the mean of `acceptedRate / simulatedRate`. Call this `recentAvgRatio`. A ratio of 1.0 means "on average the simulator's quotes were exactly the accepted rate"; 1.08 means the simulator was systematically quoting **8% low**; 0.92 means it was quoting **8% high**.

**Step 4 — decide whether to act.** The adjustment only engages if there is enough signal AND the bias is non-trivial:

> trigger if `recent.length >= 3` **AND** `|recentAvgRatio - 1.0| > 0.03`

So you need at least 3 recent outcomes for that specialty/mode, and the average miss has to exceed 3%. Below either threshold, the adjustment is exactly 1.0 (a no-op).

**Step 5 — dampen and clamp.** When it does fire, it does **not** apply the full observed bias. It applies half of it, then hard-clamps the result:

> `adjustment = 1.0 + (recentAvgRatio - 1.0) * 0.5`  *(dampen to 50% of observed bias)*
> `adjustment = min(max(adjustment, 0.85), 1.15)`  *(clamp to ±15%)*

A worked example: suppose the last 10 anesthesiology hourly outcomes averaged `acceptedRate/simulatedRate = 1.20` (the simulator was quoting 20% low). The raw bias is +0.20. Dampened by 50% → +0.10 → `adjustment = 1.10`. That is inside the ±15% clamp, so the displayed quote is nudged up 10%. If the observed bias had been +0.50, the dampened value would be +0.25 → `adjustment = 1.25`, but the clamp would pull it back to **1.15** — a hard ceiling of +15% per specialty, no matter how large the observed miss. The same +15% floor of −15% applies on the downside.

**Step 6 — apply with guardrails.** `computeDisplayedRate(rawPayRate, calibration, {capped, marketMax})` applies the adjustment but with margin-leak protection:
- `applyCalibration` short-circuits entirely if `sampleSize < 3` or `adjustment === 1.0`.
- A **positive** (upward) adjustment may never push the displayed pay above the researched `spec.max` (the `marketMax` clamp) and may never exceed an engine cap — if the hero is already at cap, positive calibration is dropped entirely.
- A **negative** (downward) adjustment always applies — the system is allowed to correct itself *down* freely, but is conservative about correcting *up*.
- The bill invariant `billRate = roundUp5(payRate / 0.80)` is preserved after calibration.

This is a deliberately conservative learning rule. Even fully fed, a single specialty can move at most ±15%, it moves at half the speed of the observed error, it needs at least 3 corroborating outcomes before it moves at all, and it can never invent a number above the researched ceiling. The design philosophy is "let a few noisy human-entered outcomes nudge, never whipsaw, the quote."

---

### Why it is a permanent no-op today

Trace the dependency chain and the dead end is obvious:

1. `computeDisplayedRate` only adjusts if `calibration.adjustment !== 1.0` and `sampleSize >= 3`.
2. `adjustment` only leaves 1.0 if `recent.length >= 3` and `|ratio − 1| > 0.03`.
3. `recent` is drawn from `rate-simulator/feedback` (+ localStorage).
4. **`rate-simulator/feedback` has 0 entries, and no production code path writes to it.**

So `loadSpecialtyCalibration` always returns the empty sentinel (`adjustment = 1.0`), `applyCalibration` always short-circuits on `sampleSize < 3`, and `computeDisplayedRate` passes the raw engine number through unchanged, in **both** apps (they are at byte-identical golden-master parity, so the behavior is identical). The advertised "self-learning" is, in production, inert.

There is one subtlety worth stating plainly to avoid overclaiming the *opposite* direction. On the **dashboard**, the write path is *actually present*: the `FeedbackSection` component does call `push(ref(db, 'rate-simulator/feedback'), entry)` plus a localStorage backup, and on submit it bumps a refetch counter that re-runs `loadSpecialtyCalibration` for the same specialty/mode. In other words, the dashboard's loop is genuinely closed *as code* — if a recruiter fills in the feedback form, an entry is written and calibration would begin to engage once three accumulate. The reason the store is empty is not a missing write function; it is that **no recruiter has been submitting outcomes**, and there is no enforced or incentivized capture step in the recruiter workflow. On the **hub** (Astro), even the write UI is absent: the hub is strictly read-only against RTDB — it reads market bands to overlay, and nothing anywhere captures an outcome. So "no capture mechanism is wired" is precisely true for the hub, and "a capture form exists but is unused/unfed" is the more exact statement for the dashboard.

---

### The deeper problem: there is no ground truth to learn from

Even if recruiters did diligently fill in the feedback form, it is essential to understand *what* the loop would be learning from — because it is not a hard outcome.

**IMS has no internal record of what it actually paid clinicians.** Inside LocumSmart, IMS knows the **bill rate** (what the client is charged) but the `ls_events` and `ims_jobs` data carry **no pay-rate columns**. So there is no automatic, verified "this is what the clinician was actually paid" signal anywhere in the system. The calibration loop's `acceptedRate` is therefore a **recruiter-asserted** number — what a human typed into the feedback form as the rate they believe was accepted — not a system-verified paid rate. That has two consequences:

- **Garbage-in risk.** If recruiters enter aspirational or rounded or misremembered numbers, the loop calibrates toward a soft, human signal. The 50% dampening and ±15% clamp mitigate the blast radius of a few bad entries but do not eliminate the bias.
- **No external validation is possible from inside the app.** Because there is no hard paid-rate column, the simulator's accuracy literally cannot be checked against reality programmatically. Accuracy today is established by **observe-and-cite from the public market** (the fleet) plus **bounding pay from above by the known bill rate** (`pay ≤ bill × margin`), not by closing a loop against internal outcomes.

This is why the bill-extraction lever (below) matters so much: the bill rate is the **only** internal signal IMS actually possesses, and it can at least *bound* pay from above even though it cannot pin it exactly.

---

### What "self-improving" looks like elsewhere in the stack — and why none of it closes the accuracy loop

Several subsystems *look* adaptive. None of them feed accuracy back from outcomes. Cataloguing them honestly:

- **The fleet (agent-sdk).** It accumulates more observations every day (`rate_scraper` daily, `rate_researcher` Tue/Thu, `gov_data_syncer` weekly). But this is purely additive coverage growth. `agents.yml` explicitly marks the observe-and-cite producer `learning_tier: observe`, `self_modify: false`. No fleet agent ingests recruiter outcomes or downstream quote error. The W2→locum premium (1.25), per-source defaults, and Iron Dome plausibility ranges are **versioned constants meant for quarterly human review**, not auto-tuned parameters.

- **The bridge aggregation.** Each daily run re-derives bands from whatever was scraped, so the *market posterior* tracks fresh data. But the run is a stateless, seeded (`mulberry32` seed `0x5eed1a5`) batch transform — same 7-day window in, same RTDB out. It never adjusts its own parameters from outcomes.

- **Source-reliability scores.** The bridge computes a `source-reliability` node (bootstrap stability + cross-source agreement). This *looks* like the system grading its own sources, but per design decision **D-38b it is explicitly NOT weight-bearing** — it is a display-only "source stability" label and is never validated against closed-deal outcomes. It measures internal consistency and cross-source coherence, not real-world correctness.

- **The CRNA multiplier derivation (`deriveLocumMultCrna`).** This is the one component that is *data-adaptive in principle*: it computes the locum-vs-W2 multiplier empirically from IAS booking rows via an n-gated fallback ladder (state n≥5 → division n≥10 → national n≥50 → literature default). But the IAS RTDB holds **0 actual paid CRNA rates**, so it perpetually falls through to the literature defaults (`w2_employee 1.0`, `locum_w2 1.4`, `1099_independent 1.6`, `locum_1099 1.7`). It cannot improve because its input stream is empty — the same fundamental failure mode as Loop B, just in a different subsystem. The CRNA "5-tier triangulated envelope" therefore caps at PUBLIC-HINT and is, in honest terms, BLS × a literature prior dressed up as triangulation.

The pattern across all of these is identical: **the system can grow its data and refresh against the market, but nothing anywhere observes that a produced number was wrong and corrects the producer.** There is no outcome signal flowing backward into any layer.

---

### The accuracy "self-correction" that already happened — by humans, not by the system

It is worth being precise that the simulator *has* been corrected — through **human audit folds**, not autonomous learning. A 14-specialty cited locum audit (0 claims refuted) found 11/14 static bands accurate and 3 under-quoted (internal medicine, urology, radiology), which were corrected and shipped. A 26-specialty request-type audit found the engine in good shape: an adversarial verification step **rejected 13 fabricated changes** and confirmed only ~4–6 (neurosurgery/neurology/anesthesiology call and worked-day bands), with GSA FY2026 per-diems all correct. These are real accuracy improvements, but they are the product of analysts running cited research workflows and editing constants, the same way the Iron Dome ranges and W2 premium are human-reviewed. The engine did not detect its own errors; people did. "Self-improving" and "well-maintained by audit" are different claims, and only the second is currently true.

---

### What would be required to make it genuinely self-correcting

To move from "wired but unfed" to "actually learning," in rough order of leverage:

**1. Wire a real feedback-capture mechanism (the actual unlock).** The calibration math is done; what is missing is fuel. Concretely:
   - On the **hub**, add a write path at all (today it is read-only) — an endpoint or RTDB write that records, per quote, the `simulatedRate` the recruiter saw and the `acceptedRate` that was ultimately agreed.
   - On the **dashboard**, the write exists but is unused — the gap is *recruiters actually submitting outcomes*. That is a workflow/incentive problem more than a code problem: capture has to be made low-friction and ideally a natural by-product of closing a placement, not an extra form.
   - Once ~3+ outcomes per specialty/mode accumulate, the existing dampened/clamped loop turns on automatically.

**2. Wire LS invoice/timesheet BILL extraction — the only internal ground-truth signal.** IMS already knows the bill rate per confirmed placement (every timesheet/invoice in the LocumSmart webhook feed carries a `confirmationAgreementId`). Extracting that gives a hard, system-verified upper bound: `pay ≤ bill × margin`. This cannot pin the paid rate, but it can **sanity-check the observe-and-cite market numbers from above** and flag any quote that exceeds what the bill could support — a real outcome signal that does not depend on a recruiter typing a number. This is the most defensible accuracy-feedback source available, precisely because it is internal and verified.

**3. Make the quote actually consume the better number it already computes.** This is adjacent to self-learning rather than part of it, but it is the largest latent accuracy upgrade and worth naming here: the displayed quote is priced off the **crude, confidence-blind legacy min/max/p70 band**, while the statistically proper **variance-weighted v2 posterior** (MAD outlier rejection + inverse-variance weighting) is already computed daily and shipped to RTDB — but used only on a display panel, never for the quote. Adopting the v2 posterior for the quote, and/or confidence-weighting the legacy floor so a single low-confidence scraped estimate can no longer set the displayed minimum (e.g., the anesthesiology $240 floor that comes from one low-confidence `exa_semantic` locum estimate with `arrangement=unknown`), would make the baseline the loop calibrates *from* far more trustworthy. A self-correcting loop on top of a confidence-blind base would just be polishing a shaky anchor.

**4. Make source-reliability weight-bearing once outcomes exist.** The bridge already computes per-family reliability scores; today they are honestly labeled non-weight-bearing because there is no closed-deal telemetry to validate them. With real outcome data, those scores could feed the inverse-variance weight (currently flat 1.0) so that consistently-accurate source families dominate the posterior — turning the reliability computation from a display label into an actual learning signal.

**5. Feed the CRNA (and other) empirical multipliers.** Add CRNA-specific live locum sources and tag `rate_type` + `evidence_employment_arrangement` on the (currently mostly-null) row majority, so `deriveLocumMultCrna` and the rate-type precedence ladder finally have inputs and stop falling through to literature priors.

**6. Schedule the cite-and-verify producer.** `rate_observer` — the only fleet producer that emits cited, locum-tagged, employment-verified observations with Proof-Carrying-Numbers — is **built but unscheduled**. Turning it on would raise the quality of the very observations any future loop learns from.

---

### Honest bottom line

The rate simulator is **well-researched and well-audited, but not self-learning.** The calibration loop is real, conservative, correctly guarded against margin leaks and runaway adjustments, and genuinely closed *in code* on the dashboard side — yet it has produced exactly zero adjustments in production because no outcome data has ever been captured. The only live adaptation is a daily market-data refresh, which tracks the external market, not the simulator's own accuracy. And even a fully-fed calibration loop would be learning from a soft, recruiter-asserted signal, because IMS holds no internal record of what it actually paid clinicians — only what it billed. The path to genuine self-correction is therefore not "build the learning machinery" (it exists) but "capture outcomes and, ideally, anchor them to the one hard internal signal that does exist: the bill rate." Until a capture path is wired and used, any claim that the simulator "learns from outcomes" or "gets smarter over time" is, today, false — the accurate claim is that it **stays fresh against the market and is improved by periodic human audit.**

---

## Current Accuracy Scorecard: Strengths, Weaknesses & Good-But-Could-Be-Better

This section is a frank, no-marketing assessment of how accurate the IMS locum rate simulator actually is today, where its accuracy genuinely comes from, where it is thin, and where it computes something good but throws it away before it reaches the user. The single most important fact to hold throughout: the number a user sees (the quote) is priced off a **crude, confidence-blind static band**, even though the system computes a far better statistical estimate one layer away. Almost every entry below traces back to that one architectural fact.

A note on how the quote is produced, because the whole scorecard hinges on it. The displayed quote is `calculateRate()` (or `calculateCallRate()` for call-only) run against a per-specialty static band `spec.min / spec.max / spec.p70`, where `p70 = round(min + (max - min) * 0.70)` is a flat linear interpolation, not an observed percentile. A daily background job (the "bridge") may overwrite that band in place with `min = min(rate_low)`, `max = max(rate_high)`, `p70 = min + (max-min)*0.70` computed over recent scraped rows that pass a 7-day-fresh, ≥2-source gate. That is the entire pricing path. Separately, the same bridge computes a proper variance-weighted posterior (MAD outlier rejection + inverse-variance weighting, per `(specialty, state, rate_type)` bucket) and ships it to a second data tree — but that posterior is read **only by a display panel**, never by the quote. Keep this split in mind; it is the spine of everything that follows.

---

### What the simulator is genuinely good at

These are real, defensible strengths, validated by audits and by the code's structure — not aspirations.

**1. The static bands are well-researched and audit-validated (the core accuracy claim).**
The price anchors are ~70 curated specialty bands (plus ~140 aliases mapping into them). A 14-specialty cited locum audit — every claim required a URL plus verbatim cited text plus a substring check ("Proof-Carrying-Numbers"), and zero of the 14 findings were refuted — concluded that **11 of 14 bands were accurate**. Only three were under-quoting: internal medicine (raised $115–160 → $130–200), urology ($220–275 → $220–330), and radiology ($185–290 → $185–330). Those three were corrected and shipped. An 11/14 hit rate on adversarially cited evidence, with the misses all in the same conservative (under-quoting) direction and all fixable by widening a band, is a strong result. It means the foundational layer the quote is priced off is, for the audited specialties, close to market.

**2. The request-type (call-only / per-diem) engine is in good shape, proven by rejection rate.**
A separate 26-specialty audit of non-hourly request types — 24-hour beeper call, worked clinical day, callback differentials, weekend/holiday day-types, and GSA travel per-diems — ran an adversarial verification pass that **rejected 13 of the proposed changes as fabrications**. Only roughly 4–6 changes survived (call and worked-day band adjustments for neurosurgery, neurology, and anesthesiology), and the GSA FY2026 per-diem table (standard $110 lodging / $68 M&IE / $178 total, plus ~120 city overrides like Boston $441, Manhattan $434, San Francisco $364) was found entirely correct. A 13-of-~19 rejection rate is the signature of an engine that is *already mostly right*: when an adversary tries to "improve" it and is mostly told no, the existing numbers are defensible. This engine also enforces honesty disciplines that matter in this niche: it converts a daily stipend to an hourly figure by dividing by **coverage hours** (24 for a beeper, 8/10/12 for a worked day), not by the 2–4 "gratis" hours — the bug that once produced absurd ~$821/hr neurology quotes — and it emits a clean "insufficient data" card (pay $0 suppressed) rather than fabricating a daily it cannot cite.

**3. Strong anti-skew / anti-gaming guardrails on the data that does flow in.**
The aggregation layer is built from robust statistics, not naive averages. Outliers are rejected by modified-z against the median (reject when `|0.6745·(x − median)/MAD| > 3.5`), survivors are inverse-variance-weighted, and two independent bimodal detectors (split-half variance ratio > 4, and "modal-escape" where the MAD filter ejected an entire mode) force a cell to return *no number* and route to manual review rather than collapsing a mixed locum/permanent cluster into a misleading mean. Corporate brands are collapsed to one "family" vote (all CHG sub-brands — locumstory, comphealth, weatherby, global medical — count once; likewise AMN, Jackson, Cross-Country, Aya), so a staffing conglomerate cannot fake N independent data points by listing N sub-sites. A ≥2-independent-source-family quorum is required before anything goes live. "Never-anchor" job-board sources (ZipRecruiter, Adzuna — whose W2-blended numbers run about half the real locum rate, e.g. ZipRecruiter CRNA $124.86 vs a real ~$200–250) are excluded by absence so they never vote. And a per-specialty iron-dome ceiling (CRNA hard-capped at $250/hr) can only escalate an over-quote verdict, never relax one.

**4. Honest confidence and honest provenance.**
Confidence shown to the user is the **weaker** of two signals: how well the assignment was identified (specialty + state known → High; specialty only → Medium; neither → Low) and the underlying data tier of that specialty's band. So a perfectly-parsed CRNA assignment still reads **Medium**, not High, because CRNA's band is lightly-researched — the UI refuses to let clean parsing mask thin data. Provenance is tracked separately: bands are labeled `curated` vs `live`, the display grid is explicitly relabeled "curated estimate, not observed market rate" when a real observed bucket exists, and a "researched-max applied" flag is kept distinct from a "hero-clamped" flag so the two never get conflated. Nothing is fabricated: unreadable PDFs return an honest "could not read it" message and change nothing; unmapped specialties surface as Low confidence rather than silently inventing a rate.

**5. The port is faithful — accuracy is identical across both apps.**
The engine is shared, byte-for-byte, between the old dashboard (React) and the new IMS hub (Astro). Golden-master parity across 208 cases is byte-identical (gate-1 GREEN); a 266-test data-layer logic suite passes (gate-2a GREEN); and the live-overlay wiring is shipped to the hub (gate-2b). The hub is at **full parity** with the dashboard — it is not a degraded re-implementation. Whatever the dashboard quotes, the hub quotes. That means the strengths above and the weaknesses below apply equally to both surfaces; there is no "good app and bad app," only one shared engine.

---

### What the simulator is weak at

These are real, current weaknesses. Most are not bugs — they are honest structural limits of pricing off a static band with a starved learning loop.

**1. The quote band is crude and confidence-blind — a single low-confidence row can set the floor.**
The legacy band the quote actually uses is `min(rate_low)` to `max(rate_high)` over the surviving rows, with **zero quality or confidence weighting**. One outlier endpoint defines the whole edge. The live example: anesthesiology's displayed floor of **$240** comes from a single `exa_semantic` scraped locum *estimate* whose employment arrangement is `unknown` and whose confidence is `low`. It passed the ≥2-source gate and now anchors the bottom of the displayed range. The family-weight cap (60%) that should bind in cases like this is, under the current flat-weight model, a mathematical no-op (max share is already 1/k ≤ 50%). So the most accurate machinery in the system — the variance-weighted posterior that *would* down-weight that lone low-confidence estimate — is computed and then ignored for pricing.

**2. The variance-weighted v2 posterior is unused for the quote — the best number is display-only.**
This is the single largest latent accuracy gap. The bridge computes a proper posterior per `(specialty, state, rate_type)` bucket — weighted mean, weighted variance, median, MAD, family-cap flags, a confidence tier (`multi_source` / `single_source` / `zero_spread` / `manual_review_bimodal`), and a rate-type precedence selection (`actual_paid_locum` 4 > `advertised_clinician_pay` 3 > `crowd_survey` 2 > `scraped_article_estimate` 1; permanent-proxy and bill-rate types deliberately barred from ever being primary). All of that ships to the `market-rates-v2` data tree. Its **only consumer is a display panel** (the dashboard's MarketDataView). It never touches `calculateRate()`. So the user can literally see a statistically-correct "Market rate" number in one panel while the hero quote above it is priced off the crude band — and a sophisticated user can notice they disagree.

**3. No internal pay ground truth.**
IMS knows the **bill** rate inside LocumSmart but does not know what it actually **paid** clinicians — the `ls_events` and `ims_jobs` tables have no rate columns. So the system can never validate a quote against a real paid outcome. Accuracy is structurally "observe-and-cite the external market, and bound pay from above by the bill" (pay ≤ bill × margin), never "compare to what we paid." This is the ceiling on how accurate the system can ever get from internal data alone, and it is why the bill-extraction lever (below) matters: bill is the *only* internal signal available.

**4. The self-learning loop is fully built but completely starved — the sim does not currently learn.**
All the calibration machinery exists and is wired end-to-end on the dashboard UI: a feedback entry would record `simulatedRate` vs recruiter-`acceptedRate`; `loadSpecialtyCalibration` would average the accept/sim ratio over the last 10 entries; and if ≥3 entries exist with a >3% bias, it would apply a **50%-dampened, ±15%-clamped** adjustment (`adjustment = 1 + (ratio−1)·0.5`, clamped to `[0.85, 1.15]`) to future quotes — never pushing a quote above the researched max. But the feedback data tree has **zero entries**, and no capture mechanism populates it. With fewer than 3 entries the trigger never fires, the adjustment is permanently 1.0, and the loop is a no-op. So any claim that the sim "self-improves from recruiter outcomes" is currently **false**. And even when fed, it would calibrate to recruiter-*asserted* accepted rates, not verified paid rates (see weakness 3).

**5. CRNA — and a large share of specialties — are frozen on static bands.**
CRNA has **0 locum-tagged and 0 rate-type-classified live rows** in the current data, so the bridge produces nothing for it and it stays pinned to its static **$190–250** band. The much-advertised "5-tier triangulated" CRNA envelope (HIGH > MULTI-SOURCE > DERIVED > PUBLIC-HINT > MANUAL-ESCALATION) is, in practice, unreachable past PUBLIC-HINT because the IAS booking table holds 0 actual paid CRNA rates — so its locum multiplier falls back to literature defaults and the "envelope" is really BLS × prior dressed up as triangulation. This generalizes: any specialty the fleet does not actively source stays static with no live corroboration, and nothing surfaces the absence to the user.

**6. Most live rows are untagged, so the precedence/locum filters rarely engage.**
The whole point of the rate-type precedence ladder and the locum-arrangement filter is to prefer real locum data over permanent/bill-rate noise. But the live canonical market view distribution is: `advertised_clinician_pay` 239, `scraped_article_estimate` 454, `crowd_survey` 2, **null 186**, and `permanent_wage_proxy` / `agency_bill_rate` / `actual_paid_locum` all **0**. With most rows either un-classified or scraped-estimate, the precedence ladder mostly collapses into the `null_unclassified` bucket and rarely does any discriminating work. The just-added non-locum (permanent-wage-proxy) exclusion filter is, on today's data, a **no-op** — 0 such rows exist. It is a correctness guard against a latent vector (a scraped Doximity/Medscape/MGMA W2-survey row sneaking in via a scraper agent), not an accuracy mover today.

**7. The highest-quality data producer is built but not running.**
The `rate_observer` agent — the only producer that emits cited, locum-verified, employment-tagged rows through a deterministic "cite-or-suppress" trust boundary (defending against an 11–57% LLM citation-hallucination rate via literal-substring grounding) — is **built but unscheduled**. It has no entry in the fleet's schedule config, so it contributes **zero production rows**. The single biggest data-quality stream the system was designed around is dark. As a result the "observe-and-cite" accuracy moat is implemented but not actually feeding live quotes.

**8. Coarse and brittle modeling details.**
Geography is **state-granular only** — there is no metro/MSA resolution feeding the multiplier (the city list only flips a rural flag). The multipliers themselves (shift 1.00–1.35, facility 0.85–1.30, etc.) are flat research-estimated point values with no variance, compounded multiplicatively and capped at 1.75×. The locum-vs-W2 multipliers that drive the BLS sanity check (1.35–3.50 by job family) are self-described as "observation-derived midpoints, NOT primary-source-cited" — judgment, not evidence, on the single biggest term in every expected-rate calculation. And specialty/state inference over messy PDF text is heuristic regex: an unrecognized specialty silently defaults to **internal medicine** (Low confidence the only tell), and a typo'd state yields no geo adjustment (multiplier 1.0). The call-only path additionally carries a hard schema limit — **one band per day-type slot** — so a specialty like anesthesiology cannot hold *both* a worked-day and a beeper-call band, forcing a silent comp-model mismatch the rest of the engine works hard to avoid.

---

### What is good but could be better

These are working, defensible parts of the system that nonetheless leave accuracy on the table.

**1. The overlay statistics are sound but linear where they could be empirical.**
The `p70` that anchors the base rate is a flat 70% interpolation of `min`/`max`, not a real percentile of observed pay. Likewise the premium-tier markers (p25/p50/p70/p75/p90) shown on the market-position bar are linear interpolations across the adjusted `[min, max]` range — a presentational construct, not measured market dispersion. The variance-weighted posterior already contains the *real* distributional information (weighted mean, weighted variance, median) to derive honest percentiles; today those percentiles are drawn by ruler instead. Good enough to look right; not yet driven by the dispersion actually observed.

**2. Source coverage is real but shallow and uneven.**
The fleet harvests from ~25 scraper sources plus ~13 Tavily specialty searches plus an Exa neural search, and the gating discipline is excellent. But coverage is thin per-specialty: many call-only bands are single-source point estimates (`min == max == typical`, sources:1) presented as if precise; holiday day-types are null for essentially every specialty; weekend bands frequently mirror weekday or are absent. The bridge runs once daily on a hard 7-day window, so thin-data specialties oscillate in and out of having a live band as scrape volume fluctuates. And the source-reliability scores the bridge computes (bootstrap stability + cross-source agreement) are explicitly **not weight-bearing** and never validated against closed deals — they are honest internal-consistency labels, not a signal that actually improves the number.

**3. Per-specialty and request-type depth is honest but sparse.**
The audits proved the *covered* bands are good, but coverage itself is the limiter. A large share of specialties fall to "insufficient data" on weekend/holiday request types even when a recruiter genuinely needs that quote, pushing the work back to manual judgment. Callback differentials are flat band-midpoints with no geo or facility adjustment — fine for citation integrity, coarse across extreme markets. The GSA per-diem table is correct but hand-maintained and will silently go stale at the next fiscal-year rollover unless someone edits it. And the BLS-OEWS baseline used by the sanity check is a frozen May-2024 snapshot in a static module, aging silently with no automated freshness check.

---

### Bottom line

The simulator's accuracy is **genuine but front-loaded into the static layer**: well-researched, audit-validated bands (11/14 accurate; request-type engine that rejected 13 fabrications), wrapped in honest confidence labeling, no-fabrication discipline, and strong anti-gaming guardrails on the data that flows in. That is a real, defensible foundation, and the faithful port means both apps inherit it equally.

The weaknesses are concentrated in everything *downstream* of those bands: the quote is priced off a crude confidence-blind floor while the statistically-correct posterior sits unused one layer away; the self-learning loop is fully built but has zero inputs; CRNA and many specialties are frozen for lack of tagged live data; the best data producer is dark; and there is no internal paid-rate ground truth to validate against. None of these make the sim *inaccurate* on the audited specialties — they make it *unable to get better than its static bands*, and occasionally let a single low-confidence row distort a displayed floor. The honest one-line summary: **good numbers, well-guarded, but pricing off the crude band and not yet learning** — the accuracy ceiling is set by the static curation, and the machinery that would lift that ceiling (v2 posterior in the quote, a wired feedback loop, fleet tagging, CRNA sourcing, bill extraction) is built but not yet connected.

---

## Known Gaps, Limitations & the Improvement / Innovation Backlog

This section catalogs, honestly and exhaustively, what the IMS locum rate simulator does NOT do well, why, and a sequenced backlog of concrete levers and innovations to close those gaps. It is deliberately self-critical: the engine is well-researched and structurally disciplined (no fabricated numbers, cite-or-suppress everywhere, robust statistics in the verification layer), but the number a user actually sees is priced off a cruder path than the system is capable of producing, the self-learning loop has no inputs, and the highest-quality data stream is built but not running. Each improvement below is paired with its expected accuracy impact and its risk / blast radius, because several of the biggest wins also move live quotes in BOTH apps simultaneously and cannot be shipped casually.

---

### Part A — Honest Constraints (the things that are genuinely true and limiting today)

#### A1. No internal pay ground truth

IMS knows the **bill rate** it charges a facility inside LocumSmart, but it does **not** know what it actually **paid** the clinician. The operational tables (`ls_events`, `ims_jobs`) carry no rate columns. There has never been a single `actual_paid_locum` row in the data (live count: 0). This is the single deepest constraint in the whole system, because it means:

- Accuracy can only ever be **observe-and-cite from the public market** (Tier 1 PhysicianSideGigs / Vivian / AANA, Tier 2 scraped agency pages, Tier 3 BLS × locum premium, Tier 4 modeled), never validated against a hard internal outcome.
- The system can **bound pay from above** by the bill rate (pay ≤ bill × margin, where margin defaults to 0.20, so pay ≤ bill × 0.80) — but that internal signal is **not currently wired** (see B5).
- Even the calibration loop (A2) learns from a **recruiter-asserted accepted rate**, not a verified paid rate, so "self-learning" — even once active — calibrates to a human-entered number with its own aspirational bias, partially mitigated by dampening and clamping but never eliminated.

There is no code fix for this; it is a data-availability fact. Everything downstream is engineered around it.

#### A2. The self-learning loop is fully built but has zero inputs (confidence-blind by starvation)

The engine ships a complete, tested calibration system:

- `loadSpecialtyCalibration(specialty, rateMode)` reads RTDB `rate-simulator/feedback` (merged with a `localStorage` backup), filters to the matching specialty and inferred rate-mode (`hourly` vs `call_daily`, split at a `$1000` magnitude floor), takes the **last 10** entries, and computes `recentAvgRatio = mean(acceptedRate / simulatedRate)`.
- It fires only when `recent.length >= 3` **and** `|recentAvgRatio − 1| > 0.03`.
- The adjustment is deliberately conservative: `adjustment = 1.0 + (recentAvgRatio − 1.0) × 0.5` (it acts on only **50%** of observed bias), then clamped to **[0.85, 1.15]** (no single specialty can ever move more than ±15%).
- `computeDisplayedRate` applies it AFTER the engine, with margin-leak guards: positive calibration can never push displayed pay above `spec.max` or past an engine cap; negative calibration always applies.

Every piece exists and is unit-tested. The dashboard `FeedbackSection` even **writes** correctly-shaped entries to RTDB + localStorage on submit and triggers a same-key refetch. **The loop is inert for exactly one reason: `rate-simulator/feedback` has 0 entries** and no durable recruiter-facing capture path actually populates it at scale. With fewer than 3 entries the trigger never fires, `adjustment` stays `1.0`, and `applyCalibration` short-circuits. **The simulator does not self-improve from recruiter outcomes today.** Any claim that it "learns" is currently false in production.

#### A3. The quote is priced off a crude, confidence-blind legacy band — while the good number sits one layer away, display-only

This is the central architectural gap and it deserves precision, because the system **computes the right number and then doesn't use it for the quote.**

There are two parallel market-data paths written by the daily bridge into Firebase RTDB:

1. **Legacy crude band** (`rate-simulator/market-rates`). For each specialty the bridge writes `min = min(rate_low)`, `max = max(rate_high)`, and `p70 = min + (max − min) × 0.70` — a flat linear interpolation, **not** a real percentile of observations. At app init, `loadMarketRates()` reads this and **mutates the shared `SPECIALTIES` singleton in place** (`spec.min/max/p70 = market.*`) for any row that is fresh (< 7 days), multi-source (≥ 2 non-empty source strings), and non-cap. The displayed quote is then computed by `calculateRate()` entirely off this mutated band (`base = spec.p70`, ceiling = `spec.max`).

2. **Variance-weighted v2 posterior** (`rate-simulator/market-rates-v2`). The bridge also computes a proper `aggregateCell` posterior per `(specialty, state, rate_type)` bucket: MAD-based outlier rejection (modified-z `0.6745·(x−median)/MAD > 3.5`), inverse-variance-weighted mean and variance (`weighted_mean = Σwx/Σw`, `weighted_variance = 1/Σw`), corporate-family collapse, a 60% family-weight cap (D-37), bimodal detection that returns a null mean rather than collapsing a mixed locum/perm cell, and rate-type precedence selection (D-39: `actual_paid_locum 4 > advertised_clinician_pay 3 > crowd_survey 2 > scraped_article_estimate 1`). This is the statistically correct number. **Its only consumer is `MarketDataView` — a display panel. It NEVER touches the quote.**

So the quote is anchored to a **confidence-blind min/max band**: a single low-confidence scraped estimate that merely survives the ≥ 2-source gate can set the displayed range floor. The live, concrete example is **anesthesiology**, whose `$240` floor is a single `exa_semantic` locum scraped estimate (`arrangement = unknown`, confidence low) — not BLS, not a triangulated posterior. The same crude band is what the new Astro hub uses too: by design the hub wires `loadMarketRates` **only**, never `loadMarketBuckets`, so it is at **full parity** with the dashboard — equally crude, not worse.

A subtle corollary: the legacy band **merges across `rate_type`**, where the v2 path respects `RATE_TYPE_PRECEDENCE`. The legacy band can therefore blend in permanent-proxy or bill-context magnitudes the posterior would have excluded. (The newly-staged non-locum filter — see A6 — closes one such leak, but it is a 0-row no-op on today's data.)

#### A4. Untagged data — the precedence/locum machinery mostly idles

The bridge's quality ladder (rate-type precedence, locum-arrangement filter, non-locum exclusion) only engages if the upstream fleet actually **tags** rows. It largely doesn't yet. Live distribution in the canonical MARKET view (all dates):

| rate_type | count |
|---|---|
| scraped_article_estimate | 454 |
| advertised_clinician_pay | 239 |
| null (unclassified) | 186 |
| crowd_survey | 2 |
| permanent_wage_proxy | 0 |
| agency_bill_rate | 0 |
| actual_paid_locum | 0 |

186 of the live rows are `null`, landing in the `null_unclassified` bucket where the precedence ladder cannot rank them, and `actual_paid_locum` — the top of the ladder — has never had a single row. The classifier and `evidence_employment_arrangement` enum (`locum_tenens / permanent / locums_to_perm / transition_mgmt / unknown`) exist in code, but the **bulk of historical rows predate the tagging** and are null. The precedence ladder is asserted correct by tests, not exercised by live data.

#### A5. CRNA is structurally static ($190–250) and its "triangulated" envelope is really a prior

CRNA has **0 locum-tagged and 0 rate-type-classified live rows**. The fleet does not currently source CRNA-specific locum pages. Consequences:

- The bridge produces **nothing** for CRNA, so it stays frozen on the static `$190–250` band (p70 232).
- The dedicated CRNA cell envelope (`getCrnaCellEnvelope`: `expectedHourly = BLS_state_p50 × LOCUM_MULT_CRNA × (1 − UHC_cut)`) advertises a 5-tier evidence-depth dispatch (`HIGH > MULTI-SOURCE > DERIVED > PUBLIC-HINT > MANUAL-ESCALATION`), but because IAS has **0 actual paid CRNA rates**, the empirical multiplier ladder always falls to the **literature default** (`locum_w2 1.4 / 1099_independent 1.6 / locum_1099 1.7 / w2_employee 1.0`) and the tier caps at **PUBLIC-HINT**. The envelope is therefore `BLS × prior`, honestly graded but dressed in triangulation language. There is a real risk of the UI badge overstating evidence depth.
- A `$250` iron-dome ceiling (`MAX_HOURLY_CEILING.crna`) and the `external_specialty_surveys` BLS-spine table keep it safe, but safe is not the same as observed.

#### A6. Confidence-blind floor + cross-rate_type bleed + a guard that's a no-op today

`computeLegacyBand` takes raw `min(rate_low)` / `max(rate_high)` with **zero** quality, reliability, or count weighting. One outlier endpoint defines the band edge. The 60% family-weight cap (D-37) that would protect against fake-consensus is a **no-op under the flat `evidence_weight = 1.0` model** (max share `1/k ≤ 50%`), so it only bites under a future non-flat weighting scheme. The staged **non-locum filter** (`isNonLocumWageRow`: drop `rate_type === permanent_wage_proxy` OR `arrangement === permanent`, then re-dedup within the locum subset) was added this session as a correctness guard mirroring the never-anchor (ZipRecruiter/Adzuna) exclusion — but with **0 `permanent_wage_proxy` rows live, it changes nothing today**. It is insurance against a future scraped W2 compensation-survey row (Doximity/Medscape/MGMA via `url_override`) that could slip through the canonical view on a scraper `agent_id`.

#### A7. Hub == dashboard quote parity (a strength that is also a ceiling)

Golden-master parity is **byte-identical** (208 cases), gate-1 (core) and gate-2a (data-layer logic, 266 mocked tests) green, gate-2b (live overlay wiring) shipped to the hub. This is genuinely good: the hub is a faithful port, not a fork, so the two apps never diverge. But it is also a **ceiling**: the hub can never be MORE accurate than the dashboard's crude legacy band, and it deliberately omits two dashboard data-layer features (the v2 buckets for the quote, and the Supabase CRNA cell-envelope floor). So any quote-accuracy fix must be applied to the **shared engine**, which by construction shifts **both apps' live quotes at once**.

#### A8. High blast radius of band changes

Because both apps share one engine and the bridge is documented **D-33 zero-drift**, every band correction or aggregation change is a **dual-app live event**. Concretely:

- A static-band edit (e.g. the shipped IM `$115–160 → $130–200`, urology `$220–275 → $220–330`, radiology `$185–290 → $185–330` corrections) flows: canonical dashboard `specialties.ts` → golden-master rebaseline → sync → hub cherry-pick. It moves dashboard and hub quotes simultaneously.
- A bridge/aggregation change requires **firebase-admin WRITE creds on the EC2/PM2 fleet** to re-run — it is **not** a code-only operation and cannot be completed inside a dev session.
- Adopting the v2 posterior for the quote breaks byte-identical golden-master parity and forces a full rebaseline + hub re-port + re-audit.

This is why the highest-impact levers (B1, B2) are also the highest-risk and are deliberately sequenced after the cheaper guards.

---

### Part B — The Improvement / Innovation Backlog

Ordered roughly by **accuracy-impact-per-unit-risk**. Each item states the lever, the expected accuracy impact, and the risk / blast radius.

#### B1. Adopt the v2 variance-weighted posterior as the QUOTE anchor — the single biggest upgrade

**Lever.** Replace (or blend) the crude `spec.min/max/p70` overlay in the quote path with the `loadMarketBuckets()` primary bucket selected by `RATE_TYPE_PRECEDENCE`. The data **already flows to RTDB** (`market-rates-v2`); the only missing wiring is the reader → quote path. Replace the linear `p70` with the bucket's `weighted_mean` (and surface `weighted_variance` as a real confidence width), and use the bucket's `median` / posterior bounds for the displayed range instead of raw min/max.

**Expected accuracy impact.** Largest of any single change. It moves the quote from "a single low-confidence scraped estimate can set the floor" to "an MAD-outlier-rejected, inverse-variance-weighted, family-collapsed, rate-type-correct posterior." The anesthesiology `$240` artifact floor disappears. Confidence stops being structural (did we identify the specialty) and becomes statistical (`multi_source / single_source / zero_spread / manual_review_bimodal`).

**Risk / blast radius. Very high.** It shifts live quotes in BOTH apps, breaks the byte-identical golden master (requiring a full rebaseline), forces a hub re-port, and needs a fresh cited audit because every specialty's headline number can move. It also needs careful handling of `manual_review_bimodal` and `insufficient_data` buckets (fall back to the static curated band, never fabricate). This is a multi-session, gated, show-before-deploy change — the correct big bet, but not a casual one.

#### B2. Confidence/quality-weight the legacy floor (the cheaper interim of B1)

**Lever.** If B1 is deferred, stop `computeLegacyBand` from taking raw `min(rate_low)`. Replace the floor with a **reliability- or count-weighted lower bound** — e.g. a low percentile of distinct-observation midpoints, or a variance-aware floor that down-weights single low-confidence rows — and let the 60% family cap actually bind by moving off flat `evidence_weight = 1.0`. Apply the v2 MAD+IVW weighting to the legacy path.

**Expected accuracy impact.** High and targeted: directly kills the "one low-confidence scraped estimate sets the displayed floor" failure mode (the anesthesiology `$240` case) without the full v2-quote migration. Roughly 70% of B1's benefit at a fraction of the risk.

**Risk / blast radius. Medium-high.** Still moves both apps' floors (any specialty whose floor was set by a thin row will shift), still a bridge change requiring a fleet re-run with write creds, but it preserves the existing band shape and is a smaller golden-master delta than wholesale v2 adoption.

#### B3. Build a durable feedback-capture mechanism + close the calibration loop — the real self-learning unlock

**Lever.** Wire a recruiter-facing capture path that **actually populates `rate-simulator/feedback`** at scale (the dashboard `FeedbackSection` already writes shape-valid entries on the happy path and `LogQuoteButton` already logs displayed quotes; the gap is recruiters submitting outcomes + a durable, shared, server-side capture rather than per-browser localStorage). The hub today has **no** write path at all and needs one added. Once ≥ 3 entries per `(specialty, rate_mode)` exist, `loadSpecialtyCalibration` crosses its trigger and the dampened/clamped self-correction turns on.

**Expected accuracy impact.** Transformational over time — it is the **only** mechanism by which the sim improves from real-world outcomes rather than from more scraping. Conservative by design (±15% clamp, 50% dampening, ≥ 3 entries, never above `spec.max`), so it cannot whipsaw. Note the honest ceiling: it calibrates to **recruiter-asserted accepted rates**, not verified paid rates (A1), so garbage-in is possible (aspirational numbers), partially mitigated by the dampen+clamp.

**Risk / blast radius. Medium.** The capture write path is additive and low-risk; the behavioral change (quotes start moving per feedback) is bounded by the ±15% clamp and `spec.max` guard. Watch: `localStorage` is per-browser and unshared, so two recruiters' local histories diverge — the durable path should be **server-side aggregate**, not browser-local, to avoid skew. First real writes will also exercise the dedup/merge/clamp code against live data for the first time, which may surface latent bugs.

#### B4. Fleet: tag `rate_type` + `evidence_employment_arrangement` on ALL rows, and add CRNA locum sources

**Lever.** Two coupled moves: (a) **backfill** — re-run the classifier over the ~186 null + legacy historical `rate_intelligence` rows so they carry `rate_type` + arrangement, making the precedence ladder, locum filter, and v2 bucketing actually engage on the majority of rows instead of collapsing to `null_unclassified`; (b) **CRNA sources** — add Tier-1 (PhysicianSideGigs / Vivian / AANA) and CRNA agency pages to the fleet so CRNA leaves the frozen `$190–250` static band with real observations under the `$250` iron-dome ceiling, and the CRNA envelope can finally reach `MULTI-SOURCE`/`HIGH` instead of perpetually defaulting to literature priors.

**Expected accuracy impact.** Medium-to-high and broad: it is the **prerequisite** that makes B1/B2's machinery meaningful (a perfect posterior over untyped rows still can't apply precedence). Brings the largest single under-covered specialty (CRNA) live.

**Risk / blast radius. Medium.** Backfilling re-classification can re-route existing rows between buckets, shifting some live posteriors; it must be staged and diffed. Adding sources is additive and low-risk but is gated by the `$90/mo` circuit breaker and per-tool volume caps. Both require a fleet/bridge re-run (write creds, not code-only).

#### B5. Schedule `rate_observer` — turn on the highest-quality evidence stream

**Lever.** `rate_observer` is the **only** producer that emits cited, locum-verified, employment-tagged rows (a 5-stage GATHER → CITE → VERIFY → STRUCTURE&WRITE pipeline with a deterministic non-LLM VERIFY trust boundary: literal-substring grounding + single-figure check + grounded locum-evidence + default-deny negation, defending against the cited 11–57% citation-hallucination rate). It is **BUILT but UNSCHEDULED** — no `schedules.yml` / `pipelines.yml` entry, so it contributes **zero production rows**. Add the schedule and provision `ANTHROPIC_API_KEY` on the fleet.

**Expected accuracy impact.** High on data **quality** (not just volume): it is the source of `actual_paid_locum`-adjacent, Proof-Carrying-Number rows with `cited_text` + `locum_tenens` tagging — exactly the high-precedence, well-tagged rows B1/B4 need. It also powers the `CitedObservations` surface with real cited quotes.

**Risk / blast radius. Low-medium.** It is a producer; it only adds rows (subject to the same canonical-view admission and the `$90/mo` breaker), it does not directly touch the quote path. Its rows flow into the same bridge and only move quotes transitively, after the bridge re-aggregates. Cost watch: it is the only LLM-using producer (one Haiku Citations call per cell), so it consumes budget against the circuit breaker.

#### B6. Wire LocumSmart BILL extraction — the only internal signal (bill bounds pay from above)

**Lever.** Extract bill rates from LocumSmart invoices/timesheets (the `confirmationAgreementId`-carrying records; `sisense_bids` / agreements already model the rate axes) and use them to bound pay from above: `pay ≤ bill × (1 − margin) = bill × 0.80`. This is a **sanity bound / over-quote backstop**, not a pay source.

**Expected accuracy impact.** Medium but uniquely valuable: it is the **only** internal signal available given A1, and it can catch any market-observed quote that exceeds what IMS could plausibly pay at a real observed bill. It does not set the quote; it constrains it.

**Risk / blast radius. Low-medium.** Additive bound, can only pull a quote DOWN (matching the engine's existing "math only lowers toward a documented bound" discipline). Requires plumbing LS bill data into the engine's bound logic and confirming the margin assumption per case. No fabrication risk because it only clamps.

#### B7. ML / Bayesian calibration on top of the posterior

**Lever.** Once B3 (feedback) and B4/B5 (tagged, cited data) are flowing, replace or augment the linear `p70` interpolation and the flat-constant multiplier table with a proper model: a Bayesian hierarchical model with the BLS-anchored expected rate as a prior and the v2 posterior + feedback as evidence, or a regularized regression over `(specialty, state, facility, shift, duration, arrangement)`. Re-derive `p70` from the **actual observed distribution** rather than `min + (max − min) × 0.70`, and feed real `evidence_weight` (multi-day-confirmed, source-reliability) into the IVW instead of the near-constant `1.0`.

**Expected accuracy impact.** High once the data exists, especially for thin-data specialties where shrinkage toward the BLS prior beats raw min/max. Turns the multiplier chain (currently flat point values 1.20/1.15/0.85… compounding multiplicatively, capped at 1.75) into variance-aware, per-specialty-learned modifiers.

**Risk / blast radius. High.** It is the most complex change, introduces model-explainability and over-fitting risks (must remain auditable — the no-fabrication standard requires every output trace to a bound), and depends on B3/B4/B5 being live first. Sequenced last for good reason.

#### B8. Per-specialty request-type expansion (lift the one-band-per-slot schema limit)

**Lever.** The call-rate engine's `CallRateEntry[dayKey]` is a **single `CallRateBand | null`**, so a specialty cannot hold BOTH a worked-day **and** a beeper-call band for the same day-type. This blocks a documented deferred item: anesthesiology can only carry its worked-day band, so an anesthesiology beeper-call axis cannot be added; neonatology cannot add a daily beside its `adjacentHourly`. Change the slot to an array or `{worked, beeper}` pair. Separately, add cited **weekend** and **holiday** bands (almost all holiday slots are null today, so the holiday day-type nearly always resolves to `insufficientData`), and backfill single-source point-estimate bands (`min == max == typical`, `sources: 1`) with a second independent family.

**Expected accuracy impact.** Medium and structural for the call/per-diem path. It is a **correctness ceiling**, not just a missing feature: a real anesthesiology beeper-call assignment is currently priced (or suppressed) against the worked-day band — a silent comp-model mismatch the rest of the engine works hard to avoid. The 26-specialty request-type audit confirmed the engine is in **good shape** here (adversarial verify rejected 13 fabricated changes; GSA FY2026 per-diems all correct), so this is targeted depth, not broad repair.

**Risk / blast radius. Low-medium.** The call-only path is **fully static** and consumes neither the live overlay nor the v2 posterior, so changes are confined to the static `CALL_RATE_DATA` table + the schema shape — no live-data interaction. It is a schema migration plus cited band additions; blast radius is the call/per-diem quotes only, and only for specialties edited.

#### B9. Outlier trimming + provenance-weighted percentiles (the residual statistical levers)

**Lever.** Two refinements that ride on B1/B4: (a) ensure the quote path inherits `aggregateCell`'s **MAD outlier rejection** (modified-z > 3.5) and **bimodal/modal-escape** guards rather than the raw legacy min/max, so a locum/perm mixed cell never collapses to a wrong mean; (b) compute displayed **percentiles from provenance-weighted observations** — weight each observation by source reliability (`bootstrap_reliability`, currently computed but explicitly **not** weight-bearing, D-38b) and rate-type precedence — instead of linear interpolation across `[min, max]`. The hub's premium-tier p75/p90 markers are presently **linear-interpolated**, not measured dispersion; drive them from the real distribution.

**Expected accuracy impact.** Medium and precision-focused: removes the "presentational construct masquerading as measured dispersion" weakness in the percentile chips and the premium-tier overlay, and makes `source-reliability` finally do something (today it is display-only and never checked against closed-deal outcomes — pair this with B3 to make it weight-bearing once outcome telemetry exists).

**Risk / blast radius. Medium.** Depends on B1 (so the quote consumes the posterior) and B4 (tagged rows) being live; making reliability weight-bearing changes the posterior, which moves quotes. Lower-risk if shipped as the final polish after the structural changes land.

---

### Sequencing logic (why this order)

Cheapest correctness guards first, then the structural unlocks, then the model:

1. **B5 (schedule rate_observer)** and **B6 (LS bill bound)** are near-pure-additive and unlock data/sanity without touching the quote math.
2. **B4 (tag + CRNA sources)** makes the existing precedence/locum machinery actually engage — a prerequisite for everything statistical.
3. **B3 (feedback capture)** turns on the dormant self-learning loop — the only path to outcome-driven improvement.
4. **B2 (quality-weight the floor)** is the high-value interim that kills the confidence-blind-floor bug at medium risk.
5. **B1 (v2 posterior for the quote)** is the headline upgrade — highest impact, highest blast radius, gated and audited.
6. **B7 (ML/Bayesian), B8 (request-type schema), B9 (provenance percentiles)** are the depth/polish layer that only pays off once tagged data, feedback, and the posterior-quote are live.

The throughline: the system already **produces** the right number (the v2 posterior) and already **has** the right learning machinery (calibration) — the backlog is overwhelmingly about **wiring what exists** (feedback inputs, posterior-to-quote, scheduled observer, tagged rows, bill bound) before building anything genuinely new (ML calibration, schema expansion). The honest one-line summary: *the moat is built; most of it just isn't plugged in yet.*

---

## Open Research Questions for This Deep-Research Session

This section enumerates specific, externally-researchable questions for the ChatGPT deep-research session. The goal is to advance the IMS locum rate simulator from a well-engineered but observe-and-cite, confidence-blind, non-self-learning system toward a defensibly accurate, statistically grounded, validatable pricing model. Each question is framed so that public web research (government wage data, industry compensation surveys, staffing-firm methodologies, academic and quantitative-pricing literature) can meaningfully advance it.

For grounding, the system's current state is: the displayed quote is priced off a static per-specialty min/max/p70 band (p70 = a flat linear interpolation `min + (max-min)*0.70`, NOT a real observed percentile), optionally overlaid in-place by a crude min/max/p70 computed over recent scraped rows. A statistically proper variance-weighted posterior (MAD outlier rejection at modified-z > 3.5, inverse-variance weighting, family-collapse, 60% family-weight cap) already exists but is used for DISPLAY ONLY, never the quote. There is NO internal pay ground truth (IMS knows the LocumSmart BILL rate but not what it actually paid clinicians), the self-learning feedback loop is wired but starved (0 feedback entries), and the bill-to-pay relationship is hard-coded as a single global 20% margin (`bill = roundUp5(pay / 0.80)`).

### A. Market-Data Sourcing (the input layer)

1. **What are the authoritative, legally-reusable public sources for locum tenens (1099/contract) physician and CRNA hourly rates by specialty and geography in the US?** The fleet currently scrapes ~29 agency/article sources (locums.com, locumstory, CompHealth, Barton, Weatherby, Jackson+Coker, plus Tavily/Exa search). Catalog the full universe of credible rate sources, classify each by tier (Tier-1 primary/cited e.g. PhysicianSideGigs, Vivian, AANA; Tier-2 staffing-agency published ranges; Tier-3 BLS-derived; Tier-4 modeled), and for each note: update cadence, geographic granularity (national vs state vs MSA), whether it reports locum vs W2/permanent vs agency-bill, and terms-of-use/scraping legality.

2. **Which sources publish observed/transacted locum rates versus advertised or aspirational rates?** The system distinguishes `actual_paid_locum` > `advertised_clinician_pay` > `crowd_survey` > `scraped_article_estimate` (precedence weights 4/3/2/1) but currently has 0 `actual_paid_locum` rows live. Identify any public or purchasable datasets (e.g., MGMA, SullivanCotter, Medscape, Doximity, ECG, AMN/CHG annual rate reports, locum-platform transparency reports) that approximate transacted rates, and assess what each would cost and how its sample is constructed.

3. **What is the documented, citable relationship between a permanent/W2 hourly-equivalent wage and the locum tenens rate for the same specialty?** The system converts BLS OEWS W2 medians to a locum-equivalent using a single `PREMIUM_FACTOR = 1.25` (allowed band [1.20, 1.35]) for government rows, and a separate uncited per-SOC-family `LOCUM_MULTIPLIER` table (1.35 to 3.50, e.g. ANESTHESIA_APP 3.50, PHYSICIAN_HOSPITALIST 2.45, SURGEON_CORE 1.70, NP_PA 1.45) used in the BLS sanity check. **These multipliers are self-described as "observation-derived midpoints, NOT primary-source-cited" and are the single largest lever on every expected-rate computation.** Find published, sourced locum-vs-permanent premium ratios by specialty (academic studies, staffing-industry white papers, AANA/AMGA/MGMA reports). Do they vary by specialty as steeply as 1.35-3.50 implies? Is a multiplicative premium even the right model, or is it additive/specialty-idiosyncratic?

4. **How fresh must locum rate data be to be decision-useful, and how fast do these rates actually move?** The system uses a hard 7-day staleness gate. Research the observed volatility of locum rates: do they move weekly (surge/crisis pricing), seasonally, or annually? What is the right staleness window, and should it differ by specialty (e.g., crisis-driven EM/hospitalist vs stable outpatient)?

5. **For CRNA specifically, what are the credible public locum rate sources?** CRNA is frozen at a static $190-250 band because the fleet has 0 CRNA locum-tagged sources and 0 rate-type-classified rows. There is also a documented UnitedHealth -15% reimbursement cut (effective 2025-10-01, with exempt states AR/CA/CO/HI/MA/NH/WY) modeled in the CRNA envelope. Identify CRNA-specific rate sources (AANA, Gaswork, CRNA-focused agencies) and verify/update the UHC cut details and any other payer actions affecting CRNA locum economics.

### B. Statistical Methods for Sparse, Multi-Source Rate Aggregation (the fusion layer)

6. **What is the state-of-the-art method for fusing a small number (often n=1 to ~10) of heterogeneous, differently-reliable point/range observations into a single rate estimate with honest uncertainty?** The system uses median + MAD outlier rejection (modified z-score `0.6745*(x-median)/MAD > 3.5`) followed by inverse-variance weighting with an empirical variance floor `max(MAD², (mid*0.05)², 1e-4)` and flat `evidence_weight = 1.0`. Evaluate this against alternatives: Bayesian hierarchical/partial-pooling models (borrowing strength across related specialties/geographies), robust Bayesian estimation, trimmed/Winsorized means, weighted quantile estimators. Which are defensible at n=1 to 10?

7. **How should source reliability translate into a quantitative weight in a fusion model?** Currently `evidence_weight` is a flat 1.0 for every distinct observation; a bootstrap-based "source stability" score is computed but explicitly NOT weight-bearing. Research methods for principled source weighting without ground-truth labels: inter-source agreement/concordance metrics, bootstrap stability, Bayesian source-reliability priors, and how staffing/financial data aggregators weight conflicting feeds.

8. **What is the correct way to detect and handle bimodal/mixed-population rate cells (e.g., a cell that accidentally mixes locum and permanent, or two distinct submarkets)?** The system uses two detectors: a split-half variance-ratio test (`varHigh > 4*varLow`, with a survivors-≥6 floor added after `[195,198,202,205,210]` false-positived) and a "modal-escape" check. Research robust unimodality/multimodality tests appropriate for very small samples (dip test, Silverman's test, Gaussian-mixture BIC) and their small-n failure modes.

9. **How should "corporate family" correlation be handled when multiple data points come from the same parent company under different brands?** The system collapses corporate families (CHG → CompHealth/Weatherby/Global Medical/Locumstory; AMN → Staff Care/Medefis; etc.) to one vote, then caps any single family at 60% of cell weight. Research best practice for handling source correlation / non-independence in data fusion (effective sample size under correlation, network/ownership-graph deduplication) and validate the current corporate-ownership mappings for US locum staffing firms (which brands roll up to CHG, AMN, Jackson, Cross Country, Aya, etc.).

10. **Is a linearly-interpolated p70 a defensible "recommended rate" anchor, and what percentile should a locum recommendation target?** The quote anchors on `p70 = min + (max-min)*0.70` — a linear interpolation, not an observed 70th percentile. Research: (a) the statistical invalidity of treating a min/max-interpolated point as a percentile, (b) what percentile of the market a staffing firm should recommend to balance fill-rate vs margin, and (c) how to estimate a real percentile from sparse observations.

### C. How Peers and Competitors Price Locum Rates (competitive/industry benchmarking)

11. **How do the major locum staffing firms (CHG/CompHealth, AMN, Jackson+Coker, Weatherby, Aya, Cross Country, LocumTenens.com) and rate-transparency platforms (Vivian, PhysicianSideGigs, Gaswork) actually determine and publish their rates?** Research their stated or inferable methodologies, what they disclose about ranges vs point rates, and whether any publish percentile/distribution data the simulator could anchor against.

12. **What bill-to-pay ratios / margin structures are standard in locum staffing, by specialty?** The system hard-codes a single global 20% margin (`bill = pay / 0.80`) for every specialty and offers a recruiter markup table (20-40%, recommended band 25-32% hourly; 40-70% for call/per-diem with 50-60% recommended). **Research actual industry gross-margin benchmarks by specialty and assignment type** (locum staffing firm margins are often cited in the 25-35% range of bill, but vary). Does margin vary systematically by specialty, urgency, duration, or geography? Is 20% realistic or low? This directly bounds the only internal signal IMS has (the bill rate bounds pay from above).

13. **How do firms price non-hourly request types — 24-hour beeper/home call, worked clinical days, callback differentials, weekend/holiday day-types?** The system carries static per-specialty daily bands (e.g., neurosurgery beeper $4,200-4,800/day; OB/GYN worked-day $3,900-4,200/12hr; anesthesiology worked-day $2,675-3,900/12hr; cardiology beeper $2,500/day; callback differentials as flat midpoints). Research published call-pay and per-diem structures, how beeper/restricted vs worked call is differentiated, and typical callback-hour rates and gratis-hour conventions by specialty.

14. **How is geographic rate variation modeled in the industry, and at what granularity?** The system derives a per-state multiplier from cost-of-living, physician density, and a demand class (`clamp((100/COLI)^0.30 * (304/density)^0.30 * demandWeight^0.40, 0.88, 1.38)`), with metro detection only flipping a rural flag. Research how staffing firms adjust for geography (state vs MSA vs facility-level), whether COLI/density/demand are the right drivers and exponents, and what authoritative demand signals exist (HRSA HPSA shortage scores, NPPES provider density, Conference Board/JOLTS vacancy data).

### D. Self-Calibrating Pricing Without Internal Ground Truth (the learning layer)

15. **How can a pricing model self-calibrate from recruiter-entered "accepted rate" feedback when no verified paid-rate ground truth exists, and what are the failure modes?** The dormant calibration loop computes `recentAvgRatio = mean(acceptedRate / simulatedRate)` over the last 10 same-specialty entries, then applies a 50%-dampened, ±15%-clamped (0.85-1.15) adjustment once ≥3 entries exist. Research: selection bias (recruiters only log certain outcomes), feedback-loop instability / runaway, the merits of dampening + clamping, minimum sample sizes for a per-specialty adjustment to be trustworthy, and how other pricing systems calibrate to soft/human-entered signals.

16. **What is the right experimental design to learn true accepted-rate elasticity (fill probability vs offered rate) for a locum recommendation, given low volume per specialty?** Frame this as a contextual-bandit / price-experimentation problem. Research price-experimentation and Bayesian-optimization methods that work at low volume, multi-armed-bandit approaches to rate-setting, and how to pool across specialties/geographies to overcome thin per-cell data.

17. **Can the agency BILL rate (the one internal signal IMS does have) be used to bound or infer pay, and how reliable is bill→pay inference?** IMS knows the bill rate in LocumSmart for confirmed placements but has no pay column. If industry margins are ~20-35%, then `pay ≈ bill * (1 - margin)`. Research how tight/variable the bill-to-pay relationship is in practice, whether it can serve as a one-sided upper bound on pay, and how to estimate the margin distribution to invert bill into a pay estimate with uncertainty.

18. **What feedback signals beyond "accepted rate" would most improve calibration, and which are observable to a staffing firm?** Consider: did the clinician accept/decline, time-to-fill, number of candidates presented, whether the rate was negotiated up/down, whether the placement closed. Research which leading indicators best predict whether a quoted rate was "right," and how to instrument them.

### E. Validating Accuracy Without a Labeled Dataset (the verification layer)

19. **How do you validate the accuracy of a rate model when you have no held-out ground-truth labels?** This is the central methodological problem. Research label-free / weak-supervision validation strategies: triangulation/agreement against independent sources, back-testing against later-published survey data (e.g., does the model's June estimate match a September MGMA release?), face-validity/expert review protocols, anomaly/drift detection, and predictive checks (does the model predict the next scraped batch?).

20. **What does the academic and quantitative-finance/pricing literature say about benchmarking a "consensus from noisy estimates" against an unknown true value?** The model is essentially producing a consensus locum rate from disagreeing sources. Research methods for assessing estimator quality without ground truth: internal consistency, cross-validation across source subsets (leave-one-source-out), inter-rater reliability statistics, and calibration curves built from soft outcomes.

21. **What public "answer keys" exist to spot-check the model against, and how often are they refreshed?** The system has run cited audits (a 14-specialty audit found 11/14 static bands accurate, 3 under-quoted and corrected; a 26-specialty call/per-diem audit found GSA FY2026 per-diems all correct and rejected 13 of ~17 proposed changes as unsupported). Identify recurring, citable benchmarks (GSA per-diem tables, BLS OEWS annual releases, MGMA/SullivanCotter annual surveys, AANA CRNA compensation reports, staffing-firm annual rate guides) that can serve as periodic external check-points, with their release schedules.

### F. Bill-to-Pay and Margin Benchmarks by Specialty (the economics layer)

22. **What are documented locum staffing gross-margin / bill-to-pay benchmarks, broken out by specialty and by assignment type (hourly clinical vs call/per-diem)?** (Tightly related to Q12 but specialty-resolved.) The system applies a flat 20% pay→bill margin everywhere and a 40-70% markup range for call. Research whether high-acuity/surgical specialties carry different margins than primary care, whether call/per-diem genuinely commands a higher markup, and what publicly-reported staffing-firm financials (e.g., AMN/Cross Country 10-Ks, industry analyst reports) imply about blended vs per-specialty margins.

23. **Is the bill-rate-bounds-pay-from-above assumption (`pay ≤ bill * (1 - min_margin)`) economically sound across all specialties and arrangements, and are there cases where it breaks?** Research edge cases: loss-leader placements, pass-through expense models, MSP/VMS fee structures that change effective margin, and direct-contract vs subcontracted arrangements.

### G. Demand, Geography, and Specialty-Structure Inputs (supporting model drivers)

24. **What authoritative, regularly-updated data sources should drive the geographic demand weighting?** The current demand class (critical/high/moderate/adequate/surplus → weights 1.30/1.15/1.05/0.95/0.90) appears hand-assigned. Research HRSA Health Professional Shortage Areas (HPSA) scores, the HRSA/NCHWA supply-and-demand projections, NPPES/NPI provider counts, and state medical-board licensure data as quantitative demand proxies, and how to combine them into a per-state (or per-MSA) demand index.

25. **Are the cost-of-living and physician-density exponents (both 0.30) and the demand exponent (0.40) in the geo-multiplier defensible, and what does the literature say about the elasticity of locum rates to each driver?** Research any econometric estimates of how locum/contract physician pay responds to local cost-of-living, provider scarcity, and demand, to either validate or re-fit these exponents and the clamp range [0.88, 1.38].

26. **How should specialty taxonomy and SOC mapping be handled so that BLS anchors are applied to the right wage base?** The system maps ~88 specialties to SOC codes (with fallbacks to aggregate codes 29-1229/29-1249) and 152 canonical specialties overall. Research the correct/current BLS SOC codes for locum-relevant physician and APP specialties, known gaps (specialties with no distinct SOC code), and whether OEWS state-level data is reliable enough per-specialty to anchor a sanity check.

### H. Cross-Cutting / Strategic Questions

27. **Given the documented architecture, what is the single highest-leverage accuracy improvement, and what does external evidence say about its risk?** The internal candidate ranking is: (1) adopt the variance-weighted v2 posterior for the quote (currently display-only); (2) confidence/quality-weight the crude legacy band floor; (3) wire feedback capture; (4) fleet rate-type/arrangement tagging + CRNA sources; (5) wire LS bill extraction. Research whether comparable pricing systems found the "use the better statistical estimate you already compute" move to be as high-impact and low-regret as it appears here.

28. **What are the known failure modes and reputational/legal risks of an observe-and-cite scraped-rate pricing model, and how have others mitigated them?** Research: anti-trust/price-signaling concerns in rate-setting from competitor data, terms-of-service and scraping-legality exposure, the risk of citing aspirational marketing ranges as market rates, and disclosure/labeling best practices (the system already labels confidence and uses Proof-Carrying-Numbers with URL + verbatim cited text + substring verification).

29. **How should confidence be communicated to an end user (recruiter), and what confidence taxonomy do comparable data products use?** The system currently shows a structural High/Medium/Low (based on whether specialty/state were identified) that is decoupled from the statistical confidence of the underlying data (multi_source / single_source / zero_spread / manual_review_bimodal). Research best practices for surfacing data-quality/uncertainty to non-statistical users in pricing and analytics products.

30. **What is a realistic accuracy target and tolerance band for a locum rate recommendation, and how is "accurate enough" defined in this industry?** The BLS sanity check uses ±25% soft and ±40% hard deviation bands. Research whether ±25%/±40% are reasonable tolerances given observed market dispersion, what within-specialty rate spread actually looks like in published data, and how a recommendation should present a range vs a point given that real dispersion.

---

## Appendix: Constants, Thresholds, Schema & Live Data State

This appendix is a flat reference dump for the IMS locum rate simulator. It collects, in one place, the enums, numeric constants, statistical thresholds, confidence gates, GSA per-diem headline values, Firebase RTDB tree shapes, the Supabase canonical-view admission rule, the live row-count distribution by `rate_type`, the cost/circuit-breaker and premium constants, and a file-by-file map of which module owns what. Numbers here are pulled from every subsystem map plus the live-verified ground truth (2026-06-29). Where a value is a judgement call or a known weakness, it is flagged as such — nothing here should be read as a cited primary source unless it says so.

A single piece of context governs how to read everything below: in BOTH apps (the old React dashboard and the new Astro hub) the displayed quote is priced off the **static `SPECIALTIES` band** (`spec.min` / `spec.max` / `spec.p70`), optionally overwritten in place by the **legacy** RTDB overlay. The statistically-proper **v2 variance-weighted posterior** is computed and shipped to RTDB but is **display-only**. Keep that split in mind: many of the thresholds below (MAD cutoffs, family caps, rate-type precedence) operate on the v2/aggregation path, which the user-facing number does not currently consume.

---

### 1. Enums

**`rate_type` (6 values, DB CHECK enum, "D-11").** This is the classification of what a scraped/derived dollar figure actually represents:

- `actual_paid_locum` — a real locum payment observation (the gold standard; **0 live rows today**).
- `advertised_clinician_pay` — an advertised/posted locum pay rate.
- `agency_bill_rate` — what an agency bills a client (a bill rate, not pay). Excluded from the v2 market tree.
- `permanent_wage_proxy` — a W2/permanent-employment compensation figure used as a proxy (e.g. BLS conversions, Doximity/Medscape/MGMA salary surveys). Cannot be a "primary" rate.
- `scraped_article_estimate` — a number lifted from an article/blog estimate. The default fallback when classification fails.
- `crowd_survey` — a crowd/association survey figure (e.g. AANA).

**`evidence_employment_arrangement` (5 values, DB CHECK enum).** What employment structure the observation describes: `locum_tenens`, `permanent`, `locums_to_perm`, `transition_mgmt`, `unknown`.

**`source_legal_class` (4 values, DB CHECK enum).** The legal/source posture of a row: `public_seo_indexed`, `crowd_survey`, `trade_association_paid`, `community_forum`.

**`value_type` (2 values, default `market`).** Distinguishes a market pay/advertised figure (`market`) from an agency bill ceiling (`cap`). Cap rows are written to a separate RTDB node and are never bucketed into the v2 posterior.

**`ConfidenceLevel` (engine-side, 4 values).** `high` | `medium` | `low` | `modeled`. `modeled` is the default tier for an uncited researched band. Rank order used by overlay upgrades: `{modeled:0, low:1, medium:2, high:3}`.

**Aggregation confidence tiers (v2 posterior, 4 values).** `multi_source` | `single_source` | `zero_spread` | `manual_review_bimodal`. The last is the honest "I refuse to collapse a bimodal cell" sentinel — it carries a null mean.

**Comp models (call-rate engine, 2 values).** `24hr-beeper-call` (coverageHrs = 24) vs `worked-day-clinic` (coverageHrs = the scheduled shift, 8/10/12). The comp model drives the daily→$/hr divisor and must not be mixed across axes.

**Day-type slots (call-rate engine, 3 values).** `weekday` | `weekend` | `holiday`, each a single nullable band per specialty (the "one-band-per-slot" limit).

**Coverage tiers (v2 read side).** `primary` | `unclassified_only` | `insufficient_data`. CRNA-envelope dispatch tiers (5): `HIGH` > `MULTI-SOURCE` > `DERIVED` > `PUBLIC-HINT` > `MANUAL-ESCALATION`.

**Agent IDs (fleet).** `rate_scraper`, `rate_researcher`, `rate_observer` (built but unscheduled), `rate_validator`, `rate_auditor`, `gov_data_syncer`, plus `sisense_rate_writer` (cap-capable) and the legacy sentinel `unknown_legacy`.

---

### 2. Pricing constants — multipliers, clamps, ceilings

These are the flat point-value tables the hourly engine multiplies together. All are research-estimated point values with **no variance weighting** (a noted weakness — they compound multiplicatively).

**Shift multipliers (`SHIFT_MULT`):** day 1.00, night 1.20, weekend_day 1.15, weekend_night 1.30, holiday 1.35.

**Facility multipliers (`FACILITY_MULT`):** academic 0.85, community 1.00, asc 0.90, outpatient 0.90, cah (critical-access hospital) 1.22, va 0.85, correctional 0.92, fqhc 0.88, psych 1.12, rural_trauma 1.30, freestanding_ed 1.08, telehealth 0.75.

**Duration multipliers (`DURATION_MULT`):** emergency 1.20, short 1.10, standard 1.00, long 0.95.

**Call / holiday toggles:** `callMult = hasCall ? 1.10 : 1.0`; `holidayMult = (hasHoliday && shift !== 'holiday') ? 1.10 : 1.0` (the guard prevents double-counting with the holiday shift's 1.35).

**Rural:** `ruralMult = 1.0` — hard-neutralized. Rural scarcity is considered already priced by the geo term (the code cites a CRNA Kokomo, IN over-quote as the reason).

**Geo multiplier (`STATE_MULT`), derived at module load:**
`clamp( (100/COLI)^0.30 · (304/density)^0.30 · demandWeight^0.40 , 0.88 , 1.38 )`, rounded to 2 decimals.
Constants: `NATIONAL_AVG_DENSITY = 304`, `AVG_COLI = 100`. Demand weights: critical 1.30, high 1.15, moderate 1.05, adequate 0.95, surplus 0.90. A missing state → 1.0 (no geo adjustment). State-granular only — there is no metro/MSA resolution feeding the multiplier (the metro list only flips the rural flag).

**Combined multiplier cap:** `cappedMult = min(geo · rural · shift · facility · duration · call · holiday, 1.75)`. The hard ceiling on stacked premiums is **1.75×**.

**PDF rate-cap clamp (hourly):** if a bill cap is parsed and unit is `hour`/`unknown`, `capPay = cap · 0.80`; if `payRate > capPay` it is clamped down. (Day/shift caps are dropped on the hourly path.)

**Researched-max ceiling:** `if (payRate > spec.max) payRate = spec.max` and sets a **separate** flag `marketMaxApplied` (kept distinct from the `capped` flag so it does not suppress positive calibration). A quote can therefore only ever be pulled *down* toward a documented bound, never invented above it.

**Bill / margin:** the margin constant is **0.20** everywhere. `roundUp5(v) = Math.ceil(v/5)*5`; `billRate = roundUp5(payRate / 0.80)`. Call-only bill uses the same fixed 20% margin, NOT the hourly slider.

**p70 derivation:** `p70 = round(min + (max - min) · 0.70)` — a flat linear 70% interpolation of the band, **not** an observed percentile (a structural weakness; widening min/max shifts the anchor non-obviously).

**Percentile chips (market-position bar):** `WF_PERCENTILES = [25, 50, 70, 75, 90]`, each value `= round(adjMin + (adjMax-adjMin)·(p/100))` — also linear interpolation, a presentational construct, not measured dispersion.

**Per-specialty iron-dome ceiling:** `MAX_HOURLY_CEILING.crna = 250`. Escalate-only, applied LAST so no later relaxation can demote it. **Only CRNA has a per-specialty hard backstop**; every other specialty relies on `spec.max` alone.

**Hub bill calculator constants:** `BILL_HOURLY_MARKUPS = [20,22,24,25,27,28,30,32,35,38,40]`; recommended band 25–32%; slider clamp 15–45%; `dailyProfit = profitPerHr·10`, `annualProfit = profitPerHr·2080`; reverse field `marginFromCustomBill = (customBill - payRate)/customBill · 100`. The dashboard adds `CALL_MARKUPS = [40..70]`, call recommended band 50–60.

---

### 3. Call-rate / per-diem constants and notable bands

The call-only path uses **no shift/call/holiday multiplier** (the day-type band already encodes that premium). Its multiplier chain is `geo · rural(=1.0) · facility · duration`, capped at 1.75, then clamped to `band.max`, then to the day/shift rate cap (`cap · 0.80`). Daily→$/hr happens only at display: `heroPay = round(dailyPay / coverageHrs)` with a min divisor of 1 — dividing by **coverage** hours (24 for beeper, 8/10/12 for worked-day), never gratis hours. Dividing by gratis hours was the old bug that produced ~$821/hr neuro quotes. Callback = `round((min+max)/2)` band midpoint, **not** geo-scaled (preserves citation provenance). A null band yields pay 0, `insufficientData=true`, and the UI suppresses downstream panels rather than show a fabricated $0.

**Notable static bands (research constants):**
- ob/gyn: weekday worked(3900, 4200, 4050, 12h) + weekend beeper(1500, 1800, 1650).
- neurosurgery: weekday/weekend beeper(4200, 4800, 4500); callback 475; gratis 4.
- anesthesiology: weekday worked(2675, 3900, 3300, 12h); callback 400–500. (No beeper axis — blocked by one-band-per-slot.)
- neurology: weekday worked(1800, 3500, 2750, 10h).
- urology: weekday beeper(2500, 3500, 3150); weekend beeper(2500, 3000, 3000); callback 350–450; gratis 4; 5 sources.
- cardiology: beeper(2500, 2500, 2500); callback 350. Worked-day $3,200 deliberately NOT used as the beeper ceiling (comp-model non-mixing).

Sparse coverage is a real limitation: many specialties have all-null slots (sources:0 → insufficientData), holiday slots are null for essentially every specialty, weekend often mirrors weekday or is null, and several single-source bands are point estimates with `min==max==typical` (trauma, interventional cardiology, internal medicine, pediatrics).

---

### 4. Confidence gates and statistical thresholds

**Engine `scoreConfidence` (structural, not statistical).** `specKnown = specialty.source !== 'default'`; `stateKnown = state.source !== 'default'`; `supporting` = count of {shift, facility, duration, call, holiday, rural} with a non-default source. Returns **High** if specKnown && stateKnown; **Medium** if specKnown (with or without supporting≥2); else **Low**. This grades *whether factors were identified*, not *how good the underlying data is* — Medium is the catch-all whenever a specialty is recognized.

**Hub "honest confidence":** `weakerConfidence(scoreConfidence(factors), dataTierConfidence(spec.confidence))` with rank Low 0 / Medium 1 / High 2. So a well-identified CRNA reads Medium (its data tier), not High.

**BLS-OEWS sanity check thresholds (`blsSanityCheck.ts`):** `FIXED_SOFT = 25` (%), `FIXED_HARD = 40` (%), `BAND_HARD_GAP = 25` (so `hardThreshold = max(40, bandHalfWidth + 25)`), `MEAN_CAP_RATIO = 1.5` (a mean-based 'hard' verdict is demoted to 'soft' unless |deviation| ≥ 1.5 × hardThreshold, because means are noisier than medians). `deviationPct = (displayed − expected)/expected`. Verdicts: aligned / soft / hard / unavailable. Unknown state, unmapped specialty, call-only mode, and suppressed cells all return `unavailable` (the check hides, never fabricates).

**LOCUM_MULTIPLIER (per SOC family; the single biggest lever on expectedHourly — self-described as observation-derived midpoints, NOT primary-source-cited):** NP_PA 1.45, NP_PA_SPECIALTY 1.90, NP_PA_HIGH 2.20, ANESTHESIA_APP 3.50, NURSE_ADVANCED 2.05, PHYSICIAN_LOW 1.35, PHYSICIAN_HOSPITALIST 2.45, PHYSICIAN_CORE 1.95, PHYSICIAN_SUBSPECIALTY 2.35, PHYSICIAN_EM_HIGH 2.45, PHYSICIAN_PSYCH_HIGH 2.40, PHYSICIAN_HIGH 2.35, PHYSICIAN_HIGH_PREMIUM 3.10, SURGEON_CORE 1.70, SURGEON_HIGH 2.20. Overall span **1.35–3.50**. The specialty→SOC map has **88 entries**.

**CRNA cell envelope (`crnaCellLookup.ts`):** `expectedHourly = BLS_state_p50 × LOCUM_MULT_CRNA × (1 − UHC_cut)`. `UHC_CUT_EFFECTIVE_DATE = 2025-10-01`, `UHC_CUT_PCT = 0.15`, `UHC_EXEMPT_STATES = {AR, CA, CO, HI, MA, NH, WY}`. Empirical multiplier ladder gated by sample size: state n≥5 → division n≥10 → national n≥50 → literature default. `LITERATURE_DEFAULT_LOCUM_MULT`: w2_employee 1.0, locum_w2 1.4, 1099_independent 1.6, locum_1099 1.7. Tier assignment: blsSuppressed → MANUAL-ESCALATION; iasStateBookings≥10 & distinctSources≥2 → HIGH; sources≥2 & (state≥5 OR scraperAgrees ±15%) → MULTI-SOURCE; iasDivisionBookings≥10 → DERIVED; else PUBLIC-HINT. `RETRY_COOLDOWN_MS = 30_000`. Census taxonomy = 9 divisions, 51 = 50 states + DC. **In practice HIGH/MULTI-SOURCE are unreachable** because IAS has 0 actual paid CRNA rates, so the multiplier always falls to the literature default and tiers cap at PUBLIC-HINT — the envelope is BLS × prior, dressed as triangulated.

**aggregateCell (MAD + IVW posterior, `cellAggregation.ts`):**
- Outlier rejection: modified z-score `|0.6745·(x − median)/MAD| > 3.5`; `mad_threshold = 3.5·MAD/0.6745`.
- `MAD == 0` → `zero_spread` (variance 0). `n == 1` → `single_source`.
- Bimodal detector A (split-half): `varHigh > 4·varLow`, with a survivors-≥6 floor (raised from 4 after `[195,198,202,205,210]` false-positived).
- Bimodal detector B (modal-escape): ≥3 outliers, all on one side, gap > `4·max(outlierMAD·1.4826, 1)`. Either fires → `weighted_mean = null`, tag `manual_review_bimodal` (never collapse a locum/perm-mixed cell).
- Numerical floors: `MIN_VARIANCE = 1e-4`, `MIN_WEIGHT = 1e-6`, `MAX_RATE_MID = 1e6`.
- IVW: `empiricalVar = max(mad², (rate_mid·0.05)², MIN_VARIANCE)`; weight `w = evidence_weight/variance`; `weighted_mean = Σwx/Σw`; `weighted_variance = 1/Σw`. `evidence_weight` is **flat 1.0** for every distinct observation today (D-36), which means reliability does not yet bias the posterior.

**Calibration math (dormant — see §9):** `LEGACY_CALL_DAILY_FLOOR = 1000` (mode inference: sim or accepted ≥ 1000 → call_daily, else hourly). `recent = last 10 entries`; `recentAvgRatio = mean(acceptedRate/simulatedRate)`. Trigger: `recent.length ≥ 3 AND |ratio − 1| > 0.03`. `adjustment = 1.0 + (ratio − 1)·0.5` (50% dampening), then clamped to **[0.85, 1.15]** (±15% max). `applyCalibration` no-ops if `sampleSize < 3 || adjustment === 1.0`. Margin-leak guards: positive calibration may never exceed `spec.max` or push past an engine cap; when capped, positive adjustment is dropped entirely; negatives always apply.

**liveCalibration (HCO bid-ceiling profiles, display-only):** `MIN_N = 5`; sensible multiplier `1 ≤ v ≤ 3`. Explicitly labeled CAPS, not market rates.

**Fuzzy match:** `MIN_TARGET_LEN = 4` (below 4 chars require exact equality); `looseMatch` is one-way `candidate.includes(token)`; returns the SHORTEST matching key. State matching is exact-or-nothing. `matchesKeyword` uses `\b…\b` word boundaries so `asc` ∌ vascular/cardiovascular/ascension, `va` ∌ Pennsylvania/Nevada, `clinic` ∌ clinical. Short aliases requiring word boundaries: `id, em, er, gi, ir, aa, np, pa, fm, im, rad, ent, uro, cap, pmr`. Unrecognized specialty silently defaults to **internal medicine** (Low confidence is the only signal).

---

### 5. GSA per-diem headline values (FY2026)

The GSA travel per-diem is a separate lookup (`lookupGsa(city, state)`) keyed `city,state` against ~120 city overrides with a standard fallback. Hand-maintained constants; FY rollover requires a manual edit (a known drift risk). The 26-specialty request-type audit verified this table as correct.

**Standard fallback:** `GSA_STANDARD = { lodging: 110, M&IE: 68, total: 178 }`.

**Representative city overrides (lodging / M&IE / total):**
- Boston, MA — 349 / 92 / 441
- New York / Manhattan, NY — 342 / 92 / 434
- San Francisco, CA — 272 / 92 / 364
- Washington, DC — 276 / 92 / 368
- Park City, UT — 483 / 92 / 575
- Key West, FL — 436 / 86 / 522
- Aspen, CO — 407 / 92 / 499
- Augusta, GA — 125 / 74 / 199

---

### 6. Firebase RTDB tree shapes

Project `weekly-sync-451e2`; database URL `https://weekly-sync-451e2-default-rtdb.firebaseio.com` (host is `firebaseio.com`, **not** `firebasedatabase.app` — the latter does not resolve for this project; a future host migration would break the overlay). The hub connects via `forceWebSockets()` called *before* the first read, so the SDK never falls back to long-poll `<script>` injection (blocked by the hub-scoped CSP `script-src 'self'`). All nodes are written by the daily bridge in **one atomic multi-location `.update()`** (legacy + v2 + cap + reliability commit together or not at all; an empty 7-day window skips the write rather than clobbering with `{}`). Specialty names are encoded via `firebaseSafeKey` because RTDB treats `/` as a path separator (e.g. `ob/gyn`).

**`rate-simulator/market-rates/{safeKey}` — the LEGACY crude band (the QUOTE path).** Shape: `{ min, max, p70, sources: [...], lastUpdated, valueType }`. Read by `loadMarketRates()`, which overlays `spec.min/max/p70` **in place** on the shared SPECIALTIES singleton. Suppressed specialties are written `null` to delete a stale prior band. This is confidence-blind — a single low-confidence row that clears the ≥2-source gate can set the displayed floor.

**`rate-simulator/market-rates-v2/{safeKey}` — the variance-weighted POSTERIOR (DISPLAY ONLY).** Whole-node-per-specialty shape:
```
{ __meta__: { lastUpdated, primaryRateType, coverageTier },
  {stateKey}: { buckets: { {rateType}: MarketBucketData } } }
```
where `MarketBucketData = { weighted_mean, weighted_variance, median, confidence, n_distinct, n_raw, source_families, family_capped, lastUpdated }`. `stateKey` is the state code or `national`; `rateType` is the enum value or `null_unclassified`. `agency_bill_rate` is excluded from this tree. Read only by `loadMarketBuckets()` → `MarketDataView`; it NEVER reaches the quote.

**`rate-simulator/cap-rates/{safeKey}` — agency bill ceilings.** `computeLegacyBand` verbatim, never bucketed (D-34a).

**`rate-simulator/source-reliability/{family}` — bootstrap stability scores (DISPLAY ONLY, NOT weight-bearing, D-38b).**

**`rate-simulator/feedback` — the calibration input tree. EMPTY (0 entries).** Would feed `loadSpecialtyCalibration` → `applyCalibration`. No capture mechanism writes it, so the loop is a permanent no-op (see §9).

**Read-side gates.** Both `loadMarketRates` and `loadMarketBuckets` apply a 7-day staleness gate (`RATE_READ_WINDOW_MS = 7·86 400 000`). Legacy overlay additionally requires `valueType !== 'cap'`, ≥2 non-empty trimmed source strings, and `min > 0 && max > min`. The v2 `isRenderableBucket` requires a finite `weighted_mean`, `n_distinct > 0`, a valid confidence enum, and a fresh `lastUpdated`. v2 primary-bucket selection uses `BUCKET_PRECEDENCE = {actual_paid_locum:4, advertised_clinician_pay:3, crowd_survey:2, scraped_article_estimate:1}`; `permanent_wage_proxy`, `agency_bill_rate`, and `null_unclassified` are deliberately not selectable.

---

### 7. Supabase schema and the canonical view rule

**Spine table `public.rate_intelligence` (~56,632 live rows).** Core columns: `id, specialty, rate_low, rate_high, source (TEXT NOT NULL, singular), source_url, state, facility_type, date_scraped (YYYY-MM-DD), confidence, validated, value_type ('market'|'cap', default 'market'), agent_id (default 'unknown_legacy')`. The A.2 migration added six additive-nullable, CHECK-guarded columns (`rate_type, source_legal_class, evidence_employment_arrangement, content_hash, dedup_group_id, published_at`) plus four Phase-4 cited columns (`cited_text, char_range_start, char_range_end, employment_evidence_span`). All are nullable with NO DEFAULT and CHECKs of the form `IS NULL OR value IN (...)`, so the ADD COLUMN could not fail on the 55,375 pre-existing rows.

**The admission gate: the `canonical_rate_intelligence` VIEW (security_invoker, authenticated-only, anon REVOKE'd).** The bridge reads this VIEW, not the base table. Its predicate (live-verified 2026-06-29):

```
WHERE (date_scraped >= '2026-05-20' AND agent_id IN ('rate_scraper','rate_researcher'))
   OR (specialty IN (SELECT canonical_name FROM specialty_canonical_view)
       AND agent_id != 'unknown_legacy')
```

Clause 1 admits all post-Phase-1 producer rows unconditionally; clause 2 salvages older rows that happen to have a canonical specialty and a real agent_id. `specialty_canonical_view` is, despite the name, a **152-row reference TABLE** seeded from the agent-sdk allowlist (`cell_count_total = 152`, sha256 `4f0c1f92…`).

**Consequence for BLS (corrects an old memory claim):** because `gov_data_syncer` writes an `agent_id` not in the allowlist, all **483 BLS/government rows are excluded by agent_id** — **0 bls rows in the view vs 483 in the base table** (live-verified). The old "BLS dilutes the legacy band" claim is therefore **FALSE for the bridge**. BLS feeds `blsSanityCheck` only.

**The just-added (staged, uncommitted) non-locum filter.** The legacy band lacked the `permanent_wage_proxy` exclusion the v2 `RATE_TYPE_PRECEDENCE` already implies. The staged change filters market rows by `isNonLocumWageRow` (`rate_type === permanent_wage_proxy OR evidence_employment_arrangement === permanent`), then re-dedupes within the locum subset; if every observation is proven-permanent, the legacy node is written `null`. The real latent vector it guards is a **scraped W2 compensation-survey row** (Doximity/Medscape/MGMA) that the classifier tags `permanent_wage_proxy` via `url_override` and that would otherwise pass the canonical view on a scraper `agent_id`. There are **0 such rows today**, so it is a no-op correctness guard (like the ZipRecruiter never-anchor exclusion), not an accuracy mover. `agency_bill_rate` has no scraper→market vector and was not added.

**Parallel table `external_specialty_surveys`** holds CRNA BLS cells with a census 9-division geo + arrangement enum, consumed by `getCrnaCellEnvelope`, independent of `rate_intelligence`. Foot-gun: census division codes `NE`/`MA` textually collide with state codes `NE`/`MA` — readers MUST match on column, not value.

**Telemetry:** `bridge_runs` (~35 columns) with three independent partition invariants — `rows_read_market = distinct_observations_total + rows_collapsed_by_content_hash + rows_collapsed_by_dedup_group`; `buckets_written_total = Σ buckets_by_rate_type_*`; `buckets_written_total = single_source + zero_spread + multi_source + manual_review_bimodal`. `canonical_view_active` BOOLEAN DEFAULT NULL (NULL = pre-Phase-2 row).

---

### 8. Live data state (2026-06-29)

- `rate_intelligence` base table: **~56,632 rows**.
- Canonical **MARKET** view `rate_type` distribution (all dates): `advertised_clinician_pay` **239**, `scraped_article_estimate` **454**, `crowd_survey` **2**, `null` **186**, `permanent_wage_proxy` **0**, `agency_bill_rate` **0**, `actual_paid_locum` **0**.
- The plurality of in-view market rows are therefore **untagged (`null` → `null_unclassified`)** or low-tier `scraped_article_estimate`. The `RATE_TYPE_PRECEDENCE` ladder and the non-locum filter rarely engage on real data; most rows land in `null_unclassified`.
- **0 actual_paid_locum rows ever** — the gold-standard signal does not exist; there is no internal pay ground truth (`ls_events`/`ims_jobs` carry no rate columns).
- **CRNA: 0 locum-tagged + 0 rate_type-classified live rows** → stays on the static **$190–250** band (p70 232). The CRNA-envelope HIGH/MULTI-SOURCE tiers are unreachable.
- **Anesthesiology live legacy band: min 240 / max 450 / p70 387**, sources serpapi/tavily/exa. The **$240 floor is a single low-confidence `exa_semantic` LOCUM scraped estimate** (arrangement = unknown, confidence low) — NOT BLS. This is the canonical example of the confidence-blind floor problem.
- `rate-simulator/feedback`: **0 entries** → calibration is inert (§9).
- `sourceFamily` registry: **0 live firings** today (only tavily/exa/serpapi/locums sources appear) — corporate-family collapse and never-anchor exclusion are forward-looking and unexercised on real data.
- BLS rows in the canonical view: **0** (483 in base, all excluded by agent_id).

---

### 9. Self-learning state — built, but starved

Every piece of the calibration loop exists and is unit-tested: `FeedbackSection` writes a `CalibrationEntry` (`simulatedRate`, `acceptedRate`, accuracy, cap bound) to RTDB `rate-simulator/feedback` + localStorage `rateFeedback`; `loadSpecialtyCalibration` reads them, computes `recentAvgRatio` over the last 10; `applyCalibration`/`computeDisplayedRate` nudge the displayed quote with the 50%-dampened, [0.85, 1.15]-clamped adjustment, bounded by `spec.max`. The dashboard even wires the write path and triggers a same-key refetch on submit.

It is a **permanent no-op** for exactly one reason: `rate-simulator/feedback` has **0 entries** and no production mechanism populates it. With `< 3` entries the `recent.length ≥ 3` trigger is false, `adjustment` stays 1.0, and `computeDisplayedRate` passes the raw model through unchanged. Two further honesty caveats: the loop would learn from **recruiter-asserted accepted rates**, not LocumSmart-verified paid rates (no internal pay ground truth exists), and the dashboard blends a per-browser `localStorage` history into the aggregate (so two recruiters' calibrations diverge). The CRNA empirical multiplier (`deriveLocumMultCrna`) is data-adaptive in principle but perpetually falls to the literature default because the IAS booking input stream is empty. **Net: the sim does not self-improve from outcomes today.**

---

### 10. Cost, circuit-breaker, premium, and operational constants

**Circuit breaker (fleet):** `GLOBAL_WORKING_CEILING_USD = $90`/month — a fail-closed working ceiling, tighter than the SQL `reserve_budget` $100 global cap. If projected (`global_mtd + est_cost`) crosses $90 the call is refused (`cap_exceeded:_global_working_ceiling_90`). Plus per-tool volume caps (a run can exhaust SerpAPI quota while still under $90). Per-call costs: Firecrawl $0.005, SerpAPI $0.015, Tavily $0.015 (advanced = 2 credits), Exa $0.007. Reservations stand without reconciliation (vendors don't expose per-call cost), so the $90 ceiling is approximate but in the safe direction.

**W2→locum premium (gov_data_syncer):** `PREMIUM_FACTOR = 1.25`, version `v1-2026-06-02`, allowed range **[1.20, 1.35]**. `rate_low = int(hourly·1.25·0.9)`, `rate_high = int(hourly·1.25·1.1)`; raw W2 must satisfy `50 ≤ hourly ≤ 500`. Source tag `bls_oews_may2025_government_premium_v1-2026-06-02`. (These rows are excluded from the bridge by the canonical view, so the premium only affects `blsSanityCheck`.)

**Quorum / consensus:** **≥2 independent source families** required to go live (single-source overlays suppressed). `FAMILY_CAP_FRACTION = 0.6` (any one family capped at ≤60% of cell weight, D-37) — a no-op under flat 1.0 weights (max share 1/k ≤ 50%); it only binds under future non-flat weighting. Never-anchor sources: `NEVER_ANCHOR_SOURCE_IDS = {ziprecruiter, adzuna}` excluded by absence (ZipRecruiter CRNA $124.86 ≈ half the real $200–250). Cap-capable agent quarantine: `CAP_CAPABLE_AGENT_IDS = {sisense_rate_writer}` (a market-typed row from a cap agent is a silent mislabel → quarantined).

**Source-reliability scoring (display-only):** `BOOTSTRAP_RESAMPLES = 500`, `COVERAGE_SATURATION_N = 30`, `STABILITY_WEIGHT = 0.6`, `AGREEMENT_WEIGHT = 0.4`, `AGREEMENT_SD_CLIP = 3`, mulberry32 PRNG seed `0x5eed1a5`. `composite = agreement defined ? 0.6·stability + 0.4·agreement : stability`. Label is "source stability" — explicitly NOT weight-bearing (D-38a/b honesty gate).

**Bridge operational constants:** cron 04:00 / 05:00 UTC daily on EC2 `54.145.175.182` via PM2; `BRIDGE_LOCK_ID = 0x7261746573` (491250528627, ASCII "rates"); `BRIDGE_TIMEOUT_MS = 600000` (10 min); `RATE_READ_WINDOW_DAYS = 7`; stale-running cutoff `started_at < NOW() − 1 hour`. Exit codes: **0** success / **2** crash / **3** lock-held (skipped, no alert). Dedup: Stage-1 `artifactKey = content_hash + state + rate_type + valueBucket`, `valueBucket = floor(rate/10)·10`; Stage-2 folds `dedup_group_id + (state, rate_type)` to one DistinctObservation at flat `evidence_weight = 1.0`. RTDB-forbidden segment regex `/[/.#$[\]]/`. **Re-running the bridge to apply staged changes requires firebase-admin WRITE creds on the EC2/PM2 fleet — not a code-only / in-session operation.**

**Fleet source counts:** rate_scraper = 6 TUNED + 18 GENERIC + 1 SerpAPI = 25 sources (import-time asserts TUNED==6, GENERIC==18, per_source_defaults==24); rate_researcher = 13 Tavily + 1 Exa. URL_OVERRIDES = 22. rate_observer VERIFY drops anything not literally grounded (citation hallucination cited at 11–57%, so the trust boundary is deterministic, never the LLM). Fleet schedules (US/Central): rate-pipeline 05:00 daily, rate_researcher Tue+Thu 06:00, gov_data_syncer Mon 05:00, iron_dome 03:00 daily; **rate_observer has no schedule entry (built but idle)**.

---

### 11. File map — which file owns what

**Engine core (shared, byte-identical across both apps; dashboard path `src/features/rate-simulator/engine/`, hub vendored read-only into `src/lib/rate-engine/`):**
- `rateCalculator.ts` — `initFactors`, `calculateRate` (hourly), `calculateCallRate` (per-diem), `scoreConfidence`, `computeAdjustedSpecRange`, `mapSpecialty`, `refineSpecialtyFromContext`, all `infer*`, `roundUp5`, `getPercentileRate`, the rate-cap and researched-max clamps.
- `specialties.ts` — `_SPECIALTIES_RAW` band table (~70 canonical + ~140 aliases ≈ "164 specialties"), `buildSpecialties` (the p70 0.70 interpolation), `SPECIALTY_ALIASES`, `STATIC_CONFIDENCE`, `confidenceLabel`.
- `multipliers.ts` — `SHIFT_MULT`, `FACILITY_MULT`, `DURATION_MULT`.
- `stateData.ts` — `STATE_MULT` derivation, `STATE_COLI`, `STATE_PHYS_DENSITY`, `STATE_DEMAND_CLASS`, `DEMAND_WEIGHTS`, `METRO_CITIES`, `deriveStateMultipliers`.
- `parser.ts` — `parseLocumsmartAssignment`, `parseFreetextInput`, `buildParsedFromFreetext`, `matchesKeyword`, `parseFacilities`, the FACILITY/SHIFT/CALL keyword + DURATION pattern tables.
- `fuzzyMatch.ts` — `fuzzyMatchSpecialty/State/City`, `looseMatch`, `levenshtein`, `MIN_TARGET_LEN`, `FILLER_WORDS`.
- `types.ts` — `RateFactors`, `CalculatedRate`, `CalculatedCallRate`, `SpecialtyRate`, `CallRateEntry`, `ConfidenceLevel`, `RateCapUnit`, `CallCompModel`.
- `callRates.ts` — `CALL_RATE_DATA` (the static daily-band table), `getCallRateEntry`, the `beeper`/`worked` band factories, `GSA_STANDARD`/`GSA_OVERRIDES`, `lookupGsa`.

**Guardrails / aggregation (engine-side):**
- `blsSanityCheck.ts` — SOC mapping, BLS lookup, LOCUM_MULTIPLIER, soft/hard band thresholds, verdict logic.
- `blsOewsBaseline.ts` — the frozen May-2024 OEWS baseline (static module).
- `crnaCellLookup.ts` — CRNA envelope, UHC cut, multiplier ladder, tier dispatch.
- `cellAggregation.ts` — `aggregateCell` (MAD outlier rejection + IVW posterior + bimodal detectors).
- `crnaAggregation.ts` — CRNA triangulation wrapper over `aggregateCell`.
- `sourceFamily.ts` — corporate-family registries (CHG/AMN/Jackson/Cross-Country/Aya), `NEVER_ANCHOR_SOURCE_IDS`.

**Overlay / calibration (runtime read-side):**
- `marketRates.ts` — `loadMarketRates` (legacy overlay, in-place SPECIALTIES mutation — the QUOTE path), `loadMarketBuckets` (v2 posterior, display-only), `BUCKET_PRECEDENCE`, `pickHigher`, the staleness/source gates.
- `liveCalibration.ts` — HCO bid-ceiling profiles (display-only, RS-1).
- `recentJobsBridge.ts` — adapts a Firebase job record into a `ParsedAssignment` for pre-fill (no rate math).
- `index.phase2.ts` — the Phase-2 barrel that pulls in the firebase value import (the only module that does).

**Bridge / ETL (`scripts/data-refresh/`, dashboard repo, runs on EC2/PM2):**
- `lib/aggregateBridge.ts` — the pure transform: row gates, two-stage dedup, family collapse-then-cap, legacy band + v2 bucket products, `RATE_TYPE_PRECEDENCE`, `FAMILY_CAP_FRACTION`.
- `bridge-rate-intelligence.ts` — the cron entrypoint: advisory lock, VIEW read, atomic RTDB write, `bridge_runs` telemetry, exit-code semantics.
- `lib/sourceReliability.ts` — bootstrap stability + cross-source agreement scores (display-only).

**Supabase migrations (dashboard repo, `supabase/migrations/`):**
- `20260521203841_evidence_canonicalization_a2.sql` — the six A.2 columns + canonical view.
- `20260507000000_external_specialty_surveys.sql` — the CRNA survey table.
- `20260602000000_gov_backbone_proxy_tables.sql` — the schema-isolated gov-proxy tables.
- `20260602000000_rate_source_chunks_and_cited_columns.sql` — the Phase-4 cited columns.
- `20260422173200_sisense_rs0.sql` — Sisense bid/agreement scaffolding.

**Fleet (agent-sdk, Python on EC2/PM2):**
- `agents/rate_scraper/{agent,sources}.py`, `agents/rate_researcher/agent.py`, `agents/rate_observer/{agent,verify}.py`, `agents/gov_data_syncer/agent.py`.
- `shared/rate_type_classifier.py`, `shared/rate_type_url_patterns.json` (URL_OVERRIDES, checksum-guarded).
- `config/{schedules,pipelines,agents}.yml`, `core/budget_guard.py` (the $90 ceiling).

**Dashboard UI (`src/`, dashboard repo):**
- `App.tsx` — composition root: `configureEngine({db, supabase})` at module load + one-shot `loadMarketRates()`.
- `RateSimulatorPage.tsx` — quote state, the `isCallOnly` dispatch, the single `displayedRate` source-of-truth.
- `components/{RateResults, MarketDataView, BillRateCalculator, FeedbackSection, CitedObservations}.tsx` — hero/market/bill/feedback/cited surfaces (`MarketDataView` is the sole consumer of `loadMarketBuckets`).

**Hub UI (Astro, this repo, `src/`):**
- `lib/hub/sim-adapter.ts` — `factorsFromControls`, `quoteFromFactors` (shapes engine output, does NO rate math).
- `lib/hub/sim-render.ts` — the shared SSR + client HTML string builders (byte-identical markup).
- `lib/hub/sim-live.ts` — Gate-2b live wiring: the only module importing `index.phase2`; `initLiveMarket` runs `configureEngine` + `loadMarketRates` (legacy band ONLY, never v2).
- `lib/hub/hub-firebase.ts` — firebase config (`weekly-sync-451e2`, `forceWebSockets()` before first read).
- `components/hub/SimulatorView.astro` — SSR first paint (real engine quote, hourly only).
- `components/hub/hub-client.ts` — the simulator IIFE (controls, lazy adapter import, PDF/freetext parse, bill calculator, region→state mapping).

---

## Addendum: Additional Depth & Gap Closures

This section closes the completeness critic's 38 gaps with concrete substance drawn from the subsystem maps + ground truth. Where the material cannot answer a gap, it is flagged explicitly as an open question for the deep-research session.

### A. Quote-clamp frequency, golden-master coverage, and the live window (gaps 1, 2, 3)

**1. How often quotes hit `spec.max` (clamp frequency).** Not directly measurable from the material — no telemetry counts quotes-at-ceiling, and `LogQuoteButton` logs displayed quotes but no aggregate ceiling-hit rate is reported. What CAN be bounded analytically: a clamp occurs when `base × cappedMult > spec.max`, i.e. `cappedMult > spec.max / p70`. Since `p70 = min + (max-min)·0.70`, the ratio `spec.max / p70` for representative bands is: anesthesiology 400/370 = 1.081; hospitalist 240/213 = 1.127; emergency medicine 300/270 = 1.111; neurosurgery 480/435 = 1.103; urology 330/297 = 1.111. So for a high-band specialty, **any combined multiplier above roughly 1.08–1.13 clamps to the researched max.** Given that a single night shift (1.20) or a CAH facility (1.22) alone exceeds that threshold, the qualitative claim "premium stacks routinely clamp" is structurally sound: for narrow-band high specialties (max/p70 ≈ 1.08), the ceiling binds on almost any premium factor at all. For wide-band specialties (e.g. anesthesiology call-only worked-day 2675–3900, max/typical = 1.18) the headroom is larger. **OPEN QUESTION for deep research:** instrument `marketMaxApplied` hit-rate per specialty over a real quote sample — this is the only way to convert the structural argument into the "% of quotes clamp" number the critic wants. Flag as a concrete telemetry task (it requires the same LogQuote pipeline plus a `marketMaxApplied` field, which is already computed and just not aggregated).

**2. Golden-master 208-case characterization.** The material does not enumerate the 208 cases input-by-input, but it constrains them tightly. The golden master is `src/lib/rate-engine/__tests__/goldenMaster.json` (modified this branch). Parity is asserted as **byte-identical between dashboard and hub**, which is only possible if every case runs through the deterministic engine path (`initFactors` → `calculateRate`/`calculateCallRate`) with **NO live backend** — golden master is tested against the **static `SPECIALTIES` bands only**, not against a live RTDB mutation. This is load-bearing for blast-radius: because `loadMarketRates()` mutates `SPECIALTIES` in place at runtime, a golden master run with the overlay active would be non-deterministic (depends on the day's scrape) and could not be byte-stable. Therefore golden master necessarily freezes the overlay OFF. The audit history tells us the case mix spans both paths: the request-type audit exercised 26 specialties across call/callback/per-diem, and the band corrections were validated via "canonical → golden-master (diff=3 cases) → sync," which means **the 208 include call-only paths** (the 3-case diff from the IM/urology/radiology band widen touched hourly cases; the request-type bands touched call cases). **OPEN QUESTION:** the exact split (how many of 208 are call-only vs hourly, how many exercise the rate-cap clamp vs the spec.max clamp, how many per specialty) is not in the material — flag for a direct read of `goldenMaster.json` during deep research. The critical correctness claim — **golden master does NOT test live-overlay parity** — is answerable now and is a real gap in the parity guarantee (gate-2b live wiring is verified by separate hub-owned tests + real-browser smoke, NOT by the golden master).

**3. Live distribution over the actual 7-day window.** The distribution tables in the brief (advertised 239 / scraped 454 / crowd 2 / null 186) are **all-dates**, not the <7-day reader window. The material does not contain a 7-day-only row count, so the count of specialties **currently carrying a live overlay cannot be derived from the maps** — only one specialty is positively confirmed live (anesthesiology: min240/max450/p70387, sources serpapi/tavily/exa). CRNA is confirmed NOT live (0 locum-tagged rows → static $190–250). This is the single most actionable missing measurement: the overlay only fires on rows `<7 days` old AND passing the ≥2-source gate, so **the true count of live-overlaid specialties is almost certainly small** (a daily cron over a thin scrape feed, with most specialties below the 2-source quorum in any given week). **OPEN QUESTION for deep research:** query `rate-simulator/market-rates` RTDB directly and count nodes with `lastUpdated` within 7 days and `provenance='live'` — that single query answers "how many specialties actually get a live quote today" and is the highest-value empirical check in the whole list. Strong prior from the maps: **the overwhelming majority of specialties fall back to static**, because the fleet's scrape volume is thin, rate_observer (the best producer) is unscheduled, and the 7-day window plus 2-source quorum is a hard filter.

### B. Row reconciliation and the source/sources ambiguity (gaps 4, 5, 19)

**4. Reconciling ~56,632 base rows with ~881 in-view rows.** The 60× gap is fully accounted for by stacked exclusions, in order: (a) the **canonical view date+agent filter** — clause 1 admits only `date_scraped >= 2026-05-20 AND agent_id IN (rate_scraper, rate_researcher)`; the bulk of 56,632 are pre-2026-05-20 legacy rows and rows from other agents (the base table accumulated across the entire fleet history); (b) **agent_id exclusions** — all 483 BLS/government rows dropped by `gov_data_syncer` not being in the allowlist, plus every `unknown_legacy` row barred; (c) **unknown-specialty drop** — rows whose specialty is not in the 152-row canonical reference; (d) the **7-day read window** in the bridge further cuts the view down to recent rows only (the 881 MARKET-view figure is itself all-dates within the view; the bridge's actual working set is the <7-day slice, smaller still). So the "55k missing rows" are overwhelmingly **pre-2026-05-20 historical accumulation + non-producer agents + BLS/gov + unknown-specialty**, not data loss. The reconciliation the critic wants is: **56,632 base → ~881 canonical-MARKET (all dates) → <7-day working slice (unstated count, the actual pricing population).** The final step's count is the gap flagged in §A.3.

**5 & 19. Singular `source` (row) vs `sources[]` (band), and what a "source family" is on live data.** This is genuinely load-bearing and the maps resolve the mechanism. Each `rate_intelligence` row carries a **singular `source TEXT NOT NULL`** (e.g. `exa_semantic`, `tavily`, `serpapi`, `locums_com`, `comphealth`). When `computeLegacyBand` aggregates a cell, it **collects the distinct `source` strings of the contributing rows into a `sources` list** on the band; `loadMarketRates` then counts `sources.filter(non-empty trimmed).length >= 2` as its gate (the **weaker string-count** gate, see §C.14). The **≥2 source-family quorum** is the stronger, separate notion: `sourceFamily(s)` maps each source string to a corporate family (CHG ← locumstory/comphealth/weatherby/global_medical; AMN ← amn_healthcare/staffcare/medefis; etc.), and `uniqueFamilies = new Set(sources.map(sourceFamily)).size`. So a singular per-row source becomes a multi-source band by **set-union of the row sources within a cell**, and the two gates count differently: string-count counts raw distinct strings; family-count collapses brands first.

**The critical unresolved issue (gap 19): on LIVE data the source strings are `tavily/exa/serpapi/locums` — search TOOLS, not rate publishers.** `sourceFamily()` has KNOWN_FAMILY_OVERRIDES only for corporate brands (CHG/AMN/Jackson/Cross-Country/Aya); it has **no override for `tavily` or `exa`**, so each search tool resolves to **its own singleton family**. This means: two rows, one `tavily`-surfaced and one `exa`-surfaced, BOTH pointing at the same underlying CHG page, count as **two independent families** and pass the quorum — the anti-collusion guarantee **does not hold on current live data** because attribution is to the retrieval tool, not the publisher. The maps confirm this directly: "sourceFamily registry has ZERO live firings today (only tavily/exa/serpapi/locums sources appear) — corporate-family collapse is forward-looking and unexercised." **This is a real, present hole, not a hypothetical:** the "two independent companies" claim is satisfiable today by **two search tools hitting one company.** The fix requires the fleet to attribute the *publisher* (resolve the scraped URL's domain to CHG/AMN/etc.) into the `source` field, not the retrieval tool. Flag as a high-priority finding: **family collapse cannot function until live sources carry publisher identity, and rate_observer (which writes a real cited URL) being unscheduled is precisely why publisher attribution is absent.**

### C. Statistical mechanics: IVW, variance floors, bimodal, calibration bias (gaps 6, 7, 8, 9, 10, 12, 14)

**6. v2 posterior vs legacy band for anesthesiology (the central thesis quantified).** The maps give the legacy live band (min240/max450/p70387) but **do not contain the computed v2 `weighted_mean`/`weighted_variance` for anesthesiology** — that number lives in the RTDB `market-rates-v2/anesthesiology` node, which was not read into the material. So the exact dollar gap between "the good number" and the $387 p70 **cannot be stated from the maps.** What IS established: the legacy p70 of $387 is a flat linear interpolation `240 + (450-240)·0.70 = 240 + 147 = 387` (confirming the formula), and its **floor of $240 is a single low-confidence `exa_semantic` locum estimate, arrangement=unknown** — exactly the pathology the v2 MAD+IVW posterior would down-weight or reject as an outlier. The thesis ("the good number is ignored") is therefore demonstrable in *mechanism* but not yet in *magnitude*. **OPEN QUESTION for deep research — the single highest-value worked example to obtain:** read `rate-simulator/market-rates-v2/anesthesiology` and report `weighted_mean`, `weighted_variance`, `median`, `n_distinct`, and `confidence`, then compute `(legacy p70 387) − (v2 weighted_mean)`. That one read converts the entire central argument from qualitative to quantitative.

**7. Flat `evidence_weight = 1.0` collapses IVW to variance-by-magnitude.** Correct and worth stating plainly. IVW weight is `w = evidence_weight / empiricalVar` with `empiricalVar = max(mad², (rate_mid·0.05)², MIN_VARIANCE)`. With `evidence_weight ≡ 1.0` for every distinct observation (D-36, flat by design so raw multiplicity can't inflate weight), the weighting is driven **entirely by each observation's empirical variance**, and when the `(mid·0.05)²` floor binds (which it almost always does — see gap 8), variance scales as `mid²`, so **`w ∝ 1/mid²`**. The consequence the critic names is exact: under flat weights, IVW is **not reliability-weighted at all** — it is **inverse-square-of-magnitude weighted**, meaning *lower* rate observations get *more* weight (a $200 obs gets `1/200²` ... actually `w = 1/(200·0.05)² = 1/100 = 0.01` vs a $400 obs `w = 1/(400·0.05)² = 1/400 = 0.0025`, so the $200 obs carries **4× the weight**). This is a structural downward bias in the posterior mean whenever the MAD floor is loose, and it is **not** the "reliable sources dominate" story the "inverse-variance-weighted" label implies. The honest framing: **today IVW ≈ harmonic-style down-weighting of high rates, not evidence quality weighting.** The fix is the deferred V2-04 reweighting (feed real `bootstrap_reliability` or multi-day-confirmation into `evidence_weight`). Flag as a statistician-facing caveat the brief must carry.

**8. MIN_VARIANCE (1e-4) can never bind.** Correct and now stated explicitly: `empiricalVar = max(mad², (mid·0.05)², 1e-4)`. For any real hourly rate `mid ≥ 50`, `(50·0.05)² = 2.5² = 6.25 ≫ 1e-4`; for a daily `mid ≥ 1800`, `(1800·0.05)² = 90² = 8100`. So **MIN_VARIANCE is dominated by the empirical floor by 4–7 orders of magnitude and is purely a divide-by-zero / degenerate-input guard, never an operative floor.** The two are not co-equal: `(mid·0.05)²` is the real floor in 100% of plausible-rate cases; MIN_VARIANCE only matters if `mid` were near zero (which the validity gate already rejects). The brief should demote MIN_VARIANCE to "numerical-safety constant" and present `(mid·0.05)²` as the sole effective variance floor.

**9. How `weighted_variance = 1/Σw` would become a displayed interval.** The maps confirm `weighted_variance = 1/Σw` (the standard IVW posterior variance) but **no code today renders it as a user-facing band** — the v2 posterior feeds only the `MarketDataView` display panel, and that panel shows the weighted_mean + confidence tier + coverage tier, NOT a ± interval derived from the variance. B1's "surface weighted_variance as a confidence width" is a **proposal with no implemented formula.** The natural formula (not in the material, offered as the obvious construction) is a Wald interval `weighted_mean ± z·sqrt(weighted_variance)` (z=1.96 for 95%, z=1 for a 1-SD band), but this is **un-implemented and un-specified** today. Honest status: **the posterior carries a variance that is currently discarded for display purposes; turning it into a band is unbuilt.** Flag B1 as design-not-implementation, and note the open choice of z / interval type as a deep-research decision.

**10. Bimodal detector true-positive at n=6..10.** The false-positive fix raised the split-half survivor floor to ≥6 (`[195,198,202,205,210]`, n=5, is floored out and correctly NOT flagged). A genuine true-positive at n≥6 is **not worked in the material**, so here is the constructed example the brief needs: a real locum/perm mixed cell like `[185, 190, 195, 305, 310, 315]` (n=6, three perm-ish ~190 + three locum-ish ~310). Split-half on the sorted array gives a low half var ≈ var(185,190,195) ≈ 25 and a high half var ≈ var(305,310,315) ≈ 25 — but the **split-half test compares the variance of the two halves' spread; the operative trigger is `varHigh > 4·varLow` on the split**, which fires when one mode is internally tight and the other wide, OR the **modal-escape** detector fires (`≥3 outliers all on one side, gap > 4·max(outlierMAD·1.4826, 1)`): here the three ~310 points sit a gap of ~115 above the median ~195, far exceeding `4·MAD`, so **modal-escape ejects a whole mode and forces `weighted_mean=null`, `manual_review_bimodal`** — the correct firing. The reliability of the defense is thus: **split-half catches unequal-spread bimodality; modal-escape catches equal-spread two-cluster bimodality where MAD would otherwise eject one cluster wholesale.** The constructed n=6 case demonstrates modal-escape is the load-bearing detector for the canonical locum/perm-mix scenario. (Caveat: this is a constructed illustration, not a test fixture from the material — flag for validation against `cellAggregation` tests during deep research.)

**12. `recentAvgRatio` is a biased mean-of-ratios.** Correct and unflagged in the brief. `recentAvgRatio = mean(acceptedRate/simulatedRate)` over the last 10 entries is a **mean of ratios**, which by Jensen's inequality is **≥ the ratio of means** for the convex map `x↦accepted/x` (and generally biased relative to the aggregate ratio you actually want). Concretely, two entries `accepted/sim = 1.5` and `0.5` average to `1.0` (no adjustment) even if the dollar-weighted truth differs; and the estimator systematically **over-weights cases where `simulatedRate` was small** (small denominators inflate individual ratios). The dampening (×0.5) and clamp ([0.85,1.15]) bound the damage to ±15%, but the **estimator itself is upward-biased and denominator-sensitive**, exactly as the critic states. The correct unbiased construction would be a **ratio of means** (`Σaccepted / Σsimulated`) or a regression-through-origin slope. Flag as a known estimator-bias caveat; note it is currently inert anyway (feedback tree empty), so it is a **latent** bias that activates only once feedback is wired — which makes it cheap to fix BEFORE the loop goes live.

**14. Which gate actually governs the live overlay (the "two independent companies" contradiction, resolved).** Resolved definitively from the maps: **`loadMarketRates` (the QUOTE-path overlay) gates on `sourceCount = sources.filter(non-empty).length >= 2` — the weaker string-count version.** It does NOT enforce the ≥2-source-*family* quorum. The family-aware computation in `loadMarketRates` only sets the **confidence label** (`uniqueFamilies >= 2 ? 'high' : 'medium'`), not the firing decision. Therefore: **a 2-string single-family row CAN overlay the quote** (e.g. two CHG sub-brands, or — per §B.19 — `tavily` + `exa` on one publisher), and it will simply render at 'medium' confidence rather than being suppressed. The repeated "two independent companies required" claim is **FALSE as stated for the quote path**; the family quorum governs only the confidence badge and (separately) the bridge-side bucketing. The honest statement: **the live quote fires on ≥2 distinct source strings; independence (≥2 families) affects only the displayed confidence, not whether the overlay prices the quote.** This is the most important correctness correction in the gap list and should be elevated in the brief body, not left as a footnote.

### D. Calibration / cron / staleness operational mechanics (gaps 11, 13)

**11. Calibration mode-split (`≥$1000 → call_daily`) misfire bounds.** The `LEGACY_CALL_DAILY_FLOOR = 1000` heuristic classifies a feedback entry as `call_daily` if `simulatedRate >= 1000 OR acceptedRate >= 1000`, else `hourly`. The maps confirm no hourly rate approaches $1000 (highest hourly bands top out ~$480), so a **correctly-entered hourly rate can never cross the floor** — the misfire surface is exactly two cases: (a) a **misentered hourly rate** (a recruiter typing a daily or a bill figure into an hourly feedback field), or (b) a **high bill rate** accidentally logged as the accepted *pay*. Bounding frequency from the material is **not possible** (feedback tree is empty; zero entries exist to estimate a typo rate), but the *blast radius* is bounded: a misclassified entry only pollutes the `${specialty}__${rateMode}` calibration bucket it lands in, and the dampen+clamp caps any resulting drift at ±15%. So the heuristic is **safe-by-magnitude even when wrong.** Flag the misfire *rate* as unmeasurable-until-feedback-exists; flag the *fix* (validate the unit field on feedback submit, reject ambiguous entries) as cheap and worth doing before the loop activates.

**13. Cron failure / 7-day staleness interaction (the "bands go dark" timeline).** Concrete timeline now stated: the bridge writes are **atomic and idempotent per run**; a successful run stamps each node's `lastUpdated`. The reader (`loadMarketRates`) gates on `age <= 7 days`. So if the daily cron **fails or skips (exit 3, lock-held) for D consecutive days**, every live band's `lastUpdated` ages; at **day 7 after a node's last successful write, that node silently fails the reader staleness gate and the specialty reverts to its static curated band** — no error, no user-visible "stale" signal, just a silent fallback to static. Critically, a 2-day cron outage does **NOT** immediately dark any band (the 7-day window absorbs up to ~6 missed daily runs for a node that was written on day 0). The danger zone is a **≥7-day sustained outage**, after which thin-data specialties (those that only occasionally clear the 2-source quorum) go static and **stay** static until a fresh qualifying scrape lands. The maps also note the **empty-window guard**: an empty 7-day read **skips the write entirely** rather than clobbering the tree with `{}`, so a zero-scrape week does NOT delete existing bands — they simply age out naturally at their own 7-day marks. Net failure-mode: **graceful silent degradation to static, with a ~7-day grace period, and no alerting on the reader side** (the only alert is the cron wrapper's Slack on exit 2). Flag the **absence of a reader-side staleness signal** as a real operational gap: users can't tell a "live" specialty silently went static.

### E. Display-only subsystems that move no quote today (gaps 15, 17, 18, 28, 29)

**15. LOCUM_MULTIPLIER (1.35–3.50) feeds only the display-only BLS sanity check.** Stated plainly: `LOCUM_MULTIPLIER` is consumed solely by `blsSanityCheck` to compute `expectedHourly` for the **verdict chip** (aligned/soft/hard), which is a **verification/display surface in `MarketContext`, NOT the quote.** Therefore **changing any LOCUM_MULTIPLIER value moves zero quotes today** — it only changes which jobs get a green/yellow/red plausibility chip. The brief over-weights it as "the single biggest lever" because it IS the biggest lever **on `expectedHourly`**, but `expectedHourly` prices nothing. The honest framing: **LOCUM_MULTIPLIER is the biggest lever on the *sanity verdict*, and the sanity verdict is display-only; fixing it improves the honesty chip, not the number.** It only becomes quote-relevant if a future change wires the sanity verdict back into the quote (a listed lever: "surface the sanity verdict back into the quote rather than only a chip").

**17. GSA per-diem's role in the quote.** The maps establish GSA per-diem (`lookupGsa(city,state)` → `{lodging, mie, total}`, e.g. boston $441, NYC $434, standard $178) is a **separate travel-stipend lookup** surfaced in the call-rate path. The material does **not state it is added to pay, nor that it modifies any multiplier** — it is presented as a **travel-stipend datum shown alongside** the call-only quote, i.e. **informational/separate, not folded into the pay or bill number.** Best-supported reading from the maps: **GSA per-diem is informational context (what a compliant travel stipend would be), displayed separately, with zero weight in the computed pay/bill.** It is never described as summed into `payRate`. **OPEN QUESTION for deep research (low stakes):** confirm by reading `RateResults.tsx` whether the GSA total is rendered as a standalone stat vs added to any displayed total — the maps imply standalone but do not show the JSX. Flag as a minor confirmation item.

**18. UHC −15% CRNA cut moves no quote.** Confirmed: the UHC cut (`UHC_CUT_PCT=0.15`, effective 2025-10-01, exempt {AR,CA,CO,HI,MA,NH,WY}) is modeled inside `getCrnaCellEnvelope`, which is the **CRNA sanity/envelope path** — and CRNA is **frozen static $190–250** because it has 0 locum-tagged live rows and the envelope is display-only. So the cut is computed in the envelope's `expectedHourly` but **the CRNA quote is the static band, untouched by the envelope.** The brief details the cut mechanics extensively without noting it **currently changes no displayed CRNA number.** Honest framing: **the UHC cut is correctly modeled and ready, but inert — it will only move a CRNA quote once CRNA leaves the static band (needs live CRNA locum sources) AND the envelope is wired into the quote rather than the chip.** Two separate unlocks gate it.

**28. Source-reliability bootstrap (500 resamples) has zero effect on output today.** Stated flatly: `computeReliabilityFromOutput` (mulberry32-seeded, 500 bootstrap resamples, `STABILITY_WEIGHT=0.6`/`AGREEMENT_WEIGHT=0.4`, composite stability+agreement) writes `rate-simulator/source-reliability/{family}` nodes — but per **D-38b the reliability score is explicitly NOT weight-bearing**: it does not feed `evidence_weight` (which stays flat 1.0), and it is never checked against closed-deal outcomes (none exist). It is a **display-only "source stability" label.** The §10 description of its formula reads as operative but **it changes no posterior and no quote.** Honest framing: **the bootstrap is a computed-and-shipped diagnostic with zero downstream effect; the lever (V2-04) is to feed it into `evidence_weight`, which is deferred.** Flag the §10 formula as "computed but inert" to avoid implying it weights anything.

**29. "modeled" confidence tier and `provenance: curated→live` rendering.** The maps establish `confidence` can be `high|medium|low|modeled` (default `modeled` at build) and `provenance` flips `'curated'→'live'` when an overlay merges. What the material does **not** show is the **user-facing string rendering** — whether "modeled" appears verbatim in the UI, or whether "live" provenance changes the displayed label. From the hub map, the confidence shown is `weakerConfidence(scoreConfidence, dataTierConfidence(spec.confidence))` mapped to High/Medium/Low via `CONF_RANK` — and `dataTierConfidence` maps `'high'→High, 'medium'→Medium, else→Low`, which means **`modeled` collapses into the "Low" display bucket** (the `else` branch). So a user never sees the literal word "modeled" in the hub; it renders as **Low**. Whether the dashboard surfaces "modeled" verbatim or whether `provenance='live'` changes any user-visible label is **not in the material.** **OPEN QUESTION for deep research:** confirm dashboard rendering of `modeled` and whether a "live" badge is shown anywhere — the hub answer is "modeled → Low, no live badge in the confidence stat," but the dashboard's `RateResults`/`MarketDataView` rendering of provenance is unconfirmed.

### F. Coverage denominators and call-only fill (gaps 16, 22)

**22. Reconciling the inconsistent specialty counts.** The denominators ARE reconcilable into a layered hierarchy, and the brief should present them as **different layers of the same stack, not competing totals:**
- **~70 canonical engine bands** — the explicit `SPECIALTIES` entries with researched `{min,max,p70}` (the actual price anchors).
- **~140 aliases** mapping into those ~70 (the `SPECIALTY_ALIASES` table).
- **~164 "specialties"** = the ~70 canonical + the alias surface a user can type and get matched (the "matchable surface").
- **88 SOC-mapped** — the `SPECIALTY_TO_SOC` table size in `blsSanityCheck` (88 specialties have a BLS SOC code for the sanity check); the gap between 88 and ~164 is specialties matchable for a quote but **without** a BLS sanity anchor.
- **152 canonical reference rows** — the `specialty_canonical_view` reference TABLE (the data-layer allowlist the bridge/fleet gate against); this is the **data-pipeline** denominator, distinct from the **engine** denominator (~70 bands).
- **"888 entries"** — not reconciled in the material; flag as **OPEN QUESTION** (likely a raw alias+entry count or a fleet catalog size, but unconfirmed). 

The honest reconciliation: **~70 priced bands ⊂ ~164 matchable engine surface (70 + ~140 aliases, with overlap); 88 of those have a BLS sanity anchor; the data pipeline uses a separate 152-row canonical allowlist.** These are different denominators for different subsystems (engine pricing vs BLS sanity vs data-admission), and "coverage" claims must specify WHICH. The "888" figure is unsourced in the material.

**16. Call-only fill-rate table (specialties × day-type).** The material does not contain a per-specialty fill matrix, but it gives the qualitative shape precisely enough to state the rule and the known cells:
- **Holiday slots: null for essentially every specialty** (maps: "holiday slots are null for essentially every specialty") → holiday day-type almost always resolves to `insufficientData`.
- **Weekend: frequently null or mirrors weekday** (no real differential observed).
- **Weekday: the best-covered slot**, but still with many all-null specialties → `insufficientData`.
- **Confirmed populated bands** (from the request-type audit, weekday unless noted): ob/gyn worked(3900,4200,4050) + weekend beeper(1500,1800,1650); neurosurgery weekday/weekend beeper(4200,4800,4500), callback 475; anesthesiology worked(2675,3900,3300), callback 400–500; neurology worked(1800,3500,2750); urology weekday beeper(2500,3500,3150) + weekend beeper(2500,3000,3000), callback 350–450 (5 sources); cardiology beeper(2500,2500,2500), callback 350.
- **Confirmed NULL (insufficientData by design):** CRNA, EM, psychiatry (no clean public day structure).
- **Single-source point estimates (min==max==typical, sources:1):** trauma, interventional cardiology, internal medicine, pediatrics.

The actionable table the critic wants (every specialty × {weekday, weekend, holiday} fill) **requires enumerating `CALL_RATE_DATA`**, which is not in the material. **OPEN QUESTION for deep research:** read `callRates.ts` and emit the full fill matrix — this is directly actionable and the maps tell us the answer's shape (weekday > weekend ≫ holiday≈∅). Flag as a concrete extraction task.

### G. Parsing, bounds, and multiplier-interaction correctness (gaps 23, 24, 25, 33, 37, 38)

**23. Call-only `day`/`shift` unit parsing/validation.** The rate-cap carries a `unit` field (`hour | day | shift | unknown`). The hourly path **drops** `day`/`shift` caps (only `hour`/`unknown` apply, ×0.80); the call path **uses** `day`/`shift` caps (`getCallOnlyPayCap = cap·0.80`). The maps confirm the *routing* but state the **extraction reliability of the unit field is not characterized** — `extractBillRateCap` is regex over messy PDF text. The silent-misroute risk is real: a `$4000` cap mis-parsed as `unit=hour` on a call-only assignment would be **dropped** (call path ignores hour caps) when it should clamp; or an hourly cap mis-parsed as `unit=day` would be **silently ignored** on the hourly path. **No cross-check exists** between the parsed unit and the assignment's call/hourly classification. Flag as a real correctness gap: **unit-field extraction reliability is unmeasured, and a misparsed unit silently routes a cap to the wrong (or no) clamp with no guard.** Mitigation suggestion (not in material): assert unit-consistency against `callOnly.isCallOnly` (a call-only assignment expecting a day cap, an hourly one expecting hour) and surface a low-confidence flag on mismatch.

**24. Bill→pay bound (B6) validity depends on the unknown margin.** Correct and load-bearing. The bound `pay ≤ bill × 0.80` assumes the **20% margin constant**. But IMS's real margin is **unobserved** (open Q12: possibly 25–35%). If real margin is 30%, the true bound is `pay ≤ bill × 0.70`, so the `×0.80` bound is **too loose** (admits pays that are actually impossible) — it would fail to catch an over-quote between `bill×0.70` and `bill×0.80`. The bound is **never wrong-signed** (it's always an upper bound; a looser upper bound just catches fewer violations), but it is **only as tight as the margin assumption is accurate.** The brief states the B6 lever without noting that **its usefulness as a ceiling degrades exactly as real margin exceeds 20%** — and the margin it needs is the one quantity IMS can't observe from the market. Honest framing: **B6 is a valid-but-loose upper bound whose tightness is capped by the 20% margin assumption; with real margins at 25–35% it would let some over-quotes through.** The fix requires extracting actual bill rates from LS invoices/timesheets AND knowing the realized margin — both currently absent.

**25. Minimum-floor clamp: does combined multiplier interaction floor at `spec.min`?** Genuinely unanswered by the maps and a real gap. The engine documents the **max ceiling exhaustively** (`spec.max` clamp + 1.75 combined cap) but the maps **never state a `spec.min` floor clamp.** The critic's worked example is valid: telehealth 0.75 × academic 0.85 × long 0.95 × low-geo 0.88 ≈ **0.53**, and `base(p70) × 0.53` lands **well below `spec.min`** with **no documented floor clamp** in any map. The combined multiplier is only capped ABOVE (at 1.75), never floored BELOW. So **the engine CAN quote below `spec.min`** on a stacked-discount assignment, and nothing in the material contradicts this. **This is a real, confirmed-from-absence gap:** the safety story is asymmetric — exhaustively clamped above, **unclamped below.** Flag as a finding: a degenerate discount stack can drive a quote under the researched floor with no floor guard, undermining the "every number traces to a researched band" claim on the low side. **OPEN QUESTION for deep research:** read `calculateRate` for any `Math.max(payRate, spec.min)` — the maps show only the upper clamps, strongly implying none exists, but a direct read should confirm.

**33. No cross-check between call-only and hourly outputs for the same assignment.** Confirmed gap. `detectCallOnly` misrouting is flagged in the maps, but **no guard compares the two paths' outputs for sanity** — once dispatched, only one path runs (single branch at the call site). There is no "compute both, compare for plausibility" reconciliation. The maps don't even flag the *absence* as a gap, so this is a net-new finding: **a misrouted assignment is priced entirely on the wrong path with no second-path sanity comparison.** The two paths price very differently (hourly ×multiplier-chain vs daily-band ÷ coverage hours), so a misroute is a large silent error. Flag as a real gap with a concrete mitigation: for borderline `detectCallOnly` confidence, compute both and flag if the implied $/hr diverge beyond a threshold.

**37. "Engine can only pull a quote DOWN" is imprecise.** Correct — the absolute framing is wrong as stated. Multipliers routinely raise the quote ABOVE p70: night 1.20, CAH 1.22, holiday-shift 1.35, rural_trauma 1.30, psych 1.12, plus call 1.10 and holiday 1.10, compounding up to the **1.75 combined cap** — so a quote can be **1.75× the base** before any clamp. Calibration adds a further **+15% upward nudge** (clamp ceiling 1.15). The ONLY strictly-downward operations are the two **final clamps** (`spec.max` ceiling and the 1.75 cap, both of which only *limit* upside) and the rate-cap ×0.80. So the precise statement is: **the engine raises quotes above p70 routinely (up to 1.75× via multipliers, +15% via calibration); only the terminal clamps are downward, and they bound — not reduce — the quote.** The "math can only lower" framing should be replaced everywhere with "**multipliers move the quote both directions within a researched band; the terminal clamps enforce the researched ceiling.**" This is a framing correction, not a mechanism change.

**38. Multiple facilities in one PDF (`parseFacilities`) → single facility multiplier.** The maps confirm `parseFacilities` extracts multiple facility entries from a PDF, and `inferFacilityTypeEnhanced` resolves a facility *type* multiplier — but the **selection/precedence among multiple facilities is not described in any map.** So **how N parsed facilities collapse to ONE `facilityMult` is unstated.** The maps show the inference reads facility text but not the tie-break rule (first-listed? highest-multiplier? most-specific-keyword-match?). **OPEN QUESTION for deep research:** read `inferFacilityTypeEnhanced` + `parseFacilities` to determine the collapse rule — first-match, max, or keyword-priority. This is unanswerable from the material and is a genuine specification gap (multi-site assignments are common, and the chosen facility type can swing the multiplier from academic 0.85 to CAH 1.22, a 44% swing).

### H. Geo, percentile rationale, region-collapse error, market-bar contradiction (gaps 20, 21, 26, 32, 36)

**20. `representativeState` region-collapse error, bounded.** The hub maps a region to ONE state's multiplier (the state whose `STATE_MULT` is closest to the region mean). The approximation error is the **multiplier spread within a region.** The maps give `STATE_MULT` clamp bounds `[0.88, 1.38]` (a 1.57× total spread nationally) but **do not enumerate per-region min/max multipliers**, so the exact within-region spread (e.g. West = CA high-COLI/high-demand vs WY low-density) **cannot be numerically bounded from the material.** What CAN be said: since the national clamp is `[0.88, 1.38]` and a region like "West" spans both high-COLI coastal (pushing toward 1.38) and low-density interior (pushing toward the demand-driven high end OR the low COLI end), the **within-region spread can plausibly approach a large fraction of the full national 0.88–1.38 range** — meaning a National/West manual quote can be **off by up to ~±20–25%** on the geo factor versus the true state. A PDF with an exact state **always overrides** the region approximation, so the error only affects **manual (non-PDF) region-button quotes.** **OPEN QUESTION for deep research:** compute `max(STATE_MULT) − min(STATE_MULT)` within each of the 5 regions to size the approximation precisely — the data (`STATE_MULT` table in `stateData.ts`) exists and this is a direct calculation. Flag the fix already in the levers: replace region buttons with a state dropdown on the manual path.

**21. Why p70 (vs p50 / p75)?** The maps state the engine anchors `baseRate = spec.p70` and that p70 is a **linear 70% interpolation of min/max, not a real percentile.** **No rationale for choosing 70 over 50 or 75 appears anywhere in the material.** The positioning copy ("median hero + premium marker") even suggests a tension: the hub markets a "median" hero while the engine anchors p70 (the 70th point of the band, ABOVE median). So **p70 is asserted, not justified, in all available material** — it reads as a product-positioning choice (quote toward the upper-middle of the researched band to reflect IMS's premium positioning) rather than a statistically principled percentile. **OPEN QUESTION for deep research (flagged in the brief's Q10):** there is no current written rationale for p70; the deep-research session should either source the original product decision or treat the percentile target as an **open, re-derivable parameter** (especially since the levers call for "re-derive p70 from a real observed distribution rather than linear interpolation" — which would make the percentile *choice* meaningful in a way it currently isn't). State plainly: **p70 is currently arbitrary-by-positioning, not principled.**

**26. `computeAdjustedSpecRange`: verbatim vs factor-adjusted (the contradiction, resolved).** The engine-core map says `computeAdjustedSpecRange` now returns `{adjustedMin: spec.min, adjustedMax: spec.max}` **verbatim/unscaled** (the `_f`/`_rate` params ignored, retained for call-site compat). The hub map says the market bar is "adjusted by factors." **These are reconciled by recognizing the engine-core map reflects the CURRENT canonical engine state and the hub map's "adjusted by factors" language is stale/aspirational wording for the same call.** The authoritative reading: **the market-position range is the UNSCALED researched `spec.min..spec.max`; it does NOT move with the per-assignment multipliers.** The consequence — explicitly noted in the engine map — is that **a clamped quote sits at the right edge of a fixed bar** (the bar doesn't stretch to accommodate the quote; the marker just pins to the max). So the contradiction resolves in favor of **verbatim/unscaled**: the bar is the static researched band, the marker (= payRate) moves within it, and the "adjusted" wording in the hub map is imprecise. Flag the hub map's "adjusted by factors" phrasing as the error to correct in the brief.

**32. Can a live overlay LOWER a quote, and by how much?** Yes, and this is a real under-examined path. `loadMarketRates` **mutates `spec.min/max/p70` in place**, and the quote anchors `base = spec.p70`. If a fresh live band shifts min/max **down** relative to the static curation, the new linear `p70 = min + (max-min)·0.70` lands **below** the old static p70, and **every quote for that specialty drops** (the whole multiplier chain is applied to a lower base). The maps confirm the overlay is **confidence-blind** and a single low-confidence scraped estimate can set the floor — so a low scraped row CAN drag the band (and thus the quote) down. **The magnitude is unbounded in the material** beyond the band's own movement: there is no clamp preventing the live p70 from falling below the static p70 (the `STATIC_CONFIDENCE` snapshot prevents confidence *downgrade*, but does NOT prevent *price* downgrade). So: **overlays CAN lower a hot specialty's quote, by exactly the amount the live p70 falls below the static p70, with no floor guard.** This compounds with gap 25 (no `spec.min` floor) — a low overlay plus a discount multiplier stack could push notably below the static curation. **OPEN QUESTION for deep research:** for the live anesthesiology overlay (240/450/p70 387) vs its static curation (300/400/p70 370), the live p70 is actually HIGHER (387 > 370) so anesthesiology is currently nudged UP — but a specialty whose live floor scrapes low would go DOWN. Quantify by comparing live vs static p70 across all currently-live specialties (same RTDB read as §A.3).

**36. Geo-exponent (0.30/0.30/0.40) absolute-dollar sensitivity.** The geo multiplier is `clamp((100/COLI)^0.30 · (304/density)^0.30 · demandWeight^0.40, 0.88, 1.38)`. The **dollar sensitivity to an exponent error is not worked in the material**, but it can be constructed: the multiplier is multiplicative on the base, so a quote's geo-driven dollar move is `base · (mult − 1)`. For a state with COLI 130 and density 0.5× national: the COLI term `(100/130)^0.30 = 0.925`; if the exponent were 0.40 instead of 0.30, `(100/130)^0.40 = 0.901` — a **2.6% shift in that term**, compounding into roughly a 2–3% multiplier change, i.e. on a $370 base, **~$8–11/hr.** A larger exponent error (0.30→0.50) on a high-COLI state moves the term ~5%, ~$18/hr. So **geo-exponent errors are second-order — single-digit to low-double-digit $/hr per 0.10 exponent change** — much smaller than the band-floor or v2-adoption levers. This sizing (constructed, not from the material) lets a researcher **deprioritize the exponent question relative to the floor-confidence and v2-posterior levers.** **OPEN QUESTION:** the exact per-state dollar sensitivity needs the real COLI/density/demand inputs run through the formula; flag as a low-priority parametric sweep. Net: **the exponents are unlikely to be a top-3 accuracy lever; the worked sizing supports deprioritizing them.**

### I. Adversarial robustness and key-collision safety (gaps 30, 31)

**30. Threat model for poisoned scrape input (anti-noise ≠ anti-adversary).** The defensive stats — MAD outlier rejection (z>3.5), family collapse, 60% family cap, never-anchor exclusion — are designed and described as **anti-noise** (resist a bad scrape, a duplicate, a job-board W2 number), **not anti-adversary.** Assessing them against *deliberate poisoning*: (a) **MAD rejection** resists a *single* inflated outlier well (it'd be ejected as `z>3.5`), but is **defeated by a coordinated cluster** — if an adversary publishes *multiple* inflated rates near each other, they become the *mode*, MAD rejects the honest *low* values as outliers, and modal-escape might flag bimodality (forcing manual review) but a *uniformly* shifted distribution (all inflated) has no second mode to detect → **the poison passes as a clean high consensus.** (b) **Family collapse** only helps if the adversary's sources resolve to one family — but per §B.19, live sources attribute to search *tools*, so an adversary publishing on N different sites surfaced by tavily/exa gets **N apparent families** → family cap and collapse **do not defend against a multi-site adversary today.** (c) **The ≥2-string quote gate (§C.14)** is trivially cleared by one adversary on two pages. So the honest assessment: **the guardrails are robust to accidental noise but NOT hardened against a deliberate price-signaling adversary** who publishes a coherent cluster of inflated rates across multiple domains — exactly the price-signaling risk raised in Q28. This is a genuine, unaddressed threat-model gap. Flag as a finding: **the anti-collusion story (family collapse) is the intended adversary defense but is presently inert on live data (tool-attribution), leaving the engine open to coordinated multi-site rate inflation; the real defense would be publisher-domain attribution + cross-checking against BLS-anchored plausibility bounds (which today only gate a display chip, not the quote).** The deep-research session should treat adversarial poisoning as a first-class threat, not a noise sub-case.

**31. `firebaseSafeKey` collision-safety.** The maps confirm `firebaseSafeKey` encodes RTDB-forbidden segments (`/.#$[]`) — e.g. `ob/gyn` → a safe key — because RTDB treats `/` as a path separator. The maps assert the **round-trip** (encode→decode back to the canonical key) but **never address whether the encoding is injective** (collision-free). The risk the critic names is real and **unaddressed in the material**: if two distinct canonical specialty names encode to the same safe key, their bands would **silently merge** in RTDB. Whether `firebaseSafeKey` is a provably-injective encoding (e.g. percent-style escaping that's reversible) or a lossy substitution (e.g. replacing every forbidden char with `_`, which WOULD collide — `a/b` and `a.b` both → `a_b`) is **not specified.** This is a real correctness question. **OPEN QUESTION for deep research:** read `firebaseKeyCodec.ts` (`firebaseSafeKey`/`firebaseUnsafeKey`) and verify the encoding is injective across the full ~164-specialty + alias namespace — specifically check whether distinct forbidden characters map to distinct escape sequences (safe) or a shared placeholder (collision risk). Given the ~70 canonical names are mostly plain ASCII with `ob/gyn` the notable forbidden-char case, **collision risk is probably low in practice but is unverified**, and a single collision would silently corrupt two specialties' live bands.

### J. Test-count reconciliation and jargon glossary (gaps 34, 35)

**34. Reconciling the test counts into one table.** The scattered numbers map to distinct suites with distinct guarantees:

| Count | Suite | What it guarantees |
|---|---|---|
| **208** | Golden master (`goldenMaster.json`) | **Core quote parity** — byte-identical engine output (dashboard vs hub) across 208 fixed input cases, run against **static bands, overlay OFF** (gate-1). Touches hourly + call-only paths. |
| **266** | Data-layer logic parity (hub-owned `rate-engine-gate2-*.test.ts`) | **Gate-2a** — the dashboard's OWN data-layer suites (crnaCellLookup 38 · aggregation 50 · BLS sanity 59 · marketRates+buckets 119) run against the hub's vendored engine via the `configureEngine` seam. Mocked backends, not live. |
| **264** | Earlier snapshot of the same data-layer suite (pre-final count) | Same family as 266; the 264→266 delta is added cases. Not a separate guarantee. |
| **993** | Full hub test suite (on the branch) | Everything: 208 golden + 266 data-layer + all other hub/engine/site tests. The "all green" branch number. |
| **727** | Full suite **on the deployed build artifact** | The subset that runs against the actual built `dist` (gate-2b real-browser + artifact tests); lower than 993 because branch-only/dev tests don't run on the artifact. |

The reconciliation the critic wants: **208 = quote parity (static), 266 = data-layer logic parity (mocked), 993 = full branch suite, 727 = artifact suite; 264 is a stale 266.** A "parity" claim maps to **208 (quote) + 266 (data-layer)**; the 993/727 are total-suite health, not parity guarantees. This table should go in the brief verbatim.

**35. Jargon glossary (define at first use).** The body assumes these; inline definitions:
- **D-XX decision codes** — numbered design decisions in the rate-simulator design contract. **D-11** = the 6-value `rate_type` enum. **D-33** = "zero-drift": the shared `aggregateCell`/`aggregateBridge` math must stay byte-identical across dashboard+hub (enables golden-master parity). **D-34a** = cap cells are written verbatim and never bucketed. **D-36** = flat `evidence_weight=1.0` per distinct observation (raw multiplicity never inflates weight). **D-37** = 60% family-weight cap. **D-38a/b** = source-reliability is an honesty-labeled "stability" score, explicitly NOT weight-bearing. **D-39** = `RATE_TYPE_PRECEDENCE` (actual_paid_locum 4 > advertised 3 > crowd 2 > scraped 1). **D-42** = the Phase-3-column probe that avoids a false-positive close-UPDATE crash after the firebase write already committed.
- **iron dome** — the escalate-only plausibility ceiling layer (`MAX_HOURLY_CEILING`, `PLAUSIBLE_RANGES`); mirrors the fleet's Python `iron_dome.py`. Can only escalate a verdict to 'hard', never relax.
- **Proof-Carrying-Numbers** — the observe-and-cite discipline: every emitted rate carries a source URL + verbatim `cited_text` + a substring check proving the number is literally grounded in the stored page chunk (rate_observer's VERIFY stage).
- **mulberry32** — a small deterministic seeded PRNG; used (seed `0x5eed1a5`) for the source-reliability bootstrap so cron runs are reproducible.
- **modal-escape** — the second bimodal detector: when MAD ejects an *entire* cluster (≥3 same-side outliers, gap > 4·MAD), the cell is flagged `manual_review_bimodal` rather than collapsing to a wrong mean.
- **MSP/VMS** — Managed Service Provider / Vendor Management System: the intermediary platforms (LocumSmart is a VMS) that sit between the agency and the facility and set the bill-rate ceiling; relevant because they're the bill-side context the engine bounds pay against.
- **split-half var ratio** — the first bimodal detector: sort survivors, split in half, flag if `varHigh > 4·varLow`.

### Summary of newly-surfaced findings (not just gap-closures)

Three items rise to **findings the brief body should elevate**, not bury:
1. **The quote-path overlay fires on ≥2 source STRINGS, not ≥2 families (gap 14)** — so "two independent companies required" is false for the quote; independence affects only the confidence badge. Compounded by **tool-attribution on live data (gap 19)**, the anti-collusion guarantee is presently **inert**, which **opens the engine to coordinated multi-site rate poisoning (gap 30).** These three chain into one real vulnerability.
2. **No `spec.min` floor clamp (gap 25)** + **overlays can lower a quote with no floor (gap 32)** — the safety story is asymmetric (exhaustively clamped above, unclamped below); a discount-multiplier stack or a low scraped overlay can quote below the researched floor.
3. **Flat `evidence_weight=1.0` makes IVW down-weight HIGH rates (`w ∝ 1/mid²`) (gap 7)** — the "inverse-variance-weighted" label implies quality weighting but today delivers a structural downward bias by magnitude; cheap to note before the posterior is ever adopted for the quote.

All remaining items resolved above are either closed from the maps or explicitly flagged as **OPEN QUESTIONS for the deep-research session**, concentrated in a small set of direct reads: the live `market-rates` + `market-rates-v2` RTDB nodes (gaps 1, 3, 6, 32), `callRates.ts` fill matrix (16), `calculateRate` floor check (25), `inferFacilityTypeEnhanced` collapse rule (38), `firebaseKeyCodec.ts` injectivity (31), and `goldenMaster.json` case split (2).
