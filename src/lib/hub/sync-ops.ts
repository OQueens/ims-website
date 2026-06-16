// Pure operation algebra for Weekly Sync. ONE op at a time, applied to a
// ColumnData. Used by (a) the client for optimistic UI, (b) vitest as the test
// oracle, (c) mirrored by the hub_sync_apply Postgres RPC (the authoritative
// atomic apply). Never mutates input. IDEMPOTENT: re-applying an identical op is
// a no-op (retry-safe) — upsertFocus only stamps editedBy/editedAt when html
// actually changes. A1 covers six ops.
import {
  type ColumnData, type Focus, type Section,
  sanitizeHtml, escapeText, MAX_FOCUSES, MAX_SECTIONS, MAX_TITLE_LEN,
} from './sync-data';

export type SyncOp =
  | { type: 'upsertFocus'; sectionId: string; focus: { id: string; html: string } }
  | { type: 'deleteFocus'; sectionId: string; focusId: string }
  | { type: 'setSectionTitle'; sectionId: string; title: string }
  | { type: 'addSection'; section: { id: string; title?: string } }
  | { type: 'deleteSection'; sectionId: string }
  | { type: 'clearColumn' };

export interface ApplyCtx { email: string; now: number; }

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const cloneCol = (c: ColumnData): ColumnData => ({ v: 3, sections: c.sections.map((s) => ({ ...s, focuses: s.focuses.map((f) => ({ ...f })) })) });

export function applyOp(column: ColumnData, op: SyncOp, ctx: ApplyCtx): ColumnData {
  const col = cloneCol(column);
  // Find the target section, or CREATE it (stamped by the author) if it doesn't
  // exist yet — the client's auto-ensured "Add a focus" section is a UI affordance
  // that is never sent as an addSection op, so the FIRST focus/title of a blank
  // week would otherwise target a non-existent section and be silently dropped.
  // Self-creating here (and identically in the RPC) makes the op order-independent
  // and retry-safe. Returns null only when the section cap is already reached.
  const findOrCreateSection = (id: string): Section | null => {
    let sec = col.sections.find((s) => s.id === id);
    if (!sec) {
      if (col.sections.length >= MAX_SECTIONS) return null;
      sec = { id, title: '', by: ctx.email, focuses: [] };
      col.sections.push(sec);
    }
    return sec;
  };
  switch (op.type) {
    case 'upsertFocus': {
      const sec = findOrCreateSection(op.sectionId);
      if (!sec) return col;
      const html = sanitizeHtml(op.focus.html);
      const existing = sec.focuses.find((f) => f.id === op.focus.id);
      if (existing) {
        if (existing.html === html) return col;
        existing.html = html;
        existing.editedBy = ctx.email;
        existing.editedAt = ctx.now;
      } else {
        if (sec.focuses.length >= MAX_FOCUSES) return col;
        const focus: Focus = { id: op.focus.id, html, by: ctx.email, createdAt: ctx.now };
        sec.focuses.push(focus);
      }
      return col;
    }
    case 'deleteFocus': {
      const sec = col.sections.find((s) => s.id === op.sectionId);
      if (sec) sec.focuses = sec.focuses.filter((f) => f.id !== op.focusId);
      return col;
    }
    case 'setSectionTitle': {
      const sec = findOrCreateSection(op.sectionId);
      if (sec) sec.title = escapeText(op.title.trim()).slice(0, MAX_TITLE_LEN);
      return col;
    }
    case 'addSection': {
      if (col.sections.some((s) => s.id === op.section.id)) return col;
      if (col.sections.length >= MAX_SECTIONS) return col;
      const section: Section = { id: op.section.id, title: escapeText((op.section.title ?? '').trim()).slice(0, MAX_TITLE_LEN), by: ctx.email, focuses: [] };
      col.sections.push(section);
      return col;
    }
    case 'deleteSection':
      col.sections = col.sections.filter((s) => s.id !== op.sectionId);
      return col;
    case 'clearColumn':
      return { v: 3, sections: [] };
    default:
      return col;
  }
}

const isCleanId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 4000;

export function validateOp(raw: unknown): { ok: true; op: SyncOp } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'op-not-object' };
  const o = raw as Record<string, unknown>;
  switch (o.type) {
    case 'upsertFocus': {
      const f = o.focus as Record<string, unknown> | undefined;
      if (!isCleanId(o.sectionId) || !f || !isCleanId(f.id) || !isStr(f.html)) return { ok: false, reason: 'bad-upsertFocus' };
      return { ok: true, op: { type: 'upsertFocus', sectionId: o.sectionId, focus: { id: f.id as string, html: f.html as string } } };
    }
    case 'deleteFocus':
      if (!isCleanId(o.sectionId) || !isCleanId(o.focusId)) return { ok: false, reason: 'bad-deleteFocus' };
      return { ok: true, op: { type: 'deleteFocus', sectionId: o.sectionId, focusId: o.focusId } };
    case 'setSectionTitle':
      if (!isCleanId(o.sectionId) || !isStr(o.title)) return { ok: false, reason: 'bad-setSectionTitle' };
      return { ok: true, op: { type: 'setSectionTitle', sectionId: o.sectionId, title: o.title } };
    case 'addSection': {
      const s = o.section as Record<string, unknown> | undefined;
      if (!s || !isCleanId(s.id) || (s.title !== undefined && !isStr(s.title))) return { ok: false, reason: 'bad-addSection' };
      const section = s.title !== undefined ? { id: s.id as string, title: s.title as string } : { id: s.id as string };
      return { ok: true, op: { type: 'addSection', section } };
    }
    case 'deleteSection':
      if (!isCleanId(o.sectionId)) return { ok: false, reason: 'bad-deleteSection' };
      return { ok: true, op: { type: 'deleteSection', sectionId: o.sectionId } };
    case 'clearColumn':
      return { ok: true, op: { type: 'clearColumn' } };
    default:
      return { ok: false, reason: 'unknown-op-type' };
  }
}
