// Pure analytics aggregation for the hub's Analytics view.
//
// Computes the HONEST subset of metrics from the current active ims_jobs
// snapshot + the append-only ls_events log. Ported from the IAS dashboard's
// analytics.ts (countBy / monthlySeries / trend / avgBy) but bound to IMS
// columns, which carry far less than the IAS Firebase records:
//
//   REAL (shipped):  active reqs, reqs opened / month + trend, active reqs by
//                    specialty (donut), top facilities by organization.
//   LABELED PROXY:   "avg days to close" = first archived event − first active
//                    event per assignment_id. A cancel ALSO archives an
//                    assignment, so this is days-to-close, NOT a true
//                    time-to-fill. Labeled as such in the UI.
//   NOT COMPUTED:    true fill rate / placements / submittal→offer — these need
//                    an LS Bids + Agreements feed we do not receive yet, so the
//                    UI shows "—" rather than a fabricated number.
//
// `now` is unix SECONDS (matching aggregateHub) so the 12-month window and the
// trend are deterministic + testable. All bucketing is UTC (Workers run UTC).

import type { HubJobRow, ActivityItem } from './hub-data';

/** Subset of ls_events columns this aggregation reads. status_after is derived
 *  at ingest (deriveStatus): 'active' for Receive/Update, 'archived' for
 *  Cancel/Archive/Close — so we key off it instead of guessing LS op strings. */
export interface HubEventRow {
  occurred_at: string | null;
  event_type: string | null;
  assignment_id: string | null;
  status_after: string | null;
  specialty_slug: string | null;
  specialty_name: string | null;
  facility_state: string | null;
  facility_city: string | null;
  organization: string | null;
}

export interface DonutSlice { name: string; val: number; color: string; }
export interface AnBar { name: string; val: number; fill: string; max: number; label?: string; }
export interface MonthPoint { key: string; label: string; opened: number; avgDaysToClose: number | null; }

export interface HubAnalytics {
  activeReqs: number;
  reqsOpened12mo: number;
  reqsTrend: { direction: 'up' | 'down' | 'neutral'; pct: number };
  monthly: MonthPoint[];
  specialtyDonut: DonutSlice[];
  topFacilities: AnBar[];
  daysToClose: { avg: number | null; sample: number };
  daysToCloseBySpecialty: AnBar[];
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FILLS = ['magenta', 'butter', 'rose', 'ink', 'cyan'];
// Donut palette (brand) for the top slices; the long tail collapses to "Other".
const DONUT_COLORS = ['#C44569', '#D88B9F', '#E8C465', '#0A0A0F', '#59BFE7'];
const OTHER_COLOR = '#B7A99A';
const DAY_MS = 86_400_000;
// A by-specialty average needs at least this many closed assignments before we
// surface it — one or two samples is noise, not a metric.
const MIN_SPEC_SAMPLE = 2;

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const specName = (slug: string | null, name: string | null) =>
  name ?? (slug ? titleCase(slug) : 'Other');

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}
function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** [name, count] descending, by an arbitrary key extractor. */
function countBy(rows: { k: string | null }[]): [string, number][] {
  const c = new Map<string, number>();
  for (const r of rows) {
    if (!r.k) continue;
    c.set(r.k, (c.get(r.k) ?? 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
}

/** 12-month skeleton (oldest → newest), ending at the month of `now`. */
function monthWindow(nowMs: number, count = 12): { key: string; label: string }[] {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const out: { key: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dd = new Date(Date.UTC(y, m - i, 1));
    out.push({ key: `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}`, label: MONTH_LABELS[dd.getUTCMonth()] });
  }
  return out;
}

interface Lifecycle { firstActive: number | null; firstArchived: number | null; specialty: string; }

/** Reduce the event log to one lifecycle record per assignment_id: the earliest
 *  active (open) timestamp and the earliest archived (close) timestamp. */
function lifecycles(events: HubEventRow[]): Map<string, Lifecycle> {
  const map = new Map<string, Lifecycle>();
  for (const e of events) {
    if (!e.assignment_id) continue;
    const ms = parseMs(e.occurred_at);
    if (ms === null) continue;
    let lc = map.get(e.assignment_id);
    if (!lc) {
      lc = { firstActive: null, firstArchived: null, specialty: specName(e.specialty_slug, e.specialty_name) };
      map.set(e.assignment_id, lc);
    }
    if (e.status_after === 'archived') {
      if (lc.firstArchived === null || ms < lc.firstArchived) lc.firstArchived = ms;
    } else if (e.status_after === 'active') {
      if (lc.firstActive === null || ms < lc.firstActive) lc.firstActive = ms;
    }
    // Keep the specialty from the first event that names one.
    if (lc.specialty === 'Other' && (e.specialty_name || e.specialty_slug)) {
      lc.specialty = specName(e.specialty_slug, e.specialty_name);
    }
  }
  return map;
}

function trendOf(series: number[], lookback = 3): { direction: 'up' | 'down' | 'neutral'; pct: number } {
  if (series.length < lookback * 2) return { direction: 'neutral', pct: 0 };
  const recent = series.slice(-lookback);
  const prev = series.slice(-lookback * 2, -lookback);
  const avg = (a: number[]) => a.reduce((s, n) => s + n, 0) / a.length;
  const ra = avg(recent);
  const pa = avg(prev);
  const pct = pa === 0 ? (ra === 0 ? 0 : 100) : Math.round(((ra - pa) / pa) * 100);
  return { direction: pct > 5 ? 'up' : pct < -5 ? 'down' : 'neutral', pct };
}

export function aggregateAnalytics(jobs: HubJobRow[], events: HubEventRow[], now: number): HubAnalytics {
  const nowMs = now * 1000;

  // ── Active-reqs snapshot metrics (from the current ims_jobs feed) ──────────
  const activeReqs = jobs.length;

  const specCounts = countBy(jobs.map((j) => ({ k: specName(j.specialty_slug, j.specialty_name) })));
  const top = specCounts.slice(0, 5);
  const tail = specCounts.slice(5);
  const specialtyDonut: DonutSlice[] = top.map(([name, val], i) => ({ name, val, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const tailTotal = tail.reduce((s, [, v]) => s + v, 0);
  if (tailTotal > 0) specialtyDonut.push({ name: 'Other', val: tailTotal, color: OTHER_COLOR });

  const facCounts = countBy(jobs.map((j) => ({ k: j.organization ?? j.public_facility_label ?? 'Facility' }))).slice(0, 5);
  const facMax = Math.max(1, ...facCounts.map(([, v]) => v));
  const topFacilities: AnBar[] = facCounts.map(([name, val], i) => ({ name, val, fill: FILLS[i % FILLS.length], max: facMax }));

  // ── Lifecycle metrics (from the append-only ls_events log) ────────────────
  const lc = lifecycles(events);
  const window = monthWindow(nowMs);
  const openedByMonth = new Map<string, number>();
  const closeDurByMonth = new Map<string, number[]>();
  const durations: number[] = [];
  const durBySpec = new Map<string, number[]>();

  for (const rec of lc.values()) {
    if (rec.firstActive !== null) {
      const k = monthKey(rec.firstActive);
      openedByMonth.set(k, (openedByMonth.get(k) ?? 0) + 1);
    }
    if (rec.firstActive !== null && rec.firstArchived !== null) {
      const deltaDays = Math.round((rec.firstArchived - rec.firstActive) / DAY_MS);
      if (deltaDays >= 0) {
        durations.push(deltaDays);
        const ck = monthKey(rec.firstArchived);
        const arr = closeDurByMonth.get(ck) ?? [];
        arr.push(deltaDays);
        closeDurByMonth.set(ck, arr);
        const sArr = durBySpec.get(rec.specialty) ?? [];
        sArr.push(deltaDays);
        durBySpec.set(rec.specialty, sArr);
      }
    }
  }

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : null);

  const monthly: MonthPoint[] = window.map(({ key, label }) => {
    const closes = closeDurByMonth.get(key);
    return { key, label, opened: openedByMonth.get(key) ?? 0, avgDaysToClose: closes && closes.length ? avg(closes) : null };
  });
  const reqsOpened12mo = monthly.reduce((s, m) => s + m.opened, 0);
  const reqsTrend = trendOf(monthly.map((m) => m.opened));

  const daysToClose = { avg: avg(durations), sample: durations.length };

  const specBars = [...durBySpec.entries()]
    .filter(([, arr]) => arr.length >= MIN_SPEC_SAMPLE)
    .map(([name, arr]) => ({ name, val: avg(arr) as number, sample: arr.length }))
    .sort((a, b) => b.val - a.val);
  const specMax = Math.max(1, ...specBars.map((r) => r.val));
  const daysToCloseBySpecialty: AnBar[] = specBars.map((r, i) => ({
    name: r.name,
    val: r.val,
    fill: FILLS[i % FILLS.length],
    max: specMax,
    label: `${r.val}d · n=${r.sample}`,
  }));

  return { activeReqs, reqsOpened12mo, reqsTrend, monthly, specialtyDonut, topFacilities, daysToClose, daysToCloseBySpecialty };
}

// ── Real activity feed (from the ls_events stream) ──────────────────────────────
// A truer feed than "latest modified jobs": it narrates the actual lifecycle
// events (new req / updated / cancelled / closed / bid passed) with honest verbs.
const ACTIVITY_COLORS = [
  'var(--pop-magenta,#C44569)',
  'var(--pop-rose)',
  'var(--pop-butter)',
  'var(--ink)',
  'var(--mn-cyan,#59BFE7)',
];
const escHtml = (s: string) =>
  s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string));
const initials = (name: string) => name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'LM';

function ageLabel(iso: string | null, nowMs: number): string {
  const t = parseMs(iso);
  if (t === null) return 'recently';
  const mins = Math.max(0, Math.floor((nowMs - t) / 60000));
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

/** Honest human verb for an event, from its operation + derived status. */
function eventVerb(e: HubEventRow): string {
  const op = (e.event_type ?? '').toLowerCase();
  if (e.status_after === 'archived' || op.includes('cancel') || op.includes('archive') || op.includes('close')) {
    if (op.includes('cancel')) return 'req cancelled';
    if (op.includes('close')) return 'req closed';
    return 'req archived';
  }
  if (op.includes('receive')) return 'new req';
  if (op.includes('update')) return 'req updated';
  if (op.includes('reject')) return 'bid passed';
  return e.event_type ? e.event_type.toLowerCase() : 'activity';
}

export function activityFromEvents(events: HubEventRow[], now: number, limit = 6): ActivityItem[] {
  const nowMs = now * 1000;
  const sorted = [...events].sort((a, b) => (parseMs(b.occurred_at) ?? 0) - (parseMs(a.occurred_at) ?? 0));
  return sorted.slice(0, limit).map((e, i) => {
    const name = specName(e.specialty_slug, e.specialty_name);
    const loc = [e.facility_city, e.facility_state].filter(Boolean).join(', ');
    return {
      who: initials(name),
      color: ACTIVITY_COLORS[i % ACTIVITY_COLORS.length],
      txt: `<b>${escHtml(name)}</b>${loc ? ' · ' + escHtml(loc) : ''} — ${escHtml(eventVerb(e))}`,
      time: ageLabel(e.occurred_at, nowMs),
    };
  });
}
