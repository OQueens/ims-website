// Pure aggregation of the real ims_jobs feed into the Overview/Simulator
// shapes the dashboard renders. No fabricated pay (always "Rate on request").
// `now` is unix seconds (passed in to keep this deterministic + testable).
import { SIM_SPECIALTIES } from './rate-engine';

export interface HubJobRow {
  specialty_slug: string;
  specialty_name: string | null;
  facility_state: string | null;
  facility_city: string | null;
  public_facility_label: string | null;
  // organization = the health-system / client (staff-hub-only; never on /jobs).
  // Used by hub-analytics topFacilities. organization_id is the stable key.
  organization: string | null;
  organization_id: string | null;
  length_category: string | null;
  call_type: string | null;
  coverage_type: string | null;
  ls_last_modified: string | null;
}
export interface BarRow { name: string; val: number; fill: string; }
export interface LatestJob { code: string; color: string; spec: string; city: string; pay: string; age: string; specVal: string; }
export interface ActivityItem { who: string; color: string; txt: string; time: string; }
export interface HubOverview {
  activeReqs: number;
  facilityCount: number;
  pipelineStates: BarRow[];
  pipelineSpecs: BarRow[];
  latestJobs: LatestJob[];
  activity: ActivityItem[];
}

const FILLS = ['magenta', 'butter', 'rose', 'ink', 'cyan'];
const COLORS = [
  'var(--pop-magenta,#C44569)',
  'var(--pop-butter)',
  'var(--pop-rose)',
  'var(--ink)',
  'var(--mn-cyan,#59BFE7)',
];
// Maps an ims_jobs specialty slug to the simulator's bill-base <option> value
// (from the rate engine) so a "latest job" click loads a matching specialty.
// Derived from SIM_SPECIALTIES so it can never drift from the simulator options;
// slugs with no curated sim specialty fall back to the first option.
const SIM_BY_LABEL: Record<string, number> = Object.fromEntries(SIM_SPECIALTIES.map((s) => [s.label, s.billBase]));
const DEFAULT_SIM_BASE = String(SIM_SPECIALTIES[0]?.billBase ?? 0);
const SLUG_TO_SIM_LABEL: Record<string, string> = {
  anesthesiology: 'Anesthesiology · MD',
  anesthesia: 'Anesthesiology · MD',
  crna: 'CRNA',
  'emergency-medicine': 'Emergency Medicine',
  emergency: 'Emergency Medicine',
  'ob-gyn': 'OB-GYN',
  obgyn: 'OB-GYN',
  hospitalist: 'Hospitalist',
  'general-surgery': 'General Surgery',
  surgery: 'General Surgery',
  radiology: 'Radiology · Teleread',
};
const simBaseForSlug = (slug: string): string => {
  const label = SLUG_TO_SIM_LABEL[slug];
  const base = label ? SIM_BY_LABEL[label] : undefined;
  return base !== undefined ? String(base) : DEFAULT_SIM_BASE;
};

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Escape DB-derived text before it goes into the activity HTML snippet (rendered
// with set:html). Defense-in-depth: the public ims_jobs fields are recruiter-
// curated, but never trust DB content in an HTML sink.
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string));

function topGroups(rows: HubJobRow[], key: (r: HubJobRow) => string | null, limit: number): BarRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, val], i) => ({ name, val, fill: FILLS[i % FILLS.length] }));
}

function age(fromIso: string | null, now: number): string {
  if (!fromIso) return '';
  const then = Date.parse(fromIso);
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.floor((now * 1000 - then) / 60000));
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

export function aggregateHub(rows: HubJobRow[], now: number): HubOverview {
  const sorted = [...rows].sort(
    (a, b) => (Date.parse(b.ls_last_modified ?? '') || 0) - (Date.parse(a.ls_last_modified ?? '') || 0),
  );
  const facilities = new Set(rows.map((r) => r.public_facility_label).filter(Boolean) as string[]);
  const specName = (r: HubJobRow) => r.specialty_name ?? (r.specialty_slug ? titleCase(r.specialty_slug) : null);
  const initials = (name: string) => name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'LM';

  const latestJobs: LatestJob[] = sorted.slice(0, 5).map((r, i) => {
    const name = specName(r) ?? 'Locum role';
    const city = [r.facility_city, r.facility_state].filter(Boolean).join(', ') || (r.public_facility_label ?? 'Nationwide');
    return {
      code: initials(name),
      color: COLORS[i % COLORS.length],
      spec: name,
      city,
      pay: 'Rate on request',
      age: age(r.ls_last_modified, now),
      specVal: simBaseForSlug(r.specialty_slug),
    };
  });

  const activity: ActivityItem[] = sorted.slice(0, 6).map((r, i) => {
    const name = specName(r) ?? 'Locum role';
    const loc = [r.facility_city, r.facility_state].filter(Boolean).join(', ') || (r.public_facility_label ?? '');
    const a = age(r.ls_last_modified, now);
    return {
      who: initials(name),
      color: COLORS[i % COLORS.length],
      txt: `<b>${esc(name)}</b>${loc ? ' · ' + esc(loc) : ''}`,
      time: a ? a + ' ago' : 'recently',
    };
  });

  return {
    activeReqs: rows.length,
    facilityCount: facilities.size,
    pipelineStates: topGroups(rows, (r) => r.facility_state, 5),
    pipelineSpecs: topGroups(rows, (r) => specName(r), 5),
    latestJobs,
    activity,
  };
}
