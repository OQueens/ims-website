# Deep-Research Prompt — Improving a Locum-Physician Rate-Pricing Engine

> **How to use this:** Paste everything below (from "ROLE" down) into ChatGPT Deep Research (or any web-research agent) as the task. It is self-contained. If the tool asks a clarifying question before starting, answer: *"Audience is our engineering + pricing team; depth is exhaustive and technical; deliver the prioritized recommendation report described at the end. Do not produce a generic template — research the specific numbered questions."* Optionally attach the companion file `rate-simulator-deep-research-brief.md` as supporting context, but this prompt stands alone.

---

## ROLE & OBJECTIVE

You are a quantitative pricing + applied-statistics researcher. Produce a **deep, web-sourced research report** that helps us improve the accuracy and self-improvement of a **locum tenens (temporary, 1099-contract) physician and CRNA rate-pricing engine**.

This is **not** a request to summarize the context below, and **not** a request for a generic research template. The context describes *our specific system and its hard constraints*; your job is to **research the numbered EXTERNAL questions** (statistical methods, market benchmarks, and best practices that exist in the literature and in industry) and return **concrete, cited, prioritized recommendations** mapped onto our constraints.

The single most important constraint: **we have no internal ground truth for what we actually paid clinicians.** We only know (a) market rates we scrape/observe, and (b) the bill rate we charge the client (which upper-bounds pay). So every recommendation must work in a **sparse-data, no-labeled-ground-truth** regime.

---

## SYSTEM CONTEXT (just enough to ground your recommendations)

**What it does.** Recruiters enter a specialty (one of ~164), a geography, a shift/urgency, and an engagement type (clinical worked-day, on-call/beeper, callback, per-diem). The engine returns a recommended **hourly pay rate** (and a derived **bill rate** = pay / (1 − margin)), a typical band, and a confidence label.

**How a number is produced today.** Each specialty has a static, expert-researched band `{min, max, p70}`. The quote anchors on `p70` and applies geographic, shift, duration, and urgency multipliers, with sanity clamps and a researched-max ceiling. A daily pipeline can *overlay* the static band with fresh market data.

**The data pipeline.** A fleet of scraper/researcher agents writes observed rate rows (with source URL + verbatim cited text) into a database (~56,600 rows). A nightly "bridge" job aggregates them and publishes two artifacts:
- A **legacy "crude band"**: a simple `min / max / p70` over the recent (<7 day) scraped rows for a specialty, gated to require ≥2 independent source families.
- A **"v2 posterior"**: a proper **variance-weighted aggregate** (median-absolute-deviation outlier rejection + inverse-variance weighting) per `(specialty, state, rate_type)` bucket, with a real confidence tier (multi-source / single-source / zero-spread / bimodal) and corporate-family collapse (so 6 brands of one parent agency count as one "voice," capped at 60% of a cell's weight).

**The core architectural problem (verified):** the displayed **quote is priced off the crude min/max band**, in which **a single low-confidence scraped estimate can set the floor of the displayed range**. The statistically sound v2 posterior **exists but is used only for a side display panel — it never drives the quote.** So the better estimator is computed and thrown away for pricing purposes.

**Self-learning is built but inert.** There is calibration code (it would nudge rates toward observed outcomes, dampened, clamped to ±15%) but the feedback store is **empty** — no mechanism captures recruiter outcomes (quoted vs. accepted rate), so the system does **not** learn from results today.

**Other facts.** Government/BLS permanent-wage rows are correctly excluded from the live band. Some specialties (e.g., CRNA) currently have no live locum-tagged data and sit on a static band. Audits found the static research bands largely accurate. Quote math is deterministic and identical across our two front-end apps.

**Definitions you'll need:** *locum tenens* = temporary 1099 contract clinician (paid differently than a permanent W2 employee). *Pay rate* = what we offer the clinician. *Bill rate* = what we charge the facility (pay/(1−margin); margin typically ~20–30%). *Specialty cell* = a `(specialty, state, engagement-type)` group, often with only a handful of observations.

---

## RESEARCH QUESTIONS (these are what you go find answers to on the web)

### A. Sparse, multi-source, partly-adversarial rate aggregation (statistics)
1. For collapsing **2–10 heterogeneous observations of unknown reliability** into a robust central estimate **and** an honest range, what are the state-of-practice estimators? Compare **inverse-variance weighting, MAD/Hampel outlier rejection, trimmed/winsorized/Huber M-estimators, and empirical-Bayes / hierarchical shrinkage toward a specialty or BLS prior.** Which performs best when *n* is tiny and source reliability is unknown? Give decision rules and cite.
2. How should a **displayed range floor and ceiling** be derived so that **one low-confidence outlier cannot set it** — while still surfacing real spread? (e.g., shrinkage quantiles, confidence-weighted percentiles, trimmed extrema, conformal lower/upper bounds.)
3. **Source-reliability weighting with no labeled ground truth:** survey truth-discovery / Dawid–Skene / EM-based reliability estimation and agreement-based weighting. Are these worth it at ~5–10 sources per cell? What's the simplest defensible version?
4. **Correlated-source de-duplication:** best practices to stop multiple brands of one parent company (or one article re-syndicated) from faking consensus. How do meta-analysis and review-aggregation systems handle non-independence?
5. **Small-sample shrinkage:** how to formally borrow strength across related specialties/geographies (hierarchical/partial pooling) so a thin cell isn't priced off 2 noisy points. James–Stein / multilevel models — practical recipes.

### B. Calibration & self-improvement with censored, biased, sparse feedback
6. We never see actual pay; we see the **bill we charged (an upper bound on pay)** and, potentially, **whether a quote was accepted (win/loss)**. How do pricing systems calibrate from **censored/bounded and win/loss signals**? Survival/Tobit/censored regression, win-rate (price-response) modeling, willingness-to-pay estimation.
7. **Outcome feedback where the quote influences the outcome** (selection bias / the quote changes whether it's accepted): contextual bandits, off-policy evaluation, Thompson sampling, and *safe* exploration in a B2B staffing setting. What is proven vs. risky? How to avoid runaway feedback loops?
8. **Drift detection + safe online updating** of a pricing model with only sparse weekly feedback. Guardrails, change-point detection, and how much to trust a small batch of new evidence.
9. **Conformal prediction (and alternatives)** for **coverage-guaranteed rate intervals** and trustworthy confidence labels on thin data. Is it usable when exchangeability is questionable (drifting market)?

### C. Domain benchmarks & external market data
10. Catalog the **public / semi-public benchmarks for locum (1099) physician and CRNA pay AND bill rates by specialty and state.** Cover LocumTenens.com, CHG (CompHealth/Weatherby/Global Medical), AMN, Barton, Vivian, Medscape and Doximity compensation reports, MGMA, AANA (CRNA), and BLS-OEWS. For each: what it reports, how reliable, how to access, and **typical bill-to-pay ratios / agency margins by specialty.**
11. How do **locum agencies and gig-labor marketplaces actually set or recommend pay rates**? Any documented methodologies, public rate cards, or transparency reports we can learn from.
12. Is a **W2-permanent → locum-1099 conversion multiplier of ~1.20–1.35×** defensible by specialty? Find external evidence for locum-vs-employed pay premiums.
13. Benchmarks for **on-call / beeper / callback / per-diem stipends** by specialty (we use GSA per-diem for travel; what governs *call comp*?).

### D. Validation & honest uncertainty display
14. How do you **validate a pricing model's accuracy without a labeled test set** — e.g., backtesting against later-observed market rates, holdout-source validation, agreement/coverage metrics, expert-in-the-loop evaluation? What do mature pricing teams actually do?
15. Best practices for **displaying rate confidence/uncertainty to non-statistical users** (recruiters) so the number is trusted but the uncertainty is honest (ranges, confidence chips, "thin data" flags).

---

## DELIVERABLE (what to return)

A structured, exhaustive report with:

1. **Executive summary** — the 5–7 highest-leverage moves, ranked by **expected accuracy impact ÷ implementation effort**, each one line.
2. **Per-question findings** — for each numbered question above, the state of the art with **inline citations** (papers, standards, documented systems, vendor pages). Distinguish established practice from your inference; flag weak/contested evidence.
3. **Recommendations table** — one row per concrete recommendation, columns: *Method (named precisely) · Why it fits our sparse / no-ground-truth setting · Expected effect · Implementation sketch · Risk & blast radius · Sources*.
4. **The "which estimator should drive the quote" verdict** — a direct, defended answer to our core architectural problem (should we replace the crude min/max with the variance-weighted posterior, add shrinkage, add conformal intervals, or something else?), with the tradeoffs and the losing side named.
5. **A self-calibration design** — a concrete proposal for how to capture feedback (given we only have bill + win/loss, not pay) and close the loop safely.
6. **A sourced benchmark appendix** — the Question-10 market-data catalog as a reference table.

Be skeptical of our current design **and** of your own proposals. Prefer specificity (which estimator, which transform, which guardrail, which data source) over generic principles. Cite real, checkable sources throughout.
