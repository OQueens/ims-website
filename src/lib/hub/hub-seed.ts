// Hub seed — STARTER content for the user-owned, editable surfaces only.
// Every METRIC in the hub is real (Overview + Analytics read ims_jobs +
// ls_events; the simulator uses the curated rate engine). What remains here is
// editable starter text the user replaces, not fabricated metrics:
//   • PRIORITIES — the Overview "This week's priorities" checklist (starter).
//   • PDF_CHIPS  — labels shown by the simulator's PDF-dropzone prototype.
// (The Weekly Sync board no longer has a seed — a brand-new week starts BLANK;
//  see src/lib/hub/sync-data.ts.) Gated behind hub auth. No fabricated numbers.

export interface BarRow { name: string; val: number; fill: string; max?: number; label?: string; }
export interface Priority { txt: string; tag: 'high' | 'med' | 'low'; done: boolean; }

export const PRIORITIES: Priority[] = [
  { txt: 'Close Austin anesthesia, 3 candidates pending', tag: 'high', done: false },
  { txt: 'Escalate Boise hospitalist (open 26 days)', tag: 'high', done: false },
  { txt: 'Confirm Sara P. travel + housing', tag: 'med', done: true },
  { txt: 'Send Charlotte facility the updated MSA', tag: 'med', done: false },
  { txt: 'Refresh rate cards for Q3', tag: 'low', done: false },
  { txt: 'Follow up: Durham OB-GYN reference checks', tag: 'med', done: false },
];

export const PDF_CHIPS = ['Specialty · Anesthesiology', 'Region · Southeast', 'Shift · Nights', 'Length · 13 weeks'];
