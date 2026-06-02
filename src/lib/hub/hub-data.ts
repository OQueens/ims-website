// Pure aggregation of the real ims_jobs feed into the Overview/Simulator
// shapes the dashboard renders. No fabricated pay (always "Rate on request").
// `now` is unix seconds (passed in to keep this deterministic + testable).
export interface HubJobRow {
  specialty_slug: string;
  specialty_name: string | null;
  facility_state: string | null;
  facility_city: string | null;
  public_facility_label: string | null;
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
// Maps a specialty slug to the simulator's base-rate <option> value so a
// "latest job" click loads a matching specialty. Default 260 when unknown.
const SPEC_VAL: Record<string, string> = {
  anesthesia: '260',
  crna: '240',
  'emergency-medicine': '300',
  emergency: '300',
  'ob-gyn': '250',
  obgyn: '250',
  hospitalist: '245',
  'general-surgery': '335',
  surgery: '335',
  urology: '315',
  radiology: '230',
};

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
      specVal: SPEC_VAL[r.specialty_slug] ?? '260',
    };
  });

  const activity: ActivityItem[] = sorted.slice(0, 6).map((r, i) => {
    const name = specName(r) ?? 'Locum role';
    const loc = [r.facility_city, r.facility_state].filter(Boolean).join(', ') || (r.public_facility_label ?? '');
    const a = age(r.ls_last_modified, now);
    return {
      who: initials(name),
      color: COLORS[i % COLORS.length],
      txt: `<b>${name}</b>${loc ? ' · ' + loc : ''}`,
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
