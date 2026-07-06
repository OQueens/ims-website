# Re-runnable Research Prompts

One `.md` per pillar. Each is a self-contained deep-research prompt a future session can paste into
a research harness (or dispatch to a research subagent) to **refresh** the matching brief in
`../briefs/`. Re-run when the fleet runs, when prod data changes, when a cited source's page moves,
or on a quarterly cadence.

**Shared guardrails (every prompt repeats these — do not drop):**
- **NORTH STAR:** recruiters price real placements off this simulator; it must be unbelievably
  accurate for EVERY locum specialty — the rate we would actually pay AND its market percentile.
  Gaps / missing comp factors / unquantified uncertainty are **defects**.
- **TOPOLOGY (Zach-confirmed 2026-07-02):** LIVE = `imstaffing.ai/hub` via **ias-website**
  (`src/lib/rate-engine` + `src/lib/hub`). The **bridge** (`ias-dashboard/scripts/data-refresh`) +
  **scraper** (`agent-sdk/agents/rate_scraper`) are the still-live data pipeline. The ias-dashboard
  *app* is dead — its `src/features/rate-simulator/` is a legacy copy (divergence risk only).
- **NEVER invent a $ figure.** Every rate is (a) READ from code (cite `file:line`) or (b) cited to a
  named external source. Otherwise write "UNVERIFIED — needs a source" and add it to
  `claims_to_verify`. Label OBSERVED vs ESTIMATED. This is a locum-tenens **1099** tool — never
  confuse with W2 salary.
- **Output discipline:** rewrite the matching `briefs/NN-slug.md` (Summary; Findings with cites;
  Recommendations tagged impact/effort; Open questions; `claims_to_verify`), and update
  `../BACKLOG.md` if recommendations changed.

| Prompt | Refreshes brief |
|---|---|
| `10-comp-core.md` | Core pay structure (hourly/daily/shift/wRVU/W2-1099/guarantees/OT) |
| `11-comp-call.md` | Call pay taxonomy |
| `12-comp-extras.md` | Stipends, gratis, malpractice, extras |
| `13-anti-manipulation.md` | Threat model & defenses |
| `14-accuracy-harness.md` | Continuous accuracy harness |
| `15-portability-core.md` | Headless `@ims/rate-engine` core |
| `16-portability-chat.md` | Discord/Slack adapters |
| `17-portability-embed.md` | ATS embed + hosted API/SDK |
| `18-competitors.md` | Competitor teardown |
| `19-data-sources.md` | Data-source expansion |
| `20-rate-hunt.md` | Curated cells vs cited comparators |
| `21-innovation.md` | Net-new moat |
| `22-specialty-coverage.md` | Full-specialty coverage |
| `23-internal-truth.md` | Internal actual-paid ground truth |
| `24-percentiles.md` | Percentiles & distributions |
| `25-market-timing.md` | Temporal dynamics |
| `26-geo-granularity.md` | Sub-state geo |
