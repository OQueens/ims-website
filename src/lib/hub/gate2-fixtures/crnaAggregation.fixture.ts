// === Synthetic hand-classified fixture for ALGORITHMS.md §1.6 evaluation ===
// PLAN B.7.1 Task 6 acceptance: "sample 50 historical cells, hand-classify obvious
// outliers. Algorithm should reject ≥80% of those, retain ≥95% of legitimate."
//
// Codex r1 S2 fold (2026-05-08): real-historical 50-cell validation is
// **DEFERRED to B.7.1.1** because Task 5 ingested 46 BLS-only rows (single
// source per state with no observation-level outlier signal) and the IAS
// empirical pillar — which would supply per-cell multi-observation distributions
// for outlier hand-classification — is deferred to B.7.1.1 per
// TASK_2_DEVIATION (IAS RTDB has no actual paid CRNA rates; producer-side
// instrumentation needed before historical sampling becomes possible).
//
// Until B.7.1.1 lands, this file is a SYNTHETIC stand-in exercising the same
// evaluation criteria at smaller scale: 10 cells totalling 57 observations,
// with 9 hand-marked as obvious outliers (ratios 4×+ or sub-floor). The
// criterion of ≥80% rejection / ≥95% retention is upheld on synthetic data;
// the spec-mandated 50-cell historical replacement is tracked as a B.7.1.1
// follow-on requirement.
//
// Each cell observation carries `_isOutlier` (test-only metadata, stripped before
// passing to aggregateCell). Obvious-outlier definition: rate_mid ≥ 4× cell median
// OR ≤ 0.25× cell median. Borderline (2-3× away) NOT marked outlier.

import type { Observation } from '../../rate-engine/crnaAggregation'

export interface HandClassifiedObservation extends Observation {
  /** True iff a domain-knowledge reviewer would call this a clear outlier
   *  (≥4× away from cell median; not marginal). The aggregateCell algorithm
   *  is expected to reject ≥80% of these and retain ≥95% of non-outliers. */
  _isOutlier: boolean
}

export interface HandClassifiedCell {
  cell_id: string
  observations: HandClassifiedObservation[]
}

const obs = (
  cell_id: string,
  source_id: string,
  rate_mid: number,
  isOutlier: boolean,
  source_variance: number | null = null,
): HandClassifiedObservation => ({
  cell_id,
  source_id,
  rate_low: rate_mid * 0.92,
  rate_high: rate_mid * 1.08,
  rate_mid,
  observed_at: 1730000000000,
  source_variance,
  evidence_weight: 1,
  _isOutlier: isOutlier,
})

// Cell 1: TX locum_w2 around $200/hr — 5 legit + 1 extreme high
const cell1: HandClassifiedCell = {
  cell_id: 'crna|TX|locum_w2',
  observations: [
    obs('crna|TX|locum_w2', 'aana_2025', 195, false),
    obs('crna|TX|locum_w2', 'ias_internal_2026', 205, false),
    obs('crna|TX|locum_w2', 'marithealth_2026', 210, false),
    obs('crna|TX|locum_w2', 'ziprecruiter_2026', 198, false),
    obs('crna|TX|locum_w2', 'oncall_2025', 202, false),
    obs('crna|TX|locum_w2', 'spam_seo_blog', 999, true),
  ],
}

// Cell 2: CA locum_w2 around $230/hr — 4 legit + 1 below-floor outlier
const cell2: HandClassifiedCell = {
  cell_id: 'crna|CA|locum_w2',
  observations: [
    obs('crna|CA|locum_w2', 'aana_2025', 228, false),
    obs('crna|CA|locum_w2', 'ias_internal_2026', 235, false),
    obs('crna|CA|locum_w2', 'marithealth_2026', 232, false),
    obs('crna|CA|locum_w2', 'ziprecruiter_2026', 225, false),
    obs('crna|CA|locum_w2', 'broken_scrape', 35, true),
  ],
}

// Cell 3: NY locum_1099 around $250/hr — 6 legit, no outliers
const cell3: HandClassifiedCell = {
  cell_id: 'crna|NY|locum_1099',
  observations: [
    obs('crna|NY|locum_1099', 'aana_2025', 248, false),
    obs('crna|NY|locum_1099', 'ias_internal_2026', 252, false),
    obs('crna|NY|locum_1099', 'marithealth_2026', 250, false),
    obs('crna|NY|locum_1099', 'ziprecruiter_2026', 245, false),
    obs('crna|NY|locum_1099', 'oncall_2025', 255, false),
    obs('crna|NY|locum_1099', 'aanalocum_blog', 251, false),
  ],
}

// Cell 4: FL locum_w2 around $185/hr — 4 legit + 2 outliers (high + low)
const cell4: HandClassifiedCell = {
  cell_id: 'crna|FL|locum_w2',
  observations: [
    obs('crna|FL|locum_w2', 'aana_2025', 180, false),
    obs('crna|FL|locum_w2', 'ias_internal_2026', 190, false),
    obs('crna|FL|locum_w2', 'marithealth_2026', 188, false),
    obs('crna|FL|locum_w2', 'ziprecruiter_2026', 184, false),
    obs('crna|FL|locum_w2', 'spam_seo_high', 850, true),
    obs('crna|FL|locum_w2', 'spam_seo_low', 25, true),
  ],
}

// Cell 5: WA locum_w2 around $220/hr — 5 legit, no outliers
const cell5: HandClassifiedCell = {
  cell_id: 'crna|WA|locum_w2',
  observations: [
    obs('crna|WA|locum_w2', 'aana_2025', 218, false),
    obs('crna|WA|locum_w2', 'ias_internal_2026', 222, false),
    obs('crna|WA|locum_w2', 'marithealth_2026', 220, false),
    obs('crna|WA|locum_w2', 'ziprecruiter_2026', 215, false),
    obs('crna|WA|locum_w2', 'oncall_2025', 225, false),
  ],
}

// Cell 6: MA locum_w2 around $240/hr (UHC exempt; high baseline) — 5 legit + 1 high outlier
const cell6: HandClassifiedCell = {
  cell_id: 'crna|MA|locum_w2',
  observations: [
    obs('crna|MA|locum_w2', 'aana_2025', 238, false),
    obs('crna|MA|locum_w2', 'ias_internal_2026', 245, false),
    obs('crna|MA|locum_w2', 'marithealth_2026', 240, false),
    obs('crna|MA|locum_w2', 'ziprecruiter_2026', 235, false),
    obs('crna|MA|locum_w2', 'oncall_2025', 242, false),
    obs('crna|MA|locum_w2', 'spam_seo_extreme', 1500, true),
  ],
}

// Cell 7: WY locum_w2 around $170/hr (rural; small market) — 4 legit, no outliers
const cell7: HandClassifiedCell = {
  cell_id: 'crna|WY|locum_w2',
  observations: [
    obs('crna|WY|locum_w2', 'aana_2025', 168, false),
    obs('crna|WY|locum_w2', 'ias_internal_2026', 172, false),
    obs('crna|WY|locum_w2', 'marithealth_2026', 175, false),
    obs('crna|WY|locum_w2', 'ziprecruiter_2026', 165, false),
  ],
}

// Cell 8: AZ locum_1099 around $235/hr — 5 legit + 1 sub-floor outlier
const cell8: HandClassifiedCell = {
  cell_id: 'crna|AZ|locum_1099',
  observations: [
    obs('crna|AZ|locum_1099', 'aana_2025', 232, false),
    obs('crna|AZ|locum_1099', 'ias_internal_2026', 238, false),
    obs('crna|AZ|locum_1099', 'marithealth_2026', 235, false),
    obs('crna|AZ|locum_1099', 'ziprecruiter_2026', 230, false),
    obs('crna|AZ|locum_1099', 'oncall_2025', 240, false),
    obs('crna|AZ|locum_1099', 'broken_scrape', 18, true),
  ],
}

// Cell 9: CO locum_w2 around $215/hr — 5 legit + 1 high + 1 low outlier
const cell9: HandClassifiedCell = {
  cell_id: 'crna|CO|locum_w2',
  observations: [
    obs('crna|CO|locum_w2', 'aana_2025', 212, false),
    obs('crna|CO|locum_w2', 'ias_internal_2026', 218, false),
    obs('crna|CO|locum_w2', 'marithealth_2026', 215, false),
    obs('crna|CO|locum_w2', 'ziprecruiter_2026', 220, false),
    obs('crna|CO|locum_w2', 'oncall_2025', 213, false),
    obs('crna|CO|locum_w2', 'spam_seo_extreme', 1250, true),
    obs('crna|CO|locum_w2', 'broken_low', 30, true),
  ],
}

// Cell 10: IL locum_1099 around $225/hr — 5 locum-magnitude rows + 1 high outlier.
// Note: v4 architecture does NOT mix BLS rows (W2 magnitude) into the same cell —
// BLS is the denominator/spine. So this fixture keeps all observations in one
// magnitude (locum-multiplied or comparable) per Task 7's `rowsToObservations`
// shape. Source-variance weighting is exercised in a dedicated unit test, not here.
const cell10: HandClassifiedCell = {
  cell_id: 'crna|IL|locum_1099',
  observations: [
    obs('crna|IL|locum_1099', 'ias_internal_2026', 230, false),
    obs('crna|IL|locum_1099', 'marithealth_2026', 225, false),
    obs('crna|IL|locum_1099', 'ziprecruiter_2026', 222, false),
    obs('crna|IL|locum_1099', 'oncall_2025', 228, false),
    obs('crna|IL|locum_1099', 'aanalocum_blog', 226, false),
    obs('crna|IL|locum_1099', 'spam_seo_extreme', 1100, true),
  ],
}

export const HAND_CLASSIFIED_CELLS: HandClassifiedCell[] = [
  cell1, cell2, cell3, cell4, cell5, cell6, cell7, cell8, cell9, cell10,
]

/** Strip test-only metadata so the fixture can be passed straight to aggregateCell. */
export function toObservation(o: HandClassifiedObservation): Observation {
  const { _isOutlier: _, ...rest } = o
  return rest
}
