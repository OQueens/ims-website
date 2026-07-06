# Deep-Research Report — Improving the IMS Locum Rate Engine (my run, adversarially verified)

## Synthesis / verdict

Yes — the variance-weighted, MAD/median-robust posterior should drive the displayed quote, replacing the crude min/max/p70 band, but with two hard constraints the evidence makes explicit. (1) Robustness floor: with only 2-10 observations per cell, a robust CENTER is estimable at n>=3 (sample median) but a robust SPREAD/range needs n>=4 (Rousseeuw & Verboven 2002) — at n<=2 no robustness is possible, so any honest floor/ceiling for thin cells must come from partial pooling (shrinkage toward a specialty/BLS prior), not from the cell's own min/max. The CRH truth-discovery framework (Li et al., SIGMOD 2014) gives the exact label-free machinery the brief needs: it jointly estimates per-source reliability and the true value with no ground truth, down-weights a source exponentially by its deviation from consensus (directly defusing "one outlier brand sets the floor"), and its authors explicitly adopt normalized ABSOLUTE deviation (yielding the weighted MEDIAN) over squared loss precisely because it tolerates outliers — externally validating a variance-weighted, median-robust central estimate over a crude band. (2) The losing side is real and must be named to recruiters: shrinkage/inverse-variance posteriors win on AGGREGATE error (Efron's baseball case: ~72% total-squared-error reduction; Brown 2008: ~40-49% reduction) but OVER-SHRINK genuinely premium cells — in Efron's simulation the true-outlier component had nearly 2x the MLE error under James-Stein (2.04 vs 1.08) even though the total favored shrinkage. So a truly high-paying specialty/state can be pulled down toward the prior; this is the cost. For honest intervals on thin data, naive split-conformal is unreliable (realized coverage ~ Beta(k, n+1-k); at N_cal=100 ~46% of deployed predictors fall BELOW nominal 0.9), so use the Small Sample Beta Correction (SSBC) or FAB/borrowed-strength conformal, which keeps distribution-free coverage even under a misspecified prior (only intervals widen, coverage never breaks). Interval WIDTH should encode confidence (more observations -> narrower), which is the right recruiter-facing uncertainty display. NOTE: the confirmed claims cover Questions A (sparse aggregation) and D (honest uncertainty) thoroughly; they do NOT contain the Question-C domain benchmark numbers (bill-to-pay ratios, W2->1099 multipliers, per-specialty pay tables) or Question-B censored/win-loss calibration specifics — those survived as inference targets but not as verified external-number claims in this set.

## Verified findings

### 1. Verdict on the core architectural question: replace the crude min/max/p70 band with a variance-weighted, median/MAD-robust central estimate for the quote — but derive the displayed floor/ceiling from partial pooling (shrinkage toward a specialty/BLS prior), NOT from a thin cell's own min/max, because robustness is mathematically unavailable below n=4 for spread and n=3 for center.

**Confidence:** high  ·  **Vote:** synthesis of 3-0 claims [0],[1],[2],[15],[16],[17]

Rousseeuw & Verboven (2002) prove location is robustly estimable for n>=3 (sample median) but scale/spread requires n>=4; at n<=2 no robustness is possible. For n>=4 they recommend a logistic-psi M-estimator with MAD as auxiliary scale and median as auxiliary location — i.e. MAD/median underpin the robust estimate, not a raw min/max band. Independently, CRH (Li et al., SIGMOD 2014) jointly estimates truths + per-source reliability with NO labels and its authors explicitly ADOPT normalized absolute deviation (yielding the weighted MEDIAN) over squared loss 'to mitigate the effect of outliers,' validating a median-robust posterior over an outlier-sensitive band whose floor one bad source can set. The closed-form optimal CRH source weight is the negative-log of the source's total deviation from consensus, normalized across sources — giving a concrete label-free formula to down-weight an outlier scraped brand.

_Sources:_ https://www.sciencedirect.com/science/article/abs/pii/S0167947302000786 · https://cse.buffalo.edu/~jing/doc/sigmod14_crh.pdf

### 2. The losing side, named explicitly: a variance-weighted/shrinkage posterior wins on AGGREGATE accuracy but OVER-SHRINKS genuinely premium (high-end) cells toward the prior — so a truly top-paying specialty/state can be quoted too low. This is the concrete tradeoff to surface to reviewers.

**Confidence:** high  ·  **Vote:** 3-0 [5]; supported by [3],[4],[6]

In a 1000-run N=10 simulation (Efron, CASI Ch.1), James-Stein beat the MLE on 9 of 10 components but for the true outlier (mu_10=4.0) had NEARLY TWICE the MLE error (2.04 vs 1.08); only the TOTAL error favored JS (8.13 vs 10.12). The text states 'genuinely unusual cases ... can suffer' and 'shouldn't have been shrunk so drastically toward the mean.' This maps directly to a legitimately premium specialty/state cell being pulled down. The James-Stein estimator (theta_i = zbar + [1-(N-3)sigma0^2/S](zi-zbar)) estimates its shrinkage factor from the data itself, requiring no known prior — usable exactly when each cell has few noisy observations.

_Sources:_ https://utstat.toronto.edu/reid/sta2212s/2021/LSIChapter1.pdf

### 3. Shrinkage/empirical-Bayes delivers large accuracy gains in precisely the sparse, partially-pooled regime the rate engine faces — roughly halving squared prediction error versus the naive 'use the current observed average' predictor — but the gain is conditional on cross-cell HETEROGENEITY; in homogeneous subgroups, simply pooling toward the group mean is essentially as good.

**Confidence:** high  ·  **Vote:** 3-0 [4],[6],[7]

On 18 real baseball players (~45 noisy at-bats each, predicting ~370 future at-bats), James-Stein cut total squared prediction error to 0.28 of the MLE's — a ~72% reduction (Efron). Brown (2008, AOAS) field test: best method (nonparametric EB, normalized TSE 0.508; James-Stein 0.525) roughly halves squared error vs naive (1.000) and reduces ~40% vs the overall-average baseline. BUT in homogeneous subsets (pitchers), the group mean (0.127) and EB(ML) (0.117) BEAT elaborate nonparametric EB (0.212), and EB methods 'have comparable performance to the group mean itself' — so the value of sophisticated aggregation depends on heterogeneity across cells. Implication: partial-pool across related specialties/geographies, but expect smaller marginal gains within already-homogeneous clusters.

_Sources:_ https://utstat.toronto.edu/reid/sta2212s/2021/LSIChapter1.pdf · https://arxiv.org/pdf/0803.3697

### 4. Truth discovery (CRH / CATD / ETCIBoot lineage) is the directly-applicable, label-free method for Question A's 'source-reliability weighting without labels' under the IMS no-ground-truth constraint: it jointly estimates source reliability and the true value by giving larger weight to sources that more often agree with consensus, weighting each source inversely to its (squared) deviation from the current estimated truth.

**Confidence:** high  ·  **Vote:** 3-0 [11],[12],[15],[16]

Xiao et al. (IEEE TKDE 2019) and Li et al. (CATD, VLDB 2014): source reliability is unknown a priori and a source's weight is inversely proportional to its total (squared) deviation from estimated truth. CRH (SIGMOD 2014) formalizes this as minimizing weighted deviation between unknown truths and multi-source observations, alternating truth-update and weight-update to convergence, fully unsupervised; closed-form optimal weight = negative-log normalized deviation, exponentially penalizing sources consistently far from consensus. CAVEATS to flag in implementation (not refutations): truth discovery is known to be fragile under correlated/copying sources, adversarial data-poisoning, and very sparse cells — exactly the engine's 2-10 partly-adversarial obs regime — so it is a starting framework requiring corporate-family de-duplication, not turnkey.

_Sources:_ https://par.nsf.gov/servlets/purl/10101369 · https://cse.buffalo.edu/~jing/doc/sigmod14_crh.pdf

### 5. Confidence-interval estimation (not a point estimate) is the right honest-uncertainty design, and interval WIDTH should encode confidence: more observations per cell -> narrower interval, fewer -> wider. This is especially valuable on long-tail data where most objects (cells) get only a few claims from few sources — the exact 2-10-obs sparse regime.

**Confidence:** high  ·  **Vote:** 3-0 [13],[14]

Xiao et al. (IEEE TKDE 2019): 'instead of a point estimation, an estimated confidence interval of the truth is more desirable ... When an object receives more claims, a smaller confidence interval is obtained.' The paper defines long-tail data as 'most objects receive a few claims from a small number of sources' and states the CI advantage 'is more obvious on long-tail data' (real Flight dataset: 61.1% of objects get claims from <=5 of 38 sources). Recruiter-facing takeaway: tie displayed band width directly to observation count per cell, so a 2-obs cell visibly reads less confident than a 10-obs cell.

_Sources:_ https://par.nsf.gov/servlets/purl/10101369

### 6. Naive split-conformal prediction is UNRELIABLE on thin data: it guarantees only marginal (ensemble-averaged) coverage; the realized coverage of any single deployed predictor is a Beta(k, n+1-k) random variable that spreads wide for small calibration sets — at N_cal=100 targeting 0.9, about 46% of deployed predictors actually fall BELOW 0.9 coverage despite the marginal guarantee holding.

**Confidence:** high  ·  **Vote:** 3-0 [8],[9],[10],[18]

arXiv 2512.04566 and arXiv 2509.15349 (resting on Vovk 2012's training-conditional coverage result, in canonical Angelopoulos-Bates form): realized coverage C ~ Beta(m, N_cal-m+1), variance O(1/N_cal); for N_cal=100, ~46% of conformal predictors have coverage < 0.9 and ~10% < 0.86, while the mean (~0.901) satisfies the marginal guarantee. Numerically reproduced via Beta(91,10). Conclusion: do NOT trust off-the-shelf split-conformal intervals on per-cell calibration sets of size 2-10 (or even 100) without correction.

_Sources:_ https://arxiv.org/html/2512.04566v1 · https://arxiv.org/html/2509.15349v1

### 7. The fix for coverage-guaranteed intervals on thin data is the Small Sample Beta Correction (SSBC): a plug-and-play adjustment to the conformal significance level that guarantees, with user-defined probability 1-delta over the calibration draw, that the deployed predictor achieves at least the desired coverage — but a hard feasibility limit applies: you cannot simultaneously demand vanishing miscoverage and vanishing risk (threshold alpha*(n,delta)=1-delta^(1/n); feasible only if delta <= (n/(n+1))^n).

**Confidence:** high  ·  **Vote:** 3-0 [19],[20]

arXiv 2509.15349 (Zwart): SSBC leverages the exact finite-sample Beta distribution of conformal coverage to give a calibration-conditional (PAC-style) guarantee Pr(C(alpha_adj) >= 1-alpha_target) >= 1-delta, and is less conservative than DKWM (sample complexity O(1/alpha) vs O(alpha^-2)). The feasibility bound is an independently-verifiable math result (l=1 case Beta(n,1) tail = x^n). Practical meaning for IMS: on a cell with very few calibration points you must accept either wider nominal intervals or a weaker probabilistic guarantee — you cannot get tight intervals AND near-certain coverage from 2-10 points.

_Sources:_ https://arxiv.org/html/2509.15349v1

### 8. FAB (frequentist-assisted-by-Bayes) / borrowed-strength conformal prediction is the best fit for combining partial pooling WITH coverage on sparse cells: it incorporates indirect group-level/prior information via a Bayesian working model to borrow strength across small areas, yet keeps distribution-free frequentist coverage REGARDLESS of whether the prior is right — the only cost of a bad prior is wider intervals, never invalid coverage.

**Confidence:** high  ·  **Vote:** 3-0 [21],[22],[23]

Bersson & Hoff, 'Optimal Conformal Prediction for Small Areas' (arXiv 2204.08122; J. Survey Statistics & Methodology 12(5), 2024): the conformity measure is the posterior-predictive density of a working model that incorporates indirect information; the region has 'guaranteed frequentist coverage regardless of the working model, and, if the working model assumptions are accurate, the region has minimum expected volume.' So borrow strength toward a specialty/BLS prior (good for thin cells), get the tightest honest interval if the prior is accurate, and lose only width — not coverage — if it is wrong. BOUNDARY to flag: like all conformal methods this requires EXCHANGEABILITY of observations and gives MARGINAL (not conditional) coverage; it is robust to a misspecified PRIOR, not to non-exchangeable/adversarial source shifts.

_Sources:_ https://arxiv.org/pdf/2204.08122

