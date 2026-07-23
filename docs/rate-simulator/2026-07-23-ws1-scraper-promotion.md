# WS1 Scraper Promotion Record (2026-07-23)

Durable record of promoting the WS1 Scrapling rate-scraper to the production fleet,
so the decision + verification plan survive outside session memory. The scraper source
lives in the `agent-sdk` repo (branch `feat/rate-engine-extract-2026-06-22`); the engine
it feeds lives here in `ias-website`. This file is the ias-website-side breadcrumb.

## What shipped
- **Image `ias-agent-rate_scraper:ws1` = `644ebf92ec91`** retagged to `:latest` on the
  fleet host (EC2 54.145.175.182), 2026-07-23 ~15:22 UTC. Digest-verified: `:latest` ==
  `:ws1` == `sha256:644ebf92ec91…`, distinct from `:pre-ws1` = `45bd28d1a841` (rollback).
- The fleet orchestrator resolves `ias-agent-<name>:latest` fresh per run
  (`scheduler.py` `build_docker_run_config`), so no restart was needed.
- Adds a Scrapling static-fetch AMN advertised-pay pipeline on top of the legacy
  Firecrawl/SerpAPI sources; ~2.75x daily record coverage in the gate run (20 legacy +
  35 net-new AMN across 13 specialties).

## First live run
- **2026-07-24 10:00 UTC** (the daily `rate-pipeline`, `pipelines.yml`, 05:00 US/Central).
  Jul 21-23 runs already fired on the OLD image during a multi-day session gap (benign).

## Verification plan (run after the first live run)
- `agent_runs` for `rate-scraper` / `rate-validator` / `rate-auditor` == `success`.
- `rate_intelligence` rows for `date_scraped` = 2026-07-24, `agent_id` = `rate_scraper`:
  confirm an `amn` source appears alongside `locums_com` + `serpapi_google`.
- Strategy Brain daily briefing shows the run healthy.
- If `amn` absent or the pipeline errors → rollback and diagnose:
  `docker tag ias-agent-rate_scraper:pre-ws1 ias-agent-rate_scraper:latest`.

## Gate summary (Sol adversarial review, binding)
- R1 = DEFECTS-FOUND (7; 5 blocking). R2 = **GO** after all 7 remediated with observed
  evidence. Highlights, each runtime-verified:
  - **D3 (CRITICAL):** the container exited 0 even on scrape failure, so the pipeline would
    run validator/auditor on stale data with no alert. Fixed test-first (`_container_main()`
    maps run()->None to exit 1; pipeline halts on nonzero). Real robustness gain over the
    prior prod image.
  - **D1:** 10 host-generated `.pyc` files were baked into the image from the base image's
    dirty build context. Fixed via `.dockerignore` + an in-image purge layer (0 `.pyc` in
    the shipped image).
  - **D7:** pinned `scrapling[fetchers]==0.4.10` + captured a `pip freeze` SBOM.
  - **D4:** legacy equivalence proven by a paired same-window zero-write comparison — the
    20-record legacy multiset is byte-identical old-vs-new.
- Pre-promotion the gate also caught that the 2026-07-10 `:ws1` image could never have
  started (missing `shared/` overlay -> import crash); promoting blind would have been a
  day-one outage.

## Source + backup
- Fleet commits: `ca06145e`, `c9e2361e`, `02558a88` (agent-sdk branch
  `feat/rate-engine-extract-2026-06-22`).
- Those commits **cannot push to GitHub** (a 232 MB mp4 in branch history, GH001). Source
  is patch/bundle-backed locally at `QueenClaude/agent-sdk-ws1-backup/`. Offsite backup
  needs an operator decision: `git filter-repo` to strip the mp4, or migrate it to Git LFS.

## Follow-ups (backlog)
- Same-day insert idempotency on `rate_intelligence` (unique key / upsert) — Zach-gated
  migration; the writer is currently a plain insert.
- 5 AMN specialty slugs 404 (family practice, general surgery, orthopedic surgery,
  pulmonology, neurosurgery) — slug refresh.
- Fleet-wide base-image build hygiene; full transitive dependency + base-digest pinning
  for bit-for-bit rebuilds.
- Append a plain-English win to `deep-dive/WEEKLY-SYNC-WINS.md` once `amn` rows are live.
