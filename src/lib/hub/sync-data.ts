// Pure helpers for the Weekly Sync board's shared persistence (hub_weekly_sync
// table). No I/O — the endpoint (/hub/api/sync) and the client both validate
// through here. Ported from the IAS dashboard weekHelpers (getWeekKey) but using
// UTC so the server (Workers, UTC) and any client agree on the week boundary.

export const COLUMN_KEYS = ['recruiting', 'marketing', 'operations'] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

// Bounds so a malformed/hostile POST can't bloat a row.
export const MAX_ITEMS = 60;
export const MAX_ITEM_LEN = 500;

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

export interface SyncPayload { weekKey: string; columnKey: ColumnKey; items: string[]; }
export type ValidateResult = { ok: true; value: SyncPayload } | { ok: false; reason: string };

/** Validate + sanitize a board-column write. Returns the canonical payload
 *  (items trimmed, length-capped, count-capped) or a reason on rejection. */
export function validateSyncPayload(raw: unknown): ValidateResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not-an-object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.weekKey !== 'string' || !WEEK_KEY_RE.test(r.weekKey)) return { ok: false, reason: 'bad-week-key' };
  if (typeof r.columnKey !== 'string' || !COLUMN_KEYS.includes(r.columnKey as ColumnKey)) return { ok: false, reason: 'bad-column' };
  if (!Array.isArray(r.items)) return { ok: false, reason: 'items-not-array' };
  if (r.items.some((it) => typeof it !== 'string')) return { ok: false, reason: 'item-not-string' };
  const items = (r.items as string[]).slice(0, MAX_ITEMS).map((s) => s.trim().slice(0, MAX_ITEM_LEN));
  return { ok: true, value: { weekKey: r.weekKey, columnKey: r.columnKey as ColumnKey, items } };
}
