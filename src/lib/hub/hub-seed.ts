// Hub seed — STARTER content for the two user-owned, editable surfaces only.
// Every METRIC in the hub is now real (Overview + Analytics read ims_jobs +
// ls_events; the simulator uses the curated rate engine). What remains here is
// editable starter text the user replaces, not fabricated metrics:
//   • PRIORITIES — the Overview "This week's priorities" checklist (starter).
//   • SYNC_SEED  — the Weekly Sync board's first-load template.
//   • PDF_CHIPS  — labels shown by the simulator's PDF-dropzone prototype.
// Gated behind hub auth. Do NOT add fabricated numbers here.

export interface BarRow { name: string; val: number; fill: string; max?: number; label?: string; }
export interface Priority { txt: string; tag: 'high' | 'med' | 'low'; done: boolean; }
export interface SyncSeed { recruiting: string[]; marketing: string[]; operations: string[]; }

export const PRIORITIES: Priority[] = [
  { txt: 'Close Austin anesthesia, 3 candidates pending', tag: 'high', done: false },
  { txt: 'Escalate Boise hospitalist (open 26 days)', tag: 'high', done: false },
  { txt: 'Confirm Sara P. travel + housing', tag: 'med', done: true },
  { txt: 'Send Charlotte facility the updated MSA', tag: 'med', done: false },
  { txt: 'Refresh rate cards for Q3', tag: 'low', done: false },
  { txt: 'Follow up: Durham OB-GYN reference checks', tag: 'med', done: false },
];

export const PDF_CHIPS = ['Specialty · Anesthesiology', 'Region · Southeast', 'Shift · Nights', 'Length · 13 weeks'];

export const SYNC_SEED: SyncSeed = {
  recruiting: [
    'Close Austin anesthesiology, 3 candidates pending',
    'Source 2 CRNAs for the Charlotte expansion',
    'Re-engage lapsed hospitalist pipeline',
    'Escalate Boise req, open 26 days',
  ],
  marketing: [
    'Ship the new clinician landing page',
    'Film 2 facility testimonial clips',
    'Lock June email + social calendar',
    'Refresh job-board creative for nights roles',
  ],
  operations: [
    'Clear credentialing backlog, 4 files',
    'Finalize + publish Q3 rate cards',
    'Roll out TravelWise housing flow',
    'Reconcile May agent spend',
  ],
};
