# IMS Rate Simulator — Synthesized Improvement Plan

_Authored by the engineering agent that builds the system, by merging **two independent deep-research passes** — a ChatGPT Deep Research run and an in-house adversarially-verified research harness (104 agents, 22 primary sources fetched, 100 claims extracted → 24 confirmed / 1 killed) — and grounding every recommendation in the actual IMS codebase._

> **How to read this:** Section 1 is the convergent verdict. Section 2 is the ranked action plan (each row says exactly what to change in code). Sections 3–6 detail the four workstreams. Section 7 is the honest "what we still don't know." The two raw reports live alongside this file (`rate-simulator-research-findings-RAW.md` = the verified harness output; the ChatGPT report you pasted) and the system context is in `rate-simulator-deep-research-brief.md`.

---

## 1. The convergent verdict

Both research passes, run independently, reached the **same conclusion**, which is strong corroboration:

**The crude `min/max/p70` band should lose. The quote should be driven by the variance-weighted, median/MAD-robust posterior the bridge already computes — but the displayed floor/ceiling for thin cells must come from shrinkage toward a prior, not from the cell's own extrema.**

Why this is not just opinion:
- **Raw extrema have a breakdown point of zero** — one contaminated observation moves the min or max arbitrarily. Medians and robust M-estimators are specifically built so a little contamination can't dominate. (Both reports; Rousseeuw & Verboven 2002.)
- **Robustness is mathematically unavailable in the thinnest cells.** A robust *center* needs n≥3 (the median); a robust *spread/range* needs n≥4 (Rousseeuw & Verboven 2002). At n≤2 there is no robust estimate at all — so a 2-observation cell's floor/ceiling **must** be borrowed from a prior, never read off its own two points. This is the single most important technical nuance and the crude band violates it directly.
- **The label-free machinery exists and is proven.** The CRH truth-discovery framework (Li et al., SIGMOD 2014) jointly estimates per-source reliability *and* the true value with **no ground truth**, down-weighting each source exponentially by its deviation from consensus (closed-form weight = negative-log of normalized total deviation). Its authors deliberately use *absolute* deviation (→ the weighted **median**) over squared loss precisely "to mitigate the effect of outliers." This is exactly the "one outlier brand sets the floor" defense, and it needs no labels — which matters because **we have no internal pay ground truth.**

Both reports also **independently failed to verify the Question-C benchmark numbers** (per-specialty locum bill-to-pay ratios, the W2→1099 multiplier). That convergence is itself a finding — see §6.

---

## 2. Ranked action plan (impact ÷ effort), mapped to code

| # | Move | What to change in the code | Expected effect | Risk / blast radius | Evidence |
|---|------|----------------------------|-----------------|---------------------|----------|
| 1 | **Promote the v2 posterior to the quote anchor** | Today `loadMarketRates()` (legacy) overlays `spec.min/max/p70` and `calculateRate()` prices off `p70`. Make the overlay read the **v2 posterior** (`loadMarketBuckets()` → `weighted_mean`/`median`) instead. Wire it in **both** apps: dashboard `App.tsx` and hub `src/lib/hub/sim-live.ts` (`initLiveMarket()` currently calls only `loadMarketRates`). Keep the legacy band computed for one cycle as a shadow/compare. | Removes the single-outlier-sets-the-floor failure on every cell that has a v2 bucket. Highest impact, already-built estimator, lowest new-code risk. | **Moves live quotes in BOTH apps** → re-baseline + show-before. Some specialties have no v2 bucket → fall back to static (current behavior). | Both reports (core verdict); Rousseeuw & Verboven 2002; CRH/Li 2014 |
| 2 | **Replace the displayed range with a robust/shrunken interval** | In the bridge (`aggregateBridge.ts`) or the consumer, stop publishing raw `min`/`max` as the displayed band. For healthy cells: family-collapsed weighted percentiles. For thin cells (n<4): a **posterior interval from shrinkage** (see #3). **Interval width must encode confidence** (more obs → narrower). | A 2-obs cell visibly reads *less* confident than a 10-obs cell; one bad source can no longer set the shown floor. | Intervals get *wider* on thin cells at first — feels less decisive, but is honest. | Harness findings 5–8 (Xiao et al. TKDE 2019; conformal Beta-law) |
| 3 | **Hierarchical shrinkage for thin cells** (the n<4 fix) | New step in `aggregateBridge.ts` after `aggregateCell`: when a bucket's `n_distinct < 4`, shrink its center toward a prior — the static researched band and/or a **parent-specialty / region pooled** estimate (specialty→group, state→region→national, engagement-type nested). James-Stein gives a data-driven shrinkage factor needing no known prior. | Large accuracy gain on sparse cells (~40–72% squared-error reduction in the cited field tests) — exactly IMS's regime. | More modeling + backtest needed. **Over-shrinks genuinely premium cells** — see the named losing side below (#3 detail). | Harness findings 1–3 (Efron CASI; Brown 2008 AOAS; Fay-Herriot SAE) |
| 4 | **Instrument recruiter outcomes — the real self-learning unlock** | The RTDB `rate-simulator/feedback` node is **empty**; `loadSpecialtyCalibration`/`computeDisplayedRate` already consume it but get nothing. Add capture in the hub UI + log one event row per quote (schema in §5). The dashboard's `FeedbackSection` is the pattern to port. | Unlocks *all* learning (calibration, win-propensity, backtesting). Without it no estimator choice can self-improve. **This is product/logging work, not modeling.** | Low technical risk; needs recruiter-workflow buy-in. | Both reports (instrument-first); ChatGPT B2B win-propensity |
| 5 | **Global source-family reliability prior** | `sourceReliability.ts` already computes per-source reliability but it's display-only (not weight-bearing). Make it weight-bearing in `collapseThenCap` — but learn reliability **globally** across the whole corpus (long-run agreement/stability), not per-cell. Keep the existing 60% family cap. | Down-weights chronically-deviant scraped brands everywhere; large robustness gain. | Could under-react to a source that *genuinely* changes quality if not refreshed. | Harness finding 4 (CRH/CATD); ChatGPT (global not per-cell) |
| 6 | **Three separated confidence chips** | `sim-render.ts` shows one composite confidence. Split into **Input confidence** (parser), **Market coverage** (data density / # source families), **Volatility** (interval width). | Recruiters can tell *why* a quote is uncertain → more trusted, more honest. | UI-only, low risk. | Both reports |
| 7 | **Conformal as a calibration *layer* (SSBC / FAB), not the primary interval** | If/when enough backtest history exists, recalibrate interval coverage with **Small-Sample Beta-Corrected** or **FAB borrowed-strength** conformal on recent residuals. Do **not** ship naive split-conformal on per-cell calibration sets. | Honest, coverage-checked intervals. | Naive conformal is *unreliable* on thin data (see §3 detail); only deploy the corrected variants. | Harness findings 6–8 (Vovk 2012; Zwart SSBC 2025; Bersson & Hoff 2024) |
| 8 | **Weekly drift detection + capped updates** | Add ADWIN/CUSUM-style monitors on three residual streams (source-rate distribution, quote residuals, acceptance residuals) with two-window confirmation + a max weekly move cap, around the bridge refresh. | Prevents a small noisy weekly batch from yanking the model; "detect first, adapt slowly." | Can lag a true shift if thresholds too conservative. | ChatGPT (concept-drift); harness (drift guards) |
| 9 | **Approval-gated bandit — last, dense cells only** | Only after #4 logs enough data: offline off-policy evaluation (IPS/doubly-robust) first; then a recruiter-approved small perturbation around the quote in high-volume cells only. **Never** autonomous exploration in thin cells. | Medium upside, but only when safe. | High governance need; selection-bias hazard. | ChatGPT (contextual bandits, OPE, human-gated) |

---

## 3. The core change in detail: promote the posterior, but bound the losing side

**Do this:** switch the engine overlay from the legacy crude band to the v2 posterior (action #1), and for cells with n<4, derive both the anchor and the interval by shrinking toward a specialty/region prior (action #3). The bridge already computes the posterior (`aggregateCell` → `market-rates-v2`); the work is to (a) make the engine *read* it for the quote, and (b) add the shrinkage step for thin cells.

**The losing side, named with numbers (this is the part to show before deploying).** Shrinkage wins on *aggregate* error but **systematically over-shrinks genuinely premium cells toward the prior** — a truly top-paying specialty/state can be quoted *too low*. Concretely, in Efron's 10-component simulation, James-Stein beat the MLE on 9 of 10 components but on the true outlier had **~2× the error** (2.04 vs 1.08); only the total favored shrinkage. Our own harness's adversarial verifier **killed** the over-broad claim that James-Stein "everywhere dominates" — it dominates *in total*, not per-cell. For a staffing business, the premium cells are exactly the high-margin placements you least want to under-quote.

**Mitigations (open design question #4 — decide before shipping #3):**
- **Confidence-gated blend:** use the shrunken posterior only when cell evidence is thin/low-confidence; as a cell accumulates ≥N independent families, blend back toward its own robust estimate.
- **Asymmetric / floor-preserving shrinkage:** shrink the *center* but don't let shrinkage pull the displayed *ceiling* below a high-confidence cited observation (mirrors the existing "never suppress a real cited datapoint" rule already in the engine).
- **Recruiter-override path** on flagged premium-but-thin cells.

**Why conformal isn't the primary fix:** naive split-conformal only guarantees *marginal* coverage; the realized coverage of a single deployed predictor is `Beta(k, n+1−k)` — at a 100-point calibration set targeting 90%, **~46% of deployed predictors actually fall below 90%.** On per-cell sets of 2–10 it's worse. Use it only as a *recalibration layer* via SSBC (PAC-style coverage guarantee) or FAB borrowed-strength conformal (keeps distribution-free coverage even if the prior is wrong — a bad prior only *widens* intervals, never breaks coverage). And note the hard limit: from 2–10 points you **cannot** have both tight intervals *and* near-certain coverage — pick one.

---

## 4. Self-calibration design (given only bill + win/loss, no pay truth)

Both reports agree: **log first, model second.** The minimum viable event row, one per quote:

`quote_id · timestamp · specialty · state · engagement_type · anchor_shown · interval_shown · confidence_chips · recruiter_override(Δ) · quoted_pay · quoted_bill · margin_assumption · outcome(accepted/rejected/no_response) · days_to_outcome · final_booked_bill · client_attrs`

That single stream powers three loops:
1. **Win-propensity model** — logistic / mixed-logit P(accept | quote, context) by segment; tune the quote toward a target win-rate / margin frontier. *(ChatGPT; an inference target — not yet externally number-verified.)*
2. **Upper-censored latent-pay model** — Tobit / interval-censored regression using the **bill rate as a hard upper bound** on feasible pay (never as ground-truth pay). *(ChatGPT; inference target.)*
3. **Backtest loop** — do later-observed market rates land inside the interval we showed? (coverage check) + override-rate monitoring.

**Honesty flag:** my verified harness confirmed the *statistics* of A and D rigorously, but the **censored/win-loss calibration specifics in (1)–(2) did not survive as verified external claims** — they're sound inference targets from the ChatGPT pass, not yet cited-and-verified. Treat them as a design to prototype + validate, not settled method. (This is open question #2 — a good target for a focused follow-up research pass.)

**Code touch-points:** the calibration consumers already exist (`computeDisplayedRate`, `loadSpecialtyCalibration`, `applyCalibration` with its dampened ±15% clamp). They're inert only because nothing writes feedback. So #4 is mostly: a hub capture UI + the RTDB write + the event schema above.

---

## 5. The corporate-family / correlated-source guard (do this *before* trusting reliability weights)

Truth-discovery (CRH/CATD) is known to be **fragile under copying/correlated sources** — exactly our "one parent agency, many brands; one article re-syndicated" problem. So the existing family collapse + 60% cap in `aggregateBridge.ts` is directionally right and must come **before** any reliability weighting, extended with: near-duplicate text signatures, URL canonicalization, repeated-table fingerprints, and parent-domain clustering → each cluster contributes one influence-limited voice. (Open question #3.) This session's just-staged non-locum filter is a small instance of the same principle (keep a known-non-locum class out of the locum band).

---

## 6. The benchmark-data reality (both passes agree — and it validates the current strategy)

**Neither** research pass could verify per-specialty locum **pay/bill numbers** or a **W2→1099 multiplier** from public sources. This is not a failure of the research — it's the finding:

- **The numbers are genuinely proprietary.** Locum bill-to-pay decompositions live in agency contracts and private databases, not public data. ChatGPT explicitly *declined to bless* the 1.20–1.35× multiplier "for lack of public evidence"; my harness's adversarial verifier refused to let any fabricated benchmark number through.
- **Therefore: do not hardcode a universal W2→1099 multiplier.** Let permanent-pay sources (BLS-OEWS median physicians ≥ $239,200/yr; CRNA group $132,050/yr — 2024) inform **priors/covariates only**, and let *direct locum signals* determine the live uplift per cell. Encoding one global multiplier "will be wrong in both directions."
- **This is exactly why IMS's observe-and-cite fleet + bill-extraction strategy is the right architecture.** Since the data isn't public, scraping cited locum observations and extracting the LocumSmart **bill rate** (the one internal upper bound you have) is the *only* path to ground these numbers. Prioritize the bill-extraction wiring (Phase 5 in your roadmap) — it's the highest-value internal signal and both reports point at it.
- **Source tiers for the pipeline:** *Live signal* = agency postings, marketplace listings, cited rate tables, LocumSmart bill extracts (→ quote, after dedup/family-collapse/robustness). *Priors only* = BLS-OEWS, Medscape, Doximity, MGMA, AANA (permanent comp; specialty ordering + sanity bounds + geo features; **never** the live anchor). *Manual-review only* = private surveys, consultant rate cards.

---

## 7. What's still open (a focused follow-up would close these)

1. **Question C — real benchmark numbers.** Needs a dedicated sourcing pass (likely paid/gated reports, FOIA-able government locum contracts, or partner data) — not answerable from open web, as two passes confirmed.
2. **Question B — censored/win-loss calibration method.** The win-propensity + Tobit design is sound but unverified; prototype against logged data once #4 lands.
3. **Correlated-source de-dup step** to harden truth-discovery (§5).
4. **Over-shrinkage bounding** for premium cells (§3 mitigations) — pick one before shipping shrinkage.

---

## 8. Staged rollout (with success tests)

| Phase | Window | Work | Success test |
|---|---|---|---|
| **Immediate** | 2–4 wks | v2 posterior behind a flag for the quote anchor (#1); split confidence chips (#6); **start logging quote events** (#4) | deterministic golden-master parity unaffected; sane shadow quotes vs legacy; logging completeness >95% |
| **Near** | 1–2 mo | robust/shrunken displayed interval (#2); global source-family reliability prior (#5); de-dup hardening | lower outlier sensitivity on holdout-source tests; better interval coverage on later-seen market |
| **Medium** | 1–2 qtr | hierarchical shrinkage (#3) with over-shrink mitigation; censored/win-propensity prototype; drift monitors (#8); SSBC/FAB interval calibration (#7) | better backtest error in sparse cells; stable updates under drift; coverage holds |
| **Later** | data-gated | offline OPE → approval-gated bandit, dense cells only (#9); bill-extraction wired for benchmark grounding (§6) | positive offline value estimate; bounded live experiment risk |

**Validation without labels (both reports):** triangulate — temporal backtest vs later-observed market, holdout-source validation (drop one source family, re-predict), interval-coverage checks, override-rate monitoring, expert review only on high-impact + high-uncertainty cells. Don't pretend a labeled test set exists.

---

## 9. Sources

**Verified harness (primary, adversarially checked):** Rousseeuw & Verboven 2002 (CSDA, robust estimation small samples); Efron CASI Ch.1 (James-Stein, baseball); Brown 2008 (AOAS, EB field test); Li et al. SIGMOD 2014 (CRH truth discovery); Li et al. VLDB 2014 (CATD); Xiao et al. IEEE TKDE 2019 (confidence-aware truth discovery); Bersson & Hoff 2024 (JSSAM, FAB small-area conformal); Zwart 2025 (SSBC); Vovk 2012 / Angelopoulos-Bates (conformal coverage Beta-law). Full claim-by-claim evidence + URLs in `rate-simulator-research-findings-RAW.md`.

**ChatGPT Deep Research pass:** robust-statistics, truth-discovery, small-area estimation, censored-regression/win-propensity, contextual-bandit/OPE, concept-drift, conformal, and the benchmark-source classification (BLS OOH 2024; Medscape/Doximity/MGMA characterization). Full text in the report you pasted.

**System context:** `rate-simulator-deep-research-brief.md` (the 277K engineering brief).
