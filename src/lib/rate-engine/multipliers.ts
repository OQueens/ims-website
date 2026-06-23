// ⚠ VENDORED — DO NOT EDIT. Canonical source: ias-dashboard (OQueens/oqueens-ias-dashboard) src/features/rate-simulator/engine/.
// Re-sync with: node scripts/sync-rate-engine.mjs. Drift is gated by src/lib/hub/rate-engine-parity.test.ts.
// ============================================================
// multipliers.ts — Shift, Facility, and Duration multiplier tables
// Extracted from rate-simulator/index.html
// Research-backed multipliers (2025-2026 market data)
// ============================================================

import type { ShiftMultEntry, FacilityMultEntry, DurationMultEntry } from './types';

// Night: +10-25% (nocturnist hospitalists $179-200 vs $140-160 day = ~20%)
// Weekend: +10-20% (CompHealth/Weatherby); Holiday: effective ~25-35% premium
export const SHIFT_MULT: Record<string, ShiftMultEntry> = {
  day:          { mult: 1.00, label: 'Day' },
  night:        { mult: 1.20, label: 'Night' },
  weekend_day:  { mult: 1.15, label: 'Wknd Day' },
  weekend_night:{ mult: 1.30, label: 'Wknd Night' },
  holiday:      { mult: 1.35, label: 'Holiday' },
};

// Academic: -10-20% vs community (prestige offset); VA: -10-30% vs private
// CAH: +15-30% (rural designation, hard to staff); Rural Trauma: +20-40%
export const FACILITY_MULT: Record<string, FacilityMultEntry> = {
  academic:       { mult: 0.85, label: 'Academic' },
  community:      { mult: 1.00, label: 'Community' },
  asc:            { mult: 0.90, label: 'Surgery Center' },
  outpatient:     { mult: 0.90, label: 'Outpatient Clinic' },
  cah:            { mult: 1.22, label: 'Critical Access' },
  va:             { mult: 0.85, label: 'VA/Govt' },
  correctional:   { mult: 0.92, label: 'Correctional' },
  fqhc:           { mult: 0.88, label: 'FQHC' },
  psych:          { mult: 1.12, label: 'Psych/Behavioral' },
  rural_trauma:   { mult: 1.30, label: 'Rural Trauma' },
  freestanding_ed:{ mult: 1.08, label: 'Freestanding ED' },
  telehealth:     { mult: 0.75, label: 'Telehealth' },
};

// Emergency/ASAP: significant premium; Long-term: slight discount for stability
export const DURATION_MULT: Record<string, DurationMultEntry> = {
  emergency: { mult: 1.20, label: 'Emergency' },
  short:     { mult: 1.10, label: 'Short (1-4wk)' },
  standard:  { mult: 1.00, label: 'Standard (4-8wk)' },
  long:      { mult: 0.95, label: 'Long (3mo+)' },
};
