# WS1 — Scrapling Market-Typed Scraper: Implementation Plan

_Goal: make live scraping actually DRIVE locum quotes by flooding the bridge with `advertised_clinician_pay` observations from independent families, so cells clear the n≥4 + ≥2-family anchor gate instead of falling back to curated priors._

Status: discovery DONE; both extraction modes runtime-verified (AMN cards, Physemp JSON-LD). This plan drives the production build in `agent-sdk/`.

---

## 1. Architecture (contained swap + two parsers)

The fetch+parse layer is replaced; everything downstream (classifier → dedup → sourceFamily collapse → `aggregateBridge` → `market-rates-v2` → anchor gate) is UNCHANGED.

```
NEW: scrape_scrapling(url, tier) -> markdown|html   (replaces scrape_firecrawl; no BudgetGuard = no cost cap)
       tier: 'static' -> Fetcher (curl_cffi, no browser)   [runtime-verified: AMN 200, 12 pay cards]
             'stealth' -> StealthyFetcher (Camoufox, Cloudflare bypass)  [we have bypass infra]
NEW: parse_jsonld_jobposting(page) -> rows           [runtime-verified: Physemp baseSalary HOUR + hiringOrganization]
       JobPosting -> baseSalary.MonetaryAmount where unitText in {HOUR, DAY}; captures hiringOrganization for dedup
EXTEND: parse_rates(...) regex                         [existing; for card/title text: AMN, JAMA, emCareers, ACR, radworking]
NEW: dedup_cross_board(rows) -> rows                   [#1 RISK: key = hiringOrganization + location + rate]
NEW: w2_guardrails(row) -> keep|drop                   [unitText gate, locum/1099 signal, $60 floor, drop estimate tokens]
-> existing _resolve_rate_type_fields() classifier -> existing Supabase insert -> existing bridge
```

Two parsers cover the whole set:
- **JSON-LD `baseSalary`** (DocCafe, LocumJobsOnline, Physemp) — one parser, auto-captures org for dedup. Highest yield.
- **Title/card-text regex** (AMN `div.card-pay-ammount`, JAMA, emCareers `Pay: $X-Y/hr`, ACR, radworking) — extend existing `parse_rates`.

---

## 2. Source set (wire order) — rate_type + fetcher tier + family

Tier-A `advertised_clinician_pay` (anchors):
| order | source | family | parser | fetcher | notes |
|---|---|---|---|---|---|
| 1 | DocCafe | doccafe | JSON-LD | static→stealth | cleanest; aggregates AMN/Aya; rate in slug |
| 2 | LocumJobsOnline | trackfive | JSON-LD | stealth | THE multiplier (recovers CHG/Weatherby/Medicus/Consilium); ⚠ ranges self-"estimated" → `aggregator_estimate` lower-trust, never anchor ALONE |
| 3 | gaswork | gaswork | regex (RSS/cards) | stealth | ~13.8K CRNA+anes; has 1099/W2 flag column |
| 4 | Physemp | physemp | JSON-LD | static | clean baseSalary HOUR |
| 5 | JAMA Career Center | communitybrands | regex cards | static | Aya $X/hr+$X/day; dedup vs DocCafe |
| 6 | ACR (radiology) | communitybrands | regex | stealth | "Hourly Wage" structured; mandated disclosure |
| 6 | emCareers (EM) | madgex | regex | static | "Pay: $X to $Y per hour" |
| 7 | radworking (radiology) | radworking | regex | static | $/hr + $/wRVU + $/shift |
| — | AMN, Cross Country, LocumTenens.com, Vivian, Aya | (existing 5) | cards/JSON-LD | mixed | already cataloged; AMN runtime-verified |

Context only (`scraped_article_estimate` / `crowd_survey`, NEVER anchor): Marit Health (per-spec × per-STATE — wire as geo prior), Locumstory, VISTA, ZipRecruiter/Glassdoor salary pages.

DO-NOT-SCRAPE (pay-opaque or W2-annual): CHG/Weatherby/Medicus/Hayes/MPLT/Fusion own boards; PracticeMatch/3RNet/APA/RSNA (perm annual); Indeed/PracticeLink (no number). Recover their pay via aggregators instead.

Family collapses to encode in `KNOWN_FAMILY_OVERRIDES` (sourceFamily.ts) + the python side: CRNAjobs→LocumTenens(jackson); Medical Doctor Associates→Cross Country; Onyx→Caliber; Wellhart→Barton; JAMA/ACR/RSNA/APA/NEJM share Community-Brands engine (one parser, but ONLY JAMA+ACR emit pay).

---

## 3. Code changes (`agent-sdk/`)

1. `agents/rate_scraper/scrapling_fetch.py` (NEW): `scrape_scrapling(url, tier)` — Fetcher/StealthyFetcher, HTML→markdown bridge for the regex path (markdownify) OR return the Scrapling page for the selector/JSON-LD path. No BudgetGuard.
2. `agents/rate_scraper/parsers.py` (NEW): `parse_jsonld_jobposting(page)` (unitText HOUR/DAY gate built-in) + per-source selector configs (CSS for AMN cards, etc.).
3. `agents/rate_scraper/dedup.py` (NEW): `dedup_cross_board(rows)` keyed on `hiringOrganization + location + rate` (the anti-fake-consensus guard). Runs BEFORE Supabase insert (the bridge then does its own family-collapse).
4. `agents/rate_scraper/agent.py`: a per-specialty posting-scrape loop (list → detail per specialty, iterating the engine specialty list), routing each source to JSON-LD vs regex parser; apply `w2_guardrails`; reuse `_resolve_rate_type_fields` + existing insert path.
5. `shared/rate_type_url_patterns.json`: add `per_source_defaults` for the new sources (advertised_clinician_pay; LJO = a new `aggregator_estimate` class or low confidence) + bump `metadata.checksum_sha256`.
6. `agents/rate_scraper/sources.py`: add the new sources + update the cardinality asserts (currently 6/18/24) in lockstep.
7. Website engine `sourceFamily.ts` `KNOWN_FAMILY_OVERRIDES`: add new multi-brand parents (trackfive, communitybrands, etc.) so they don't fake independent votes. (Canonical + vendored.)
8. Tests: per-parser unit tests with captured live fixtures; cardinality assert; dedup test (Aya-on-2-boards → 1 row); W2-guardrail test (reject YEAR/perm).

---

## 4. Validation (runtime-verified so far + per-source)

- ✅ Scrapling `Fetcher.get` static, AMN radiology → 200, 12 `div.card-pay-ammount` cards `$291–315`, `$306/hr` avg.
- ✅ JSON-LD parser, Physemp `/physician/jobs/2235817` → `baseSalary {value:375, unitText:HOUR}` + `hiringOrganization:"Tandym Health"`.
- TODO per source before wiring: one live fetch + verbatim-quote confirm of the selector/JSON-LD path (refute-by-default; a content-blind classifier mis-tags silently).

## 5. Fleet deploy (needs Zach EC2/creds — the live RUN)
- `scrapling` + `scrapling install` (browsers for StealthyFetcher) on the EC2 fleet box; add to `requirements.base.txt`.
- Wire the Cloudflare/CAPTCHA bypass infra into StealthyFetcher (or run StealthyFetcher's Camoufox).
- Run rate_scraper → Supabase rate_intelligence → `bridge-rate-intelligence` re-run → RTDB `market-rates-v2`. Then cells with n≥4 + 2 families auto-anchor (trust ladder, already live).
- Cost: ~$0 marginal (self-hosted) vs Firecrawl per-page. Keep per-domain throttle (Scrapling built-in) + politeness.

## 6. Honesty caveats (carry forward)
- LJO ranges self-"estimated" → `aggregator_estimate`, lower trust than posted ranges; never anchor a cell alone.
- Health eCareers rates are blended all-inclusive (not base pay) — flag.
- JSON-LD baseSalary not universal — verify per board.
- Aggregator dedup is the linchpin: without it, one Aya posting on 3 boards = fake n=3.
- No internal pay ground truth — these are ADVERTISED rates (upper-ish bound on pay); LS bill extraction (Phase 5) remains the internal truth signal.
