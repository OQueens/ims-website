# Rate-Sim Improvement — Next-Session Kickoff

## ▶ Paste this into the new session

> Start the rate-sim improvement program. FIRST read `docs/rate-simulator-IMPROVEMENT-PLAN.md` in full and the "RATE-SIM IMPROVEMENT PROGRAM" START HERE entry in memory (`project_ims_rate_sim_improvement_program_2026-06-30.md`). Then execute **Move #1 — promote the v2 variance-weighted posterior to the quote anchor — as STAGED code with a before/after, no deploy.** Build it in the canonical dashboard engine, regenerate the golden master, sync to the hub, run the full suites, get a code-reviewer pass, and produce a before/after table showing exactly which specialty/state quotes change and by how much. Then STOP and show me the before/after — do not commit, sync to prod, or deploy without my explicit go (this changes live quotes in BOTH apps). Cut no corners; leave no stone unturned; state assumptions; no fabricated data.

## What the first session does (the precise first slice — Move #1)

**Goal:** make the displayed quote price off the v2 posterior (the variance-weighted, MAD/median-robust `aggregateCell` output the bridge already writes to `market-rates-v2`) instead of the crude legacy `min/max/p70` band — the single highest-impact accuracy fix, and the one both research passes converged on.

**Exact technical scope:**
1. **Engine overlay rewire** (canonical `ias-dashboard/src/features/rate-simulator/engine/marketRates.ts`): when a specialty has a *renderable primary* v2 bucket (`loadMarketBuckets` → D-39 precedence, fresh, ≥ quorum), overlay `spec.p70` (and a robust `min`/`max` derived from the posterior interval) from the posterior's central estimate (`weighted_mean`/`median`) rather than from the crude band. Preserve the existing fall-back ladder: v2 primary → (decide: crude legacy or straight to) static curated band. **Decision to make explicitly and surface:** for a specialty with NO renderable v2 bucket, fall back to the *static curated band* (cleaner) vs. keep the *crude legacy overlay* (status quo). Recommend static; show the blast-radius both ways.
2. **Wire both apps:** dashboard `App.tsx` init + hub `src/lib/hub/sim-live.ts` `initLiveMarket()` (today calls only `loadMarketRates`; add the posterior path). Keep `index.phase2` barrel discipline (firebase stays in the lazy hub chunk).
3. **Golden master + parity:** regenerate `goldenMaster.json` (`scripts/rate-engine/gen-golden-master.ts`); the diff IS the before/after evidence. Sync to hub (`node scripts/sync-rate-engine.mjs`); run dashboard rate-sim suite + hub parity/gate2 + full hub suite — all green.
4. **The before/after table (the deliverable to show Zach):** for every specialty × a representative state set, compute the OLD quote (crude overlay) vs the NEW quote (posterior overlay); list which moved, by how much, direction, and whether the move is toward the cited-audit-accurate band. Flag any specialty that moves > ~10%.

## Hard guardrails (no corners)

- **SHOW-BEFORE, no deploy.** Move #1 changes live quotes in BOTH the dashboard and the hub. Staged + before/after only; wait for explicit deploy-go (canonical → golden-master → sync → cherry-pick is the deploy path, but NOT this session).
- **n<4 thin cells:** the posterior the bridge already emits carries confidence tiers; if a thin cell's posterior is itself fragile, prefer the static prior over a 2-3-point estimate (robustness is unavailable below n=4). Full hierarchical shrinkage is **Move #3** — note where it'll plug in, don't build it yet.
- **The named losing side:** watch the before/after for any *premium* specialty/state quoted *lower* under the posterior (over-shrink risk). If it appears, surface it — that's the tradeoff to decide with a mitigation (confidence-gated blend / floor-preserving), not to ship silently.
- **No fabricated benchmark numbers.** We have no internal pay truth and the public per-specialty locum numbers are unverifiable; validate moves against the cited-audit bands and the live data, never an invented figure.
- **TDD + reviewer loop:** tests-first for the overlay logic; Codex (`codex exec` stdin-diff works; sandbox shell doesn't) or feature-dev:code-reviewer before claiming done.
- **D-39 / D-33 respect:** don't fork backends; don't touch the `aggregateCell` pure function; the change is in the *reader/overlay*, not the bridge math.

## Definition of done for session 1

Staged code (canonical + synced hub) · golden master regenerated · all suites green · reviewer-clean · a before/after quote table across specialties · the fall-back decision surfaced · the over-shrink scan done · **nothing committed/deployed** · Zach shown the before/after.

## In parallel / next

- **Move #4 (instrument recruiter feedback)** — scope it: a hub capture UI + the event-row schema (plan §4) writing to the empty RTDB `rate-simulator/feedback`; port the dashboard `FeedbackSection`. Safe, additive, no quote drift; it's the unlock for all self-calibration. Can be built independently of #1.
- **Loose end:** the staged non-locum bridge guard ([[project_ims_bridge_locum_filter_2026-06-29]]) is uncommitted + needs a fleet RTDB re-run — fold it into #1's bridge work or commit + route the re-run, on Zach's go.
