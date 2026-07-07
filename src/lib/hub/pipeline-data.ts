// Pure helpers for the Recruitment & Credentialing pipeline (hub_pipeline_people
// table). No I/O — the endpoint (/hub/api/pipeline) and the client both validate
// through here. Row-per-person: recruitment is ONE `stage`; credentialing is 6
// independent boolean flags that run in parallel. Sanitize-on-read/write posture
// mirrors Weekly Sync (sync-data.ts). No fabrication: absent → honest defaults.
import { escapeText, MAX_EMAIL_LEN } from './sync-data';

export { escapeText };

// Recruitment track. 'placed' is the terminal working lane; 'archived' is
// off-board (lost/inactive). BOARD_STAGES are the visible lanes, left→right.
export const BOARD_STAGES = ['warm_lead', 'active_bid', 'accepted_bid', 'needs_onboarding', 'placed'] as const;
export const STAGES = [...BOARD_STAGES, 'archived'] as const;
export type BoardStage = (typeof BOARD_STAGES)[number];
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  warm_lead: 'Warm Leads', active_bid: 'Active Bids', accepted_bid: 'Accepted Bids',
  needs_onboarding: 'Needs Onboarding', placed: 'Placed / Working', archived: 'Archived',
};

// Credentialing track — 6 independent multi-select statuses, DB column = 'chk_'+key.
export const CHECKLIST_KEYS = [
  'collecting_docs', 'needs_contract', 'start_dates_booked',
  'credentialing_started', 'credentialing_complete', 'provider_working',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  collecting_docs: 'Collecting Documents', needs_contract: 'Needs Contract',
  start_dates_booked: 'Start Dates Booked', credentialing_started: 'Credentialing Started',
  credentialing_complete: 'Credentialing Complete', provider_working: 'Provider Working',
};
export const chkCol = (k: ChecklistKey) => ('chk_' + k) as `chk_${ChecklistKey}`;

// Curated, correctly-cased locum specialty display names for the add-provider
// typeahead (a <datalist> — suggestions only; the field stays free-text so an
// unlisted specialty can still be typed). Deduplicated from the canonical rate
// lookup set; owned here so casing (CRNA, OB/GYN, ENT) is display-correct.
export const SPECIALTY_SUGGESTIONS: readonly string[] = [
  'Addiction Psychiatry', 'Allergy/Immunology', 'Anesthesiologist Assistant', 'Anesthesiology',
  'Cardiac Anesthesiology', 'Cardiology', 'Cardiothoracic Surgery', 'Child & Adolescent Psychiatry',
  'Colorectal Surgery', 'Correctional Medicine', 'CRNA', 'Critical Care / Intensivist',
  'Dermatology', 'Electrophysiology', 'Emergency Medicine', 'Endocrinology', 'ENT / Otolaryngology',
  'Family Medicine', 'Forensic Psychiatry', 'Gastroenterology', 'General Surgery', 'Geriatric Medicine',
  'Geriatric Psychiatry', 'Gynecologic Oncology', 'Hand Surgery', 'Hematology/Oncology', 'Hospice / Palliative Care',
  'Hospitalist', 'Infectious Disease', 'Internal Medicine', 'Interventional Cardiology', 'Interventional Radiology',
  'Maternal-Fetal Medicine', 'Medical Oncology', 'Neonatology', 'Nephrology', 'Neurology', 'Neuroradiology',
  'Neurosurgery', 'Nurse Practitioner', 'OB/GYN', 'Occupational Medicine', 'Ophthalmology', 'Orthopedic Surgery',
  'Pain Management', 'Pathology', 'Pediatric Hospitalist', 'Pediatrics', 'Physical Medicine & Rehabilitation',
  'Physician Assistant', 'Plastic Surgery', 'Podiatry', 'Psychiatry', 'Pulmonology', 'Radiology (Diagnostic)',
  'Rheumatology', 'Trauma Surgery', 'Urology', 'Vascular Surgery', 'Wound Care',
];

// Specialty → clinical DISCIPLINE → fixed color. Color encodes the broad field so ~11
// legible hues cover all 60 specialties + free text; unknown → neutral 'Other' (honest,
// no forced grouping). The same discipline is one color everywhere on the board.
export type Discipline =
  | 'Surgery' | 'Emergency & Critical Care' | 'Cardiology' | 'Medicine' | 'Neurology'
  | 'Anesthesia' | 'Psychiatry & Behavioral' | 'Radiology & Pathology' | "Women's Health"
  | 'Pediatrics' | 'Advanced Practice' | 'Other';

export const DISCIPLINE_COLORS: Record<Discipline, string> = {
  'Surgery': '#F26A5B', 'Emergency & Critical Care': '#F2A03D', 'Cardiology': '#E85D7A',
  'Medicine': '#3FB3E0', 'Neurology': '#7C84E8', 'Anesthesia': '#2FB9AE',
  'Psychiatry & Behavioral': '#A06CD8', 'Radiology & Pathology': '#5B8DD6',
  "Women's Health": '#D4569E', 'Pediatrics': '#3DBE85', 'Advanced Practice': '#B5C24B',
  'Other': '#8A93A0',
};

const DISCIPLINE_SPECIALTIES: Record<Exclude<Discipline, 'Other'>, readonly string[]> = {
  'Surgery': ['Cardiothoracic Surgery', 'Colorectal Surgery', 'ENT / Otolaryngology', 'General Surgery', 'Hand Surgery', 'Neurosurgery', 'Ophthalmology', 'Orthopedic Surgery', 'Plastic Surgery', 'Podiatry', 'Trauma Surgery', 'Urology', 'Vascular Surgery'],
  'Emergency & Critical Care': ['Emergency Medicine', 'Critical Care / Intensivist'],
  'Cardiology': ['Cardiology', 'Electrophysiology', 'Interventional Cardiology'],
  'Medicine': ['Internal Medicine', 'Family Medicine', 'Hospitalist', 'Geriatric Medicine', 'Correctional Medicine', 'Occupational Medicine', 'Hospice / Palliative Care', 'Wound Care', 'Allergy/Immunology', 'Dermatology', 'Endocrinology', 'Gastroenterology', 'Infectious Disease', 'Nephrology', 'Pulmonology', 'Rheumatology', 'Physical Medicine & Rehabilitation', 'Hematology/Oncology', 'Medical Oncology'],
  'Neurology': ['Neurology'],
  'Anesthesia': ['Anesthesiology', 'Cardiac Anesthesiology', 'Anesthesiologist Assistant', 'CRNA', 'Pain Management'],
  'Psychiatry & Behavioral': ['Psychiatry', 'Addiction Psychiatry', 'Child & Adolescent Psychiatry', 'Forensic Psychiatry', 'Geriatric Psychiatry'],
  'Radiology & Pathology': ['Radiology (Diagnostic)', 'Interventional Radiology', 'Neuroradiology', 'Pathology'],
  "Women's Health": ['OB/GYN', 'Maternal-Fetal Medicine', 'Gynecologic Oncology'],
  'Pediatrics': ['Pediatrics', 'Pediatric Hospitalist', 'Neonatology'],
  'Advanced Practice': ['Nurse Practitioner', 'Physician Assistant'],
};

const DISCIPLINE_OF: Record<string, Discipline> = (() => {
  const map: Record<string, Discipline> = {};
  for (const disc of Object.keys(DISCIPLINE_SPECIALTIES) as Array<Exclude<Discipline, 'Other'>>)
    for (const name of DISCIPLINE_SPECIALTIES[disc]) map[name.toLowerCase()] = disc;
  return map;
})();

/** The clinical discipline for a specialty display name (case-insensitive, trimmed).
 *  Unknown / null / free-text → 'Other'. Never throws. */
export function disciplineForSpecialty(name: string | null | undefined): Discipline {
  if (!name) return 'Other';
  return DISCIPLINE_OF[name.trim().toLowerCase()] ?? 'Other';
}

/** The fixed board color (#rrggbb) for a specialty's discipline. */
export function disciplineColorFor(name: string | null | undefined): string {
  return DISCIPLINE_COLORS[disciplineForSpecialty(name)];
}

// Field caps so a malformed/hostile POST can't bloat a row.
export const MAX_NAME_LEN = 120;
export const MAX_SPECIALTY_LEN = 80;
export const MAX_STATE_LEN = 40;
export const MAX_PHONE_LEN = 40;
export const MAX_NOTES_LEN = 2000;
export const MAX_LABEL_LEN = 160;
export { MAX_EMAIL_LEN };

export interface ChecklistAuditEntry { by: string; at: number; }
export interface PipelinePerson {
  id: string;
  stage: Stage;
  full_name: string;
  specialty_slug: string | null;
  specialty_name: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  owner_email: string | null;
  target_start_date: string | null;
  assignment_id: string | null;
  assignment_number: string | null;
  assignment_label: string | null;
  chk_collecting_docs: boolean;
  chk_needs_contract: boolean;
  chk_start_dates_booked: boolean;
  chk_credentialing_started: boolean;
  chk_credentialing_complete: boolean;
  chk_provider_working: boolean;
  checklist_audit: Record<string, ChecklistAuditEntry>;
  notes: string | null;
  version: number;
  updated_by: string | null;
  updated_at: string | null;
}

export function cleanEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().slice(0, MAX_EMAIL_LEN);
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s : '';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Accepts YYYY-MM-DD; an ISO datetime is truncated to its date part (date-only field).
export function cleanDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) return null;
  return s;
}

// Trim + cap a free-text field. null when empty. NOT HTML-escaped here — escaping
// happens once, at render (esc() in pipeline-client.ts), so values round-trip
// through the DB and this sanitizer without ever double-escaping.
function cleanText(raw: unknown, cap: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, cap);
  return s.length ? s : null;
}

const isStage = (v: unknown): v is Stage => typeof v === 'string' && (STAGES as readonly string[]).includes(v);
const isBool = (v: unknown): boolean => v === true;

function cleanAudit(raw: unknown): Record<string, ChecklistAuditEntry> {
  const out: Record<string, ChecklistAuditEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of CHECKLIST_KEYS) {
    const e = (raw as Record<string, unknown>)[chkCol(k)];
    if (e && typeof e === 'object') {
      const by = cleanEmail((e as Record<string, unknown>).by);
      const at = (e as Record<string, unknown>).at;
      if (by && typeof at === 'number' && Number.isFinite(at)) out[chkCol(k)] = { by, at: Math.floor(at) };
    }
  }
  return out;
}

/** Shape a raw DB row (or partial/hostile object) into a canonical PipelinePerson.
 *  Never throws; fills every field with a safe default. */
export function readPerson(row: unknown): PipelinePerson {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    stage: isStage(r.stage) ? r.stage : 'warm_lead',
    full_name: cleanText(r.full_name, MAX_NAME_LEN) ?? '',
    specialty_slug: cleanText(r.specialty_slug, MAX_SPECIALTY_LEN),
    specialty_name: cleanText(r.specialty_name, MAX_SPECIALTY_LEN),
    state: cleanText(r.state, MAX_STATE_LEN),
    phone: cleanText(r.phone, MAX_PHONE_LEN),
    email: cleanEmail(r.email) || null,
    owner_email: cleanEmail(r.owner_email) || null,
    target_start_date: cleanDate(r.target_start_date),
    assignment_id: (typeof r.assignment_id === 'string' && r.assignment_id.length > 0 && r.assignment_id.length <= 64) ? r.assignment_id : null,
    assignment_number: cleanText(r.assignment_number, MAX_LABEL_LEN),
    assignment_label: cleanText(r.assignment_label, MAX_LABEL_LEN),
    chk_collecting_docs: isBool(r.chk_collecting_docs),
    chk_needs_contract: isBool(r.chk_needs_contract),
    chk_start_dates_booked: isBool(r.chk_start_dates_booked),
    chk_credentialing_started: isBool(r.chk_credentialing_started),
    chk_credentialing_complete: isBool(r.chk_credentialing_complete),
    chk_provider_working: isBool(r.chk_provider_working),
    checklist_audit: cleanAudit(r.checklist_audit),
    notes: cleanText(r.notes, MAX_NOTES_LEN),
    version: typeof r.version === 'number' && Number.isFinite(r.version) ? Math.max(0, Math.floor(r.version)) : 0,
    updated_by: cleanEmail(r.updated_by) || null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

export function checklistCount(p: PipelinePerson): number {
  return CHECKLIST_KEYS.reduce((n, k) => n + (p[chkCol(k)] ? 1 : 0), 0);
}

/** First+last initials from a person's name (strips a leading "Dr."). One letter for a
 *  single-word name; "?" when empty. NOT HTML-escaped — the caller escapes at render. */
export function personInitials(fullName: string): string {
  const parts = (fullName || '').replace(/^dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (parts[0][0] + last).toUpperCase();
}

/** Bucket people by board lane (archived excluded), each lane newest-updated first. */
export function groupByStage(people: PipelinePerson[]): Record<BoardStage, PipelinePerson[]> {
  const out = Object.fromEntries(BOARD_STAGES.map((s) => [s, [] as PipelinePerson[]])) as Record<BoardStage, PipelinePerson[]>;
  for (const p of people) {
    if ((BOARD_STAGES as readonly string[]).includes(p.stage)) out[p.stage as BoardStage].push(p);
  }
  const ts = (p: PipelinePerson) => (p.updated_at ? Date.parse(p.updated_at) || 0 : 0);
  for (const s of BOARD_STAGES) out[s].sort((a, b) => ts(b) - ts(a));
  return out;
}
