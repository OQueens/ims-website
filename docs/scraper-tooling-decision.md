# Scraper Tooling Decision — Firecrawl vs ScrapeGraphAI vs Self-hosted Scrapling

_Decision brief for the IMS rate-simulator locum-pay scraping layer. Two research waves (capabilities/pricing + due-diligence), firsthand-verified pricing, cited third-party benchmarks. 2026-06-30._

## Bottom line

**Go self-hosted Scrapling as the PRIMARY fetch layer. Use deterministic JSON-LD/CSS parsers — NEVER LLM extraction. Wire IMS's own Cloudflare bypass into the stealth tier. Do NOT buy ScrapeGraphAI. For the paid protected-site *fallback* slot, trial Scrapfly rather than renewing Firecrawl as your Cloudflare answer.**

This removes the per-page cost cap that throttles source breadth (the exact constraint the rate-sim anchor gate needs relieved), keeps a hallucinated `$/hr` from ever becoming a false anchor in a live quote, and preserves golden-master reproducibility.

## Why (the three decisive facts)

1. **Cost scales with breadth, and breadth is the goal.** At our "scrape as much as possible" volume (~230k pages/mo, 2.3× over the Firecrawl 100k cap):

   | Volume | Scrapling (self-host) | Firecrawl | ScrapeGraphAI (AI extract) |
   |---|---|---|---|
   | ~230k pages/mo | **~$20–60/mo flat (EC2)** | $333–599/mo | **~$4,000–7,000/mo** |

   Per-page credit models tax the exact thing we want. Self-hosting makes "add another source family" an engineering decision, not a billing one.

2. **Our pay data is STRUCTURED** — schema.org `JobPosting.baseSalary` JSON-LD (DocCafe, LocumJobsOnline, Physemp) + CSS pay-cards (AMN `div.card-pay-ammount`), both runtime-verified with Scrapling's free selector path. LLM extraction (ScrapeGraphAI's whole pitch, Firecrawl Extract) solves a problem we don't have — and it's a **liability**, not just an expense: a hallucinated `$/hr` becomes a plausible-but-wrong false anchor that clears the n≥4 + 2-family gate and moves a live quote. A regex miss yields no row (safe); an LLM miss fabricates an anchor. This directly violates the "only real observed data gets confidence labels" rule.

3. **We already own a Cloudflare/CAPTCHA bypass** — so managed anti-bot is redundant spend. Firecrawl only clears ~34% of protected sites in third-party benchmarks (~63–65% overall); Scrapfly benchmarks ~99% but we don't need it if our own bypass wires into StealthyFetcher.

## Firsthand-verified pricing (live pricing pages, 2026-06-30)

- **Firecrawl** — Standard $83/mo (yearly) / 100k pages / 50 concurrent. Scrape/map/crawl = 1 credit/page; **JSON-LD/LLM extract OR stealth = 5/page**. No pay-per-use overage (hard tier step). Bills successful fetches of error pages; charges on failed protected-site attempts.
- **ScrapeGraphAI** — Growth $100 / 100k credits. Scrape→markdown = 1; **AI Extract/SmartScraper = 5 (+5 stealth = up to 10)/page** → Growth buys only ~10–20k AI-extracted pages/mo. OSS lib (~27k stars, MIT) self-hostable but LLM-native (bills your own tokens ≈ $3.5k–11.5k/mo at our volume; local Ollama ≈ $0 but documented-fragile, returns non-JSON).
- **Scrapling** — $0 API (BSD-3). Cost = EC2 (~$20–60/mo) + ops. curl_cffi static Fetcher + StealthyFetcher (patchright/browserforge) + Playwright DynamicFetcher.

## Due-diligence findings (wave 2)

- **Scrapling is production-ready enough to be primary** — ~68k stars, `archived:false`, monthly releases, 126 closed vs 5 open issues (Cloudflare bugs closed same-day–days), ~756k downloads/mo. Actively maintained, widely adopted.
- **Two real caveats (shape the design, not the verdict):**
  - **Single-maintainer bus-factor** (D4Vinci = 1,427 commits; next = 10). This is *why the paid fallback stays wired* — insurance, not ceremony.
  - **StealthyFetcher is whack-a-mole on hard anti-bot and can silently return HTTP 200 on challenge/404 pages** (issues #261/#265; open #352 hCaptcha unanswered). For a live rate quote this is the dangerous failure mode.
- **Factual correction:** the v0.4.x stealth engine is **patchright + browserforge + apify-fingerprint-datapoints + Playwright**, NOT Camoufox (Camoufox was central in v0.3). Update prior plan wording.
- **ScrapeGraphAI rejection reinforced** — technically-true claims are non-differentiators or paid-tier-only; a documented "playground-to-API gap" returns garbage via API. Disqualifying for a live financial anchor.
- **One course adjustment — Scrapfly for the paid *fallback* slot, not Firecrawl.** Scrapfly ~99% vs Firecrawl ~63% on protected sites, transparent credits, doesn't bill-on-failure. No challenger (Apify, Bright Data, Zyte, Oxylabs, Crawlee, bare Camoufox) beats Scrapling on $/page for PRIMARY at our volume.

## The build config

**Primary (self-hosted, $0/request):**
- **Static tier — `curl_cffi` Fetcher:** carries the bulk (~225k/mo unprotected). High-concurrency, cheap — this is where throughput comes from.
- **Stealth tier — StealthyFetcher:** the ~5 Cloudflare sources ONLY (Vivian, Marit, LocumJobsOnline, ACR, VISTA). **Cap concurrency to <10 on an 8GB box** (documented OOM above ~10 browser fetches); size EC2 for the pool or split static/stealth onto separate workers. Wire IMS's own CF bypass here.
- **Deterministic parsers:** JSON-LD `baseSalary` + CSS cards. No LLM in the extraction path, ever.
- **🔴 Content-validation guard (BUILD FIRST, non-negotiable):** every fetch must assert the expected structured fields (baseSalary / cards) are present before it's trusted; a 200 with no data = failure → route to fallback or drop. Closes the silent-200-on-challenge hole AND the live-anchor-poisoning risk. Highest-value single item.
- **Ops:** pin Scrapling + patchright/browserforge/apify-fingerprint; shadow-test each monthly release before rolling; persistent EC2 volume for the fingerprint DB.

**Fallback (paid, metered, protected-sites only):** trial **Scrapfly** on a small credit pack (verify BYO-proxy support first). Keep Firecrawl only if already wired as a cheap *unprotected fetch-only* fallback (parse its `rawHtml` with our own parser so extraction stays deterministic); otherwise downgrade/cancel once Scrapfly is validated.

**DO NOT:** use LLM extraction anywhere (ScrapeGraphAI cloud/OSS, Firecrawl Extract) · buy ScrapeGraphAI · rely on Firecrawl for Cloudflare sites · trust an HTTP 200 without content validation · run StealthyFetcher above its concurrency ceiling · run the fingerprint store on ephemeral storage · auto-roll Scrapling releases without shadow-testing.

## Named losing side
We insource **recurring, moderate maintenance + single-maintainer exposure** — not fire-and-forget. We trade a vendor SLA for ~$0/page + control. The bet is sound *because* the paid fallback stays wired and our targets are static-render structured data. If the source mix shifted toward hCaptcha/DataDome-heavy SPAs, this calculus would weaken.

## Top 3 hands-on confirms before full commit
1. **Shadow-parity run** — Scrapling in parallel with the current pipeline; confirm deterministic parsers reproduce today's `baseSalary`/card values on a real sample before cutover (protects the live quote).
2. **StealthyFetcher head-to-head on the ~5 protected sources + OOM concurrency load-test** — verify it clears each Cloudflare source today (open #352 shows hCaptcha isn't guaranteed) and find the concurrency ceiling on the target EC2 size. If it can't, wire IMS's bypass or route to Scrapfly.
3. **Scrapfly BYO-proxy verification** — confirm it supports bring-your-own-proxy on a small credit pack before choosing it over Firecrawl for the fallback slot.

## Rollout sequence
1. Build the **content-validation guard** first — nothing ships fetches into rate data without it.
2. Stand up the **static curl_cffi tier** on EC2 (pinned + persistent volume); run **shadow-parity** on unprotected sources.
3. Cut over unprotected volume once parity holds; keep the old path warm.
4. Add the **stealth tier** (capped concurrency + own CF bypass); run the head-to-head + OOM load test.
5. **Trial Scrapfly** as the protected-site fallback (verify BYO-proxy); wire it behind the content guard.
6. **Downgrade/cancel Firecrawl** as the CF answer once Scrapfly is validated.
7. **Release-hygiene loop:** pin, shadow-test each monthly Scrapling release, periodically re-check protected sources for challenge-page drift.

_Sources: firsthand pricing (firecrawl.dev/pricing, scrapegraphai.com/pricing); Firecrawl docs + anti-bot benchmarks (Scrapeway, ProxyHorizon, puzzleinbox); Scrapling GitHub API (D4Vinci/Scrapling) + PyPI + issues #261/#265/#352 + pypistats; ScrapeGraphAI docs + reviews; Scrapfly/Zyte benchmarks. Full research: session tasks wcsvbk02g + w5h28mjhb._
