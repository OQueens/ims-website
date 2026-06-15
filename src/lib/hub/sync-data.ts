// Pure helpers for the Weekly Sync board's shared persistence (hub_weekly_sync
// table). No I/O — the endpoint (/hub/api/sync) and the client both validate
// through here.
//
// DATA MODEL v2 (2026-06-15 rebuild): a column is no longer a flat string[].
// It is an id-keyed tree of sections → focuses, each focus carrying sanitized
// rich-text HTML. Ids make concurrent edits and live merge-by-id possible (a
// write/poll touches one focus, not the whole column blindly). The shape is
// stored in the SAME `items` jsonb column (no migration needed); a v1 string[]
// row is migrated to one untitled section on read.
//
//   ColumnData = { v: 2, sections: [ { id, title, focuses: [ { id, html } ] } ] }
//
// getWeekKey is UTC ISO-8601 so the server (Workers, UTC) and any client agree
// on the week boundary.

export const COLUMN_KEYS = ['recruiting', 'marketing', 'operations'] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

// Bounds so a malformed/hostile POST can't bloat a row.
export const MAX_SECTIONS = 16;
export const MAX_FOCUSES = 50; // per section
export const MAX_HTML_LEN = 2000; // per focus (post-sanitize)
export const MAX_TITLE_LEN = 80; // per section title
export const MAX_ID_LEN = 40;
export const MAX_EMAIL_LEN = 120;

export interface Focus { id: string; html: string; by: string; createdAt: number; editedBy?: string; editedAt?: number; }
export interface Section { id: string; title: string; by?: string; focuses: Focus[]; }
export interface ColumnData { v: 3; sections: Section[]; }

/** ISO 8601 week key (YYYY-Wxx), computed in UTC. Week 1 contains the first
 *  Thursday of the year; the returned year is the ISO week-year (which can
 *  differ from the calendar year on the Dec/Jan boundary). */
export function getWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday 0 → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to Thursday of this week
  const isoYear = d.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;
export function isWeekKey(s: unknown): s is string {
  return typeof s === 'string' && WEEK_KEY_RE.test(s);
}

// ── Rich-text sanitizer ───────────────────────────────────────────────────────
// Allowlist of inline formatting tags only, NO attributes. The board is gated
// behind hub auth (internal @iastaffing.com staff), but one staffer must never
// be able to store HTML that runs script in another's browser — so we sanitize
// on WRITE (server) and again on RENDER (client), both via this function.
//
// Strategy: protect the allowed tags as control-char placeholders, escape
// EVERYTHING else (which neutralizes all other tags, attributes, and stray
// angle brackets), then restore the placeholders to attribute-free tags. This
// "escape-all-then-restore" approach has no tag-parsing edge cases — anything
// not matched as an allowed tag becomes inert text.
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'mark', 'u'] as const;
// Sentinels are C0 control codes built via fromCharCode (no literal control
// bytes in source). CONTROL_RE strips ALL C0 + DEL from input first, so user
// text can never smuggle a sentinel past the escape pass.
const PH_OPEN = String.fromCharCode(1);
const PH_CLOSE = String.fromCharCode(2);
const PH_BR = String.fromCharCode(3);
const CONTROL_RE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g');
const LEFTOVER_RE = new RegExp('[' + PH_OPEN + PH_CLOSE + PH_BR + ']', 'g');
// Escape a literal `&` only when it does NOT already begin a known entity, so
// escaping is idempotent (re-escaping sanitized text is a no-op).
const AMP_RE = /&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g;

export function sanitizeHtml(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(CONTROL_RE, '');
  // Protect allowed tags (attribute-stripped) as placeholders.
  s = s.replace(/<\s*(b|strong|i|em|mark|u)(?:\s[^>]*)?>/gi, (_m, t: string) => PH_OPEN + t.toLowerCase() + PH_OPEN);
  s = s.replace(/<\s*\/\s*(b|strong|i|em|mark|u)\s*>/gi, (_m, t: string) => PH_CLOSE + t.toLowerCase() + PH_CLOSE);
  s = s.replace(/<\s*br\s*\/?\s*>/gi, PH_BR);
  // Escape everything else: kills all other tags, attributes, stray brackets.
  // The `&` escape is ENTITY-AWARE (skips an existing &amp;/&lt;/&gt;/&quot;/&#..)
  // so sanitizeHtml is IDEMPOTENT — safe to run on write AND read AND render
  // without double-escaping already-sanitized content.
  s = s.replace(AMP_RE, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Restore the allowed tags.
  for (const t of ALLOWED_TAGS) {
    s = s.split(PH_OPEN + t + PH_OPEN).join('<' + t + '>');
    s = s.split(PH_CLOSE + t + PH_CLOSE).join('</' + t + '>');
  }
  s = s.split(PH_BR).join('<br>');
  // Drop any leftover lone sentinels (e.g. an unmatched opener).
  s = s.replace(LEFTOVER_RE, '');
  return s.slice(0, MAX_HTML_LEN);
}

// Escape ALL markup → inert text. Migrates v1 strings (which were plain text
// rendered via textContent) into the html field, escaped not interpreted.
export function escapeText(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return s
    .replace(CONTROL_RE, '')
    .replace(AMP_RE, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, MAX_HTML_LEN);
}

// Sanitize an id to [A-Za-z0-9_-], capped. Empty/invalid → generated.
function cleanId(raw: unknown, gen: () => string): string {
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_ID_LEN);
    if (cleaned.length >= 3) return cleaned;
  }
  return gen();
}

function cleanEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().slice(0, MAX_EMAIL_LEN);
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s : '';
}

function cleanTs(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

/** An id generator. Server passes one backed by crypto.randomUUID; tests pass a
 *  deterministic counter. Always yields a string >= 3 chars. */
export type IdGen = (prefix: string) => string;

export function makeIdGen(): IdGen {
  // crypto.randomUUID exists in Workers and Node 18+.
  return (prefix: string) =>
    prefix + '_' + (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).replace(/-/g, '').slice(0, 16);
}

export function emptyColumn(): ColumnData {
  return { v: 3, sections: [] };
}

function normalizeSections(sectionsRaw: unknown[], gen: IdGen): Section[] {
  return sectionsRaw
    .slice(0, MAX_SECTIONS)
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
    .map((s) => {
      const focusesRaw = Array.isArray(s.focuses) ? s.focuses : [];
      const focuses: Focus[] = focusesRaw
        .slice(0, MAX_FOCUSES)
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => {
          const focus: Focus = {
            id: cleanId(f.id, () => gen('f')),
            html: sanitizeHtml(f.html),
            by: cleanEmail(f.by),
            createdAt: cleanTs(f.createdAt),
          };
          const editedBy = cleanEmail(f.editedBy);
          if (editedBy) focus.editedBy = editedBy;
          const editedAt = cleanTs(f.editedAt);
          if (editedAt) focus.editedAt = editedAt;
          return focus;
        });
      return {
        id: cleanId(s.id, () => gen('s')),
        title: escapeText(typeof s.title === 'string' ? s.title.trim() : '').slice(0, MAX_TITLE_LEN),
        by: cleanEmail(s.by) || undefined,
        focuses,
      };
    });
}

/** Normalize + sanitize arbitrary input into a valid ColumnData. Accepts:
 *   • a v2 sections ARRAY (the stored jsonb shape — the table CHECK-constrains
 *     `items` to be an array, so we persist `column.sections`, not the object),
 *   • a v2 object `{ sections: [...] }` (the client POST body), or
 *   • a v1 flat string[] (migrated to one untitled section).
 *  Sanitizes every html field, caps counts/lengths, fills/cleans every id.
 *  Never throws. */
export function normalizeColumn(raw: unknown, gen: IdGen): ColumnData {
  if (Array.isArray(raw)) {
    // A non-empty array of strings is v1 → migrate to one untitled section.
    if (raw.length > 0 && raw.every((el) => typeof el === 'string')) {
      const focuses: Focus[] = raw
        .slice(0, MAX_FOCUSES)
        .map((s) => ({ id: gen('f'), html: escapeText((s as string).trim()), by: '', createdAt: 0 }))
        .filter((f) => f.html.length > 0);
      return { v: 3, sections: focuses.length ? [{ id: gen('s'), title: '', focuses }] : [] };
    }
    // Otherwise it's a v2/v3 sections array (or an empty array → blank column).
    return { v: 3, sections: normalizeSections(raw, gen) };
  }
  // v2/v3 object form `{ sections: [...] }` (client POST body).
  if (raw && typeof raw === 'object' && Array.isArray((raw as { sections?: unknown }).sections)) {
    return { v: 3, sections: normalizeSections((raw as { sections: unknown[] }).sections, gen) };
  }
  return emptyColumn();
}

export interface SyncPayload { weekKey: string; columnKey: ColumnKey; column: ColumnData; }
export type ValidateResult = { ok: true; value: SyncPayload } | { ok: false; reason: string };

/** Validate + sanitize a board-column write. Returns the canonical payload
 *  (column normalized, html sanitized, counts capped) or a reason on rejection. */
export function validateSyncPayload(raw: unknown, gen: IdGen = makeIdGen()): ValidateResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not-an-object' };
  const r = raw as Record<string, unknown>;
  if (!isWeekKey(r.weekKey)) return { ok: false, reason: 'bad-week-key' };
  if (typeof r.columnKey !== 'string' || !COLUMN_KEYS.includes(r.columnKey as ColumnKey)) return { ok: false, reason: 'bad-column' };
  // Accept either { column: {...} } (v2) or { items: [...] } (legacy clients).
  const source = 'column' in r ? r.column : 'items' in r ? r.items : undefined;
  if (source === undefined) return { ok: false, reason: 'missing-column' };
  const column = normalizeColumn(source, gen);
  return { ok: true, value: { weekKey: r.weekKey, columnKey: r.columnKey as ColumnKey, column } };
}

/** Read a stored `items` jsonb value (v1 string[] or v2 object or null) into a
 *  canonical ColumnData for rendering. Used by the SSR read + the GET endpoint. */
export function readColumn(stored: unknown, gen: IdGen = makeIdGen()): ColumnData {
  if (stored == null) return emptyColumn();
  return normalizeColumn(stored, gen);
}
