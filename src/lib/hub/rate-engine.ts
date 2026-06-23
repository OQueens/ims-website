// Rate Simulator façade — the hub's single import surface for the simulator.
//
// HISTORY: this file used to hold a static, curated 8-specialty table (a
// placeholder bill-rate model). It is now a thin re-export of `sim-adapter`,
// which is a faithful PORT of the IAS dashboard rate simulator onto the real,
// vendored engine (src/lib/rate-engine/). Every quote runs the SAME engine path
// the dashboard uses (initFactors / calculateRate / calculateCallRate), so the
// hub's numbers match the dashboard for the same factors. No rate math here.
//
// SimulatorView.astro, OverviewView.astro and hub-data.ts import from this
// façade only — they never reach into the vendored engine directly.
export {
  quoteFromControls,
  quoteFromFactors,
  factorsFromControls,
  simParseAssignment,
  simParseFreetext,
  defaultControls,
  simSpecialtyOptions,
  simShiftOptions,
  simUrgencyOptions,
  simRegionOptions,
  simSpecialtyKeyForSlug,
  shiftLabel,
  regionForState,
  DEFAULT_SIM_SPECIALTY,
  billLadder,
  billAtMargin,
  marginFromCustomBill,
} from './sim-adapter';

export type {
  SimControls,
  SimQuote,
  SimParseResult,
  SimOption,
  SimSpecialtyOption,
  SimRegionOption,
  WaterfallStep,
  BillLadderRow,
  BillMarginResult,
  CustomBillResult,
} from './sim-adapter';
