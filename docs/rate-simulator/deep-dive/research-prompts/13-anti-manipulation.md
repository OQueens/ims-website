# Research Prompt — Anti-Manipulation Threat Model (refreshes brief 13)

> Follow the shared guardrails in `README.md`. Refreshes `../briefs/13-anti-manipulation.md`.

## Scope
Every way the LIVE quote could be manipulated/drifted/poisoned — planted sources, template
inflation, aggregator fake-independence, W2-proxy leak, stale/echo data, single-source promotion,
selection bias, agency self-inflation, RTDB forge, feedback poisoning, bimodal masking, geo,
batch-abort denial-of-accuracy, registry divergence — each mapped 1:1 to the REAL guard (cite
file:line) + the residual gap + a concrete hardening.

## Code anchors to re-verify
- `src/lib/rate-engine/marketRates.ts:469-551` (anchor gate), `:419-422` (anchorable set), `:448-456` (confidence ceiling — `advertised_clinician_pay` reads 'high'!)
- `ias-dashboard/database.rules.json:26-47` (`market-rates-v2` write:false; **`feedback` write:true**) + `__tests__/database.rules.rate-simulator.test.ts`
- `agent-sdk/core/supabase_client.py:23-26,82` (service-role bypass; all-or-nothing batch)
- `agent-sdk/agents/rate_scraper/dedup.py:121-147` (family recovery), `sourceFamily.ts:105-121` (never-anchor)
- `aggregateBridge.ts:527-599` (family collapse-then-cap), `cellAggregation.ts:195-263` (bimodal→null)

## External / live questions to refresh
1. **RTDB deployed-rules export** — confirm `rate-simulator/*` is public-read + bridge-only-write
   (the open S5 check). This is the actual trust boundary.
2. Has any `advertised_clinician_pay`-only cell ever anchored (the F-B severity gate)?
3. Advertised-vs-paid discount evidence (needed to anchor advertised at a haircut, not face value).
4. When the posting fleet runs, does `hiring_org` reliably populate for aggregator boards (the
   family-recovery defense is unexercised)?
5. Buy-side (LocumSmart `rateRequirements`) counterweight to sell-side selection bias.

## Known claims to re-check
ZipRecruiter CRNA $124.86 ≈ half real (production observation); the 12 residual gaps ranked; the
2 write credentials as the boundary; `feedback` world-writable; single-statement batch = all-or-nothing.

## Deliverable
Rewrite brief 13 + update BACKLOG rows for credential vault, feedback lock, split advertised/paid,
template-inflation n fix, reader sanity cross-check, cliff alarm, family registry, never-anchor
class, chunked insert, high-variance anchor bar, key-set test, provenance trust score.
