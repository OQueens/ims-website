// Static curated rate engine for the hub Rate Simulator.
//
// Real market data ported from the IAS dashboard rate engine
// (src/features/rate-simulator/engine/specialties.ts + multipliers.ts). No DB,
// no fabrication: every base is a curated 2025–26 locum market estimate
// (sources per the IAS specialties.ts header — LocumStory 2025, OnCall Solutions
// 2024, TheLocumGuy, ResidencyAdvisor 2025, FastRVU 2026, cross-referenced).
//
// Surfaced ONLY in the auth-gated staff hub — the public site stays
// Rate-on-request. These are MODELED estimates (curated pay ranges × transparent
// multipliers), labeled as such in the simulator UI.
//
// Model (mirrors the IAS calculateRate inversion): the curated values are
// clinician PAY ranges. p70 = 70th-percentile pay. The simulator quotes a BILL
// rate, so each specialty's `billBase` grosses p70 pay up to a bill at the
// standard 20% agency margin (bill = pay / 0.80); the simulator then re-derives
// clinician pay from that bill at the user's chosen target margin.

export interface SimSpecialty {
  label: string;
  /** Curated clinician PAY range [min, max] $/hr. */
  pay: [number, number];
  /** 70th-percentile pay. */
  payP70: number;
  /** Bill-rate base = p70 pay grossed up at the standard 20% margin. */
  billBase: number;
}
export interface SimOption { label: string; mult: number; }

/** 70th percentile of a [min,max] range, rounded (IAS getPercentileRate @ 70). */
export const p70 = (min: number, max: number) => Math.round(min + (max - min) * 0.70);
/** Gross a pay rate up to a bill rate at a given agency margin (default 20%). */
export const billFromPay = (pay: number, margin = 0.20) => Math.round(pay / (1 - margin));

// Clinician PAY ranges ($/hr) for the specialties the simulator <select> exposes,
// copied verbatim from the IAS curated table (_SPECIALTIES_RAW). Labels match the
// existing simulator option text so the design is unchanged.
const PAY_RANGES: Array<{ label: string; pay: [number, number] }> = [
  { label: 'Anesthesiology · MD', pay: [300, 400] },
  { label: 'CRNA', pay: [190, 250] },
  { label: 'Emergency Medicine', pay: [200, 300] },
  { label: 'OB-GYN', pay: [160, 275] },
  { label: 'Hospitalist', pay: [145, 240] },
  { label: 'General Surgery', pay: [200, 310] },
  { label: 'Urology', pay: [220, 275] },
  { label: 'Radiology · Teleread', pay: [185, 290] },
];

export const SIM_SPECIALTIES: SimSpecialty[] = PAY_RANGES.map(({ label, pay }) => {
  const payP70 = p70(pay[0], pay[1]);
  return { label, pay, payP70, billBase: billFromPay(payP70) };
});

// Shift premiums — research-backed, from the IAS multipliers.ts SHIFT_MULT
// (day 1.00, night 1.20, weekend_day 1.15). "Swing" (evening) has no IAS analog;
// modeled between day and night.
export const SIM_SHIFTS: SimOption[] = [
  { label: 'Day', mult: 1.00 },
  { label: 'Swing', mult: 1.08 },
  { label: 'Nights', mult: 1.20 },
  { label: 'Weekend', mult: 1.15 },
];

// Urgency premiums — modeled (how fast the facility needs coverage). The IAS
// engine folds urgency into its duration factor (emergency/ASAP ≈ 1.20); the
// hub simulator keeps urgency as a separate, smaller-stepped control.
export const SIM_URGENCY: SimOption[] = [
  { label: 'Standard', mult: 1.00 },
  { label: 'Priority', mult: 1.06 },
  { label: 'Emergent', mult: 1.15 },
];

// Regional multipliers — modeled regional aggregates, kept within the IAS
// per-state model's clamp (stateData.ts STATE_MULT ∈ [0.88, 1.38]). The IAS
// engine prices geography per-state; the hub sim's coarser 5-region control uses
// these representative aggregates. Per-state granularity (porting stateData.ts)
// is a future enhancement when/if the sim adds a state selector.
export const SIM_REGIONS: SimOption[] = [
  { label: 'National', mult: 1.00 },
  { label: 'West', mult: 1.10 },
  { label: 'NE', mult: 1.05 },
  { label: 'SE', mult: 0.96 },
  { label: 'Midwest', mult: 0.98 },
];
