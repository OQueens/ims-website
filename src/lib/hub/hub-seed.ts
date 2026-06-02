// ⚠️ TEMPORARY PORTING STARTING POINT — NOT verified production data.
// Faithful typed transcription of design_handoff_hub/src/hub-data.js. These
// seed values render the dashboard sections that have no real Supabase source
// yet (Analytics, Costs, Rate-Simulator base rates, Weekly-Sync seed). They are
// gated behind hub auth and exist so we can port real data section-by-section.
// Do NOT treat these numbers as live IMS metrics.

export interface BarRow { name: string; val: number; fill: string; max?: number; label?: string; }
export interface FeedItem { who: string; color: string; txt: string; time: string; txtColor?: string; }
export interface Priority { txt: string; tag: 'high' | 'med' | 'low'; done: boolean; }
export interface DonutSlice { name: string; val: number; color: string; }
export interface LatestJobSeed { code: string; color: string; spec: string; city: string; pay: string; age: string; specVal: string; }
export interface CostRow { name: string; av: string; color: string; reqs: number; placements: number; share: number; spend: string; }
export interface SyncSeed { recruiting: string[]; marketing: string[]; operations: string[]; }

export const PIPELINE_STATES: BarRow[] = [
  { name: 'North Carolina', val: 9, fill: 'magenta' },
  { name: 'Texas', val: 7, fill: 'butter' },
  { name: 'California', val: 6, fill: 'rose' },
  { name: 'Montana', val: 4, fill: 'ink' },
  { name: 'Oregon', val: 3, fill: 'magenta' },
];

export const PIPELINE_SPECS: BarRow[] = [
  { name: 'Anesthesia', val: 11, fill: 'magenta' },
  { name: 'Emergency', val: 8, fill: 'rose' },
  { name: 'CRNA', val: 7, fill: 'butter' },
  { name: 'Hospitalist', val: 6, fill: 'ink' },
  { name: 'Surgery', val: 5, fill: 'magenta' },
];

export const ACTIVITY: FeedItem[] = [
  { who: 'DR', color: 'var(--pop-magenta,#C44569)', txt: '<b>Dr. Sara P.</b> accepted the offer for <b>CRNA · Charlotte, NC</b>', time: '12m' },
  { who: 'JM', color: 'var(--pop-rose)', txt: 'New req opened, <b>Emergency Med · Asheville, NC</b> (2 spots)', time: '1h' },
  { who: 'KR', color: 'var(--pop-butter)', txtColor: '#0A0A0F', txt: '<b>Kelly R.</b> submitted 3 candidates to <b>Austin, TX Anesthesia</b>', time: '3h' },
  { who: 'SP', color: 'var(--ink)', txt: 'Credentialing cleared for <b>Dr. James K.</b>, start confirmed', time: '5h' },
  { who: 'DR', color: 'var(--pop-magenta,#C44569)', txt: 'Rate approved on <b>Lexington, KY Surgery</b> at <b>$340/hr</b>', time: 'Yesterday' },
  { who: 'JM', color: 'var(--pop-rose)', txt: '<b>Helena, MT Emergency</b> extended 8 weeks', time: 'Yesterday' },
];

export const PRIORITIES: Priority[] = [
  { txt: 'Close Austin anesthesia, 3 candidates pending', tag: 'high', done: false },
  { txt: 'Escalate Boise hospitalist (open 26 days)', tag: 'high', done: false },
  { txt: 'Confirm Sara P. travel + housing', tag: 'med', done: true },
  { txt: 'Send Charlotte facility the updated MSA', tag: 'med', done: false },
  { txt: 'Refresh rate cards for Q3', tag: 'low', done: false },
  { txt: 'Follow up: Durham OB-GYN reference checks', tag: 'med', done: false },
];

export const LINE_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
export const LINE_PLACEMENTS = [12, 14, 13, 16, 15, 18, 17, 19, 21, 20, 23, 25];
export const LINE_FILL_DAYS = [24, 23, 22, 22, 21, 20, 21, 19, 19, 18, 18, 17];

export const DONUT: DonutSlice[] = [
  { name: 'Anesthesia / CRNA', val: 34, color: '#C44569' },
  { name: 'Emergency Med', val: 22, color: '#D88B9F' },
  { name: 'Hospitalist', val: 18, color: '#E8C465' },
  { name: 'Surgery', val: 14, color: '#0A0A0F' },
  { name: 'Other', val: 12, color: '#59BFE7' },
];

export const FILLTIME: BarRow[] = [
  { name: 'CRNA', val: 12, fill: 'cyan', max: 30 },
  { name: 'Emergency', val: 16, fill: 'magenta', max: 30 },
  { name: 'Anesthesia', val: 18, fill: 'rose', max: 30 },
  { name: 'Hospitalist', val: 21, fill: 'butter', max: 30 },
  { name: 'Surgery', val: 26, fill: 'ink', max: 30 },
];

export const FACILITIES: BarRow[] = [
  { name: 'Mercy Regional', val: 14, fill: 'magenta', max: 14 },
  { name: "St. Luke's", val: 11, fill: 'rose', max: 14 },
  { name: 'Cascade Health', val: 9, fill: 'butter', max: 14 },
  { name: 'Blue Ridge Med', val: 7, fill: 'ink', max: 14 },
  { name: 'Lone Star Surg.', val: 5, fill: 'magenta', max: 14 },
];

export const COST_ROWS: CostRow[] = [
  { name: 'Kelly R.', av: 'KR', color: 'var(--pop-magenta,#C44569)', reqs: 18, placements: 9, share: 31, spend: '$14,960' },
  { name: 'Jordan M.', av: 'JM', color: 'var(--pop-rose)', reqs: 16, placements: 7, share: 26, spend: '$12,540' },
  { name: 'Sam P.', av: 'SP', color: 'var(--ink)', reqs: 14, placements: 6, share: 23, spend: '$11,090' },
  { name: 'Dana R.', av: 'DR', color: 'var(--pop-butter)', reqs: 13, placements: 4, share: 20, spend: '$9,650' },
];

export const COST_CATS: BarRow[] = [
  { name: 'Job boards / ads', val: 42, fill: 'magenta', max: 100, label: '$20.3k' },
  { name: 'Credentialing', val: 24, fill: 'rose', max: 100, label: '$11.6k' },
  { name: 'Tooling / SaaS', val: 13, fill: 'butter', max: 100, label: '$6.4k' },
  { name: 'Travel / housing', val: 15, fill: 'cyan', max: 100, label: '$7.2k' },
  { name: 'Misc', val: 6, fill: 'ink', max: 100, label: '$2.7k' },
];

export const COST_TOOLS: FeedItem[] = [
  { who: 'LS', color: 'var(--pop-magenta,#C44569)', txt: '<b>LocumSmart</b>, req + candidate ATS', time: '$2,400/mo' },
  { who: 'VC', color: 'var(--pop-rose)', txt: '<b>VerifyCred</b>, primary-source credentialing', time: '$1,600/mo' },
  { who: 'RC', color: 'var(--pop-butter)', txtColor: '#0A0A0F', txt: '<b>RateCast</b>, market rate data feed', time: '$1,200/mo' },
  { who: 'TW', color: 'var(--ink)', txt: '<b>TravelWise</b>, clinician travel + housing', time: '$1,200/mo' },
];

// Rate simulator: latest 5 jobs fallback (used only when the real ims_jobs feed
// is empty). The live dashboard renders real jobs from aggregateHub().
export const LATEST_JOBS: LatestJobSeed[] = [
  { code: 'EM', color: 'var(--pop-rose)', spec: 'Emergency Med', city: 'Asheville, NC', pay: '$275–310', age: '1h', specVal: '300' },
  { code: 'EM', color: 'var(--pop-magenta,#C44569)', spec: 'Emergency Med', city: 'Helena, MT', pay: '$290–340', age: '3h', specVal: '300' },
  { code: 'CR', color: 'var(--pop-butter)', spec: 'CRNA', city: 'Charlotte, NC', pay: '$235–255', age: '5h', specVal: '240' },
  { code: 'UR', color: 'var(--mn-cyan,#59BFE7)', spec: 'Urology', city: 'Bend, OR', pay: '$300–340', age: '1d', specVal: '315' },
  { code: 'OB', color: 'var(--pop-rose)', spec: 'OB-GYN', city: 'Durham, NC', pay: '$250–280', age: '1d', specVal: '250' },
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
